const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createProxyStore } = require('./proxy-store.cjs');

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8').replace(/^enc:/, ''),
  };
}

async function tempStore(safeStorage = fakeSafeStorage()) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbitqa-proxy-store-'));
  return { dir, store: createProxyStore({ userDataPath: dir, safeStorage }) };
}

const base = { kind: 'static', protocol: 'http', hostname: 'proxy.test', port: 8080, username: 'alice', password: 'secret' };

test('persists metadata without plaintext passwords', async () => {
  const { dir, store } = await tempStore();
  const result = await store.importMany([base]);
  const record = result.accepted[0];
  const rawMeta = await fs.readFile(path.join(dir, 'proxy-manager', 'proxies.json'), 'utf8');
  const rawSecrets = await fs.readFile(path.join(dir, 'proxy-manager', 'secrets.json'), 'utf8');
  assert.equal(rawMeta.includes('secret'), false);
  assert.equal(rawSecrets.includes('secret'), false);
  assert.equal((await store.list())[0].hasPassword, true);
  assert.equal((await store.getRuntimeProxy(record.id)).password, 'secret');
});

test('rejects non-empty password when safe storage is unavailable', async () => {
  const { store } = await tempStore(fakeSafeStorage(false));
  await assert.rejects(() => store.importMany([base]), /secure storage/i);
});

test('duplicate identity does not create another record and only replaces password explicitly', async () => {
  const { store } = await tempStore();
  const first = await store.importMany([base]);
  const id = first.accepted[0].id;
  const duplicate = await store.importMany([{ ...base, password: 'new-secret', sourceLine: 'duplicate' }]);
  assert.equal((await store.list()).length, 1);
  assert.equal(duplicate.duplicates[0].existingId, id);
  assert.equal(duplicate.duplicates[0].passwordChanged, false);
  assert.equal((await store.getRuntimeProxy(id)).password, 'secret');

  const replaced = await store.importMany([{ ...base, password: 'new-secret', sourceLine: 'duplicate' }], { replacePasswords: true });
  assert.equal(replaced.duplicates[0].passwordChanged, true);
  assert.equal((await store.getRuntimeProxy(id)).password, 'new-secret');
});

test('accepting a static IP promotes pending IP and clears the pause', async () => {
  const { store } = await tempStore();
  const { accepted } = await store.importMany([base]);
  const id = accepted[0].id;
  await store.saveHealth(id, { health: 'live', observedIp: '203.0.113.10', failureCount: 0, checkedAt: new Date(1000).toISOString(), nextCheckAt: new Date(2000).toISOString() });
  await store.saveHealth(id, { health: 'live', observedIp: '203.0.113.20', failureCount: 0, checkedAt: new Date(3000).toISOString(), nextCheckAt: new Date(4000).toISOString() });
  let record = await store.get(id);
  assert.equal(record.staticIpChangePending, true);
  assert.equal(record.pendingStaticIp, '203.0.113.20');
  await store.acceptStaticIp(id);
  record = await store.get(id);
  assert.equal(record.expectedStaticIp, '203.0.113.20');
  assert.equal(record.staticIpChangePending, false);
  assert.equal(record.pendingStaticIp, undefined);
});

test('removing records also removes encrypted secret entries', async () => {
  const { dir, store } = await tempStore();
  const { accepted } = await store.importMany([base]);
  await store.remove([accepted[0].id]);
  const secrets = JSON.parse(await fs.readFile(path.join(dir, 'proxy-manager', 'secrets.json'), 'utf8'));
  assert.equal(secrets[accepted[0].id], undefined);
  assert.equal((await store.list()).length, 0);
});

test('rejects invalid edited endpoints instead of persisting broken proxy records', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbitqa-proxy-store-'));
  try {
    const store = createProxyStore({ userDataPath: tempDir, safeStorage: fakeSafeStorage() });
    const result = await store.importMany([{ kind: 'rotating', protocol: 'http', hostname: 'proxy.test', port: 8080, username: '', password: '' }]);
    const id = result.accepted[0].id;
    await assert.rejects(() => store.update(id, { protocol: 'ftp' }), /protocol/i);
    await assert.rejects(() => store.update(id, { port: 70000 }), /port/i);
    await assert.rejects(() => store.update(id, { hostname: '' }), /host/i);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('rejects an edited endpoint that would duplicate another proxy identity', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orbitqa-proxy-store-'));
  try {
    const store = createProxyStore({ userDataPath: tempDir, safeStorage: fakeSafeStorage() });
    const result = await store.importMany([
      { kind: 'rotating', protocol: 'http', hostname: 'one.test', port: 8080, username: 'alice', password: '' },
      { kind: 'rotating', protocol: 'http', hostname: 'two.test', port: 8080, username: 'alice', password: '' },
    ]);
    await assert.rejects(
      () => store.update(result.accepted[1].id, { hostname: 'one.test' }),
      /duplicate/i,
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});


test('serializes concurrent health saves without sharing one temporary filename', async () => {
  const { dir, store } = await tempStore();
  const inputs = Array.from({ length: 24 }, (_, index) => ({
    kind: 'rotating', protocol: 'http', hostname: `proxy-${index}.test`, port: 8000 + index, username: '', password: '',
  }));
  const { accepted } = await store.importMany(inputs);
  await Promise.all(accepted.map((record, index) => store.saveHealth(record.id, {
    health: 'live', observedIp: `203.0.113.${index + 1}`, latencyMs: 100 + index,
    failureCount: 0, checkedAt: new Date(1000 + index).toISOString(), nextCheckAt: new Date(5000 + index).toISOString(),
  })));
  await store.close();
  const metadata = JSON.parse(await fs.readFile(path.join(dir, 'proxy-manager', 'proxies.json'), 'utf8'));
  const secrets = JSON.parse(await fs.readFile(path.join(dir, 'proxy-manager', 'secrets.json'), 'utf8'));
  assert.equal(metadata.length, 24);
  assert.equal(typeof secrets, 'object');
  assert.equal((await store.list()).filter((row) => row.health === 'live').length, 24);
});
