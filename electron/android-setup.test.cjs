const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createAndroidSetup } = require('./android-setup.cjs');

function harness() {
  const children = [];
  const calls = [];
  const env = { LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' };
  const service = createAndroidSetup({ env, platform: 'win32', arch: 'x64', existsSync: () => false,
    scriptPath: 'C:\\Program Files\\OrbitQA\\setup-android.ps1',
    spawn(file, args, options) {
      calls.push({ file, args, options });
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      children.push(child); return child;
    },
  });
  return { service, calls, children, env };
}

test('starts a single installer with literal arguments and exposes progress', () => {
  const { service, calls, children, env } = harness();
  assert.equal(service.start().running, true);
  service.start();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.ok(calls[0].args.includes('C:\\Program Files\\OrbitQA\\setup-android.ps1'));
  assert.equal(env.ANDROID_HOME, 'C:\\Users\\tester\\AppData\\Local\\Android\\Sdk');
  children[0].stdout.write('Downloading tools\n');
  children[0].stderr.write('Network diagnostic\n');
  assert.match(service.getState().log, /Downloading tools\nNetwork diagnostic/);
  children[0].emit('close', 0);
  assert.equal(service.getState().phase, 'complete');
  assert.equal(service.getState().running, false);
});

test('failed installation can be retried and clears previous logs', () => {
  const { service, children, calls } = harness();
  service.start(); children[0].stdout.write('old log'); children[0].emit('close', 1);
  assert.equal(service.getState().phase, 'failed');
  assert.match(service.getState().error, /exit 1/);
  service.start();
  assert.equal(calls.length, 2);
  assert.equal(service.getState().error, null);
  assert.doesNotMatch(service.getState().log, /old log/);
  children[1].emit('error', new Error('Cannot start PowerShell'));
  children[1].emit('close', -1);
  assert.equal(service.getState().error, 'Cannot start PowerShell');
});

test('rejects unsupported platforms before spawning', () => {
  const service = createAndroidSetup({ platform: 'linux', spawn() { assert.fail('must not spawn'); } });
  assert.throws(() => service.start(), /Windows/);
});
