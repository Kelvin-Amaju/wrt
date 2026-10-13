const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
function read(rel){return fs.readFileSync(path.join(__dirname,'..',rel),'utf8');}
const main=read('electron/main.cjs');
const preload=read('electron/preload.cjs');
const app=read('src/App.tsx');
const sidebar=read('src/components/Sidebar.tsx');
const testRuns=read('src/pages/Run.tsx');
const runCenter=read('src/pages/RunCenter.tsx');
const runRegistry=read('electron/run-registry.cjs');

test('main and preload expose multi-run IPC without a single-active-run gate',()=>{
  for(const channel of ['qa:createRun','qa:listRuns','qa:getRun','qa:stopRun','qa:pauseRun','qa:resumeRun','qa:stopAllRuns']) assert.match(main,new RegExp(channel.replace(':','\\:')));
  for(const api of ['createQaRun','listQaRuns','getQaRun','stopQaRun','pauseQaRun','resumeQaRun','stopAllQaRuns']) assert.match(preload,new RegExp(api));
  assert.doesNotMatch(main,/A QA run is already active/);
  assert.doesNotMatch(main,/waitForStartSlot/);
  assert.match(main,/pauseAllForShutdown/);
  assert.match(main,/resumePersistedRuns/);
});

test('renderer contains Run Center and Test Runs remains a creation surface',()=>{
  assert.match(app,/RunCenter/);
  assert.match(sidebar,/Run Center/);
  assert.match(runCenter,/MULTI-RUN CONTROL/);
  assert.match(runCenter,/Stop All \${laneLabel}/);
  assert.match(testRuns,/createQaRun/);
  assert.match(testRuns,/Visible Desktop Activity/);
  assert.match(testRuns,/Background Activity/);
});

test('Run Center cards expose compact progress and sidebar badge counts only active execution states',()=>{
  const card=read('src/components/RunCard.tsx');
  assert.match(card,/run-card__progress/);
  assert.match(card,/progressPct/);
  assert.doesNotMatch(sidebar,/['\"]PAUSED['\"]/);
});

test('Run Center separates active and completed history with close, rerun, delete, and lazy history controls',()=>{
  const card=read('src/components/RunCard.tsx');
  assert.match(runCenter,/LIVE WORK/);
  assert.match(runCenter,/HISTORY/);
  assert.match(runCenter,/completedLimit/);
  assert.match(runCenter,/Load more/);
  assert.match(runCenter,/Close detail/);
  assert.match(runCenter,/Escape/);
  assert.match(card,/Run Again/);
  assert.match(card,/Delete/);
  assert.match(preload,/rerunQaRun/);
  assert.match(preload,/deleteQaRun/);
  assert.match(main,/qa:rerunRun/);
  assert.match(main,/qa:deleteRun/);
});

test('Run Detail summarizes Smart Mix rotating and static selections from run events',()=>{
  assert.match(runCenter,/Proxy Mix/);
  assert.match(runCenter,/Rotating sessions/);
  assert.match(runCenter,/Static sessions/);
  assert.match(runCenter,/detail\?\.proxyMix/);
});

test('Run Center exposes automatic rerun queue controls and selective bulk-delete controls',()=>{
  const card=read('src/components/RunCard.tsx');
  for(const channel of ['qa:getAutoRerunState','qa:configureAutoRerun','qa:bulkDeleteRuns']) assert.match(main,new RegExp(channel.replace(':','\\:')));
  for(const api of ['getAutoRerunState','configureAutoRerun','bulkDeleteQaRuns']) assert.match(preload,new RegExp(api));
  assert.match(runCenter,/Automatic Run Again/);
  assert.match(runCenter,/Completed only/);
  assert.match(runCenter,/All finished runs/);
  assert.match(runCenter,/Max simultaneous reruns/);
  assert.match(runCenter,/Select runs for Automatic Run Again/);
  assert.match(runCenter,/selectedRunIds/);
  assert.match(card,/Attempt/);
  assert.match(runCenter,/Delete Runs/);
  assert.match(runCenter,/Delete all Completed/);
  assert.match(runCenter,/Delete all Failed/);
  assert.match(runCenter,/Delete all Stopped/);
  assert.match(runCenter,/Delete Everything/);
  assert.match(card,/AUTO RUN AGAIN/);
});

test('automatic rerun scheduler yields to the Electron event loop between rerun cycles',()=>{
  assert.match(runRegistry,/setTimeout\(\(\) => \{ pumpAutoRerunQueue\(\)\.catch\(\(\) => \{\}\); \}, 0\)/);
  assert.doesNotMatch(runRegistry,/queueMicrotask\(\(\) => \{ pumpAutoRerunQueue/);
});


test('Run Center exposes lane-scoped stuck-run auto-recovery controls and IPC',()=>{
  for(const channel of ['qa:getStuckRunRecoveryState','qa:configureStuckRunRecovery']) assert.match(main,new RegExp(channel.replace(':','\:')));
  for(const api of ['getStuckRunRecoveryState','configureStuckRunRecovery']) assert.match(preload,new RegExp(api));
  assert.match(runCenter,/Stuck Run Auto-Recovery/);
  assert.match(runCenter,/Stuck timeout/);
  assert.match(runCenter,/Maximum recovery attempts/);
  assert.match(runCenter,/activeLane/);
  assert.match(main,/laneAutomationManager/);
  assert.match(runRegistry,/checkStuckRunsNow/);
});
