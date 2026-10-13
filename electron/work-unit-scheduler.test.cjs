const test = require('node:test');
const assert = require('node:assert/strict');
const { expandWorkUnits, countWorkUnits, iterateWorkUnits, countWorkUnitsV3, iterateWorkUnitsV3, runWorkUnitQueue, validateAvdConcurrency } = require('./work-unit-scheduler.cjs');

function request() {
  return {
    targets: [{ id: 'save', targetUrl: 'https://savevidly.xyz', groups: [
      { id: 'desktop', executionKind: 'desktop', browser: 'chromium', instances: 5, sessionDurationSeconds: 35, proxySource: 'rotating', allowSlowProxies: false },
      { id: 'mobile', executionKind: 'android-emulation', browser: 'chrome-android', deviceProfile: 'Pixel 7', instances: 6, sessionDurationSeconds: 50, proxySource: 'rotating', allowSlowProxies: false },
      { id: 'iphone', executionKind: 'ios-emulation', browser: 'safari-ios', deviceProfile: 'iPhone 13', instances: 3, sessionDurationSeconds: 40, proxySource: 'rotating', allowSlowProxies: false },
    ] }],
  };
}

test('expands one link into fourteen independent device work units', () => {
  const units = expandWorkUnits(request());
  assert.equal(units.length, 14);
  assert.equal(new Set(units.map((unit) => unit.workId)).size, 14);
  assert.equal(units[0].targetUrl, 'https://savevidly.xyz');
  assert.equal(units[5].executionKind, 'android-emulation');
  assert.equal(units[11].executionKind, 'ios-emulation');
});

test('different targets keep independent group settings', () => {
  const input = request();
  input.targets.push({ id: 'other', targetUrl: 'https://example.com', groups: [
    { id: 'firefox', executionKind: 'desktop', browser: 'firefox', instances: 2, sessionDurationSeconds: 18, proxySource: 'static', allowSlowProxies: true },
  ] });
  const units = expandWorkUnits(input);
  const other = units.filter((unit) => unit.targetId === 'other');
  assert.equal(other.length, 2);
  assert.equal(other[0].sessionDurationSeconds, 18);
  assert.equal(other[0].proxySource, 'static');
});

test('queue never exceeds concurrency and stops dequeuing after abort', async () => {
  const controller = new AbortController();
  let active = 0;
  let peak = 0;
  const seen = [];
  await runWorkUnitQueue([1,2,3,4,5], 2, async (value) => {
    active += 1; peak = Math.max(peak, active); seen.push(value);
    if (value === 2) controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
  }, controller.signal);
  assert.equal(peak <= 2, true);
  assert.equal(seen.includes(5), false);
});

test('rejects overlapping use of the same Android AVD', () => {
  assert.throws(() => validateAvdConcurrency([
    { workId:'a', executionKind:'android-avd', androidAvdName:'Pixel_API_36' },
    { workId:'b', executionKind:'android-avd', androidAvdName:'Pixel_API_36' },
  ]), /same Android AVD/i);
});


test('counts 50000 work units without an arbitrary cap', () => {
  const input = {
    targets: [{ id: 't1', targetUrl: 'https://example.org', groups: [
      { id: 'g1', executionKind: 'desktop', browser: 'chromium', instances: 50000, sessionDurationSeconds: 60, proxySource: 'none' },
    ] }],
  };
  assert.equal(countWorkUnits(input), 50000);
});

test('iterates large work plans lazily with stable descriptors', () => {
  const input = {
    targets: [{ id: 't1', targetUrl: 'https://example.org', groups: [
      { id: 'g1', executionKind: 'desktop', browser: 'chromium', instances: 50000, sessionDurationSeconds: 60, proxySource: 'none' },
    ] }],
  };
  const iterator = iterateWorkUnits(input);
  assert.equal(iterator.next().value.workId, 't1-g1-instance-1');
  let last;
  for (let i = 1; i < 50000; i += 1) last = iterator.next().value;
  assert.equal(last.workId, 't1-g1-instance-50000');
  assert.equal(iterator.next().done, true);
});

