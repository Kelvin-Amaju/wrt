const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const {normalizeGroupPlans,executeStreamingRun}=require('./streaming/streaming-runner.cjs');
const {sanitizeStreamingRunRequest}=require('./streaming/streaming-run-preparer.cjs');

test('Streaming UI has one group-centric configuration system and no global duplicate Intelligence panel',()=>{
  const hub=read('src/pages/StreamingHub.tsx');
  const groups=read('src/components/StreamingGroupPlanPanel.tsx');
  const html=read('dist/index.html');
  assert.doesNotMatch(hub,/<ContentIntelligencePanel/);
  assert.doesNotMatch(hub,/<details[^>]*>\s*<summary>PLAYBACK ENGINE &amp; SAFE QA CHECKS/);
  assert.match(groups,/This group owns its Playback Engine and Safe QA Checks/);
  assert.match(groups,/normalQa/);
  assert.doesNotMatch(html,/intelligence-layer\.js/);
});

test('Social UI is group-first and normal groups own QA Checks while Intelligence groups use their own settings',()=>{
  const hub=read('src/pages/SocialHub.tsx');
  const groups=read('src/components/SocialGroupPlanPanel.tsx');
  assert.doesNotMatch(hub,/<ContentIntelligencePanel/);
  assert.match(hub,/Group-first Social QA/);
  assert.match(groups,/Normal Social QA/);
  assert.match(groups,/QA Checks/);
  assert.match(groups,/Content Intelligence · Independent observation/);
});

test('sanitizer persists normal per-group playback and QA settings',()=>{
  const out=sanitizeStreamingRunRequest({platform:'spotify',accountIds:['a1'],groupPlans:[{groupId:'G1',accountIds:['a1'],trackMode:'all',normalQa:{observation:{minSeconds:21,maxSeconds:44},queueMode:'shuffle',checks:['playback','pause-resume'],pauseResumeSeconds:1.5,volumeDirection:'increase',executionMode:'background',muteAudio:true,captureScreenshots:true,deviceMode:'android',deviceProfile:'Pixel 11',restAfterTracks:2,restMinutes:3}}]});
  const cfg=out.groupPlans[0].normalQa;
  assert.deepEqual(cfg.observation,{minSeconds:21,maxSeconds:44});
  assert.equal(cfg.queueMode,'shuffle');
  assert.deepEqual(cfg.checks,['playback','pause-resume']);
  assert.equal(cfg.executionMode,'background');
  assert.equal(cfg.deviceMode,'android');
  assert.equal(cfg.muteAudio,true);
});

test('runner forwards different normal QA settings to different non-Intelligence groups',async()=>{
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'u1'},{id:'t2',url:'u2'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',proxySource:'none'})};
  const seen=[];
  await executeStreamingRun({
    runId:'R-group-normal',
    request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1','t2'],accountIds:['a1','a2'],observation:{minSeconds:99,maxSeconds:99},checks:['playback'],executionMode:'visible',deviceMode:'desktop',groupPlans:[
      {groupId:'G1',accountIds:['a1'],trackMode:'all',contentIntelligence:{enabled:false},normalQa:{observation:{minSeconds:11,maxSeconds:12},queueMode:'shuffle',checks:['playback','pause-resume'],pauseResumeSeconds:1,volumeDirection:'increase',executionMode:'background',deviceMode:'android',deviceProfile:'Pixel 11',restAfterTracks:1,restMinutes:2,muteAudio:true,captureScreenshots:false}},
      {groupId:'G2',accountIds:['a2'],trackMode:'all',contentIntelligence:{enabled:false},normalQa:{observation:{minSeconds:31,maxSeconds:32},queueMode:'sequential',checks:['playback','volume-control'],pauseResumeSeconds:2,volumeDirection:'decrease',executionMode:'visible',deviceMode:'ios',deviceProfile:'iPhone 18 Pro',restAfterTracks:3,restMinutes:4,muteAudio:false,captureScreenshots:false}},
    ]},
    emit:()=>{},signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},
    runSession:async payload=>{seen.push({groupId:payload.workUnit.groupId,observation:payload.observation,checks:payload.checks,queueMode:payload.queueMode,pause:payload.pauseResumeSeconds,volume:payload.volumeDirection,execution:payload.workUnit.executionMode,device:payload.workUnit.deviceMode,mute:payload.workUnit.muteAudio,restAfterTracks:payload.restAfterTracks,restMinutes:payload.restMinutes});return {reason:'visit-limit',trackVisits:1};},checkpoint:{terminalWorkIds:[]},
  });
  assert.deepEqual(seen.map(x=>x.groupId),['G1','G2']);
  assert.deepEqual(seen[0].observation,{minSeconds:11,maxSeconds:12});
  assert.equal(seen[0].queueMode,'shuffle');assert.equal(seen[0].execution,'background');assert.equal(seen[0].device,'android');assert.equal(seen[0].mute,true);assert.equal(seen[0].pause,1);assert.equal(seen[0].volume,'increase');
  assert.deepEqual(seen[1].observation,{minSeconds:31,maxSeconds:32});
  assert.equal(seen[1].queueMode,'sequential');assert.equal(seen[1].execution,'visible');assert.equal(seen[1].device,'ios');assert.equal(seen[1].mute,false);assert.equal(seen[1].volume,'decrease');
});

test('Intelligence group ignores its normal QA checks and stays on Intelligence playback path',()=>{
  const groups=normalizeGroupPlans({accountIds:['a1'],checks:['playback','pause-resume'],contentIntelligence:{enabled:false},groupPlans:[{groupId:'Intel',accountIds:['a1'],trackMode:'all',contentIntelligence:{enabled:true,maxPerSongSeconds:77},normalQa:{checks:['playback','volume-control'],observation:{minSeconds:999,maxSeconds:999},executionMode:'background'}}]},[{id:'t1'}]);
  assert.equal(groups[0].contentIntelligence.enabled,true);
  assert.equal(groups[0].contentIntelligence.maxPerSongSeconds,77);
});
