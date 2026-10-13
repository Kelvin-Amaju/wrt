const http = require('node:http');
const https = require('node:https');
const { parseObservedIp } = require('./proxy-diagnostics.cjs');

const DEFAULT_DIRECT_IP_ENDPOINTS = [
  'https://api64.ipify.org?format=json',
  'https://api.ipify.org?format=json',
  'https://checkip.amazonaws.com',
  'https://icanhazip.com',
  'https://ifconfig.me/ip',
];
const DEFAULT_TIMEOUT_MS = 7000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_REDIRECTS = 2;

function nativeRequestText(url, { timeoutMs = DEFAULT_TIMEOUT_MS, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch {
      reject(new Error('Direct route endpoint URL is invalid'));
      return;
    }
    const transport = parsed.protocol === 'https:' ? https : parsed.protocol === 'http:' ? http : null;
    if (!transport) {
      reject(new Error(`Unsupported direct route protocol: ${parsed.protocol}`));
      return;
    }

    const request = transport.request(parsed, {
      method: 'GET',
      headers: {
        accept: 'application/json,text/plain;q=0.9,*/*;q=0.1',
        'user-agent': 'OrbitQA-DirectRouteDiagnostic/1.0',
        'cache-control': 'no-cache',
      },
      agent: false,
    }, (response) => {
      const status = Number(response.statusCode || 0);
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) {
          reject(new Error('Direct route endpoint redirected too many times'));
          return;
        }
        const nextUrl = new URL(location, parsed).toString();
        nativeRequestText(nextUrl, { timeoutMs, redirects: redirects + 1 }).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Direct route endpoint returned HTTP ${status || 'unknown'}`));
        return;
      }

      const chunks = [];
      let bytes = 0;
      response.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 16 * 1024) {
          request.destroy(new Error('Direct route endpoint response was unexpectedly large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });

    request.setTimeout(Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS), () => {
      request.destroy(new Error('Direct route endpoint timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

function createDirectIpProvider({
  endpoints = DEFAULT_DIRECT_IP_ENDPOINTS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  now = Date.now,
  requestText = nativeRequestText,
} = {}) {
  if (typeof requestText !== 'function') throw new Error('A direct route request function is required');
  const urls = (Array.isArray(endpoints) ? endpoints : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  if (!urls.length) throw new Error('At least one direct IP endpoint is required');

  let cachedIp = '';
  let cachedAt = 0;
  let inFlight = null;

  async function probeDirectIp() {
    let lastError;
    for (const url of urls) {
      try {
        const payload = await requestText(url, { timeoutMs: Number(timeoutMs || DEFAULT_TIMEOUT_MS) });
        const observedIp = parseObservedIp(payload);
        if (!observedIp) throw new Error('Direct route endpoint returned an invalid IP response');
        cachedIp = observedIp;
        cachedAt = now();
        return observedIp;
      } catch (error) {
        lastError = error;
      }
    }

    const suffix = lastError instanceof Error && lastError.message ? `: ${lastError.message}` : '';
    throw new Error(`Direct route diagnostic unavailable after trying all configured IP endpoints${suffix}`);
  }

  return async function directIpProvider() {
    const currentTime = now();
    if (cachedIp && currentTime - cachedAt <= Number(cacheTtlMs || DEFAULT_CACHE_TTL_MS)) {
      return cachedIp;
    }
    if (inFlight) return inFlight;
    inFlight = probeDirectIp().finally(() => { inFlight = null; });
    return inFlight;
  };
}

module.exports = {
  createDirectIpProvider,
  nativeRequestText,
  DEFAULT_DIRECT_IP_ENDPOINTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_CACHE_TTL_MS,
};
