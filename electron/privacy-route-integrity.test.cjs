const test = require('node:test');
const assert = require('node:assert/strict');

function mod(){ return require('./privacy-route-integrity.cjs'); }
const passAssessment = { route:{ status:'pass' }, fallback:{ status:'pass' } };
const failAssessment = { route:{ status:'fail' }, fallback:{ status:'fail' } };
const route = (directIp='9.9.9.9', proxiedIp='8.8.8.8') => ({ directIp, proxiedIp });

function base(overrides={}) {
  return {
    phase:'pre-navigation', deviceMode:'desktop', strictMode:true,
    proxySource:'manual', proxyRequired:true,
    initialRoute:route(), initialRouteAssessment:passAssessment,
    runtimeVerification:{ verificationLabel:'VERIFIED GOOGLE CHROME' },
    runtimeLabel:'Google Chrome', observedAt:'2026-09-19T10:00:00Z', ...overrides,
  };
}

test('required proxy with verified different exit route passes pre-navigation route gate', () => {
  const { buildPrivacyRouteIntegrityReport, shouldBlockPrivacyRouteIntegrity } = mod();
  const report = buildPrivacyRouteIntegrityReport(base());
  assert.equal(report.overallStatus, 'pass');
  assert.equal(report.checks.find(c=>c.key==='proxy-exit-route').status, 'pass');
  assert.equal(shouldBlockPrivacyRouteIntegrity(report), false);
});

test('required proxy matching host direct IP fails', () => {
  const { buildPrivacyRouteIntegrityReport, shouldBlockPrivacyRouteIntegrity } = mod();
  const report = buildPrivacyRouteIntegrityReport(base({ initialRoute:route('8.8.8.8','8.8.8.8'), initialRouteAssessment:failAssessment }));
  assert.equal(report.overallStatus, 'fail');
  assert.equal(report.checks.find(c=>c.key==='direct-ip-exposure').status, 'fail');
  assert.equal(shouldBlockPrivacyRouteIntegrity(report), true);
});

test('required proxy route probe error under strict privacy is NOT VERIFIED and blocks', () => {
  const { buildPrivacyRouteIntegrityReport, shouldBlockPrivacyRouteIntegrity } = mod();
  const report = buildPrivacyRouteIntegrityReport(base({ initialRoute:{ error:'timeout' }, initialRouteAssessment:null }));
  assert.equal(report.overallStatus, 'not-verified');
  assert.equal(report.checks.find(c=>c.key==='proxy-exit-route').status, 'not-verified');
  assert.equal(shouldBlockPrivacyRouteIntegrity(report), true);
});

test('pre-navigation does not invent permission or WebRTC PASS before those checks have run', () => {
  const { buildPrivacyRouteIntegrityReport } = mod();
  const report = buildPrivacyRouteIntegrityReport(base({ privacyReport:null }));
  assert.equal(report.checks.some(c=>['webrtc','camera','microphone','geolocation','notifications'].includes(c.key)), false);
});

test('WebRTC direct host IP exposure fails a required proxy before behavior', () => {
  const { buildPrivacyRouteIntegrityReport } = mod();
  const report = buildPrivacyRouteIntegrityReport(base({ phase:'pre-behavior', privacyReport:{ webRtcPolicy:'exposed', observed:{ literalIpCandidates:['9.9.9.9'], permissionStates:{ camera:'denied', microphone:'denied', geolocation:'denied', notifications:'denied' } } } }));
  assert.equal(report.checks.find(c=>c.key==='webrtc').status, 'fail');
  assert.equal(report.overallStatus, 'fail');
});

test('indeterminate WebRTC under required strict privacy is NOT VERIFIED and blocks', () => {
  const { buildPrivacyRouteIntegrityReport, shouldBlockPrivacyRouteIntegrity } = mod();
  const report = buildPrivacyRouteIntegrityReport(base({ phase:'pre-behavior', privacyReport:{ webRtcPolicy:'indeterminate', observed:{ permissionStates:{ camera:'denied', microphone:'denied', geolocation:'denied', notifications:'denied' } } } }));
  assert.equal(report.checks.find(c=>c.key==='webrtc').status, 'not-verified');
  assert.equal(report.overallStatus, 'not-verified');
  assert.equal(shouldBlockPrivacyRouteIntegrity(report), true);
});

