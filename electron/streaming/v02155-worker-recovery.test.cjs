const test=require('node:test');
const assert=require('node:assert/strict');
const {executeStreamingRun,_test}=require('./streaming-runner.cjs');

test('playback-start failure is recoverable while CAPTCHA/MFA remains manual attention',()=>{
  const playback=new Error('Playback did not start for the selected song after 16 attempts. Last reason: player stalled');playback.code='ORBITQA_STREAMING_PLAYBACK_START_FAILED';
  assert.equal(_test.recoverableStreamingWorkerError(playback),true);
  assert.equal(_test.recoverableStreamingWorkerError(new Error('Navigation timeout')),true);
  assert.equal(_test.recoverableStreamingWorkerError(new Error('CAPTCHA verification code required')),false);
  assert.equal(_test.manualAttentionStreamingError(new Error('MFA security challenge required')),true);
});

test('static proxy recovery retains account identity but excludes failed preferred static assignment',()=>{
  const account={id:'a1',platform:'spotify',proxySource:'static',staticProxyId:'proxy-old',sessionSecret:'secret'};
  const recovered=_test.streamingRecoveryAccount(account,1);
  assert.equal(recovered.id,'a1');assert.equal(recovered.sessionSecret,'secret');assert.equal(recovered.staticProxyId,'');assert.equal(account.staticProxyId,'proxy-old');
});

test('streaming worker resumes unfinished song and never repeats completed songs',async()=>{
  const tracks=[1,2,3,4].map(n=>({id:`s${n}`,title:`Song ${n}`,url:`https://music.test/s${n}`,platform:'spotify'}));
  const calls=[];const events=[];let attempt=0;
  const runSession=async opts=>{attempt++;calls.push({tracks:opts.tracks.map(t=>t.id),initial:opts.initialTrack?.id,max:opts.maxTrackVisits,account:opts.account});
    if(attempt===1){await opts.onTrackStart({track:tracks[0],visit:1});await opts.onTrackComplete({track:tracks[0],visit:1,activePlaybackMs:1000,observationSeconds:1});await opts.onTrackStart({track:tracks[1],visit:2});await opts.onTrackComplete({track:tracks[1],visit:2,activePlaybackMs:1000,observationSeconds:1});await opts.onTrackStart({track:tracks[2],visit:3});const e=new Error('Playback did not start for the selected song after 16 attempts. Last reason: stale player');e.code='ORBITQA_STREAMING_PLAYBACK_START_FAILED';throw e;}
    for(const [i,t] of opts.tracks.entries()){await opts.onTrackStart({track:t,visit:i+1});await opts.onTrackComplete({track:t,visit:i+1,activePlaybackMs:1000,observationSeconds:1});}
    return {reason:'visit-limit',trackVisits:opts.tracks.length};
  };
  const account={id:'a1',label:'A1',platform:'spotify',proxySource:'static',staticProxyId:'p-old'};
  const accountStore={getInternal:id=>id==='a1'?account:null,save:()=>{}};
  const collectionStore={listTracks:()=>tracks,listCollections:()=>[]};
  const adapterRegistry={get:()=>({})};
  const out=await executeStreamingRun({runId:'r1',request:{platform:'spotify',accountIds:['a1'],inlineTracks:tracks,trackIds:tracks.map(t=>t.id),trackCount:4,groups:[{id:'g1',accountIds:['a1'],trackCount:4}]},emit:e=>events.push(e),signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry,runSession,browserFactory:{},globalRunScheduler:null});
  assert.equal(out.failed,0);assert.equal(out.completed,1);assert.equal(calls.length,2);
  assert.deepEqual(calls[1].tracks,['s3','s4']);assert.equal(calls[1].initial,'s3');assert.equal(calls[1].account.id,'a1');assert.equal(calls[1].account.staticProxyId,'');
  assert.ok(events.some(e=>e.status==='RECOVERING'&&e.resumeTrackId==='s3'));
  assert.equal(out.validQaPlaybacks,4);
});
