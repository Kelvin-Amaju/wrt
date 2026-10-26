'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { setTimeout: sleep } = require('node:timers/promises');

const EXEC_OPTS = { windowsHide: true, maxBuffer: 16 * 1024 * 1024 };
const FATAL_STDERR = /^(error|fatal|Exception)\b|Activity not started|cannot find|not found/i;

class AndroidRuntimeError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'AndroidRuntimeError';
    this.detail = detail || '';
  }
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function sdkCandidates() {
  const roots = [];
  for (const key of ['ORBITQA_ANDROID_SDK', 'ANDROID_SDK_ROOT', 'ANDROID_HOME']) {
    const value = process.env[key];
    if (value) roots.push(value);
  }
  const local = process.env.LOCALAPPDATA;
  if (local) roots.push(path.join(local, 'Android', 'Sdk'));
  roots.push(path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'));
  roots.push(path.join(os.homedir(), 'Android', 'Sdk'));
  return roots;
}

let cachedSdk;

function resolveSdk() {
  if (cachedSdk !== undefined) return cachedSdk;
  cachedSdk = null;
  for (const root of sdkCandidates()) {
    if (!root) continue;
    if (isFile(path.join(root, 'platform-tools', 'adb.exe'))) {
      cachedSdk = root;
      break;
    }
  }
  return cachedSdk;
}

function clearSdkCache() {
  cachedSdk = undefined;
}

function toolPath(relative) {
  const sdk = resolveSdk();
  if (!sdk) return null;
  const full = path.join(sdk, relative);
  return isFile(full) ? full : null;
}

function adbPath() {
  return toolPath(path.join('platform-tools', 'adb.exe'));
}

function emulatorPath() {
  return toolPath(path.join('emulator', 'emulator.exe'));
}

function avdManagerPath() {
  const candidates = [
    path.join('cmdline-tools', 'latest', 'bin', 'avdmanager.bat'),
    path.join('cmdline-tools', 'bin', 'avdmanager.bat'),
    path.join('tools', 'bin', 'avdmanager.bat'),
  ];
  for (const candidate of candidates) {
    const found = toolPath(candidate);
    if (found) return found;
  }
  return null;
}

function sdkManagerPath() {
  const candidates = [
    path.join('cmdline-tools', 'latest', 'bin', 'sdkmanager.bat'),
    path.join('cmdline-tools', 'bin', 'sdkmanager.bat'),
    path.join('tools', 'bin', 'sdkmanager.bat'),
  ];
  for (const candidate of candidates) {
    const found = toolPath(candidate);
    if (found) return found;
  }
  return null;
}

function execTool(bin, args, options) {
  return new Promise((resolve, reject) => {
    if (!bin) {
      reject(new AndroidRuntimeError('Android tool is not installed.'));
      return;
    }
    execFile(bin, args, { ...EXEC_OPTS, ...(options || {}) }, (error, stdout, stderr) => {
      const out = String(stdout || '');
      const err = String(stderr || '');
      if (error) {
        reject(new AndroidRuntimeError(
          (err.trim() || out.trim() || error.message || 'Android command failed.'),
          `${path.basename(bin)} ${args.join(' ')}`,
        ));
        return;
      }
      resolve({ stdout: out, stderr: err });
    });
  });
}

async function execAdb(serial, args, options) {
  const bin = adbPath();
  if (!bin) throw new AndroidRuntimeError('ADB is not available.');
  const argv = serial ? ['-s', String(serial), ...args] : args;
  const result = await execTool(bin, argv, options);
  if (FATAL_STDERR.test(result.stderr.trim()) && !result.stdout.trim()) {
    throw new AndroidRuntimeError(result.stderr.trim(), `adb ${argv.join(' ')}`);
  }
  return result.stdout;
}

function adbFor(serial) {
  return (args, options) => execAdb(serial, args, options);
}

async function ensureAdbServer() {
  if (!adbPath()) throw new AndroidRuntimeError('ADB is not available.');
  await execTool(adbPath(), ['start-server'], { timeout: 30000 }).catch(() => {});
}

async function listAttachedDevices() {
  const out = await execAdb(null, ['devices', '-l']).catch(() => '');
  const lines = out.split(/\r?\n/).slice(1);
  const devices = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [serial, state] = trimmed.split(/\s+/);
    if (!serial) continue;
    const modelMatch = trimmed.match(/model:([^\s]+)/);
    devices.push({
      serial,
      state: state || 'unknown',
      model: modelMatch ? modelMatch[1].replace(/_/g, ' ') : '',
      emulator: serial.startsWith('emulator-'),
    });
  }
  return devices;
}

async function listAvdNames() {
  const bin = emulatorPath();
  if (!bin) return [];
  const out = await execTool(bin, ['-list-avds']).then((r) => r.stdout).catch(() => '');
  return out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function detectSystemImage() {
  const sdk = resolveSdk();
  if (!sdk) return null;
  const root = path.join(sdk, 'system-images');
  if (!fs.existsSync(root)) return null;

  const preferred = [];
  const fallback = [];
  for (const api of fs.readdirSync(root)) {
    const apiDir = path.join(root, api);
    if (!fs.statSync(apiDir).isDirectory()) continue;
    for (const variant of fs.readdirSync(apiDir)) {
      const variantDir = path.join(apiDir, variant);
      if (!fs.statSync(variantDir).isDirectory()) continue;
      for (const abi of fs.readdirSync(variantDir)) {
        if (!fs.statSync(path.join(variantDir, abi)).isDirectory()) continue;
        const id = `system-images;android-${api};${variant};${abi}`;
        if (/playstore/i.test(variant)) preferred.push(id);
        else if (/google_apis/i.test(variant)) fallback.push(id);
      }
    }
  }
  const pick = preferred.sort().pop() || fallback.sort().pop() || null;
  return pick;
}

function maxDevices() {
  const raw = Number(process.env.ORBITQA_MAX_DEVICES);
  if (Number.isFinite(raw) && raw >= 1) return Math.min(Math.floor(raw), 4);
  return 2;
}

module.exports = {
  AndroidRuntimeError,
  adbFor,
  adbPath,
  avdManagerPath,
  clearSdkCache,
  detectSystemImage,
  emulatorPath,
  ensureAdbServer,
  execAdb,
  execTool,
  isFile,
  listAttachedDevices,
  listAvdNames,
  maxDevices,
  resolveSdk,
  sdkManagerPath,
  sleep,
};