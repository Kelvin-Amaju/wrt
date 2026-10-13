const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRunStore } = require('./run-store.cjs');
const { createRunRegistry } = require('./run-registry.cjs');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'orbitqa-run-registry-')); }
function wait(ms=10) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function config(label) {
  return { version: 3, urlPool: [`https://${label}.example`], devices: { desktop: { enabled: true, browsers:['chromium'], instancesPerBrowser:1 } }, concurrency: { mode:'manual', value:1 }, executionMode:'visible' };
}

test('registry allows concurrent runs and stopping A does not abort B', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const events = [];
  const executeRun = ({ runId, signal, emit }) => new Promise((resolve) => {
    emit({ type:'run-start', runId, timestamp:new Date().toISOString(), metrics:{requested:1,running:1,queued:0,completed:0,failed:0,cancelled:0,incomplete:0} });
    signal.addEventListener('abort', () => resolve(), { once:true });
  });
  const registry = createRunRegistry({ runStore: store, executeRun });
  registry.subscribe((event) => events.push(event));
  const a = await registry.createRun(config('a'));
  const b = await registry.createRun(config('b'));
  await wait();
  assert.notEqual(a.runId, b.runId);
  assert.equal(registry.listRuns().filter((r) => r.status === 'RUNNING').length, 2);
  await registry.stopRun(a.runId);
  assert.equal(registry.getRun(a.runId).status, 'STOPPED');
  assert.equal(registry.getRun(b.runId).status, 'RUNNING');
  assert.ok(events.length > 0);
  assert.ok(events.every((event) => event.runId));
  await registry.stopRun(b.runId);
});

test('registry keeps events and counters scoped to their owning run', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const executeRun = async ({ runId, emit }) => {
    emit({ type:'run-metrics', runId, timestamp:new Date().toISOString(), metrics:{requested:2,running:0,queued:0,completed:2,failed:0,cancelled:0,incomplete:0} });
    emit({ type:'run-complete', runId, timestamp:new Date().toISOString(), summary:{total:2,completed:2,failed:0,durationMs:1} });
  };
  const registry = createRunRegistry({ runStore: store, executeRun });
  const a = await registry.createRun(config('a'));
  const b = await registry.createRun(config('b'));
  await wait(30);
  assert.equal(registry.getRun(a.runId).counters.completed, 2);
  assert.equal(registry.getRun(b.runId).counters.completed, 2);
  assert.ok(registry.getRun(a.runId).logs.every((e) => e.runId === a.runId));
  assert.ok(registry.getRun(b.runId).logs.every((e) => e.runId === b.runId));
});

test('terminal run reruns in place so history does not duplicate and attempt count increments', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  let hold = false;
  const executeRun = ({ runId, emit, signal }) => {
    emit({ type:'run-metrics', runId, timestamp:new Date().toISOString(), metrics:{requested:1,running:hold ? 1 : 0,queued:0,completed:hold ? 0 : 1,failed:0,cancelled:0,incomplete:0} });
    if (hold) return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
    return Promise.resolve();
  };
  const registry = createRunRegistry({ runStore: store, executeRun });
  const original = await registry.createRun(config('rerun-me'));
  await wait(30);
  const before = registry.getRun(original.runId);
  assert.equal(before.status, 'COMPLETED');
  assert.equal(before.attemptCount, 1);

  hold = true;
  const rerun = await registry.rerunRun(original.runId);
  assert.equal(rerun.runId, original.runId);
  assert.equal(rerun.rerun, true);
  await wait(20);

  const rows = registry.listRuns();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].runId, original.runId);
  assert.equal(rows[0].attemptCount, 2);
  assert.ok(['STARTING','RUNNING'].includes(rows[0].status));
  assert.deepEqual(registry.getRun(original.runId).config, before.config);
  await registry.stopRun(original.runId);
});

