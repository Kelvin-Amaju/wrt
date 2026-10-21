const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  discoverAndroidSdk,
  parseAvdList,
  parseAdbDevices,
  isSafeAvdName,
  buildAvdLaunchArgs,
  createAndroidService,
} = require('./android-service.cjs');

test('discovers Android SDK from environment and common Windows paths', () => {
  const seen = [];
  const result = discoverAndroidSdk(
    { ANDROID_SDK_ROOT: 'C:\\Android\\Sdk', LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' },
    (candidate) => { seen.push(candidate); return candidate.includes('Android\\Sdk'); },
  );
  assert.equal(result.sdkPath, path.win32.normalize('C:\\Android\\Sdk'));
  assert.equal(result.adbPath.endsWith(path.win32.join('platform-tools', 'adb.exe')), true);
  assert.equal(result.emulatorPath.endsWith(path.win32.join('emulator', 'emulator.exe')), true);
  assert.ok(seen.length >= 1);
});

test('parses AVD list and adb devices output', () => {
  assert.deepEqual(parseAvdList('Pixel_9_API_36\r\nTablet_API_35\r\n\r\n'), ['Pixel_9_API_36', 'Tablet_API_35']);
  assert.deepEqual(parseAdbDevices('List of devices attached\r\nemulator-5554\tdevice\r\nABC123\toffline\r\n'), [
    { serial: 'emulator-5554', state: 'device' },
    { serial: 'ABC123', state: 'offline' },
  ]);
});

test('passes an explicit Windows AVD home to emulator discovery', async () => {
  for (const overrides of [{}, { ANDROID_AVD_HOME: 'D:\\Avds' }, { ANDROID_USER_HOME: 'D:\\AndroidUser' }]) {
    const env = { USERPROFILE: 'C:\\Users\\tester', ANDROID_HOME: 'C:\\Android\\Sdk', ...overrides };
    const expected = overrides.ANDROID_AVD_HOME || path.win32.join(overrides.ANDROID_USER_HOME || 'C:\\Users\\tester\\.android', 'avd');
    const service = createAndroidService({ env, existsSync: () => true,
      execFileAsync: async (file, args, options) => {
        assert.equal(options.env.ANDROID_AVD_HOME, expected);
        return { stdout: 'OrbitQA_Pixel_7_Real\n' };
      },
    });
    assert.deepEqual(await service.listAvds(), ['OrbitQA_Pixel_7_Real']);
    assert.equal(env.ANDROID_AVD_HOME, overrides.ANDROID_AVD_HOME);
  }
});

test('rejects unsafe AVD names', () => {
  assert.equal(isSafeAvdName('Pixel_9_API_36'), true);
  assert.equal(isSafeAvdName('Pixel 9; calc.exe'), false);
  assert.equal(isSafeAvdName('../Pixel'), false);
});

test('leaves a plain AVD on the original cold-start argument list', () => {
  const { args, hardened } = buildAvdLaunchArgs('Pixel_9_API_36');
  assert.equal(hardened, false);
  assert.deepEqual(args, ['-avd', 'Pixel_9_API_36', '-no-snapshot-load', '-no-boot-anim']);
});

test('adds -gpu host and retail -prop pairs for a hardened AVD', () => {
  const { args, hardened } = buildAvdLaunchArgs('OrbitQA_Pixel_7_Real');
  assert.equal(hardened, true);
  assert.deepEqual(args.slice(0, 4), ['-avd', 'OrbitQA_Pixel_7_Real', '-no-snapshot-load', '-no-boot-anim']);
  assert.equal(args.includes('-gpu'), true);
  assert.equal(args[args.indexOf('-gpu') + 1], 'host');
  assert.equal(args.includes('-prop'), true);
  const propValues = args.filter((_, index) => args[index - 1] === '-prop');
  assert.equal(propValues.some((value) => value === 'ro.product.model=Pixel 7'), true);
  const fingerprint = propValues.find((value) => value.startsWith('ro.build.fingerprint='));
  assert.ok(fingerprint && !/sdk_gphone|generic/.test(fingerprint));
});

test('hardening props never leak into a non-matching AVD launch', async () => {
  const calls = [];
  let launched = false;
  const fakeExecFile = async (file, args) => {
    if (args[0] === '-list-avds') return { stdout: 'Pixel_9_API_36\n', stderr: '' };
    if (args[0] === 'devices') return { stdout: launched ? 'List of devices attached\nemulator-5554\tdevice\n' : 'List of devices attached\n', stderr: '' };
    if (args.includes('getprop')) return { stdout: '1\n', stderr: '' };
    if (args.includes('pm') && args.includes('path')) return { stdout: 'package:/data/app/com.android.chrome/base.apk\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const service = createAndroidService({
    env: { ANDROID_SDK_ROOT: 'C:\\Android\\Sdk' },
    existsSync: () => true,
    execFileAsync: fakeExecFile,
    spawn: (file, args, options) => { calls.push({ file, args, options }); launched = true; return { unref() {} }; },
    sleep: async () => undefined,
  });

  await service.launchAvd('Pixel_9_API_36');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.includes('-gpu'), false);
  assert.equal(calls[0].args.includes('-prop'), false);
});

