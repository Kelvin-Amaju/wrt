const test = require('node:test');
const assert = require('node:assert/strict');

let mod;
try { mod = require('./run-lifecycle.cjs'); } catch {}

test('start waits for a stopping run to become idle instead of rejecting', async () => {
  assert.ok(mod?.createRunLifecycle, 'createRunLifecycle must exist');
  const lifecycle = mod.createRunLifecycle();
  const controller = new AbortController();
  lifecycle.begin({ runId:'run-1', controller });
  lifecycle.markStopping('run-1');

  let released = false;
  const waiter = lifecycle.waitForStartSlot().then(() => { released = true; });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(released, false);

  lifecycle.finish('run-1');
  await waiter;
  assert.equal(released, true);
  assert.deepEqual(lifecycle.getState(), { phase:'idle', runId:null });
});

test('finish is idempotent and only clears the matching active run', () => {
  assert.ok(mod?.createRunLifecycle, 'createRunLifecycle must exist');
  const lifecycle = mod.createRunLifecycle();
  lifecycle.begin({ runId:'run-1', controller:new AbortController() });
  lifecycle.finish('other-run');
  assert.deepEqual(lifecycle.getState(), { phase:'running', runId:'run-1' });
  lifecycle.finish('run-1');
  lifecycle.finish('run-1');
  assert.deepEqual(lifecycle.getState(), { phase:'idle', runId:null });
});
