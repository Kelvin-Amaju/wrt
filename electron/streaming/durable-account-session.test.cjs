const test=require('node:test');
const assert=require('node:assert/strict');
const {createAccountVerificationManager}=require('./account-verification-manager.cjs');
const {executeStreamingRun}=require('./streaming-runner.cjs');
const {runPersistentAccountStreamingSession}=require('./streaming-session-worker.cjs');

function memoryAccountStore(initial){
  let current={...initial};
  const saves=[];
  return {
    saves,
    getInternal:id=>String(id)===String(current.id)?{...current}:null,
    save:value=>{current={...current,...value};saves.push({...value});return {...current,hasPassword:Boolean(current.password),hasSessionSecret:Boolean(current.sessionSecret)};},
  };
}

test('durable lifecycle: isolated manual Chrome login is captured and a later streaming run reuses only the saved session',async()=>{
  const store=memoryAccountStore({id:'a1',platform:'spotify',label:'QA',username:'qa@example.com',password:'secret',authMode:'credentials',proxySource:'none',status:'unverified'});
  const loginSnapshot={cookies:[{name:'sp_dc',value:'login-session',domain:'.spotify.com',path:'/'}],origins:[{origin:'https://open.spotify.com',localStorage:[{name:'logged-in',value:'yes'}]}]};
  let manualOpenCalls=0;
  let captureOpenCalls=0;
  let closedManual=0;
  let cleanedProfile='';
  const stableProfile='C:/OrbitQA/profiles/spotify/a1';
  const verificationAdapter={verifySession:async()=>({status:'PASS',reason:'Spotify active'})};
  const verificationBrowserFactory={
    openManualLogin:async payload=>{
      manualOpenCalls++;
      assert.equal(payload.account.id,'a1');
      assert.equal(payload.account.proxySource,'none');
      assert.match(payload.url,/spotify/i);
      assert.equal(payload.profileDir,stableProfile);
      assert.equal(payload.freshProfile,false);
      return {profileDir:stableProfile,browserLabel:'Google Chrome',close:async()=>{closedManual++;}};
    },
    open:async payload=>{
      captureOpenCalls++;
      assert.equal(payload.account.id,'a1');
      assert.equal(payload.profileDirOverride,stableProfile);
      assert.equal(payload.ignoreStoredSession,true);
      assert.equal(payload.restoreStoredSession,false);
      return {
        page:{goto:async()=>{},waitForTimeout:async()=>{},reload:async()=>{}},
        context:{storageState:async()=>loginSnapshot},
        close:async()=>{},
      };
    },
    cleanupManualLoginProfile:profile=>{cleanedProfile=profile;},
    getAccountProfileDir:()=>stableProfile,
  };
  const manager=createAccountVerificationManager({accountStore:store,adapterRegistry:{get:()=>verificationAdapter},browserFactory:verificationBrowserFactory,now:()=>new Date('2026-09-18T16:30:00.000Z')});

  const pending=await manager.start({accountId:'a1'});
  assert.equal(pending.status,'pending');
  assert.equal(manualOpenCalls,1);
  assert.equal(captureOpenCalls,0,'Playwright must not control the browser before the user signs in');
  const completed=await manager.complete(pending.sessionId);
  assert.equal(completed.ok,true);
  assert.equal(closedManual,1);
  assert.equal(captureOpenCalls,1);
  assert.equal(cleanedProfile,'','durable verified profile must be preserved');
  const persistedAfterLogin=store.getInternal('a1').sessionSecret;
  assert.ok(persistedAfterLogin);
  assert.equal(JSON.parse(persistedAfterLogin).kind,'playwright-storage-state');
  assert.equal(JSON.parse(persistedAfterLogin).storageState.cookies[0].value,'login-session');
  assert.equal(store.getInternal('a1').status,'ready');

  let streamingSessionAuthCalls=0;
  let trackLocationCalls=0;
  const streamingSnapshot={cookies:[{name:'sp_dc',value:'stream-refreshed',domain:'.spotify.com',path:'/'}],origins:[{origin:'https://open.spotify.com',localStorage:[{name:'logged-in',value:'yes'}]}]};
  const streamingAdapter={
    authenticate:async({account})=>{
      assert.equal(account.sessionSecret,persistedAfterLogin);
      assert.equal(account.username,'');
      assert.equal(account.password,'');
      assert.equal(account.authMode,'session');
      streamingSessionAuthCalls++;
      return {status:'PASS',reason:'Authorized Spotify session restored'};
    },
    verifySession:async()=>({status:'PASS',reason:'active'}),
    locateTrack:async()=>{trackLocationCalls++;return {status:'PASS'};},
    playbackControls:async()=>({play:async()=>({status:'PASS'}),pause:async()=>({status:'PASS'})}),
  };
  const browserFactory={open:async payload=>{
    assert.equal(payload.account.sessionSecret,persistedAfterLogin);
    assert.equal(payload.usePersistentProfile,true,'streaming must reuse the durable account profile');
    return {page:{url:()=> 'https://open.spotify.com/track/t1',screenshot:async()=>{}},context:{storageState:async()=>streamingSnapshot},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})};
  }};
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'https://open.spotify.com/track/t1',title:'Track 1'}]})};

  const summary=await executeStreamingRun({runId:'R-durable',request:{runKind:'streaming',platform:'spotify',collectionIds:['c1'],trackIds:['t1'],accountIds:['a1'],slots:1,queueMode:'sequential',observation:{minSeconds:1,maxSeconds:1},checks:['playback'],executionMode:'visible'},emit:()=>{},signal:new AbortController().signal,collectionStore,accountStore:store,adapterRegistry:{get:()=>streamingAdapter},browserFactory,runSession:args=>runPersistentAccountStreamingSession({...args,sleep:async()=>{},maxTrackVisits:1}),runSleep:async()=>{},checkpoint:{terminalWorkIds:[]}});

  assert.equal(summary.completed,1);
  assert.equal(summary.failed,0);
  assert.equal(streamingSessionAuthCalls,1);
  assert.equal(trackLocationCalls,1);
  const finalSession=JSON.parse(store.getInternal('a1').sessionSecret);
  assert.equal(finalSession.kind,'playwright-storage-state');
  assert.equal(finalSession.storageState.cookies[0].value,'stream-refreshed');
  assert.equal(store.getInternal('a1').status,'ready');
});
