const fs = require('node:fs');
const path = require('node:path');
const { createId } = require('./id.cjs');

const SCHEMA_VERSION = 1;
const COUNTRIES = ['US', 'GB', 'CA', 'AU', 'NG', 'IN'];
const DEVICES = ['desktop', 'android', 'ios'];
const LOCALES = { US: ['en-US', 'America/New_York'], GB: ['en-GB', 'Europe/London'], CA: ['en-CA', 'America/Toronto'], AU: ['en-AU', 'Australia/Sydney'], NG: ['en-NG', 'Africa/Lagos'], IN: ['en-IN', 'Asia/Kolkata'] };
const BROWSER_VERSIONS = { chromium: '131.0.0.0', brave: '131.0.0.0', firefox: '133.0', webkit: '18.2' };

function fingerprintFor(deviceType, country, index) {
  const [locale, timezoneId] = LOCALES[country] || LOCALES.US;
  const browserFamily = deviceType === 'ios' ? 'webkit' : 'chromium';
  const mobile = deviceType !== 'desktop';
  const width = deviceType === 'ios' ? 390 : deviceType === 'android' ? 412 : 1365;
  const height = deviceType === 'ios' ? 844 : deviceType === 'android' ? 915 : 768;
  const version = BROWSER_VERSIONS[browserFamily];
  const userAgent = deviceType === 'ios'
    ? `Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1`
    : deviceType === 'android'
      ? `Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Mobile Safari/537.36`
      : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36${browserFamily === 'brave' ? ' Brave/1.73.0' : ''}`;
  return { userAgent, platform: deviceType === 'ios' ? 'iPhone' : deviceType === 'android' ? 'Linux armv8l' : 'Win32', viewport: { width, height }, screen: { width, height, colorDepth: 24 }, deviceScaleFactor: deviceType === 'desktop' ? 1 : 3, maxTouchPoints: mobile ? 5 : 0, hardwareConcurrency: mobile ? 8 : 12, deviceMemory: mobile ? 8 : 16, locale, languages: [locale, locale.split('-')[0]], timezoneId, browserFamily };
}

function atomicWrite(file, value) {
  const temp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const fd = fs.openSync(temp, 'w');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}

function readCollection(file, key) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value?.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value[key])) throw new Error('unsupported or invalid schema');
    return value[key];
  } catch (error) {
    if (fs.existsSync(file)) console.error(`Could not read ${path.basename(file)}; starting with an empty collection: ${error.message}`);
    return [];
  }
}

function createPodStore({ userDataPath, now = () => new Date().toISOString(), makeId = createId, fingerprintFactory = fingerprintFor }) {
  if (!userDataPath) throw new Error('userDataPath is required');
  const podsFile = path.join(userDataPath, 'pods.json');
  const warmerFile = path.join(userDataPath, 'warmer.json');
  const readPods = () => readCollection(podsFile, 'pods');
  const readProfiles = () => readCollection(podsFile, 'profiles');
  const readWarmer = () => { try { const data = JSON.parse(fs.readFileSync(warmerFile, 'utf8')); if (data?.schemaVersion === SCHEMA_VERSION) return data; } catch (error) { if (fs.existsSync(warmerFile)) console.error(`Could not read warmer.json; starting empty: ${error.message}`); } return { schemaVersion: SCHEMA_VERSION, topics: [], assignments: [] }; };
  const writePods = (pods, profiles) => atomicWrite(podsFile, { schemaVersion: SCHEMA_VERSION, pods, profiles });
  const writeWarmer = (data) => atomicWrite(warmerFile, { ...data, schemaVersion: SCHEMA_VERSION });
  function createPod(input = {}) {
    const pods = readPods(); const profiles = readProfiles();
    if (pods.length >= 200) return { ok: false, error: { code: 'POD_LIMIT', message: 'A maximum of 200 pods is allowed.' } };
    const deviceType = DEVICES.includes(input.deviceType) ? input.deviceType : 'desktop';
    const country = COUNTRIES.includes(input.country) ? input.country : 'US';
    const count = Math.max(1, Math.min(100, Math.floor(Number(input.count) || 1)));
    const podId = makeId('pod'); const createdAt = now();
    const pod = { id: podId, name: String(input.name || '').trim().slice(0, 100) || `Pod ${pods.length + 1}`, deviceType, country, count, createdAt };
    const rows = Array.from({ length: count }, (_, i) => ({ id: makeId('profile'), podId, index: i + 1, deviceType, country, fingerprint: input.fingerprints?.[i] || fingerprintFactory(deviceType, country, i), proxyId: null, status: 'NEW', createdAt, lastWarmedAt: null, warmCount: 0 }));
    writePods([...pods, pod], [...profiles, ...rows]); return { ok: true, pod, profiles: rows };
  }
  function updateProfile(id, patch = {}) { const pods = readPods(); const profiles = readProfiles(); const ix = profiles.findIndex((x) => x.id === String(id)); if (ix < 0) return { ok: false, error: { code: 'PROFILE_NOT_FOUND', message: 'Pod profile was not found.' } }; profiles[ix] = { ...profiles[ix], ...patch, id: profiles[ix].id, podId: profiles[ix].podId }; writePods(pods, profiles); return { ok: true, profile: profiles[ix] }; }
  const getProfile = (id) => readProfiles().find((x) => x.id === String(id)) || null;
  function deleteProfile(id) { const pods = readPods(); const profiles = readProfiles(); const removed = profiles.find((x) => x.id === String(id)); const next = profiles.filter((x) => x.id !== String(id)); if (!removed) return { ok: false, error: { code: 'PROFILE_NOT_FOUND', message: 'Pod profile was not found.' } }; const nextPods = pods.map((pod) => pod.id === removed.podId ? { ...pod, count: next.filter((x) => x.podId === pod.id).length } : pod); writePods(nextPods, next); return { ok: true }; }
  function deletePod(id) { const pods = readPods(); const profiles = readProfiles(); const nextPods = pods.filter((x) => x.id !== String(id)); if (nextPods.length === pods.length) return { ok: false, error: { code: 'POD_NOT_FOUND', message: 'Pod was not found.' } }; writePods(nextPods, profiles.filter((x) => x.podId !== String(id))); return { ok: true }; }
  function changeWarmer(mutator) { const data = readWarmer(); const next = mutator(data); writeWarmer(next.data); return { ok: true, value: next.value }; }
  return {
    dir: userDataPath,
    listPods: () => readPods(), createPod, deletePod,
    getPod: (id) => readPods().find((x) => x.id === String(id)) || null,
    listProfiles: (podId) => readProfiles().filter((x) => !podId || x.podId === String(podId)),
    getProfile, updateProfile, deleteProfile,
    listTopics: () => readWarmer().topics,
    addTopic(label) { const clean = String(label || '').trim(); if (!clean) return { ok: false, error: { code: 'INVALID_TOPIC', message: 'Enter a topic.' } }; return changeWarmer((d) => { if (d.topics.some((x) => x.label.toLowerCase() === clean.toLowerCase())) return { data: d, value: d.topics.find((x) => x.label.toLowerCase() === clean.toLowerCase()) }; const topic = { id: makeId('topic'), label: clean.slice(0, 120), createdAt: now() }; d.topics.push(topic); return { data: d, value: topic }; }); },
    removeTopic(id) { return changeWarmer((d) => { d.topics = d.topics.filter((x) => x.id !== String(id)); return { data: d, value: true }; }); },
    listAssignments: () => readWarmer().assignments,
    addAssignment(input = {}) { const email = String(input.email || '').trim(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: { code: 'INVALID_EMAIL', message: 'Enter a valid email address.' } }; return changeWarmer((d) => { const assignment = { id: makeId('assignment'), email, purpose: String(input.purpose || '').trim().slice(0, 200), podId: input.podId || null, profileId: input.profileId || null, createdAt: now() }; d.assignments.push(assignment); return { data: d, value: assignment }; }); },
    removeAssignment(id) { return changeWarmer((d) => { d.assignments = d.assignments.filter((x) => x.id !== String(id)); return { data: d, value: true }; }); },
  };
}

module.exports = { createPodStore, fingerprintFor, SCHEMA_VERSION };
