const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const read=r=>fs.readFileSync(path.join(__dirname,'..',r),'utf8');
test('Run Center bulk controls are scoped to the selected lane',()=>{const ui=read('src/pages/RunCenter.tsx'),main=read('electron/main.cjs'),preload=read('electron/preload.cjs');assert.match(ui,/stopAllQaRuns\?\.\(activeLane\)/);assert.match(ui,/bulkDeleteQaRuns\?\.\(pendingBulkDelete, activeLane\)/);assert.match(ui,/Stop All \$\{laneLabel\}/);assert.match(main,/kind==='social'/);assert.match(main,/kind==='test'\|\|kind==='streaming'/);assert.match(preload,/stopAllQaRuns: \(runKind\)/);assert.match(preload,/bulkDeleteQaRuns: \(scope, runKind\)/);});
test('Run Center exposes lane-scoped automation for test, streaming and social tabs',()=>{const ui=read('src/pages/RunCenter.tsx');assert.doesNotMatch(ui,/activeLane === 'test' &&/);assert.match(ui,/getAutoRerunState\?\.\(activeLane\)/);assert.match(ui,/getStuckRunRecoveryState\?\.\(activeLane\)/);});
test('Social media observation pauses playback at the allocated hard deadline',()=>{const s=read('electron/social/social-runner.cjs');assert.match(s,/observationDeadline=observationStartedAt\+targetMs/);assert.match(s,/Date\.now\(\)<observationDeadline/);assert.match(s,/el\.pause\?\.\(\)/);assert.match(s,/await pauseVisibleMedia\(currentPage\)/);assert.match(s,/Media observation window completed at the allocated/);});

test('media observation reaches configured playback time and pauses the media element',async()=>{
  const { _test }=require('./social/social-runner.cjs');
  let paused=false;const started=Date.now();
  const media={first(){return this},async isVisible(){return true},async evaluate(fn){const currentTime=paused?Math.max(0,(Date.now()-started)/1000):Math.max(.01,(Date.now()-started)/1000);const el={paused,ended:false,readyState:4,currentTime,play(){paused=false;return Promise.resolve()},pause(){paused=true}};return fn(el);}};
  const hidden={first(){return this},nth(){return this},async isVisible(){return false},async count(){return 0},async innerText(){return ''},async getAttribute(){return ''}};
  const page={locator(sel){if(sel==='video,audio')return media;return hidden},getByRole(){return hidden},async evaluate(){}};
  const result=await _test.mediaQa(page,1,new AbortController().signal,{interactionMode:'cursor'});
  const elapsed=Date.now()-started;
  assert.equal(result.status,'PASS');assert.ok(result.activeSeconds>=.95&&result.activeSeconds<=1.05,`active=${result.activeSeconds}`);assert.equal(paused,true);assert.ok(elapsed<1600,`wall elapsed ${elapsed}ms`);
});
