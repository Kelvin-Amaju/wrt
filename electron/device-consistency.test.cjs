const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDeviceExpectation,
  assessDeviceConsistency,
  collectRuntimeIdentity,
  buildRuntimeFidelity,
} = require('./device-consistency.cjs');

function observed(overrides = {}) {
  return {
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/153.0.0.0 Mobile Safari/537.36',
    platform: 'Linux armv8l',
    maxTouchPoints: 5,
    viewport: { width: 412, height: 915 },
    screen: { width: 412, height: 915 },
    devicePixelRatio: 2.625,
    locale: 'en-US',
    timezoneId: 'UTC',
    webdriver: true,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    ...overrides,
  };
}

test('Android mobile consistency passes core device checks while reporting webdriver only as a warning', () => {
  const expected = buildDeviceExpectation({
    deviceMode: 'android-emulation',
    deviceName: 'Pixel 7',
    browser: 'chrome-android',
    locale: 'en-US',
    timezoneId: 'UTC',
  }, {
    viewport: { width: 412, height: 915 },
    screen: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
  });

  const report = assessDeviceConsistency(expected, observed());

  assert.equal(report.blocked, false);
  assert.equal(report.overall, 'pass');
  assert.equal(report.checks.find((item) => item.key === 'user-agent').status, 'pass');
  assert.equal(report.checks.find((item) => item.key === 'touch').status, 'pass');
  assert.equal(report.checks.find((item) => item.key === 'viewport').status, 'pass');
  assert.equal(report.checks.find((item) => item.key === 'screen').status, 'pass');
  const hardware = report.checks.find((item) => item.key === 'hardware');
  assert.equal(hardware.status, 'not-applicable');
  assert.equal(hardware.classification, 'host-runtime');
  assert.match(hardware.observed, /8 logical processors/i);
  assert.match(hardware.observed, /8 GiB memory/i);
  const webdriver = report.checks.find((item) => item.key === 'webdriver');
  assert.equal(webdriver.status, 'not-applicable');
  assert.equal(webdriver.required, false);
  assert.equal(webdriver.classification, 'host-runtime');
  assert.match(webdriver.detail, /does not modify/i);
});

test('Android mobile blocks critical identity contradictions', () => {
  const expected = buildDeviceExpectation({
    deviceMode: 'android-emulation',
    deviceName: 'Pixel 7',
    browser: 'chrome-android',
    locale: 'en-US',
    timezoneId: 'UTC',
  }, {
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
  });

  const report = assessDeviceConsistency(expected, observed({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/153.0.0.0 Safari/537.36',
    platform: 'Win32',
    maxTouchPoints: 0,
    viewport: { width: 1280, height: 720 },
    devicePixelRatio: 1,
  }));

  assert.equal(report.blocked, true);
  assert.equal(report.overall, 'fail');
  assert.equal(report.checks.find((item) => item.key === 'user-agent').status, 'fail');
  assert.equal(report.checks.find((item) => item.key === 'touch').status, 'fail');
  assert.equal(report.blockingReasons.length >= 2, true);
});

test('Local iOS compatibility keeps host platform mismatch as a warning instead of pretending to be real iPhone hardware', () => {
  const expected = buildDeviceExpectation({
    deviceMode: 'ios-emulation',
    deviceName: 'iPhone 13',
    browser: 'webkit',
    iosBrowser: 'safari-ios',
    locale: 'en-US',
    timezoneId: 'UTC',
  }, {
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
  });

  const report = assessDeviceConsistency(expected, observed({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
    platform: 'Win32',
    maxTouchPoints: 5,
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    devicePixelRatio: 3,
    webdriver: false,
  }));

  assert.equal(report.blocked, false);
  assert.equal(report.overall, 'pass');
  assert.equal(report.checks.find((item) => item.key === 'platform').status, 'not-applicable');
  assert.equal(report.checks.find((item) => item.key === 'user-agent').status, 'pass');
  assert.match(report.checks.find((item) => item.key === 'platform').detail, /compatibility/i);
});

