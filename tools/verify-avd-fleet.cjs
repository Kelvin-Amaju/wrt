#!/usr/bin/env node
'use strict';

/*
 * Verifies that the Android fleet changes are present and that the surrounding
 * cross-file contracts are intact. Run from the repository root:
 *
 *   node tools/verify-avd-fleet.cjs
 *
 * Exits non-zero on the first failing section, so it is CI-friendly.
 */

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const results = [];
let failures = 0;

function read(relative) {
  const full = path.join(root, relative);
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

function check(label, condition) {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  results.push({ ok, label });
}

function requireFile(relative) {
  const content = read(relative);
  check(`file exists: ${relative}`, content !== null);
  return content || '';
}

function has(content, needle, relative) {
  check(`  ${relative} contains ${JSON.stringify(needle)}`, content.includes(needle));
}

function lacks(content, needle, relative) {
  check(`  ${relative} no longer contains ${JSON.stringify(needle)}`, !content.includes(needle));
}

// ---------------------------------------------------------------- android-service
const service = requireFile('electron/android-service.cjs');
has(service, 'sdkPath:', 'electron/android-service.cjs');
lacks(service, 'sdkRoot:', 'electron/android-service.cjs');
has(service, 'devices: devices.map', 'electron/android-service.cjs');
has(service, 'let launchChain = Promise.resolve()', 'electron/android-service.cjs');
has(service, 'const reservedPorts = new Set()', 'electron/android-service.cjs');
has(service, 'function withLaunchLock', 'electron/android-service.cjs');
has(service, 'function resetLaunchState', 'electron/android-service.cjs');
has(service, 'async function launchFleet', 'electron/android-service.cjs');
has(service, 'async function ensureFleetAvds', 'electron/android-service.cjs');
has(service, 'async function createAvd', 'electron/android-service.cjs');
has(service, 'function fleetName', 'electron/android-service.cjs');
has(service, "child.once('exit'", 'electron/android-service.cjs');
has(service, 'emulator process exited', 'electron/android-service.cjs');
has(service, 'shell: false', 'electron/android-service.cjs');
has(service, 'const reuse = launchOptions.reuse !== false', 'electron/android-service.cjs');
has(service, 'resetLaunchState,', 'electron/android-service.cjs');
has(service, 'fleetName,', 'electron/android-service.cjs');
has(service, 'reservedEmulatorPorts,', 'electron/android-service.cjs');

// Cross-file contract: main.cjs and android-setup.cjs both require these.
has(service, 'createAndroidService,', 'electron/android-service.cjs');
has(service, 'function discoverAndroidSdk', 'electron/android-service.cjs');

// ------------------------------------------------------------------- service tests
const serviceTest = requireFile('electron/android-service.test.cjs');
has(serviceTest, 'resetLaunchState', 'electron/android-service.test.cjs');
has(serviceTest, 'test.beforeEach', 'electron/android-service.test.cjs');
has(serviceTest, 'function createHarness', 'electron/android-service.test.cjs');
has(serviceTest, 'reuse false starts a second instance', 'electron/android-service.test.cjs');
has(serviceTest, 'concurrent launches never collide', 'electron/android-service.test.cjs');
has(serviceTest, 'matches the MobileStatus contract', 'electron/android-service.test.cjs');
has(serviceTest, 'launchFleet', 'electron/android-service.test.cjs');

// ----------------------------------------------------------------------- android-ipc
const ipc = requireFile('electron/android-ipc.cjs');
has(ipc, "mobile:launchAvdEx", 'electron/android-ipc.cjs');
has(ipc, "mobile:launchFleet", 'electron/android-ipc.cjs');
has(ipc, "mobile:stopAllAvds", 'electron/android-ipc.cjs');
has(ipc, "mobile:listRunningAvds", 'electron/android-ipc.cjs');
has(ipc, "mobile:maxParallel", 'electron/android-ipc.cjs');
has(ipc, 'createAndroidService', 'electron/android-ipc.cjs');

// -------------------------------------------------------------------- android-devices
const devices = requireFile('electron/android-devices.cjs');
has(devices, 'reservedEmulatorPorts', 'electron/android-devices.cjs');
has(devices, 'reservedEmulatorPorts()', 'electron/android-devices.cjs');

// ------------------------------------------------------------------------- preload
const preload = requireFile('electron/preload.cjs');
has(preload, 'launchAvdFleet', 'electron/preload.cjs');
has(preload, 'stopAllAvds', 'electron/preload.cjs');
has(preload, 'listRunningAvds', 'electron/preload.cjs');
has(preload, 'getAvdMaxParallel', 'electron/preload.cjs');
has(preload, "'mobile:launchAvdEx'", 'electron/preload.cjs');
has(preload, 'createMobileDevice', 'electron/preload.cjs');

// ------------------------------------------------------------------- shared types
const shared = requireFile('src/shared/mobileDevices.ts');
has(shared, 'export type AndroidRunningDevice', 'src/shared/mobileDevices.ts');
has(shared, 'running: AndroidRunningDevice[]', 'src/shared/mobileDevices.ts');
has(shared, 'runningSerials: string[]', 'src/shared/mobileDevices.ts');
has(shared, 'avdHome: string', 'src/shared/mobileDevices.ts');
has(shared, 'maxParallel: number', 'src/shared/mobileDevices.ts');
has(shared, 'REAL_DEVICE_FLEET_BASE', 'src/shared/mobileDevices.ts');
has(shared, 'AndroidFleetRequest', 'src/shared/mobileDevices.ts');

// ------------------------------------------------------------------- device profiles
const page = requireFile('src/pages/DeviceProfiles.tsx');
lacks(page, 'status.devices.find(', 'src/pages/DeviceProfiles.tsx');
has(page, 'runningDevices', 'src/pages/DeviceProfiles.tsx');
has(page, 'launchFleet', 'src/pages/DeviceProfiles.tsx');
has(page, 'stopAllDevices', 'src/pages/DeviceProfiles.tsx');
has(page, 'fleetCount', 'src/pages/DeviceProfiles.tsx');
has(page, 'running: []', 'src/pages/DeviceProfiles.tsx');
has(page, 'maxParallel: 20', 'src/pages/DeviceProfiles.tsx');

// -------------------------------------------------------------------- fleet script
const fleetScript = requireFile('tools/create-avd-fleet.ps1');
has(fleetScript, '[string]$SdkRoot', 'tools/create-avd-fleet.ps1');
has(fleetScript, '[string]$AvdHome', 'tools/create-avd-fleet.ps1');
has(fleetScript, '[switch]$SkipVerify', 'tools/create-avd-fleet.ps1');
has(fleetScript, 'function Resolve-SdkRoot', 'tools/create-avd-fleet.ps1');
has(fleetScript, 'Fleet incomplete', 'tools/create-avd-fleet.ps1');

// ------------------------------------------------------------------ untouched files
const setup = requireFile('electron/android-setup.cjs');
has(setup, 'discoverAndroidSdk(env, options.existsSync).sdkPath', 'electron/android-setup.cjs');

const main = requireFile('electron/main.cjs');
check(
  'electron/main.cjs is unchanged (no fleet channels registered here)',
  main !== null && !main.includes('mobile:launchFleet'),
);
check(
  'electron/main.cjs still registers mobile:getStatus',
  main !== null && main.includes("'mobile:getStatus'"),
);

// ------------------------------------------------------------------------- report
const failed = results.filter((entry) => !entry.ok);
const passed = results.length - failed.length;

console.log('');
for (const entry of results) {
  console.log(`${entry.ok ? '  ok  ' : ' FAIL '} ${entry.label}`);
}
console.log('');
console.log(`${passed}/${results.length} checks passed.`);

if (failed.length) {
  console.log('');
  console.log('Failing checks:');
  for (const entry of failed) console.log(`  - ${entry.label}`);
  process.exit(1);
}

console.log('Android fleet changes are present and the cross-file contracts are intact.');