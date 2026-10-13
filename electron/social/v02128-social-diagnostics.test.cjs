const test=require('node:test');
const assert=require('node:assert/strict');
const {_test}=require('./social-runner.cjs');

test('v0.21.29 resetYoutubeDisposableState clears non-cookie YouTube site state and HTTP cache',async()=>{
  const calls=[];
  const cdp={send:async(method,args)=>{calls.push([method,args]);},detach:async()=>{calls.push(['detach']);}};
  const session={context:{newCDPSession:async()=>cdp}};
  const ok=await _test.resetYoutubeDisposableState(session,{});
  assert.equal(ok,true);
  assert.ok(calls.some(([m])=>m==='Network.clearBrowserCache'));
  const storage=calls.find(([m])=>m==='Storage.clearDataForOrigin');
  assert.equal(storage[1].origin,'https://www.youtube.com');
  for(const required of ['cache_storage','service_workers','indexeddb','local_storage']) assert.ok(storage[1].storageTypes.includes(required));
  assert.ok(!storage[1].storageTypes.includes('cookies'));
});

test('v0.21.28 diagnostic tracker records browser/profile/proxy and network failures',async()=>{
  const handlers={};
  const page={on:(name,fn)=>{handlers[name]=fn;},url:()=> 'https://www.youtube.com/watch?v=abc',title:async()=> 'Demo',locator:()=>({first(){return this;},isVisible:async()=>false,evaluate:async()=>({readyState:4,networkState:1,paused:false,errorCode:null})})};
  const session={page,persistentProfile:true,profileDir:'C:/profiles/youtube/account-7',browser:{version:()=> '140.0.1'},allocation:{proxyId:'proxy-3',countryCode:'NG'}};
  const tracker=_test.createSocialDiagnosticTracker(session,{account:{id:'a7',label:'Account 7',platform:'youtube',proxySource:'static'},target:{id:'t1',url:'https://www.youtube.com/watch?v=abc'}});
  handlers.requestfailed?.({url:()=> 'https://rr1---sn.googlevideo.com/videoplayback',failure:()=>({errorText:'net::ERR_FAILED'})});
  handlers.response?.({status:()=>503,url:()=> 'https://www.youtube.com/youtubei/v1/player'});
  tracker.noteRecovery(3,'cache-service-worker-reset');tracker.setStage('player-health');
  const d=await _test.snapshotSocialDiagnostics(session,tracker);
  assert.equal(d.profileMode,'persistent');assert.equal(d.profileName,'account-7');assert.equal(d.browserVersion,'140.0.1');assert.equal(d.proxyId,'proxy-3');assert.equal(d.proxyCountry,'NG');assert.equal(d.recoveryAttempts,3);assert.equal(d.recoveryMethod,'cache-service-worker-reset');assert.equal(d.failedRequests.length,1);assert.equal(d.httpErrors.length,1);
});
