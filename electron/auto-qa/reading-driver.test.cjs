const test = require('node:test');
const assert = require('node:assert/strict');
let mod = {};
try { mod = require('./reading-driver.cjs'); } catch {}

test('reading profiles are deterministic and natural pauses stay readable', () => {
  assert.equal(typeof mod.createReadingProfile, 'function');
  const a = mod.createReadingProfile('natural', 'seed-1');
  const b = mod.createReadingProfile('natural', 'seed-1');
  assert.deepEqual(a, b);
  assert.equal(a.pauseMs >= 1400 && a.pauseMs <= 2800, true);
  assert.equal(a.distancePx >= 180 && a.distancePx <= 520, true);
  const slow = mod.createReadingProfile('slow', 'seed-1');
  const fast = mod.createReadingProfile('fast', 'seed-1');
  assert.equal(slow.pauseMs > a.pauseMs, true);
  assert.equal(fast.pauseMs < a.pauseMs, true);
});

test('full page observation reaches a stable bottom and returns to the top before completing', async () => {
  assert.equal(typeof mod.performFullPageObservation, 'function');
  let y = 0;
  const height = 1800;
  const viewport = 600;
  const waits = [];
  const page = {
    async evaluate(_fn, arg) {
      if (typeof arg === 'number') {
        y = Math.max(0, Math.min(height - viewport, y + arg));
        return;
      }
      return { scrollY:y, scrollHeight:height, viewportHeight:viewport, maxScroll:height - viewport };
    },
    async waitForTimeout(ms) { waits.push(ms); },
  };
  const checkpoints = [];
  const report = await mod.performFullPageObservation(page, {
    readingPace:'natural', seed:'round-trip',
    lifetime:{ remainingMs:()=>120000, throwIfExpired(){}, async wait(ms){ waits.push(ms); } },
    onCheckpoint:async (state)=>checkpoints.push(state.direction),
    log:()=>{}, reserveMs:5000,
  });
  assert.equal(report.reachedBottom, true);
  assert.equal(report.reachedTop, true);
  assert.equal(report.completedRoundTrip, true);
  assert.equal(y, 0);
  assert.equal(checkpoints.includes('down'), true);
  assert.equal(checkpoints.includes('up'), true);
  assert.equal(waits.some((ms) => ms >= 1000), true);
});

test('adaptive traversal budget preserves action time and makes the return trip faster', () => {
  assert.equal(typeof mod.createTraversalBudget, 'function');
  const short = mod.createTraversalBudget({ readingPace:'natural', remainingMs:20000, scrollDistancePx:6000, finalReserveMs:5000 });
  const long = mod.createTraversalBudget({ readingPace:'natural', remainingMs:120000, scrollDistancePx:6000, finalReserveMs:5000 });

  assert.equal(short.actionReserveMs >= 4500, true);
  assert.equal(long.down.pauseMs > short.down.pauseMs, true);
  assert.equal(short.down.distancePx >= long.down.distancePx, true);
  assert.equal(short.up.pauseMs < short.down.pauseMs, true);
  assert.equal(short.up.distancePx > short.down.distancePx, true);
  assert.equal(short.observationBudgetMs + short.actionReserveMs + short.finalReserveMs <= 20000, true);
  const passive = mod.createTraversalBudget({ readingPace:'natural', remainingMs:20000, scrollDistancePx:6000, finalReserveMs:5000, actionReserveMs:0 });
  assert.equal(passive.actionReserveMs, 0);
  assert.equal(passive.observationBudgetMs, 15000);
});

test('adaptive full-page observation finishes a tall page within a short session while preserving action and verification time', async () => {
  let remaining = 20000;
  let y = 0;
  const height = 10000;
  const viewport = 800;
  const page = {
    async evaluate(_fn, arg) {
      if (typeof arg === 'number') {
        y = Math.max(0, Math.min(height - viewport, y + arg));
        return;
      }
      return { scrollY:y, scrollHeight:height, viewportHeight:viewport, maxScroll:height - viewport };
    },
  };
  const lifetime = {
    remainingMs:()=>remaining,
    throwIfExpired(){ if (remaining <= 0) throw new Error('expired'); },
    async wait(ms){ remaining -= Number(ms || 0); },
  };
  const report = await mod.performFullPageObservation(page, {
    readingPace:'natural', seed:'short-tall-page', lifetime, reserveMs:5000, log:()=>{},
  });
  assert.equal(report.completedRoundTrip, true);
  assert.equal(y, 0);
  assert.equal(remaining >= 9500, true);
});

test('full page observation returns to the top before yielding when the downward pass hits its action-time reserve', async () => {
  let remaining = 14000;
  let y = 0;
  const height = 12000;
  const viewport = 800;
  const page = {
    async evaluate(_fn, arg) {
      if (typeof arg === 'number') {
        y = Math.max(0, Math.min(height - viewport, y + arg));
        return;
      }
      return { scrollY:y, scrollHeight:height, viewportHeight:viewport, maxScroll:height - viewport };
    },
  };
  const lifetime = {
    remainingMs:()=>remaining,
    throwIfExpired(){ if (remaining <= 0) throw new Error('expired'); },
    async wait(ms){ remaining -= Number(ms || 0); },
  };
  const report = await mod.performFullPageObservation(page, {
    readingPace:'natural', seed:'reserve-return-top', lifetime,
    reserveMs:5000, actionReserveMs:5000, log:()=>{},
  });
  assert.equal(report.reachedTop, true);
  assert.equal(y, 0);
});
