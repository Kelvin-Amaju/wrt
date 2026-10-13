const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {normalizeGroupPlans}=require('./streaming/streaming-runner.cjs');
const {normalizeContentIntelligence}=require('./content-intelligence.cjs');
const read=(p)=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('streaming groups keep independent Content Intelligence state',()=>{
  const groups=normalizeGroupPlans({accountIds:['a1','a2','a3'],contentIntelligence:{enabled:true,maxPerSongSeconds:999},groupPlans:[
    {groupId:'Group 1',accountIds:['a1'],trackMode:'all',contentIntelligence:{enabled:true,decisionMode:'auto',maxPerSongSeconds:77}},
    {groupId:'Group 2',accountIds:['a2'],trackMode:'all',contentIntelligence:{enabled:false}},
    {groupId:'Group 3',accountIds:['a3'],trackMode:'all',contentIntelligence:{enabled:true,decisionMode:'manual',streamingRandomWarmupTrack:false}},
  ]},[{id:'t1'}]);
  assert.equal(groups[0].contentIntelligence.enabled,true);
  assert.equal(groups[0].contentIntelligence.maxPerSongSeconds,77);
  assert.equal(groups[1].contentIntelligence.enabled,false);
  assert.equal(groups[2].contentIntelligence.enabled,true);
  assert.equal(groups[2].contentIntelligence.decisionMode,'manual');
});

test('streaming worker runs warm-up before selected-song loop only once per worker/group session',()=>{
  const source=read('electron/streaming/streaming-session-worker.cjs');
  const warmupCall=source.match(/if\(sessionIntelligence\.enabled\)await streamingIntelligenceWarmup/g)||[];
  assert.equal(warmupCall.length,1);
  const callAt=source.indexOf('if(sessionIntelligence.enabled)await streamingIntelligenceWarmup');
  const loopAt=source.indexOf('while(visits<visitLimit)',callAt);
  assert.ok(callAt>0&&loopAt>callAt);
});

test('auto streaming warm-up randomly chooses one or two songs while manual follows toggle',()=>{
  const source=read('electron/streaming/streaming-session-worker.cjs');
  assert.match(source,/decisionMode==='auto'\?\(Math\.random\(\)<0\.5\?1:2\)/);
  assert.match(source,/streamingRandomWarmupTrack\?1:0/);
  assert.match(source,/pausePageMedia\(page\)/);
});

test('group UIs expose independent intelligence controls for Streaming and Social',()=>{
  const streaming=read('src/components/StreamingGroupPlanPanel.tsx');
  const social=read('src/components/SocialGroupPlanPanel.tsx');
  assert.match(streaming,/Use Independent Content Observation for this group/);
  assert.match(streaming,/Allow one random warm-up song before selected songs/);
  assert.match(streaming,/Allow small volume changes during observation/);
  assert.match(streaming,/Allow creator \/ artist exploration/);
  assert.match(streaming,/Allow passive revisit \/ repeat observation/);
  assert.match(streaming,/Allow favorite \/ save track action/);
  assert.match(streaming,/Allow follow artist action/);
  assert.match(social,/Use Content Intelligence · Independent content observation for this group/);
  assert.match(social,/Normal QA tasks for this group/);
});

test('social saved groups persist their own content intelligence snapshot',()=>{
  const source=read('electron/social/group-store.cjs');
  assert.match(source,/contentIntelligence:\(input\.contentIntelligence\?\?existing\?\.contentIntelligence\)/);
  const runner=read('electron/social/social-runner.cjs');
  assert.match(runner,/normalizeContentIntelligence\(group\.contentIntelligence\|\|\{enabled:false\}\)/);
});

test('manual and auto normalization preserve listed manual switches',()=>{
  const manual=normalizeContentIntelligence({enabled:true,decisionMode:'manual',streamingRandomWarmupTrack:false,streamingVolumeVariation:false,creatorExploration:false,allowRepeat:false,streamingFavoriteAllowed:true,streamingFollowAllowed:true});
  assert.equal(manual.streamingRandomWarmupTrack,false);assert.equal(manual.streamingVolumeVariation,false);assert.equal(manual.creatorExploration,false);assert.equal(manual.allowRepeat,false);assert.equal(manual.streamingFavoriteAllowed,true);assert.equal(manual.streamingFollowAllowed,true);
  const auto=normalizeContentIntelligence({enabled:true,decisionMode:'auto'});assert.equal(auto.decisionMode,'auto');assert.equal(auto.enabled,true);
});

test('persisted groupConfigs feed old renderer group plans independently',()=>{
  const groups=normalizeGroupPlans({accountIds:['a1','a2'],contentIntelligence:{enabled:false,groupConfigs:[{enabled:true,maxPerSongSeconds:55},{enabled:false}]},groupPlans:[{groupId:'G1',accountIds:['a1'],trackMode:'all'},{groupId:'G2',accountIds:['a2'],trackMode:'all'}]},[{id:'t1'}]);
  assert.equal(groups[0].contentIntelligence.enabled,true);assert.equal(groups[0].contentIntelligence.maxPerSongSeconds,55);assert.equal(groups[1].contentIntelligence.enabled,false);
});

test('packaged runtime panel persists per-group settings through the Intelligence store',()=>{
  const layer=read('dist/intelligence-layer.js');
  assert.match(layer,/groupConfigs=Array\.isArray\(cfg\.groupConfigs\)/);
  assert.match(layer,/mountPerGroupControls\('streaming'\)/);
  assert.match(layer,/mountPerGroupControls\('social'\)/);
  assert.match(layer,/randomly plays 1–2 non-target songs briefly, pauses them/);
});

test('main process merges persisted group settings with renderer run requests',()=>{
  const main=read('electron/main.cjs');
  assert.match(main,/storedStreamingIntelligence/);assert.match(main,/groupConfigs:storedStreamingIntelligence\?\.groupConfigs/);
  assert.match(main,/storedSocialIntelligence/);assert.match(main,/groupConfigs:storedSocialIntelligence\?\.groupConfigs/);
});
