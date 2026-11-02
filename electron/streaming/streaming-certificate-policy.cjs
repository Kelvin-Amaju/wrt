'use strict';

// Streaming browsers run behind third-party proxies (Webshare and similar) and, on many
// Windows desktops, behind a local TLS-inspecting security product. Either can present a
// certificate whose CN/SAN does not match the requested host. Chromium reports that as
// ERR_CERT_COMMON_NAME_INVALID and refuses to load the page.
//
// Certificate identity is not a useful QA signal for a media session: route integrity is
// already enforced by exit-IP, timezone and locale verification. So certificate verification
// is relaxed for proxied streaming sessions, and a certificate fault is treated as a
// transient, retryable condition instead of a terminal session error.

const CERTIFICATE_ERROR_PATTERN =
  /ERR_CERT_[A-Z_]+|ERR_SSL_[A-Z_]+|ERR_BAD_SSL_CLIENT_AUTH_CERT|net::ERR_CERT|SSL certificate problem|certificate is not valid|CERT_AUTHORITY_INVALID|CERT_DATE_INVALID|CERT_COMMON_NAME_INVALID/i;

const CERTIFICATE_HINTS = {
  ERR_CERT_COMMON_NAME_INVALID:
    'the presented certificate belongs to a different hostname (proxy TLS interception or local TLS inspection)',
  ERR_CERT_AUTHORITY_INVALID:
    'the presented certificate was signed by an unknown authority (proxy or local TLS inspection)',
  ERR_CERT_DATE_INVALID:
    'the presented certificate is expired or not yet valid (local clock or proxy)',
  ERR_CERT_REVOKED: 'the presented certificate was revoked',
  ERR_CERT_INVALID: 'the presented certificate is invalid',
  ERR_SSL_PROTOCOL_ERROR: 'the TLS handshake with the target host failed',
  ERR_SSL_VERSION_OR_CIPHER_MISMATCH: 'no shared TLS version or cipher suite with the target host',
};

function isCertificateError(value) {
  const text = String(value?.message || value || '').trim();
  return Boolean(text) && CERTIFICATE_ERROR_PATTERN.test(text);
}

function certificateErrorCode(value) {
  const text = String(value?.message || value || '');
  const match = text.match(/ERR_CERT_[A-Z_]+|ERR_SSL_[A-Z_]+/);
  return match ? match[0] : '';
}

// Certificate verification must be relaxed at the browser process level, not only per page.
// Playwright's ignoreHTTPSErrors is applied through CDP Security.setIgnoreCertificateErrors on
// each page target; service workers and the browser-process media pipeline are separate targets
// and would keep rejecting the substituted certificate. Spotify uses both.
function certificateLaunchArgs({ proxyRequired = false } = {}) {
  return proxyRequired ? ['--ignore-certificate-errors'] : [];
}

function certificateContextOptions() {
  return { ignoreHTTPSErrors: true };
}

function describeCertificateError(value) {
  const code = certificateErrorCode(value);
  if (!code) return 'the browser could not verify the certificate for this host';
  const hint = CERTIFICATE_HINTS[code] || 'the certificate for this host could not be verified';
  return `${code} · ${hint}`;
}

// Captures the precise certificate failure from the DevTools protocol so the session can report
// which URL was rejected and with which code. Defensive: WebKit and older Chromium builds have no
// Security domain, and a failure here must never affect the session.
async function attachCertificateDiagnostics({ context, page, workId = '' } = {}) {
  const errors = [];
  let detach = () => {};
  if (!context || typeof context.newCDPSession !== 'function' || !page) {
    return { detach, errors, snapshot: () => [] };
  }
  try {
    const cdp = await context.newCDPSession(page);
    const onCertificateError = (event = {}) => {
      const code = String(event.errorType || '');
      const url = String(event.requestURL || '');
      if (!code && !url) return;
      if (errors.some((item) => item.code === code && item.url === url)) return;
      errors.push({ code, url, workId, at: new Date().toISOString(), hint: describeCertificateError(code) });
      if (errors.length > 40) errors.shift();
    };
    cdp.on('Security.certificateError', onCertificateError);
    await cdp.send('Security.enable').catch(() => undefined);
    detach = () => {
      try { cdp.off('Security.certificateError', onCertificateError); } catch {}
      try { cdp.send('Security.disable').catch(() => undefined); } catch {}
      try { cdp.detach().catch(() => undefined); } catch {}
    };
  } catch {
    detach = () => {};
  }
  return { detach, errors, snapshot: () => errors.map((item) => ({ ...item })) };
}

module.exports = {
  CERTIFICATE_ERROR_PATTERN,
  isCertificateError,
  certificateErrorCode,
  certificateLaunchArgs,
  certificateContextOptions,
  describeCertificateError,
  attachCertificateDiagnostics,
};