test('deleting a terminal run removes it from memory and persistent storage', async () => {
  const dir = tempDir();
  const store = createRunStore({ userDataPath: dir });
  const executeRun = async () => {};
  const registry = createRunRegistry({ runStore: store, executeRun });
  const run = await registry.createRun(config('delete-me'));
  await wait(30);
  assert.equal(registry.getRun(run.runId).status, 'COMPLETED');
  const result = await registry.deleteRun(run.runId);
  assert.deepEqual(result, { runId: run.runId, deleted: true });
  assert.equal(registry.getRun(run.runId), null);
  assert.equal(store.get(run.runId), null);
});

test('deleting an active run is refused and leaves the run intact', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const executeRun = ({ signal }) => new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
  const registry = createRunRegistry({ runStore: store, executeRun });
  const run = await registry.createRun(config('active-delete'));
  await wait(20);
  const result = await registry.deleteRun(run.runId);
  assert.equal(result.deleted, false);
  assert.equal(result.reason, 'run-is-active');
  assert.ok(registry.getRun(run.runId));
  await registry.stopRun(run.runId);
});

test('registry persists Smart Mix proxy selection counts independently of compacted logs', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const executeRun = async ({ runId, emit }) => {
    emit({ type:'proxy-selection', runId, timestamp:new Date().toISOString(), selectedProxyKind:'rotating', message:'Smart Mix selected Rotating Pool' });
    emit({ type:'proxy-selection', runId, timestamp:new Date().toISOString(), selectedProxyKind:'static', message:'Smart Mix selected Static Pool' });
    emit({ type:'proxy-selection', runId, timestamp:new Date().toISOString(), selectedProxyKind:'rotating', message:'Smart Mix selected Rotating Pool' });
  };
  const registry = createRunRegistry({ runStore: store, executeRun });
  const run = await registry.createRun(config('proxy-mix'));
  await wait(30);
  const detail = registry.getRun(run.runId);
  assert.equal(detail.status, 'COMPLETED');
  assert.deepEqual(detail.proxyMix, { rotating:2, static:1, total:3 });
});

test('automatic rerun only starts explicitly selected completed runs and keeps one logical card per task', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  let hold = false;
  const executeRun = ({ signal }) => {
    if (!hold) return Promise.resolve();
    return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
  };
  const registry = createRunRegistry({ runStore: store, executeRun });
  const a = await registry.createRun(config('auto-a'));
  const b = await registry.createRun(config('auto-b'));
  const c = await registry.createRun(config('auto-c'));
  await wait(40);
  assert.equal(registry.listRuns().filter((run) => run.status === 'COMPLETED').length, 3);

  hold = true;
  const state = registry.configureAutoRerun({ enabled:true, mode:'completed-only', maxConcurrent:2, selectedRunIds:[a.runId, c.runId] });
  assert.equal(state.enabled, true);
  assert.equal(state.mode, 'completed-only');
  assert.equal(state.maxConcurrent, 2);
  assert.deepEqual(new Set(state.selectedRunIds), new Set([a.runId, c.runId]));
  await wait(50);

  const rows = registry.listRuns();
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((run) => ['STARTING','RUNNING'].includes(run.status)).length, 2);
  assert.equal(registry.getRun(a.runId).attemptCount, 2);
  assert.equal(registry.getRun(c.runId).attemptCount, 2);
  assert.equal(registry.getRun(b.runId).attemptCount, 1);
  assert.equal(registry.getRun(b.runId).status, 'COMPLETED');
  assert.equal(registry.getAutoRerunState().running, 2);
  assert.equal(registry.getAutoRerunState().queued, 0);

  const disabled = registry.configureAutoRerun({ enabled:false });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.queued, 0);
  assert.equal(disabled.running, 2);
  assert.deepEqual(new Set(disabled.selectedRunIds), new Set([a.runId, c.runId]));
  await registry.stopAllRuns();
});

