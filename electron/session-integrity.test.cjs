const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSessionIntegrityReport } = require('./session-integrity.cjs');

function verifiedRoute(ip = '203.0.113.20') {
  return { directIp: '198.51.100.10', proxiedIp: ip, error: null };
}

test('session integrity uses profile consistency rather than host runtime disclosure', () => {
  const report = buildSessionIntegrityReport({
    proxySource: 'none', proxyRequired: false,
    privacyReport: { webRtcPolicy: 'unsupported', observed: { webRtcSupported: false, literalIpCandidates: [], locale: 'en-US', timezoneId: 'UTC' } },
    identityReport: { profileConsistency: 'pass', overall: 'warning', blocked: false, profile: 'iPhone 13', runtimeFacts: [{ status: 'warning' }] },
  });
  assert.equal(report.checks.find((check) => check.key === 'device-consistency').status, 'pass');
});

test('session integrity blocks required proxy when WebRTC policy reports direct-IP exposure', () => {
  const report = buildSessionIntegrityReport({
    proxySource: 'static', proxyRequired: true, initialRoute: verifiedRoute(), finalRoute: verifiedRoute(),
    privacyReport: { webRtcPolicy: 'exposed', observed: { webRtcSupported: true, literalIpCandidates: ['198.51.100.10'], locale: 'en-US', timezoneId: 'UTC' } },
    identityReport: { profileConsistency: 'pass', blocked: false, profile: 'Pixel 7' },
  });
  const check = report.checks.find((item) => item.key === 'webrtc-ip-exposure');
  assert.equal(check.status, 'fail');
  assert.equal(check.required, true);
  assert.equal(report.blocked, true);
});

test('session integrity treats verified-no-leak as pass and unsupported as not applicable', () => {
  const verified = buildSessionIntegrityReport({
    proxySource: 'static', proxyRequired: true, initialRoute: verifiedRoute(), finalRoute: verifiedRoute(),
    privacyReport: { webRtcPolicy: 'verified-no-leak', observed: { webRtcSupported: true, literalIpCandidates: [], locale: 'en-US', timezoneId: 'UTC' } },
    identityReport: { profileConsistency: 'pass', blocked: false, profile: 'Pixel 7' },
  });
  assert.equal(verified.checks.find((item) => item.key === 'webrtc-ip-exposure').status, 'pass');

  const unsupported = buildSessionIntegrityReport({
    proxySource: 'none', proxyRequired: false,
    privacyReport: { webRtcPolicy: 'unsupported', observed: { webRtcSupported: false, literalIpCandidates: [], locale: 'en-US', timezoneId: 'UTC' } },
    identityReport: { profileConsistency: 'pass', blocked: false, profile: 'Desktop' },
  });
  assert.equal(unsupported.checks.find((item) => item.key === 'webrtc-ip-exposure').status, 'not-applicable');
});

