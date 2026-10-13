const test = require('node:test');
const assert = require('node:assert/strict');
const { installInteractionIndicator, moveInteractionIndicator, pulseInteractionIndicator, indicatorModeForExecutionKind } = require('./interaction-indicator.cjs');

function fakePage() {
  const calls = [];
  return {
    calls,
    evaluate: async (_fn, payload) => { calls.push(payload); return true; },
  };
}

test('installs a non-interactive desktop cursor and mobile touch marker', async () => {
  const page = fakePage();
  await installInteractionIndicator(page, { mode:'cursor' });
  await installInteractionIndicator(page, { mode:'touch' });
  assert.deepEqual(page.calls.map((call) => [call.command, call.mode]), [['install','cursor'],['install','touch']]);
  assert.equal(indicatorModeForExecutionKind('desktop'), 'cursor');
  assert.equal(indicatorModeForExecutionKind('android-emulation'), 'touch');
  assert.equal(indicatorModeForExecutionKind('ios-emulation'), 'touch');
});

test('moves to the actual locator center and pulse is visual only', async () => {
  const page = fakePage();
  const target = { boundingBox: async () => ({ x:10, y:20, width:100, height:40 }) };
  await moveInteractionIndicator(page, target, { mode:'cursor' });
  await pulseInteractionIndicator(page, { mode:'cursor' });
  assert.deepEqual(page.calls[0], { command:'move', mode:'cursor', x:60, y:40 });
  assert.deepEqual(page.calls[1], { command:'pulse', mode:'cursor' });
});

test('indicator can move visually to a point without using the page mouse', async () => {
  const mod = require('./interaction-indicator.cjs');
  let mouseCalls = 0;
  const payloads = [];
  const page = {
    mouse:{ move:async()=>{ mouseCalls += 1; } },
    evaluate: async (_fn, payload) => { payloads.push(payload); return true; },
  };
  const ok = await mod.moveInteractionIndicatorToPoint(page, { x:44, y:55 }, { mode:'cursor' });
  assert.equal(ok, true);
  assert.equal(mouseCalls, 0);
  assert.equal(payloads.at(-1).x, 44);
  assert.equal(payloads.at(-1).y, 55);
});

test('desktop indicator click moves the browser mouse to the visible cursor point and clicks there', async () => {
  const mod=require('./interaction-indicator.cjs');
  const events=[];const payloads=[];
  const page={
    __orbitqaInteractionMode:'cursor',
    mouse:{
      move:async(x,y,opts)=>events.push(['move',x,y,opts?.steps||0]),
      click:async(x,y,opts)=>events.push(['click',x,y,opts?.delay||0]),
    },
    evaluate:async(_fn,payload)=>{payloads.push(payload);return true;},
  };
  const target={scrollIntoViewIfNeeded:async()=>{},boundingBox:async()=>({x:20,y:30,width:80,height:40}),click:async()=>{throw new Error('locator click should not be needed')}};
  const ok=await mod.clickWithInteractionIndicator(page,target,{timeout:2000});
  assert.equal(ok,true);
  assert.deepEqual(events[0].slice(0,3),['move',60,50]);
  assert.deepEqual(events[1].slice(0,3),['click',60,50]);
  assert.ok(payloads.some(p=>p.command==='move'&&p.x===60&&p.y===50));
  assert.ok(payloads.some(p=>p.command==='pulse'));
});

test('touch mode does not force desktop page.mouse click', async () => {
  const mod=require('./interaction-indicator.cjs');
  let mouseClicks=0,taps=0;
  const page={mouse:{move:async()=>{},click:async()=>{mouseClicks++}},evaluate:async()=>true};
  const target={scrollIntoViewIfNeeded:async()=>{},boundingBox:async()=>({x:0,y:0,width:10,height:10}),tap:async()=>{taps++},click:async()=>{}};
  await mod.clickWithInteractionIndicator(page,target,{mode:'touch'});
  assert.equal(mouseClicks,0);
  assert.equal(taps,1);
});
