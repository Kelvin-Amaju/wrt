'use strict';

const devices = require('./android-devices.cjs');
const runtime = require('./android-runtime.cjs');

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
  ['mobile:createDevice', (options) => devices.create(options || {})],
  ['mobile:listRunning', () => devices.list()],
  ['mobile:stopAll', () => devices.stopAll()],
  ['mobile:openUrl', (serial, url) => devices.open(String(serial || ''), url)],
  ['mobile:getDeviceStatus', (serial) => devices.get(String(serial || ''))],
  ['mobile:isChromeReady', async (serial) => /package:com\.android\.chrome/.test(await runtime.execAdb(String(serial || ''), ['shell', 'pm', 'list', 'packages', 'com.android.chrome']))],
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
