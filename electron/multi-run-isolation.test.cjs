const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRunStore } = require('./run-store.cjs');
const { createRunRegistry } = require('./run-registry.cjs');
function root(){return fs.mkdtempSync(path.join(os.tmpdir(),'orbitqa-isolation-'));}
function cfg(label){return {version:3,urlPool:[`https://${label}.example`],devices:{desktop:{enabled:true,browsers:['chromium'],instancesPerBrowser:1}},concurrency:{mode:'manual',value:1},executionMode:'visible'};}
function wait(ms=15){return new Promise(r=>setTimeout(r,ms));}

test('one run failure does not abort unrelated runs', async()=>{
  const store=createRunStore({userDataPath:root()});
  const executeRun=({runId,request,signal})=> request.urlPool[0].includes('fail') ? Promise.reject(new Error('boom')) : new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));
  const reg=createRunRegistry({runStore:store,executeRun});
  const a=await reg.createRun(cfg('fail')); const b=await reg.createRun(cfg('good')); await wait(30);
  assert.equal(reg.getRun(a.runId).status,'FAILED');
  assert.equal(reg.getRun(b.runId).status,'RUNNING');
  await reg.stopRun(b.runId);
});

test('stop all stops every non-terminal run', async()=>{
  const reg=createRunRegistry({runStore:createRunStore({userDataPath:root()}),executeRun:({signal})=>new Promise(r=>signal.addEventListener('abort',r,{once:true}))});
  const a=await reg.createRun(cfg('a')); const b=await reg.createRun(cfg('b')); await wait();
  const result=await reg.stopAllRuns();
  assert.equal(result.stopped,2);
  assert.equal(reg.getRun(a.runId).status,'STOPPED');
  assert.equal(reg.getRun(b.runId).status,'STOPPED');
});
