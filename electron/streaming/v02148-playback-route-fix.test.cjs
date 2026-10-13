const test=require('node:test');
const assert=require('node:assert/strict');
const {verifyPoolProxyRouteInBrowser}=require('../qa-runner.cjs');
const {waitForPlaybackStart}=require('./streaming-session-worker.cjs');

test('route verification isolates every fallback endpoint on its own temporary page',async()=>{
  const opened=[];
  const closed=[];
  const urls=[];
  const context={
    async newPage(){
      const id=opened.length+1; opened.push(id);
      let current='';
      return {
        async goto(url){current=url;urls.push([id,url]);if(id===1)throw new Error('net::ERR_CONNECTION_CLOSED');return {ok:()=>true,status:()=>200};},
        async textContent(){return '198.51.100.22';},
        async close(){closed.push(id);},
      };
    },
  };
  const mainPage={context:()=>context};
  const result=await verifyPoolProxyRouteInBrowser({page:mainPage,routeCheckUrl:'https://api64.ipify.org?format=json',proxyPoolService:{async getDirectIp(){return null;}}});
  assert.equal(result.proxiedIp,'198.51.100.22');
  assert.equal(result.attempts,2);
  assert.deepEqual(opened,[1,2]);
  assert.deepEqual(closed,[1,2]);
  assert.match(urls[0][1],/api64\.ipify\.org/);
  assert.match(urls[1][1],/api\.ipify\.org/);
});

test('playback start recovery reopens the selected track before exhausting blind retries',async()=>{
  let plays=0;
  let relocates=0;
  const page={
    url:()=> 'https://open.spotify.com/track/test',
    isClosed:()=>false,
    async reload(){},
  };
  const adapter={
    async playbackControls(){return {async play(){plays++;return plays>=5?{status:'PASS',reason:'playing'}:{status:'WARNING',reason:'Spotify Play control is not ready yet'};}};},
    async locateTrack(){relocates++;return {status:'PASS',url:'https://open.spotify.com/track/test'};},
  };
  const result=await waitForPlaybackStart({page,adapter,track:{id:'t1',title:'Song',url:'https://open.spotify.com/track/test'},log:()=>{},sleep:async()=>{},workId:'w'});
  assert.equal(result.status,'playing');
  assert.equal(plays,5);
  assert.equal(relocates,1);
});

test('playback start surfaces protected-media failure immediately with a useful reason',async()=>{
  let plays=0;
  const page={url:()=> 'https://open.spotify.com/track/test',isClosed:()=>false};
  const adapter={async playbackControls(){return {async play(){plays++;return {status:'WARNING',reason:'Spotify protected-media/DRM playback is unavailable in this browser profile (Widevine unavailable).'};}};}};
  await assert.rejects(
    ()=>waitForPlaybackStart({page,adapter,track:{id:'t1',title:'Song'},log:()=>{},sleep:async()=>{},workId:'w'}),
    err=>err?.code==='ORBITQA_STREAMING_MEDIA_UNAVAILABLE'&&/Widevine unavailable/i.test(err.message)
  );
  assert.equal(plays,1);
});
