const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { proxyIdentity } = require('./proxy-parser.cjs');

function createProxyStore({ userDataPath, safeStorage, fsImpl = fs }) {
  const root = path.join(userDataPath, 'proxy-manager');
  const metadataFile = path.join(root, 'proxies.json');
  const secretsFile = path.join(root, 'secrets.json');
  let loaded = false;
  let records = [];
  let secrets = {};
  let persistTail = Promise.resolve();

  async function ensureLoaded() {
    if (loaded) return;
    await fsImpl.mkdir(root, { recursive: true });
    const [metadataRaw, secretsRaw] = await Promise.all([
      fsImpl.readFile(metadataFile, 'utf8').catch((error) => error.code === 'ENOENT' ? '[]' : Promise.reject(error)),
      fsImpl.readFile(secretsFile, 'utf8').catch((error) => error.code === 'ENOENT' ? '{}' : Promise.reject(error)),
    ]);
    try { records = JSON.parse(metadataRaw); } catch { records = []; }
    try { secrets = JSON.parse(secretsRaw); } catch { secrets = {}; }
    if (!Array.isArray(records)) records = [];
    if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets)) secrets = {};
    loaded = true;
  }

  async function wait(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function atomicWrite(file, serializedValue) {
    const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await fsImpl.writeFile(tmp, serializedValue, 'utf8');
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await fsImpl.rename(tmp, file);
        return;
      } catch (error) {
        lastError = error;
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(error?.code) || attempt === 4) break;
        await wait(20 * (attempt + 1));
      }
    }
    await fsImpl.unlink(tmp).catch(() => undefined);
    throw lastError;
  }

  function persist() {
    // Snapshot first, then serialize all disk commits. checkMany() can update many
    // records concurrently; sharing one proxies.json.tmp made those saves race.
    const metadataSnapshot = JSON.stringify(records, null, 2);
    const secretsSnapshot = JSON.stringify(secrets, null, 2);
    const commit = async () => {
      await fsImpl.mkdir(root, { recursive: true });
      await atomicWrite(metadataFile, metadataSnapshot);
      await atomicWrite(secretsFile, secretsSnapshot);
    };
    const current = persistTail.then(commit, commit);
    persistTail = current.catch(() => undefined);
    return current;
  }

  function decorate(record) {
    if (!record) return null;
    return { ...record, hasPassword: Boolean(secrets[record.id]) };
  }

  function encryptPassword(password) {
    if (!password) return null;
    if (!safeStorage?.isEncryptionAvailable?.()) {
      throw new Error('Secure storage is unavailable; OrbitQA cannot persist a proxy password');
    }
    return safeStorage.encryptString(String(password)).toString('base64');
  }

  function decryptPassword(id) {
    const encoded = secrets[id];
    if (!encoded) return '';
    if (!safeStorage?.isEncryptionAvailable?.()) {
      throw new Error('Secure storage is unavailable; OrbitQA cannot decrypt the proxy password');
    }
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  }

  function findByIdentity(candidate) {
    const identity = proxyIdentity(candidate);
    return records.find((record) => proxyIdentity(record) === identity);
  }

  async function list(kind) {
    await ensureLoaded();
    return records
      .filter((record) => !kind || record.kind === kind)
      .map(decorate);
  }

  async function get(id) {
    await ensureLoaded();
    return decorate(records.find((record) => record.id === id));
  }

  async function importMany(parsedRecords, { replacePasswords = false } = {}) {
    await ensureLoaded();
    const incoming = Array.isArray(parsedRecords) ? parsedRecords : [];
    if (incoming.some((record) => record.password) && !safeStorage?.isEncryptionAvailable?.()) {
      throw new Error('Secure storage is unavailable; OrbitQA cannot persist proxy passwords');
    }

    const accepted = [];
    const duplicates = [];
    const now = new Date().toISOString();

    for (const parsed of incoming) {
      const existing = findByIdentity(parsed);
      if (existing) {
        let passwordChanged = false;
        if (parsed.password && replacePasswords) {
          secrets[existing.id] = encryptPassword(parsed.password);
          existing.updatedAt = now;
          passwordChanged = true;
        }
        duplicates.push({
          line: parsed.sourceLine || `${parsed.hostname}:${parsed.port}`,
          existingId: existing.id,
          passwordChanged,
        });
        continue;
      }

      const record = {
        id: randomUUID(),
        kind: parsed.kind,
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        username: parsed.username || '',
        source: parsed.source || 'manual',
        provider: parsed.provider || undefined,
        enabled: true,
        health: 'pending',
        failureCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      records.push(record);
      if (parsed.password) secrets[record.id] = encryptPassword(parsed.password);
      accepted.push(decorate(record));
    }

    if (accepted.length || duplicates.some((item) => item.passwordChanged)) await persist();
    return { accepted, duplicates };
  }

  async function update(id, patch = {}) {
    await ensureLoaded();
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error('Proxy record not found');

    const endpointFields = ['kind', 'protocol', 'hostname', 'port', 'username'];
    const candidate = { ...record };
    for (const key of endpointFields) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) candidate[key] = patch[key];
    }

    candidate.kind = String(candidate.kind || '').trim();
    candidate.protocol = String(candidate.protocol || '').trim().toLowerCase();
    candidate.hostname = String(candidate.hostname || '').trim();
    candidate.port = Number(candidate.port);
    candidate.username = String(candidate.username || '');

    if (!['rotating', 'static'].includes(candidate.kind)) throw new Error('Proxy kind must be rotating or static');
    if (!['http', 'https', 'socks5'].includes(candidate.protocol)) throw new Error('Proxy protocol must be http, https, or socks5');
    if (!candidate.hostname || /[\s/@]/.test(candidate.hostname)) throw new Error('Proxy host is invalid');
    if (!Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 65535) throw new Error('Proxy port must be between 1 and 65535');

    const collision = records.find((item) => item.id !== id && proxyIdentity(item) === proxyIdentity(candidate));
    if (collision) throw new Error('Edited proxy would duplicate an existing proxy identity');

    let encryptedPassword;
    if (Object.prototype.hasOwnProperty.call(patch, 'password') && patch.password) {
      encryptedPassword = encryptPassword(patch.password);
    }

    const endpointChanged = endpointFields.some((key) => candidate[key] !== record[key]);
    for (const key of endpointFields) record[key] = candidate[key];
    if (Object.prototype.hasOwnProperty.call(patch, 'enabled')) record.enabled = patch.enabled === true;
    if (Object.prototype.hasOwnProperty.call(patch, 'password')) {
      if (patch.password) secrets[id] = encryptedPassword;
      else delete secrets[id];
    }
    if (endpointChanged) {
      record.health = 'pending';
      record.failureCount = 0;
      delete record.latencyMs;
      delete record.observedIp;
      delete record.countryCode;
      delete record.country;
      delete record.region;
      delete record.city;
      delete record.latitude;
      delete record.longitude;
      delete record.timezoneId;
      delete record.lastCheckedAt;
      delete record.nextCheckAt;
      delete record.expectedStaticIp;
      delete record.pendingStaticIp;
      delete record.staticIpChangePending;
    }
    record.updatedAt = new Date().toISOString();
    await persist();
    return decorate(record);
  }

  async function remove(ids) {
    await ensureLoaded();
    const idSet = new Set(Array.isArray(ids) ? ids : []);
    records = records.filter((record) => !idSet.has(record.id));
    for (const id of idSet) delete secrets[id];
    await persist();
  }

  async function setEnabled(ids, enabled) {
    await ensureLoaded();
    const idSet = new Set(Array.isArray(ids) ? ids : []);
    const now = new Date().toISOString();
    for (const record of records) {
      if (idSet.has(record.id)) {
        record.enabled = enabled === true;
        record.updatedAt = now;
      }
    }
    await persist();
    return list();
  }

  async function getRuntimeProxy(id) {
    await ensureLoaded();
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error('Proxy record not found');
    return { ...record, password: decryptPassword(id) };
  }

  async function acceptStaticIp(id) {
    await ensureLoaded();
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error('Proxy record not found');
    if (record.pendingStaticIp) record.expectedStaticIp = record.pendingStaticIp;
    delete record.pendingStaticIp;
    record.staticIpChangePending = false;
    record.updatedAt = new Date().toISOString();
    await persist();
    return decorate(record);
  }

  async function saveHealth(id, result = {}) {
    await ensureLoaded();
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error('Proxy record not found');
    for (const key of ['health', 'latencyMs', 'observedIp', 'countryCode', 'country', 'region', 'city', 'latitude', 'longitude', 'timezoneId', 'failureCount', 'nextCheckAt']) {
      if (Object.prototype.hasOwnProperty.call(result, key)) {
        if (result[key] === undefined) delete record[key];
        else record[key] = result[key];
      }
    }
    if (result.checkedAt) record.lastCheckedAt = result.checkedAt;
    if (record.kind === 'static' && result.observedIp) {
      if (!record.expectedStaticIp) {
        record.expectedStaticIp = result.observedIp;
        delete record.pendingStaticIp;
        record.staticIpChangePending = false;
      } else if (record.expectedStaticIp !== result.observedIp) {
        record.pendingStaticIp = result.observedIp;
        record.staticIpChangePending = true;
      } else {
        delete record.pendingStaticIp;
        record.staticIpChangePending = false;
      }
    }
    record.updatedAt = new Date().toISOString();
    await persist();
    return decorate(record);
  }

  async function markUsed(id, at = new Date().toISOString()) {
    await ensureLoaded();
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error('Proxy record not found');
    record.lastUsedAt = at;
    record.updatedAt = new Date().toISOString();
    await persist();
    return decorate(record);
  }

  async function close() {
    if (loaded) await persist();
    await persistTail;
  }

  return { list, get, importMany, update, remove, setEnabled, getRuntimeProxy, acceptStaticIp, saveHealth, markUsed, close };
}

module.exports = { createProxyStore };
