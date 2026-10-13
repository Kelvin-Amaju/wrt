const path = require('node:path');
const fs = require('node:fs');
const { execFile, spawn: nodeSpawn } = require('node:child_process');
const { promisify } = require('node:util');

const execFilePromise = promisify(execFile);
const win = path.win32;

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => win.normalize(value)))];
}

function discoverAndroidSdk(env = process.env, existsSync = fs.existsSync) {
  const candidates = unique([
    env.ANDROID_SDK_ROOT,
    env.ANDROID_HOME,
    env.LOCALAPPDATA ? win.join(env.LOCALAPPDATA, 'Android', 'Sdk') : '',
    env.USERPROFILE ? win.join(env.USERPROFILE, 'AppData', 'Local', 'Android', 'Sdk') : '',
  ]);

  for (const sdkPath of candidates) {
    const adbPath = win.join(sdkPath, 'platform-tools', 'adb.exe');
    const emulatorPath = win.join(sdkPath, 'emulator', 'emulator.exe');
    if (existsSync(sdkPath) || existsSync(adbPath) || existsSync(emulatorPath)) {
      return {
        sdkPath,
        adbPath,
        emulatorPath,
        adbAvailable: existsSync(adbPath),
        emulatorAvailable: existsSync(emulatorPath),
      };
    }
  }

  return {
    sdkPath: null,
    adbPath: null,
    emulatorPath: null,
    adbAvailable: false,
    emulatorAvailable: false,
  };
}

function parseAvdList(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseAdbDevices(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('List of devices attached'))
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
      return serial && state ? { serial, state } : null;
    })
    .filter(Boolean);
}

function isSafeAvdName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(name);
}

