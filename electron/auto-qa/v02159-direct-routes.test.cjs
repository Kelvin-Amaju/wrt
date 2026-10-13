const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { navigateDirectRandomized, humanDelayMs, runPowerShellAddressTyping } = require('./direct-navigation.cjs');
const { navigateWithReferrerQa } = require('./referrer-navigation.cjs');

function fakePage(initial='about:blank') {
  let current=initial;
  const calls=[];
  return {
    calls,
    url:()=>current,
    goto:async(url)=>{ calls.push(['goto',url]); current=url; },
    waitForTimeout:async()=>{},
    setUrl:(url)=>{ current=url; },
  };
}

test('v0.21.61 Direct Auto Type OFF always uses normal direct navigation even when RNG selects typed side', async()=>{
  const page=fakePage();
  let typedCalls=0;
  const result=await navigateDirectRandomized({page,targetUrl:'https://example.com/path',autoType:false,random:()=>0.99,log:()=>{},nativeNavigateImpl:async()=>{typedCalls++;return {ok:true}}});
  assert.equal(result.directRoute,'direct-navigation');
  assert.equal(typedCalls,0);
  assert.deepEqual(page.calls,[['goto','https://example.com/path']]);
});

test('v0.21.61 Direct Auto Type ON can randomly use normal direct navigation', async()=>{
  const page=fakePage();
  const result=await navigateDirectRandomized({page,targetUrl:'https://example.com/path',autoType:true,random:()=>0.1,log:()=>{}});
  assert.equal(result.directRoute,'direct-navigation');
  assert.deepEqual(page.calls,[['goto','https://example.com/path']]);
});

test('v0.21.61 Direct Auto Type ON can use real address-bar route', async()=>{
  const page=fakePage();
  let typedArgs=null;
  const result=await navigateDirectRandomized({
    page,targetUrl:'https://example.com/path',autoType:true,random:()=>0.9,log:()=>{},
    nativeNavigateImpl:async(args)=>{ typedArgs=args; page.setUrl(args.targetUrl); return {ok:true,finalUrl:args.targetUrl}; },
  });
  assert.equal(result.directRoute,'typed-address-bar');
  assert.equal(typedArgs.page,page);
  assert.equal(typedArgs.targetUrl,'https://example.com/path');
});

test('v0.21.61 unsafe/unavailable address-bar route falls back to normal direct navigation, never a fake entry page', async()=>{
  const page=fakePage();
  const result=await navigateDirectRandomized({
    page,targetUrl:'https://example.com/path',autoType:true,random:()=>0.9,log:()=>{},
    nativeNavigateImpl:async()=>({ok:false,reason:'worker browser lost foreground focus'}),
  });
  assert.equal(result.directRoute,'direct-navigation-fallback');
  assert.deepEqual(page.calls,[['goto','https://example.com/path']]);
});

test('v0.21.61 Referrer QA passes Direct Auto Type choice into routing', async()=>{
  const page=fakePage();
  let typed=0;
  const off=await navigateWithReferrerQa({
    page,targetUrl:'https://example.com/',autoQa:{referrerMode:'direct',directAutoType:false},random:()=>0.9,log:()=>{},
    nativeDirectNavigate:async()=>{typed++;return {ok:true,finalUrl:'https://example.com/'};},
  });
  assert.equal(off.directRoute,'direct-navigation');
  assert.equal(typed,0);

  page.setUrl('about:blank'); page.calls.length=0;
  const on=await navigateWithReferrerQa({
    page,targetUrl:'https://example.com/',autoQa:{referrerMode:'direct',directAutoType:true},random:()=>0.9,log:()=>{},
    nativeDirectNavigate:async({targetUrl})=>{typed++; page.setUrl(targetUrl); return {ok:true,finalUrl:targetUrl};},
  });
  assert.equal(on.directRoute,'typed-address-bar');
  assert.equal(typed,1);
});

test('v0.21.61 human typing delay is deliberately slower and bounded',()=>{
  assert.equal(humanDelayMs(()=>0),95);
  assert.equal(humanDelayMs(()=>0.999999),170);
});

test('v0.21.61 fake OrbitQA Direct Entry page is removed from implementation',()=>{
  const source=fs.readFileSync(path.join(__dirname,'direct-navigation.cjs'),'utf8');
  assert.doesNotMatch(source,/OrbitQA Direct Entry|orbitqa-direct-target|setContent\s*\(/);
  assert.match(source,/GetForegroundWindow/);
  assert.match(source,/FOCUS_LOST/);
  assert.match(source,/SendWait\('\^l'\)/);
});

test('v0.21.61 native helper refuses non-Windows environments rather than inventing a browser input',async()=>{
  if(process.platform==='win32') return;
  const result=await runPowerShellAddressTyping({titleToken:'x',targetUrl:'https://example.com'});
  assert.equal(result.ok,false);
  assert.match(result.reason,/Windows-only/i);
});
