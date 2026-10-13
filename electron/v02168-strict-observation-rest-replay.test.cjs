const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {observeVerifiedPlayback}=require('./streaming/streaming-session-worker.cjs');

test('v0.21.68 streaming observation uses one wall-clock deadline and stops at ceiling',async()=>{
  const realNow=Date.now;let now=1000;Date.now=()=>now;let pauses=0;
  try{
    const page={isClosed:()=>false,url:()=> 'https://open.spotify.com/track/a',evaluate:async()=>true};
    const controls={isPlaying:async()=>({status:'PASS'}),pause:async()=>{pauses++;return{status:'PASS'};},play:async()=>({status:'PASS'})};
    const adapter={selectedTrackReady:async()=>true};
    const sleep=async ms=>{now+=ms;};
    const out=await observeVerifiedPlayback({page,controls,track:{id:'a',title:'A'},adapter,signal:new AbortController().signal,sleep,targetSeconds:2,log:()=>{},workId:'w'});
    assert.equal(out.status,'PASS');assert.equal(out.elapsedPlaybackMs,2000);assert.ok(pauses>=1);
  }finally{Date.now=realNow;}
});

test('v0.21.68 unexpected song is stopped and selected song restored without resetting deadline',async()=>{
  const realNow=Date.now;let now=1000;Date.now=()=>now;let readyCalls=0,locates=0,pauses=0;
  try{
    const page={isClosed:()=>false,url:()=> 'https://open.spotify.com/track/a',evaluate:async()=>true};
    const controls={isPlaying:async()=>({status:'PASS'}),pause:async()=>{pauses++;return{status:'PASS'};},play:async()=>({status:'PASS'})};
    const adapter={selectedTrackReady:async()=>{readyCalls++;return readyCalls!==2;},locateTrack:async()=>{locates++;return{status:'PASS'};}};
    const sleep=async ms=>{now+=ms;};
    const out=await observeVerifiedPlayback({page,controls,track:{id:'a',title:'A'},adapter,signal:new AbortController().signal,sleep,targetSeconds:2,log:()=>{},workId:'w'});
    assert.equal(out.status,'PASS');assert.equal(out.elapsedPlaybackMs,2000);assert.equal(locates,1);
  }finally{Date.now=realNow;}
});

test('v0.21.68 source contains independent Rest & Replay and worker identity revalidation contracts',()=>{
  const stream=fs.readFileSync(path.join(__dirname,'streaming/streaming-session-worker.cjs'),'utf8');
  const social=fs.readFileSync(path.join(__dirname,'social/social-runner.cjs'),'utf8');
  const factory=fs.readFileSync(path.join(__dirname,'streaming/streaming-browser-factory.cjs'),'utf8');
  assert.match(stream,/Rest & Replay: cycle complete/);assert.match(stream,/unexpected-media-blocked/);assert.match(stream,/revalidateWorkerIdentity/);
  assert.match(social,/restReplayEnabled/);assert.match(social,/Rest & Replay cycle/);assert.match(social,/revalidateWorkerIdentity/);
  assert.match(factory,/Proxy route, timezone and locale are consistent/);
});
