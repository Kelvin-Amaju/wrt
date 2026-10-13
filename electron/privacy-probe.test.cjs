const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {
  extractLiteralIpCandidates,
  buildPrivacyReport,
  collectPrivacyReport,
  installStrictPrivacyGuard,
  collectStrictPrivacyGuardState,
  assertStrictPrivacyGuard,
} = require('./privacy-probe.cjs');



test('installs the strict privacy guard only when strict mode is enabled', async () => {
  const scripts = [];
  const context = { addInitScript: async (script) => scripts.push(script) };

  await installStrictPrivacyGuard(context, true);
  assert.equal(scripts.length, 1);
  assert.equal(typeof scripts[0], 'function');

  await installStrictPrivacyGuard(context, false);
  assert.equal(scripts.length, 1);
});



test('strict privacy guard leaves WebRTC observable while blocking media, geolocation and notifications before site code', async () => {
  const scripts = [];
  const context = { addInitScript: async (script) => scripts.push(script) };
  await installStrictPrivacyGuard(context, true);

  class FakeNotification {}
  Object.defineProperty(FakeNotification, 'permission', { configurable: true, value: 'default' });
  FakeNotification.requestPermission = async () => 'granted';

  const sandbox = {
    DOMException,
    Notification: FakeNotification,
    RTCPeerConnection: function AllowedRtc() {},
    webkitRTCPeerConnection: function AllowedWebkitRtc() {},
    navigator: {
      mediaDevices: { getUserMedia: async () => 'allowed' },
      geolocation: {
        getCurrentPosition(success) { success({ coords: {} }); },
        watchPosition(success) { success({ coords: {} }); return 1; },
        clearWatch() {},
      },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`(${scripts[0].toString()})()`, sandbox);

  assert.doesNotThrow(() => new sandbox.RTCPeerConnection());
  await assert.rejects(
    () => sandbox.navigator.mediaDevices.getUserMedia({ video: true }),
    (error) => error?.name === 'NotAllowedError',
  );
  await new Promise((resolve, reject) => {
    sandbox.navigator.geolocation.getCurrentPosition(
      () => reject(new Error('geolocation unexpectedly succeeded')),
      (error) => {
        try {
          assert.equal(error.code, 1);
          resolve();
        } catch (assertionError) {
          reject(assertionError);
        }
      },
    );
  });
  assert.equal(await sandbox.Notification.requestPermission(), 'denied');
  assert.equal(sandbox.Notification.permission, 'denied');
});



test('reads the installed strict privacy guard state from the page', async () => {
  const scripts = [];
  const context = { addInitScript: async (script) => scripts.push(script) };
  await installStrictPrivacyGuard(context, true);

  class FakeNotification {}
  Object.defineProperty(FakeNotification, 'permission', { configurable: true, value: 'default' });
  FakeNotification.requestPermission = async () => 'granted';
  const sandbox = {
    DOMException,
    Notification: FakeNotification,
    RTCPeerConnection: function AllowedRtc() {},
    navigator: {
      mediaDevices: { getUserMedia: async () => 'allowed' },
      geolocation: {
        getCurrentPosition(success) { success({ coords: {} }); },
        watchPosition(success) { success({ coords: {} }); return 1; },
      },
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(`(${scripts[0].toString()})()`, sandbox);

  const page = {
    evaluate: async (fn) => JSON.parse(JSON.stringify(vm.runInContext(`(${fn.toString()})()`, sandbox))),
  };
  const state = await collectStrictPrivacyGuardState(page);
  assert.deepEqual(state, {
    webrtc: 'available',
    camera: 'denied',
    microphone: 'denied',
    geolocation: 'denied',
    notifications: 'denied',
  });
});



test('collectPrivacyReport uses enforced guard state in strict mode instead of native prompt permissions', async () => {
  const page = {
    evaluate: async (fn) => {
      const source = fn.toString();
      if (source.includes('userAgent: navigator.userAgent')) {
        return {
          userAgent: 'Mozilla/5.0 Chrome/153.0', platform: 'Win32', maxTouchPoints: 0,
          viewport: { width: 1280, height: 720 }, devicePixelRatio: 1,
          locale: 'en-US', timezoneId: 'UTC',
        };
      }
      if (source.includes("__orbitqaStrictBlocked")) {
        return {
          webrtc: 'available', camera: 'denied', microphone: 'denied',
          geolocation: 'denied', notifications: 'denied',
        };
      }
      if (source.includes('createDataChannel')) return { supported: true, candidates: [] };
      throw new Error('strict report unexpectedly queried an unguarded browser API');
    },
  };

  const report = await collectPrivacyReport({
    page,
    expected: { userAgentIncludes: 'Chrome', viewport: { width: 1280, height: 720 }, dpr: 1, locale: 'en-US', timezoneId: 'UTC' },
    proxyChecks: [],
    strictMode: true,
  });

  assert.equal(report.blocked, false);
  assert.equal(report.observed.webRtcBlocked, false);
  assert.equal(report.webRtcPolicy, 'verified-no-leak');
  assert.deepEqual(report.observed.permissionStates, {
    camera: 'denied', microphone: 'denied', geolocation: 'denied', notifications: 'denied',
  });
});



test('strict privacy verification fails closed when an available API is not blocked', async () => {
  const page = {
    evaluate: async () => ({
      webrtc: 'available', camera: 'prompt', microphone: 'denied',
      geolocation: 'denied', notifications: 'denied',
    }),
  };
  await assert.rejects(
    () => assertStrictPrivacyGuard(page, true),
    /camera/i,
  );
});

test('strict privacy verification accepts blocked or unsupported APIs', async () => {
  const page = {
    evaluate: async () => ({
      webrtc: 'available', camera: 'denied', microphone: 'denied',
      geolocation: 'unsupported', notifications: 'denied',
    }),
  };
  await assert.doesNotReject(() => assertStrictPrivacyGuard(page, true));
});

test('extracts literal IPv4 and IPv6 ICE candidates but not mDNS hosts', () => {
  const values = extractLiteralIpCandidates([
    'candidate:1 1 UDP 2122260223 192.168.1.20 51234 typ host',
    'candidate:2 1 UDP 2122260223 host-123.local 51235 typ host',
    'candidate:3 1 UDP 1686052607 2001:db8::20 60000 typ srflx',
  ]);
  assert.deepEqual(values, ['192.168.1.20', '2001:db8::20']);
});

test('strict privacy blocks WebRTC exposure when policy is exposed', () => {
  const report = buildPrivacyReport({
    expected: { userAgentIncludes: '', viewport: { width: 1280, height: 720 }, dpr: 1, locale: 'en-US', timezoneId: 'UTC' },
    observed: {
      userAgent: 'Mozilla/5.0', platform: 'Win32', maxTouchPoints: 0,
      viewport: { width: 1280, height: 720 }, devicePixelRatio: 1,
      locale: 'en-US', timezoneId: 'UTC', webRtcSupported: true, webRtcPolicy: 'exposed', literalIpCandidates: ['192.168.1.20'],
      permissionStates: { camera: 'denied', microphone: 'denied', geolocation: 'denied', notifications: 'denied' },
    },
    proxyChecks: [],
    strictMode: true,
    proxyRequired: true,
    permissionPolicy: { camera: 'not-granted', microphone: 'not-granted', geolocation: 'not-granted', notifications: 'not-granted' },
    startedAt: Date.now(),
  });
  assert.equal(report.blocked, true);
  assert.equal(report.checks.find((check) => check.key === 'webrtc').status, 'fail');
});



test('strict privacy accepts verified WebRTC no-leak state without hiding the API', () => {
  const report = buildPrivacyReport({
    expected: { userAgentIncludes: '', viewport: { width: 1280, height: 720 }, dpr: 1, locale: 'en-US', timezoneId: 'UTC' },
    observed: {
      userAgent: 'Mozilla/5.0', platform: 'Win32', maxTouchPoints: 0,
      viewport: { width: 1280, height: 720 }, devicePixelRatio: 1,
      locale: 'en-US', timezoneId: 'UTC', webRtcSupported: true, webRtcPolicy: 'verified-no-leak', literalIpCandidates: [],
      permissionStates: { camera: 'denied', microphone: 'denied', geolocation: 'denied', notifications: 'denied' },
    },
    proxyChecks: [], strictMode: true, proxyRequired: true,
    permissionPolicy: { camera: 'denied', microphone: 'denied', geolocation: 'denied', notifications: 'denied' },
    startedAt: Date.now(),
  });
  const check = report.checks.find((item) => item.key === 'webrtc');
  assert.equal(check.status, 'pass');
  assert.match(check.observed, /no direct-IP leak/i);
  assert.equal(report.blocked, false);
});


test('compatibility emulation reports navigator platform as host/runtime information instead of a warning', () => {
  const report = buildPrivacyReport({
    expected: {
      userAgentIncludes: 'Android',
      platformMode: 'host-info',
      viewport: { width: 412, height: 839 },
      dpr: 2.625,
      locale: 'en-US',
      timezoneId: 'UTC',
      touch: true,
    },
    observed: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/153.0 Mobile Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 1,
      viewport: { width: 412, height: 839 },
      devicePixelRatio: 2.625,
      locale: 'en-US',
      timezoneId: 'UTC',
      webRtcSupported: false,
      literalIpCandidates: [],
      permissionStates: { camera: 'denied', microphone: 'denied', geolocation: 'denied', notifications: 'denied' },
    },
    proxyChecks: [],
    strictMode: true,
    permissionPolicy: { camera: 'not-granted', microphone: 'not-granted', geolocation: 'not-granted', notifications: 'not-granted' },
    startedAt: Date.now(),
  });

  const platform = report.checks.find((check) => check.key === 'platform');
  assert.equal(platform.status, 'not-applicable');
  assert.match(platform.label, /host\/runtime/i);
  assert.equal(report.overall, 'pass');
});

test('known platform mismatch remains a warning and does not block', () => {
  const report = buildPrivacyReport({
    expected: { userAgentIncludes: 'iPhone', viewport: { width: 390, height: 844 }, dpr: 3, locale: 'en-US', timezoneId: 'UTC', touch: true, platformIncludes: 'iPhone' },
    observed: {
      userAgent: 'Mozilla/5.0 (iPhone)', platform: 'Win32', maxTouchPoints: 0,
      viewport: { width: 390, height: 844 }, devicePixelRatio: 3,
      locale: 'en-US', timezoneId: 'UTC', webRtcSupported: true, webRtcBlocked: true, literalIpCandidates: [],
      permissionStates: { camera: 'denied', microphone: 'denied', geolocation: 'denied', notifications: 'denied' },
    },
    proxyChecks: [],
    strictMode: true,
    permissionPolicy: { camera: 'not-granted', microphone: 'not-granted', geolocation: 'not-granted', notifications: 'not-granted' },
    startedAt: Date.now(),
  });
  assert.equal(report.checks.find((check) => check.key === 'platform').status, 'warning');
  assert.equal(report.checks.find((check) => check.key === 'touch').status, 'warning');
  assert.equal(report.blocked, false);
});

test('marks WebRTC unavailable as not applicable instead of pass', () => {
  const report = buildPrivacyReport({
    expected: { userAgentIncludes: '', viewport: { width: 1280, height: 720 }, dpr: 1, locale: 'en-US', timezoneId: 'UTC' },
    observed: {
      userAgent: 'Mozilla/5.0', platform: 'Win32', maxTouchPoints: 0,
      viewport: { width: 1280, height: 720 }, devicePixelRatio: 1,
      locale: 'en-US', timezoneId: 'UTC', webRtcSupported: false, literalIpCandidates: [],
      permissionStates: { camera: 'denied', microphone: 'denied', geolocation: 'denied', notifications: 'denied' },
    },
    proxyChecks: [],
    strictMode: true,
    permissionPolicy: { camera: 'not-granted', microphone: 'not-granted', geolocation: 'not-granted', notifications: 'not-granted' },
    startedAt: Date.now(),
  });
  const check = report.checks.find((item) => item.key === 'webrtc');
  assert.equal(check.status, 'not-applicable');
  assert.equal(check.required, false);
  assert.equal(report.blocked, false);
});



test('strict privacy treats prompt permissions as blocking instead of pass', () => {
  const report = buildPrivacyReport({
    expected: { userAgentIncludes: '', viewport: { width: 1280, height: 720 }, dpr: 1, locale: 'en-US', timezoneId: 'UTC' },
    observed: {
      userAgent: 'Mozilla/5.0', platform: 'Win32', maxTouchPoints: 0,
      viewport: { width: 1280, height: 720 }, devicePixelRatio: 1,
      locale: 'en-US', timezoneId: 'UTC', webRtcSupported: false, literalIpCandidates: [],
      permissionStates: { camera: 'prompt', microphone: 'prompt', geolocation: 'prompt', notifications: 'prompt' },
    },
    proxyChecks: [],
    strictMode: true,
    permissionPolicy: { camera: 'denied', microphone: 'denied', geolocation: 'denied', notifications: 'denied' },
    startedAt: Date.now(),
  });

  assert.equal(report.blocked, true);
  assert.equal(report.checks.find((check) => check.key === 'camera').status, 'fail');
  assert.equal(report.checks.find((check) => check.key === 'microphone').status, 'fail');
  assert.equal(report.checks.find((check) => check.key === 'geolocation').status, 'fail');
});

test('strict privacy blocks a granted notification permission', () => {
  const report = buildPrivacyReport({
    expected: { userAgentIncludes: '', viewport: { width: 1280, height: 720 }, dpr: 1, locale: 'en-US', timezoneId: 'UTC' },
    observed: {
      userAgent: 'Mozilla/5.0', platform: 'Win32', maxTouchPoints: 0,
      viewport: { width: 1280, height: 720 }, devicePixelRatio: 1,
      locale: 'en-US', timezoneId: 'UTC', webRtcSupported: true, literalIpCandidates: [],
      permissionStates: { camera: 'denied', microphone: 'denied', geolocation: 'denied', notifications: 'granted' },
    },
    proxyChecks: [],
    strictMode: true,
    permissionPolicy: { camera: 'not-granted', microphone: 'not-granted', geolocation: 'not-granted', notifications: 'not-granted' },
    startedAt: Date.now(),
  });
  const check = report.checks.find((item) => item.key === 'notifications');
  assert.equal(check.status, 'fail');
  assert.equal(check.required, true);
  assert.equal(report.blocked, true);
});

test('browser-native locale and timezone expectations do not create false privacy warnings', () => {
  const report = buildPrivacyReport({
    expected: { userAgentIncludes: '', viewport: { width: 1280, height: 720 }, dpr: 1, locale: '', timezoneId: '' },
    observed: {
      userAgent: 'Mozilla/5.0 Chrome', platform: 'Win32', maxTouchPoints: 0,
      viewport: { width: 1280, height: 720 }, devicePixelRatio: 1,
      locale: 'en-NG', timezoneId: 'Africa/Lagos', webRtcSupported: false, webRtcBlocked: false,
      literalIpCandidates: [], permissionStates: { camera: 'unsupported', microphone: 'unsupported', geolocation: 'unsupported', notifications: 'unsupported' },
    },
    proxyChecks: [], strictMode: false,
    permissionPolicy: { camera: 'not-granted', microphone: 'not-granted', geolocation: 'not-granted', notifications: 'not-granted' },
    startedAt: Date.now(),
  });

  assert.equal(report.checks.find((check) => check.key === 'locale').status, 'pass');
  assert.equal(report.checks.find((check) => check.key === 'timezone').status, 'pass');
});

function privacyPageForWebRtc({ candidates = [], supported = true, iceError = null } = {}) {
  return {
    evaluate: async (fn) => {
      const source = String(fn || '');
      if (source.includes('userAgent: navigator.userAgent')) {
        return {
          userAgent: 'Mozilla/5.0 Chrome/153.0', platform: 'Win32', maxTouchPoints: 0,
          viewport: { width: 1280, height: 720 }, devicePixelRatio: 1,
          locale: 'en-US', timezoneId: 'UTC',
        };
      }
      if (source.includes('__orbitqaStrictBlocked')) {
        return {
          webrtc: supported ? 'available' : 'unsupported', camera: 'denied', microphone: 'denied',
          geolocation: 'denied', notifications: 'denied',
        };
      }
      if (source.includes('createDataChannel')) {
        if (iceError) throw iceError;
        return { supported, candidates };
      }
      throw new Error('unexpected evaluate call');
    },
  };
}

const WEBRTC_EXPECTED = { userAgentIncludes: 'Chrome', viewport: { width: 1280, height: 720 }, dpr: 1, locale: 'en-US', timezoneId: 'UTC' };

test('WebRTC policy is prevented when a supported restriction was applied and verification finds no direct IP leak', async () => {
  const report = await collectPrivacyReport({
    page: privacyPageForWebRtc(), expected: WEBRTC_EXPECTED, proxyChecks: [], strictMode: true,
    proxyRequired: true, webRtcPreventionApplied: true,
    routeObservation: { directIp: '198.51.100.10', proxiedIp: '203.0.113.20' },
  });
  assert.equal(report.webRtcPolicy, 'prevented');
  assert.equal(report.checks.find((check) => check.key === 'webrtc').status, 'pass');
});

test('WebRTC policy is verified-no-leak when no prevention primitive exists and candidates do not expose the direct IP', async () => {
  const report = await collectPrivacyReport({
    page: privacyPageForWebRtc({ candidates: ['candidate:1 1 UDP 1 10.0.0.5 5000 typ host'] }), expected: WEBRTC_EXPECTED,
    proxyChecks: [], strictMode: true, proxyRequired: true, webRtcPreventionApplied: false,
    routeObservation: { directIp: '198.51.100.10', proxiedIp: '203.0.113.20' },
  });
  assert.equal(report.webRtcPolicy, 'verified-no-leak');
  assert.equal(report.blocked, false);
});

test('WebRTC policy is unsupported when the API is unavailable', async () => {
  const report = await collectPrivacyReport({
    page: privacyPageForWebRtc({ supported: false }), expected: WEBRTC_EXPECTED, proxyChecks: [], strictMode: true,
    proxyRequired: true, webRtcPreventionApplied: false,
    routeObservation: { directIp: '198.51.100.10', proxiedIp: '203.0.113.20' },
  });
  assert.equal(report.webRtcPolicy, 'unsupported');
  assert.equal(report.checks.find((check) => check.key === 'webrtc').status, 'not-applicable');
});

test('WebRTC policy is exposed and blocks a required proxy when the host direct public IP appears in ICE candidates', async () => {
  const report = await collectPrivacyReport({
    page: privacyPageForWebRtc({ candidates: ['candidate:1 1 UDP 1 198.51.100.10 5000 typ srflx'] }), expected: WEBRTC_EXPECTED,
    proxyChecks: [], strictMode: true, proxyRequired: true, webRtcPreventionApplied: true,
    routeObservation: { directIp: '198.51.100.10', proxiedIp: '203.0.113.20' },
  });
  assert.equal(report.webRtcPolicy, 'exposed');
  assert.equal(report.blocked, true);
  assert.equal(report.checks.find((check) => check.key === 'webrtc').status, 'fail');
});

test('WebRTC policy is indeterminate when ICE verification fails', async () => {
  const report = await collectPrivacyReport({
    page: privacyPageForWebRtc({ iceError: new Error('ICE verification failed') }), expected: WEBRTC_EXPECTED,
    proxyChecks: [], strictMode: true, proxyRequired: true, webRtcPreventionApplied: false,
    routeObservation: { directIp: '198.51.100.10', proxiedIp: '203.0.113.20' },
  });
  assert.equal(report.webRtcPolicy, 'indeterminate');
  assert.equal(report.blocked, true);
});
