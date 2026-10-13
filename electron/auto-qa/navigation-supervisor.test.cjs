const test = require('node:test');
const assert = require('node:assert/strict');
let mod = {};
try { mod = require('./navigation-supervisor.cjs'); } catch {}

test('navigation supervisor retries idempotent work once but never replays side effects', async () => {
  assert.equal(typeof mod.createNavigationSupervisor, 'function');
  let idempotentCalls = 0;
  let sideCalls = 0;
  let settles = 0;
  const page = { url: () => 'https://example.org/', async waitForLoadState(){ settles += 1; }, async bringToFront(){} };
  const context = { pages: () => [page] };
  const supervisor = mod.createNavigationSupervisor({ context, primaryPage:page, lifetime:{ remainingMs:()=>10000, throwIfExpired(){} }, log:()=>{}, settings:{ observeNewTabs:true } });
  const result = await supervisor.runIdempotent('analysis', async () => {
    idempotentCalls += 1;
    if (idempotentCalls === 1) throw new Error('Execution context was destroyed, most likely because of a navigation');
    return 42;
  });
  assert.equal(result, 42);
  assert.equal(idempotentCalls, 2);
  await supervisor.runSideEffect('click', async () => {
    sideCalls += 1;
    throw new Error('Execution context was destroyed, most likely because of a navigation');
  });
  assert.equal(sideCalls, 1);
  assert.equal(settles >= 2, true);
});

test('navigation supervisor observes ordinary tabs and passively observes ad-like tabs while retaining both until session end', async () => {
  let browsed = 0;
  let adClosed = 0;
  let primaryFocused = 0;
  const primary = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){ primaryFocused += 1; } };
  const safe = { url:()=> 'https://example.org/result', async title(){ return 'Result'; }, async waitForLoadState(){}, async close(){} };
  const ad = { url:()=> 'https://ads.example/promo', async title(){ return 'Sponsored offer'; }, async waitForLoadState(){}, async close(){ adClosed += 1; } };
  let pages = [primary];
  const context = { pages:()=>pages };
  const supervisor = mod.createNavigationSupervisor({ context, primaryPage:primary, lifetime:{ remainingMs:()=>10000, throwIfExpired(){}, async wait(){} }, log:()=>{}, analyzePage:async (page)=>({ adLikeElements: page===ad ? [{ text:'Sponsored' }] : [] }), browseAuxiliaryPage:async ()=>{ browsed += 1; }, settings:{ observeNewTabs:true } });
  pages = [primary, safe, ad];
  const report = await supervisor.observeNewPages();
  assert.equal(report.observed, 2);
  assert.equal(browsed, 2);
  assert.equal(adClosed, 0);
  assert.equal(primaryFocused >= 1, true);
});

test('navigation supervisor fully settles ordinary auxiliary tabs before browsing and retains them until the work-unit timer ends', async () => {
  const states = [];
  let browsed = 0;
  let closed = 0;
  const primary = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){} };
  const aux = {
    url:()=> 'https://example.org/post',
    async title(){ return 'Post'; },
    async waitForLoadState(state){ states.push(state); },
    async close(){ closed += 1; },
  };
  let pages = [primary];
  const context = { pages:()=>pages };
  const supervisor = mod.createNavigationSupervisor({
    context, primaryPage:primary,
    lifetime:{ remainingMs:()=>30000, throwIfExpired(){}, async wait(){} },
    log:()=>{}, analyzePage:async()=>({ adLikeElements:[], safeActions:[{text:'Read'}], editableFields:[] }),
    browseAuxiliaryPage:async()=>{ browsed += 1; }, settings:{observeNewTabs:true},
  });
  pages = [primary, aux];
  await supervisor.observeNewPages();
  assert.deepEqual(states.slice(0, 3), ['domcontentloaded','load','networkidle']);
  assert.equal(browsed, 1);
  assert.equal(closed, 0);
});

test('navigation supervisor waits for a usable auxiliary document before browsing and retains it for the session', async () => {
  const order = [];
  const primary = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){ order.push('focus-primary'); } };
  const aux = {
    url:()=> 'https://example.org/post',
    async title(){ return 'Post'; },
    async waitForLoadState(state){ order.push(`state:${state}`); if (state === 'networkidle') throw new Error('Timeout 3500ms exceeded'); },
    async waitForFunction(){ order.push('ready-stable'); },
    async close(){ order.push('close'); },
  };
  let pages = [primary];
  const context = { pages:()=>pages };
  const supervisor = mod.createNavigationSupervisor({
    context, primaryPage:primary,
    lifetime:{ remainingMs:()=>30000, throwIfExpired(){}, async wait(){ order.push('dwell'); } },
    log:()=>{}, analyzePage:async()=>({ adLikeElements:[], safeActions:[{text:'Read'}], editableFields:[] }),
    browseAuxiliaryPage:async()=>{ order.push('browse'); }, settings:{observeNewTabs:true},
  });
  pages = [primary, aux];
  await supervisor.observeNewPages();
  assert.equal(order.includes('ready-stable'), true);
  assert.equal(order.indexOf('ready-stable') < order.indexOf('browse'), true);
  assert.equal(order.includes('close'), false);
});

