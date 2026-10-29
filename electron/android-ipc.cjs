'use strict';

const fs = require('node:fs');
const { spawn } = require('node:child_process');
const devices = require('./android-devices.cjs');
const runtime = require('./android-runtime.cjs');
const {
  createAndroidService,
  fleetName,
  isSafeAvdName,
  DEFAULT_FLEET_BASE,
} = require('./android-service.cjs');

/*
 * Channel ownership.
 *
 * main.cjs owns the original Device Profiles surface (mobile:getStatus,
 * mobile:startSetup, mobile:getSetupState, mobile:listAvds, mobile:launchAvd,
 * mobile:stopAvd). Everything registered here is a NEW channel, so this module
 * can be required from main.cjs without a duplicate-handler crash.
 *
 * The unified service and main.cjs each build their own instance; they stay in
 * sync because port reservations live at module scope in android-service.cjs and
 * running state is always read back from adb.
 */
const service = createAndroidService();

function wrap(handler) {
  return async (event, ...args) => {
    try {
      const value = await handler(...args);
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

function clampCount(value) {
  const limit = service.maxParallel();
  const requested = Number(value);
  const count = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : 1;
  return Math.max(1, Math.min(count, limit));
}

function quoteForCmd(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

/**
 * Creates one AVD.
 *
 * avdmanager is a .bat. Node refuses to spawn .bat/.cmd with shell:false since
 * the CVE-2024-27980 fix, so it is launched through cmd.exe /d /s /c with every
 * argument quoted - which also protects the semicolons in the system-image id.
 */
function createOneAvd(name) {
  const avdmanager = service.avdManagerPath();
  if (!avdmanager) {
    return Promise.reject(new Error('avdmanager was not found. Run the Android setup first.'));
  }
  if (!fs.existsSync(avdmanager)) {
    return Promise.reject(new Error(`avdmanager is missing at ${avdmanager}. Re-run the Android setup.`));
  }
  const image = service.detectSystemImage();
  if (!image) {
    return Promise.reject(new Error('No Android system image is installed. Run the Android setup first.'));
  }

  const commandLine = [
    avdmanager,
    'create', 'avd',
    '-n', name,
    '-k', image,
    '--device', 'pixel_7',
    '--force',
  ].map(quoteForCmd).join(' ');

  return new Promise((resolve, reject) => {
    const comspec = process.env.ComSpec || 'cmd.exe';
    const child = spawn(comspec, ['/d', '/s', '/c', commandLine], {
      env: process.env,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    let stderr = '';
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + String(chunk)).slice(-4000);
      });
    }
    child.once('error', (error) => reject(new Error(`avdmanager could not start: ${error.message}`)));
    child.once('close', (code) => {
      if (code === 0) {
        resolve({ name, created: true });
        return;
      }
      const detail = stderr.trim().split(/\r?\n/).filter(Boolean).slice(-4).join(' | ');
      reject(new Error(`avdmanager failed to create ${name} (exit ${code})${detail ? `: ${detail}` : ''}`));
    });
    // Answers the "custom hardware profile?" prompt if it appears.
    if (child.stdin && typeof child.stdin.end === 'function') child.stdin.end('no\n');
  });
}

async function ensureAvds(names) {
  const installed = new Set(await service.listAvds().catch(() => []));
  const created = [];
  for (const name of names) {
    if (installed.has(name)) continue;
    await createOneAvd(name);
    created.push(name);
  }
  return created;
}

/**
 * Creates fleet AVDs without launching them, so the Device Profiles list can be
 * populated before the operator chooses which ones to start.
 */
async function createFleet(options = {}) {
  const count = clampCount(options.count);
  const base = String(options.baseName || DEFAULT_FLEET_BASE).trim() || DEFAULT_FLEET_BASE;
  const names = [];
  for (let index = 1; index <= count; index += 1) names.push(fleetName(base, index));

  const installed = new Set(await service.listAvds().catch(() => []));
  const existing = names.filter((name) => installed.has(name));
  const created = await ensureAvds(names);
  return { baseName: base, names, created, existing };
}

/**
 * Launches an explicit subset when `names` is supplied, otherwise falls back to
 * the count-derived fleet. Boots run concurrently; android-service serialises
 * only port allocation, so parallel starts cannot collide.
 */
async function launchFleetOrNames(options = {}) {
  const names = Array.isArray(options.names)
    ? [...new Set(options.names.filter(isSafeAvdName))].slice(0, service.maxParallel())
    : [];
  if (names.length === 0) return service.launchFleet(options);

  await ensureAvds(names);
  const devices = await Promise.all(names.map((name) => service.launchAvd(name, {})));
  return { baseName: String(options.baseName || ''), count: names.length, devices };
}

const CHANNELS = [
  // Unified service — Device Profiles, fleet creation and launching.
  ['mobile:createAvdFleet', (options) => createFleet(options || {})],
  ['mobile:launchAvdEx', (name, options) => service.launchAvd(String(name || ''), options || {})],
  ['mobile:launchFleet', (options) => launchFleetOrNames(options || {})],
  ['mobile:stopAllAvds', () => service.stopAll()],
  ['mobile:listRunningAvds', () => service.getStatus().then((status) => status.running)],
  ['mobile:maxParallel', () => service.maxParallel()],

  // Legacy clone-per-device stack, still used by the QA mobile lane.
  ['mobile:createDevice', (options) => devices.create(options || {})],
  ['mobile:listRunning', () => devices.list()],
  ['mobile:stopAll', () => devices.stopAll()],
  ['mobile:openUrl', (serial, url) => devices.open(String(serial || ''), url)],
  ['mobile:getDeviceStatus', (serial) => devices.get(String(serial || ''))],
  [
    'mobile:isChromeReady',
    async (serial) =>
      /package:com\.android\.chrome/.test(
        await runtime.execAdb(String(serial || ''), [
          'shell',
          'pm',
          'list',
          'packages',
          'com.android.chrome',
        ]),
      ),
  ],
  ['mobile:maxDevices', () => runtime.maxDevices()],
];

let registered = false;

function registerAndroidIpc(ipcMain) {
  if (registered) return;
  for (const [channel, handler] of CHANNELS) {
    ipcMain.handle(channel, wrap(handler));
  }
  registered = true;
}

function unregisterAndroidIpc(ipcMain) {
  if (!registered) return;
  registered = false;
  for (const [channel] of CHANNELS) ipcMain.removeHandler(channel);
}

module.exports = { CHANNELS, registerAndroidIpc, unregisterAndroidIpc };