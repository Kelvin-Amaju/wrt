const SUPPORTED = new Set(['http','https','socks5']);

function validHost(host) {
  const value = String(host || '').trim();
  return Boolean(value) && !/[\s/@]/.test(value);
}
function validPort(port) {
  const n = Number(port);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}
function identity(row) { return `${row.protocol}|${String(row.hostname).toLowerCase()}|${row.port}`; }
function dedupe(rows) {
  const map = new Map();
  for (const row of rows) if (row && !map.has(identity(row))) map.set(identity(row), row);
  return [...map.values()];
}
function parseCandidate(raw, source = 'fetched-free') {
  const text = String(raw || '').trim();
  if (!text) return null;
  try {
    const url = text.includes('://') ? new URL(text) : new URL(`http://${text}`);
    const protocol = url.protocol.replace(':','').toLowerCase();
    const explicitPort = url.port || text.match(/:(\d+)(?:\/|$)/)?.[1];
    const port = validPort(explicitPort);
    if (!SUPPORTED.has(protocol) || !validHost(url.hostname) || !port) return null;
    return { kind:'static', source:'fetched-free', provider:source, protocol, hostname:url.hostname, port, username:'', password:'', sourceLine:text };
  } catch { return null; }
}
function parseProxyScrapeText(text) {
  return dedupe(String(text || '').split(/\r?\n/).map((line)=>parseCandidate(line,'proxyscrape')).filter(Boolean));
}
function parseGeonodeJson(payload) {
  const rows = [];
  for (const item of Array.isArray(payload?.data) ? payload.data : []) {
    const protocol = (Array.isArray(item.protocols) ? item.protocols : [item.protocol]).map((p)=>String(p || '').toLowerCase()).find((p)=>SUPPORTED.has(p));
    const port = validPort(item.port);
    if (!protocol || !validHost(item.ip) || !port) continue;
    rows.push({ kind:'static', source:'fetched-free', provider:'geonode', protocol, hostname:String(item.ip).trim(), port, username:'', password:'', sourceLine:`${protocol}://${item.ip}:${port}` });
  }
  return dedupe(rows);
}
async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), timeoutMs);
  try { return await fetchImpl(url, { signal:controller.signal, headers:{ 'accept':'application/json,text/plain,*/*' } }); }
  finally { clearTimeout(timer); }
}
async function fetchFreeProxyCandidates({ fetchImpl = globalThis.fetch, timeoutMs = 8000, limit = 500 } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Fetch API is unavailable');
  const sources = [];
  const candidates = [];
  const tasks = [
    {
      name:'proxyscrape',
      url:'https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=protocolipport&format=text&timeout=20000',
      parse:async(res)=>parseProxyScrapeText(await res.text()),
    },
    {
      name:'geonode',
      url:`https://proxylist.geonode.com/api/proxy-list?limit=${Math.max(50,Math.min(500,Number(limit)||500))}&page=1&sort_by=lastChecked&sort_type=desc`,
      parse:async(res)=>parseGeonodeJson(JSON.parse(await res.text())),
    },
  ];
  await Promise.all(tasks.map(async(task)=>{
    try {
      const response = await fetchWithTimeout(fetchImpl, task.url, timeoutMs);
      if (!response?.ok) throw new Error(`HTTP ${response?.status || 'error'}`);
      const rows = await task.parse(response);
      candidates.push(...rows);
      sources.push({ source:task.name, ok:true, count:rows.length });
    } catch (error) {
      sources.push({ source:task.name, ok:false, count:0, error:error instanceof Error ? error.message : String(error) });
    }
  }));
  const cap = Math.max(1, Math.min(500, Number(limit) || 500));
  return { candidates:dedupe(candidates).slice(0, cap), sources, fetchedAt:new Date().toISOString() };
}
module.exports = { parseProxyScrapeText, parseGeonodeJson, fetchFreeProxyCandidates, parseCandidate };