test('automatic rerun all-finished reruns only selected completed failed and stopped tasks in place', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  let phase = 'seed';
  const executeRun = ({ request, signal }) => {
    const label = new URL(request.urlPool[0]).hostname.split('.')[0];
    if (phase === 'hold') return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
    if (label === 'failed-seed') throw new Error('seed failure');
    if (label === 'stopped-seed') return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
    return Promise.resolve();
  };
  const registry = createRunRegistry({ runStore: store, executeRun });
  const completed = await registry.createRun(config('completed-seed'));
  const failed = await registry.createRun(config('failed-seed'));
  const stopped = await registry.createRun(config('stopped-seed'));
  const unselected = await registry.createRun(config('unselected-seed'));
  await wait(30);
  await registry.stopRun(stopped.runId);
  await wait(20);

  phase = 'hold';
  registry.configureAutoRerun({ enabled:true, mode:'all-finished', maxConcurrent:3, selectedRunIds:[completed.runId, failed.runId, stopped.runId] });
  await wait(50);
  const rows = registry.listRuns();
  assert.equal(rows.length, 4);
  assert.ok(['STARTING','RUNNING'].includes(registry.getRun(completed.runId).status));
  assert.ok(['STARTING','RUNNING'].includes(registry.getRun(failed.runId).status));
  assert.ok(['STARTING','RUNNING'].includes(registry.getRun(stopped.runId).status));
  assert.equal(registry.getRun(unselected.runId).status, 'COMPLETED');
  assert.equal(registry.getRun(completed.runId).attemptCount, 2);
  assert.equal(registry.getRun(failed.runId).attemptCount, 2);
  assert.equal(registry.getRun(stopped.runId).attemptCount, 2);
  registry.configureAutoRerun({ enabled:false });
  await registry.stopAllRuns();
});

test('removing an active task from automatic rerun selection prevents another cycle after it finishes', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  let releaseAttempt;
  let calls = 0;
  const executeRun = ({ signal }) => {
    calls += 1;
    if (calls === 1) return Promise.resolve();
    return new Promise((resolve) => {
      releaseAttempt = resolve;
      signal.addEventListener('abort', resolve, { once:true });
    });
  };
  const registry = createRunRegistry({ runStore: store, executeRun });
  const run = await registry.createRun(config('unselect-active'));
  await wait(30);
  registry.configureAutoRerun({ enabled:true, mode:'completed-only', selectedRunIds:[run.runId] });
  await wait(30);
  assert.equal(registry.getRun(run.runId).attemptCount, 2);
  assert.ok(['STARTING','RUNNING'].includes(registry.getRun(run.runId).status));

  registry.configureAutoRerun({ selectedRunIds:[] });
  releaseAttempt();
  await wait(40);
  assert.equal(registry.getRun(run.runId).status, 'COMPLETED');
  assert.equal(registry.getRun(run.runId).attemptCount, 2);
  assert.deepEqual(registry.getAutoRerunState().selectedRunIds, []);
  assert.equal(registry.getAutoRerunState().queued, 0);
});

test('bulk deletion targets completed failed stopped or all finished history without deleting active runs', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  let holdActive = true;
  const executeRun = ({ request, signal }) => {
    const label = new URL(request.urlPool[0]).hostname.split('.')[0];
    if (label.startsWith('active') && holdActive) return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
    if (label.startsWith('failed')) throw new Error('expected failure');
    if (label.startsWith('stopped')) return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
    return Promise.resolve();
  };
  const registry = createRunRegistry({ runStore: store, executeRun });
  const completed = await registry.createRun(config('completed-one'));
  const failed = await registry.createRun(config('failed-one'));
  const stopped = await registry.createRun(config('stopped-one'));
  const active = await registry.createRun(config('active-one'));
  await wait(30);
  await registry.stopRun(stopped.runId);
  await wait(20);

  let result = await registry.bulkDeleteRuns('completed');
  assert.equal(result.deleted, 1);
  assert.equal(registry.getRun(completed.runId), null);
  assert.ok(registry.getRun(failed.runId));
  assert.ok(registry.getRun(stopped.runId));
  assert.ok(registry.getRun(active.runId));

  result = await registry.bulkDeleteRuns('failed');
  assert.equal(result.deleted, 1);
  assert.equal(registry.getRun(failed.runId), null);
  result = await registry.bulkDeleteRuns('stopped');
  assert.equal(result.deleted, 1);
  assert.equal(registry.getRun(stopped.runId), null);
  assert.equal(registry.getRun(active.runId).status, 'RUNNING');

  holdActive = false;
  await registry.stopRun(active.runId);
});

