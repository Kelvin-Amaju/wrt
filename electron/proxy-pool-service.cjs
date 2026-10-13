const { randomUUID } = require('node:crypto');
const { parseProxyImport, toProxyServer } = require('./proxy-parser.cjs');
const { classifyProxyHealth, FIRST_DEAD_RETRY_MS } = require('./proxy-health.cjs');
const { redactSecrets } = require('./proxy-diagnostics.cjs');
const { beginProxyAllocation, endProxyAllocation } = require('./network-route-guard.cjs');

const HEALTH_CONCURRENCY = 3;
const STALE_AFTER_MS = 10 * 60 * 1000;
const SCHEDULER_TICK_MS = 30 * 1000;
const MAX_ACTIVITY = 250;

function createProxyPoolService({ store, healthChecker, directIpProvider, now = Date.now, random = Math.random, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!store || !healthChecker) throw new Error('Proxy pool service dependencies are required');

  const inFlightChecks = new Map();
  const runtimeConfirmations = new Map();
  const healthQueue = [];
  const reservations = new Map();
  const rotatingCursor = { value: 0 };
  const staticCycles = new Map();
  const activity = [];
  let activeHealthTests = 0;
  let stopped = true;
  let timer = null;

  function nowIso() { return new Date(now()).toISOString(); }

  function addActivity(level, message, proxyId) {
    activity.unshift({ id: randomUUID(), proxyId, level, message: String(message), timestamp: nowIso() });
    if (activity.length > MAX_ACTIVITY) activity.length = MAX_ACTIVITY;
  }

  function safeEndpoint(record) {
    return record ? `${record.protocol}://${record.hostname}:${record.port}` : 'proxy';
  }

  async function list(kind) {
    const records = await store.list(kind);
    return records.filter((record) => record.source !== 'fetched-free');
  }

  async function getDirectIp() {
    // Strict proxy mode never probes the host/direct public IP.
    return null;
  }

  async function getSummary() {
    const records = (await store.list()).filter((record) => record.source !== 'fetched-free');
    const count = (health) => records.filter((r) => r.health === health).length;
    const eligible = (r, kind, health) => r.kind === kind && r.enabled && r.health === health && !r.staticIpChangePending;
    return {
      total: records.length,
      live: count('live'),
      slow: count('slow'),
      dead: count('dead'),
      unavailable: count('unavailable'),
      checking: count('checking'),
      rotatingLive: records.filter((r) => eligible(r, 'rotating', 'live')).length,
      rotatingSlow: records.filter((r) => eligible(r, 'rotating', 'slow')).length,
      staticLive: records.filter((r) => eligible(r, 'static', 'live')).length,
      staticSlow: records.filter((r) => eligible(r, 'static', 'slow')).length,
    };
  }

  async function importText({ text, kind, replacePasswords = false }) {
    const parsed = parseProxyImport(text, kind);
    const stored = await store.importMany(parsed.accepted, { replacePasswords });
    for (const record of stored.accepted) addActivity('info', `Imported ${safeEndpoint(record)} as ${record.kind}`, record.id);
    const result = {
      accepted: stored.accepted,
      duplicates: stored.duplicates.map((item) => ({ ...item, line: redactSecrets(item.line) })),
      invalid: parsed.invalid.map((item) => ({ ...item, line: redactSecrets(item.line) })),
    };
    if (!stopped && stored.accepted.length) {
      Promise.resolve().then(() => checkMany(stored.accepted.map((r) => r.id))).catch(() => undefined);
    }
    return result;
  }


  async function update(id, patch) {
    const updated = await store.update(id, patch);
    addActivity('info', `Updated ${safeEndpoint(updated)}`, id);
    return updated;
  }

  async function remove(ids) {
    await store.remove(ids);
    const removed=new Set((ids||[]).map(String));
    for(const [key,reservation] of reservations.entries()) if(removed.has(String(reservation?.proxyId))) reservations.delete(key);
    addActivity('info', `Deleted ${ids.length} proxy record(s)`);
  }

  async function setEnabled(ids, enabled) {
    const result = await store.setEnabled(ids, enabled);
    addActivity('info', `${enabled ? 'Enabled' : 'Disabled'} ${ids.length} proxy record(s)`);
    return result;
  }

  async function acceptStaticIp(id) {
    const updated = await store.acceptStaticIp(id);
    addActivity('success', `Accepted new static exit IP for ${safeEndpoint(updated)}`, id);
    return updated;
  }

  function drainHealthQueue() {
    while (activeHealthTests < HEALTH_CONCURRENCY && healthQueue.length) {
      const task = healthQueue.shift();
      activeHealthTests += 1;
      Promise.resolve()
        .then(() => executeHealthCheck(task.id))
        .then(task.resolve, task.reject)
        .finally(() => {
          activeHealthTests -= 1;
          inFlightChecks.delete(task.id);
          drainHealthQueue();
        });
    }
  }

  function check(id) {
    if (inFlightChecks.has(id)) return inFlightChecks.get(id);
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    inFlightChecks.set(id, promise);
    healthQueue.push({ id, resolve: resolvePromise, reject: rejectPromise });
    drainHealthQueue();
    return promise;
  }

  async function executeHealthCheck(id) {
    const publicRecord = await store.get(id);
    if (!publicRecord) throw new Error('Proxy record not found');
    await store.saveHealth(id, { health: 'checking' });
    const runtime = await store.getRuntimeProxy(id);
    let result;
    try {
      // Strict proxy mode: health checks themselves use only the configured proxy.
      // Do not discover or contact the host's direct public route.
      result = await healthChecker.checkProxy(runtime, undefined);
    } catch (cause) {
      const checkedAtMs = now();
      result = {
        ...classifyProxyHealth({ ok: false, failureCount: runtime.failureCount || 0, checkedAtMs }),
        checkedAt: new Date(checkedAtMs).toISOString(),
        error: redactSecrets(cause instanceof Error ? cause.message : String(cause), [runtime.username, runtime.password]),
      };
    }

    const saved = await store.saveHealth(id, result);
    const safeError = result.error ? redactSecrets(result.error, [runtime.username, runtime.password]) : '';
    if (saved.health === 'live') addActivity('success', `${safeEndpoint(saved)} verified${saved.latencyMs != null ? ` in ${saved.latencyMs} ms` : ''}`, id);
    else if (saved.health === 'slow') addActivity('warning', `${safeEndpoint(saved)} is slow${saved.latencyMs != null ? ` at ${saved.latencyMs} ms` : ''}`, id);
    else addActivity('error', `${safeEndpoint(saved)} health check failed${safeError ? `: ${safeError}` : ''}`, id);
    if (saved.staticIpChangePending) addActivity('warning', `${safeEndpoint(saved)} changed static exit IP; automatic allocation paused`, id);
    return saved;
  }

  async function checkMany(ids) {
    return Promise.all((ids || []).map((id) => check(id)));
  }

  async function recheckDead() {
    const records = await store.list();
    const ids = records.filter((r) => r.enabled && (r.health === 'dead' || r.health === 'unavailable')).map((r) => r.id);
    return checkMany(ids);
  }

  function isStale(record) {
    const checked = record.lastCheckedAt ? Date.parse(record.lastCheckedAt) : 0;
    return !checked || now() - checked > STALE_AFTER_MS;
  }

  function eligibleBase(record, kind, allowSlow = false) {
    const healthEligible = record.health === 'live' || (allowSlow && record.health === 'slow');
    return record.kind === kind && record.enabled && healthEligible && !record.staticIpChangePending;
  }

  function reservationScope(options = {}) {
    const scope=String(options.reservationScope||'global').trim().toLowerCase();
    return scope||'global';
  }
  function reservationKey(proxyId, options = {}) { return `${reservationScope(options)}::${String(proxyId)}`; }
  function isReserved(proxyId, options = {}) { return reservations.has(reservationKey(proxyId, options)); }

  function shuffleRecords(records) {
    const out=[...records];
    for(let i=out.length-1;i>0;i--){
      const raw=Number(random());
      const unit=Number.isFinite(raw)?Math.min(0.999999999999,Math.max(0,raw)):Math.random();
      const j=Math.floor(unit*(i+1));
      [out[i],out[j]]=[out[j],out[i]];
    }
    return out;
  }

  function staticStrengthBuckets(records) {
    const latency = (record) => Number.isFinite(Number(record?.latencyMs)) ? Number(record.latencyMs) : Number.POSITIVE_INFINITY;
    const failures = (record) => Math.max(0, Number(record?.failureCount) || 0);
    const live=[...records.filter(record=>record.health==='live')].sort((a,b)=>failures(a)-failures(b)||latency(a)-latency(b));
    const slow=[...records.filter(record=>record.health==='slow')].sort((a,b)=>failures(a)-failures(b)||latency(a)-latency(b));
    // Prefer the strongest ~70% of LIVE routes first, but still consume every eligible
    // LIVE/SLOW static proxy once before beginning a new cycle.
    const strongCount=live.length?Math.max(1,Math.ceil(live.length*0.70)):0;
    if(live.length){
      return [
        ...shuffleRecords(live.slice(0,strongCount)),
        ...shuffleRecords(live.slice(strongCount)),
      ];
    }
    return shuffleRecords(slow);
  }

  function staticCycleKey(options = {}) {
    return String(options.rotationScope||options.reservationScope||'global').trim().toLowerCase()||'global';
  }

  function staticCycleCandidates(records, options = {}) {
    const key=staticCycleKey(options);
    const signature=records.map(record=>`${record.id}:${record.health}:${record.latencyMs??''}:${record.failureCount??0}`).sort().join('|');
    let cycle=staticCycles.get(key);
    if(!cycle||cycle.signature!==signature||!Array.isArray(cycle.remainingIds)||cycle.remainingIds.length===0){
      const ordered=staticStrengthBuckets(records);
      cycle={signature,remainingIds:ordered.map(record=>String(record.id)),cycleNumber:(cycle?.cycleNumber||0)+1};
      staticCycles.set(key,cycle);
    }
    const byId=new Map(records.map(record=>[String(record.id),record]));
    return cycle.remainingIds.map(id=>byId.get(String(id))).filter(Boolean);
  }

  function consumeStaticCycleCandidate(record, options = {}) {
    if(options.selectionPolicy!=='healthy-random-cycle'||!record)return;
    const key=staticCycleKey(options);
    const cycle=staticCycles.get(key);
    if(!cycle)return;
    cycle.remainingIds=cycle.remainingIds.filter(id=>String(id)!==String(record.id));
  }

  function orderCandidates(records, kind, options = {}) {
    if (kind === 'static') {
      const unreserved=options.allowSharedStatic?[...records]:[...records].filter((record) => !isReserved(record.id, options));
      return unreserved.sort((a, b) => (Date.parse(a.lastUsedAt || '') || 0) - (Date.parse(b.lastUsedAt || '') || 0));
    }
    if (!records.length) return [];
    const start = rotatingCursor.value % records.length;
    return [...records.slice(start), ...records.slice(0, start)];
  }

  async function allocateSingle(kind, owner, options = {}) {
    if (!['rotating','static'].includes(kind)) throw new Error('Proxy pool kind must be rotating or static');
    // Verified-slow routes are an automatic fallback after LIVE routes.
    // Callers no longer need an opt-in flag; ordering below still prefers LIVE first.
    const allowSlow = true;
    const all = await store.list(kind);
    const excludedProxyIds = new Set(Array.isArray(options.excludeProxyIds)?options.excludeProxyIds.map(String):[]);
    const base = all.filter((record) => record.source !== 'fetched-free' && eligibleBase(record, kind, allowSlow) && !excludedProxyIds.has(String(record.id)));
    const preferredProxyId = kind === 'static' ? String(options.preferredProxyId || '') : '';
    let ordered;
    if(kind==='static'&&options.selectionPolicy==='healthy-random-cycle'){
      ordered=staticCycleCandidates(base,options).filter(record=>!isReserved(record.id,options));
    }else{
      const liveCandidates = orderCandidates(base.filter((record) => record.health === 'live'), kind, options);
      const slowCandidates = allowSlow ? orderCandidates(base.filter((record) => record.health === 'slow'), kind, options) : [];
      ordered = [...liveCandidates, ...slowCandidates];
    }
    if (preferredProxyId) {
      const preferred = ordered.find((record) => record.id === preferredProxyId);
      if (preferred) ordered = [preferred, ...ordered.filter((record) => record.id !== preferredProxyId)];
    }

    for (const candidate of ordered) {
      let current = candidate;
      // Every production proxy allocation must carry verified country + timezone metadata.
      // Rotating gateways are rechecked on each allocation because their exit/location can change.
      if (isStale(current) || !current.countryCode || !current.timezoneId) {
        current = await check(current.id);
        if (!eligibleBase(current, kind, allowSlow)) continue;
        if (!current.countryCode || !current.timezoneId) {
          addActivity('warning', `${safeEndpoint(current)} has no verified proxy location/timezone; allocation blocked`, current.id);
          continue;
        }
        if (kind === 'static' && !options.allowSharedStatic && isReserved(current.id, options)) continue;
      }
      const runtime = await store.getRuntimeProxy(current.id);
      const allocationId = String(owner || randomUUID());
      if (kind === 'static') {
        if (!options.allowSharedStatic && isReserved(current.id, options)) continue;
        if(!options.allowSharedStatic)reservations.set(reservationKey(current.id, options), { allocationId, proxyId:current.id, scope:reservationScope(options) });
        consumeStaticCycleCandidate(current,options);
        await store.markUsed(current.id, nowIso());
      } else {
        const index = base.findIndex((record) => record.id === current.id);
        if (index >= 0) rotatingCursor.value = (index + 1) % Math.max(base.length, 1);
      }
      beginProxyAllocation(allocationId,{proxyId:current.id,kind,observedIp:current.observedIp,countryCode:current.countryCode,country:current.country,region:current.region,city:current.city,latitude:current.latitude,longitude:current.longitude,timezoneId:current.timezoneId});
      addActivity('success', `Allocated ${safeEndpoint(current)} to QA session`, current.id);
      return {
        allocationId,
        geoVerified:true,
        proxyId: current.id,
        proxyKind: kind,
        countryCode: current.countryCode,
        country: current.country || '',
        region: current.region || '',
        city: current.city || '',
        latitude: Number.isFinite(Number(current.latitude)) ? Number(current.latitude) : undefined,
        longitude: Number.isFinite(Number(current.longitude)) ? Number(current.longitude) : undefined,
        timezoneId: current.timezoneId,
        observedIp: current.observedIp || '',
        server: toProxyServer(runtime),
        username: runtime.username || '',
        password: runtime.password || '',
        requireVerifiedRoute: true,
      };
    }

    throw new Error(`No eligible ${kind} proxy is available`);
  }

  async function hasEligibleKind(kind, options = {}) {
    const records = await store.list(kind);
    return records.some((record) => {
      if (record.source === 'fetched-free') return false;
      if (!eligibleBase(record, kind, true)) return false;
      if (kind === 'static' && isReserved(record.id, options)) return false;
      return true;
    });
  }

  async function allocate(kind, owner, options = {}) {
    if (kind === 'rotating' || kind === 'static') return allocateSingle(kind, owner, options);
    if (kind !== 'smart-mix') throw new Error('Proxy pool kind must be rotating or static, or smart-mix');

    const [rotatingAvailable, staticAvailable] = await Promise.all([
      hasEligibleKind('rotating', options),
      hasEligibleKind('static', options),
    ]);
    if (!rotatingAvailable && !staticAvailable) throw new Error('No eligible proxy is available in Smart Mix');

    const order = rotatingAvailable && staticAvailable
      ? (random() < 0.5 ? ['rotating', 'static'] : ['static', 'rotating'])
      : rotatingAvailable ? ['rotating'] : ['static'];

    let lastNoEligibleError = null;
    for (const selectedKind of order) {
      try {
        const allocation = await allocateSingle(selectedKind, owner, { ...options, allowSlow: true });
        addActivity('success', `Smart Mix selected ${selectedKind === 'rotating' ? 'Rotating Pool' : 'Static Pool'} for QA session`, allocation.proxyId);
        return allocation;
      } catch (error) {
        if (!/No eligible (rotating|static) proxy is available/i.test(String(error?.message || error))) throw error;
        lastNoEligibleError = error;
      }
    }
    throw lastNoEligibleError || new Error('No eligible proxy is available in Smart Mix');
  }

  async function release(allocationId) {
    endProxyAllocation(allocationId);
    for (const [key, reservation] of reservations.entries()) {
      if (reservation?.allocationId === allocationId) {
        reservations.delete(key);
        addActivity('info', 'Released static proxy reservation', reservation.proxyId);
      }
    }
  }

  async function confirmRotatingGatewayAfterRuntimeFailure(proxyId, record, runtime, safeMessage) {
    if (runtimeConfirmations.has(proxyId)) return runtimeConfirmations.get(proxyId);
    const confirmation = Promise.resolve().then(async () => {
      addActivity('warning', `${safeEndpoint(record)} rotating session route failed; confirming the shared gateway on a fresh route before changing pool health: ${safeMessage}`, proxyId);
      let result;
      try {
        // Fresh rotating confirmation is proxy-only; never probe the host direct route.
        result = await healthChecker.checkProxy(runtime, undefined);
      } catch (cause) {
        const checkedAtMs = now();
        result = {
          ...classifyProxyHealth({ ok:false, failureCount:record.failureCount || 0, checkedAtMs }),
          checkedAt:new Date(checkedAtMs).toISOString(),
          error:redactSecrets(cause instanceof Error ? cause.message : String(cause), [runtime.username, runtime.password]),
        };
      }
      if (result.health === 'live' || result.health === 'slow') {
        const saved = await store.saveHealth(proxyId, result);
        if (saved.health === 'live') addActivity('success', `${safeEndpoint(saved)} rotating gateway remained healthy on a fresh confirmation route`, proxyId);
        else addActivity('warning', `${safeEndpoint(saved)} rotating gateway confirmed but is slow`, proxyId);
        return saved;
      }

      // One failed provider exit must not poison a shared rotating gateway for
      // every concurrent work unit. Keep the last verified gateway health and
      // schedule an earlier normal health check; per-work-unit route verification
      // still fails closed and retries with a fresh route.
      const nextCheckAt = new Date(now() + FIRST_DEAD_RETRY_MS).toISOString();
      const preserved = typeof store.update === 'function'
        ? await store.update(proxyId, { nextCheckAt })
        : record;
      addActivity('warning', `${safeEndpoint(record)} fresh rotating confirmation route also failed; shared gateway health preserved and an early recheck was scheduled`, proxyId);
      return preserved;
    }).finally(() => runtimeConfirmations.delete(proxyId));
    runtimeConfirmations.set(proxyId, confirmation);
    return confirmation;
  }

  async function reportRuntimeFailure(proxyId, message) {
    const record = await store.get(proxyId);
    if (!record) return;
    let runtime = record;
    try { runtime = await store.getRuntimeProxy(proxyId); } catch {}
    const safeMessage = redactSecrets(message, [runtime.username, runtime.password]);

    // A rotating gateway can yield a bad exit/session while the gateway itself
    // remains healthy. Do not poison the shared rotating pool from one work
    // unit's route failure; confirm the gateway using a fresh provider route.
    if (record.kind === 'rotating') {
      await confirmRotatingGatewayAfterRuntimeFailure(proxyId, record, runtime, safeMessage);
      return;
    }

    const checkedAtMs = now();
    const result = {
      ...classifyProxyHealth({ ok: false, failureCount: record.failureCount || 0, checkedAtMs }),
      checkedAt: new Date(checkedAtMs).toISOString(),
    };
    await store.saveHealth(proxyId, result);
    addActivity('error', `${safeEndpoint(record)} runtime failure: ${safeMessage}`, proxyId);
  }

  async function exportSafe({ kind, includeUsernames = false } = {}) {
    const records = await store.list(kind);
    return records.map((record) => {
      const auth = includeUsernames && record.username ? `${record.username}@` : '';
      return `${record.protocol}://${auth}${record.hostname}:${record.port}`;
    }).join('\n');
  }

  function getActivity() {
    return activity.map((entry) => ({ ...entry }));
  }

  async function runDueChecks() {
    if (stopped) return;
    const records = (await store.list()).filter((record) => record.source !== 'fetched-free');
    const current = now();
    const due = records.filter((record) => {
      if (!record.enabled || record.health === 'checking') return false;
      if (record.health === 'pending') return true;
      const next = record.nextCheckAt ? Date.parse(record.nextCheckAt) : 0;
      return next > 0 && next <= current;
    });
    if (due.length) await checkMany(due.map((record) => record.id)).catch(() => undefined);
  }

  function scheduleNext(delay = SCHEDULER_TICK_MS) {
    if (stopped) return;
    timer = setTimer(async () => {
      timer = null;
      if (stopped) return;
      await runDueChecks();
      scheduleNext(SCHEDULER_TICK_MS);
    }, delay);
  }

  function start() {
    if (!stopped) return;
    stopped = false;
    scheduleNext(0);
  }

  function stop() {
    stopped = true;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  return {
    list,
    getSummary,
    getDirectIp,
    importText,
    update,
    remove,
    setEnabled,
    check,
    checkMany,
    recheckDead,
    exportSafe,
    getActivity,
    acceptStaticIp,
    allocate,
    release,
    reportRuntimeFailure,
    start,
    stop,
  };
}

module.exports = { createProxyPoolService, HEALTH_CONCURRENCY, STALE_AFTER_MS };
