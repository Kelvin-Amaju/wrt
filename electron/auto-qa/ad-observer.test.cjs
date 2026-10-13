const test = require('node:test');
const assert = require('node:assert/strict');
const { observeAds } = require('./ad-observer.cjs');

test('ad observer counts visible ads and only moves the OrbitQA indicator near them', async () => {
  const moves = [];
  const logs = [];
  let clicks = 0;
  const indicator = { moveToPoint: async (_page, point) => moves.push(point) };
  const page = { waitForTimeout: async () => {}, mouse:{ click:async()=>{ clicks += 1; }, move:async()=>{} } };
  const ads = [
    { kind:'iframe', rect:{ x:100, y:200, width:300, height:250 }, text:'Advertisement' },
    { kind:'banner', rect:{ x:20, y:600, width:728, height:90 }, text:'Sponsored' },
  ];
  const result = await observeAds({ page, ads, indicator, mode:'desktop', budgetMs:1200, log:(m)=>logs.push(m) });
  assert.equal(result.detected, 2);
  assert.equal(result.observed, 2);
  assert.equal(moves.length, 2);
  assert.equal(clicks, 0);
  assert.match(logs.join('\n'), /Visible advertisements detected: 2/);
  assert.match(logs.join('\n'), /Advertisement regions observed: 2/);
});

test('ad observer deduplicates repeated detections and classifies visible ad formats', async () => {
  const logs = [];
  const ads = [
    { selectorHint:'#banner', kind:'container', rect:{x:0,y:10,width:728,height:90}, text:'Advertisement banner' },
    { selectorHint:'#banner', kind:'container', rect:{x:0,y:10,width:728,height:90}, text:'Advertisement banner duplicate' },
    { selectorHint:'#sticky', kind:'container', rect:{x:0,y:700,width:390,height:50}, text:'Sponsored', position:'fixed' },
    { selectorHint:'#vig', kind:'iframe', rect:{x:0,y:0,width:390,height:844}, text:'Advertisement', position:'fixed' },
    { selectorHint:'#native', kind:'link', rect:{x:10,y:200,width:300,height:140}, text:'Sponsored story' },
  ];
  const result = await observeAds({ page:{ waitForTimeout:async()=>{} }, ads, budgetMs:1000, log:(m)=>logs.push(m) });
  assert.equal(result.detected, 4);
  assert.equal(result.byType.banner, 1);
  assert.equal(result.byType.stickyAnchor, 1);
  assert.equal(result.byType.interstitialVignette, 1);
  assert.equal(result.byType.nativeSponsored, 1);
  assert.match(logs.join('\n'), /Ad type Banner: 1/);
});

test('ad observer never dispatches hover or click events into advertisement content', async () => {
  let hover = 0;
  let click = 0;
  const page = { waitForTimeout:async()=>{}, locator:()=>({ hover:async()=>{ hover += 1; }, click:async()=>{ click += 1; } }) };
  const indicator = { moveToPoint:async()=>{} };
  await observeAds({ page, ads:[{ selectorHint:'#ad', rect:{x:20,y:20,width:300,height:250}, text:'Advertisement' }], indicator, budgetMs:400 });
  assert.equal(hover, 0);
  assert.equal(click, 0);
});

test('long ad-observation budgets dwell for a few seconds on a visible ad boundary', async () => {
  const result = await observeAds({
    page:{ waitForTimeout:async()=>{} },
    ads:[{ selectorHint:'#ad-long', rect:{x:20,y:20,width:300,height:250}, text:'Advertisement' }],
    indicator:{ moveToPoint:async()=>{} },
    budgetMs:5000,
  });
  assert.ok(result.ads[0].dwellMs >= 2000);
});