test('bulk delete everything removes all terminal history but preserves active execution', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const executeRun = ({ request, signal }) => {
    const label = new URL(request.urlPool[0]).hostname.split('.')[0];
    if (label === 'active-all') return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
    if (label === 'failed-all') throw new Error('expected failure');
    return Promise.resolve();
  };
  const registry = createRunRegistry({ runStore: store, executeRun });
  await registry.createRun(config('completed-all'));
  await registry.createRun(config('failed-all'));
  const active = await registry.createRun(config('active-all'));
  await wait(40);
  const result = await registry.bulkDeleteRuns('all-finished');
  assert.equal(result.deleted, 2);
  assert.equal(registry.listRuns().length, 1);
  assert.equal(registry.getRun(active.runId).status, 'RUNNING');
  await registry.stopRun(active.runId);
});

function fakeStuckRecoveryClock(startMs = 1_000_000) {
  let current = startMs;
  let intervalCallback = null;
  return {
    nowMs: () => current,
    setInterval: (callback) => {
      intervalCallback = callback;
      return { unref() {} };
    },
    clearInterval: () => { intervalCallback = null; },
    advance: (ms) => { current += ms; },
    tick: async () => { if (intervalCallback) await intervalCallback(); },
  };
}

function progressMetrics(percent) {
  return { requested:100, running:percent < 100 ? 1 : 0, queued:0, completed:percent, failed:0, cancelled:0, incomplete:0 };
}

test('stuck-run recovery reruns an unchanged 90-99 percent QA task in the same logical card', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const clock = fakeStuckRecoveryClock();
  let calls = 0;
  const executeRun = ({ runId, emit, signal }) => {
    calls += 1;
    emit({ type:'run-metrics', runId, metrics:progressMetrics(95) });
    return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
  };
  const registry = createRunRegistry({ runStore:store, executeRun, stuckRecoveryClock:clock });
  const run = await registry.createRun(config('stuck-recover'));
  await wait(20);
  const state = registry.configureStuckRunRecovery({ enabled:true, timeoutMinutes:1, maxAttempts:3 });
  assert.equal(state.enabled, true);
  assert.equal(state.timeoutMinutes, 1);
  assert.equal(state.maxAttempts, 3);

  clock.advance(60_001);
  const result = await registry.checkStuckRunsNow();
  await wait(20);

  assert.equal(result.recovered, 1);
  assert.equal(registry.listRuns().length, 1);
  assert.equal(registry.getRun(run.runId).attemptCount, 2);
  assert.ok(['STARTING','RUNNING'].includes(registry.getRun(run.runId).status));
  assert.equal(calls, 2);
  assert.ok(registry.getRun(run.runId).logs.some((event) => event.type === 'stuck-run-recovery-started'));
  await registry.stopRun(run.runId);
});

test('stuck-run recovery timer resets whenever progress changes inside 90-99 percent', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const clock = fakeStuckRecoveryClock();
  let currentEmit = null;
  const executeRun = ({ runId, emit, signal }) => {
    currentEmit = emit;
    emit({ type:'run-metrics', runId, metrics:progressMetrics(90) });
    return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
  };
  const registry = createRunRegistry({ runStore:store, executeRun, stuckRecoveryClock:clock });
  const run = await registry.createRun(config('progress-reset'));
  await wait(20);
  registry.configureStuckRunRecovery({ enabled:true, timeoutMinutes:1, maxAttempts:3 });

  clock.advance(59_000);
  currentEmit({ type:'run-metrics', runId:run.runId, metrics:progressMetrics(91) });
  clock.advance(59_000);
  let result = await registry.checkStuckRunsNow();
  assert.equal(result.recovered, 0);
  assert.equal(registry.getRun(run.runId).attemptCount, 1);

  clock.advance(1_001);
  result = await registry.checkStuckRunsNow();
  await wait(20);
  assert.equal(result.recovered, 1);
  assert.equal(registry.getRun(run.runId).attemptCount, 2);
  await registry.stopRun(run.runId);
});

