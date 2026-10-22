'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const deviceHardening = require('./device-hardening.cjs');

const win = path.win32;
const AVD_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const FIRST_EMULATOR_PORT = 5554;
const LAST_EMULATOR_PORT = 5680;
const BOOT_POLL_INTERVAL_MS = 1500;
const DEFAULT_BOOT_TIMEOUT_MS = 240000;

function isSafeAvdName(name) {
  return typeof name === 'string' && AVD_NAME_PATTERN.test(name);
}

function discoverAndroidSdk(env = process.env, existsSync = fs.existsSync) {
  const candidates = [
    env.ANDROID_SDK_ROOT,
    env.ANDROID_HOME,
    env.LOCALAPPDATA ? win.join(env.LOCALAPPDATA, 'Android', 'Sdk') : '',
    env.USERPROFILE
      ? win.join(env.USERPROFILE, 'AppData', 'Local', 'Android', 'Sdk')
      : '',
    'C:\\Android\\Sdk',
  ];

  for (const sdkPath of candidates) {
    if (!sdkPath) continue;
    try {
      if (existsSync(sdkPath)) return sdkPath;
    } catch {}
  }
  return '';
}

function parseAvdList(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && isSafeAvdName(line));
}

function parseAdbDevices(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^List of devices attached/i.test(line))
    .map((line) => {
      const parts = line.split(/\s+/);
      return { serial: parts[0] || '', state: parts[1] || 'unknown' };
    })
    .filter((device) => device.serial);
}

/**
 * Cold-start-safe emulator arguments.
 *
 * -no-snapshot-load / -no-boot-anim keep every boot deterministic, which matters when
 * twenty emulators boot at once. -port is explicit so a fleet never collides, and the
 * retail -prop overrides are only applied for real-device profiles (an emulation-only
 * profile must keep the system image's own fingerprint).
 */
function buildAvdLaunchArgs(name, options = {}) {
  if (!isSafeAvdName(name)) {
    throw new Error(`Unsafe Android virtual device name: ${name}`);
  }
  const env = options.env || process.env;
  const args = ['-avd', name];
  if (options.port) args.push('-port', String(options.port));
  args.push('-no-snapshot-load', '-no-boot-anim', '-no-audio');
  if (options.readOnly) args.push('-read-only');
  if (options.noWindow) args.push('-no-window');
  args.push('-gpu', String(env.ORBITQA_AVD_GPU || 'host'));

  const profile = deviceHardening.findRealDeviceProfile(name);
  if (profile && !profile.emulationOnly) {
    for (const prop of deviceHardening.buildHardeningProps(profile)) {
      args.push('-prop', prop);
    }
  }
  return args;
}

