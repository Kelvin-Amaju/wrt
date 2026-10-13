const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {backgroundWindowArgs,concealBackgroundWorkerWindow}=require('./background-window.cjs');
const {navigateDirectRandomized}=require('./auto-qa/direct-navigation.cjs');

test('background Chromium remains headed but launches off-screen for invisible containment',()=>{
  assert.deepEqual(backgroundWindowArgs({browserEngine:'chromium',executionMode:'background'}),['--window-position=-32000,-32000','--window-size=1280,720']);
  assert.deepEqual(backgroundWindowArgs({browserEngine:'chromium',executionMode:'visible'}),[]);
  assert.deepEqual(backgroundWindowArgs({browserEngine:'webkit',executionMode:'background'}),[]);
});

test('Windows conceal helper uses SW_HIDE and exact unique title matching',()=>{
  const src=fs.readFileSync('electron/background-window.cjs','utf8');
  assert.match(src,/ShowWindowAsync\(\$found,0\)/);
  assert.match(src,/WINDOW_MATCH_COUNT/);
  assert.match(src,/document\.title=title/);
  assert.match(src,/--window-position=-32000,-32000/);
});

test('background Direct never foregrounds native omnibox and stays invisible',async()=>{
  const gotos=[];let nativeCalls=0;
  const page={goto:async(u)=>gotos.push(u),url:()=>gotos.at(-1)||'about:blank'};
  const result=await navigateDirectRandomized({page,targetUrl:'https://example.com/',executionMode:'background',autoType:true,random:()=>0.99,nativeNavigateImpl:async()=>{nativeCalls++;return{ok:true,finalUrl:'https://example.com/'}}});
  assert.equal(nativeCalls,0);
  assert.equal(result.directRoute,'background-direct-navigation');
  assert.deepEqual(gotos,['https://example.com/']);
});

test('full-speed anti-throttling policy stays active alongside concealment for QA and Streaming/Social',()=>{
  const qa=fs.readFileSync('electron/qa-runner.cjs','utf8');
  const stream=fs.readFileSync('electron/streaming/streaming-browser-factory.cjs','utf8');
  for(const flag of ['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','CalculateNativeWinOcclusion']){
    assert.match(qa,new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
  assert.match(qa,/concealBackgroundWorkerWindow/);
  assert.match(stream,/concealBackgroundWorkerWindow/);
  assert.match(stream,/const runtimeHeadless = false/);
});