test('expandWorkUnits no longer rejects more than 50 units', () => {
  const input = {
    targets: [{ id: 't1', targetUrl: 'https://example.org', groups: [
      { id: 'g1', executionKind: 'desktop', browser: 'chromium', instances: 51, sessionDurationSeconds: 60, proxySource: 'none' },
    ] }],
  };
  assert.equal(expandWorkUnits(input).length, 51);
});

test('manual concurrency above five is honored without exceeding the requested limit', async () => {
  let active = 0;
  let peak = 0;
  await runWorkUnitQueue(Array.from({ length: 16 }, (_, index) => index), {
    requestedCount: 16,
    concurrency: { mode: 'manual', value: 8 },
    resourceProvider: null,
  }, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 4));
    active -= 1;
  });
  assert.equal(peak, 8);
});

test('resource pressure pauses new launches and resumes after the low-water condition', async () => {
  let reads = 0;
  const resourceProvider = {
    getResourceSnapshot() {
      reads += 1;
      if (reads < 4) return { logicalCpuCount: 8, totalMemoryBytes: 16e9, freeMemoryBytes: 1e9, cpuLoadFraction: 0.95 };
      return { logicalCpuCount: 8, totalMemoryBytes: 16e9, freeMemoryBytes: 8e9, cpuLoadFraction: 0.30 };
    },
  };
  const started = [];
  await runWorkUnitQueue([1, 2], {
    requestedCount: 2,
    concurrency: { mode: 'auto', value: 2 },
    resourceProvider,
    pollIntervalMs: 1,
  }, async (value) => { started.push(value); });
  assert.deepEqual(started.sort(), [1, 2]);
  assert.ok(reads >= 4);
});

test('STOP cancels a huge lazy queue without materializing the remainder', async () => {
  let yielded = 0;
  function* source() {
    for (let index = 0; index < 50000; index += 1) {
      yielded += 1;
      yield index;
    }
  }
  const controller = new AbortController();
  let lastMetrics;
  await runWorkUnitQueue(source(), {
    requestedCount: 50000,
    concurrency: { mode: 'manual', value: 8 },
    resourceProvider: null,
    onMetrics: (metrics) => { lastMetrics = metrics; },
  }, async (value) => {
    if (value === 0) controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 2));
    return { status: 'cancelled' };
  }, controller.signal);
  assert.ok(yielded < 50);
  assert.equal(lastMetrics.requested, 50000);
  assert.ok(lastMetrics.cancelled > 0);
});


function requestV3(overrides = {}) {
  return {
    version: 3,
    urlPool: ['https://a.example/', 'https://b.example/', 'https://c.example/'],
    runSeed: 'run-42',
    proxyMode: 'general',
    generalProxy: { source: 'rotating', allowSlowProxies: true },
    devices: {
      desktop: { enabled: true, browsers: ['chromium', 'firefox'], instancesPerBrowser: 2, sessionDurationSeconds: 60, proxy: { source: 'none', allowSlowProxies: false } },
      androidEmulation: { enabled: true, profiles: ['Pixel 7'], instancesPerProfile: 1, sessionDurationSeconds: 90, proxy: { source: 'static', allowSlowProxies: false } },
      iosEmulation: { enabled: false, browsers: ['safari-ios'], profiles: ['iPhone 13'], instancesPerProfile: 1, sessionDurationSeconds: 60, orientation: 'portrait', locale: 'en-US', timezoneId: 'UTC', proxy: { source: 'none', allowSlowProxies: false } },
      androidAvd: { enabled: false, avdNames: [], sessionDurationSeconds: 60 },
      realIos: { enabled: false, selections: [], sessionDurationSeconds: 60 },
    },
    ...overrides,
  };
}

