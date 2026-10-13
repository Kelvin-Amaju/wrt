const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pkg=require('../package.json');

const library=fs.readFileSync('src/components/StreamingRunLibraryPanel.tsx','utf8');
const checks=fs.readFileSync('src/components/StreamingChecksPanel.tsx','utf8');
const hub=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
const runCenter=fs.readFileSync('src/pages/RunCenter.tsx','utf8');
const worker=fs.readFileSync('electron/streaming/streaming-session-worker.cjs','utf8');
const browserFactory=fs.readFileSync('electron/streaming/streaming-browser-factory.cjs','utf8');
const policy=fs.readFileSync('electron/streaming/supported-browser-policy.cjs','utf8');
const runner=fs.readFileSync('electron/streaming/streaming-runner.cjs','utf8');

test('current release preserves v0.19.2 streaming QA reliability behavior',()=>{
  const parts=pkg.version.split('.').map(Number);
  assert.ok(parts[0]>0||parts[1]>19||(parts[1]===19&&parts[2]>=2),`expected version >= 0.19.2, got ${pkg.version}`);
});

test('QA Music Selection is collapsible and collection rows render on demand',()=>{
  assert.match(library,/listOpen/);
  assert.match(library,/SHOW SONG LIST/);
  assert.match(library,/HIDE SONG LIST/);
  assert.match(library,/expandedCollections/);
  assert.match(library,/SHOW SONGS/);
  assert.match(library,/COLLAPSE/);
});

test('pause QA is optional, random and duration-bound',()=>{
  assert.match(checks,/Random pause then resume/);
  assert.match(worker,/randomPauseVisit/);
  assert.match(worker,/randomPauseOffsetMs/);
  assert.match(worker,/configuredMs=Math\.max\(500,Math\.min\(3000/);
  assert.match(worker,/\(visits\+1\)===pauseVisit/);
});

test('valid QA playback is based on full active selected-track observation',()=>{
  assert.match(worker,/observeVerifiedPlayback/);
  assert.match(worker,/activePlaybackMs/);
  assert.match(worker,/selectedTrackReady/);
  assert.match(runner,/validQaPlaybacks/);
  assert.match(runner,/invalidQaPlaybacks/);
  assert.match(runner,/COMPLETED PLAY/);
  assert.match(runCenter,/Completed plays \(QA\)/);
});

test('mobile mode uses installed Chromium and the durable account profile with device viewport/touch emulation',()=>{
  assert.match(policy,/deviceMode==='ios'[\s\S]*engine:'chromium'/);
  assert.match(policy,/deviceMode==='android'[\s\S]*engine:'chromium'/);
  assert.match(browserFactory,/shouldUsePersistentProfile=Boolean\(usePersistentProfile&&profileDir/);
  assert.match(browserFactory,/isMobile:profile\.isMobile/);
  assert.match(browserFactory,/hasTouch:profile\.hasTouch/);
});

test('streaming UI defaults remain lightweight',()=>{
  assert.match(hub,/MAX_LIVE_ACTIVITY\s*=\s*120/);
  assert.match(hub,/captureScreenshots[^\n]*false/);
});
