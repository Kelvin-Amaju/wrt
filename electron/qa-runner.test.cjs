const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeQaRunRequest,
  buildWorkUnits,
  resolveIosContextOptions,
  assessIosDiagnostics,
  runPool,
  shouldRunBehaviorSteps,
  createPrivacyReadyPage,
  executeStep,
  executeQaRun,
  resolveAndroidEmulationContextOptions,
  buildSessionIntegrityReport,
  buildWebRtcLaunchPolicy,
  buildProxyContainmentLaunchPolicy,
  executeConfiguredBehavior,
  buildTargetNavigationOptions,
  buildV3RunActivityMessages,
  startupParallelismForConcurrency,
  createLaunchGate,
  emitPrivacyRouteIntegrity,
  privacyRouteFailureSummary,
} = require('./qa-runner.cjs');



test('manual concurrency 30 uses multiple parallel startup slots instead of a single-browser launch bottleneck', () => {
  assert.equal(startupParallelismForConcurrency({ mode:'manual', value:30 }), 8);
  assert.equal(startupParallelismForConcurrency({ mode:'manual', value:10 }), 3);
  assert.equal(startupParallelismForConcurrency({ mode:'manual', value:1 }), 1);
});

test('launch gate limits only concurrent startup work and releases every queued startup', async () => {
  const gate = createLaunchGate(4);
  let active = 0;
  let peak = 0;
  let completed = 0;
  await Promise.all(Array.from({ length:12 }, async () => gate.run(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    completed += 1;
  })));
  assert.equal(peak, 4);
  assert.equal(completed, 12);
});

