const test = require('node:test');
const assert = require('node:assert/strict');
let mod = {};
try { mod = require('./blocker-observer.cjs'); } catch {}

test('blocker observer waits before safe dismissal and skips verification/protected overlays', async () => {
  assert.equal(typeof mod.createBlockerObserver, 'function');
  const waits = [];
  let resolves = 0;
  let resolveOptions = null;
  let moves = 0;
  const lifetime = { async wait(ms){ waits.push(ms); }, throwIfExpired(){}, remainingMs:()=>10000 };
  const resolver = { async inspect(){ return { blocked:true, humanVerification:false, surfaces:[{ text:'Newsletter popup' }] }; }, async resolveOnce(options){ resolves += 1; resolveOptions = options; await options.beforeDismiss?.({ locator:{ id:'close' }, method:'control', label:'Close' }); return { outcome:'dismissed', method:'control', label:'Close' }; } };
  const observer = mod.createBlockerObserver({ page:{}, resolver, lifetime, indicator:{ async move(){ moves += 1; }, async pulse(){} }, indicatorMode:'desktop', log:()=>{} });
  const result = await observer.inspectAndResolve();
  assert.equal(result.dismissed, true);
  assert.equal(resolves, 1);
  assert.equal(resolveOptions.preservePopup, true);
  assert.equal(typeof resolveOptions.beforeDismiss, 'function');
  assert.equal(moves, 1);
  assert.equal(waits.some((ms) => ms >= 500), true);

  let verificationResolveOptions = null;
  const verification = mod.createBlockerObserver({ page:{}, resolver:{
    async inspect(){ return { blocked:true, humanVerification:true, surfaces:[{ text:'Verify you are human CAPTCHA' }] }; },
    async resolveOnce(options){ verificationResolveOptions = options; return { outcome:'human-verification-blocked' }; },
  }, lifetime, log:()=>{} });
  const skipped = await verification.inspectAndResolve();
  assert.equal(skipped.dismissed, false);
  assert.match(skipped.skippedReason, /verification/i);
  assert.equal(verificationResolveOptions.controlOnly, true);
});

test('promotional overlays may be dismissed only through a safe close control', async () => {
  let optionsSeen = null;
  let resolves = 0;
  const lifetime = { async wait(){}, throwIfExpired(){}, remainingMs:()=>10000 };
  const resolver = {
    async inspect(){ return { blocked:true, humanVerification:false, surfaces:[{ text:'Sponsored advertisement popup' }] }; },
    async resolveOnce(options){
      resolves += 1;
      optionsSeen = options;
      await options.beforeDismiss?.({ locator:{}, method:'control', label:'Close' });
      return { outcome:'dismissed', method:'control', label:'Close' };
    },
  };
  const observer = mod.createBlockerObserver({ page:{}, resolver, lifetime, indicator:{async move(){},async pulse(){}}, indicatorMode:'desktop', log:()=>{} });
  const result = await observer.inspectAndResolve();
  assert.equal(result.dismissed, true);
  assert.equal(resolves, 1);
  assert.equal(optionsSeen.controlOnly, true);
});

test('continuous blocker monitor notices and resolves an overlay that appears between normal QA checkpoints', async () => {
  let inspections = 0;
  let dismissals = 0;
  const resolver = {
    async inspect() {
      inspections += 1;
      if (inspections < 2) return { blocked:false, surfaces:[] };
      return { blocked:true, humanVerification:false, surfaces:[{ text:'Newsletter popup' }] };
    },
    async resolveOnce() {
      dismissals += 1;
      return { outcome:'dismissed', method:'control', label:'Close' };
    },
  };
  const lifetime = { throwIfExpired(){}, remainingMs:()=>10000 };
  const observer = mod.createBlockerObserver({ page:{}, resolver, lifetime, log:()=>{} });
  assert.equal(typeof observer.startContinuousMonitor, 'function');
  const stop = observer.startContinuousMonitor({ intervalMs:5 });
  await new Promise((resolve) => setTimeout(resolve, 140));
  stop();
  assert.ok(inspections >= 2);
  assert.ok(dismissals >= 1);
});


test('human-verification overlay may close only through its separate safe Close/X control', async () => {
  const calls = [];
  const lifetime = { async wait(ms){ calls.push(['wait', ms]); }, throwIfExpired(){}, remainingMs:()=>10000 };
  const resolver = {
    async inspect(){ return { blocked:true, humanVerification:true, surfaces:[{ text:'CONFIRM YOU ARE NOT A ROBOT Click the button' }] }; },
    async resolveOnce(options){
      calls.push(['resolve', options.controlOnly]);
      await options.beforeDismiss?.({ locator:{ id:'top-right-x' }, method:'control', label:'X' });
      return { outcome:'dismissed', method:'control', label:'X' };
    },
  };
  let moves = 0;
  const observer = mod.createBlockerObserver({ page:{}, resolver, lifetime, indicator:{ async move(){ moves += 1; }, async pulse(){} }, indicatorMode:'desktop', log:()=>{} });
  const result = await observer.inspectAndResolve();
  assert.equal(result.dismissed, true);
  assert.equal(result.label, 'X');
  assert.equal(calls.some((entry)=>entry[0] === 'resolve' && entry[1] === true), true);
  assert.equal(moves, 1);
});

test('continuous blocker monitor keeps watching after a first popup is dismissed and closes a later popup too', async () => {
  let inspections = 0;
  let dismissals = 0;
  const resolver = {
    async inspect() {
      inspections += 1;
      // popup 1, clear gap, popup 2, then clear
      if (inspections === 2 || inspections === 5) return { blocked:true, humanVerification:false, surfaces:[{ text:'Popup with Close' }] };
      return { blocked:false, humanVerification:false, surfaces:[] };
    },
    async resolveOnce(){ dismissals += 1; return { outcome:'dismissed', method:'control', label:'Close' }; },
  };
  const lifetime = { throwIfExpired(){}, remainingMs:()=>10000, async wait(){} };
  const observer = mod.createBlockerObserver({ page:{}, resolver, lifetime, log:()=>{} });
  const stop = observer.startContinuousMonitor({ intervalMs:5 });
  await new Promise((resolve) => setTimeout(resolve, 360));
  stop();
  assert.ok(inspections >= 5);
  assert.equal(dismissals, 2);
});