test('promotional auxiliary tabs are passively observed and retained while primary recovery runs', async () => {
  const order = [];
  const primary = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){ order.push('focus'); } };
  const promo = {
    url:()=> 'https://ads.example/promo',
    async title(){ return 'Sponsored offer'; },
    async waitForLoadState(){},
    async waitForFunction(){},
    async close(){ order.push('close'); },
  };
  let pages = [primary];
  const context = { pages:()=>pages };
  const supervisor = mod.createNavigationSupervisor({
    context, primaryPage:primary,
    lifetime:{ remainingMs:()=>30000, throwIfExpired(){}, async wait(){ order.push('dwell'); } },
    log:()=>{}, analyzePage:async()=>({ adLikeElements:[{text:'Sponsored'}], safeActions:[], editableFields:[] }),
    browseAuxiliaryPage:async (_page, meta)=>{ order.push(meta?.passiveOnly ? 'passive-browse' : 'browse'); },
    afterReturnToPrimary:async()=>{ order.push('after-return'); },
    settings:{observeNewTabs:true},
  });
  pages = [primary, promo];
  await supervisor.observeNewPages();
  assert.equal(order.includes('passive-browse'), true);
  assert.equal(order.includes('close'), false);
  assert.equal(order.indexOf('passive-browse') < order.indexOf('after-return'), true);
});

test('auxiliary tab must become usable and receive a minimum visible scroll before it is retained for the session', async () => {
  const order = [];
  const waitFunctions = [];
  const primary = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){ order.push('focus'); } };
  const aux = {
    url:()=> 'https://external.example/article',
    async title(){ return 'External article'; },
    async waitForLoadState(state){ order.push(`state:${state}`); },
    async waitForFunction(fn){ waitFunctions.push(String(fn)); order.push('usable-ready'); },
    async evaluate(fn){
      const source = String(fn);
      if (source.includes('ORBITQA_AUXILIARY_SCROLL_METRICS')) return { scrollHeight:2400, viewportHeight:800, scrollY:0 };
      if (source.includes('ORBITQA_AUXILIARY_MIN_SCROLL')) { order.push('minimum-scroll'); return true; }
      return null;
    },
    async close(){ order.push('close'); },
  };
  let pages = [primary];
  const context = { pages:()=>pages };
  const supervisor = mod.createNavigationSupervisor({
    context, primaryPage:primary,
    lifetime:{ remainingMs:()=>30000, throwIfExpired(){}, async wait(ms){ order.push(`dwell:${ms}`); } },
    log:()=>{}, analyzePage:async()=>({ adLikeElements:[], safeActions:[{text:'Read'}], editableFields:[] }),
    browseAuxiliaryPage:async()=>{ order.push('browse'); }, settings:{observeNewTabs:true, finalVerificationReserveMs:5000},
  });
  pages = [primary, aux];
  await supervisor.observeNewPages();
  assert.equal(waitFunctions.some((source) => /about:blank/.test(source) && /scrollHeight/.test(source)), true);
  assert.equal(order.includes('minimum-scroll'), true);
  assert.equal(order.includes('close'), false);
  assert.equal(order.indexOf('minimum-scroll') < order.indexOf('browse'), true);
  assert.equal(order.some((entry) => /^dwell:/.test(entry)), true);
});

test('auxiliary tab verification hook runs before browsing and the tab remains open', async () => {
  const order = [];
  const primary = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){} };
  const aux = {
    url:()=> 'https://external.example/', async title(){ return 'External'; },
    async waitForLoadState(){}, async waitForFunction(){},
    async evaluate(fn){ if (String(fn).includes('ORBITQA_AUXILIARY_SCROLL_METRICS')) return {scrollHeight:700,viewportHeight:700,scrollY:0}; return null; },
    async close(){ order.push('close'); },
  };
  let pages = [primary];
  const context = { pages:()=>pages };
  const supervisor = mod.createNavigationSupervisor({
    context, primaryPage:primary,
    lifetime:{ remainingMs:()=>30000, throwIfExpired(){}, async wait(){} },
    log:()=>{}, analyzePage:async()=>({}),
    verifyAuxiliaryPage:async()=>{ order.push('verify'); return { ok:true }; },
    browseAuxiliaryPage:async()=>{ order.push('browse'); }, settings:{observeNewTabs:true, finalVerificationReserveMs:5000},
  });
  pages = [primary, aux];
  await supervisor.observeNewPages();
  assert.deepEqual(order.slice(0,2), ['verify','browse']);
  assert.equal(order.includes('close'), false);
});

test('auxiliary tab is not closed when a non-benign load failure prevents usable observation', async () => {
  let closed = 0;
  const primary = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){} };
  const aux = {
    url:()=> 'https://external.example/', async title(){ return 'External'; },
    async waitForLoadState(state){ if (state === 'load') throw new Error('net::ERR_CONNECTION_RESET'); },
    async waitForFunction(){},
    async close(){ closed += 1; },
  };
  let pages = [primary];
  const context = { pages:()=>pages };
  const supervisor = mod.createNavigationSupervisor({ context, primaryPage:primary, lifetime:{remainingMs:()=>30000,throwIfExpired(){},async wait(){}}, log:()=>{}, settings:{observeNewTabs:true} });
  pages = [primary, aux];
  await assert.rejects(() => supervisor.observeNewPages(), /ERR_CONNECTION_RESET/);
  assert.equal(closed, 0);
});