test('builds the correct Chromium WebRTC policy switch for headed and headless runs', () => {
  const headed = buildWebRtcLaunchPolicy({ strictMode: true, browserEngine: 'chromium', headless: false });
  assert.equal(headed.preventionApplied, true);
  assert.deepEqual(headed.args, ['--webrtc-ip-handling-policy=disable_non_proxied_udp']);

  const headless = buildWebRtcLaunchPolicy({ strictMode: true, browserEngine: 'chromium', headless: true });
  assert.equal(headless.preventionApplied, true);
  assert.deepEqual(headless.args, ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp']);

  const webkit = buildWebRtcLaunchPolicy({ strictMode: true, browserEngine: 'webkit', headless: false });
  assert.equal(webkit.preventionApplied, false);
  assert.deepEqual(webkit.args, []);
});

test('proxied Chromium containment leaves destination hostname resolution to the configured proxy', () => {
  const policy = buildProxyContainmentLaunchPolicy({ proxyRequired:true, browserEngine:'chromium', proxyServer:'http://proxy.example.test:8080' });
  assert.equal(policy.applied, true);
  assert.ok(policy.args.includes('--disable-quic'));
  assert.equal(policy.args.some(arg => String(arg).startsWith('--host-resolver-rules=')), false);
});

test('normalizes a safe QA run request', () => {
  const request = normalizeQaRunRequest({
    targetUrl: 'https://example.com',
    browser: 'firefox',
    sessions: 4,
    concurrency: 2,
    headless: true,
    steps: [{ id: 'wait-1', type: 'wait', ms: 1000 }],
  });

  assert.equal(request.targetUrl, 'https://example.com');
  assert.equal(request.browser, 'firefox');
  assert.equal(request.sessions, 4);
  assert.equal(request.concurrency, 2);
});


test('normalizes a bare domain target to https', () => {
  const request = normalizeQaRunRequest({
    targetUrl: 'example.com/path?q=1',
    browser: 'chromium',
    sessions: 1,
    concurrency: 1,
    headless: true,
    steps: [],
  });

  assert.equal(request.targetUrl, 'https://example.com/path?q=1');
});


test('normalizes multiple targets and expands deterministic work units', () => {
  const normalized = normalizeQaRunRequest({
    targetUrls: ['savevidly.xyz', 'https://example.com', 'savevidly.xyz'],
    sessionDurationSeconds: 60,
    browser: 'chromium',
    sessions: 2,
    concurrency: 2,
    headless: true,
    steps: [],
  });

  assert.deepEqual(normalized.targetUrls, ['https://savevidly.xyz', 'https://example.com']);
  assert.equal(normalized.sessionDurationSeconds, 60);

  const units = buildWorkUnits(normalized.targetUrls, 2);
  assert.equal(units.length, 4);
  assert.deepEqual(units.map((unit) => [unit.targetUrl, unit.repetition]), [
    ['https://savevidly.xyz', 1],
    ['https://example.com', 1],
    ['https://savevidly.xyz', 2],
    ['https://example.com', 2],
  ]);
  assert.equal(new Set(units.map((unit) => unit.workId)).size, 4);
});

test('keeps legacy targetUrl callers compatible for one migration release', () => {
  const normalized = normalizeQaRunRequest({
    targetUrl: 'example.com',
    browser: 'chromium',
    sessions: 1,
    concurrency: 1,
    headless: true,
    steps: [],
  });
  assert.deepEqual(normalized.targetUrls, ['https://example.com']);
  assert.equal(normalized.sessionDurationSeconds, 60);
});

test('normalizes a smart interaction step for selector-free QA', () => {
  const request = normalizeQaRunRequest({
    targetUrl: 'https://example.com',
    browser: 'chromium',
    sessions: 1,
    concurrency: 1,
    headless: true,
    steps: [{ id: 'smart-1', type: 'smart-interaction', value: 'OrbitQA proxy test' }],
  });

  assert.deepEqual(request.steps[0], {
    id: 'smart-1',
    type: 'smart-interaction',
    value: 'OrbitQA proxy test',
  });
});

test('accepts legacy desktop concurrency above five', () => {
  const request = normalizeQaRunRequest({
    targetUrl: 'https://example.com', browser: 'chromium', sessions: 10, concurrency: 8, headless: true, steps: [],
  });
  assert.equal(request.concurrency, 8);
});



test('normalizes large matrix requests without workload caps and supports auto concurrency', () => {
  const request = normalizeQaRunRequest({
    targets:[{ id:'big', targetUrl:'example.org', groups:[
      { id:'g', executionKind:'desktop', browser:'chromium', instances:50000, sessionDurationSeconds:60, proxySource:'none' },
    ] }],
    concurrency:{ mode:'auto' }, headless:true, interactionIndicator:false,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://api64.ipify.org?format=json' } },
    steps:[],
  });
  assert.equal(request.targets[0].groups[0].instances, 50000);
  assert.deepEqual(request.concurrency, { mode:'auto' });
});
test('runPool never exceeds the requested worker count', async () => {
  let active = 0;
  let peak = 0;
  const seen = [];

  await runPool([1, 2, 3, 4, 5, 6], 3, async (item) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    seen.push(item);
    active -= 1;
  });

  assert.equal(peak, 3);
  assert.deepEqual(seen.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
});

test('normalizes device modes and enforces Android one-session limit', () => {
  const android = normalizeQaRunRequest({
    targetUrl: 'https://example.com',
    deviceMode: 'android',
    deviceName: 'Pixel_9_API_36',
    browser: 'chromium',
    sessions: 1,
    concurrency: 1,
    headless: false,
    steps: [],
  });
  assert.equal(android.deviceMode, 'android');
  assert.equal(android.deviceName, 'Pixel_9_API_36');

  assert.throws(() => normalizeQaRunRequest({ ...android, sessions: 2 }), /limited to 1 session/);
});

test('normalizes Local iOS Compatibility settings and forces the WebKit engine', () => {
  const request = normalizeQaRunRequest({
    targetUrl: 'https://example.com',
    deviceMode: 'ios-emulation',
    deviceName: 'iPhone 13',
    browser: 'webkit',
    iosBrowser: 'chrome-ios',
    iosOrientation: 'landscape',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    sessions: 1,
    concurrency: 1,
    headless: true,
    steps: [],
  });

  assert.equal(request.iosBrowser, 'chrome-ios');
  assert.equal(request.iosOrientation, 'landscape');
  assert.equal(request.locale, 'en-US');
  assert.equal(request.timezoneId, 'America/New_York');
  assert.equal(request.browser, 'webkit');
});

test('rejects unsupported Local iOS Compatibility settings', () => {
  const base = {
    targetUrl: 'https://example.com',
    deviceMode: 'ios-emulation',
    deviceName: 'iPhone 13',
    browser: 'webkit',
    iosBrowser: 'safari-ios',
    iosOrientation: 'portrait',
    locale: 'en-US',
    timezoneId: 'UTC',
    sessions: 1,
    concurrency: 1,
    headless: true,
    steps: [],
  };

  assert.throws(() => normalizeQaRunRequest({ ...base, iosBrowser: 'desktop-chrome' }), /supported iOS browser identity/);
  assert.throws(() => normalizeQaRunRequest({ ...base, iosOrientation: 'upside-down' }), /supported iOS orientation/);
  assert.throws(() => normalizeQaRunRequest({ ...base, deviceName: 'Unknown Phone' }), /supported iPhone\/iPad profile/);
});

test('builds Safari and Chrome iOS compatibility context options without spoofing hardware APIs', () => {
  const fakePlaywright = {
    devices: {
      'iPhone 13': {
        viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    },
  };

  const safari = resolveIosContextOptions(fakePlaywright, {
    deviceName: 'iPhone 13',
    iosBrowser: 'safari-ios',
    iosOrientation: 'portrait',
    locale: 'en-US',
    timezoneId: 'UTC',
  });
  assert.equal(safari.userAgent.includes('Version/17.0'), true);
  assert.equal(safari.locale, 'en-US');
  assert.equal(safari.timezoneId, 'UTC');
  assert.deepEqual(safari.viewport, { width: 390, height: 844 });
  assert.equal('platform' in safari, false);

  const chrome = resolveIosContextOptions(fakePlaywright, {
    deviceName: 'iPhone 13',
    iosBrowser: 'chrome-ios',
    iosOrientation: 'landscape',
    locale: 'en-GB',
    timezoneId: 'Europe/London',
  });
  assert.equal(chrome.userAgent.includes('CriOS/'), true);
  assert.equal(chrome.userAgent.includes('Version/17.0'), false);
  assert.deepEqual(chrome.viewport, { width: 844, height: 390 });
  assert.deepEqual(chrome.screen, { width: 844, height: 390 });
  assert.equal(chrome.locale, 'en-GB');
  assert.equal(chrome.timezoneId, 'Europe/London');
});

test('assesses iOS diagnostics and warns on platform or WebRTC IP exposure mismatch', () => {
  const expected = {
    deviceName: 'iPhone 13',
    family: 'iPhone',
    iosBrowser: 'safari-ios',
    iosOrientation: 'portrait',
    locale: 'en-US',
    timezoneId: 'UTC',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
  };
  const observed = {
    userAgent: 'Mozilla/5.0 (iPhone) Version/17.0 Mobile/15E148 Safari/604.1',
    platform: 'MacIntel',
    maxTouchPoints: 5,
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    devicePixelRatio: 3,
    locale: 'en-US',
    timezoneId: 'UTC',
    webRtcSupported: true,
    literalIpCandidateCount: 1,
  };

  const result = assessIosDiagnostics(expected, observed);
  assert.equal(result.overall, 'warning');
  assert.equal(result.checks.find((check) => check.key === 'platform')?.status, 'warning');
  assert.equal(result.checks.find((check) => check.key === 'webrtc')?.status, 'warning');
  assert.equal(result.checks.find((check) => check.key === 'viewport')?.status, 'pass');
});

test('normalizes Real iOS Device selection and enforces one session', () => {
  const request = normalizeQaRunRequest({
    targetUrl: 'https://example.com',
    deviceMode: 'real-ios',
    browser: 'webkit',
    sessions: 1,
    concurrency: 1,
    headless: false,
    steps: [],
    realIos: { device: 'iPhone 15', iosVersion: '17', browser: 'safari' },
  });
  assert.deepEqual(request.realIos, { device: 'iPhone 15', iosVersion: '17', browser: 'safari' });
  assert.throws(() => normalizeQaRunRequest({ ...request, sessions: 2 }), /exactly 1 session/);
});


test('rejects Smart QA Interaction for Real iOS Device runs until provider support exists', () => {
  assert.throws(() => normalizeQaRunRequest({
    targetUrl: 'https://example.com',
    deviceMode: 'real-ios',
    browser: 'webkit',
    sessions: 1,
    concurrency: 1,
    headless: false,
    realIos: { device: 'iPhone 15', iosVersion: '17', browser: 'safari' },
    steps: [{ id: 'smart-1', type: 'smart-interaction', value: 'OrbitQA test' }],
  }), /Smart QA Interaction is not available for Real iOS Device runs yet/);
});

test('normalizes strict privacy on by default and preserves explicit proxy settings', () => {
  const direct = normalizeQaRunRequest({
    targetUrl: 'https://example.com', browser: 'chromium', sessions: 1, concurrency: 1,
    headless: true, steps: [],
  });
  assert.equal(direct.privacy.strictMode, true);
  assert.equal(direct.privacy.proxy.enabled, false);

  const proxied = normalizeQaRunRequest({
    targetUrl: 'https://example.com', browser: 'firefox', sessions: 1, concurrency: 1,
    headless: true, steps: [],
    privacy: {
      strictMode: true,
      proxy: {
        enabled: true,
        server: 'http://proxy.test:8080',
        username: 'alice',
        password: 'secret',
        requireVerifiedRoute: true,
        routeCheckUrl: 'https://api64.ipify.org?format=json',
      },
    },
  });
  assert.equal(proxied.privacy.proxy.server, 'http://proxy.test:8080');
  assert.equal(proxied.privacy.proxy.password, 'secret');
});



test('prepares and verifies strict privacy before returning the page for navigation', async () => {
  const events = [];
  const page = {
    id: 'page-1',
    evaluate: async () => {
      events.push('verify-guard');
      return {
        webrtc: 'blocked', camera: 'denied', microphone: 'denied',
        geolocation: 'denied', notifications: 'denied',
      };
    },
  };
  const context = {
    clearPermissions: async () => events.push('clear-permissions'),
    addInitScript: async () => events.push('install-guard'),
    newPage: async () => { events.push('new-page'); return page; },
  };

  const result = await createPrivacyReadyPage(context, true);
  assert.equal(result, page);
  assert.deepEqual(events, ['clear-permissions', 'install-guard', 'new-page', 'verify-guard']);
});

test('manual scroll and type actions use smooth scrolling and progressive typing', async () => {
  const deltas = [];
  const typed = [];
  const target = {
    async scrollIntoViewIfNeeded() { typed.push(['scroll-into-view']); },
    async fill(value) { typed.push(['fill', value]); },
    async pressSequentially(value, options) { typed.push(['type', value, options?.delay]); },
  };
  const page = {
    async evaluate(_fn, delta) { deltas.push(delta); },
    async waitForTimeout() {},
    locator() { return { first: () => target }; },
  };
  const context = { sessionId: 1, stepNumber: 1, screenshotDir: '/tmp', emit: () => {} };

  await executeStep(page, { id: 'scroll-1', type: 'scroll', direction: 'down', distance: 200 }, context);
  await executeStep(page, { id: 'type-1', type: 'type', selector: 'input', value: 'OrbitQA test' }, context);

  assert.deepEqual(deltas, [65, 65, 65, 5]);
  assert.deepEqual(typed, [
    ['scroll-into-view'],
    ['fill', ''],
    ['type', 'OrbitQA test', 65],
  ]);
});



test('executeStep uses the work-unit pacing profile for progressive typing', async () => {
  const typed = [];
  const target = {
    async scrollIntoViewIfNeeded() {},
    async fill(value) { typed.push(['fill', value]); },
    async pressSequentially(value, options) { typed.push(['type', value, options?.delay]); },
  };
  const page = { locator() { return { first: () => target }; } };
  const context = {
    sessionId: 1, stepNumber: 1, screenshotDir: '/tmp', emit: () => {},
    pacing: { typingDelayMs: 91 },
  };

  await executeStep(page, { id: 'type-paced', type: 'type', selector: 'input', value: 'paced' }, context);

  assert.deepEqual(typed, [['fill', ''], ['type', 'paced', 91]]);
});

test('smart interaction step completes gracefully when a page has no safe controls', async () => {
  const logs = [];
  const page = {
    locator() { return { count: async () => 0, nth: () => { throw new Error('unexpected'); } }; },
    async evaluate() {},
    async waitForTimeout() {},
  };
  const context = {
    sessionId: 1,
    stepNumber: 1,
    screenshotDir: '/tmp',
    emit: (event) => logs.push(event.message),
  };

  await executeStep(page, { id: 'smart-1', type: 'smart-interaction', value: 'OrbitQA test' }, context);

  assert.equal(logs.some((message) => /No safe input found/i.test(message || '')), true);
  assert.equal(logs.some((message) => /No safe action found/i.test(message || '')), true);
});

test('strict privacy gate prevents behavior steps after a blocking failure', () => {
  assert.equal(shouldRunBehaviorSteps({ blocked: true }), false);
  assert.equal(shouldRunBehaviorSteps({ blocked: false }), true);
});

function poolRunnerRequest(sessions = 1, proxySource = 'rotating') {
  return {
    targetUrl: 'https://example.com', browser: 'chromium', sessions, concurrency: sessions,
    headless: true, steps: [], proxySource,
    privacy: {
      strictMode: true,
      proxy: { enabled: false, server: '', username: '', password: '', requireVerifiedRoute: false, routeCheckUrl: 'https://check.test/ip' },
    },
  };
}

function fakeRunnerPlaywright(state = {}) {
  const launches = [];
  const request = {
    newContext: async (options) => {
      if (state.failRequest) throw new Error('request transport must not be used');
      return {
        get: async () => ({ ok: () => true, status: () => 200, text: async () => JSON.stringify({ ip: state.proxiedIp || '203.0.113.20' }) }),
        dispose: async () => {},
        options,
      };
    },
  };
  const navigations = [];
  const launcher = {
    launch: async (options) => {
      launches.push(options);
      return {
        newContext: async (contextOptions = {}) => {
          state.contextOptionsLog = [...(state.contextOptionsLog || []), contextOptions];
          state.contextCreated = true;
          state.contextCreatedCount = (state.contextCreatedCount || 0) + 1;
          let evalCall = 0;
          const guardState = { webrtc: 'available', camera: 'denied', microphone: 'denied', geolocation: 'denied', notifications: 'denied' };
          let currentUrl = '';
          let routeRead = 0;
          let tapProbeActivated = false;
          const page = {
            setDefaultTimeout: () => {},
            viewportSize: () => contextOptions.viewport || ({ width: 1280, height: 720 }),
            goto: async (url) => {
              currentUrl = String(url);
              navigations.push(currentUrl);
              const launchNumber = launches.length;
              const failLaunches = Array.isArray(state.failTargetNavigationLaunches) ? state.failTargetNavigationLaunches : [];
              const failRouteCheckLaunches = Array.isArray(state.failRouteCheckLaunches) ? state.failRouteCheckLaunches : [];
              if (currentUrl.includes('check.test') && failRouteCheckLaunches.includes(launchNumber)) {
                throw new Error(state.routeCheckError || 'page.goto: Timeout 20000ms exceeded');
              }
              if (!currentUrl.includes('check.test') && failLaunches.includes(launchNumber)) {
                throw new Error(state.targetNavigationError || 'page.goto: Timeout 30000ms exceeded');
              }
              return { ok: () => true, status: () => 200 };
            },
            textContent: async () => {
              if (!currentUrl.includes('check.test')) return '';
              const routeIps = Array.isArray(state.routeIps) ? state.routeIps : [];
              const ip = routeIps[routeRead] || state.routeIp || state.proxiedIp || '203.0.113.20';
              routeRead += 1;
              return JSON.stringify({ ip });
            },
            evaluate: async (fn, arg) => {
              const source = String(fn || '');
              if (source.includes('createDataChannel')) {
                if (state.iceVerificationError) throw state.iceVerificationError;
                return { supported: state.webRtcSupported !== false, candidates: state.iceCandidates || [] };
              }
              if (source.includes('data-orbitqa-tap-probe')) {
                if (source.includes('document.createElement')) {
                  state.tapProbeId = arg;
                  tapProbeActivated = false;
                  return undefined;
                }
                if (source.includes('data-orbitqa-activated')) return tapProbeActivated === true;
                if (source.includes('.remove()')) return undefined;
              }
              evalCall += 1;
              if (Array.isArray(state.navigationRaceEvaluateCalls) && state.navigationRaceEvaluateCalls.includes(evalCall)) {
                throw new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation');
              }
              if ((source.includes('navigator.userAgent') && source.includes('window.innerWidth')) || evalCall === 2 || evalCall === 4) {
                if (state.identityRuntime) return state.identityRuntime;
                const ua = contextOptions.userAgent || 'Mozilla/5.0 Chrome';
                const mobileAndroid = /Android/i.test(ua);
                const mobileIos = /(iPhone|iPad)/i.test(ua);
                const viewport = contextOptions.viewport || { width: 1280, height: 720 };
                return {
                  userAgent: ua,
                  platform: mobileAndroid ? 'Linux armv8l' : mobileIos ? (ua.includes('iPad') ? 'iPad' : 'iPhone') : 'Win32',
                  maxTouchPoints: contextOptions.hasTouch || mobileAndroid || mobileIos ? 5 : 0,
                  viewport,
                  screen: contextOptions.screen || (mobileAndroid || mobileIos ? viewport : { width: 1920, height: 1080 }),
                  devicePixelRatio: contextOptions.deviceScaleFactor || 1,
                  locale: contextOptions.locale || 'en-US',
                  timezoneId: contextOptions.timezoneId || 'UTC',
                  webdriver: true, hardwareConcurrency: 8, deviceMemory: 8,
                };
              }
              return guardState;
            },
            waitForLoadState: async (loadState) => {
              state.waitForLoadStates = [...(state.waitForLoadStates || []), loadState];
            },
            locator: () => ({
              tap: async () => { tapProbeActivated = true; },
              first: () => ({ click: async () => { if (state.clickError) throw new Error(state.clickError); }, fill: async () => {} }),
            }),
            waitForTimeout: async (ms) => {
              if (!state.blockWait || ms < 1000) return;
              await new Promise((resolve) => { state.resolveWait = resolve; });
            },
            screenshot: async (options = {}) => { if (options.path) (state.screenshotPaths ||= []).push(options.path); },
          };
          return {
            clearPermissions: async () => { state.clearPermissionsCount = (state.clearPermissionsCount || 0) + 1; }, addInitScript: async () => {}, newPage: async () => page, close: async () => { state.contextClosed = true; state.contextClosedCount = (state.contextClosedCount || 0) + 1; state.resolveWait?.(); },
          };
        },
        close: async () => { state.browserClosed = true; state.resolveWait?.(); },
      };
    },
  };
  return { chromium: launcher, firefox: launcher, webkit: launcher, request, devices: {}, launches, navigations };
}

test('pre-behavior diagnostics recover when the target auto-navigates after load', async () => {
  const state = { navigationRaceEvaluateCalls:[2] };
  const playwrightImpl = fakeRunnerPlaywright(state);
  const events = [];
  const request = {
    targets:[{ id:'redirecting-target', targetUrl:'https://example.com', groups:[
      { id:'desktop', executionKind:'desktop', browser:'chromium', instances:1, sessionDurationSeconds:5, proxySource:'none' },
    ] }],
    concurrency:{ mode:'manual', value:1 }, headless:true, interactionIndicator:false,
    privacy:{ strictMode:false, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://check.test/ip' } },
    steps:[],
  };

  const result = await executeQaRun({
    runId:'identity-navigation-race', request, screenshotsRoot:'/tmp', emit:(event)=>events.push(event), playwrightImpl,
  });

  assert.equal(result.completed, 1, JSON.stringify(events));
  assert.equal(result.failed, 0, JSON.stringify(events));
  assert.equal(state.waitForLoadStates?.includes('domcontentloaded'), true);
  assert.equal(events.some((event) => /navigation interrupted .*diagnostics/i.test(event.message || '')), true);
});

function fakePoolServiceForRunner() {
  const allocations = [];
  const releases = [];
  const failures = [];
  return {
    allocations, releases, failures,
    allocate: async (kind, owner, options) => {
      const allocation = { allocationId: owner, proxyId: `${kind}-${allocations.length + 1}`, server: 'http://proxy.test:8080', username: 'alice', password: 'secret', requireVerifiedRoute: true };
      allocations.push({ kind, owner, options });
      return allocation;
    },
    release: async (allocationId) => releases.push(allocationId),
    reportRuntimeFailure: async (proxyId, message) => failures.push({ proxyId, message }),
    getDirectIp: async () => '198.51.100.10',
  };
}

test('allocates one rotating proxy per desktop session and releases each reservation', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright();
  const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ip: '198.51.100.10' }) });
  try {
    const result = await executeQaRun({ runId: 'run-1', request: poolRunnerRequest(2), screenshotsRoot: '/tmp', emit: () => {}, proxyPoolService: pool, playwrightImpl });
    assert.equal(result.completed, 2);
    assert.equal(pool.allocations.length, 2);
    assert.equal(pool.releases.length, 2);
    assert.equal(playwrightImpl.launches.every((options) => options.proxy?.password === 'secret'), true);
  } finally { global.fetch = oldFetch; }
});





test('verifies a pool proxy inside the launched browser session before target navigation', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ failRequest: true, routeIp: '203.0.113.20' });
  const result = await executeQaRun({
    runId: 'run-browser-route',
    request: poolRunnerRequest(1),
    screenshotsRoot: '/tmp',
    emit: () => {},
    proxyPoolService: pool,
    playwrightImpl,
  });

  assert.equal(result.completed, 1);
  assert.equal(result.failed, 0);
  assert.equal(playwrightImpl.launches.length, 1);
  assert.deepEqual(playwrightImpl.navigations.slice(0, 2), ['https://check.test/ip', 'https://example.com']);
});


