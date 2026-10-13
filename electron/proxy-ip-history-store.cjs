const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');

function normalizeCountryCode(value) {
  const raw = String(value || '').trim();
  if (!raw || /^unknown$/i.test(raw)) return 'Unknown';
  return /^[a-z]{2}$/i.test(raw) ? raw.toUpperCase() : raw.slice(0, 64);
}

function sanitizeProxyEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
    const parsed = new URL(candidate);
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${host}${port}`;
  } catch {
    const withoutScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    const afterAuth = withoutScheme.includes('@') ? withoutScheme.slice(withoutScheme.lastIndexOf('@') + 1) : withoutScheme;
    return afterAuth.split(/[/?#]/, 1)[0].trim();
  }
}

function isPublicObservedIp(value) {
  const ip = String(value || '').trim();
  const version = net.isIP(ip);
  if (!version) return false;
  if (version === 4) {
    const [a,b,c] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && c === 2) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return false;
  if (/^f[cd]/.test(lower)) return false;
  if (/^fe[89ab]/.test(lower)) return false;
  if (/^ff/.test(lower)) return false;
  if (/^2001:0*db8:/i.test(lower)) return false;
  return true;
}

function safeProxyIdentity(event) {
  const source = String(event.proxySource || 'unknown').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 48) || 'unknown';
  const proxyId = String(event.proxyId || '').trim().replace(/[^a-z0-9._-]+/gi, '-').slice(0, 96);
  if (proxyId) return `${source}:${proxyId}`;
  const endpoint = sanitizeProxyEndpoint(event.proxyEndpointKey);
  return endpoint ? `${source}:${endpoint}` : `${source}:unknown`;
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createProxyIpHistoryStore({ filePath, writeFile, readFile, debounceMs = 500, countryResolver = null } = {}) {
  if (!filePath) throw new Error('Proxy IP history filePath is required');
  const lifetime = new Map();
  const perRun = new Map();
  const countryCache = new Map();
  let recordingEnabled = true;
  const resolvingCountries = new Set();
  let timer = null;
  let dirty = false;
  let writing = Promise.resolve();
  let persistenceError = null;

  const defaultRead = (target) => fs.readFileSync(target, 'utf8');
  const defaultWrite = async (target, data) => {
    await fsp.mkdir(path.dirname(target), { recursive:true });
    await fsp.writeFile(target, data, 'utf8');
  };
  const read = readFile || defaultRead;
  const write = writeFile || defaultWrite;

  const load = () => {
    let text;
    try { text = read(filePath); } catch { return; }
    if (text && typeof text.then === 'function') return;
    try {
      const parsed = JSON.parse(String(text || '{}'));
      if (parsed?.settings && typeof parsed.settings.recordingEnabled === 'boolean') {
        recordingEnabled = parsed.settings.recordingEnabled;
      }
      for (const row of Array.isArray(parsed.lifetime) ? parsed.lifetime : []) {
        const safe = { ...row, runIds:Array.isArray(row.runIds) ? row.runIds.map(String) : [] };
        lifetime.set(`${safe.proxyIdentity}|${safe.observedIp}`, safe);
      }
      for (const row of Array.isArray(parsed.perRun) ? parsed.perRun : []) {
        const safe = { ...row, phasesSeen:Array.isArray(row.phasesSeen) ? row.phasesSeen.map(String) : [] };
        perRun.set(`${safe.runId}|${safe.proxyIdentity}|${safe.observedIp}`, safe);
      }
      for (const [ip,country] of Object.entries(parsed.countryCache || {})) countryCache.set(ip, normalizeCountryCode(country));
    } catch { /* malformed history is ignored; QA must continue */ }
  };

  const snapshot = () => ({
    version:1,
    settings:{ recordingEnabled },
    lifetime:[...lifetime.values()].map((row) => ({ ...row, runIds:[...(row.runIds || [])] })),
    perRun:[...perRun.values()].map((row) => ({ ...row, phasesSeen:[...(row.phasesSeen || [])] })),
    countryCache:Object.fromEntries(countryCache),
  });

  const writeSnapshot = async () => {
    if (!dirty) return true;
    dirty = false;
    const payload = JSON.stringify(snapshot());
    writing = writing.then(() => Promise.resolve(write(filePath, payload))).then(() => {
      persistenceError = null;
      return true;
    }).catch((error) => {
      persistenceError = String(error?.message || error || 'Proxy IP history persistence failed');
      return false;
    });
    return writing;
  };

  const schedule = () => {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void writeSnapshot();
    }, Math.max(0, Number(debounceMs) || 0));
    timer.unref?.();
  };

  const backfillCountry = (ip, country) => {
    const normalized = normalizeCountryCode(country);
    countryCache.set(ip, normalized);
    for (const row of lifetime.values()) if (row.observedIp === ip) row.countryCode = normalized;
    for (const row of perRun.values()) if (row.observedIp === ip) row.countryCode = normalized;
    schedule();
  };

  const enqueueCountry = (ip) => {
    if (!countryResolver?.resolve || countryCache.has(ip) || resolvingCountries.has(ip)) return;
    resolvingCountries.add(ip);
    Promise.resolve(countryResolver.resolve(ip))
      .then((country) => backfillCountry(ip, country))
      .catch(() => backfillCountry(ip, 'Unknown'))
      .finally(() => resolvingCountries.delete(ip));
  };

  const getRecordingState = () => ({ recordingEnabled });

  const setRecordingState = async (enabled) => {
    const next = Boolean(enabled);
    if (next === recordingEnabled) return getRecordingState();
    const previous = recordingEnabled;
    if (timer) { clearTimeout(timer); timer = null; }
    recordingEnabled = next;
    dirty = true;
    const saved = await writeSnapshot();
    if (!saved) {
      const errorMessage = persistenceError || 'Proxy IP History recording state could not be saved';
      recordingEnabled = previous;
      dirty = true;
      await writeSnapshot();
      throw new Error(errorMessage);
    }
    return getRecordingState();
  };

  const observe = (event = {}) => {
    if (!recordingEnabled) return false;
    const runId = String(event.runId || '').trim();
    const observedIp = String(event.observedIp || '').trim();
    if (!runId || !isPublicObservedIp(observedIp)) return false;
    const proxyIdentity = safeProxyIdentity(event);
    const proxySource = String(event.proxySource || 'unknown').slice(0, 48);
    const observedAt = String(event.observedAt || new Date().toISOString());
    const phase = ['preflight','post-behavior','retry'].includes(String(event.phase)) ? String(event.phase) : 'preflight';
    const suppliedCountry = normalizeCountryCode(event.countryCode);
    const cachedCountry = suppliedCountry !== 'Unknown' ? suppliedCountry : countryCache.get(observedIp) || 'Unknown';
    if (suppliedCountry !== 'Unknown') countryCache.set(observedIp, suppliedCountry);

    const lifetimeKey = `${proxyIdentity}|${observedIp}`;
    let life = lifetime.get(lifetimeKey);
    if (!life) {
      life = {
        proxyIdentity, proxySource, observedIp, countryCode:cachedCountry,
        firstSeenAt:observedAt, lastSeenAt:observedAt,
        totalSeenCount:0, runsSeenCount:0, lastRunId:runId, runIds:[],
      };
      lifetime.set(lifetimeKey, life);
    }
    life.totalSeenCount += 1;
    life.lastSeenAt = observedAt;
    life.lastRunId = runId;
    if (cachedCountry !== 'Unknown') life.countryCode = cachedCountry;
    if (!life.runIds.includes(runId)) {
      life.runIds.push(runId);
      life.runsSeenCount += 1;
    }

    const runKey = `${runId}|${proxyIdentity}|${observedIp}`;
    let run = perRun.get(runKey);
    if (!run) {
      run = {
        runId, proxyIdentity, proxySource, observedIp, countryCode:cachedCountry,
        firstSeenAt:observedAt, lastSeenAt:observedAt,
        seenInRunCount:0, phasesSeen:[],
      };
      perRun.set(runKey, run);
    }
    run.seenInRunCount += 1;
    run.lastSeenAt = observedAt;
    if (cachedCountry !== 'Unknown') run.countryCode = cachedCountry;
    if (!run.phasesSeen.includes(phase)) run.phasesSeen.push(phase);

    schedule();
    if (cachedCountry === 'Unknown') enqueueCountry(observedIp);
    return true;
  };

  const mergedRunRows = (runId) => {
    return [...perRun.values()].filter((row) => row.runId === runId).map((run) => {
      const life = lifetime.get(`${run.proxyIdentity}|${run.observedIp}`) || {};
      return {
        ...life,
        ...run,
        totalSeenCount:Number(life.totalSeenCount) || run.seenInRunCount,
        runsSeenCount:Number(life.runsSeenCount) || 1,
        historicallyRepeated:(Number(life.totalSeenCount) || run.seenInRunCount) > 1,
        repeatedInRun:run.seenInRunCount > 1,
      };
    });
  };

  const filteredRows = (filters = {}) => {
    let rows;
    if (filters.runId) rows = mergedRunRows(String(filters.runId));
    else {
      const maxSeenInRunByLifetimeKey = new Map();
      for (const run of perRun.values()) {
        const key = `${run.proxyIdentity}|${run.observedIp}`;
        const seen = Number(run.seenInRunCount) || 0;
        if (seen > (maxSeenInRunByLifetimeKey.get(key) || 0)) maxSeenInRunByLifetimeKey.set(key, seen);
      }
      rows = [...lifetime.values()].map((life) => {
        const maxSeenInRunCount = maxSeenInRunByLifetimeKey.get(`${life.proxyIdentity}|${life.observedIp}`) || 0;
        return { ...life, historicallyRepeated:life.totalSeenCount > 1, repeatedInRun:maxSeenInRunCount > 1, maxSeenInRunCount };
      });
    }
    const search = String(filters.search || '').trim().toLowerCase();
    if (search) rows = rows.filter((row) => [row.observedIp,row.proxyIdentity,row.countryCode].some((value) => String(value || '').toLowerCase().includes(search)));
    if (filters.countryCode) rows = rows.filter((row) => String(row.countryCode || 'Unknown').toLowerCase() === String(filters.countryCode).toLowerCase());
    if (filters.proxyIdentity) rows = rows.filter((row) => row.proxyIdentity === filters.proxyIdentity);
    if (filters.repeatFilter === 'repeated-in-run') rows = rows.filter((row) => row.repeatedInRun === true);
    if (filters.repeatFilter === 'historically-repeated') rows = rows.filter((row) => row.historicallyRepeated === true);
    if (filters.repeatFilter === 'new-only') rows = rows.filter((row) => row.historicallyRepeated !== true);
    rows.sort((a,b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')));
    return rows;
  };

  const list = (filters = {}) => {
    const page = Math.max(1, Math.floor(Number(filters.page) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(filters.pageSize) || 50)));
    const rows = filteredRows(filters);
    const total = rows.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const summary = {
      uniqueIps:new Set(rows.map((row) => row.observedIp)).size,
      repeatedIps:rows.filter((row) => filters.runId ? row.repeatedInRun === true : row.historicallyRepeated === true).length,
      countries:new Set(rows.map((row) => row.countryCode).filter((code) => code && code !== 'Unknown')).size,
      totalObservations:rows.reduce((sum,row) => sum + (filters.runId ? Number(row.seenInRunCount) || 0 : Number(row.totalSeenCount) || 0), 0),
    };
    return { page, pageSize, total, totalPages, summary, rows:rows.slice(start, start + pageSize).map(({ runIds, ...row }) => row) };
  };

  const getRunSummary = (runId) => {
    const rows = mergedRunRows(String(runId || '')).sort((a,b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
    return {
      runId:String(runId || ''),
      rows,
      uniqueIps:new Set(rows.map((row) => row.observedIp)).size,
      repeatedIpCount:rows.filter((row) => row.repeatedInRun).length,
      observationCount:rows.reduce((sum,row) => sum + row.seenInRunCount, 0),
      countries:new Set(rows.map((row) => row.countryCode).filter((code) => code && code !== 'Unknown')).size,
    };
  };

  const exportCsv = (filters = {}) => {
    const rows = filteredRows(filters).map(({ runIds, ...row }) => row);
    const header = ['IP','Country','Proxy','Total Seen','Runs Seen','This Run','First Seen','Last Seen'];
    return [header, ...rows.map((row) => [row.observedIp,row.countryCode,row.proxyIdentity,row.totalSeenCount,row.runsSeenCount,row.seenInRunCount || '',row.firstSeenAt,row.lastSeenAt])]
      .map((row) => row.map(csvCell).join(','))
      .join('\n');
  };

  const flush = async () => {
    if (timer) { clearTimeout(timer); timer = null; }
    return writeSnapshot();
  };

  const clear = () => {
    lifetime.clear(); perRun.clear(); countryCache.clear(); resolvingCountries.clear(); schedule();
    return true;
  };

  load();
  return { observe, list, getRunSummary, clear, exportCsv, flush, getRecordingState, setRecordingState, getPersistenceError:() => persistenceError };
}

module.exports = { createProxyIpHistoryStore, sanitizeProxyEndpoint, isPublicObservedIp, safeProxyIdentity };
