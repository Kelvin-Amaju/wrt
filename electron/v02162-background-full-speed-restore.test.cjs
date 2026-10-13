const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {resolveRunHeadless}=require('./qa-runner.cjs');

test('background execution never switches local QA to headless',()=>{
  assert.equal(resolveRunHeadless('background',false),false);
  assert.equal(resolveRunHeadless('background',true),false);
});

test('general QA background Chromium starts minimized with anti-throttling protections',()=>{
  const src=fs.readFileSync('electron/qa-runner.cjs','utf8');
  for(const flag of ['--start-minimized','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','CalculateNativeWinOcclusion']) assert.match(src,new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(src,/executionMode === 'background'[\s\S]{0,120}return false/);
});

test('Streaming and Social shared browser factory keep background renderer headed',()=>{
  const src=fs.readFileSync('electron/streaming/streaming-browser-factory.cjs','utf8');
  assert.match(src,/const runtimeHeadless = false/);
  assert.match(src,/chromiumBackground[^\n]*executionMode==='background'/);
  assert.match(src,/backgroundWindowArgs[^\n]*--start-minimized/);
});

test('renderer source no longer maps Background Activity to headless',()=>{
  const shared=fs.readFileSync('src/shared/qaMatrix.ts','utf8');
  const testRuns=fs.readFileSync('src/pages/Run.tsx','utf8');
  assert.match(shared,/executionMode === 'background' \? false : input\.headless === true/);
  assert.doesNotMatch(testRuns,/executionMode === 'background';/);
});
