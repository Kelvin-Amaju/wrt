const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createRunStore}=require('../run-store.cjs');
const {createRunRegistry}=require('../run-registry.cjs');
const wait=(ms=25)=>new Promise(r=>setTimeout(r,ms));
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'orbitqa-stream-reg-'));
function streamingConfig(){return {runKind:'streaming',platform:'spotify',collectionIds:[],trackIds:['t1','t2'],inlineTracks:[{id:'t1',platform:'spotify',title:'A',url:'https://open.spotify.com/track/t1'},{id:'t2',platform:'spotify',title:'B',url:'https://open.spotify.com/track/t2'}],accountIds:['a1','a2'],slots:2,observation:{minSeconds:2,maxSeconds:3},queueMode:'shuffle',playbackSpeed:1,restAfterTracks:0,restMinutes:0,checks:['playback'],executionMode:'background',captureScreenshots:false,requestedWorkUnits:4,concurrency:{mode:'manual',value:2}};}
test('registry dispatches streaming executor and preserves compact streaming summary/history',async()=>{
 const store=createRunStore({userDataPath:temp()}); let calls=0;
 const registry=createRunRegistry({runStore:store,executeRun:async()=>{},executeStreamingRun:async({emit})=>{calls++;emit({type:'streaming-summary',streamingSummary:{platform:'spotify',slots:2,accounts:2,tracks:2,queueMode:'shuffle',observation:{minSeconds:2,maxSeconds:3},completed:4,failed:0},metrics:{requested:4,running:0,queued:0,completed:4,failed:0,cancelled:0,incomplete:0}});}});
 const created=await registry.createRun(streamingConfig()); await wait();
 const detail=registry.getRun(created.runId);
 assert.equal(calls,1); assert.equal(detail.status,'COMPLETED'); assert.equal(detail.runKind,'streaming'); assert.equal(detail.streamingMeta.accounts,2); assert.equal(detail.streamingSummary.queueMode,'shuffle');
 const rerun=await registry.rerunRun(created.runId); assert.equal(rerun.runId,created.runId); await wait(); assert.equal(registry.listRuns().length,1); assert.equal(registry.getRun(created.runId).runKind,'streaming'); assert.equal(registry.getRun(created.runId).status,'COMPLETED'); assert.equal(registry.getRun(created.runId).attemptCount,2);
});

test('persisted streaming run config contains account references but no authentication secrets',async()=>{
 const dir=temp(); const store=createRunStore({userDataPath:dir});
 const registry=createRunRegistry({runStore:store,executeRun:async()=>{},executeStreamingRun:async()=>{}});
 const config=streamingConfig(); const run=await registry.createRun(config); await wait();
 const serialized=JSON.stringify(store.get(run.runId));
 assert.match(serialized,/"accountIds"/); assert.doesNotMatch(serialized,/password|sessionSecret|sp_dc|cookieValue/i);
});
