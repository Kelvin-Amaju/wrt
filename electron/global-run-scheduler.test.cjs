const test = require('node:test');
const assert = require('node:assert/strict');
const { createGlobalRunScheduler } = require('./global-run-scheduler.cjs');

const tick = () => new Promise((r) => setImmediate(r));

test('global scheduler rotates launch leases fairly across runs', async () => {
  const scheduler = createGlobalRunScheduler({ startupLimit: 1 });
  scheduler.registerRun('A', 3); scheduler.registerRun('B', 3); scheduler.registerRun('C', 3);
  const order = [];
  async function ask(id) { const release = await scheduler.requestLaunch(id); order.push(id); await tick(); release(); }
  await Promise.all([ask('A'), ask('A'), ask('B'), ask('B'), ask('C'), ask('C')]);
  assert.deepEqual(order.slice(0, 3).sort(), ['A','B','C']);
});

test('global scheduler respects each run concurrency ceiling', async () => {
  const scheduler = createGlobalRunScheduler({ startupLimit: 10 });
  scheduler.registerRun('A', 2);
  let active = 0, peak = 0;
  async function ask() { const release = await scheduler.requestLaunch('A'); active++; peak=Math.max(peak,active); await new Promise(r=>setTimeout(r,10)); active--; release(); }
  await Promise.all([ask(),ask(),ask(),ask()]);
  assert.equal(peak, 2);
});
