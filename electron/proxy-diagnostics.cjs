const net = require('node:net');

function normalizeProxySettings(input = {}) {
  const raw = input && typeof input === 'object' ? input : {};
  return {
    enabled: raw.enabled === true,
    server: String(raw.server || '').trim(),
    username: String(raw.username || ''),
    password: String(raw.password || ''),
    requireVerifiedRoute: raw.requireVerifiedRoute === true,
    routeCheckUrl: String(raw.routeCheckUrl || '').trim(),
  };
}

function redactSecrets(value, secrets = []) {
  let output = String(value ?? '');
  for (const secret of secrets.filter(Boolean)) {
    const raw = String(secret);
    output = output.split(raw).join('[REDACTED]');
    try {
      const encoded = encodeURIComponent(raw);
      if (encoded !== raw) output = output.split(encoded).join('[REDACTED]');
    } catch {}
  }
  output = output.replace(/\/\/([^/@:\s]+):([^/@\s]+)@/g, '//[REDACTED]:[REDACTED]@');
  output = output.replace(/\b([A-Za-z0-9.-]+:\d+):([^:\s]+):([^\s]+)/g, '$1:[REDACTED]:[REDACTED]');
  return output;
}

function parseObservedIp(payload) {
  const text = String(payload ?? '').trim();
  let candidate = text;
  try {
    const parsed = JSON.parse(text);
    candidate = typeof parsed?.ip === 'string' ? parsed.ip.trim() : '';
  } catch {}
  return net.isIP(candidate) ? candidate : '';
}

function assessProxyRoute({ enabled, requireVerifiedRoute, directIp, proxiedIp, error }) {
  if (!enabled) {
    return {
      route: { key: 'proxy-route', label: 'Proxy route', status: 'not-applicable', required: false, detail: 'No proxy configured.' },
      fallback: { key: 'direct-fallback', label: 'Direct-connection fallback', status: 'not-applicable', required: false, detail: 'No proxy configured.' },
    };
  }
  if (error || !proxiedIp) {
    return {
      route: { key: 'proxy-route', label: 'Proxy route', status: requireVerifiedRoute ? 'fail' : 'warning', required: requireVerifiedRoute, detail: 'Proxy route could not be verified.' },
      fallback: { key: 'direct-fallback', label: 'Direct-connection fallback', status: requireVerifiedRoute ? 'fail' : 'warning', required: requireVerifiedRoute, detail: 'The required proxy route did not verify; the session must stop rather than use direct networking.' },
    };
  }
  if (directIp && directIp === proxiedIp) {
    return {
      route: { key: 'proxy-route', label: 'Proxy route', status: 'fail', required: true, expected: 'Traffic through assigned proxy', observed: proxiedIp, detail: 'Observed route equals a previously-known host direct route.' },
      fallback: { key: 'direct-fallback', label: 'Direct-connection fallback', status: 'fail', required: true, expected: 'Fail closed', observed: 'Detected' },
    };
  }
  return {
    route: {
      key: 'proxy-route', label: 'Proxy route', status: 'pass', required: true,
      expected: 'Traffic through assigned proxy', observed: proxiedIp,
      detail: 'Observed from inside the proxy-configured browser/request context. Host direct-IP probing is disabled in proxy mode.',
    },
    fallback: {
      key: 'direct-fallback', label: 'Direct-connection fallback', status: 'pass', required: true,
      expected: 'Fail closed', observed: 'Direct fallback disabled',
      detail: 'If the assigned proxy cannot be used, the proxied operation fails instead of retrying on the host route.',
    },
  };
}

async function fetchIp(fetcher, url) {
  const response = await fetcher(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`route check returned HTTP ${response.status}`);
  const observedIp = parseObservedIp(await response.text());
  if (!observedIp) throw new Error('route check returned an invalid IP response');
  return observedIp;
}

async function verifyProxyRoute({ playwrightRequest, proxy, routeCheckUrl }) {
  const secrets = [proxy.username, proxy.password];
  try {
    const context = await playwrightRequest.newContext({
      proxy: {
        server: proxy.server,
        username: proxy.username || undefined,
        password: proxy.password || undefined,
      },
    });
    try {
      const response = await context.get(routeCheckUrl, { timeout: 15000 });
      if (!response.ok()) throw new Error(`route check returned HTTP ${response.status()}`);
      const proxiedIp = parseObservedIp(await response.text());
      if (!proxiedIp) throw new Error('route check returned an invalid IP response');
      return { directIp: undefined, proxiedIp, error: null };
    } finally {
      await context.dispose();
    }
  } catch (cause) {
    return {
      directIp: undefined,
      proxiedIp: undefined,
      error: redactSecrets(cause instanceof Error ? cause.message : String(cause), secrets),
    };
  }
}

module.exports = { normalizeProxySettings, redactSecrets, parseObservedIp, assessProxyRoute, verifyProxyRoute };