function createAndroidService(options = {}) {
  const env = options.env || process.env;
  const existsSync = options.existsSync || fs.existsSync;
  const execFileAsync = options.execFileAsync || ((file, args, execOptions = {}) => execFilePromise(file, args, { windowsHide: true, ...execOptions }));
  const spawn = options.spawn || nodeSpawn;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  function tools() {
    return discoverAndroidSdk(env, existsSync);
  }

  async function ensureAdbReady() {
    const status = tools();
    if (!status.adbAvailable || !status.adbPath) throw new Error('ADB is unavailable. Install Android SDK Platform Tools.');

    await execFileAsync(status.adbPath, ['start-server']).catch(() => undefined);
    let devices = await adbDevices().catch(() => []);
    const offlineEmulators = devices.filter((device) => device.serial.startsWith('emulator-') && device.state === 'offline');
    if (offlineEmulators.length > 0) {
      await execFileAsync(status.adbPath, ['reconnect', 'offline']).catch(() => undefined);
      await sleep(750);
      devices = await adbDevices().catch(() => []);
    }

    if (devices.some((device) => device.serial.startsWith('emulator-') && device.state === 'offline')) {
      await execFileAsync(status.adbPath, ['kill-server']).catch(() => undefined);
      await sleep(300);
      await execFileAsync(status.adbPath, ['start-server']);
      await sleep(750);
      devices = await adbDevices().catch(() => []);
    }
    return devices;
  }

  async function chromeReady(serial) {
    const status = tools();
    if (!status.adbAvailable || !status.adbPath) return false;
    const { stdout } = await execFileAsync(status.adbPath, ['-s', serial, 'shell', 'pm', 'path', 'com.android.chrome']).catch(() => ({ stdout: '' }));
    return /package:/i.test(String(stdout || ''));
  }

  async function listAvds() {
    const status = tools();
    if (!status.emulatorAvailable || !status.emulatorPath) return [];
    const { stdout } = await execFileAsync(status.emulatorPath, ['-list-avds']);
    return parseAvdList(stdout);
  }

  async function adbDevices() {
    const status = tools();
    if (!status.adbAvailable || !status.adbPath) return [];
    const { stdout } = await execFileAsync(status.adbPath, ['devices']);
    return parseAdbDevices(stdout);
  }

  async function getStatus() {
    const status = tools();
    let avds = [];
    let devices = [];
    let error = null;
    try {
      if (status.emulatorAvailable) avds = await listAvds();
      if (status.adbAvailable) devices = await adbDevices();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    return { ...status, avds, devices, error };
  }

  async function avdNameForSerial(serial) {
    const status = tools();
    if (!status.adbAvailable || !status.adbPath) return '';
    return execFileAsync(status.adbPath, ['-s', serial, 'emu', 'avd', 'name'])
      .then(({ stdout }) => String(stdout).split(/\r?\n/).map((line) => line.trim()).find((line) => line && line !== 'OK') || '')
      .catch(() => '');
  }

  async function waitForReady(timeoutMs = 180000, avdName = '') {
    const status = tools();
    if (!status.adbAvailable || !status.adbPath) throw new Error('ADB is unavailable. Install Android SDK Platform Tools.');
    const started = Date.now();
    let lastSerial = null;
    let attemptedOfflineRecovery = false;

    while (Date.now() - started < timeoutMs) {
      let allDevices = await adbDevices().catch(() => []);
      const offline = allDevices.filter((device) => device.serial.startsWith('emulator-') && device.state === 'offline');
      if (offline.length > 0 && !attemptedOfflineRecovery) {
        attemptedOfflineRecovery = true;
        await execFileAsync(status.adbPath, ['reconnect', 'offline']).catch(() => undefined);
        await sleep(750);
        allDevices = await adbDevices().catch(() => []);
      }

      const devices = allDevices.filter((device) => device.state === 'device' && device.serial.startsWith('emulator-'));
      for (const ready of devices) {
        if (avdName) {
          const runningName = await avdNameForSerial(ready.serial);
          if (runningName && runningName !== avdName) continue;
          if (!runningName && devices.length > 1) continue;
        }
        lastSerial = ready.serial;
        const { stdout } = await execFileAsync(status.adbPath, ['-s', ready.serial, 'shell', 'getprop', 'sys.boot_completed']).catch(() => ({ stdout: '' }));
        if (String(stdout).trim() !== '1') continue;
        if (!(await chromeReady(ready.serial))) continue;
        return { serial: ready.serial, state: 'ready' };
      }
      await sleep(1500);
    }

    throw new Error(lastSerial ? `Android emulator ${lastSerial} did not finish booting with Chrome ready in time.` : avdName ? `Android virtual device ${avdName} did not appear in ADB before timeout.` : 'Android emulator did not appear in ADB before timeout.');
  }

  async function launchAvd(name) {
    if (!isSafeAvdName(name)) throw new Error('Choose a valid Android virtual device');
    const status = tools();
    if (!status.sdkPath) throw new Error('Android SDK not found. Install Android Studio and Android SDK tools.');
    if (!status.emulatorAvailable || !status.emulatorPath) throw new Error('Android Emulator is unavailable. Install it from Android SDK Manager.');
    if (!status.adbAvailable || !status.adbPath) throw new Error('ADB is unavailable. Install Android SDK Platform Tools.');

    const avds = await listAvds();
    if (!avds.includes(name)) throw new Error(`Android virtual device not found: ${name}`);

    const existingDevices = (await ensureAdbReady()).filter((device) => device.state === 'device' && device.serial.startsWith('emulator-'));
    for (const existing of existingDevices) {
      const boot = await execFileAsync(status.adbPath, ['-s', existing.serial, 'shell', 'getprop', 'sys.boot_completed']).catch(() => ({ stdout: '' }));
      if (String(boot.stdout).trim() !== '1') continue;
      const runningName = await avdNameForSerial(existing.serial);
      if (runningName === name || (!runningName && existingDevices.length === 1)) {
        if (await chromeReady(existing.serial)) return { serial: existing.serial, state: 'ready', alreadyRunning: true };
      }
    }

    const child = spawn(status.emulatorPath, ['-avd', name, '-no-snapshot-load', '-no-boot-anim'], {
      // Keep the emulator in the same foreground process model as a successful
      // manual launch. On Windows, detaching the emulator can make startup
      // failures invisible and can prevent the virtual device from ever
      // registering with the ADB server owned by this session.
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
      shell: false,
    });

    const readyPromise = waitForReady(180000, name);
    const earlyExitPromise = typeof child.once === 'function'
      ? new Promise((_, reject) => {
        child.once('error', (cause) => {
          reject(new Error(`Android emulator process failed to start: ${cause instanceof Error ? cause.message : String(cause)}`));
        });
        child.once('exit', (code, signal) => {
          const detail = code == null ? `signal ${signal || 'unknown'}` : `code ${code}`;
          reject(new Error(`Android emulator process exited before ADB became ready (${detail}). Open the AVD in Android Studio Device Manager to inspect the emulator startup error.`));
        });
      })
      : null;

    const result = earlyExitPromise
      ? await Promise.race([readyPromise, earlyExitPromise])
      : await readyPromise;

    if (typeof child.unref === 'function') child.unref();
    return result;
  }

  async function stopAvd(serial) {
    const status = tools();
    if (!status.adbAvailable || !status.adbPath) throw new Error('ADB is unavailable. Install Android SDK Platform Tools.');
    let target = serial;
    if (!target) {
      const devices = await adbDevices();
      target = devices.find((device) => device.serial.startsWith('emulator-') && device.state === 'device')?.serial;
    }
    if (!target || !/^emulator-\d+$/.test(target)) throw new Error('No running Android emulator was found');
    await execFileAsync(status.adbPath, ['-s', target, 'emu', 'kill']);
    return { serial: target, state: 'stopped' };
  }

  return { getStatus, listAvds, launchAvd, stopAvd, waitForReady };
}

module.exports = {
  discoverAndroidSdk,
  parseAvdList,
  parseAdbDevices,
  isSafeAvdName,
  createAndroidService,
};