function createAndroidService(options = {}) {
  const env = options.env || process.env;
  // Use the same AVD home for discovery and launch, including on Windows
  // installations where the emulator does not resolve USERPROFILE itself.
  const emulatorEnv = { ...env };
  if (!emulatorEnv.ANDROID_AVD_HOME) {
    const userHome =
      env.ANDROID_EMULATOR_HOME ||
      env.ANDROID_USER_HOME ||
      (env.USERPROFILE ? win.join(env.USERPROFILE, '.android') : '');
    if (userHome) emulatorEnv.ANDROID_AVD_HOME = win.join(userHome, 'avd');
  }
  const existsSync = options.existsSync || fs.existsSync;
  const execFileAsync =
    options.execFileAsync ||
    ((file, args, opts) =>
      new Promise((resolve, reject) => {
        execFile(
          file,
          args,
          { ...(opts || {}), windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
          (error, stdout, stderr) => {
            if (error) {
              error.stdout = stdout;
              error.stderr = stderr;
              reject(error);
              return;
            }
            resolve({ stdout, stderr });
          },
        );
      }));
  const spawnEmulator = options.spawn || spawn;
  const bootTimeoutMs = Number(options.bootTimeoutMs) || DEFAULT_BOOT_TIMEOUT_MS;
  const bootPollIntervalMs =
    Number(options.bootPollIntervalMs) || BOOT_POLL_INTERVAL_MS;

  // Serial -> { name } for emulators this process launched or adopted.
  const tracked = new Map();

  function tools() {
    const sdkRoot = discoverAndroidSdk(emulatorEnv, existsSync);
    const emulatorPath = sdkRoot
      ? win.join(sdkRoot, 'emulator', 'emulator.exe')
      : '';
    const adbPath = sdkRoot ? win.join(sdkRoot, 'platform-tools', 'adb.exe') : '';
    let emulatorAvailable = false;
    let adbAvailable = false;
    try {
      emulatorAvailable = Boolean(emulatorPath) && existsSync(emulatorPath);
    } catch {}
    try {
      adbAvailable = Boolean(adbPath) && existsSync(adbPath);
    } catch {}
    return { sdkRoot, emulatorPath, adbPath, emulatorAvailable, adbAvailable };
  }

  async function listAvds() {
    const status = tools();
    if (!status.emulatorAvailable || !status.emulatorPath) return [];
    const { stdout } = await execFileAsync(
      status.emulatorPath,
      ['-list-avds'],
      { env: emulatorEnv },
    );
    return parseAvdList(stdout);
  }

  async function ensureAdbReady() {
    const status = tools();
    if (!status.adbAvailable || !status.adbPath) return [];
    try {
      await execFileAsync(status.adbPath, ['start-server'], {
        env: emulatorEnv,
      });
    } catch {}
    try {
      const { stdout } = await execFileAsync(status.adbPath, ['devices'], {
        env: emulatorEnv,
      });
      return parseAdbDevices(stdout);
    } catch {
      return [];
    }
  }

  async function avdNameForSerial(serial) {
    const status = tools();
    if (!status.adbAvailable || !serial) return '';
    try {
      const { stdout } = await execFileAsync(
        status.adbPath,
        ['-s', serial, 'emu', 'avd', 'name'],
        { env: emulatorEnv },
      );
      return String(stdout || '').split(/\r?\n/)[0].trim();
    } catch {
      return '';
    }
  }

  async function runningSerials() {
    const devices = await ensureAdbReady();
    return devices
      .map((device) => device.serial)
      .filter((serial) => /^emulator-\d+$/.test(serial));
  }

  function nextFreePort(serials) {
    const used = new Set(
      serials
        .map((serial) => /^emulator-(\d+)$/.exec(serial)?.[1])
        .filter(Boolean)
        .map(Number),
    );
    for (
      let port = FIRST_EMULATOR_PORT;
      port <= LAST_EMULATOR_PORT;
      port += 2
    ) {
      if (!used.has(port)) return port;
    }
    throw new Error(
      `No free Android emulator port between ${FIRST_EMULATOR_PORT} and ${LAST_EMULATOR_PORT}`,
    );
  }

  async function waitForBoot(serial) {
    const status = tools();
    if (!status.adbAvailable) return false;
    const deadline = Date.now() + bootTimeoutMs;
    while (Date.now() < deadline) {
      try {
        const { stdout } = await execFileAsync(
          status.adbPath,
          ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
          { env: emulatorEnv },
        );
        if (String(stdout || '').trim() === '1') return true;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, bootPollIntervalMs));
    }
    return false;
  }

  async function launchAvd(name) {
    if (!isSafeAvdName(name)) {
      throw new Error(`Unsafe Android virtual device name: ${name}`);
    }
    const status = tools();
    if (!status.emulatorAvailable || !status.emulatorPath) {
      throw new Error(
        'Android emulator was not found. Run tools/setup-android-sdk.ps1 first.',
      );
    }
    const avds = await listAvds();
    if (!avds.includes(name)) {
      throw new Error(
        `Android virtual device not found: ${name}. Create an Android virtual device with powershell -ExecutionPolicy Bypass -File tools/create-real-device-avd.ps1, then refresh devices.`,
      );
    }

    // Reuse an emulator that is already running this exact AVD.
    const serials = await runningSerials();
    for (const serial of serials) {
      const runningName = await avdNameForSerial(serial);
      if (runningName && runningName === name) {
        tracked.set(serial, { name });
        return { serial, state: 'ready', alreadyRunning: true, name };
      }
    }

    const port = nextFreePort(serials);
    const serial = `emulator-${port}`;
    const args = buildAvdLaunchArgs(name, {
      env: emulatorEnv,
      port,
      readOnly: emulatorEnv.ORBITQA_AVD_READ_ONLY === '1',
      noWindow: emulatorEnv.ORBITQA_AVD_NO_WINDOW === '1',
    });

    const child = spawnEmulator(status.emulatorPath, args, {
      env: emulatorEnv,
      // Keep the emulator in the same foreground process model as a successful
      // manual launch. On Windows, detaching the emulator can make startup
      // failures invisible and can prevent the virtual device from ever starting.
      detached: false,
      stdio: 'ignore',
      windowsHide: false,
    });
    child?.on?.('error', () => {});
    child?.unref?.();
    tracked.set(serial, { name, child });

    const booted = await waitForBoot(serial);
    if (!booted) {
      throw new Error(
        `Android virtual device ${name} did not finish booting on ${serial} within ${Math.round(bootTimeoutMs / 1000)}s`,
      );
    }
    return { serial, state: 'ready', alreadyRunning: false, name };
  }

  async function stopAvd(serialOrName) {
    const status = tools();
    if (!status.adbAvailable) return false;
    const target = String(serialOrName || '').trim();
    if (!target) return false;

    let serial = /^emulator-\d+$/.test(target) ? target : '';
    if (!serial) {
      for (const candidate of await runningSerials()) {
        if ((await avdNameForSerial(candidate)) === target) {
          serial = candidate;
          break;
        }
      }
    }
    if (!serial) return false;

    try {
      await execFileAsync(status.adbPath, ['-s', serial, 'emu', 'kill'], {
        env: emulatorEnv,
      });
    } catch {
      try {
        await execFileAsync(
          status.adbPath,
          ['-s', serial, 'shell', 'reboot', '-p'],
          { env: emulatorEnv },
        );
      } catch {}
    }
    tracked.delete(serial);
    return true;
  }

  async function stopAll() {
    const serials = await runningSerials();
    for (const serial of serials) {
      await stopAvd(serial).catch(() => undefined);
    }
    return serials;
  }

  async function getStatus() {
    const status = tools();
    let avds = [];
    if (status.emulatorAvailable) {
      avds = await listAvds().catch(() => []);
    }
    const devices = await ensureAdbReady();
    const running = [];
    for (const device of devices) {
      if (!/^emulator-\d+$/.test(device.serial)) continue;
      running.push({
        serial: device.serial,
        state: device.state,
        avdName: await avdNameForSerial(device.serial),
      });
    }
    return {
      sdkRoot: status.sdkRoot,
      emulatorPath: status.emulatorPath,
      emulatorAvailable: status.emulatorAvailable,
      adbPath: status.adbPath,
      adbAvailable: status.adbAvailable,
      avdHome: emulatorEnv.ANDROID_AVD_HOME || '',
      avds,
      running,
      runningSerials: running.map((entry) => entry.serial),
      maxParallel: Number(emulatorEnv.ORBITQA_AVD_MAX_PARALLEL) || 20,
    };
  }

  return {
    tools,
    getStatus,
    listAvds,
    ensureAdbReady,
    adbDevices: ensureAdbReady,
    launchAvd,
    stopAvd,
    stopAll,
    buildAvdLaunchArgs,
  };
}

module.exports = {
  discoverAndroidSdk,
  parseAvdList,
  parseAdbDevices,
  isSafeAvdName,
  buildAvdLaunchArgs,
  createAndroidService,
};