test('Local iOS compatibility treats zero reported touch points as an expected host limitation instead of blocking the work unit', () => {
  const expected = buildDeviceExpectation({
    deviceMode: 'ios-emulation',
    deviceName: 'iPhone 13',
    browser: 'webkit',
    iosBrowser: 'safari-ios',
    locale: 'en-US',
    timezoneId: 'UTC',
  }, {
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1',
  });

  const report = assessDeviceConsistency(expected, observed({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1',
    platform: 'Win32',
    maxTouchPoints: 0,
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    devicePixelRatio: 3,
    webdriver: true,
  }));

  const touch = report.checks.find((item) => item.key === 'touch');
  assert.equal(report.blocked, false);
  assert.equal(report.overall, 'pass');
  assert.equal(touch.status, 'not-applicable');
  assert.equal(touch.required, false);
  assert.equal(touch.classification, 'host-runtime');
  assert.match(touch.detail, /compatibility/i);
});

test('desktop uses browser-native identity and does not require a fabricated hardware profile', () => {
  const expected = buildDeviceExpectation({
    deviceMode: 'desktop',
    browser: 'firefox',
  }, {});

  assert.equal(expected.locale, '');
  assert.equal(expected.timezoneId, '');

  const report = assessDeviceConsistency(expected, observed({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
    platform: 'Win32',
    maxTouchPoints: 0,
    viewport: { width: 1280, height: 720 },
    screen: { width: 1920, height: 1080 },
    devicePixelRatio: 1,
    webdriver: false,
  }));

  assert.equal(report.blocked, false);
  assert.equal(report.mode, 'desktop');
  assert.equal(report.checks.find((item) => item.key === 'user-agent').status, 'pass');
});

test('collectRuntimeIdentity reports webdriver and hardware values without rewriting them', async () => {
  const runtime = observed({ webdriver: true, hardwareConcurrency: 12, deviceMemory: 4 });
  let evaluateCalls = 0;
  const page = {
    async evaluate(fn) {
      evaluateCalls += 1;
      assert.equal(typeof fn, 'function');
      return runtime;
    },
  };

  const result = await collectRuntimeIdentity(page);

  assert.equal(evaluateCalls, 1);
  assert.equal(result.webdriver, true);
  assert.equal(result.hardwareConcurrency, 12);
  assert.equal(result.deviceMemory, 4);
});


test('classifies browser emulation separately from native mobile runtimes', () => {
  assert.equal(buildRuntimeFidelity({ mode: 'android-emulation', family: 'android' }).level, 'compatibility-emulation');
  assert.equal(buildRuntimeFidelity({ mode: 'android', family: 'android' }).level, 'native-android-runtime');
  assert.equal(buildRuntimeFidelity({ mode: 'ios-emulation', family: 'iphone' }).level, 'compatibility-emulation');
  assert.equal(buildRuntimeFidelity({ mode: 'real-ios', family: 'real-ios' }).level, 'real-ios-provider');
  assert.equal(buildRuntimeFidelity({ mode: 'desktop', family: 'desktop' }).level, 'desktop-automation');
});

test('marks host-platform and webdriver exposure as expected limitations for compatibility emulation', () => {
  const expected = buildDeviceExpectation({
    deviceMode: 'android-emulation',
    deviceName: 'Pixel 7',
    browser: 'chrome-android',
  }, {
    viewport: { width: 412, height: 915 },
    screen: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
  });

  const report = assessDeviceConsistency(expected, observed({ platform: 'Win32', webdriver: true }));

  assert.equal(report.fidelity.level, 'compatibility-emulation');
  assert.equal(report.checks.find((item) => item.key === 'platform').classification, 'host-runtime');
  assert.equal(report.checks.find((item) => item.key === 'webdriver').classification, 'host-runtime');
});

test('keeps webdriver truthful on native Android runtime and does not call it an emulation limitation', () => {
  const expected = buildDeviceExpectation({
    deviceMode: 'android',
    deviceName: 'OrbitQA_Pixel_7_API35',
    browser: 'chrome-android',
  }, {
    viewport: { width: 412, height: 915 },
    screen: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    hasTouch: true,
  });

  const report = assessDeviceConsistency(expected, observed({ webdriver: true }));

  assert.equal(report.fidelity.level, 'native-android-runtime');
  assert.equal(report.checks.find((item) => item.key === 'webdriver').classification, 'host-runtime');
  assert.equal(report.overall, 'pass');
});

