const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionLifetimeController } = require('./session-lifetime.cjs');

function createFakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const setTimer = (fn, ms) => {
    const id = nextId++;
    timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn });
    return id;
  };
  const clearTimer = (id) => timers.delete(id);
  const advance = async (ms) => {
    now += ms;
    let ran = true;
    while (ran) {
      ran = false;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= now)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      if (due.length > 0) {
        ran = true;
        for (const [id, timer] of due) {
          if (!timers.has(id)) continue;
          timers.delete(id);
          timer.fn();
        }
      }
    }
    await Promise.resolve();
    await Promise.resolve();
  };
  return { now: () => now, setTimer, clearTimer, advance };
}

function createContext() {
  let closes = 0;
  return {
    async close() { closes += 1; },
    get closes() { return closes; },
  };
}

test('session lifetime has one non-resetting deadline and closes the whole context at expiry', async () => {
  const clock = createFakeClock();
  const context = createContext();
  const controller = createSessionLifetimeController({
    context,
    durationMs: 1000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  assert.equal(controller.startedAt, 0);
  assert.equal(controller.deadlineAt, 1000);
  assert.equal(controller.remainingMs(), 1000);
  assert.equal('reset' in controller, false);

  await clock.advance(400);
  assert.equal(controller.remainingMs(), 600);
  assert.equal(context.closes, 0);

  await clock.advance(600);
  await controller.waitUntilClosed();
  assert.equal(controller.expired, true);
  assert.equal(controller.reason, 'duration-elapsed');
  assert.equal(context.closes, 1);
});

test('STOP and deadline races close the context only once', async () => {
  const clock = createFakeClock();
  const context = createContext();
  const abort = new AbortController();
  const controller = createSessionLifetimeController({
    context,
    durationMs: 1000,
    signal: abort.signal,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  abort.abort();
  await clock.advance(1000);
  await controller.waitUntilClosed();
  assert.equal(controller.reason, 'user-stop');
  assert.equal(context.closes, 1);
});

test('deadline-aware wait is capped to remaining session time and reports expiration', async () => {
  const clock = createFakeClock();
  const context = createContext();
  const controller = createSessionLifetimeController({
    context,
    durationMs: 1000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  const waiting = controller.wait(5000);
  await clock.advance(1000);
  await assert.rejects(waiting, (error) => error?.name === 'SessionExpiredError');
  assert.equal(context.closes, 1);
});

test('new and manually opened tabs share the original deadline and all close with the context', async () => {
  const clock = createFakeClock();
  const pages = [{ closed: false, name: 'primary' }];
  const context = {
    closes: 0,
    async close() {
      this.closes += 1;
      for (const page of pages) page.closed = true;
    },
  };
  const controller = createSessionLifetimeController({
    context,
    durationMs: 1000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  await clock.advance(400);
  pages.push({ closed: false, name: 'site-popup' });
  await clock.advance(300);
  pages.push({ closed: false, name: 'manual-tab' });
  assert.equal(controller.deadlineAt, 1000);
  assert.equal(controller.remainingMs(), 300);

  await clock.advance(300);
  await controller.waitUntilClosed();
  assert.equal(context.closes, 1);
  assert.deepEqual(pages.map((page) => page.closed), [true, true, true]);
});

test('active QA session can begin after slow startup without losing requested activity duration', async () => {
  const clock = createFakeClock();
  const context = createContext();
  const controller = createSessionLifetimeController({
    context,
    durationMs: 180000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });

  await clock.advance(70000);
  assert.equal(controller.remainingMs(), 110000);
  controller.beginActiveSession(60000);
  assert.equal(controller.startedAt, 70000);
  assert.equal(controller.deadlineAt, 130000);
  assert.equal(controller.remainingMs(), 60000);

  await clock.advance(59999);
  assert.equal(context.closes, 0);
  await clock.advance(1);
  await controller.waitUntilClosed();
  assert.equal(controller.reason, 'duration-elapsed');
  assert.equal(context.closes, 1);
});
