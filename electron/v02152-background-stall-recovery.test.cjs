const test=require('node:test');
const assert=require('node:assert/strict');
const {createStreamingBrowserFactory}=require('./streaming/streaming-browser-factory.cjs');
const social=require('./social/social-runner.cjs')._test;
const streaming=require('./streaming/streaming-session-worker.cjs')._test;
const {buildRuntimePerformanceLaunchPolicy,mergeLaunchArgs}=require('./qa-runner.cjs');

test('Chromium performance policy disables native Windows occlusion',()=>{
  const policy=buildRuntimePerformanceLaunchPolicy({browserEngine:'chromium'});
  const merged=mergeLaunchArgs(policy.args,['--disable-features=MediaRouter,Translate']);
  const flag=merged.find(x=>x.startsWith('--disable-features='));
  assert.ok(flag);
  assert.match(flag,/CalculateNativeWinOcclusion/);
  assert.match(flag,/MediaRouter/);
  assert.equal(merged.filter(x=>x.startsWith('--disable-features=')).length,1);
});

test('background Chromium streaming/social browser uses headed minimized renderer',async()=>{
  const launches=[];
  const page={setDefaultTimeout(){},url:()=> 'about:blank'};
  const browser={version:()=> '153.0.8012.10'};
  const context={browser:()=>browser,pages:()=>[],addInitScript:async()=>{},newPage:async()=>page,close:async()=>{}};
  const factory=createStreamingBrowserFactory({
    chromium:{launchPersistentContext:async(_dir,opts)=>{launches.push(opts);return context;}},
    profileBaseDir:'/orbitqa/profiles',
    browserPolicyResolver:()=>({engine:'chromium',executablePath:'/chrome',browserLabel:'Chrome'}),
    collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}}),
  });
  const session=await factory.open({runId:'r',workUnit:{workId:'w',deviceMode:'desktop',deviceProfile:'Desktop 1280x720'},account:{id:'a1',platform:'youtube',proxySource:'none'},executionMode:'background',usePersistentProfile:true});
  assert.equal(launches[0].headless,false);
  assert.ok((launches[0].args||[]).includes('--start-minimized'));
  assert.ok((launches[0].args||[]).some(x=>x.includes('CalculateNativeWinOcclusion')));
  await session.close();
});

test('social stage watchdog replaces a stalled page and retries only that account stage',async()=>{
  let created=0,closed=0,calls=0;
  const oldPage={close:async()=>{closed++;}};
  const freshPage={goto:async()=>{},close:async()=>{}};
  const session={page:oldPage,context:{newPage:async()=>{created++;return freshPage;}}};
  const result=await social.runSocialStageWithRecovery({
    session,stage:'target-navigation',targetUrl:'https://example.com/target',timeoutMs:15,
    operation:async(page)=>{calls++;if(page===oldPage)return new Promise(()=>{});return 'recovered';},
  });
  assert.equal(result,'recovered');
  assert.equal(session.page,freshPage);
  assert.equal(created,1);
  assert.equal(closed,1);
  assert.equal(calls,2);
});

test('streaming navigation auto-refreshes at a bounded stall checkpoint',async()=>{
  let attempts=0,reloads=0,currentUrl='https://music.example/loading';
  const track={id:'t1',url:'https://music.example/t1'};
  const page={url:()=>currentUrl,isClosed:()=>false,reload:async()=>{reloads++;}};
  const adapter={
    locateTrack:async()=>{attempts++;if(attempts<=6)throw new Error('still loading');currentUrl=track.url;return {status:'PASS'};},
    selectedTrackReady:async()=>currentUrl===track.url,
  };
  const deck={order:[track],index:0,mode:'sequential'};
  const out=await streaming.waitForSelectedTrackLocation({page,tracks:[track],currentTrack:track,deck,adapter,signal:new AbortController().signal,log:()=>{},sleep:async()=>{},workId:'w',shouldLocate:true});
  assert.equal(out.status,'ready');
  assert.ok(reloads>=1,'stall checkpoint should refresh without waiting for manual intervention');
});
