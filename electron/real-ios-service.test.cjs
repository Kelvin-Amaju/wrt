const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRealIosService } = require('./real-ios-service.cjs');

function safeStorageAvailable() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`),
    decryptString: (buffer) => buffer.toString().replace(/^enc:/, ''),
  };
}

function saveRequest(overrides = {}) {
  return {
    providerName: 'Device Cloud',
    remoteUrl: 'https://hub.example.test/wd/hub',
    username: 'qa-user',
    accessKey: 'super-secret',
    defaultDevice: 'iPhone 15',
    defaultIosVersion: '17',
    defaultBrowser: 'safari',
    ...overrides,
  };
}

function createFakeProvider(overrides = {}) {
  const deletedSessionIds = [];
  return {
    deletedSessionIds,
    async testConnection() {
      return { reachable: true, authenticated: true, safariSupported: true, chromeSupported: false, message: 'ready' };
    },
    async createSession() { return { sessionId: 'remote-1', capabilities: { browserName: 'safari' } }; },
    async navigate() {},
    async executeScript() {
      return {
        userAgent: 'Real iPhone UA',
        platform: 'iPhone',
        maxTouchPoints: 5,
        viewport: { width: 390, height: 664 },
        screen: { width: 390, height: 844 },
        devicePixelRatio: 3,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        webRtcSupported: true,
        literalIpCandidates: ['192.168.1.2'],
      };
    },
    async click() {},
    async type() {},
    async scroll() {},
    async screenshot() { return Buffer.from('fake-png').toString('base64'); },
    async deleteSession(_config, sessionId) { deletedSessionIds.push(sessionId); },
    ...overrides,
  };
}

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'orbitqa-real-ios-'));
}

function runArgs(root, requestOverrides = {}) {
  return {
    runId: 'run-1',
    request: {
      targetUrl: 'https://example.com',
      sessions: 1,
      concurrency: 1,
      steps: [{ id: 'shot-1', type: 'screenshot', fullPage: true }],
      realIos: { device: 'iPhone 15', iosVersion: '17', browser: 'safari' },
      ...requestOverrides,
    },
    screenshotsRoot: path.join(root, 'runs'),
    emit: () => {},
  };
}

test('saves access key encrypted and never returns it publicly', async () => {
  const root = await tempDir();
  const service = createRealIosService({ userDataPath: root, safeStorage: safeStorageAvailable(), provider: createFakeProvider() });
  await service.saveConfig(saveRequest());
  const publicConfig = await service.getPublicConfig();
  assert.equal(publicConfig.credentialsSaved, true);
  assert.equal('accessKey' in publicConfig, false);
  const stored = JSON.parse(await fs.readFile(path.join(root, 'real-ios-provider.json'), 'utf8'));
  assert.notEqual(stored.accessKeyEncrypted, 'super-secret');
  assert.equal(JSON.stringify(stored).includes('super-secret'), false);
});

test('rejects insecure non-local provider endpoints before storage', async () => {
  const root = await tempDir();
  const service = createRealIosService({ userDataPath: root, safeStorage: safeStorageAvailable(), provider: createFakeProvider() });
  await assert.rejects(() => service.saveConfig(saveRequest({ remoteUrl: 'http://device-cloud.example/wd/hub' })), /valid HTTPS provider endpoint/);
});

test('rejects non-empty access key when secure storage is unavailable', async () => {
  const root = await tempDir();
  const service = createRealIosService({
    userDataPath: root,
    safeStorage: { isEncryptionAvailable: () => false },
    provider: createFakeProvider(),
  });
  await assert.rejects(() => service.saveConfig(saveRequest()), /Secure credential storage is unavailable/);
});

test('connection test returns provider browser capability status', async () => {
  const root = await tempDir();
  const service = createRealIosService({ userDataPath: root, safeStorage: safeStorageAvailable(), provider: createFakeProvider() });
  await service.saveConfig(saveRequest());
  const status = await service.testConnection();
  assert.deepEqual(status, {
    configured: true,
    reachable: true,
    authenticated: true,
    safariSupported: true,
    chromeSupported: false,
    message: 'ready',
  });
});

test('deletes remote session when a behavior step fails', async () => {
  const root = await tempDir();
  const provider = createFakeProvider({ async click() { throw new Error('element not found'); } });
  const service = createRealIosService({ userDataPath: root, safeStorage: safeStorageAvailable(), provider });
  await service.saveConfig(saveRequest());
  await assert.rejects(() => service.run(runArgs(root, { steps: [{ id: 'click-1', type: 'click', selector: '#missing' }] })), /element not found/);
  assert.equal(provider.deletedSessionIds.includes('remote-1'), true);
});

test('rejects Chrome run when provider does not support Chrome iOS', async () => {
  const root = await tempDir();
  const provider = createFakeProvider();
  const service = createRealIosService({ userDataPath: root, safeStorage: safeStorageAvailable(), provider });
  await service.saveConfig(saveRequest());
  await assert.rejects(() => service.run(runArgs(root, {
    realIos: { device: 'iPhone 15', iosVersion: '17', browser: 'chrome' },
  })), /Chrome iOS is not supported/);
  assert.deepEqual(provider.deletedSessionIds, []);
});

test('writes screenshot and preserves observed diagnostics values', async () => {
  const root = await tempDir();
  const provider = createFakeProvider();
  const service = createRealIosService({ userDataPath: root, safeStorage: safeStorageAvailable(), provider, now: () => 1000 });
  await service.saveConfig(saveRequest());
  const result = await service.run(runArgs(root));
  assert.equal(result.sessionId, 'remote-1');
  assert.deepEqual(result.diagnostics.observed.literalIpCandidates, ['192.168.1.2']);
  assert.match(result.screenshotPath, /run-1/);
  const screenshot = await fs.readFile(result.screenshotPath);
  assert.equal(screenshot.toString(), 'fake-png');
  assert.equal(provider.deletedSessionIds.includes('remote-1'), true);
});

test('logs cleanup warning while preserving primary run failure', async () => {
  const root = await tempDir();
  const events = [];
  const provider = createFakeProvider({
    async click() { throw new Error('primary failure'); },
    async deleteSession() { throw new Error('password=cleanup-secret'); },
  });
  const service = createRealIosService({ userDataPath: root, safeStorage: safeStorageAvailable(), provider });
  await service.saveConfig(saveRequest());
  const args = runArgs(root, { steps: [{ id: 'click-1', type: 'click', selector: '#x' }] });
  args.emit = (event) => events.push(event);
  await assert.rejects(() => service.run(args), /primary failure/);
  const warning = events.find((event) => /Cleanup warning/.test(event.message || ''));
  assert.ok(warning);
  assert.equal((warning.message || '').includes('cleanup-secret'), false);
});

test('does not emit run-complete when successful work is followed by cleanup failure', async () => {
  const root = await tempDir();
  const events = [];
  const provider = createFakeProvider({ async deleteSession() { throw new Error('cleanup failed'); } });
  const service = createRealIosService({ userDataPath: root, safeStorage: safeStorageAvailable(), provider });
  await service.saveConfig(saveRequest());
  const args = runArgs(root);
  args.emit = (event) => events.push(event);
  await assert.rejects(() => service.run(args), /cleanup failed/);
  assert.equal(events.some((event) => event.type === 'run-complete'), false);
  assert.equal(events.some((event) => /Cleanup warning/.test(event.message || '')), true);
});

test('redacts provider secrets from the propagated run error', async () => {
  const root = await tempDir();
  const provider = createFakeProvider({ async click() { throw new Error('accessKey=leaked-secret'); } });
  const service = createRealIosService({ userDataPath: root, safeStorage: safeStorageAvailable(), provider });
  await service.saveConfig(saveRequest());
  const args = runArgs(root, { steps: [{ id: 'click-1', type: 'click', selector: '#x' }] });
  await assert.rejects(
    () => service.run(args),
    (error) => {
      assert.equal(error.message.includes('leaked-secret'), false);
      assert.match(error.message, /REDACTED/);
      return true;
    },
  );
});

test('redacts provider secrets from a cleanup error propagated after successful work', async () => {
  const root = await tempDir();
  const provider = createFakeProvider({ async deleteSession() { throw new Error('token=cleanup-leak'); } });
  const service = createRealIosService({ userDataPath: root, safeStorage: safeStorageAvailable(), provider });
  await service.saveConfig(saveRequest());
  await assert.rejects(
    () => service.run(runArgs(root)),
    (error) => {
      assert.equal(error.message.includes('cleanup-leak'), false);
      assert.match(error.message, /REDACTED/);
      return true;
    },
  );
});

test('matrix work unit keeps its own deadline and deletes only its remote session when the timer elapses', async () => {
  const root = await tempDir();
  const provider = createFakeProvider();
  const waits = [];
  let clock = 1000;
  const service = createRealIosService({
    userDataPath: root,
    safeStorage: safeStorageAvailable(),
    provider,
    now: () => clock,
    sleep: async (ms) => { waits.push(ms); clock += ms; },
  });
  await service.saveConfig(saveRequest());
  const events = [];
  const result = await service.runWorkUnit({
    runId: 'matrix-ios',
    workUnit: {
      workId: 'save-ios-instance-1',
      targetUrl: 'https://savevidly.xyz',
      sessionDurationSeconds: 5,
      realIos: { device: 'iPhone 15', iosVersion: '17', browser: 'safari' },
    },
    steps: [],
    screenshotsRoot: path.join(root, 'runs'),
    push: (event) => events.push(event),
  });

  assert.equal(result.sessionId, 'remote-1');
  assert.equal(waits.length, 1);
  assert.equal(waits[0] <= 5000 && waits[0] >= 0, true);
  assert.deepEqual(provider.deletedSessionIds, ['remote-1']);
  assert.equal(events.some((event) => /timer/i.test(event.message || '')), true);
});

test('matrix Real iOS work unit STOP aborts its timer and deletes the remote session exactly once', async () => {
  const root = await tempDir();
  const provider = createFakeProvider();
  let releaseSleep;
  let sleepEnteredResolve;
  const sleepEntered = new Promise((resolve) => { sleepEnteredResolve = resolve; });
  const service = createRealIosService({
    userDataPath: root,
    safeStorage: safeStorageAvailable(),
    provider,
    sleep: () => new Promise((resolve) => { releaseSleep = resolve; sleepEnteredResolve?.(); }),
  });
  await service.saveConfig(saveRequest());
  const controller = new AbortController();
  const promise = service.runWorkUnit({
    runId: 'matrix-ios-stop',
    workUnit: {
      workId: 'save-ios-instance-1', targetUrl: 'https://savevidly.xyz', sessionDurationSeconds: 60,
      realIos: { device: 'iPhone 15', iosVersion: '17', browser: 'safari' },
    },
    steps: [], screenshotsRoot: path.join(root, 'runs'), push: () => {}, signal: controller.signal,
  });
  await sleepEntered;
  controller.abort();
  await assert.rejects(promise, (error) => error?.name === 'AbortError');
  releaseSleep?.();
  assert.deepEqual(provider.deletedSessionIds, ['remote-1']);
});