test('v3 lazy compiler assigns every URL before deck reuse and inherits general proxy policy', () => {
  const input = requestV3();
  assert.equal(countWorkUnitsV3(input), 5);
  const units = Array.from(iterateWorkUnitsV3(input));
  assert.equal(units.length, 5);
  assert.equal(new Set(units.slice(0, 3).map((unit) => unit.targetUrl)).size, 3);
  assert.equal(units.every((unit) => unit.proxySource === 'rotating'), true);
  assert.equal(units.every((unit) => unit.allowSlowProxies === true), true);
  assert.deepEqual(
    units.map((unit) => unit.targetUrl),
    Array.from(iterateWorkUnitsV3(input)).map((unit) => unit.targetUrl),
  );
});

test('v3 per-device proxy mode resolves family overrides and expands iOS browser/profile combinations', () => {
  const input = requestV3({
    proxyMode: 'per-device',
    devices: {
      ...requestV3().devices,
      desktop: { ...requestV3().devices.desktop, browsers: ['chromium'], instancesPerBrowser: 1, proxy: { source: 'static', allowSlowProxies: false } },
      androidEmulation: { ...requestV3().devices.androidEmulation, enabled: false },
      iosEmulation: { enabled: true, browsers: ['safari-ios', 'chrome-ios'], profiles: ['iPhone 13', 'iPad Mini'], instancesPerProfile: 2, sessionDurationSeconds: 75, orientation: 'portrait', locale: 'en-US', timezoneId: 'UTC', proxy: { source: 'rotating', allowSlowProxies: true } },
    },
  });
  const units = Array.from(iterateWorkUnitsV3(input));
  assert.equal(units.length, 9);
  assert.equal(units.find((unit) => unit.executionKind === 'desktop').proxySource, 'static');
  assert.equal(units.filter((unit) => unit.executionKind === 'ios-emulation').length, 8);
  assert.equal(units.filter((unit) => unit.executionKind === 'ios-emulation').every((unit) => unit.proxySource === 'rotating'), true);
});

test('v3 STOP cancels a huge lazy queue without materializing remaining descriptors', async () => {
  const input = requestV3({
    urlPool: ['https://example.org/'],
    devices: {
      ...requestV3().devices,
      desktop: { ...requestV3().devices.desktop, browsers: ['chromium'], instancesPerBrowser: 50000 },
      androidEmulation: { ...requestV3().devices.androidEmulation, enabled: false },
    },
  });
  let yielded = 0;
  function* counted() {
    for (const unit of iterateWorkUnitsV3(input)) {
      yielded += 1;
      yield unit;
    }
  }
  const controller = new AbortController();
  let lastMetrics;
  await runWorkUnitQueue(counted(), {
    requestedCount: countWorkUnitsV3(input),
    concurrency: { mode: 'manual', value: 8 },
    resourceProvider: null,
    onMetrics: (metrics) => { lastMetrics = metrics; },
  }, async (_unit, index) => {
    if (index === 0) controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 2));
    return { status: 'cancelled' };
  }, controller.signal);
  assert.ok(yielded < 50);
  assert.equal(lastMetrics.requested, 50000);
  assert.ok(lastMetrics.cancelled > 0);
});

test('v3 mixed-device iterator fairly interleaves selected families in the first concurrency window', () => {
  const base = requestV3();
  const input = requestV3({
    runSeed:'balanced-10',
    urlPool:['https://example.org/'],
    devices:{
      ...base.devices,
      desktop:{ ...base.devices.desktop, browsers:['chromium'], instancesPerBrowser:10 },
      androidEmulation:{ ...base.devices.androidEmulation, enabled:true, profiles:['Pixel 7'], instancesPerProfile:5 },
      iosEmulation:{ enabled:true, browsers:['safari-ios'], profiles:['iPhone 13'], instancesPerProfile:9, sessionDurationSeconds:60, orientation:'portrait', locale:'en-US', timezoneId:'UTC', proxy:{source:'none',allowSlowProxies:false} },
    },
  });
  const firstTen = Array.from(iterateWorkUnitsV3(input)).slice(0, 10);
  const counts = firstTen.reduce((acc, unit) => { acc[unit.executionKind] = (acc[unit.executionKind] || 0) + 1; return acc; }, {});
  assert.deepEqual(counts, { desktop:4, 'android-emulation':3, 'ios-emulation':3 });
});

