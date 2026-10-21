const path = require('node:path');
const { spawn } = require('node:child_process');
const { discoverAndroidSdk } = require('./android-service.cjs');

function createAndroidSetup(options = {}) {
  const env = options.env || process.env;
  const startProcess = options.spawn || spawn;
  let state = { running: false, phase: 'idle', log: '', error: null };
  function append(chunk) {
    state.log = (state.log + String(chunk)).slice(-24000);
  }
  function getState() { return { ...state }; }
  function start() {
    if (state.running) return getState();
    if ((options.platform || process.platform) !== 'win32') throw new Error('Android setup currently supports Windows x64 PCs.');
    if ((options.arch || process.arch) !== 'x64') throw new Error('Android setup requires an x64 PC.');
    const sdk = discoverAndroidSdk(env, options.existsSync).sdkPath || path.win32.join(env.LOCALAPPDATA, 'Android', 'Sdk');
    // Keep this process and subsequent SDK discovery in sync with the installer.
    env.ANDROID_HOME = sdk;
    env.ANDROID_SDK_ROOT = sdk;
    const script = options.scriptPath || path.join(__dirname, '..', 'tools', 'setup-android.ps1');
    state = { running: true, phase: 'installing', log: 'Starting Android setup...\n', error: null };
    try {
      const child = startProcess('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-SdkRoot', sdk], { env, windowsHide: true, shell: false });
      child.stdout.on('data', append);
      child.stderr.on('data', append);
      child.once('error', (error) => {
        state.running = false; state.phase = 'failed'; state.error = error.message;
      });
      child.once('close', (code) => {
        if (state.phase === 'failed') return;
        state.running = false;
        state.phase = code === 0 ? 'complete' : 'failed';
        if (code !== 0) state.error = `Android setup failed (exit ${code}). Check the setup log and retry.`;
      });
    } catch (error) {
      state.running = false; state.phase = 'failed'; state.error = error.message;
    }
    return getState();
  }
  return { start, getState };
}
module.exports = { createAndroidSetup };