test('re-verifies the pool proxy route after behavior steps and emits an interaction route pass', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ routeIps: ['203.0.113.20', '203.0.113.21'] });
  const events = [];
  const request = {
    ...poolRunnerRequest(1),
    steps: [{ id: 'wait-1', type: 'wait', ms: 1 }],
  };

  const result = await executeQaRun({
    runId: 'run-interaction-route',
    request,
    screenshotsRoot: '/tmp',
    emit: (event) => events.push(event),
    proxyPoolService: pool,
    playwrightImpl,
  });

  assert.equal(result.completed, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(playwrightImpl.navigations, [
    'https://check.test/ip',
    'https://example.com',
    'https://check.test/ip',
  ]);
  const finalPrivacy = events.filter((event) => event.type === 'privacy-diagnostics').at(-1)?.privacyDiagnostics;
  const interactionCheck = finalPrivacy?.checks.find((check) => check.key === 'interaction-route');
  assert.equal(interactionCheck?.status, 'pass');
  assert.equal(interactionCheck?.observed, '203.0.113.21');
  assert.match(events.find((event) => event.type === 'log' && /after behavior steps/.test(event.message || ''))?.message || '', /203\.0\.113\.21/);
});

test('fails closed when the browser falls back to the direct route after behavior steps', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ routeIps: ['203.0.113.20', '198.51.100.10'] });
  const events = [];
  const request = {
    ...poolRunnerRequest(1),
    steps: [{ id: 'wait-1', type: 'wait', ms: 1 }],
  };

  const result = await executeQaRun({
    runId: 'run-interaction-fallback',
    request,
    screenshotsRoot: '/tmp',
    emit: (event) => events.push(event),
    proxyPoolService: pool,
    playwrightImpl,
  });

  assert.equal(result.completed, 0);
  assert.equal(result.failed, 1);
  assert.equal(pool.failures.length, 1);
  assert.equal(events.some((event) => event.type === 'session-complete'), false);
  const finalPrivacy = events.filter((event) => event.type === 'privacy-diagnostics').at(-1)?.privacyDiagnostics;
  const interactionCheck = finalPrivacy?.checks.find((check) => check.key === 'interaction-route');
  assert.equal(interactionCheck?.status, 'fail');
  assert.equal(interactionCheck?.observed, '198.51.100.10');
});
test('passes the explicit verified-slow opt-in to proxy pool allocation', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright();
  const request = { ...poolRunnerRequest(1), allowSlowProxies: true };
  const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ip: '198.51.100.10' }) });
  try {
    const result = await executeQaRun({ runId: 'run-slow-opt-in', request, screenshotsRoot: '/tmp', emit: () => {}, proxyPoolService: pool, playwrightImpl });
    assert.equal(result.completed, 1);
    assert.equal(pool.allocations[0].options?.allowSlow, true);
  } finally { global.fetch = oldFetch; }
});
test('fails closed before browser launch when no pool proxy is eligible', async () => {
  const pool = { allocate: async () => { throw new Error('No eligible rotating proxy is available'); }, release: async () => {}, reportRuntimeFailure: async () => {} };
  const playwrightImpl = fakeRunnerPlaywright();
  const events = [];
  const result = await executeQaRun({ runId: 'run-2', request: poolRunnerRequest(1), screenshotsRoot: '/tmp', emit: (event) => events.push(event), proxyPoolService: pool, playwrightImpl });
  assert.equal(result.failed, 1);
  assert.equal(playwrightImpl.launches.length, 0);
  assert.match(events.find((event) => event.type === 'session-error').message, /No eligible rotating proxy/i);
});

test('pool runtime failures are reported, secrets are redacted, and static allocation is released', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ proxiedIp: '198.51.100.10' });
  const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ip: '198.51.100.10' }) });
  const events = [];
  try {
    const result = await executeQaRun({ runId: 'run-3', request: poolRunnerRequest(1, 'static'), screenshotsRoot: '/tmp', emit: (event) => events.push(event), proxyPoolService: pool, playwrightImpl });
    assert.equal(result.failed, 1);
    assert.equal(pool.failures.length, 1);
    assert.equal(pool.releases.length, 1);
    const message = events.find((event) => event.type === 'session-error').message;
    assert.equal(message.includes('secret'), false);
    assert.equal(message.includes('alice'), false);
  } finally { global.fetch = oldFetch; }
});

test('none proxy source never calls the pool service', async () => {
  let called = 0;
  const pool = { allocate: async () => { called += 1; throw new Error('unexpected'); }, release: async () => {}, reportRuntimeFailure: async () => {} };
  const playwrightImpl = fakeRunnerPlaywright();
  const request = poolRunnerRequest(1, 'none');
  const result = await executeQaRun({ runId: 'run-4', request, screenshotsRoot: '/tmp', emit: () => {}, proxyPoolService: pool, playwrightImpl });
  assert.equal(result.completed, 1);
  assert.equal(called, 0);
});

test('an aborted QA run stops before launching a browser', async () => {
  const controller = new AbortController();
  controller.abort();
  let launched = false;
  const playwright = {
    chromium: {
      async launch() { launched = true; throw new Error('browser should not launch after stop'); },
    },
  };
  const request = {
    targetUrl: 'https://example.com',
    deviceMode: 'desktop',
    browser: 'chromium',
    sessions: 1,
    concurrency: 1,
    headless: true,
    steps: [],
  };

  await assert.rejects(
    executeQaRun({
      runId: 'stopped-run',
      request,
      screenshotsRoot: '/tmp/orbitqa-stop-test',
      emit: () => {},
      playwrightImpl: playwright,
      signal: controller.signal,
    }),
    (error) => error?.name === 'AbortError' && /stopped/i.test(error.message),
  );
  assert.equal(launched, false);
});


test('aborting an active desktop run closes its browser context and browser', async () => {
  const controller = new AbortController();
  const state = { blockWait: true, contextClosed: false, browserClosed: false, resolveWait: null };
  const playwrightImpl = fakeRunnerPlaywright(state);
  const events = [];
  const request = {
    targetUrl: 'https://example.com', browser: 'chromium', sessions: 1, concurrency: 1,
    headless: true, steps: [{ id: 'wait-stop', type: 'wait', ms: 30000 }],
    proxySource: 'none',
  };

  const runPromise = executeQaRun({
    runId: 'active-stop-run', request, screenshotsRoot: '/tmp/orbitqa-stop-active',
    emit: (event) => events.push(event), playwrightImpl, signal: controller.signal,
  });

  while (!state.contextCreated) await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort();

  await assert.rejects(runPromise, (error) => error?.name === 'AbortError');
  assert.equal(state.contextClosed, true);
  assert.equal(state.browserClosed, true);
  assert.equal(events.some((event) => event.type === 'session-cancelled'), true);
});

test('STOP cancels a matrix desktop work unit even while browser launch is still pending', async () => {
  const controller = new AbortController();
  const state = {};
  const basePlaywright = fakeRunnerPlaywright(state);
  const originalLaunch = basePlaywright.chromium.launch;
  let releaseLaunch;
  let launchStartedResolve;
  const launchStarted = new Promise((resolve) => { launchStartedResolve = resolve; });
  basePlaywright.chromium.launch = (options) => new Promise((resolve, reject) => {
    launchStartedResolve();
    releaseLaunch = () => originalLaunch(options).then(resolve, reject);
  });
  const events = [];
  const request = {
    targets: [{ id:'target', targetUrl:'https://example.com', groups:[
      { id:'desktop', executionKind:'desktop', browser:'chromium', instances:1, sessionDurationSeconds:180, proxySource:'none' },
    ] }],
    concurrency:1,
    headless:false,
    interactionIndicator:true,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://api64.ipify.org?format=json' } },
    steps:[],
  };

  const runPromise = executeQaRun({
    runId:'matrix-stop-during-launch', request, screenshotsRoot:'/tmp',
    emit:(event) => events.push(event), playwrightImpl:basePlaywright, signal:controller.signal,
  });

  await launchStarted;
  controller.abort();
  const stopResult = await Promise.race([
    runPromise.then(() => 'resolved', (error) => error?.name || 'rejected'),
    new Promise((resolve) => setTimeout(() => resolve('timeout'), 50)),
  ]);

  releaseLaunch();
  await runPromise.catch(() => undefined);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(stopResult, 'AbortError');
  assert.equal(events.some((event) => event.type === 'session-cancelled'), true);
  assert.equal(state.browserClosed, true);
});

test('3 targets x 2 repetitions creates 6 isolated work units with shared settings and work identity', async () => {
  const playwrightImpl = fakeRunnerPlaywright();
  const events = [];
  const request = {
    ...poolRunnerRequest(2, 'none'),
    targetUrls: ['one.example', 'two.example', 'three.example'],
    targetUrl: undefined,
    concurrency: 2,
    sessionDurationSeconds: 5,
  };
  const lifetimeFactory = ({ context }) => ({
    reason: null,
    expired: false,
    remainingMs: () => 5000,
    throwIfExpired() {},
    wait: async () => {},
    waitUntilClosed: async () => { await context.close(); return 'duration-elapsed'; },
    close: async () => context.close(),
  });

  const result = await executeQaRun({
    runId: 'run-multi-target',
    request,
    screenshotsRoot: '/tmp',
    emit: (event) => events.push(event),
    playwrightImpl,
    sessionLifetimeFactory: lifetimeFactory,
  });

  assert.equal(result.total, 6);
  assert.equal(result.completed, 6);
  assert.equal(playwrightImpl.launches.length, 6);
  const starts = events.filter((event) => event.type === 'session-start');
  assert.equal(starts.length, 6);
  assert.equal(new Set(starts.map((event) => event.workId)).size, 6);
  assert.deepEqual(new Set(starts.map((event) => new URL(event.targetUrl).hostname)), new Set(['one.example', 'two.example', 'three.example']));
});

test('session deadline before final proxy verification marks work incomplete without a false route pass', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ routeIps: ['203.0.113.20', '203.0.113.21'] });
  const events = [];
  let expiryChecks = 0;
  const lifetimeFactory = ({ context }) => ({
    reason: null,
    expired: false,
    remainingMs: () => 5000,
    throwIfExpired() {
      expiryChecks += 1;
      if (expiryChecks >= 6) {
        const error = new Error('Browser session duration elapsed');
        error.name = 'SessionExpiredError';
        throw error;
      }
    },
    wait: async () => {},
    waitUntilClosed: async () => 'duration-elapsed',
    close: async () => context.close(),
  });

  const result = await executeQaRun({
    runId: 'run-expired-before-final-route',
    request: { ...poolRunnerRequest(1), sessionDurationSeconds: 5 },
    screenshotsRoot: '/tmp',
    emit: (event) => events.push(event),
    proxyPoolService: pool,
    playwrightImpl,
    sessionLifetimeFactory: lifetimeFactory,
  });

  assert.equal(result.completed, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.incomplete, 1);
  assert.equal(events.some((event) => event.type === 'session-incomplete'), true);
  assert.equal(events.some((event) => event.type === 'log' && /Interaction route verified .* after behavior steps/.test(event.message || '')), false);
  assert.equal(playwrightImpl.navigations.filter((url) => url === 'https://check.test/ip').length, 1);
});

test('STOP closes active multi-target contexts and prevents queued work from starting', async () => {
  const controller = new AbortController();
  const state = { contextCreatedCount: 0, contextClosedCount: 0 };
  const playwrightImpl = fakeRunnerPlaywright(state);
  const events = [];
  const request = {
    ...poolRunnerRequest(2, 'none'),
    targetUrls: ['one.example', 'two.example', 'three.example'],
    targetUrl: undefined,
    concurrency: 2,
    sessionDurationSeconds: 60,
    steps: [{ id: 'wait-stop-all', type: 'wait', ms: 30000 }],
  };

  const runPromise = executeQaRun({
    runId: 'run-stop-multi', request, screenshotsRoot: '/tmp',
    emit: (event) => events.push(event), playwrightImpl, signal: controller.signal,
  });

  while (state.contextCreatedCount < 2) await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort();
  await assert.rejects(runPromise, (error) => error?.name === 'AbortError');

  assert.equal(playwrightImpl.launches.length, 2);
  assert.equal(state.contextClosedCount >= 2, true);
  assert.equal(events.filter((event) => event.type === 'session-start').length, 2);
  assert.equal(events.filter((event) => event.type === 'session-cancelled').length, 2);
  assert.equal(events.some((event) => event.type === 'run-complete'), false);
});

test('work-aware screenshot names are unique across targets and repetitions', async () => {
  const state = { screenshotPaths: [] };
  const playwrightImpl = fakeRunnerPlaywright(state);
  const request = {
    ...poolRunnerRequest(2, 'none'),
    targetUrls: ['one.example', 'two.example'],
    targetUrl: undefined,
    concurrency: 2,
    sessionDurationSeconds: 5,
    steps: [{ id: 'shot-1', type: 'screenshot', fullPage: true }],
  };
  const lifetimeFactory = ({ context }) => ({
    reason: null,
    expired: false,
    remainingMs: () => 5000,
    throwIfExpired() {},
    wait: async () => {},
    waitUntilClosed: async () => { await context.close(); return 'duration-elapsed'; },
    close: async () => context.close(),
  });

  const result = await executeQaRun({
    runId: 'run-screenshot-work-id', request, screenshotsRoot: '/tmp', emit: () => {},
    playwrightImpl, sessionLifetimeFactory: lifetimeFactory,
  });

  assert.equal(result.total, 4);
  assert.equal(new Set(state.screenshotPaths).size, 4);
  assert.equal(state.screenshotPaths.some((value) => value.endsWith('target-1-run-1-step-1.png')), true);
  assert.equal(state.screenshotPaths.some((value) => value.endsWith('target-2-run-2-step-1.png')), true);
});

