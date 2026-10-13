const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=(rel)=>fs.readFileSync(path.join(root,rel),'utf8');

test('v0.21.8 Run Center exposes automation and recovery on every lane',()=>{
  const ui=read('src/pages/RunCenter.tsx');
  assert.doesNotMatch(ui,/activeLane === 'test' &&/);
  assert.match(ui,/getAutoRerunState\?\.\(activeLane\)/);
  assert.match(ui,/getStuckRunRecoveryState\?\.\(activeLane\)/);
  assert.match(ui,/configureAutoRerun\?\.\(patch, activeLane\)/);
  assert.match(ui,/configureStuckRunRecovery\?\.\(patch, activeLane\)/);
});

test('lane automation keeps streaming and social selections independent',async()=>{
  const {createLaneAutomationManager}=require('./lane-automation-manager.cjs');
  let rows=[
    {runId:'S1',runKind:'streaming',status:'COMPLETED',updatedAt:'1',attemptCount:1},
    {runId:'X1',runKind:'social',status:'COMPLETED',updatedAt:'1',attemptCount:1},
  ];
  const reruns=[];
  const manager=createLaneAutomationManager({
    listRuns:()=>rows,
    rerunRun:async(kind,id)=>{reruns.push([kind,id]);const r=rows.find(x=>x.runId===id);r.status='RUNNING';r.updatedAt=String(Number(r.updatedAt)+1);r.attemptCount++;return {rerun:true};},
    stopRun:async()=>({stopped:true}),
    clock:{now:()=>1000,setInterval:()=>0,clearInterval:()=>{}},
  });
  manager.configureAuto('streaming',{enabled:true,selectedRunIds:['S1']});
  manager.configureAuto('social',{enabled:true,selectedRunIds:['X1']});
  assert.deepEqual(manager.getAuto('streaming').selectedRunIds,['S1']);
  assert.deepEqual(manager.getAuto('social').selectedRunIds,['X1']);
  await manager.tick();
  assert.deepEqual(reruns.sort(),[['social','X1'],['streaming','S1']].sort());
  manager.stop();
});

test('social rerun snapshot and lane-aware IPC are packaged in main process',()=>{
  const main=read('electron/main.cjs');
  assert.match(main,/rerunSocialForCenter/);
  assert.match(main,/requestSnapshot/);
  assert.match(main,/qa:getAutoRerunState/);
  assert.match(main,/laneAutomationManager\?\.getAuto/);
  assert.match(main,/laneAutomationManager\?\.getRecovery/);
});

test('social media observation uses active wall-clock samples and always pauses media',()=>{
  const runner=read('electron/social/social-runner.cjs');
  assert.match(runner,/previousIntervalWasActive=playingNow&&!adNow/);
  assert.match(runner,/nowMs-lastTickAt/);
  assert.match(runner,/await pauseVisibleMedia\(currentPage\)/);
  assert.match(runner,/observationDeadline=observationStartedAt\+targetMs/);
  assert.match(runner,/onProgress/);
});
