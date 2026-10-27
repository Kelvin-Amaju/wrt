'use strict';

const devices = require('./android-devices.cjs');
const runtime = require('./android-runtime.cjs');
const { createAndroidService } = require('./android-service.cjs');

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

const CHANNELS = [
  // Unified service — Device Profiles, fleet launching.
  ['mobile:launchAvdEx', (name, options) => service.launchAvd(String(name || ''), options || {})],
  ['mobile:launchFleet', (options) => service.launchFleet(options || {})],
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