test('stuck-run recovery ignores persistent Streaming QA runs', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const clock = fakeStuckRecoveryClock();
  const executeRun = async () => {};
  const executeStreamingRun = ({ runId, emit, signal }) => {
    emit({ type:'run-metrics', runId, metrics:progressMetrics(99) });
    return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
  };
  const registry = createRunRegistry({ runStore:store, executeRun, executeStreamingRun, stuckRecoveryClock:clock });
  const run = await registry.createRun({ runKind:'streaming', platform:'spotify', accountIds:['a'], trackIds:['t'], slots:1, executionMode:'visible' });
  await wait(20);
  registry.configureStuckRunRecovery({ enabled:true, timeoutMinutes:1, maxAttempts:3 });
  clock.advance(120_000);
  const result = await registry.checkStuckRunsNow();
  assert.equal(result.recovered, 0);
  assert.equal(registry.getRun(run.runId).attemptCount, 1);
  assert.equal(registry.getRun(run.runId).status, 'RUNNING');
  await registry.stopRun(run.runId);
});

test('stuck-run recovery stops retrying after the configured recovery attempts and marks the task failed', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const clock = fakeStuckRecoveryClock();
  const executeRun = ({ runId, emit, signal }) => {
    emit({ type:'run-metrics', runId, metrics:progressMetrics(99) });
    return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
  };
  const registry = createRunRegistry({ runStore:store, executeRun, stuckRecoveryClock:clock });
  const run = await registry.createRun(config('recovery-limit'));
  await wait(20);
  registry.configureStuckRunRecovery({ enabled:true, timeoutMinutes:1, maxAttempts:1 });

  clock.advance(60_001);
  let result = await registry.checkStuckRunsNow();
  await wait(20);
  assert.equal(result.recovered, 1);
  assert.equal(registry.getRun(run.runId).attemptCount, 2);

  clock.advance(60_001);
  result = await registry.checkStuckRunsNow();
  await wait(20);
  const detail = registry.getRun(run.runId);
  assert.equal(result.exhausted, 1);
  assert.equal(detail.status, 'FAILED');
  assert.equal(detail.attemptCount, 2);
  assert.equal(detail.stuckRecoveryExhausted, true);
  assert.match(detail.resourceMessage, /recovery limit/i);
});

test('stuck recovery exhaustion clears automatic-rerun active bookkeeping instead of leaving a ghost running slot', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const clock = fakeStuckRecoveryClock();
  let phase = 'seed';
  const executeRun = ({ runId, emit, signal }) => {
    if (phase === 'seed') return Promise.resolve();
    emit({ type:'run-metrics', runId, metrics:progressMetrics(99) });
    return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
  };
  const registry = createRunRegistry({ runStore:store, executeRun, stuckRecoveryClock:clock });
  const run = await registry.createRun(config('auto-recovery-exhaustion'));
  await wait(30);
  phase = 'stuck';
  registry.configureStuckRunRecovery({ enabled:true, timeoutMinutes:1, maxAttempts:1 });
  registry.configureAutoRerun({ enabled:true, mode:'all-finished', maxConcurrent:1, selectedRunIds:[run.runId] });
  await wait(30);
  assert.equal(registry.getAutoRerunState().running, 1);

  clock.advance(60_001);
  await registry.checkStuckRunsNow();
  await wait(20);
  assert.equal(registry.getRun(run.runId).attemptCount, 3);

  clock.advance(60_001);
  await registry.checkStuckRunsNow();
  await wait(20);
  assert.equal(registry.getRun(run.runId).status, 'FAILED');
  assert.equal(registry.getAutoRerunState().running, 0);
  assert.equal(registry.getAutoRerunState().queued, 0);
});