test('an ordinary page failure does not reset or prematurely end an explicit browser-session timer', async () => {
  const state = { clickError: 'Target page has been closed' };
  const playwrightImpl = fakeRunnerPlaywright(state);
  let waitedForDeadline = false;
  let immediateCloseReason = null;
  const lifetimeFactory = ({ context }) => ({
    reason: null,
    expired: false,
    remainingMs: () => 5000,
    throwIfExpired() {},
    wait: async () => {},
    waitUntilClosed: async () => {
      waitedForDeadline = true;
      await context.close();
      return 'duration-elapsed';
    },
    close: async (reason) => {
      immediateCloseReason = reason;
      await context.close();
      return reason;
    },
  });
  const request = {
    ...poolRunnerRequest(1, 'none'),
    sessionDurationSeconds: 5,
    steps: [{ id: 'click-fails', type: 'click', selector: 'button' }],
  };

  const result = await executeQaRun({
    runId: 'run-page-failure-timer', request, screenshotsRoot: '/tmp', emit: () => {},
    playwrightImpl, sessionLifetimeFactory: lifetimeFactory,
  });

  assert.equal(result.failed, 1);
  assert.equal(waitedForDeadline, true);
  assert.equal(immediateCloseReason, null);
});

test('normalizes v0.8 matrix request without collapsing group settings', () => {
  const request = normalizeQaRunRequest({
    targets: [
      { id:'save', targetUrl:'savevidly.xyz', groups:[
        { id:'d', executionKind:'desktop', browser:'chromium', instances:2, sessionDurationSeconds:20, proxySource:'rotating' },
        { id:'m', executionKind:'android-emulation', browser:'chrome-android', deviceProfile:'Pixel 7', instances:3, sessionDurationSeconds:45, proxySource:'static' },
      ] },
      { id:'other', targetUrl:'example.com', groups:[
        { id:'i', executionKind:'ios-emulation', browser:'safari-ios', deviceProfile:'iPhone 13', instances:1, sessionDurationSeconds:60, proxySource:'none' },
      ] },
    ],
    concurrency:3,
    headless:false,
    interactionIndicator:true,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://api64.ipify.org?format=json' } },
    steps:[],
  });
  assert.equal(request.version, 2);
  assert.equal(request.targets[0].targetUrl, 'https://savevidly.xyz');
  assert.equal(request.targets[0].groups[1].sessionDurationSeconds, 45);
  assert.equal(request.targets[1].groups[0].proxySource, 'none');
  assert.equal(request.interactionIndicator, true);
});

test('maps each matrix work unit to independent runtime settings', () => {
  const { settingsForWorkUnit } = require('./qa-runner.cjs');
  const normalized = normalizeQaRunRequest({
    targets:[{ id:'save', targetUrl:'savevidly.xyz', groups:[
      { id:'a', executionKind:'desktop', browser:'firefox', instances:1, sessionDurationSeconds:15, proxySource:'rotating' },
      { id:'b', executionKind:'ios-emulation', browser:'chrome-ios', deviceProfile:'iPhone 13', orientation:'landscape', locale:'en-GB', timezoneId:'Europe/London', instances:1, sessionDurationSeconds:55, proxySource:'static' },
    ] }], concurrency:2, headless:false, interactionIndicator:true,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://api64.ipify.org?format=json' } }, steps:[],
  });
  const units = require('./work-unit-scheduler.cjs').expandWorkUnits(normalized);
  const first = settingsForWorkUnit(normalized, units[0]);
  const second = settingsForWorkUnit(normalized, units[1]);
  assert.equal(first.browser, 'firefox');
  assert.equal(first.sessionDurationSeconds, 15);
  assert.equal(second.browser, 'webkit');
  assert.equal(second.iosBrowser, 'chrome-ios');
  assert.equal(second.sessionDurationSeconds, 55);
  assert.equal(second.proxySource, 'static');
});


test('desktop matrix leaves locale and timezone browser-native unless the group explicitly requests them', async () => {
  const state = {};
  const playwrightImpl = fakeRunnerPlaywright(state);
  const lifetimeFactory = ({ context, durationMs }) => {
    let reason = null;
    return {
      get reason(){ return reason; }, get expired(){ return reason === 'duration-elapsed'; },
      remainingMs: () => reason ? 0 : durationMs,
      throwIfExpired(){}, wait: async () => {},
      waitUntilClosed: async () => { if (!reason) { reason = 'duration-elapsed'; await context.close(); } return reason; },
      close: async (next) => { if (!reason) { reason = next; await context.close(); } return reason; },
    };
  };
  const request = {
    targets:[{ id:'native', targetUrl:'example.com', groups:[
      { id:'desktop', executionKind:'desktop', browser:'chromium', instances:1, sessionDurationSeconds:5, proxySource:'none' },
    ] }], concurrency:1, headless:true, interactionIndicator:false,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://check.test/ip' } }, steps:[],
  };

  const result = await executeQaRun({ runId:'desktop-native-identity', request, screenshotsRoot:'/tmp', emit:()=>{}, playwrightImpl, sessionLifetimeFactory:lifetimeFactory });

  assert.equal(result.completed, 1);
  assert.equal(state.contextOptionsLog.length, 1);
  assert.equal(Object.hasOwn(state.contextOptionsLog[0], 'locale'), false);
  assert.equal(Object.hasOwn(state.contextOptionsLog[0], 'timezoneId'), false);
});

test('v0.8 matrix executes each desktop work unit with its own proxy reservation and timer settings', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ routeIp:'203.0.113.20' });
  const events = [];
  const durations = [];
  const activeDurations = [];
  const lifetimeFactory = ({ context, durationMs, signal }) => {
    durations.push(durationMs);
    let reason = null;
    let activeDurationMs = durationMs;
    return {
      get reason(){ return reason; }, get expired(){ return reason === 'duration-elapsed'; },
      remainingMs: () => reason ? 0 : activeDurationMs,
      beginActiveSession(nextDurationMs){ activeDurationMs = nextDurationMs; activeDurations.push(nextDurationMs); return true; },
      throwIfExpired(){ if (signal?.aborted) { const e = new Error('QA run stopped by user'); e.name='AbortError'; throw e; } },
      wait: async () => {},
      waitUntilClosed: async () => { if (!reason) { reason = 'duration-elapsed'; await context.close(); } return reason; },
      close: async (next) => { if (!reason) { reason = next; await context.close(); } return reason; },
    };
  };
  const request = {
    targets:[{ id:'save', targetUrl:'savevidly.xyz', groups:[
      { id:'c', executionKind:'desktop', browser:'chromium', instances:1, sessionDurationSeconds:15, proxySource:'rotating' },
      { id:'f', executionKind:'desktop', browser:'firefox', instances:1, sessionDurationSeconds:35, proxySource:'rotating' },
    ] }], concurrency:2, headless:true, interactionIndicator:true,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://check.test/ip' } }, steps:[],
  };
  const result = await executeQaRun({ runId:'matrix-run', request, screenshotsRoot:'/tmp', emit:(event)=>events.push(event), proxyPoolService:pool, playwrightImpl, sessionLifetimeFactory:lifetimeFactory });
  assert.equal(result.completed, 2);
  assert.deepEqual(durations.sort((a,b)=>a-b), [120000,120000]);
  assert.deepEqual(activeDurations.sort((a,b)=>a-b), [15000,35000]);
  assert.deepEqual(pool.allocations.map((item)=>item.owner).sort(), ['matrix-run:save-c-instance-1','matrix-run:save-f-instance-1']);
  assert.equal(new Set(events.filter((event)=>event.type==='session-start').map((event)=>event.workId)).size, 2);
  const starts = events.filter((event)=>event.type==='session-start');
  assert.equal(starts[0].deviceLabel, 'Desktop');
  assert.match(starts[0].browserLabel, /Chromium|Firefox/);
});

test('v0.8 matrix runs an Android AVD work unit with its own timer and closes only the AVD it launched', async () => {
  const base = fakeRunnerPlaywright({
    identityRuntime: {
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/153.0.0.0 Mobile Safari/537.36',
      platform: 'Win32', maxTouchPoints: 5,
      viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 },
      devicePixelRatio: 2.625, locale: 'en-US', timezoneId: 'UTC',
      webdriver: true, hardwareConcurrency: 8, deviceMemory: 8,
    },
  });
  const launchedBrowser = await base.chromium.launch({ headless: true });
  const androidContext = await launchedBrowser.newContext();
  const deviceState = { closed: 0, stopped: [] };
  const androidDevice = {
    serial: () => 'emulator-5556',
    shell: async () => {},
    launchBrowser: async () => androidContext,
    close: async () => { deviceState.closed += 1; },
  };
  const playwrightImpl = { ...base, _android: { devices: async () => [androidDevice] } };
  const androidService = {
    launchAvd: async (name) => ({ serial: 'emulator-5556', state: 'ready', alreadyRunning: false, name }),
    stopAvd: async (serial) => { deviceState.stopped.push(serial); },
  };
  const durations = [];
  const lifetimeFactory = ({ context, durationMs }) => {
    durations.push(durationMs);
    let reason = null;
    return {
      get reason(){ return reason; }, get expired(){ return reason === 'duration-elapsed'; },
      remainingMs: () => reason ? 0 : durationMs,
      throwIfExpired(){}, wait: async () => {},
      waitUntilClosed: async () => { if (!reason) { reason = 'duration-elapsed'; await context.close(); } return reason; },
      close: async (next) => { if (!reason) { reason = next; await context.close(); } return reason; },
    };
  };
  const request = {
    targets:[{ id:'save', targetUrl:'savevidly.xyz', groups:[
      { id:'avd', executionKind:'android-avd', browser:'chrome-android', androidAvdName:'Pixel_B', instances:1, sessionDurationSeconds:25, proxySource:'none' },
    ] }],
    concurrency:1, headless:false, interactionIndicator:false,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://api64.ipify.org?format=json' } },
    steps:[],
  };

  const events = [];
  const result = await executeQaRun({
    runId:'matrix-avd', request, screenshotsRoot:'/tmp', emit:(event)=>events.push(event), androidService, playwrightImpl, sessionLifetimeFactory:lifetimeFactory,
  });

  assert.equal(result.completed, 1, JSON.stringify(events));
  assert.deepEqual(durations, [25000]);
  assert.equal(deviceState.closed, 1);
  assert.deepEqual(deviceState.stopped, ['emulator-5556']);
});

test('v0.8 matrix delegates each Real iOS work unit to the provider adapter with independent metadata', async () => {
  const calls = [];
  const realIosService = {
    runWorkUnit: async (args) => {
      calls.push(args);
      return { sessionId: 'remote-1', diagnostics: { observed: {} } };
    },
  };
  const request = {
    targets:[{ id:'save', targetUrl:'savevidly.xyz', groups:[
      { id:'ios', executionKind:'real-ios', browser:'safari-ios', realIos:{ device:'iPhone 15', iosVersion:'17', browser:'safari' }, instances:1, sessionDurationSeconds:30, proxySource:'none' },
    ] }],
    concurrency:1, headless:false, interactionIndicator:true,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://api64.ipify.org?format=json' } },
    steps:[{ id:'wait-1', type:'wait', ms:1 }],
  };

  const result = await executeQaRun({
    runId:'matrix-real-ios', request, screenshotsRoot:'/tmp', emit:()=>{}, realIosService,
    playwrightImpl: fakeRunnerPlaywright(),
  });

  assert.equal(result.completed, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].workUnit.workId, 'save-ios-instance-1');
  assert.equal(calls[0].workUnit.sessionDurationSeconds, 30);
  assert.equal(calls[0].steps[0].type, 'wait');
});



test('prefers OrbitQA verified current Android profile over a stale Playwright descriptor', () => {
  const staleDescriptor = {
    viewport: { width: 412, height: 915 },
    screen: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 11) AppleWebKit/537.36 Chrome/153.0.0.0 Mobile Safari/537.36',
  };
  const fakePlaywright = { devices: { 'Pixel 11': staleDescriptor } };

  const options = resolveAndroidEmulationContextOptions(fakePlaywright, {
    deviceName: 'Pixel 11', locale: 'en-GB', timezoneId: 'Europe/London',
  });

  assert.match(options.userAgent,/Android 17; Pixel 11/);
  assert.deepEqual(options.viewport, { width: 412, height: 923 });
  assert.equal(options.deviceScaleFactor, 2.625);
  assert.equal(options.locale, 'en-GB');
  assert.equal(options.timezoneId, 'Europe/London');
  assert.deepEqual(options.permissions, []);
});

