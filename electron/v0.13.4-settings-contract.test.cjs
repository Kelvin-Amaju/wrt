const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeMatrixV3Request, executeStep } = require('./qa-runner.cjs');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('pool proxy sources automatically allow verified slow fallback without UI opt-in', () => {
  const runs = read('src/pages/Run.tsx');
  const legacy = read('src/components/TargetPlanEditor.tsx');
  assert.doesNotMatch(runs, /allow verified slow proxies/i);
  assert.doesNotMatch(runs, /allow verified slow/i);
  assert.doesNotMatch(legacy, /allow verified slow proxies/i);
});

test('Local iPhone/iPad editor hides Locale and Timezone controls while keeping internal defaults in the model', () => {
  const editor = read('src/components/DeviceMatrixEditor.tsx');
  assert.doesNotMatch(editor, /aria-label="Local iOS locale"/);
  assert.doesNotMatch(editor, /aria-label="Local iOS timezone"/);
  const matrix = read('src/shared/qaMatrix.ts');
  assert.match(matrix, /locale:\s*'en-US'/);
  assert.match(matrix, /timezoneId:\s*'UTC'/);
});

test('run request normalizer persists the screenshot capture preference', () => {
  const request = normalizeMatrixV3Request({
    version: 3,
    urlPoolText: 'https://example.com',
    runSeed: 'screenshots',
    devices: {
      desktop: { enabled: true, browsers: ['chromium'], instancesPerBrowser: 1, sessionDurationSeconds: 60, proxy: { source: 'none', allowSlowProxies: false } },
      androidEmulation: { enabled: false, profiles: ['Pixel 7'], instancesPerProfile: 1, sessionDurationSeconds: 60, proxy: { source: 'none', allowSlowProxies: false } },
      iosEmulation: { enabled: false, browsers: ['safari-ios'], profiles: ['iPhone 13'], instancesPerProfile: 1, sessionDurationSeconds: 60, orientation: 'portrait', locale: 'en-US', timezoneId: 'UTC', proxy: { source: 'none', allowSlowProxies: false } },
      androidAvd: { enabled: false, avdNames: [], sessionDurationSeconds: 60 },
      realIos: { enabled: false, selections: [], sessionDurationSeconds: 60 },
    },
    proxyMode: 'general',
    generalProxy: { source: 'none', allowSlowProxies: false },
    concurrency: { mode: 'manual', value: 1 },
    executionMode: 'visible',
    interactionIndicator: true,
    captureScreenshots: false,
    autoQa: { behaviorMode:'auto', readingPace:'natural', safeFormActions:true, observeNewTabs:true, referrerMode:'direct' },
    steps: [],
    privacy: { strictMode:false, blockWebRtcLeaks:true, denyCamera:true, denyMicrophone:true, denyGeolocation:true, denyNotifications:true, proxy:{ enabled:false, server:'', username:'', password:'', requireVerifiedRoute:false } },
  });
  assert.equal(request.captureScreenshots, false);
});

test('Test Runs exposes a run-level screenshot toggle', () => {
  const runs = read('src/pages/Run.tsx');
  assert.match(runs, /aria-label="Capture screenshots"/);
  assert.match(runs, /captureScreenshots/);
});

test('runner suppresses screenshot steps when run-level screenshot capture is disabled', () => {
  const runner = read('electron/qa-runner.cjs');
  assert.match(runner, /captureScreenshots/);
  assert.match(runner, /Screenshot capture disabled for this run/);
});


test('disabled screenshot capture prevents page screenshot I/O', async () => {
  let screenshotCalls = 0;
  const events = [];
  const page = {
    screenshot: async () => { screenshotCalls += 1; },
  };
  await executeStep(page, { id:'shot-1', type:'screenshot', fullPage:true }, {
    captureScreenshots:false,
    sessionId:1,
    workId:'work-1',
    stepNumber:1,
    screenshotDir:'/tmp/orbitqa-disabled-shots',
    emit:(event) => events.push(event),
  });
  assert.equal(screenshotCalls, 0);
  assert.equal(events.some((event) => /Screenshot capture disabled/.test(event.message || '')), true);
});
