const test = require('node:test');
const assert = require('node:assert/strict');
const { createRunResourceTracker } = require('./run-resource-tracker.cjs');

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

test('forceCleanup closes every resource registered to only the requested run', async () => {
  const calls = [];
  const tracker = createRunResourceTracker({ cleanupTimeoutMs:25, forceTimeoutMs:25 });
  tracker.register('run-a', { label:'context-a', close:async()=>calls.push('context-a') });
  tracker.register('run-a', { label:'browser-a', close:async()=>calls.push('browser-a') });
  tracker.register('run-b', { label:'context-b', close:async()=>calls.push('context-b') });

  const result = await tracker.forceCleanup('run-a');
  assert.equal(result.requested, 2);
  assert.equal(result.closed, 2);
  assert.deepEqual(calls.sort(), ['browser-a','context-a']);
  assert.equal(tracker.count('run-a'), 0);
  assert.equal(tracker.count('run-b'), 1);
});

test('forceCleanup does not hang when graceful close never settles and uses forceClose fallback', async () => {
  const calls = [];
  const tracker = createRunResourceTracker({ cleanupTimeoutMs:15, forceTimeoutMs:20 });
  tracker.register('run-a', {
    label:'hung-browser',
    close:()=>new Promise(()=>{}),
    forceClose:async()=>calls.push('forced'),
  });

  const result = await Promise.race([
    tracker.forceCleanup('run-a'),
    wait(150).then(()=>({ timeout:true })),
  ]);
  assert.notEqual(result.timeout, true);
  assert.equal(result.forced, 1);
  assert.deepEqual(calls, ['forced']);
  assert.equal(tracker.count('run-a'), 0);
});

test('unregister removes a normally closed resource so later force cleanup does not touch it', async () => {
  let calls = 0;
  const tracker = createRunResourceTracker();
  const unregister = tracker.register('run-a', { label:'context', close:async()=>{ calls += 1; } });
  unregister();
  const result = await tracker.forceCleanup('run-a');
  assert.equal(result.requested, 0);
  assert.equal(calls, 0);
});