test('matrix Android emulation emits device identity diagnostics before behavior', async () => {
  const state = {
    identityRuntime: {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/153.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l', maxTouchPoints: 5,
      viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 },
      devicePixelRatio: 2.625, locale: 'en-US', timezoneId: 'UTC',
      webdriver: true, hardwareConcurrency: 8, deviceMemory: 8,
    },
  };
  const playwrightImpl = fakeRunnerPlaywright(state);
  playwrightImpl.devices['Pixel 7'] = {
    viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 },
    deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
    userAgent: state.identityRuntime.userAgent,
  };
  const events = [];
  const lifetimeFactory = ({ context, durationMs }) => ({
    reason: null, expired: false, remainingMs: () => durationMs,
    throwIfExpired() {}, wait: async () => {},
    waitUntilClosed: async () => { await context.close(); return 'duration-elapsed'; },
    close: async () => context.close(),
  });
  const request = {
    targets:[{ id:'a', targetUrl:'example.com', groups:[
      { id:'g', executionKind:'android-emulation', browser:'chrome-android', deviceProfile:'Pixel 7', instances:1, sessionDurationSeconds:5, proxySource:'none' },
    ] }],
    concurrency:1, headless:true, interactionIndicator:false,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://api64.ipify.org?format=json' } },
    steps:[],
  };

  const result = await executeQaRun({ runId:'identity-android-pass', request, screenshotsRoot:'/tmp', emit:(event)=>events.push(event), playwrightImpl, sessionLifetimeFactory:lifetimeFactory });

  assert.equal(result.completed, 1);
  const identity = events.find((event) => event.type === 'identity-diagnostics');
  assert.ok(identity);
  assert.equal(identity.identityDiagnostics.blocked, false);
  assert.equal(identity.identityDiagnostics.overall, 'pass');
  assert.equal(identity.identityDiagnostics.profile, 'Pixel 7');
  assert.match(identity.message, /passed/i);
});

test('matrix Android emulation fails closed on a critical device identity contradiction', async () => {
  const state = {
    identityRuntime: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/153.0.0.0 Safari/537.36',
      platform: 'Win32', maxTouchPoints: 0,
      viewport: { width: 1280, height: 720 }, screen: { width: 1920, height: 1080 },
      devicePixelRatio: 1, locale: 'en-US', timezoneId: 'UTC',
      webdriver: true, hardwareConcurrency: 8, deviceMemory: 8,
    },
  };
  const playwrightImpl = fakeRunnerPlaywright(state);
  playwrightImpl.devices['Pixel 7'] = {
    viewport: { width: 412, height: 915 }, screen: { width: 412, height: 915 },
    deviceScaleFactor: 2.625, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/153.0.0.0 Mobile Safari/537.36',
  };
  const events = [];
  const request = {
    targets:[{ id:'a', targetUrl:'example.com', groups:[
      { id:'g', executionKind:'android-emulation', browser:'chrome-android', deviceProfile:'Pixel 7', instances:1, sessionDurationSeconds:5, proxySource:'none' },
    ] }],
    concurrency:1, headless:true, interactionIndicator:false,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://api64.ipify.org?format=json' } },
    steps:[],
  };

  const result = await executeQaRun({ runId:'identity-android-fail', request, screenshotsRoot:'/tmp', emit:(event)=>events.push(event), playwrightImpl });

  assert.equal(result.completed, 0);
  assert.equal(result.failed, 1);
  const identity = events.find((event) => event.type === 'identity-diagnostics');
  assert.equal(identity.identityDiagnostics.blocked, true);
  assert.match(events.find((event) => event.type === 'session-error').message, /Device identity consistency blocked/i);
});

test('v0.8 acceptance smoke runs independent Desktop, Android-emulation, and iPhone compatibility work units together', async () => {
  const state = {};
  const playwrightImpl = fakeRunnerPlaywright(state);
  playwrightImpl.devices['iPhone 13'] = {
    viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3,
    hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  };
  const lifetimeFactory = ({ context, durationMs }) => {
    let reason = null;
    return {
      get reason(){ return reason; }, get expired(){ return reason === 'duration-elapsed'; },
      remainingMs: () => reason ? 0 : durationMs,
      throwIfExpired(){}, wait: async () => {},
      waitUntilClosed: async () => { if (!reason) { reason = 'duration-elapsed'; await context.close(); } return reason; },
      close: async (next) => { if (!reason) { reason = next; await context.close(); } return reason; },
    };
  };
  const request = {
    targets:[{ id:'save', targetUrl:'savevidly.xyz', groups:[
      { id:'desk', executionKind:'desktop', browser:'chromium', instances:2, sessionDurationSeconds:5, proxySource:'none' },
      { id:'mobile', executionKind:'android-emulation', browser:'chrome-android', deviceProfile:'Pixel 7', instances:2, sessionDurationSeconds:5, proxySource:'none' },
      { id:'iphone', executionKind:'ios-emulation', browser:'safari-ios', deviceProfile:'iPhone 13', orientation:'portrait', locale:'en-US', timezoneId:'UTC', instances:2, sessionDurationSeconds:5, proxySource:'none' },
    ] }],
    concurrency:3, headless:true, interactionIndicator:false,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://api64.ipify.org?format=json' } },
    steps:[],
  };

  const events = [];
  const result = await executeQaRun({
    runId:'matrix-smoke', request, screenshotsRoot:'/tmp', emit:(event)=>events.push(event), playwrightImpl, sessionLifetimeFactory:lifetimeFactory,
  });

  assert.deepEqual(result, { total:6, requested:6, running:0, queued:0, completed:6, failed:0, cancelled:0, incomplete:0, durationMs: result.durationMs }, JSON.stringify(events.filter((event)=>event.type==='session-error')));
  assert.equal(state.contextCreatedCount, 6);
  assert.equal(state.clearPermissionsCount, 6);
});

test('v0.8 rejects proxy settings that dedicated AVD and Real iOS paths cannot apply', () => {
  const base = {
    concurrency:1, headless:false, interactionIndicator:true,
    privacy:{ strictMode:true, proxy:{ enabled:true, server:'http://manual.test:8080', username:'', password:'', requireVerifiedRoute:true, routeCheckUrl:'https://api64.ipify.org?format=json' } },
    steps:[],
  };
  assert.throws(() => normalizeQaRunRequest({
    ...base,
    targets:[{ id:'a', targetUrl:'example.com', groups:[
      { id:'g', executionKind:'android-avd', browser:'chrome-android', androidAvdName:'Pixel_A', instances:1, sessionDurationSeconds:30, proxySource:'manual' },
    ] }],
  }), /proxy.*not available.*Android AVD/i);
  assert.throws(() => normalizeQaRunRequest({
    ...base,
    targets:[{ id:'i', targetUrl:'example.com', groups:[
      { id:'g', executionKind:'real-ios', browser:'safari-ios', realIos:{ device:'iPhone 15', iosVersion:'17', browser:'safari' }, instances:1, sessionDurationSeconds:30, proxySource:'manual' },
    ] }],
  }), /proxy.*not available.*Real iOS/i);
});

test('v0.8 rejects inconsistent Real iOS browser identity and provider capability selection', () => {
  const base = {
    concurrency:1, headless:false, interactionIndicator:true,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://api64.ipify.org?format=json' } },
    steps:[],
  };
  assert.throws(() => normalizeQaRunRequest({
    ...base,
    targets:[{ id:'i', targetUrl:'example.com', groups:[
      { id:'g', executionKind:'real-ios', browser:'chromium', realIos:{ device:'iPhone 15', iosVersion:'17', browser:'safari' }, instances:1, sessionDurationSeconds:30, proxySource:'none' },
    ] }],
  }), /Safari iOS or Chrome iOS/i);
  assert.throws(() => normalizeQaRunRequest({
    ...base,
    targets:[{ id:'i', targetUrl:'example.com', groups:[
      { id:'g', executionKind:'real-ios', browser:'chrome-ios', realIos:{ device:'iPhone 15', iosVersion:'17', browser:'safari' }, instances:1, sessionDurationSeconds:30, proxySource:'none' },
    ] }],
  }), /browser selection does not match/i);
});

test('Local iOS compatibility continues when host WebKit reports zero touch points', async () => {
  const state = {
    identityRuntime: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1',
      platform: 'Win32', maxTouchPoints: 0,
      viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 },
      devicePixelRatio: 3, locale: 'en-US', timezoneId: 'UTC',
      webdriver: true, hardwareConcurrency: 4, deviceMemory: null,
    },
  };
  const playwrightImpl = fakeRunnerPlaywright(state);
  playwrightImpl.devices['iPhone 13'] = {
    viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3,
    hasTouch: true, isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6 Mobile/15E148 Safari/604.1',
  };
  const lifetimeFactory = ({ context, durationMs }) => ({
    reason: null, expired: false, remainingMs: () => durationMs,
    throwIfExpired() {}, wait: async () => {},
    waitUntilClosed: async () => { await context.close(); return 'duration-elapsed'; },
    close: async () => context.close(),
  });
  const events = [];
  const request = {
    targets:[{ id:'ios', targetUrl:'example.org', groups:[
      { id:'iphone', executionKind:'ios-emulation', browser:'safari-ios', deviceProfile:'iPhone 13', orientation:'portrait', locale:'en-US', timezoneId:'UTC', instances:1, sessionDurationSeconds:5, proxySource:'none' },
    ] }],
    concurrency:1, headless:true, interactionIndicator:false,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://api64.ipify.org?format=json' } },
    steps:[],
  };

  const result = await executeQaRun({ runId:'ios-zero-touch-host-limit', request, screenshotsRoot:'/tmp', emit:(event)=>events.push(event), playwrightImpl, sessionLifetimeFactory:lifetimeFactory });

  assert.equal(result.completed, 1);
  assert.equal(result.failed, 0);
  const identity = events.find((event) => event.type === 'identity-diagnostics');
  assert.ok(identity);
  assert.equal(identity.identityDiagnostics.blocked, false);
  const touch = identity.identityDiagnostics.checks.find((item) => item.key === 'touch');
  assert.equal(touch.status, 'not-applicable');
  assert.equal(touch.classification, 'host-runtime');
  assert.equal(identity.identityDiagnostics.profileConsistency, 'pass');
  assert.equal(identity.identityDiagnostics.functionalCompatibility.iosTap, 'pass');
});


test('session integrity blocks a required static proxy when the route changes', () => {
  const report = buildSessionIntegrityReport({
    proxySource: 'static',
    proxyRequired: true,
    initialRoute: { directIp: '198.51.100.10', proxiedIp: '203.0.113.20', error: null },
    finalRoute: { directIp: '198.51.100.10', proxiedIp: '203.0.113.21', error: null },
    privacyReport: { observed: { webRtcSupported: true, literalIpCandidates: [], locale: 'en-US', timezoneId: 'UTC' } },
    identityReport: { overall: 'pass', blocked: false, checks: [] },
  });

  assert.equal(report.blocked, true);
  assert.equal(report.overall, 'fail');
  assert.equal(report.checks.find((check) => check.key === 'route-continuity')?.status, 'fail');
});

test('session integrity blocks a required proxy when WebRTC exposes the host direct IP', () => {
  const report = buildSessionIntegrityReport({
    proxySource: 'manual',
    proxyRequired: true,
    initialRoute: { directIp: '198.51.100.10', proxiedIp: '203.0.113.20', error: null },
    finalRoute: { directIp: '198.51.100.10', proxiedIp: '203.0.113.20', error: null },
    privacyReport: { observed: { webRtcSupported: true, literalIpCandidates: ['198.51.100.10'], locale: 'en-US', timezoneId: 'UTC' } },
    identityReport: { overall: 'pass', blocked: false, checks: [] },
  });

  assert.equal(report.blocked, true);
  assert.equal(report.checks.find((check) => check.key === 'webrtc-ip-exposure')?.status, 'fail');
});

test('session integrity warns but does not block when a rotating proxy changes exit IP', () => {
  const report = buildSessionIntegrityReport({
    proxySource: 'rotating',
    proxyRequired: true,
    initialRoute: { directIp: '198.51.100.10', proxiedIp: '203.0.113.20', error: null },
    finalRoute: { directIp: '198.51.100.10', proxiedIp: '203.0.113.21', error: null },
    privacyReport: { observed: { webRtcSupported: true, literalIpCandidates: [], locale: 'en-US', timezoneId: 'UTC' } },
    identityReport: { overall: 'pass', blocked: false, checks: [] },
  });

  assert.equal(report.blocked, false);
  assert.equal(report.overall, 'warning');
  assert.equal(report.checks.find((check) => check.key === 'route-continuity')?.status, 'warning');
});

test('emits a per-work-unit session integrity report after proxy route verification', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ routeIps: ['203.0.113.20', '203.0.113.20'] });
  const events = [];
  const request = { ...poolRunnerRequest(1), steps: [{ id: 'wait-1', type: 'wait', ms: 1 }] };

  const result = await executeQaRun({
    runId: 'run-session-integrity',
    request,
    screenshotsRoot: '/tmp',
    emit: (event) => events.push(event),
    proxyPoolService: pool,
    playwrightImpl,
  });

  assert.equal(result.completed, 1);
  const integrityEvent = events.filter((event) => event.type === 'session-integrity').at(-1);
  assert.ok(integrityEvent, 'expected a session-integrity event');
  assert.equal(integrityEvent.sessionIntegrity.blocked, false);
  assert.equal(integrityEvent.sessionIntegrity.observed.initialExitIp, '203.0.113.20');
  assert.equal(integrityEvent.sessionIntegrity.observed.finalExitIp, '203.0.113.20');
  assert.equal(integrityEvent.sessionIntegrity.checks.find((check) => check.key === 'route-continuity')?.status, 'pass');
});

