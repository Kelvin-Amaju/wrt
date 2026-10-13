const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRunStore } = require('./run-store.cjs');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'orbitqa-run-store-')); }
function record(runId, status='PAUSED') {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    summary: { runId, createdAt: now, updatedAt: now, status, executionMode: 'visible', requestedConcurrency: 1, targetSummary: 'example.com', deviceFamilies: ['Desktop'], counters: { requested:1,running:0,queued:1,completed:0,failed:0,cancelled:0,incomplete:0 } },
    config: { version: 3 },
    checkpoint: { nextWorkOrdinal: 0, terminalWorkIds: [], inFlightWorkIds: [] },
    logs: [],
    results: {},
    lastCheckpointAt: now,
  };
}

test('run store atomically saves and loads multiple records', () => {
  const root = tempDir();
  const store = createRunStore({ userDataPath: root });
  store.save(record('RUN-A'));
  store.save(record('RUN-B', 'COMPLETED'));
  assert.equal(store.get('RUN-A').summary.status, 'PAUSED');
  assert.equal(store.list().length, 2);
  assert.equal(fs.existsSync(path.join(root, 'run-center', 'RUN-A.json.tmp')), false);
});

test('run store converts corrupt and incompatible records into recovery failures', () => {
  const root = tempDir();
  const dir = path.join(root, 'run-center'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'broken.json'), '{nope');
  fs.writeFileSync(path.join(dir, 'future.json'), JSON.stringify({ ...record('RUN-FUTURE'), schemaVersion: 99 }));
  const recovered = createRunStore({ userDataPath: root }).loadRecoverable();
  assert.equal(recovered.length, 2);
  recovered.forEach((r) => {
    assert.equal(r.summary.status, 'FAILED');
    assert.match(r.summary.resourceMessage, /recovery/i);
  });
});
