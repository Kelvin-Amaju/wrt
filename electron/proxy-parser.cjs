const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'socks5:']);
const SUPPORTED_KINDS = new Set(['rotating', 'static']);

function normalizeKind(kind) {
  const value = String(kind || 'rotating').trim();
  if (!SUPPORTED_KINDS.has(value)) throw new Error('Proxy kind must be rotating or static');
  return value;
}

function validatePort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

function normalizeProtocol(protocol) {
  const value = String(protocol || 'http').trim().toLowerCase();
  if (value === 'socks' || value === 'socks5h') return 'socks5';
  return value.replace(/:$/, '');
}

function decodePart(value) {
  try { return decodeURIComponent(String(value || '')); } catch { return String(value || ''); }
}

function parseEndpoint(endpoint) {
  const raw = String(endpoint || '').trim();
  if (!raw) return null;

  // Bracketed IPv6: [2001:db8::1]:8080
  if (raw.startsWith('[')) {
    const close = raw.indexOf(']');
    if (close < 0 || raw[close + 1] !== ':') return null;
    const hostname = raw.slice(1, close).trim();
    const port = validatePort(raw.slice(close + 2));
    return hostname && port ? { hostname, port } : null;
  }

  const colon = raw.lastIndexOf(':');
  if (colon <= 0) return null;
  const hostname = raw.slice(0, colon).trim();
  const port = validatePort(raw.slice(colon + 1));
  if (!hostname || !port || /[\s/@]/.test(hostname)) return null;
  return { hostname, port };
}

function parseAuthAtEndpoint(raw) {
  const at = raw.lastIndexOf('@');
  if (at <= 0) return null;
  const auth = raw.slice(0, at);
  const endpoint = parseEndpoint(raw.slice(at + 1));
  if (!endpoint) return null;
  const colon = auth.indexOf(':');
  if (colon <= 0) return null;
  return {
    ...endpoint,
    username: decodePart(auth.slice(0, colon).trim()),
    password: decodePart(auth.slice(colon + 1)),
  };
}

function parseHostPortCredentials(raw) {
  // Common vendor format: host:port:user:password. Password may itself contain colons.
  // Bracketed IPv6 is also accepted: [2001:db8::1]:8080:user:password.
  let hostPart;
  let rest;
  if (raw.startsWith('[')) {
    const close = raw.indexOf(']');
    if (close < 0 || raw[close + 1] !== ':') return null;
    hostPart = raw.slice(0, close + 1);
    rest = raw.slice(close + 2);
  } else {
    const firstColon = raw.indexOf(':');
    if (firstColon <= 0) return null;
    hostPart = raw.slice(0, firstColon);
    rest = raw.slice(firstColon + 1);
  }

  const portColon = rest.indexOf(':');
  if (portColon < 0) {
    return parseEndpoint(`${hostPart}:${rest}`);
  }

  const portText = rest.slice(0, portColon);
  const auth = rest.slice(portColon + 1);
  const authColon = auth.indexOf(':');
  if (authColon <= 0) return null;
  const endpoint = parseEndpoint(`${hostPart}:${portText}`);
  if (!endpoint) return null;
  return {
    ...endpoint,
    username: decodePart(auth.slice(0, authColon).trim()),
    password: decodePart(auth.slice(authColon + 1)),
  };
}

function parseProxyLine(line, defaultKind = 'rotating') {
  const raw = String(line ?? '').trim();
  if (!raw) return { ok: false, error: 'Proxy line is empty' };

  let kind;
  try {
    kind = normalizeKind(defaultKind);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  try {
    if (raw.includes('://')) {
      const schemeEnd = raw.indexOf('://');
      const requestedProtocol = normalizeProtocol(raw.slice(0, schemeEnd));
      if (!SUPPORTED_PROTOCOLS.has(`${requestedProtocol}:`)) {
        return { ok: false, error: 'Proxy protocol must be http, https, or socks5' };
      }
      const normalizedRaw = `${requestedProtocol}://${raw.slice(schemeEnd + 3)}`;
      const url = new URL(normalizedRaw);
      const port = validatePort(url.port);
      if (!url.hostname || !port) return { ok: false, error: 'Proxy host and port are required' };
      return {
        ok: true,
        value: {
          kind,
          protocol: requestedProtocol,
          hostname: url.hostname.startsWith('[') && url.hostname.endsWith(']') ? url.hostname.slice(1, -1) : url.hostname,
          port,
          username: decodePart(url.username || ''),
          password: decodePart(url.password || ''),
        },
      };
    }

    // Common authenticated vendor form: user:pass@host:port.
    const authAt = raw.includes('@') ? parseAuthAtEndpoint(raw) : null;
    if (authAt) {
      return { ok: true, value: { kind, protocol: 'http', ...authAt } };
    }

    // Common forms: host:port and host:port:user:pass.
    const endpoint = parseHostPortCredentials(raw);
    if (!endpoint) {
      return { ok: false, error: 'Use host:port, host:port:user:pass, user:pass@host:port, or a full proxy URL' };
    }
    return {
      ok: true,
      value: {
        kind,
        protocol: 'http',
        hostname: endpoint.hostname,
        port: endpoint.port,
        username: endpoint.username || '',
        password: endpoint.password || '',
      },
    };
  } catch {
    return { ok: false, error: 'Proxy line is malformed' };
  }
}

function parseProxyImport(text, defaultKind = 'rotating') {
  const accepted = [];
  const invalid = [];
  for (const sourceLine of String(text ?? '').split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line) continue;
    const parsed = parseProxyLine(line, defaultKind);
    if (parsed.ok) accepted.push({ ...parsed.value, sourceLine: line });
    else invalid.push({ line, error: parsed.error });
  }
  return { accepted, invalid };
}

function proxyIdentity(record) {
  return [
    String(record.protocol || '').toLowerCase(),
    String(record.hostname || '').toLowerCase(),
    Number(record.port) || 0,
    String(record.username || ''),
  ].join('|');
}

function formatProxyHost(hostname) {
  const host = String(hostname || '');
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function toProxyServer(record) {
  return `${record.protocol}://${formatProxyHost(record.hostname)}:${record.port}`;
}

module.exports = {
  parseProxyLine,
  parseProxyImport,
  proxyIdentity,
  toProxyServer,
};