test('blocks a static proxy work unit when its browser exit IP changes during the session', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ routeIps: ['203.0.113.20', '203.0.113.21'] });
  const events = [];
  const request = { ...poolRunnerRequest(1, 'static'), steps: [{ id: 'wait-1', type: 'wait', ms: 1 }] };

  const result = await executeQaRun({
    runId: 'run-static-continuity',
    request,
    screenshotsRoot: '/tmp',
    emit: (event) => events.push(event),
    proxyPoolService: pool,
    playwrightImpl,
  });

  assert.equal(result.completed, 0);
  assert.equal(result.failed, 1);
  const integrityEvent = events.filter((event) => event.type === 'session-integrity').at(-1);
  assert.ok(integrityEvent, 'expected a session-integrity event');
  assert.equal(integrityEvent.sessionIntegrity.blocked, true);
  assert.equal(integrityEvent.sessionIntegrity.checks.find((check) => check.key === 'route-continuity')?.status, 'fail');
  assert.equal(events.some((event) => event.type === 'session-complete'), false);
});

test('manual proxy route is verified from the launched browser before target navigation and after behavior', async () => {
  const playwrightImpl = fakeRunnerPlaywright({ failRequest: true, routeIps: ['203.0.113.30', '203.0.113.30'] });
  const events = [];
  const request = {
    ...poolRunnerRequest(1, 'manual'),
    steps: [{ id: 'wait-1', type: 'wait', ms: 1 }],
    privacy: {
      strictMode: true,
      proxy: {
        enabled: true,
        server: 'http://manual.test:8080',
        username: 'alice',
        password: 'secret',
        requireVerifiedRoute: true,
        routeCheckUrl: 'https://check.test/ip',
      },
    },
  };
  const oldFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ip: '198.51.100.10' }) });
  try {
    const result = await executeQaRun({
      runId: 'run-manual-browser-route', request, screenshotsRoot: '/tmp',
      emit: (event) => events.push(event), playwrightImpl,
    });
    assert.equal(result.completed, 1);
    assert.deepEqual(playwrightImpl.navigations, ['https://check.test/ip', 'https://example.com', 'https://check.test/ip']);
    assert.equal(playwrightImpl.launches[0].proxy?.server, 'http://manual.test:8080');
    const integrity = events.filter((event) => event.type === 'session-integrity').at(-1)?.sessionIntegrity;
    assert.equal(integrity?.verdict, 'verified');
    assert.equal(integrity?.observed.initialExitIp, '203.0.113.30');
    assert.equal(integrity?.observed.finalExitIp, '203.0.113.30');
  } finally {
    global.fetch = oldFetch;
  }
});

test('matrix static proxy blocks only its work unit when exit route changes', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ routeIps: ['203.0.113.40', '203.0.113.41'] });
  const events = [];
  const request = {
    targets: [{ id: 'target-a', targetUrl: 'https://example.com', groups: [
      { id: 'static-a', executionKind: 'desktop', browser: 'chromium', instances: 1, sessionDurationSeconds: 30, proxySource: 'static' },
    ] }],
    concurrency: 1,
    headless: true,
    interactionIndicator: false,
    privacy: { strictMode: true, proxy: { enabled: false, server: '', username: '', password: '', requireVerifiedRoute: false, routeCheckUrl: 'https://check.test/ip' } },
    steps: [{ id: 'wait-1', type: 'wait', ms: 1 }],
  };
  const result = await executeQaRun({
    runId: 'matrix-static-integrity', request, screenshotsRoot: '/tmp',
    emit: (event) => events.push(event), proxyPoolService: pool, playwrightImpl,
  });
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 1);
  const integrityEvent = events.filter((event) => event.type === 'session-integrity').at(-1);
  assert.equal(integrityEvent?.sessionIntegrity?.blocked, true);
  assert.equal(integrityEvent?.workId, 'target-a-static-a-instance-1');
});

test('preflight direct-route fallback emits a blocked session integrity report before target navigation', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ routeIps: ['198.51.100.10'] });
  const events = [];
  const result = await executeQaRun({
    runId: 'run-preflight-integrity-block',
    request: poolRunnerRequest(1, 'static'),
    screenshotsRoot: '/tmp',
    emit: (event) => events.push(event),
    proxyPoolService: pool,
    playwrightImpl,
  });
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 1);
  assert.deepEqual(playwrightImpl.navigations, ['https://check.test/ip']);
  const integrity = events.filter((event) => event.type === 'session-integrity').at(-1)?.sessionIntegrity;
  assert.equal(integrity?.blocked, true);
  assert.equal(integrity?.checks.find((check) => check.key === 'direct-fallback')?.status, 'fail');
  assert.match(events.find((event) => event.type === 'session-error')?.message || '', /Proxy route verification failed inside the browser session/i);
});

test('matrix rotating proxy retries a failed preflight route check once with a fresh browser route', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({
    failRouteCheckLaunches: [1],
    routeIp: '203.0.113.77',
  });
  const events = [];
  const lifetimeFactory = ({ context, durationMs, signal }) => {
    let reason = null;
    return {
      get reason(){ return reason; }, get expired(){ return reason === 'duration-elapsed'; },
      remainingMs: () => reason ? 0 : durationMs,
      throwIfExpired(){ if (signal?.aborted) { const e = new Error('QA run stopped by user'); e.name = 'AbortError'; throw e; } },
      wait: async () => {},
      waitUntilClosed: async () => { if (!reason) { reason = 'duration-elapsed'; await context.close(); } return reason; },
      close: async (next) => { if (!reason) { reason = next; await context.close(); } return reason; },
    };
  };

  const result = await executeQaRun({
    runId: 'matrix-rotating-preflight-retry',
    request: {
      targets:[{ id:'preflight-target', targetUrl:'https://example.com', groups:[
        { id:'preflight-group', executionKind:'desktop', browser:'chromium', instances:1, sessionDurationSeconds:30, proxySource:'rotating' },
      ] }],
      concurrency:1, headless:true, interactionIndicator:false,
      privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://check.test/ip' } },
      steps:[],
    },
    screenshotsRoot: '/tmp',
    emit: (event) => events.push(event),
    proxyPoolService: pool,
    playwrightImpl, sessionLifetimeFactory:lifetimeFactory,
  });

  assert.equal(result.completed, 1);
  assert.equal(result.failed, 0);
  assert.equal(playwrightImpl.launches.length, 2);
  assert.equal(pool.allocations.length, 2);
  assert.equal(pool.releases.length, 2);
  assert.equal(events.some((event) => /proxy route check failed.*fresh browser route/i.test(event.message || '')), true);
  assert.equal(events.filter((event) => event.type === 'session-error').length, 0);
});

test('matrix rotating proxy retries target navigation once with a fresh browser route', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({
    failTargetNavigationLaunches: [1],
    routeIp: '203.0.113.77',
  });
  const events = [];
  const lifetimeFactory = ({ context, durationMs, signal }) => {
    let reason = null;
    return {
      get reason(){ return reason; }, get expired(){ return reason === 'duration-elapsed'; },
      remainingMs: () => reason ? 0 : durationMs,
      throwIfExpired(){ if (signal?.aborted) { const e = new Error('QA run stopped by user'); e.name = 'AbortError'; throw e; } },
      wait: async () => {},
      waitUntilClosed: async () => { if (!reason) { reason = 'duration-elapsed'; await context.close(); } return reason; },
      close: async (next) => { if (!reason) { reason = next; await context.close(); } return reason; },
    };
  };
  const request = {
    targets:[{ id:'retry-target', targetUrl:'https://example.com', groups:[
      { id:'retry-group', executionKind:'desktop', browser:'chromium', instances:1, sessionDurationSeconds:30, proxySource:'rotating' },
    ] }],
    concurrency:1, headless:true, interactionIndicator:false,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://check.test/ip' } },
    steps:[],
  };

  const result = await executeQaRun({
    runId:'matrix-rotating-retry', request, screenshotsRoot:'/tmp', emit:(event)=>events.push(event),
    proxyPoolService:pool, playwrightImpl, sessionLifetimeFactory:lifetimeFactory,
  });

  assert.equal(result.completed, 1);
  assert.equal(result.failed, 0);
  assert.equal(playwrightImpl.launches.length, 2);
  assert.equal(pool.allocations.length, 2);
  assert.equal(pool.releases.length, 2);
  assert.equal(events.some((event) => /retrying once with a fresh browser route/i.test(event.message || '')), true);
  assert.equal(events.filter((event) => event.type === 'session-error').length, 0);
});

test('matrix static proxy does not auto-retry target navigation failures', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ failTargetNavigationLaunches: [1] });
  const events = [];
  const request = {
    targets:[{ id:'static-target', targetUrl:'https://example.com', groups:[
      { id:'static-group', executionKind:'desktop', browser:'chromium', instances:1, sessionDurationSeconds:30, proxySource:'static' },
    ] }],
    concurrency:1, headless:true, interactionIndicator:false,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://check.test/ip' } },
    steps:[],
  };

  const result = await executeQaRun({
    runId:'matrix-static-no-retry', request, screenshotsRoot:'/tmp', emit:(event)=>events.push(event),
    proxyPoolService:pool, playwrightImpl,
  });

  assert.equal(result.completed, 0);
  assert.equal(result.failed, 1);
  assert.equal(playwrightImpl.launches.length, 1);
  assert.equal(pool.allocations.length, 1);
  assert.equal(events.some((event) => /retrying once with a fresh browser route/i.test(event.message || '')), false);
});

test('matrix rotating proxy retries target navigation at most once', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ failTargetNavigationLaunches: [1, 2] });
  const events = [];
  const request = {
    targets:[{ id:'retry-limit-target', targetUrl:'https://example.com', groups:[
      { id:'retry-limit-group', executionKind:'desktop', browser:'chromium', instances:1, sessionDurationSeconds:30, proxySource:'rotating' },
    ] }],
    concurrency:1, headless:true, interactionIndicator:false,
    privacy:{ strictMode:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://check.test/ip' } },
    steps:[],
  };

  const result = await executeQaRun({
    runId:'matrix-rotating-retry-limit', request, screenshotsRoot:'/tmp', emit:(event)=>events.push(event),
    proxyPoolService:pool, playwrightImpl,
  });

  assert.equal(result.completed, 0);
  assert.equal(result.failed, 1);
  assert.equal(playwrightImpl.launches.length, 2);
  assert.equal(pool.allocations.length, 2);
  assert.equal(events.filter((event) => /retrying once with a fresh browser route/i.test(event.message || '')).length, 1);
});

test('behavior scroll retries once after an execution-context navigation race', async () => {
  const logs = [];
  const deltas = [];
  let evaluateCalls = 0;
  let settleCalls = 0;
  const page = {
    async evaluate(_fn, delta) {
      evaluateCalls += 1;
      if (evaluateCalls === 1) throw new Error('page.evaluate: Execution context was destroyed, most likely because of a navigation');
      deltas.push(delta);
    },
    async waitForLoadState(state) { assert.equal(state, 'domcontentloaded'); settleCalls += 1; },
    async waitForTimeout() {},
  };
  const context = { sessionId: 1, stepNumber: 1, screenshotDir: '/tmp', emit: (event) => logs.push(event.message) };

  await executeStep(page, { id: 'scroll-nav', type: 'scroll', direction: 'down', distance: 130 }, context);

  assert.equal(settleCalls, 1);
  assert.deepEqual(deltas, [65, 65]);
  assert.equal(logs.some((message) => /resuming scroll after page navigation/i.test(message || '')), true);
});

test('behavior screenshot waits for navigation and retries once', async () => {
  const logs = [];
  let screenshotCalls = 0;
  let settleCalls = 0;
  const page = {
    async screenshot() {
      screenshotCalls += 1;
      if (screenshotCalls === 1) throw new Error('Execution context was destroyed, most likely because of a navigation');
    },
    async waitForLoadState(state) { assert.equal(state, 'domcontentloaded'); settleCalls += 1; },
  };
  const context = { workId: 'target-1', sessionId: 1, stepNumber: 2, screenshotDir: '/tmp', emit: (event) => logs.push(event.message) };

  await executeStep(page, { id: 'shot-nav', type: 'screenshot', fullPage: true }, context);

  assert.equal(screenshotCalls, 2);
  assert.equal(settleCalls, 1);
  assert.equal(logs.some((message) => /resuming screenshot after page navigation/i.test(message || '')), true);
  assert.equal(logs.some((message) => /Screenshot saved:/i.test(message || '')), true);
});

test('behavior click does not repeat a possibly successful action after a navigation race', async () => {
  const logs = [];
  let clickCalls = 0;
  let settleCalls = 0;
  const target = {
    async scrollIntoViewIfNeeded() {},
    async click() {
      clickCalls += 1;
      throw new Error('Execution context was destroyed, most likely because of a navigation');
    },
  };
  const page = {
    locator() { return { first: () => target }; },
    async waitForLoadState() { settleCalls += 1; },
  };
  const context = { sessionId: 1, stepNumber: 1, screenshotDir: '/tmp', emit: (event) => logs.push(event.message) };

  await executeStep(page, { id: 'click-nav', type: 'click', selector: '#go' }, context);

  assert.equal(clickCalls, 1);
  assert.equal(settleCalls, 1);
  assert.equal(logs.some((message) => /continuing without repeating click/i.test(message || '')), true);
});