test('a recovered attempt that finishes immediately clears consecutive stuck bookkeeping normally', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const clock = fakeStuckRecoveryClock();
  let calls = 0;
  const executeRun = ({ runId, emit, signal }) => {
    calls += 1;
    if (calls === 1) {
      emit({ type:'run-metrics', runId, metrics:progressMetrics(95) });
      return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
    }
    emit({ type:'run-metrics', runId, metrics:progressMetrics(100) });
    return Promise.resolve();
  };
  const registry = createRunRegistry({ runStore:store, executeRun, stuckRecoveryClock:clock });
  const run = await registry.createRun(config('fast-recovered-completion'));
  await wait(20);
  registry.configureStuckRunRecovery({ enabled:true, timeoutMinutes:1, maxAttempts:3 });
  clock.advance(60_001);
  await registry.checkStuckRunsNow();
  await wait(30);
  const detail = registry.getRun(run.runId);
  assert.equal(detail.status, 'COMPLETED');
  assert.equal(detail.attemptCount, 2);
  assert.equal(detail.stuckRecoveryAttempts, 0);
  assert.equal(detail.stuckRecoveryExhausted, undefined);
});

test('stopRun force-detaches a hung runtime after the hard stop deadline and invokes resource cleanup', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const cleanupCalls = [];
  const executeRun = ({ runId, emit }) => {
    emit({ type:'run-metrics', runId, metrics:progressMetrics(99) });
    return new Promise(() => {});
  };
  const registry = createRunRegistry({
    runStore:store,
    executeRun,
    forceStopAfterMs:20,
    dependencies:{
      forceStopRunResources:async(runId) => { cleanupCalls.push(runId); return { closed:1, timedOut:0 }; },
    },
  });
  const run = await registry.createRun(config('hard-stop-timeout'));
  await wait(20);

  const result = await Promise.race([
    registry.stopRun(run.runId),
    wait(200).then(() => ({ timeout:true })),
  ]);

  assert.notEqual(result.timeout, true, 'stopRun must not wait forever for runtime.done');
  assert.equal(result.forced, true);
  assert.equal(registry.getRun(run.runId).status, 'STOPPED');
  assert.equal(registry.getRun(run.runId).counters.running, 0);
  assert.equal(registry.getRun(run.runId).counters.queued, 0);
  assert.deepEqual(cleanupCalls, [run.runId]);
});

test('stuck-run recovery force-stops a runtime whose abort never settles and immediately starts the next attempt', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const clock = fakeStuckRecoveryClock();
  const cleanupCalls = [];
  let calls = 0;
  const executeRun = ({ runId, emit, signal }) => {
    calls += 1;
    if (calls === 1) {
      emit({ type:'run-metrics', runId, metrics:progressMetrics(99) });
      signal.addEventListener('abort', () => {}, { once:true });
      return new Promise(() => {});
    }
    emit({ type:'run-metrics', runId, metrics:progressMetrics(10) });
    return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
  };
  const registry = createRunRegistry({
    runStore:store,
    executeRun,
    stuckRecoveryClock:clock,
    forceStopAfterMs:20,
    dependencies:{ forceStopRunResources:async(runId) => { cleanupCalls.push(runId); return { closed:1, timedOut:0 }; } },
  });
  const run = await registry.createRun(config('hung-stuck-recovery'));
  await wait(20);
  registry.configureStuckRunRecovery({ enabled:true, timeoutMinutes:1, maxAttempts:3 });
  clock.advance(60_001);

  const result = await Promise.race([
    registry.checkStuckRunsNow(),
    wait(300).then(() => ({ timeout:true })),
  ]);
  await wait(30);

  assert.notEqual(result.timeout, true, 'stuck recovery must not hang in STOPPING');
  assert.equal(result.recovered, 1);
  assert.equal(registry.getRun(run.runId).attemptCount, 2);
  assert.ok(['STARTING','RUNNING'].includes(registry.getRun(run.runId).status));
  assert.equal(calls, 2);
  assert.deepEqual(cleanupCalls, [run.runId]);
  const recoveryEvent = registry.getRun(run.runId).logs.find((event) => event.type === 'stuck-run-recovery-started');
  assert.ok(recoveryEvent);
  assert.match(recoveryEvent.message, /hard stop used/i);
  await registry.stopRun(run.runId);
});