test('v3 fair iterator fills slots from remaining families after one family is exhausted', () => {
  const base = requestV3();
  const input = requestV3({
    runSeed:'exhaust-family',
    urlPool:['https://example.org/'],
    devices:{
      ...base.devices,
      desktop:{ ...base.devices.desktop, browsers:['chromium'], instancesPerBrowser:5 },
      androidEmulation:{ ...base.devices.androidEmulation, enabled:true, profiles:['Pixel 7'], instancesPerProfile:1 },
      iosEmulation:{ enabled:true, browsers:['safari-ios'], profiles:['iPhone 13'], instancesPerProfile:5, sessionDurationSeconds:60, orientation:'portrait', locale:'en-US', timezoneId:'UTC', proxy:{source:'none',allowSlowProxies:false} },
    },
  });
  const units = Array.from(iterateWorkUnitsV3(input));
  assert.equal(units.length, 11);
  assert.equal(units.filter((unit)=>unit.executionKind === 'android-emulation').length, 1);
  assert.equal(units.slice(3).every((unit)=>unit.executionKind !== 'android-emulation'), true);
  assert.equal(units.slice(-2).some((unit)=>unit.executionKind === 'desktop'), true);
  assert.equal(units.slice(-2).some((unit)=>unit.executionKind === 'ios-emulation'), true);
});

test('manual concurrency honors the requested active-work target instead of auto-clamping to host estimates', async () => {
  let active = 0;
  let peak = 0;
  const resourceProvider = {
    getResourceSnapshot() {
      return { logicalCpuCount: 2, totalMemoryBytes: 8e9, freeMemoryBytes: 700e6, cpuLoadFraction: 0.96 };
    },
  };
  await runWorkUnitQueue(Array.from({ length: 24 }, (_, index) => index), {
    requestedCount: 24,
    concurrency: { mode: 'manual', value: 30 },
    resourceProvider,
    pollIntervalMs: 1,
  }, async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 30));
    active -= 1;
    return { status: 'completed' };
  });
  assert.equal(peak, 24);
});

test('v3 work units carry concrete browser runtime truth for every device family', () => {
  const request = requestV3();
  request.devices.desktop = { ...request.devices.desktop, enabled:true, browsers:['chrome-installed','chromium'], instancesPerBrowser:1 };
  request.devices.androidEmulation = { ...request.devices.androidEmulation, enabled:true, browserRuntime:'chrome-installed', profiles:['Pixel 7'], instancesPerProfile:1 };
  request.devices.iosEmulation = { ...request.devices.iosEmulation, enabled:true, browsers:['chrome-installed','safari-ios'], profiles:['iPhone 13'], instancesPerProfile:1 };
  request.devices.androidAvd = { ...request.devices.androidAvd, enabled:true, avdNames:['Pixel_A'] };
  request.devices.realIos = { ...request.devices.realIos, enabled:true, selections:[{device:'iPhone 15',iosVersion:'17',browser:'safari'}] };
  const units = Array.from(iterateWorkUnitsV3(request));
  assert.equal(units.find((u) => u.executionKind === 'desktop' && u.browser === 'chrome-installed').browserRuntime, 'chrome-installed');
  assert.equal(units.find((u) => u.executionKind === 'desktop' && u.browser === 'chromium').browserRuntime, 'chromium-playwright');
  assert.equal(units.find((u) => u.executionKind === 'android-emulation').browserRuntime, 'chrome-installed');
  assert.equal(units.find((u) => u.executionKind === 'ios-emulation' && u.browser === 'safari-ios').browserRuntime, 'webkit-playwright');
  assert.equal(units.find((u) => u.executionKind === 'android-avd').browserRuntime, 'android-chrome');
  assert.equal(units.find((u) => u.executionKind === 'real-ios').browserRuntime, 'real-ios-provider');
});