test('no-proxy run does not fail because host public route is observed', () => {
  const { buildPrivacyRouteIntegrityReport } = mod();
  const report = buildPrivacyRouteIntegrityReport(base({ proxySource:'none', proxyRequired:false, initialRoute:route('9.9.9.9','9.9.9.9'), initialRouteAssessment:failAssessment }));
  assert.notEqual(report.overallStatus, 'fail');
  assert.equal(report.checks.find(c=>c.key==='direct-ip-exposure').status, 'info');
});

test('verified rotating proxy may change exit IP post-behavior without being treated as leak', () => {
  const { buildPrivacyRouteIntegrityReport } = mod();
  const report = buildPrivacyRouteIntegrityReport(base({ phase:'post-behavior', proxySource:'rotating', finalRoute:route('9.9.9.9','1.1.1.1'), finalRouteAssessment:passAssessment }));
  assert.equal(report.checks.find(c=>c.key==='route-continuity').status, 'pass');
  assert.equal(report.overallStatus, 'pass');
});

test('required static/manual proxy changing verified exit IP post-behavior fails continuity', () => {
  const { buildPrivacyRouteIntegrityReport } = mod();
  const report = buildPrivacyRouteIntegrityReport(base({ phase:'post-behavior', finalRoute:route('9.9.9.9','1.1.1.1'), finalRouteAssessment:passAssessment }));
  assert.equal(report.checks.find(c=>c.key==='route-continuity').status, 'fail');
  assert.equal(report.overallStatus, 'fail');
});

test('unsupported WebRTC stays unsupported rather than pass', () => {
  const { buildPrivacyRouteIntegrityReport } = mod();
  const report = buildPrivacyRouteIntegrityReport(base({ phase:'pre-behavior', deviceMode:'ios-emulation', privacyReport:{ webRtcPolicy:'unsupported', observed:{ permissionStates:{ camera:'unsupported', microphone:'unsupported', geolocation:'unsupported', notifications:'unsupported' } } } }));
  assert.equal(report.checks.find(c=>c.key==='webrtc').status, 'unsupported');
});

test('Android AVD and Real iOS missing desktop probes remain unsupported/not-verified, not silently passed', () => {
  const { buildPrivacyRouteIntegrityReport } = mod();
  for (const deviceMode of ['android-avd','real-ios']) {
    const report = buildPrivacyRouteIntegrityReport(base({ phase:'pre-behavior', deviceMode, privacyReport:null }));
    assert.equal(report.checks.some(c=>c.key==='webrtc' && c.status==='pass'), false);
  }
});

test('DNS route integrity passes only when the required proxy transport route is verified', () => {
  const { buildPrivacyRouteIntegrityReport } = mod();
  const report = buildPrivacyRouteIntegrityReport(base());
  const dns = report.checks.find(c=>c.key==='dns-route-integrity');
  assert.equal(dns.status, 'pass');
  assert.equal(dns.verificationMethod, 'proxy-transport');
  assert.match(dns.detail, /does not claim the identity of an upstream resolver/i);
});

test('DNS route integrity is NOT VERIFIED when a required strict proxy route cannot be verified', () => {
  const { buildPrivacyRouteIntegrityReport, shouldBlockPrivacyRouteIntegrity } = mod();
  const report = buildPrivacyRouteIntegrityReport(base({ initialRoute:{ error:'timeout' }, initialRouteAssessment:null }));
  assert.equal(report.checks.find(c=>c.key==='dns-route-integrity').status, 'not-verified');
  assert.equal(shouldBlockPrivacyRouteIntegrity(report), true);
});

test('navigator.webdriver is reported as info and never converted into a blocking failure', () => {
  const { buildPrivacyRouteIntegrityReport, shouldBlockPrivacyRouteIntegrity } = mod();
  const report = buildPrivacyRouteIntegrityReport(base({ proxyRequired:false, proxySource:'none', identityReport:{ observed:{ webdriver:true } } }));
  const check = report.checks.find(c=>c.key==='automation-environment');
  assert.equal(check.status, 'info');
  assert.match(check.observed, /navigator\.webdriver=true/);
  assert.equal(shouldBlockPrivacyRouteIntegrity(report), false);
});