test('launches an AVD with argument arrays and never shell text', async () => {
  const calls = [];
  let launched = false;
  const fakeExecFile = async (file, args) => {
    calls.push({ type: 'exec', file, args });
    if (args[0] === '-list-avds') return { stdout: 'Pixel_9_API_36\n', stderr: '' };
    if (args[0] === 'devices') return { stdout: launched ? 'List of devices attached\nemulator-5554\tdevice\n' : 'List of devices attached\n', stderr: '' };
    if (args.includes('getprop')) return { stdout: '1\n', stderr: '' };
    if (args.includes('pm') && args.includes('path')) return { stdout: 'package:/data/app/com.android.chrome/base.apk\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const fakeSpawn = (file, args, options) => {
    calls.push({ type: 'spawn', file, args, options });
    launched = true;
    return { unref() {} };
  };
  const service = createAndroidService({
    env: { ANDROID_SDK_ROOT: 'C:\\Android\\Sdk' },
    existsSync: () => true,
    execFileAsync: fakeExecFile,
    spawn: fakeSpawn,
    sleep: async () => undefined,
  });

  const result = await service.launchAvd('Pixel_9_API_36');
  assert.equal(result.state, 'ready');
  const spawnCall = calls.find((call) => call.type === 'spawn');
  assert.deepEqual(spawnCall.args.slice(0, 2), ['-avd', 'Pixel_9_API_36']);
  assert.equal(spawnCall.options.shell, false);
});

test('launches a requested AVD even when a different emulator is already running and waits for the matching serial', async () => {
  const calls = [];
  let spawnedSecond = false;
  const fakeExecFile = async (file, args) => {
    calls.push({ type: 'exec', file, args });
    if (args[0] === '-list-avds') return { stdout: 'Pixel_A\nPixel_B\n', stderr: '' };
    if (args[0] === 'devices') {
      return {
        stdout: spawnedSecond
          ? 'List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n'
          : 'List of devices attached\nemulator-5554\tdevice\n',
        stderr: '',
      };
    }
    if (args.includes('getprop')) return { stdout: '1\n', stderr: '' };
    if (args.includes('emu') && args.includes('avd') && args.includes('name')) {
      const serial = args[1];
      return { stdout: serial === 'emulator-5554' ? 'Pixel_A\nOK\n' : 'Pixel_B\nOK\n', stderr: '' };
    }
    if (args.includes('pm') && args.includes('path')) return { stdout: 'package:/data/app/com.android.chrome/base.apk\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const fakeSpawn = (file, args, options) => {
    calls.push({ type: 'spawn', file, args, options });
    spawnedSecond = true;
    return { unref() {} };
  };
  const service = createAndroidService({
    env: { ANDROID_SDK_ROOT: 'C:\\Android\\Sdk' },
    existsSync: () => true,
    execFileAsync: fakeExecFile,
    spawn: fakeSpawn,
    sleep: async () => undefined,
  });

  const result = await service.launchAvd('Pixel_B');
  assert.equal(result.serial, 'emulator-5556');
  assert.equal(result.state, 'ready');
  assert.equal(calls.some((call) => call.type === 'spawn' && call.args[1] === 'Pixel_B'), true);
});

test('recovers an offline emulator through ADB before spawning a duplicate AVD', async () => {
  const calls = [];
  let recovered = false;
  let spawned = false;
  const fakeExecFile = async (file, args) => {
    calls.push({ file, args });
    if (args[0] === '-list-avds') return { stdout: 'Pixel_7_API_35\n', stderr: '' };
    if (args[0] === 'start-server') return { stdout: '', stderr: '' };
    if (args[0] === 'reconnect' && args[1] === 'offline') { recovered = true; return { stdout: 'reconnecting Pixel\n', stderr: '' }; }
    if (args[0] === 'devices') return { stdout: recovered ? 'List of devices attached\nemulator-5554\tdevice\n' : 'List of devices attached\nemulator-5554\toffline\n', stderr: '' };
    if (args.includes('emu') && args.includes('avd') && args.includes('name')) return { stdout: 'Pixel_7_API_35\nOK\n', stderr: '' };
    if (args.includes('getprop')) return { stdout: '1\n', stderr: '' };
    if (args.includes('pm') && args.includes('path')) return { stdout: 'package:/data/app/com.android.chrome/base.apk\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const service = createAndroidService({
    env: { ANDROID_SDK_ROOT: 'C:\\Android\\Sdk' },
    existsSync: () => true,
    execFileAsync: fakeExecFile,
    spawn: () => { spawned = true; recovered = true; return { unref() {} }; },
    sleep: async () => undefined,
  });

  const result = await service.launchAvd('Pixel_7_API_35');

  assert.equal(result.serial, 'emulator-5554');
  assert.equal(result.alreadyRunning, true);
  assert.equal(spawned, false);
  assert.equal(calls.some((call) => call.args[0] === 'reconnect' && call.args[1] === 'offline'), true);
});

test('launches the Android emulator in the foreground process model used by a successful manual launch', async () => {
  const calls = [];
  let launched = false;
  const fakeExecFile = async (file, args) => {
    if (args[0] === '-list-avds') return { stdout: 'Pixel_7_API_35\n', stderr: '' };
    if (args[0] === 'devices') return { stdout: launched ? 'List of devices attached\nemulator-5554\tdevice\n' : 'List of devices attached\n', stderr: '' };
    if (args.includes('getprop')) return { stdout: '1\n', stderr: '' };
    if (args.includes('emu') && args.includes('avd') && args.includes('name')) return { stdout: 'Pixel_7_API_35\nOK\n', stderr: '' };
    if (args.includes('pm') && args.includes('path')) return { stdout: 'package:/data/app/com.android.chrome/base.apk\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const service = createAndroidService({
    env: { ANDROID_SDK_ROOT: 'C:\\Android\\Sdk' },
    existsSync: () => true,
    execFileAsync: fakeExecFile,
    spawn: (file, args, options) => {
      calls.push({ file, args, options });
      launched = true;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.unref = () => {};
      return child;
    },
    sleep: async () => undefined,
  });

  await service.launchAvd('Pixel_7_API_35');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.detached, false);
  assert.equal(calls[0].options.stdio, 'ignore');
  assert.equal(calls[0].options.windowsHide, false);
});

test('fails fast with emulator startup diagnostics when the emulator process exits before ADB sees it', async () => {
  const fakeExecFile = async (file, args) => {
    if (args[0] === '-list-avds') return { stdout: 'Pixel_7_API_35\n', stderr: '' };
    if (args[0] === 'devices') return { stdout: 'List of devices attached\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const service = createAndroidService({
    env: { ANDROID_SDK_ROOT: 'C:\\Android\\Sdk' },
    existsSync: () => true,
    execFileAsync: fakeExecFile,
    spawn: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.unref = () => {};
      setImmediate(() => {
        child.stderr.write('PANIC: broken AVD image');
        child.emit('exit', 1, null);
      });
      return child;
    },
    sleep: () => new Promise(() => {}),
  });

  await assert.rejects(
    service.launchAvd('Pixel_7_API_35'),
    /emulator process exited.*code 1/i,
  );
});