test('behavior type does not duplicate partially typed text after a navigation race', async () => {
  const logs = [];
  const typed = [];
  let settleCalls = 0;
  const target = {
    async scrollIntoViewIfNeeded() {},
    async fill(value) { typed.push(['fill', value]); },
    async pressSequentially(value) {
      typed.push(['type', value]);
      throw new Error('Execution context was destroyed, most likely because of a navigation');
    },
  };
  const page = {
    locator() { return { first: () => target }; },
    async waitForLoadState() { settleCalls += 1; },
  };
  const context = { sessionId: 1, stepNumber: 1, screenshotDir: '/tmp', emit: (event) => logs.push(event.message) };

  await executeStep(page, { id: 'type-nav', type: 'type', selector: '#field', value: 'OrbitQA' }, context);

  assert.deepEqual(typed, [['fill', ''], ['type', 'OrbitQA']]);
  assert.equal(settleCalls, 1);
  assert.equal(logs.some((message) => /continuing without repeating type/i.test(message || '')), true);
});

test('behavior recovery does not hide ordinary interaction errors', async () => {
  const target = {
    async scrollIntoViewIfNeeded() {},
    async click() { throw new Error('selector did not become actionable'); },
  };
  const page = { locator() { return { first: () => target }; } };
  const context = { sessionId: 1, stepNumber: 1, screenshotDir: '/tmp', emit: () => {} };

  await assert.rejects(
    executeStep(page, { id: 'click-real-error', type: 'click', selector: '#missing' }, context),
    /selector did not become actionable/
  );
});

test('smart interaction navigation race ends that step safely instead of failing the work unit', async () => {
  const logs = [];
  let settleCalls = 0;
  const page = {
    async waitForTimeout() {},
    async waitForLoadState() { settleCalls += 1; },
  };
  const resolver = {
    async resolveLoop() {
      throw new Error('Execution context was destroyed, most likely because of a navigation');
    },
  };
  const context = {
    sessionId: 1,
    stepNumber: 1,
    screenshotDir: '/tmp',
    resolver,
    emit: (event) => logs.push(event.message),
  };

  await executeStep(page, { id: 'smart-nav', type: 'smart-interaction', value: 'OrbitQA' }, context);

  assert.equal(settleCalls, 1);
  assert.equal(logs.some((message) => /continuing without repeating smart interaction/i.test(message || '')), true);
});