test('late events from a force-detached old attempt cannot overwrite the restarted logical run', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  let oldEmit = null;
  let calls = 0;
  const executeRun = ({ runId, emit, signal }) => {
    calls += 1;
    if (calls === 1) {
      oldEmit = emit;
      emit({ type:'run-metrics', runId, metrics:progressMetrics(99) });
      return new Promise(() => {});
    }
    emit({ type:'run-metrics', runId, metrics:{ requested:100, running:1, queued:89, completed:10, failed:0, cancelled:0, incomplete:0 } });
    return new Promise((resolve) => signal.addEventListener('abort', resolve, { once:true }));
  };
  const registry = createRunRegistry({
    runStore:store,
    executeRun,
    forceStopAfterMs:20,
    dependencies:{ forceStopRunResources:async() => ({ closed:1, timedOut:0 }) },
  });
  const run = await registry.createRun(config('stale-runtime-guard'));
  await wait(20);
  const stop = await registry.stopRun(run.runId);
  assert.equal(stop.forced, true);
  const rerun = await registry.rerunRun(run.runId);
  assert.equal(rerun.rerun, true);
  await wait(20);

  oldEmit({ type:'run-metrics', runId:run.runId, metrics:progressMetrics(100) });
  oldEmit({ type:'run-complete', runId:run.runId, summary:{ total:100, completed:100, failed:0, durationMs:1 } });
  await wait(20);

  const detail = registry.getRun(run.runId);
  assert.equal(detail.attemptCount, 2);
  assert.equal(detail.status, 'RUNNING');
  assert.equal(detail.counters.completed, 10);
  await registry.stopRun(run.runId);
});

test('Run Again preserves the selected browser runtime configuration unchanged', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const executeRun = async () => {};
  const registry = createRunRegistry({ runStore: store, executeRun });
  const cfg = config('chrome-runtime');
  cfg.devices.desktop.browsers = ['chrome-installed'];
  cfg.devices.androidEmulation = { enabled:true, browserRuntime:'chrome-installed', profiles:['Pixel 7'], instancesPerProfile:1 };
  const run = await registry.createRun(cfg);
  await wait(30);
  assert.equal(registry.getRun(run.runId).status, 'COMPLETED');
  await registry.rerunRun(run.runId);
  await wait(20);
  const detail = registry.getRun(run.runId);
  assert.deepEqual(detail.config.devices.desktop.browsers, ['chrome-installed']);
  assert.equal(detail.config.devices.androidEmulation.browserRuntime, 'chrome-installed');
});

test('registry stores runtime verification by work unit for truthful Run Detail', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const runtimeVerification = {
    runtimeKind:'chrome-installed',
    browserFamily:'Google Chrome',
    verificationStatus:'verified',
    verificationLabel:'REAL INSTALLED GOOGLE CHROME',
    executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    deviceMode:'desktop',
    isRealChrome:true,
    isPhysicalDevice:false,
  };
  const executeRun = async ({ emit }) => {
    emit({ type:'runtime-verification', workId:'work-1', runtimeVerification });
  };
  const registry = createRunRegistry({ runStore: store, executeRun });
  const run = await registry.createRun(config('runtime-proof'));
  await wait(30);
  const detail = registry.getRun(run.runId);
  assert.deepEqual(detail.runtimeVerifications['work-1'], runtimeVerification);
});

test('registry stores only the latest privacy route integrity report by work unit', async () => {
  const store = createRunStore({ userDataPath: tempDir() });
  const baseReport = {
    strictMode:true,
    proxyRequired:true,
    checks:[],
    runtimeLabel:'Google Chrome',
    observedAt:'2026-09-19T12:00:00Z',
    phase:'post-behavior',
  };
  const executeRun = async ({ emit }) => {
    emit({ type:'privacy-route-integrity', workId:'work-1', privacyRouteIntegrity:{ ...baseReport, overallStatus:'pass' } });
    emit({ type:'privacy-route-integrity', workId:'work-1', privacyRouteIntegrity:{ ...baseReport, overallStatus:'fail' } });
  };
  const registry = createRunRegistry({ runStore: store, executeRun });
  const run = await registry.createRun(config('privacy-route-proof'));
  await wait(30);
  const detail = registry.getRun(run.runId);
  assert.equal(detail.privacyRouteIntegrityByWork['work-1'].overallStatus, 'fail');
});