test('iOS compatibility separates profile consistency from host runtime disclosure', () => {
  const expected = buildDeviceExpectation({
    deviceMode: 'ios-emulation', deviceName: 'iPhone 13', browser: 'webkit', iosBrowser: 'safari-ios', locale: 'en-US', timezoneId: 'UTC',
  }, {
    viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1',
  });
  const report = assessDeviceConsistency(expected, observed({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1',
    platform: 'Win32', maxTouchPoints: 0, viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, devicePixelRatio: 3, webdriver: true,
  }), { iosTap: true });
  assert.equal(report.profileConsistency, 'pass');
  assert.equal(report.overall, 'pass');
  assert.equal(report.profileChecks.find((item) => item.key === 'ios-functional-tap').status, 'pass');
  assert.equal(report.runtimeFacts.find((item) => item.key === 'platform').classification, 'host-runtime');
  assert.equal(report.runtimeFacts.find((item) => item.key === 'webdriver').classification, 'host-runtime');
});

test('failed active iOS tap verification is a non-blocking local compatibility warning', () => {
  const expected = buildDeviceExpectation({ deviceMode: 'ios-emulation', deviceName: 'iPhone 13', browser: 'webkit', iosBrowser: 'safari-ios', locale: 'en-US', timezoneId: 'UTC' }, {
    viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true,
  });
  const report = assessDeviceConsistency(expected, observed({
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.6 Mobile/15E148 Safari/604.1',
    platform: 'Win32', maxTouchPoints: 0, viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 }, devicePixelRatio: 3,
  }), { iosTap: false });
  const tap = report.profileChecks.find((item) => item.key === 'ios-functional-tap');
  assert.equal(tap.status, 'warning');
  assert.equal(tap.required, false);
  assert.equal(tap.classification, 'expected-limitation');
  assert.equal(report.profileConsistency, 'warning');
  assert.equal(report.blocked, false);
  assert.equal(report.functionalCompatibility.iosTap, 'fail');
});


test('Android compatibility uses the configured browser viewport instead of blocking on a site-controlled layout viewport', () => {
  const expected = buildDeviceExpectation({
    deviceMode: 'android-emulation', deviceName: 'Pixel 11', browser: 'chrome-android', locale: 'en-US', timezoneId: 'UTC',
  }, {
    viewport: { width: 412, height: 923 }, screen: { width: 412, height: 923 }, deviceScaleFactor: 2.625, hasTouch: true,
  });
  const report = assessDeviceConsistency(expected, observed({
    userAgent: 'Mozilla/5.0 (Linux; Android 17; Pixel 11) AppleWebKit/537.36 Chrome/153.0.0.0 Mobile Safari/537.36',
    viewport: { width: 980, height: 2195 },
    configuredViewport: { width: 412, height: 923 },
    screen: { width: 412, height: 923 },
    devicePixelRatio: 2.625,
  }));
  assert.equal(report.blocked, false);
  assert.equal(report.profileConsistency, 'pass');
  assert.equal(report.profileChecks.find((item) => item.key === 'viewport').status, 'pass');
  const layout = report.runtimeFacts.find((item) => item.key === 'page-layout-viewport');
  assert.equal(layout.status, 'not-applicable');
  assert.equal(layout.classification, 'site-layout');
  assert.match(layout.detail, /site behavior/i);
});

test('collectRuntimeIdentity retains both configured browser viewport and page layout viewport', async () => {
  const runtime = observed({ viewport: { width: 980, height: 2195 } });
  const page = {
    viewportSize() { return { width: 412, height: 923 }; },
    async evaluate() { return runtime; },
  };
  const result = await collectRuntimeIdentity(page);
  assert.deepEqual(result.configuredViewport, { width: 412, height: 923 });
  assert.deepEqual(result.viewport, { width: 980, height: 2195 });
});
