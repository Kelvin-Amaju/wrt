const test = require('node:test');
const assert = require('node:assert/strict');

const runtime = require('./android-runtime.cjs');
const devices = require('./android-devices.cjs');

const original = {
  listAttachedDevices: runtime.listAttachedDevices,
  maxDevices: runtime.maxDevices,
  emulatorPath: runtime.emulatorPath,
  adbPath: runtime.adbPath,
  avdManagerPath: runtime.avdManagerPath,
  detectSystemImage: runtime.detectSystemImage,
  ensureAdbServer: runtime.ensureAdbServer,
  listAvdNames: runtime.listAvdNames,
  execAdb: runtime.execAdb,
  execTool: runtime.execTool,
  prepareChrome: require('./android-url.cjs').prepareChrome,
};

const urlModule = require('./android-url.cjs');
const spawned = [];

function fakeSpawn() {
  spawned.push({ pid: 4242 + spawned.length });
  return { pid: 4242 + spawned.length, unref() {} };
}

test.beforeEach(() => {
  devices.reset();
  spawned.length = 0;
  runtime.maxDevices = () => 2;
  runtime.emulatorPath = () => 'emulator.exe';
  runtime.adbPath = () => 'adb.exe';
  runtime.avdManagerPath = () => 'avdmanager.bat';
  runtime.detectSystemImage = () => 'system-images;android-34;google_apis_playstore;x86_64';
  runtime.ensureAdbServer = async () => {};
  runtime.listAvdNames = async () => ['OrbitQA_Pixel_7_Real'];
  runtime.execAdb = async (serial, args) => {
    if (args[0] === 'shell' && args[1] === 'getprop') return '1\n';
    return '';
  };
  runtime.execTool = async () => ({ stdout: '', stderr: '' });
  urlModule.prepareChrome = async () => {};
  runtime.listAttachedDevices = async () => [];
});

test.after(() => {
  Object.assign(runtime, original);
  urlModule.prepareChrome = original.prepareChrome;
});

test('ports are unique and even', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = fakeSpawn;
  try {
    const first = await devices.create({});
    const second = await devices.create({});
    assert.equal(first.port % 2, 0);
    assert.equal(second.port % 2, 0);
    assert.notEqual(first.port, second.port);
    assert.equal(second.port - first.port, 2);
  } finally {
    childProcess.spawn = originalSpawn;
  }
});

test('attached emulator ports are skipped', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = fakeSpawn;
  runtime.listAttachedDevices = async () => [{ serial: 'emulator-5554', state: 'device' }];
  try {
    const created = await devices.create({});
    assert.equal(created.port, 5556);
  } finally {
    childProcess.spawn = originalSpawn;
  }
});

test('the limit is enforced', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = fakeSpawn;
  try {
    await devices.create({});
    await devices.create({});
    await assert.rejects(() => devices.create({}), /Device limit reached/);
  } finally {
    childProcess.spawn = originalSpawn;
  }
});

test('every adb call is serial targeted', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = fakeSpawn;
  const seen = [];
  runtime.execAdb = async (serial, args) => {
    seen.push([serial, args.join(' ')]);
    if (args[1] === 'getprop') return '1\n';
    return '';
  };
  try {
    const created = await devices.create({});
    assert.ok(seen.length > 0);
    for (const [serial] of seen) assert.equal(serial, created.serial);
  } finally {
    childProcess.spawn = originalSpawn;
  }
});

test('stop removes the entry and clears the map', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = fakeSpawn;
  try {
    const created = await devices.create({});
    assert.equal(devices.list().length, 1);
    await devices.stop(created.serial);
    assert.equal(devices.list().length, 0);
    assert.equal(devices.isRunning(created.serial), false);
  } finally {
    childProcess.spawn = originalSpawn;
  }
});

test('a boot timeout cleans up instead of leaking', async () => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = fakeSpawn;
  runtime.execAdb = async (serial, args) => {
    if (args[1] === 'getprop') return '0\n';
    return '';
  };
  const realSleep = runtime.sleep;
  try {
    const promise = devices.create({});
    await new Promise((resolve) => setTimeout(resolve, 50));
    await assert.rejects(() => promise, /never finished booting/);
    assert.equal(devices.list().length, 0);
  } finally {
    childProcess.spawn = originalSpawn;
    runtime.execAdb = original.execAdb;
    void realSleep;
  }
});

test('open requires a booted device', async () => {
  await assert.rejects(() => devices.open('emulator-5554', 'https://a.com'), /not running/);
});