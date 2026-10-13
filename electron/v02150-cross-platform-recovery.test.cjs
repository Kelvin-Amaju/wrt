const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {waitForPlaybackStart}=require('./streaming/streaming-session-worker.cjs');
const {createSocialRunner,_test:socialTest}=require('./social/social-runner.cjs');

test('streaming player-device loss triggers bounded player rebuild before succeeding',async()=>{
  let reloads=0,locates=0,plays=0,issue={kind:'player-device-lost',playerRecovery:true,reason:'No such device.'};
  const page={url:()=> 'https://example.test/track/1',isClosed:()=>false,reload:async()=>{reloads++;},waitForTimeout:async()=>{}};
  const adapter={
    playbackControls:async()=>({play:async()=>{plays++;return plays===1?{status:'WARNING',reason:'Playback did not start'}:{status:'PASS',reason:'Playback active'};}}),
    locateTrack:async()=>{locates++;return {status:'PASS'};}
  };
  const result=await waitForPlaybackStart({page,adapter,signal:null,log:()=>{},sleep:async()=>{},workId:'w',track:{id:'1',title:'Song'},consumeTransientPlayerIssue:()=>{const x=issue;issue=null;return x;}});
  assert.equal(result.status,'playing');
  assert.equal(reloads,1);
  assert.equal(locates,1);
});

test('social diagnostics keep temporary device/timeouts out of hard page errors and expose player recovery',()=>{
  class FakePage extends EventEmitter{}
  const page=new FakePage();
  const tracker=socialTest.createSocialDiagnosticTracker({page,browser:{version:()=> 'test'}},{account:{id:'a',platform:'youtube'},target:{id:'t'}});
  page.emit('pageerror',new Error('No such device.'));
  page.emit('pageerror',new Error('In-flight timeout exceeded'));
  assert.equal(tracker.data.pageErrors.length,0);
  assert.equal(tracker.data.transientErrors.length,2);
  assert.equal(tracker.consumeTransientPlayerIssue()?.kind,'in-flight-timeout');
});
