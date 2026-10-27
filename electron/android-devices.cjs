'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const runtime = require('./android-runtime.cjs');
const url = require('./android-url.cjs');
const { reservedEmulatorPorts } = require('./android-service.cjs');

const { AndroidRuntimeError, execAdb, execTool, sleep } = runtime;

const PORT_BASE = 5554;
const PORT_SPAN = 64;
const BOOT_TIMEOUT_MS = 240000;
const BASE_AVD_NAME = 'OrbitQA_Pixel_7_Real';
const DEVICE_PROFILE = 'pixel_7';

const running = new Map();

function isRunning(serial) {
  return running.has(serial);
}

function get(serial) {
  return running.get(serial) || null;
}

function list() {
  return [...running.values()]
    .map((entry) => ({
      serial: entry.serial,
      avdName: entry.avdName,
      port: entry.port,
      booted: entry.booted,
      startedAt: entry.startedAt,
    }))
    .sort((a, b) => a.startedAt - b.startedAt);
}

function portsInUse() {
  const used = new Set();
  for (const entry of running.values()) used.add(entry.port);
  // Ports already claimed by android-service launches in this process.
  for (const port of reservedEmulatorPorts()) used.add(port);
  return used;
}

async function allocatePort() {
  const used = portsInUse();
  const attached = await runtime.listAttachedDevices().catch(() => []);
  for (const device of attached) {
    const match = /^emulator-(\d+)$/.exec(device.serial);
    if (match) used.add(Number(match[1]));
  }

  for (let offset = 0; offset < PORT_SPAN; offset += 2) {
    const port = PORT_BASE + offset;
    if (!used.has(port)) return port;
  }
  throw new AndroidRuntimeError('No free emulator console port.');
}

function nextAvdName(port) {
  return `${BASE_AVD_NAME}_${port}`;
}

async function ensureBaseAvd() {
  const names = await runtime.listAvdNames();
  if (names.includes(BASE_AVD_NAME)) return BASE_AVD_NAME;
  const fallback = names[0];
  return fallback || null;
}

async function cloneAvd(sourceAvd, targetAvd) {
  const avdmanager = runtime.avdManagerPath();
  if (!avdmanager) {
    throw new AndroidRuntimeError('avdmanager is not installed.');
  }

  const image = runtime.detectSystemImage();
  if (!image) {
    throw new AndroidRuntimeError(
      'No Android system image is installed. Run the emulator setup first.',
    );
  }

  const existing = await runtime.listAvdNames();
  if (existing.includes(targetAvd)) return targetAvd;

  const args = ['create', 'avd', '-n', targetAvd, '-k', image, '--force'];
  args.push('--device', DEVICE_PROFILE);

  const input = 'no\n';
  await new Promise((resolve, reject) => {
    const child = spawn(avdmanager, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new AndroidRuntimeError(stderr.trim() || 'avdmanager failed.'));
    });
    child.stdin.end(input);
  });

  return targetAvd;
}

async function waitForBoot(serial, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const attached = await runtime.listAttachedDevices().catch(() => []);
    const device = attached.find((entry) => entry.serial === serial);
    if (device?.state === 'device') {
      const done = await execAdb(serial, ['shell', 'getprop', 'sys.boot_completed'])
        .then((out) => out.trim())
        .catch(() => '');
      if (done === '1') return;
    }
    await sleep(1000);
  }
  throw new AndroidRuntimeError(`${serial} never finished booting.`);
}

async function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    await execTool('taskkill.exe', ['/PID', String(pid), '/T', '/F']).catch(() => {});
    return;
  }
  try {
    process.kill(pid);
  } catch {
    /* already gone */
  }
}

async function stop(serial) {
  if (!serial) return { stopped: false, serial };
  await execAdb(serial, ['emu', 'kill']).catch(() => {});
  const entry = running.get(serial);
  if (entry) {
    await killProcessTree(entry.pid);
    running.delete(serial);
  }
  return { stopped: true, serial };
}

async function stopAll() {
  const serials = [...running.keys()];
  await Promise.all(serials.map((serial) => stop(serial)));
  return serials;
}

async function create(options) {
  const limit = runtime.maxDevices();
  if (running.size >= limit) {
    throw new AndroidRuntimeError(
      `Device limit reached (${limit}). Stop a device before adding another.`,
    );
  }

  const emulator = runtime.emulatorPath();
  if (!emulator) throw new AndroidRuntimeError('The Android emulator is not installed.');

  await runtime.ensureAdbServer();

  const requested = options?.avdName || (await ensureBaseAvd());
  if (!requested) {
    throw new AndroidRuntimeError(
      'No Android virtual device exists. Run the emulator setup first.',
    );
  }

  const port = await allocatePort();
  const serial = `emulator-${port}`;
  const avdName = await cloneAvd(requested, nextAvdName(port));

  const child = spawn(
    emulator,
    [
      '-avd', avdName,
      '-port', String(port),
      '-no-snapshot-load',
      '-no-boot-anim',
      '-no-audio',
      '-gpu', 'swiftshader_indirect',
      '-memory', '2048',
    ],
    { detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.unref();

  running.set(serial, {
    serial,
    avdName,
    port,
    pid: child.pid,
    booted: false,
    startedAt: Date.now(),
  });

  try {
    await waitForBoot(serial, BOOT_TIMEOUT_MS);
    const entry = running.get(serial);
    if (entry) entry.booted = true;
    await url.prepareChrome(runtime.adbFor(serial));
    return list().find((entry) => entry.serial === serial);
  } catch (error) {
    await stop(serial);
    throw error;
  }
}

async function open(serial, targetUrl, options) {
  const entry = running.get(serial);
  if (!entry) throw new AndroidRuntimeError(`Device ${serial} is not running.`);
  if (!entry.booted) throw new AndroidRuntimeError(`Device ${serial} is still booting.`);
  return url.openUrl(runtime.adbFor(serial), targetUrl, { ...options, serial });
}

function reset() {
  running.clear();
}

module.exports = {
  BOOT_TIMEOUT_MS,
  create,
  get,
  isRunning,
  list,
  open,
  reset,
  stop,
  stopAll,
};