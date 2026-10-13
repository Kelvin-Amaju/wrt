const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRunStore } = require('./run-store.cjs');
const { createRunRegistry } = require('./run-registry.cjs');

function root() { return fs.mkdtempSync(path.join(os.tmpdir(), 'orbitqa-recovery-')); }
function config() { return { version:3, urlPool:['https://example.com'], devices:{ desktop:{enabled:true,browsers:['chromium'],instancesPerBrowser:1}}, concurrency:{mode:'manual',value:1}, executionMode:'visible' }; }
function wait(ms=15){return new Promise(r=>setTimeout(r,ms));}

test('active runs pause on shutdown and resume from persisted state', async () => {
  const dir=root();
  const store=createRunStore({userDataPath:dir});
  let started=0;
  const executeRun=({signal})=>new Promise((resolve)=>{ started++; signal.addEventListener('abort',resolve,{once:true}); });
  const first=createRunRegistry({runStore:store,executeRun});
  const {runId}=await first.createRun(config()); await wait();
  await first.pauseAllForShutdown();
  assert.equal(first.getRun(runId).status,'PAUSED');
  const second=createRunRegistry({runStore:createRunStore({userDataPath:dir}),executeRun});
  const res=await second.resumePersistedRuns(); await wait();
  assert.equal(res.resumed,1);
  assert.equal(second.getRun(runId).status,'RUNNING');
  await second.stopRun(runId);
});

test('terminal runs never auto resume', async () => {
  const dir=root();
  const store=createRunStore({userDataPath:dir});
  const executeRun=async()=>{};
  const first=createRunRegistry({runStore:store,executeRun});
  const {runId}=await first.createRun(config()); await wait(25);
  assert.equal(first.getRun(runId).status,'COMPLETED');
  const second=createRunRegistry({runStore:createRunStore({userDataPath:dir}),executeRun});
  const res=await second.resumePersistedRuns();
  assert.equal(res.resumed,0);
});

test('pause retains completed terminal work and makes in-flight work restartable', async () => {
  const dir=root();
  const store=createRunStore({userDataPath:dir});
  const executeRun=({runId,signal,emit})=>new Promise((resolve)=>{
    emit({type:'session-complete',runId,timestamp:new Date().toISOString(),workId:'done-1',status:'completed'});
    emit({type:'session-start',runId,timestamp:new Date().toISOString(),workId:'active-1',status:'running'});
    signal.addEventListener('abort',resolve,{once:true});
  });
  const registry=createRunRegistry({runStore:store,executeRun});
  const {runId}=await registry.createRun(config()); await wait();
  await registry.pauseRun(runId);
  const persisted=store.get(runId);
  assert.ok(persisted.checkpoint.terminalWorkIds.includes('done-1'));
  assert.ok(persisted.checkpoint.inFlightWorkIds.includes('active-1'));
  assert.equal(persisted.summary.status,'PAUSED');
});

test('multiple paused runs resume independently while stopped/completed runs stay terminal', async () => {
  const dir=root();
  const store=createRunStore({userDataPath:dir});
  const running=new Map();
  const executeRun=({runId,signal})=>new Promise(resolve=>{ running.set(runId,true); signal.addEventListener('abort',resolve,{once:true}); });
  const first=createRunRegistry({runStore:store,executeRun});
  const a=await first.createRun({...config(),urlPool:['https://a.example']});
  const b=await first.createRun({...config(),urlPool:['https://b.example']});
  await wait();
  await first.pauseRun(a.runId);
  await first.pauseRun(b.runId);
  const terminalStore=createRunStore({userDataPath:dir});
  const now=new Date().toISOString();
  terminalStore.save({schemaVersion:1,summary:{runId:'RUN-STOPPED',createdAt:now,updatedAt:now,status:'STOPPED',executionMode:'visible',requestedConcurrency:1,targetSummary:'stopped',deviceFamilies:[],counters:{requested:1,running:0,queued:0,completed:0,failed:0,cancelled:1,incomplete:0}},config:config(),checkpoint:{nextWorkOrdinal:0,terminalWorkIds:[],inFlightWorkIds:[]},logs:[],results:{},lastCheckpointAt:now});
  const second=createRunRegistry({runStore:terminalStore,executeRun});
  const res=await second.resumePersistedRuns();
  await wait();
  assert.equal(res.resumed,2);
  assert.equal(second.getRun(a.runId).status,'RUNNING');
  assert.equal(second.getRun(b.runId).status,'RUNNING');
  assert.equal(second.getRun('RUN-STOPPED').status,'STOPPED');
  await second.stopAllRuns();
});
