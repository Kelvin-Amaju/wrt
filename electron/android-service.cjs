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
const DEFAULT_MAX_PARALLEL = 20;
const MAX_PARALLEL_CEILING = 64;
const DEFAULT_FLEET_BASE = 'OrbitQA_Pixel_7_Real';
const MAX_AVD_NAME_LENGTH = 64;

/*
 * Module-level launch coordination.
 *
 * Deliberately module-scoped, not instance-scoped: main.cjs and android-ipc.cjs
 * each build their own service, and both must agree on which emulator ports are
 * already spoken for. Every mutation below is synchronous between awaits, so the
 * chain plus the reservation set is enough to make port allocation atomic.
 */
let launchChain = Promise.resolve();
const reservedPorts = new Set();

function withLaunchLock(task) {
  const run = launchChain.then(task, task);
  launchChain = run.then(() => undefined, () => undefined);
  return run;
}

function reserveEmulatorPort(port) {
  reservedPorts.add(port);
  return port;
}

function releaseEmulatorPort(port) {
  reservedPorts.delete(port);
}

function reservedEmulatorPorts() {
  return [...reservedPorts];
}

function resetLaunchState() {
  reservedPorts.clear();
  launchChain = Promise.resolve();
}

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

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (!existsSync(candidate)) continue;
      const sdkPath = win.normalize(candidate);
      return {
        sdkPath,
        adbPath: win.join(sdkPath, 'platform-tools', 'adb.exe'),
        emulatorPath: win.join(sdkPath, 'emulator', 'emulator.exe'),
      };
    } catch {
      /* keep looking */
    }
  }

  return { sdkPath: '', adbPath: '', emulatorPath: '' };
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

function portFromSerial(serial) {
  const match = /^emulator-(\d+)$/.exec(String(serial || ''));
  return match ? Number(match[1]) : 0;
}

function fleetName(baseName, index) {
  const base = String(baseName || DEFAULT_FLEET_BASE).trim() || DEFAULT_FLEET_BASE;
  const suffix = `_${String(index).padStart(2, '0')}`;
  return `${base.slice(0, MAX_AVD_NAME_LENGTH - suffix.length)}${suffix}`;
}

/**
 * Cold-start-safe emulator arguments.
 *
 * Returns `{ args, hardened }` so callers (and tests) can assert whether a launch
 * carried retail -prop overrides. A plain AVD stays on the original cold-start
 * list; only a recognised retail profile picks up -gpu and -prop pairs.
 */
function buildAvdLaunchArgs(name, options = {}) {
  if (!isSafeAvdName(name)) {
    throw new Error(`Unsafe Android virtual device name: ${name}`);
  }

  const env = options.env || process.env;
  const args = ['-avd', name];
  if (options.port) args.push('-port', String(options.port));
  args.push('-no-snapshot-load', '-no-boot-anim');

  const profile = deviceHardening.findRealDeviceProfile(name);
  const hardened = Boolean(profile && !profile.emulationOnly);

  if (hardened) {
    args.push('-gpu', String(env.ORBITQA_AVD_GPU || 'host'));
    for (const prop of deviceHardening.buildHardeningProps(profile)) {
      args.push('-prop', prop);
    }
  }

  if (options.readOnly) args.push('-read-only');
  if (options.noWindow) args.push('-no-window');
  if (options.noAudio) args.push('-no-audio');

  return { args, hardened };
}

