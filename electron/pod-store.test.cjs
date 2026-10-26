const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPodStore } = require('./pod-store.cjs');

function fixture() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-pod-store-')); return { dir, store: createPodStore({ userDataPath: dir }) }; }

test('pod store creates persistent pods and profiles and removes them together', () => {
  const { dir, store } = fixture();
  const result = store.createPod({ name: 'QA', deviceType: 'android', country: 'NG', count: 3 });
  assert.equal(result.ok, true); assert.equal(store.listPods().length, 1); assert.equal(store.listProfiles(result.pod.id).length, 3);
  assert.equal(store.getProfile(result.profiles[0].id).fingerprint.timezoneId, 'Africa/Lagos');
  const afterRestart = createPodStore({ userDataPath: dir });
  assert.deepEqual(afterRestart.listPods(), [result.pod]);
  assert.deepEqual(afterRestart.listProfiles(result.pod.id), result.profiles);
  assert.equal(afterRestart.deletePod(result.pod.id).ok, true); assert.equal(afterRestart.listProfiles().length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('pod store clamps count, enforces pod cap, recovers corrupt collections and creates unique ids', () => {
  const { dir, store } = fixture();
  const rows = [];
  for (let i = 0; i < 200; i += 1) rows.push(store.createPod({ count: i === 0 ? 500 : 5 }));
  assert.equal(rows[0].profiles.length, 100); assert.equal(store.createPod({}).error.code, 'POD_LIMIT');
  const profileIds = store.listProfiles().map((p) => p.id);
  assert.equal(profileIds.length, 1095); assert.equal(new Set(profileIds).size, 1095);
  fs.writeFileSync(path.join(dir, 'pods.json'), '{ truncated');
  assert.deepEqual(store.listPods(), []); assert.deepEqual(store.listProfiles(), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('topics deduplicate case-insensitively and assignments validate email', () => {
  const { dir, store } = fixture();
  const topic = store.addTopic('Finance'); store.addTopic('finance');
  assert.equal(store.listTopics().length, 1); assert.equal(store.listTopics()[0].id, topic.value.id);
  assert.equal(store.addAssignment({ email: 'invalid' }).ok, false);
  assert.equal(store.addAssignment({ email: 'qa@example.com', purpose: 'QA' }).value.email, 'qa@example.com');
  const afterRestart = createPodStore({ userDataPath: dir });
  assert.equal(afterRestart.listTopics()[0].id, topic.value.id);
  assert.equal(afterRestart.listAssignments()[0].email, 'qa@example.com');
  fs.rmSync(dir, { recursive: true, force: true });
});
