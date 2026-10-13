const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRunStore } = require('./run-store.cjs');
const { createRunRegistry } = require('./run-registry.cjs');

test('legacy terminal event gate still buffers terminal events until explicit flush', () => {
  const { createRunEventGate } = require('./run-terminal-gate.cjs');
  const sent = [];
  const gate = createRunEventGate((payload) => sent.push(payload));
  gate.emit({ type:'log', message:'working' });
  gate.emit({ type:'run-cancelled', message:'stopped' });
  assert.deepEqual(sent.map((event) => event.type), ['log']);
  gate.flush();
  assert.deepEqual(sent.map((event) => event.type), ['log','run-cancelled']);
});

test('multi-run registry persists terminal run state before publishing terminal status', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'orbitqa-terminal-'));
  const store = createRunStore({ userDataPath: root });
  const seen = [];
  const registry = createRunRegistry({ runStore: store, executeRun: async () => {} });
  registry.subscribe((event) => {
    if (event.type === 'run-status' && event.runStatus === 'COMPLETED') {
      seen.push(store.get(event.runId)?.summary.status);
    }
  });
  const { runId } = await registry.createRun({ version:3, urlPool:['https://example.com'], devices:{desktop:{enabled:true,browsers:['chromium'],instancesPerBrowser:1}}, concurrency:{mode:'manual',value:1}, executionMode:'visible' });
  await new Promise((r)=>setTimeout(r,20));
  assert.equal(registry.getRun(runId).status,'COMPLETED');
  assert.deepEqual(seen,['COMPLETED']);
});