test('auxiliary tab is left open when complete load cannot be confirmed', async () => {
  let closed = 0;
  let browsed = 0;
  const logs = [];
  const primary = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){} };
  const aux = {
    url:()=> 'https://external.example/slow', async title(){ return 'Slow page'; },
    async waitForLoadState(state){ if (state === 'load') throw new Error('Timeout 8000ms exceeded'); },
    async waitForFunction(fn){ if (String(fn).includes("document.readyState === 'complete'")) throw new Error('Timeout 5000ms exceeded'); },
    async close(){ closed += 1; },
  };
  let pages = [primary];
  const context = { pages:()=>pages };
  const supervisor = mod.createNavigationSupervisor({
    context, primaryPage:primary,
    lifetime:{ remainingMs:()=>30000, throwIfExpired(){}, async wait(){} },
    log:(message)=>logs.push(message), analyzePage:async()=>({}), browseAuxiliaryPage:async()=>{ browsed += 1; },
    settings:{observeNewTabs:true, finalVerificationReserveMs:5000},
  });
  pages = [primary, aux];
  await supervisor.observeNewPages();
  assert.equal(closed, 0);
  assert.equal(browsed, 0);
  assert.ok(logs.some((message) => /left open/i.test(message) && /complete load/i.test(message)));
});

test('pending auxiliary tab is rechecked later and remains open after complete load plus observation', async () => {
  let phase = 0;
  let closed = 0;
  let browsed = 0;
  const primary = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){} };
  const aux = {
    url:()=> 'https://external.example/slow', async title(){ return 'Slow page'; },
    async waitForLoadState(state){
      if (phase === 0 && state === 'load') throw new Error('Timeout 8000ms exceeded');
    },
    async waitForFunction(fn){
      if (phase === 0 && String(fn).includes("document.readyState === 'complete'")) throw new Error('Timeout 5000ms exceeded');
    },
    async evaluate(fn){
      if (String(fn).includes('ORBITQA_AUXILIARY_SCROLL_METRICS')) return { scrollHeight:1600, viewportHeight:800, scrollY:0 };
      if (String(fn).includes('ORBITQA_AUXILIARY_MIN_SCROLL')) return true;
      return null;
    },
    async close(){ closed += 1; },
  };
  let pages = [primary];
  const context = { pages:()=>pages };
  const supervisor = mod.createNavigationSupervisor({
    context, primaryPage:primary,
    lifetime:{ remainingMs:()=>30000, throwIfExpired(){}, async wait(){} },
    log:()=>{}, analyzePage:async()=>({}), browseAuxiliaryPage:async()=>{ browsed += 1; },
    settings:{observeNewTabs:true, finalVerificationReserveMs:5000},
  });
  pages = [primary, aux];
  const first = await supervisor.observeNewPages();
  assert.equal(first.observed, 0);
  assert.equal(closed, 0);
  phase = 1;
  const second = await supervisor.observeNewPages();
  assert.equal(second.observed, 1);
  assert.equal(browsed, 1);
  assert.equal(closed, 0);
});


test('all observed auxiliary tabs remain open together until the BrowserContext is closed at session end', async () => {
  const closed = [];
  const makeAux = (name) => ({
    url:()=> `https://external.example/${name}`,
    async title(){ return name; },
    async waitForLoadState(){}, async waitForFunction(){},
    async evaluate(fn){
      if (String(fn).includes('ORBITQA_AUXILIARY_SCROLL_METRICS')) return { scrollHeight:1200, viewportHeight:800, scrollY:0 };
      if (String(fn).includes('ORBITQA_AUXILIARY_MIN_SCROLL')) return true;
      return null;
    },
    async close(){ closed.push(name); },
  });
  const primary = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){} };
  const auxA = makeAux('a');
  const auxB = makeAux('b');
  let pages = [primary];
  const context = {
    pages:()=>pages,
    async close(){ for (const page of pages) if (page !== primary) await page.close(); },
  };
  const supervisor = mod.createNavigationSupervisor({
    context, primaryPage:primary,
    lifetime:{ remainingMs:()=>30000, throwIfExpired(){}, async wait(){} },
    log:()=>{}, analyzePage:async()=>({ adLikeElements:[], safeActions:[{text:'Read'}], editableFields:[] }),
    browseAuxiliaryPage:async()=>{}, settings:{observeNewTabs:true, finalVerificationReserveMs:5000},
  });
  pages = [primary, auxA, auxB];
  const report = await supervisor.observeNewPages();
  assert.equal(report.observed, 2);
  assert.deepEqual(closed, []);
  await context.close();
  assert.deepEqual(closed.sort(), ['a','b']);
});