test('v0.11 matrix requests default to Auto QA when the UI sends no manual steps', () => {
  const normalized = normalizeQaRunRequest({
    targets: [{ id:'t1', targetUrl:'https://example.org', groups:[{ id:'g1', executionKind:'desktop', browser:'chromium', instances:1, sessionDurationSeconds:60, proxySource:'none' }] }],
    concurrency: { mode:'manual', value:1 },
    headless: false,
    interactionIndicator: true,
    steps: [],
    privacy: { strictMode:false, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://api64.ipify.org?format=json' } },
  });

  assert.deepEqual(normalized.autoQa, {
    behaviorMode: 'auto',
    readingPace: 'natural',
    safeFormActions: true,
    observeNewTabs: true,
    directAutoType: false,
    referrerMode: 'direct',
    customReferrer: undefined,
  });
});

test('legacy v2 requests with manual steps but no Auto QA settings stay manual', () => {
  const normalized = normalizeQaRunRequest({
    targets: [{ id:'t1', targetUrl:'https://example.org', groups:[{ id:'g1', executionKind:'desktop', browser:'chromium', instances:1, sessionDurationSeconds:60, proxySource:'none' }] }],
    concurrency: { mode:'manual', value:1 },
    headless: false,
    interactionIndicator: true,
    steps: [{ id:'wait-1', type:'wait', ms:1000 }],
    privacy: { strictMode:false, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://api64.ipify.org?format=json' } },
  });

  assert.equal(normalized.autoQa.behaviorMode, 'manual');
  assert.equal(normalized.steps.length, 1);
});

test('custom simulated referrer must use https', () => {
  assert.throws(() => normalizeQaRunRequest({
    targets: [{ id:'t1', targetUrl:'https://example.org', groups:[{ id:'g1', executionKind:'desktop', browser:'chromium', instances:1, sessionDurationSeconds:60, proxySource:'none' }] }],
    concurrency: { mode:'manual', value:1 },
    headless: false,
    interactionIndicator: true,
    steps: [],
    autoQa: { behaviorMode:'auto', readingPace:'natural', safeFormActions:true, observeNewTabs:true, referrerMode:'custom-simulated', customReferrer:'http://example.net/' },
    privacy: { strictMode:false, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false, routeCheckUrl:'https://api64.ipify.org?format=json' } },
  }), /https/i);
});

test('Auto QA behavior runs through the adaptive engine while manual mode keeps legacy steps', async () => {
  assert.equal(typeof executeConfiguredBehavior, 'function');
  const logs = [];
  let autoCalls = 0;
  let manualCalls = 0;
  const common = {
    page:{}, context:{}, workUnit:{ workId:'w-auto', executionKind:'desktop' }, sessionId:1, screenshotDir:'/tmp',
    lifetime:{ throwIfExpired(){}, remainingMs:()=>50000 }, resolver:null, indicator:null, indicatorMode:'desktop', pacing:{}, signal:null,
    pushWork:(event)=>logs.push(event.message),
  };
  await executeConfiguredBehavior({ ...common, settings:{ autoQa:{ behaviorMode:'auto', readingPace:'natural', safeFormActions:true, observeNewTabs:true, referrerMode:'direct' } }, normalized:{ steps:[{id:'wait-1',type:'wait',ms:1}] }, runAutoQaImpl:async()=>{ autoCalls += 1; return { terminalReason:'complete' }; }, executeStepImpl:async()=>{ manualCalls += 1; } });
  assert.equal(autoCalls, 1);
  assert.equal(manualCalls, 0);

  await executeConfiguredBehavior({ ...common, settings:{ autoQa:{ behaviorMode:'manual', readingPace:'natural', safeFormActions:true, observeNewTabs:true, referrerMode:'direct' } }, normalized:{ steps:[{id:'wait-1',type:'wait',ms:1}] }, runAutoQaImpl:async()=>{ autoCalls += 1; }, executeStepImpl:async()=>{ manualCalls += 1; } });
  assert.equal(manualCalls, 1);
});

test('target navigation options add only an explicit simulated referrer', () => {
  assert.equal(typeof buildTargetNavigationOptions, 'function');
  assert.deepEqual(buildTargetNavigationOptions({ referrerMode:'direct' }, 12000), { waitUntil:'domcontentloaded', timeout:12000 });
  const simulated = buildTargetNavigationOptions({ referrerMode:'google-simulated' }, 12000);
  assert.equal(simulated.referer, 'https://www.google.com/');
  assert.equal(simulated.waitUntil, 'domcontentloaded');
});

test('v0.11 Real iOS Auto QA ignores dormant manual smart-interaction steps while manual mode still rejects them', () => {
  const base = {
    targets:[{ id:'t', targetUrl:'https://example.com', groups:[{
      id:'ios', executionKind:'real-ios', browser:'safari-ios', realIos:{ device:'iPhone 15', iosVersion:'17', browser:'safari' },
      instances:1, sessionDurationSeconds:30, proxySource:'none',
    }] }],
    concurrency:{ mode:'manual', value:1 }, headless:false, interactionIndicator:true,
    steps:[{ id:'smart-1', type:'smart-interaction', value:'OrbitQA test' }],
  };
  assert.doesNotThrow(() => normalizeQaRunRequest({ ...base, autoQa:{ behaviorMode:'auto', readingPace:'natural', safeFormActions:true, observeNewTabs:true, referrerMode:'direct' } }));
  assert.throws(() => normalizeQaRunRequest({ ...base, autoQa:{ behaviorMode:'manual', readingPace:'natural', safeFormActions:true, observeNewTabs:true, referrerMode:'direct' } }), /Smart QA Interaction is not available for Real iOS Device runs yet/);
});

test('normalizes v0.12 URL-pool device-matrix requests without target/group product caps', () => {
  const request = normalizeQaRunRequest({
    version: 3,
    urlPool: ['example.com', 'https://b.example/'],
    runSeed: 'seed-1',
    proxyMode: 'general',
    generalProxy: { source: 'rotating', allowSlowProxies: true },
    devices: {
      desktop: { enabled: true, browsers: ['chromium', 'firefox'], instancesPerBrowser: 25000, sessionDurationSeconds: 60, proxy: { source: 'none', allowSlowProxies: false } },
      androidEmulation: { enabled: false, profiles: ['Pixel 7'], instancesPerProfile: 1, sessionDurationSeconds: 60, proxy: { source: 'none', allowSlowProxies: false } },
      iosEmulation: { enabled: false, browsers: ['safari-ios'], profiles: ['iPhone 13'], instancesPerProfile: 1, sessionDurationSeconds: 60, orientation: 'portrait', locale: 'en-US', timezoneId: 'UTC', proxy: { source: 'none', allowSlowProxies: false } },
      androidAvd: { enabled: false, avdNames: [], sessionDurationSeconds: 60 },
      realIos: { enabled: false, selections: [], sessionDurationSeconds: 60 },
    },
    concurrency: { mode: 'manual', value: 250 },
    headless: false,
    interactionIndicator: true,
    autoQa: { behaviorMode: 'auto', readingPace: 'natural', safeFormActions: true, observeNewTabs: true, referrerMode: 'direct' },
    steps: [],
    privacy: { strictMode: true, permissions: { camera: 'deny', microphone: 'deny', geolocation: 'deny', notifications: 'deny' }, proxy: { enabled: false, server: '' } },
  });
  assert.equal(request.version, 3);
  assert.deepEqual(request.urlPool, ['https://example.com/', 'https://b.example/']);
  assert.equal(request.devices.desktop.instancesPerBrowser, 25000);
  assert.deepEqual(request.concurrency, { mode: 'manual', value: 250 });
});

test('maps v3 work-unit descriptors through the existing per-work-unit runtime adapter', () => {
  const { iterateWorkUnitsV3 } = require('./work-unit-scheduler.cjs');
  const { settingsForWorkUnit } = require('./qa-runner.cjs');
  const normalized = normalizeQaRunRequest({
    version: 3,
    urlPool: ['https://example.org/'],
    runSeed: 'seed',
    proxyMode: 'per-device',
    generalProxy: { source: 'none', allowSlowProxies: false },
    devices: {
      desktop: { enabled: false, browsers: ['chromium'], instancesPerBrowser: 1, sessionDurationSeconds: 60, proxy: { source: 'none', allowSlowProxies: false } },
      androidEmulation: { enabled: true, profiles: ['Pixel 7'], instancesPerProfile: 1, sessionDurationSeconds: 75, proxy: { source: 'static', allowSlowProxies: true } },
      iosEmulation: { enabled: false, browsers: ['safari-ios'], profiles: ['iPhone 13'], instancesPerProfile: 1, sessionDurationSeconds: 60, orientation: 'portrait', locale: 'en-US', timezoneId: 'UTC', proxy: { source: 'none', allowSlowProxies: false } },
      androidAvd: { enabled: false, avdNames: [], sessionDurationSeconds: 60 },
      realIos: { enabled: false, selections: [], sessionDurationSeconds: 60 },
    },
    concurrency: { mode: 'manual', value: 1 },
    headless: false,
    interactionIndicator: true,
    autoQa: { behaviorMode: 'auto', readingPace: 'natural', safeFormActions: true, observeNewTabs: true, referrerMode: 'direct' },
    steps: [],
    privacy: { strictMode: true, permissions: { camera: 'deny', microphone: 'deny', geolocation: 'deny', notifications: 'deny' }, proxy: { enabled: false, server: '' } },
  });
  const unit = iterateWorkUnitsV3(normalized).next().value;
  const settings = settingsForWorkUnit(normalized, unit);
  assert.equal(settings.targetUrl, 'https://example.org/');
  assert.equal(settings.deviceMode, 'android-emulation');
  assert.equal(settings.deviceName, 'Pixel 7');
  assert.equal(settings.sessionDurationSeconds, 75);
  assert.equal(settings.proxySource, 'static');
  assert.equal(settings.allowSlowProxies, true);
});

test('executeConfiguredBehavior forwards the auxiliary privacy verifier into Auto QA', async () => {
  const verifier = async () => ({ ok:true });
  let received = null;
  await executeConfiguredBehavior({
    settings:{ autoQa:{ behaviorMode:'auto', readingPace:'natural', safeFormActions:true, observeNewTabs:true, referrerMode:'direct' } },
    normalized:{ steps:[] }, page:{}, context:{}, workUnit:{workId:'w-aux-hook',executionKind:'desktop'}, sessionId:1,
    screenshotDir:'/tmp', pushWork:()=>{}, lifetime:{throwIfExpired(){},remainingMs:()=>50000}, resolver:null, indicator:null,
    indicatorMode:'desktop', pacing:{}, signal:null, verifyAuxiliaryPage:verifier,
    runAutoQaImpl:async (args)=>{ received = args?.deps?.verifyAuxiliaryPage; return {terminalReason:'complete'}; },
  });
  assert.equal(received, verifier);
});

test('default auxiliary verifier enforces the shared strict-privacy guard before Auto QA retains a secondary tab', async () => {
  let error = null;
  const auxPage = {
    context:()=>context,
    async evaluate(){ return { webrtc:'available', camera:'prompt', microphone:'denied', geolocation:'denied', notifications:'denied' }; },
  };
  const context = {};
  await executeConfiguredBehavior({
    settings:{ privacy:{strictMode:true}, autoQa:{ behaviorMode:'auto', readingPace:'natural', safeFormActions:true, observeNewTabs:true, referrerMode:'direct' } },
    normalized:{ steps:[] }, page:{}, context, workUnit:{workId:'w-strict-aux',executionKind:'desktop'}, sessionId:1,
    screenshotDir:'/tmp', pushWork:()=>{}, lifetime:{throwIfExpired(){},remainingMs:()=>50000}, resolver:null, indicator:null,
    indicatorMode:'desktop', pacing:{}, signal:null,
    runAutoQaImpl:async (args)=>{
      try { await args.deps.verifyAuxiliaryPage(auxPage); } catch (caught) { error = caught; }
      return {terminalReason:'complete'};
    },
  });
  assert.match(String(error?.message || ''), /camera/i);
});

test('v0.12 activity messages summarize the URL pool and assigned shuffled URL', () => {
  assert.equal(typeof buildV3RunActivityMessages, 'function');
  const normalized = {
    version: 3,
    urlPool: ['https://a.example/', 'https://b.example/'],
    urlPoolStats: { valid: 2, duplicates: 3, invalid: 1 },
  };
  const messages = buildV3RunActivityMessages(normalized, { targetUrl:'https://b.example/' });
  assert.equal(messages.pool, 'URL pool: 2 valid · 3 duplicates removed · 1 invalid');
  assert.equal(messages.assigned, 'Assigned shuffled URL: https://b.example/');
});

test('executeConfiguredBehavior emits ad-summary for LIVE MATRIX after Auto QA', async () => {
  const events = [];
  await executeConfiguredBehavior({
    settings:{ autoQa:{ behaviorMode:'auto', readingPace:'natural', safeFormActions:true, observeNewTabs:true, referrerMode:'direct' } },
    normalized:{ steps:[] }, page:{}, context:{}, workUnit:{workId:'w-ads',executionKind:'desktop'}, sessionId:1,
    screenshotDir:'/tmp', pushWork:(event)=>events.push(event), lifetime:{throwIfExpired(){},remainingMs:()=>50000}, resolver:null, indicator:null,
    indicatorMode:'desktop', pacing:{}, signal:null,
    runAutoQaImpl:async()=>({ terminalReason:'complete', adSummary:{ total:3, observed:3, byType:{banner:2,stickyAnchor:1,interstitialVignette:0,nativeSponsored:0,iframeNetwork:0,unknownAd:0}, status:'pass' } }),
  });
  const event = events.find((item)=>item.type === 'ad-summary');
  assert.ok(event);
  assert.equal(event.adSummary.total, 3);
  assert.equal(event.adSummary.byType.banner, 2);
});


test('matrix smart mix uses the selected underlying proxy kind for session-integrity continuity rules', async () => {
  const pool = fakePoolServiceForRunner();
  pool.allocate = async (kind, owner, options) => {
    assert.equal(kind, 'smart-mix');
    const allocation = { allocationId: owner, proxyId: 'static-picked-1', proxyKind: 'static', server: 'http://proxy.test:8080', username: 'alice', password: 'secret', requireVerifiedRoute: true };
    pool.allocations.push({ kind, owner, options, proxyKind: 'static' });
    return allocation;
  };
  const playwrightImpl = fakeRunnerPlaywright({ routeIps: ['203.0.113.40', '203.0.113.41'] });
  const events = [];
  const request = {
    targets: [{ id: 'target-a', targetUrl: 'https://example.com', groups: [
      { id: 'mix-a', executionKind: 'desktop', browser: 'chromium', instances: 1, sessionDurationSeconds: 30, proxySource: 'smart-mix' },
    ] }],
    concurrency: 1,
    headless: true,
    interactionIndicator: false,
    privacy: { strictMode: true, proxy: { enabled: false, server: '', username: '', password: '', requireVerifiedRoute: false, routeCheckUrl: 'https://check.test/ip' } },
    steps: [{ id: 'wait-1', type: 'wait', ms: 1 }],
  };
  const result = await executeQaRun({
    runId: 'matrix-smart-mix-static-integrity', request, screenshotsRoot: '/tmp',
    emit: (event) => events.push(event), proxyPoolService: pool, playwrightImpl,
  });
  assert.equal(result.completed, 0);
  assert.equal(result.failed, 1);
  const integrity = events.filter((event) => event.type === 'session-integrity').at(-1)?.sessionIntegrity;
  assert.equal(integrity?.checks.find((check) => check.key === 'route-continuity')?.status, 'fail');
});

test('QA runner registers desktop browser resources for force-stop cleanup and unregisters after normal completion', async () => {
  const state = {};
  const playwrightImpl = fakeRunnerPlaywright(state);
  const tracked = [];
  const unregistered = [];
  const runResourceTracker = {
    register(runId, resource) {
      tracked.push({ runId, label:resource.label });
      return () => unregistered.push(resource.label);
    },
  };
  const request = {
    targetUrl:'https://example.com', browser:'chromium', sessions:1, concurrency:1,
    headless:true, steps:[], proxySource:'none',
  };

  const result = await executeQaRun({
    runId:'tracked-desktop-run', request, screenshotsRoot:'/tmp/orbitqa-tracker-test', emit:()=>{}, playwrightImpl, runResourceTracker,
  });

  assert.equal(result.completed, 1);
  assert.ok(tracked.some((entry) => entry.runId === 'tracked-desktop-run' && entry.label === 'desktop-browser'));
  assert.ok(tracked.some((entry) => entry.runId === 'tracked-desktop-run' && entry.label === 'desktop-context'));
  assert.ok(unregistered.includes('desktop-browser'));
  assert.ok(unregistered.includes('desktop-context'));
});

test('resolves verified installed Chrome without silently falling back', () => {
  const { resolveBrowserRuntimeLaunch } = require('./qa-runner.cjs');
  const playwright = { chromium:{ id:'chromium' }, firefox:{ id:'firefox' }, webkit:{ id:'webkit' } };
  const resolved = resolveBrowserRuntimeLaunch({
    settings:{ deviceMode:'desktop', browser:'chromium', browserRuntime:'chrome-installed' },
    playwright,
    chromeRuntimeResolver:() => ({ found:true, executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', source:'program-files' }),
  });
  assert.equal(resolved.launcher, playwright.chromium);
  assert.equal(resolved.browserEngine, 'chromium');
  assert.equal(resolved.executablePath, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.equal(resolved.runtimeKind, 'chrome-installed');
  assert.throws(() => resolveBrowserRuntimeLaunch({
    settings:{ deviceMode:'desktop', browser:'chromium', browserRuntime:'chrome-installed' }, playwright,
    chromeRuntimeResolver:() => ({ found:false }),
  }), /Google Chrome was not found on this PC\. Choose Chromium compatibility or install Google Chrome\./);
});

test('maps Android and iPhone Chrome emulation to installed Chrome while preserving WebKit compatibility', () => {
  const { settingsForWorkUnit, resolveBrowserRuntimeLaunch } = require('./qa-runner.cjs');
  const normalized = { version:3, privacy:{ proxy:{} }, autoQa:{}, steps:[] };
  const android = settingsForWorkUnit(normalized, { targetUrl:'https://example.com', executionKind:'android-emulation', browser:'chrome-android', browserRuntime:'chrome-installed', deviceProfile:'Pixel 7', sessionDurationSeconds:60, proxySource:'none' });
  assert.equal(android.browser, 'chromium');
  assert.equal(android.browserRuntime, 'chrome-installed');
  const iosChrome = settingsForWorkUnit(normalized, { targetUrl:'https://example.com', executionKind:'ios-emulation', browser:'chrome-installed', browserRuntime:'chrome-installed', deviceProfile:'iPhone 13', orientation:'portrait', sessionDurationSeconds:60, proxySource:'none' });
  assert.equal(iosChrome.browser, 'chromium');
  assert.equal(iosChrome.iosBrowser, 'chrome-ios');
  assert.equal(iosChrome.browserRuntime, 'chrome-installed');
  const iosWebKit = settingsForWorkUnit(normalized, { targetUrl:'https://example.com', executionKind:'ios-emulation', browser:'safari-ios', browserRuntime:'webkit-playwright', deviceProfile:'iPhone 13', orientation:'portrait', sessionDurationSeconds:60, proxySource:'none' });
  const playwright = { chromium:{}, firefox:{}, webkit:{} };
  const plan = resolveBrowserRuntimeLaunch({ settings:iosWebKit, playwright, chromeRuntimeResolver:() => ({found:false}) });
  assert.equal(plan.launcher, playwright.webkit);
  assert.equal(plan.runtimeKind, 'webkit-playwright');
});

test('records existing preflight and post-behavior proxy exit IP observations without extra polling', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ routeIps: ['8.8.4.4', '8.8.4.4'] });
  const observations = [];
  const proxyIpHistory = { observe(event) { observations.push(event); return true; } };
  const request = { ...poolRunnerRequest(1), steps: [{ id: 'wait-history', type: 'wait', ms: 1 }] };

  const result = await executeQaRun({
    runId: 'run-ip-history-repeat',
    request,
    screenshotsRoot: '/tmp',
    emit: () => {},
    proxyPoolService: pool,
    playwrightImpl,
    proxyIpHistory,
  });

  assert.equal(result.completed, 1);
  assert.deepEqual(observations.map((item) => item.phase), ['preflight', 'post-behavior']);
  assert.equal(observations[0].observedIp, '8.8.4.4');
  assert.equal(observations[1].observedIp, '8.8.4.4');
  assert.equal(observations.every((item) => item.runId === 'run-ip-history-repeat'), true);
  assert.equal(observations.every((item) => !('username' in item) && !('password' in item)), true);
  assert.equal(playwrightImpl.navigations.filter((url) => url.includes('check.test')).length, 2);
});

test('does not record a private proxy exit IP in history', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ routeIps: ['10.0.0.2', '10.0.0.2'] });
  const observations = [];
  const proxyIpHistory = { observe(event) { observations.push(event); return true; } };
  const request = { ...poolRunnerRequest(1), steps: [{ id: 'wait-private-history', type: 'wait', ms: 1 }] };

  const result = await executeQaRun({
    runId: 'run-ip-history-private',
    request,
    screenshotsRoot: '/tmp',
    emit: () => {},
    proxyPoolService: pool,
    playwrightImpl,
    proxyIpHistory,
  });

  assert.equal(result.completed, 1);
  assert.deepEqual(observations, []);
});

test('proxy IP history integration does not introduce additional route checks', async () => {
  const pool = fakePoolServiceForRunner();
  const playwrightImpl = fakeRunnerPlaywright({ routeIps: ['8.8.4.5', '8.8.4.6'] });
  const proxyIpHistory = { observe() { return true; } };
  const request = { ...poolRunnerRequest(1), steps: [{ id: 'wait-route-count', type: 'wait', ms: 1 }] };

  const result = await executeQaRun({
    runId: 'run-ip-history-route-count',
    request,
    screenshotsRoot: '/tmp',
    emit: () => {},
    proxyPoolService: pool,
    playwrightImpl,
    proxyIpHistory,
  });

  assert.equal(result.completed, 1);
  assert.equal(playwrightImpl.navigations.filter((url) => url.includes('check.test')).length, 2);
});


test('privacy route integrity helper emits phase-aware report event and failure summary', () => {
  const events = [];
  const report = emitPrivacyRouteIntegrity({
    pushWork:(event)=>events.push(event),
    phase:'pre-navigation', deviceMode:'desktop', strictMode:true,
    proxySource:'manual', proxyRequired:true,
    initialRoute:{ error:'timeout' }, initialRouteAssessment:null,
    runtimeLabel:'Google Chrome', privacyReport:null, identityReport:null,
  });
  assert.equal(report.phase, 'pre-navigation');
  assert.equal(report.overallStatus, 'not-verified');
  assert.equal(events.at(-1).type, 'privacy-route-integrity');
  assert.equal(events.at(-1).privacyRouteIntegrity.overallStatus, 'not-verified');
  assert.match(privacyRouteFailureSummary(report), /Proxy exit route|Direct IP exposure/);
});

test('qa-runner source wires privacy route integrity into pre-navigation, pre-behavior, post-behavior and unsupported runtime paths', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, 'qa-runner.cjs'), 'utf8');
  for (const phase of ['pre-navigation','pre-behavior','post-behavior']) assert.match(source, new RegExp(`phase:'${phase}'`));
  assert.match(source, /shouldBlockPrivacyRouteIntegrity\(/);
  assert.match(source, /PRIVACY ROUTE INTEGRITY FAILED/);
  assert.match(source, /deviceMode:'android-avd'/);
  assert.match(source, /deviceMode:'real-ios'/);
  assert.match(source, /type:'privacy-route-integrity'/);
});