function createAndroidService(options = {}) {
  const env = options.env || process.env;
  const existsSync = options.existsSync || fs.existsSync;

  // Keep SDK and AVD discovery on the same home the emulator will resolve, including
  // Windows installs where the emulator does not resolve USERPROFILE itself.
  const emulatorEnv = { ...env };
  if (!emulatorEnv.ANDROID_AVD_HOME) {
    const userHome =
      emulatorEnv.ANDROID_EMULATOR_HOME ||
      emulatorEnv.ANDROID_USER_HOME ||
      (emulatorEnv.USERPROFILE ? win.join(emulatorEnv.USERPROFILE, '.android') : '');
    if (userHome) emulatorEnv.ANDROID_AVD_HOME = win.join(userHome, 'avd');
  }
  if (!emulatorEnv.JAVA_HOME) {
    const javaCandidates = [
      emulatorEnv.ORBITQA_JAVA_HOME,
      emulatorEnv.LOCALAPPDATA
        ? win.join(emulatorEnv.LOCALAPPDATA, 'OrbitQA', 'AndroidJava')
        : '',
      emulatorEnv.USERPROFILE
        ? win.join(emulatorEnv.USERPROFILE, 'AppData', 'Local', 'OrbitQA', 'AndroidJava')
        : '',
    ];
    for (const candidate of javaCandidates) {
      if (!candidate) continue;
      try {
        if (existsSync(candidate)) {
          emulatorEnv.JAVA_HOME = candidate;
          break;
        }
      } catch {
        /* ignore */
      }
    }
  }

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
  const sleep =
    typeof options.sleep === 'function'
      ? options.sleep
      : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const bootTimeoutMs = Number(options.bootTimeoutMs) || DEFAULT_BOOT_TIMEOUT_MS;
  const bootPollIntervalMs =
    Number(options.bootPollIntervalMs) || BOOT_POLL_INTERVAL_MS;
  const resolveSystemImage = options.detectSystemImage || null;

  // Serial -> { name, port, child, booted, stderr, startedAt } for launches this
  // process performed. Adb remains the authority; this map is for cleanup only.
  const tracked = new Map();

  function maxParallel() {
    const raw = Number(emulatorEnv.ORBITQA_AVD_MAX_PARALLEL);
    if (Number.isFinite(raw) && raw >= 1) {
      return Math.min(Math.floor(raw), MAX_PARALLEL_CEILING);
    }
    return DEFAULT_MAX_PARALLEL;
  }

  function tools() {
    const sdk = discoverAndroidSdk(emulatorEnv, existsSync);
    let emulatorAvailable = false;
    let adbAvailable = false;
    try {
      emulatorAvailable = Boolean(sdk.emulatorPath) && existsSync(sdk.emulatorPath);
    } catch {
      /* ignore */
    }
    try {
      adbAvailable = Boolean(sdk.adbPath) && existsSync(sdk.adbPath);
    } catch {
      /* ignore */
    }
    return {
      sdkRoot: sdk.sdkPath,
      emulatorPath: sdk.emulatorPath,
      adbPath: sdk.adbPath,
      emulatorAvailable,
      adbAvailable,
    };
  }

  function avdManagerPath() {
    const sdkRoot = tools().sdkRoot;
    if (!sdkRoot) return '';
    const candidates = [
      win.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'avdmanager.bat'),
      win.join(sdkRoot, 'cmdline-tools', 'bin', 'avdmanager.bat'),
      win.join(sdkRoot, 'tools', 'bin', 'avdmanager.bat'),
    ];
    for (const candidate of candidates) {
      try {
        if (existsSync(candidate)) return candidate;
      } catch {
        /* ignore */
      }
    }
    return '';
  }

  function detectSystemImage() {
    const sdkRoot = tools().sdkRoot;
    if (!sdkRoot) return null;
    const root = win.join(sdkRoot, 'system-images');
    try {
      if (!existsSync(root)) return null;
    } catch {
      return null;
    }

    const preferred = [];
    const fallback = [];
    try {
      for (const api of fs.readdirSync(root)) {
        const apiDir = win.join(root, api);
        if (!fs.statSync(apiDir).isDirectory()) continue;
        for (const variant of fs.readdirSync(apiDir)) {
          const variantDir = win.join(apiDir, variant);
          if (!fs.statSync(variantDir).isDirectory()) continue;
          for (const abi of fs.readdirSync(variantDir)) {
            if (!fs.statSync(win.join(variantDir, abi)).isDirectory()) continue;
            const id = `system-images;android-${api};${variant};${abi}`;
            if (/playstore/i.test(variant)) preferred.push(id);
            else if (/google_apis/i.test(variant)) fallback.push(id);
          }
        }
      }
    } catch {
      return null;
    }

    return preferred.sort().pop() || fallback.sort().pop() || null;
  }

  async function listAvds() {
    const status = tools();
    if (!status.emulatorAvailable || !status.emulatorPath) return [];
    const { stdout } = await execFileAsync(status.emulatorPath, ['-list-avds'], {
      env: emulatorEnv,
    });
    return parseAvdList(stdout);
  }

  async function ensureAdbReady() {
    const status = tools();
    if (!status.adbAvailable || !status.adbPath) return [];
    try {
      await execFileAsync(status.adbPath, ['start-server'], { env: emulatorEnv });
    } catch {
      /* ignore */
    }
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
    const used = new Set(reservedPorts);
    for (const serial of serials) {
      const port = portFromSerial(serial);
      if (port) used.add(port);
    }
    for (let port = FIRST_EMULATOR_PORT; port <= LAST_EMULATOR_PORT; port += 2) {
      if (!used.has(port)) return port;
    }
    throw new Error(
      `No free Android emulator port between ${FIRST_EMULATOR_PORT} and ${LAST_EMULATOR_PORT}`,
    );
  }

  async function killProcessTree(pid) {
    if (!pid) return;
    if (process.platform === 'win32') {
      await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        env: emulatorEnv,
      }).catch(() => undefined);
      return;
    }
    try {
      process.kill(pid);
    } catch {
      /* already gone */
    }
  }

  async function waitForBoot(serial, waitOptions = {}) {
    const status = tools();
    if (!status.adbAvailable || !status.adbPath) return true;

    const timeoutMs = Number(waitOptions.timeoutMs) || bootTimeoutMs;
    const pollMs = Number(waitOptions.pollMs) || bootPollIntervalMs;
    const label = waitOptions.name || serial;
    const child = waitOptions.child;
    const deadline = Date.now() + timeoutMs;

    // Resolves the instant the emulator process dies, so a startup failure is
    // reported immediately instead of burning the whole boot timeout.
    const exited = new Promise((resolve) => {
      if (child && typeof child.once === 'function') {
        child.once('exit', (code, signal) => resolve({ kind: 'exit', code, signal }));
        child.once('error', (error) => resolve({ kind: 'error', error }));
      }
    });

    const booted = (async () => {
      while (Date.now() < deadline) {
        const attached = await ensureAdbReady().catch(() => []);
        const device = attached.find((entry) => entry.serial === serial);
        if (device && device.state === 'device') {
          try {
            const { stdout } = await execFileAsync(
              status.adbPath,
              ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
              { env: emulatorEnv },
            );
            if (String(stdout || '').trim() === '1') return { kind: 'booted' };
          } catch {
            /* keep polling */
          }
        }
        await sleep(pollMs);
      }
      return { kind: 'timeout' };
    })();

    const outcome = await Promise.race([booted, exited]);
    if (outcome.kind === 'booted') return true;

    if (outcome.kind === 'timeout') {
      throw new Error(
        `Android virtual device ${label} did not finish booting on ${serial} within ${Math.round(
          timeoutMs / 1000,
        )}s`,
      );
    }

    if (outcome.kind === 'error') {
      throw new Error(
        `Android emulator failed to start for ${label}: ${outcome.error.message}`,
      );
    }

    const detail = outcome.code == null ? 'unknown code' : `code ${outcome.code}`;
    const tail = String(tracked.get(serial)?.stderr || '').trim().slice(-240);
    throw new Error(
      `Android emulator process exited (${detail}) before ${label} finished booting on ${serial}` +
        (tail ? `: ${tail}` : ''),
    );
  }

  async function adoptRunning(name) {
    const status = tools();
    if (!status.adbAvailable) return null;
    const devices = await ensureAdbReady();
    for (const device of devices) {
      if (!/^emulator-\d+$/.test(device.serial)) continue;
      const runningName = await avdNameForSerial(device.serial);
      if (runningName !== name) continue;
      if (device.state === 'offline' && status.adbPath) {
        await execFileAsync(status.adbPath, ['reconnect', 'offline'], {
          env: emulatorEnv,
        }).catch(() => undefined);
      }
      const port = portFromSerial(device.serial);
      tracked.set(device.serial, {
        name,
        port,
        child: null,
        booted: device.state === 'device',
        startedAt: Date.now(),
      });
      reserveEmulatorPort(port);
      return { serial: device.serial, port, alreadyRunning: true };
    }
    return null;
  }

  async function launchAvd(name, launchOptions = {}) {
    if (!isSafeAvdName(name)) {
      throw new Error(`Unsafe Android virtual device name: ${name}`);
    }

    const status = tools();
    if (!status.emulatorAvailable || !status.emulatorPath) {
      throw new Error(
        'Android emulator was not found. Run the Android setup first.',
      );
    }

    const avds = await listAvds();
    if (!avds.includes(name)) {
      throw new Error(
        `Android virtual device not found: ${name}. Create a fleet with the fleet setup, or run tools/create-real-device-avd.ps1, then refresh devices.`,
      );
    }

    const reuse = launchOptions.reuse !== false;
    const requestedPort = Number(launchOptions.port) || 0;

    const launched = await withLaunchLock(async () => {
      if (reuse) {
        const adopted = await adoptRunning(name);
        if (adopted) return adopted;
      }

      const serials = await runningSerials();
      const port = requestedPort || nextFreePort(serials);
      reserveEmulatorPort(port);
      const serial = `emulator-${port}`;

      const { args } = buildAvdLaunchArgs(name, {
        env: emulatorEnv,
        port,
        readOnly: emulatorEnv.ORBITQA_AVD_READ_ONLY === '1',
        noWindow: emulatorEnv.ORBITQA_AVD_NO_WINDOW === '1',
        noAudio: true,
      });

      const child = spawnEmulator(status.emulatorPath, args, {
        env: emulatorEnv,
        // Keep the emulator in the same foreground process model as a successful
        // manual launch; detaching hides startup failures on Windows.
        detached: false,
        stdio: 'ignore',
        windowsHide: false,
        shell: false,
      });

      const entry = { name, port, child, booted: false, stderr: '', startedAt: Date.now() };
      tracked.set(serial, entry);

      if (child && typeof child.on === 'function') child.on('error', () => {});
      if (child && child.stderr && typeof child.stderr.on === 'function') {
        child.stderr.on('data', (chunk) => {
          entry.stderr = (entry.stderr + String(chunk)).slice(-4000);
        });
      }
      if (child && typeof child.unref === 'function') child.unref();

      return { serial, port, alreadyRunning: false, child };
    });

    if (launched.alreadyRunning) {
      return {
        serial: launched.serial,
        state: 'ready',
        alreadyRunning: true,
        name,
        port: launched.port,
      };
    }

    try {
      await waitForBoot(launched.serial, {
        child: launched.child,
        name,
        timeoutMs: bootTimeoutMs,
        pollMs: bootPollIntervalMs,
      });
      const entry = tracked.get(launched.serial);
      if (entry) entry.booted = true;
      return {
        serial: launched.serial,
        state: 'ready',
        alreadyRunning: false,
        name,
        port: launched.port,
      };
    } catch (error) {
      await stopAvd(launched.serial).catch(() => undefined);
      throw error;
    }
  }

  async function createAvd(name, createOptions = {}) {
    if (!isSafeAvdName(name)) {
      throw new Error(`Unsafe Android virtual device name: ${name}`);
    }
    const existing = await listAvds();
    if (existing.includes(name)) return { name, created: false };

    const avdmanager = createOptions.avdManagerPath || avdManagerPath();
    if (!avdmanager) {
      throw new Error('avdmanager was not found. Run the Android setup first.');
    }
    const image =
      createOptions.image || (resolveSystemImage || detectSystemImage)();
    if (!image) {
      throw new Error(
        'No Android system image is installed. Run the Android setup first.',
      );
    }

    const args = [
      'create',
      'avd',
      '-n',
      name,
      '-k',
      image,
      '--device',
      createOptions.device || 'pixel_7',
      '--force',
    ];

    await new Promise((resolve, reject) => {
      const child = spawnEmulator(avdmanager, args, {
        env: emulatorEnv,
        windowsHide: true,
        shell: false,
      });

      if (!child || typeof child.once !== 'function') {
        resolve();
        return;
      }

      let stderr = '';
      if (child.stderr && typeof child.stderr.on === 'function') {
        child.stderr.on('data', (chunk) => {
          stderr += String(chunk);
        });
      }
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || 'avdmanager failed to create the device.'));
      });
      if (child.stdin && typeof child.stdin.end === 'function') {
        child.stdin.end('no\n');
      }
    });

    return { name, created: true };
  }

  async function ensureFleetAvds(names) {
    const existing = await listAvds();
    const created = [];
    for (const name of names) {
      if (existing.includes(name)) continue;
      await createAvd(name);
      created.push(name);
    }
    return created;
  }

  async function launchFleet(fleetOptions = {}) {
    const baseName = String(fleetOptions.baseName || DEFAULT_FLEET_BASE).trim() ||
      DEFAULT_FLEET_BASE;
    const limit = maxParallel();
    const requested = Number(fleetOptions.count);
    const count = Math.max(
      1,
      Math.min(
        Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 1,
        limit,
      ),
    );

    const names = [];
    for (let index = 1; index <= count; index += 1) names.push(fleetName(baseName, index));

    if (fleetOptions.ensure !== false) await ensureFleetAvds(names);

    const reuse = fleetOptions.reuse !== false;
    const results = new Array(names.length);
    let cursor = 0;

    const workers = [];
    const workerCount = Math.max(1, Math.min(count, limit));
    for (let worker = 0; worker < workerCount; worker += 1) {
      workers.push(
        (async () => {
          for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= names.length) return;
            results[index] = await launchAvd(names[index], { reuse });
          }
        })(),
      );
    }
    await Promise.all(workers);

    return { baseName, count, devices: results.filter(Boolean) };
  }

  async function stopAvd(serialOrName) {
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

    const status = tools();
    if (status.adbAvailable && status.adbPath) {
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
        } catch {
          /* ignore */
        }
      }
    }

    const entry = tracked.get(serial);
    if (entry && entry.child && typeof entry.child.pid === 'number') {
      await killProcessTree(entry.child.pid);
    }
    tracked.delete(serial);
    releaseEmulatorPort(portFromSerial(serial));
    return true;
  }

  async function stopAll() {
    const serials = await runningSerials();
    const targets = [...new Set([...serials, ...tracked.keys()])];
    for (const serial of targets) {
      await stopAvd(serial).catch(() => undefined);
    }
    for (const port of reservedEmulatorPorts()) releaseEmulatorPort(port);
    return targets;
  }

  async function getStatus() {
    const status = tools();

    let avds = [];
    if (status.emulatorAvailable) {
      avds = await listAvds().catch(() => []);
    }

    let devices = [];
    try {
      devices = await ensureAdbReady();
    } catch {
      devices = [];
    }

    const running = [];
    for (const device of devices) {
      if (!/^emulator-\d+$/.test(device.serial)) continue;
      running.push({
        serial: device.serial,
        state: device.state,
        avdName: await avdNameForSerial(device.serial),
      });
    }

    let error = null;
    if (!status.emulatorAvailable) {
      error = 'Android emulator was not found. Run the Android setup below.';
    }

    // Payload matches MobileStatus in src/shared/mobileDevices.ts exactly.
    return {
      sdkPath: status.sdkRoot || null,
      adbPath: status.adbPath || null,
      emulatorPath: status.emulatorPath || null,
      adbAvailable: status.adbAvailable,
      emulatorAvailable: status.emulatorAvailable,
      avds,
      devices: devices.map((device) => ({
        serial: device.serial,
        state: device.state,
      })),
      running,
      runningSerials: running.map((entry) => entry.serial),
      avdHome: emulatorEnv.ANDROID_AVD_HOME || '',
      maxParallel: maxParallel(),
      error,
    };
  }

  return {
    tools,
    maxParallel,
    detectSystemImage,
    avdManagerPath,
    getStatus,
    listAvds,
    ensureAdbReady,
    adbDevices: ensureAdbReady,
    launchAvd,
    launchFleet,
    createAvd,
    ensureFleetAvds,
    stopAvd,
    stopAll,
    buildAvdLaunchArgs,
  };
}

module.exports = {
  DEFAULT_FLEET_BASE,
  MAX_PARALLEL_CEILING,
  discoverAndroidSdk,
  parseAvdList,
  parseAdbDevices,
  isSafeAvdName,
  buildAvdLaunchArgs,
  createAndroidService,
  fleetName,
  portFromSerial,
  reservedEmulatorPorts,
  resetLaunchState,
};