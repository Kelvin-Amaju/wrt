const test = require('node:test');
const assert = require('node:assert/strict');
const {
  redactSecrets,
  assessProxyRoute,
  parseObservedIp,
} = require('./proxy-diagnostics.cjs');

test('redacts proxy credentials from messages', () => {
  const message = 'proxy user alice password s3cr3t failed: http://alice:s3cr3t@proxy.test:8080';
  const redacted = redactSecrets(message, ['alice', 's3cr3t']);
  assert.equal(redacted.includes('alice'), false);
  assert.equal(redacted.includes('s3cr3t'), false);
  assert.match(redacted, /\[REDACTED\]/);
});

test('parses JSON and text IP observation responses', () => {
  assert.equal(parseObservedIp('{"ip":"203.0.113.10"}'), '203.0.113.10');
  assert.equal(parseObservedIp('2001:db8::10'), '2001:db8::10');
});

test('fails closed when proxy route matches the direct route', () => {
  const result = assessProxyRoute({
    enabled: true,
    requireVerifiedRoute: false,
    directIp: '203.0.113.10',
    proxiedIp: '203.0.113.10',
  });
  assert.equal(result.route.status, 'fail');
  assert.equal(result.fallback.status, 'fail');
});

test('warns when route service is unavailable unless verification is required', () => {
  const optional = assessProxyRoute({
    enabled: true,
    requireVerifiedRoute: false,
    error: 'route service unavailable',
  });
  assert.equal(optional.route.status, 'warning');

  const required = assessProxyRoute({
    enabled: true,
    requireVerifiedRoute: true,
    error: 'route service unavailable',
  });
  assert.equal(required.route.status, 'fail');
});

test('rejects non-IP route-check payloads instead of treating them as a route', () => {
  assert.equal(parseObservedIp('<html>temporary outage</html>'), '');
  assert.equal(parseObservedIp('{"ip":"not-an-ip"}'), '');
});

test('redacts colon-delimited and URL proxy passwords', () => {
  const input = 'failed http://alice:secret@proxy.test:8080 and proxy.test:8080:alice:secret';
  const safe = redactSecrets(input, ['alice', 'secret']);
  assert.equal(safe.includes('secret'), false);
  assert.equal(safe.includes('alice'), false);
  assert.match(safe, /proxy\.test:8080/);
});
