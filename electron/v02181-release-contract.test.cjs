const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('v0.21.81 Android navigation and multi-device contract', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.version, /^0\.(?:21\.(?:8\d|9\d)|2[2-9]\.\d+)$/);
  assert.equal(read('version').trim(), pkg.version);

  const service = read('electron/android-service.cjs');
  const url = read('electron/android-url.cjs');
  const deviceManager = read('electron/android-devices.cjs');
  const preload = read('electron/preload.cjs');
  const ipc = read('electron/android-ipc.cjs');
  const page = read('src/pages/DeviceProfiles.tsx');
  const shared = read('src/shared/android.ts');

  assert.match(url, /shellQuote/);
  assert.match(url, /prepareChrome/);
  assert.match(url, /assertUrlLoaded/);
  assert.match(url, /--disable-fre/);
  assert.match(url, /android\.intent\.action\.VIEW/);
  assert.match(url, /com\.android\.chrome\/com\.google\.android\.apps\.chrome\.Main/);

  assert.match(deviceManager, /allocatePort/);
  assert.match(deviceManager, /MAX|maxDevices/);
  assert.match(deviceManager, /waitForBoot/);
  assert.match(deviceManager, /stopAll/);

  assert.match(preload, /createAndroidDevice/);
  assert.match(preload, /openAndroidUrl/);
  assert.match(preload, /listRunningAndroidDevices/);
  assert.match(ipc, /mobile:createDevice/);
  assert.match(ipc, /mobile:openUrl/);

  assert.match(page, /listRunningAndroidDevices/);
  assert.match(page, /openAndroidUrl/);
  assert.doesNotMatch(page, /const runningEmulator = useMemo/);
  assert.match(shared, /AndroidRunningDevice/);

  assert.match(service, /stopAllDevices/);
  assert.match(read('electron/main.cjs'), /android-ipc\.cjs/);
});

test('android adb helper always targets a serial', () => {
  const runtime = read('electron/android-runtime.cjs');
  assert.match(runtime, /function execAdb\(serial, args/);
  assert.match(runtime, /\[\s*'-s',\s*String\(serial\)/);
});