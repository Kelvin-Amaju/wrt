const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const {normalizeContentIntelligence}=require('./content-intelligence.cjs');
const {normalizeGroupPlans,executeStreamingRun}=require('./streaming/streaming-runner.cjs');

test('v0.21.21 social comment inspection returns immediately to main content',()=>{
  const social=read('electron/social/social-runner.cjs');
  assert.match(social,/Comments are a brief inspection stop/);
  assert.match(social,/scrollIntoViewIfNeeded/);
  assert.match(social,/returnedToContent/);
  assert.match(social,/seekNudgeDone/);
});

test('v0.21.21 streaming intelligence exposes warmup per-song and repeat settings',()=>{
  const cfg=normalizeContentIntelligence({enabled:true,maxPerSongSeconds:77,streamingWarmupMaxSeconds:17,streamingRepeatMode:'each-song',repeatAllGroupCycles:3,groupRepeatCounts:[2,5]});
  assert.equal(cfg.maxPerSongSeconds,77);
  assert.equal(cfg.streamingWarmupMaxSeconds,17);
  assert.equal(cfg.streamingRepeatMode,'each-song');
  assert.equal(cfg.repeatAllGroupCycles,3);
  assert.deepEqual(cfg.groupRepeatCounts,[2,5]);
  const layer=read('dist/intelligence-layer.js');
  assert.match(layer,/Maximum per song/);
  assert.match(layer,/Platform warm-up max/);
  assert.match(layer,/Group cycles/);
  assert.match(layer,/Repeat all groups/);
});

test('group repeat counts are normalized from intelligence settings when group rows omit them',()=>{
  const groups=normalizeGroupPlans({accountIds:['a1','a2'],contentIntelligence:{enabled:true,groupRepeatCounts:[3,2]},groupPlans:[{groupId:'Group 1',accountIds:['a1'],trackMode:'all'},{groupId:'Group 2',accountIds:['a2'],trackMode:'all'}]},[{id:'t1'}]);
  assert.deepEqual(groups.map(g=>g.repeatCount),[3,2]);
});


test('manual Intelligence permissions gate social posting actions explicitly',()=>{
  const cfg=normalizeContentIntelligence({enabled:true,decisionMode:'manual',socialLikeAllowed:true,socialFollowAllowed:true,socialCommentAllowed:true,socialCommentDraft:'Useful video'});
  assert.equal(cfg.socialLikeAllowed,true);assert.equal(cfg.socialFollowAllowed,true);assert.equal(cfg.socialCommentAllowed,true);assert.equal(cfg.socialCommentDraft,'Useful video');
  const social=read('electron/social/social-runner.cjs');assert.match(social,/intelligence\.decisionMode==='manual'/);assert.match(social,/intelligence\.socialCommentAllowed/);
  const layer=read('dist/intelligence-layer.js');assert.match(layer,/Allow configured comment/);
});

test('streaming runner repeats group cycles and the full group sequence without overlapping group order',async()=>{
  const events=[];let calls=[];
  const request={platform:'spotify',accountIds:['a1','a2'],groupPlans:[{groupId:'Group 1',accountIds:['a1'],trackMode:'all',repeatCount:2},{groupId:'Group 2',accountIds:['a2'],trackMode:'all',repeatCount:1}],inlineTracks:[{id:'t1',platform:'spotify',title:'One',url:'https://open.spotify.com/track/t1'}],trackIds:['t1'],checks:['playback'],contentIntelligence:{enabled:true,repeatAllGroupCycles:2},observation:{minSeconds:1,maxSeconds:1},executionMode:'background'};
  const accountStore={getInternal:id=>({id,platform:'spotify',label:id,proxySource:'direct'}),save:()=>{}};
  const adapterRegistry={get:()=>({})};
  await executeStreamingRun({runId:'R',request,emit:e=>events.push(e),signal:new AbortController().signal,collectionStore:{get:()=>null},accountStore,adapterRegistry,browserFactory:{},runSession:async({account})=>{calls.push(account.id);return {reason:'visit-limit'};}});
  assert.deepEqual(calls,['a1','a1','a2','a1','a1','a2']);
});
