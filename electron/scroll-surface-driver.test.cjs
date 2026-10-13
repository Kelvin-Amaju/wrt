const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseScrollSurface, browseScrollSurface } = require('./scroll-surface-driver.cjs');

test('chooses nested scroll container when window cannot scroll', () => {
  const chosen = chooseScrollSurface([
    { kind:'window', token:null, currentScroll:0, maxScroll:0, area:800000, centerHit:true },
    { kind:'element', token:'s1', currentScroll:0, maxScroll:1400, area:700000, centerHit:true },
    { kind:'element', token:'s2', currentScroll:0, maxScroll:400, area:300000, centerHit:false },
  ]);
  assert.equal(chosen.kind, 'element');
  assert.equal(chosen.token, 's1');
});

test('browses incrementally to bottom and back while checking blockers', async () => {
  const state = { scroll:0, max:300, deltas:[] };
  const page = {
    evaluate: async (_fn, payload) => {
      if (payload.command === 'discover') return [{ kind:'element', token:'s1', currentScroll:state.scroll, maxScroll:state.max, area:500000, centerHit:true }];
      if (payload.command === 'scroll') { state.scroll = Math.max(0, Math.min(state.max, state.scroll + payload.delta)); state.deltas.push(payload.delta); return state.scroll; }
      if (payload.command === 'metrics') return { currentScroll:state.scroll, maxScroll:state.max };
      throw new Error(`unknown ${payload.command}`);
    },
    waitForTimeout: async () => {},
  };
  let blockerChecks = 0;
  const resolver = { resolveLoop: async () => { blockerChecks += 1; return { outcome:'none' }; } };
  const surface = await browseScrollSurface(page, { direction:'down', resolver, timing:{ stepPx:100, delayMs:0, blockerEvery:1 } });
  assert.equal(surface.kind, 'element');
  assert.equal(state.scroll, 300);
  await browseScrollSurface(page, { direction:'up', resolver, timing:{ stepPx:100, delayMs:0, blockerEvery:1 } });
  assert.equal(state.scroll, 0);
  assert.deepEqual(state.deltas, [100,100,100,-100,-100,-100]);
  assert.equal(blockerChecks >= 6, true);
});

test('uses real wheel input when available so visible-browser scrolling follows the page scroll surface', async () => {
  const state = { scroll:0, max:240, moves:[], wheels:[] };
  const page = {
    evaluate: async (_fn, payload) => {
      if (payload.command === 'discover') return [{ kind:'element', token:'s1', currentScroll:state.scroll, maxScroll:state.max, area:400000, centerHit:true }];
      if (payload.command === 'metrics') return { currentScroll:state.scroll, maxScroll:state.max };
      if (payload.command === 'rect') return { x:20, y:30, width:300, height:500 };
      if (payload.command === 'scroll') throw new Error('DOM fallback should not be used when mouse wheel works');
      return null;
    },
    mouse: {
      move: async (x, y) => { state.moves.push([x, y]); },
      wheel: async (_dx, dy) => { state.wheels.push(dy); state.scroll = Math.max(0, Math.min(state.max, state.scroll + dy)); },
    },
    waitForTimeout: async () => {},
  };
  await browseScrollSurface(page, { direction:'down', timing:{ stepPx:80, delayMs:0, blockerEvery:10 } });
  assert.deepEqual(state.wheels, [80,80,80]);
  assert.equal(state.scroll, 240);
  assert.equal(state.moves.length > 0, true);
});

test('default visible browsing uses gentle deterministic wheel increments with readable pauses', async () => {
  const state = { scroll:0, max:270, wheels:[], waits:[] };
  const page = {
    evaluate: async (_fn, payload) => {
      if (payload.command === 'discover') return [{ kind:'window', token:null, currentScroll:state.scroll, maxScroll:state.max, area:400000, centerHit:true }];
      if (payload.command === 'metrics') return { currentScroll:state.scroll, maxScroll:state.max };
      if (payload.command === 'rect') return { x:0, y:0, width:800, height:600 };
      if (payload.command === 'scroll') throw new Error('wheel path expected');
      return null;
    },
    mouse: {
      move: async () => {},
      wheel: async (_dx, dy) => { state.wheels.push(Math.abs(dy)); state.scroll = Math.max(0, Math.min(state.max, state.scroll + dy)); },
    },
    waitForTimeout: async (ms) => { state.waits.push(ms); },
  };

  await browseScrollSurface(page, { direction:'down' });
  assert.equal(Math.max(...state.wheels) <= 100, true);
  assert.equal(state.waits.length > 0, true);
  assert.equal(Math.min(...state.waits) >= 150, true);
});

test('varied manual-QA scroll timing uses a step pattern, pauses, and a bounded target instead of always forcing the bottom', async () => {
  const state = { scroll:0, max:1000, wheels:[], waits:[] };
  const logs = [];
  const page = {
    evaluate: async (_fn, payload) => {
      if (payload.command === 'discover') return [{ kind:'window', token:null, currentScroll:state.scroll, maxScroll:state.max, area:400000, centerHit:true }];
      if (payload.command === 'metrics') return { currentScroll:state.scroll, maxScroll:state.max };
      if (payload.command === 'rect') return { x:0, y:0, width:800, height:600 };
      if (payload.command === 'scroll') { state.scroll = Math.max(0, Math.min(state.max, state.scroll + payload.delta)); return state.scroll; }
      return null;
    },
    mouse: {
      move: async () => {},
      wheel: async (_dx, dy) => { state.wheels.push(Math.abs(dy)); state.scroll = Math.max(0, Math.min(state.max, state.scroll + dy)); },
    },
    waitForTimeout: async (ms) => { state.waits.push(ms); },
  };

  await browseScrollSurface(page, {
    direction:'down',
    log:(message) => logs.push(message),
    timing:{
      stepPatternPx:[120, 180, 95, 155],
      delayMs:20,
      pauseEverySteps:2,
      pauseMs:240,
      targetRatio:0.82,
      logEverySteps:2,
      blockerEvery:10,
    },
  });

  assert.equal(state.scroll >= 800 && state.scroll <= 840, true, `expected target near 82%, got ${state.scroll}`);
  assert.equal(new Set(state.wheels).size > 1, true);
  assert.equal(state.waits.includes(240), true);
  assert.equal(logs.some((message) => /Browsing scroll down: \d+%/i.test(message)), true);
  assert.equal(logs.some((message) => /Browsing scroll down: 20%/i.test(message)), false);
});