test('launches Android AVD with cold-start-safe arguments', async () => {
  const calls = [];
  let launched = false;
  const fakeExecFile = async (file, args) => {
    if (args[0] === '-list-avds') return { stdout: 'Pixel_9_API_36\n', stderr: '' };
    if (args[0] === 'devices') return { stdout: launched ? 'List of devices attached\nemulator-5554\tdevice\n' : 'List of devices attached\n', stderr: '' };
    if (args.includes('getprop')) return { stdout: '1\n', stderr: '' };
    if (args.includes('emu') && args.includes('avd') && args.includes('name')) return { stdout: 'Pixel_9_API_36\nOK\n', stderr: '' };
    if (args.includes('pm') && args.includes('path')) return { stdout: 'package:/data/app/com.android.chrome/base.apk\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const service = createAndroidService({
    env: { ANDROID_SDK_ROOT: 'C:\\Android\\Sdk' },
    existsSync: () => true,
    execFileAsync: fakeExecFile,
    spawn: (file, args, options) => { calls.push({ file, args, options }); launched = true; return { unref() {} }; },
    sleep: async () => undefined,
  });

  await service.launchAvd('Pixel_9_API_36');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.includes('-no-snapshot-load'), true);
  assert.equal(calls[0].args.includes('-no-boot-anim'), true);
});
