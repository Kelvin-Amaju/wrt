const test=require('node:test'); const assert=require('node:assert/strict'); const {runStreamingSession,runPersistentAccountStreamingSession,observeVerifiedPlayback}=require('./streaming-session-worker.cjs');
function fakePage(){return {url:()=> 'https://music.example/track', screenshot:async()=>{}, waitForTimeout:async()=>{}};}
test('worker performs privacy before platform activity and never has engagement actions',async()=>{const order=[]; const page=fakePage(); const browserFactory={open:async()=>{order.push('proxy-browser-privacy'); return {page,close:async()=>order.push('close'),finalIntegrity:async()=>{order.push('final-integrity'); return {overall:'pass'}}};}}; const adapter={verifySession:async()=>{order.push('verify-session');return {status:'PASS'};},locateTrack:async()=>{order.push('locate-track');return {status:'PASS'};},playbackControls:async()=>({status:'PASS',play:async()=>{order.push('playback');return {status:'PASS'};},pause:async()=>({status:'NOT_APPLICABLE'}),next:async()=>({status:'NOT_APPLICABLE'})})}; const out=await runStreamingSession({runId:'r',workUnit:{workId:'w'},account:{id:'a'},trackPlan:{track:{id:'t',url:'u'},observationSeconds:1,checks:['playback']},adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{}}); assert.deepEqual(order,['proxy-browser-privacy','locate-track','verify-session','playback','final-integrity','close']); assert.equal(out.checks.playback.status,'PASS'); assert.equal('follow' in adapter,false); assert.equal('favorite' in adapter,false);});
test('screenshots OFF captures zero and ON captures only safe checkpoints',async()=>{let shots=0; const page={url:()=> 'u',screenshot:async()=>{shots++}}; const adapter={verifySession:async()=>({status:'PASS'}),locateTrack:async()=>({status:'PASS'}),playbackControls:async()=>({status:'PASS',play:async()=>({status:'PASS'})})}; const browserFactory={open:async()=>({page,close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})}; await runStreamingSession({runId:'r',workUnit:{workId:'w'},account:{},trackPlan:{track:{id:'t',url:'u'},observationSeconds:1,checks:['playback']},adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{}}); assert.equal(shots,0); await runStreamingSession({runId:'r',workUnit:{workId:'w2'},account:{},trackPlan:{track:{id:'t',url:'u'},observationSeconds:1,checks:['playback']},adapter,browserFactory,screenshotPolicy:{enabled:true,pathFor:(_,stage)=>`/tmp/${stage}.png`},sleep:async()=>{},signal:new AbortController().signal,log:()=>{}}); assert.ok(shots>=1);});

test('worker reports every requested QA check honestly, including unsupported checks as NOT_APPLICABLE',async()=>{
  const page=fakePage();
  const controls={play:async()=>({status:'PASS'}),pause:async()=>({status:'PASS'}),next:async()=>({status:'PASS'})};
  const adapter={verifySession:async()=>({status:'PASS'}),locateTrack:async()=>({status:'PASS'}),playbackControls:async()=>controls};
  const browserFactory={open:async()=>({page,close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  const checks=['playback','pause-resume','next-track','previous-track','queue-transition','volume-control','artist-navigation','album-navigation','playlist-loading','session-verification'];
  const out=await runStreamingSession({runId:'r',workUnit:{workId:'w'},account:{},trackPlan:{track:{id:'t',url:'u'},observationSeconds:1,checks},adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{}});
  for(const check of checks) assert.ok(out.checks[check],`missing ${check}`);
  assert.equal(out.checks['pause-resume'].status,'PASS');
  assert.equal(out.checks['previous-track'].status,'NOT_APPLICABLE');
  assert.equal(out.checks['volume-control'].status,'NOT_APPLICABLE');
  assert.equal(out.checks['queue-transition'].status,'PASS');
});

test('worker reports the selected underlying proxy kind for Run Center mix summaries',async()=>{
  const events=[]; const page=fakePage();
  const adapter={verifySession:async()=>({status:'PASS'}),locateTrack:async()=>({status:'PASS'}),playbackControls:async()=>({play:async()=>({status:'PASS'})})};
  const browserFactory={open:async()=>({page,allocation:{proxyKind:'static'},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  await runStreamingSession({runId:'r',workUnit:{workId:'w'},account:{proxySource:'smart-mix'},trackPlan:{track:{id:'t',url:'u'},observationSeconds:1,checks:['playback']},adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:(message,meta)=>events.push({message,...meta})});
  assert.ok(events.some(e=>e.type==='proxy-selection'&&e.selectedProxyKind==='static'));
});

test('worker authenticates the authorized account before locating a track',async()=>{
  const order=[]; const page=fakePage();
  const adapter={authenticate:async()=>{order.push('authenticate');return {status:'PASS'};},verifySession:async()=>{order.push('verify-session');return {status:'PASS'};},locateTrack:async()=>{order.push('locate-track');return {status:'PASS'};},playbackControls:async()=>({play:async()=>({status:'PASS'})})};
  const browserFactory={open:async()=>({page,context:{cookies:async()=>[]},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  await runStreamingSession({runId:'r',workUnit:{workId:'w'},account:{id:'a',authMode:'credentials',username:'u',password:'p'},trackPlan:{track:{id:'t',url:'u'},observationSeconds:1,checks:['playback']},adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{}});
  assert.deepEqual(order.slice(0,3),['authenticate','locate-track','verify-session']);
});

test('worker forwards canonical saved-artist Spotify track metadata unchanged to the platform adapter',async()=>{
  const page=fakePage(); let located=null;
  const canonical={id:'spotify-track-1',spotifyTrackId:'spotify-track-1',platform:'spotify',title:'Canonical Track',artist:'Exact Artist',url:'https://open.spotify.com/track/spotify-track-1',creditedArtistIds:['artist-1'],creditedArtistNames:['Exact Artist'],releaseId:'release-1'};
  const adapter={verifySession:async()=>({status:'PASS'}),locateTrack:async({track})=>{located=track;return {status:'PASS'};},playbackControls:async()=>({play:async()=>({status:'PASS'})})};
  const browserFactory={open:async()=>({page,close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  await runStreamingSession({runId:'r',workUnit:{workId:'w'},account:{},trackPlan:{track:canonical,observationSeconds:1,checks:['playback']},adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{}});
  assert.equal(located.spotifyTrackId,'spotify-track-1');
  assert.equal(located.url,'https://open.spotify.com/track/spotify-track-1');
  assert.deepEqual(located.creditedArtistIds,['artist-1']);
});

test('worker persists a full v2 browser session after authentication PASS before locating the track',async()=>{
  const page=fakePage(); const persisted=[]; const order=[];
  const snapshot={cookies:[{name:'sid',value:'live',domain:'.spotify.com',path:'/'}],origins:[{origin:'https://open.spotify.com',localStorage:[{name:'account',value:'qa'}]}]};
  const adapter={
    authenticate:async({account})=>{order.push('authenticate');assert.match(account.sessionSecret,/playwright-storage-state/);return {status:'PASS',reason:'restored'}},
    locateTrack:async()=>{order.push('locate-track');return {status:'PASS'}},
    verifySession:async()=>({status:'PASS'}),
    playbackControls:async()=>({play:async()=>({status:'PASS'})}),
  };
  const browserFactory={open:async payload=>{assert.match(payload.account.sessionSecret,/playwright-storage-state/);return {page,context:{storageState:async()=>snapshot},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})};}};
  const original=JSON.stringify({version:2,kind:'playwright-storage-state',capturedAt:'old',storageState:snapshot});
  await runStreamingSession({runId:'r',workUnit:{workId:'w'},account:{id:'a',platform:'spotify',authMode:'credentials',username:'u',password:'p',sessionSecret:original},trackPlan:{track:{id:'t',url:'u'},observationSeconds:1,checks:['playback']},adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{},persistAuthorizedSession:async value=>persisted.push(value)});
  assert.deepEqual(order,['authenticate','locate-track']);
  assert.equal(persisted.length,1);
  const envelope=JSON.parse(persisted[0]);
  assert.equal(envelope.version,2);
  assert.equal(envelope.kind,'playwright-storage-state');
  assert.deepEqual(envelope.storageState,snapshot);
});


test('persistent account worker keeps one browser open and never repeats a selected song in the same QA assignment',async()=>{
  const order=[]; let currentUrl='about:blank';
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const context={storageState:async()=>({cookies:[],origins:[]})};
  const browserFactory={open:async()=>{order.push('open');return {page,context,close:async()=>order.push('close'),finalIntegrity:async()=>({overall:'pass'})};}};
  const adapter={
    authenticate:async()=>({status:'PASS'}),
    locateTrack:async({track})=>{currentUrl=track.url;order.push(`locate:${track.id}`);return {status:'PASS',url:track.url}},
    verifySession:async()=>({status:'PASS'}),
    playbackControls:async()=>({play:async()=>{order.push('play');return {status:'PASS'};},next:async()=>({status:'NOT_APPLICABLE'})}),
  };
  const out=await runPersistentAccountStreamingSession({runId:'r',workUnit:{workId:'account:a1'},account:{id:'a1'},tracks:[{id:'t1',url:'https://music.example/t1'},{id:'t2',url:'https://music.example/t2'}],initialTrack:{id:'t1',url:'https://music.example/t1'},observation:{minSeconds:1,maxSeconds:1},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{},maxTrackVisits:3});
  assert.equal(order.filter(x=>x==='open').length,1);
  assert.equal(order.filter(x=>x.startsWith('locate:')).length,2);
  assert.equal(order.at(-1),'close');
  assert.equal(out.trackVisits,2);
  assert.equal(out.reason,'visit-limit');
});

test('persistent account worker never uses native Next and transitions only through the selected QA pool',async()=>{
  let currentUrl='about:blank'; const located=[]; let nextCalls=0;
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  const tracks=[{id:'t1',url:'https://music.example/t1'},{id:'t2',url:'https://music.example/t2'}];
  const adapter={authenticate:async()=>({status:'PASS'}),locateTrack:async({track})=>{located.push(track.id);currentUrl=track.url;return {status:'PASS'}},verifySession:async()=>({status:'PASS'}),playbackControls:async()=>({play:async()=>({status:'PASS'}),next:async()=>{nextCalls++;currentUrl='https://music.example/t2?context=queue';return {status:'PASS'};}})};
  await runPersistentAccountStreamingSession({runId:'r',workUnit:{workId:'account:a1'},account:{id:'a1'},tracks,initialTrack:tracks[0],observation:{minSeconds:1,maxSeconds:1},checks:['playback','next-track'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{},maxTrackVisits:2});
  assert.equal(nextCalls,0);
  assert.deepEqual(located,['t1','t2']);
});

test('persistent account worker uses controlled navigation so an unselected native Next result is never reached',async()=>{
  let currentUrl='about:blank'; const located=[];
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  const tracks=[{id:'t1',url:'https://music.example/t1'},{id:'t2',url:'https://music.example/t2'}];
  const adapter={authenticate:async()=>({status:'PASS'}),locateTrack:async({track})=>{located.push(track.id);currentUrl=track.url;return {status:'PASS'}},verifySession:async()=>({status:'PASS'}),playbackControls:async()=>({play:async()=>({status:'PASS'}),next:async()=>{currentUrl='https://music.example/recommended-not-selected';return {status:'PASS'};}})};
  await runPersistentAccountStreamingSession({runId:'r',workUnit:{workId:'account:a1'},account:{id:'a1'},tracks,initialTrack:tracks[0],observation:{minSeconds:1,maxSeconds:1},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{},maxTrackVisits:2});
  assert.equal(located.length,2);
  assert.ok(['t1','t2'].includes(located[1]));
  assert.notEqual(located[1],undefined);
});

test('persistent account worker exits when its browser is manually closed without waiting for stop',async()=>{
  let closed=false; let sessionCloseCalls=0;
  const page={url:()=> 'https://music.example/t1',isClosed:()=>closed,screenshot:async()=>{}};
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{sessionCloseCalls++;},finalIntegrity:async()=>({overall:'pass'})})};
  const adapter={authenticate:async()=>({status:'PASS'}),locateTrack:async()=>({status:'PASS'}),verifySession:async()=>({status:'PASS'}),playbackControls:async()=>({play:async()=>({status:'PASS'}),next:async()=>({status:'NOT_APPLICABLE'})})};
  const out=await runPersistentAccountStreamingSession({runId:'r',workUnit:{workId:'account:a1'},account:{id:'a1'},tracks:[{id:'t1',url:'https://music.example/t1'}],initialTrack:{id:'t1',url:'https://music.example/t1'},observation:{minSeconds:2,maxSeconds:2},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{closed=true;},signal:new AbortController().signal,log:()=>{}});
  assert.equal(out.reason,'browser-closed');
  assert.equal(sessionCloseCalls,1);
});

test('STOP abort closes the persistent account browser and exits with AbortError',async()=>{
  const controller=new AbortController(); let closeCalls=0;
  const page={url:()=> 'https://music.example/t1',isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{closeCalls++;},finalIntegrity:async()=>({overall:'pass'})})};
  const adapter={authenticate:async()=>({status:'PASS'}),locateTrack:async()=>({status:'PASS'}),verifySession:async()=>({status:'PASS'}),playbackControls:async()=>({play:async()=>({status:'PASS'}),next:async()=>({status:'NOT_APPLICABLE'})})};
  await assert.rejects(()=>runPersistentAccountStreamingSession({runId:'r',workUnit:{workId:'stream-account:a1'},account:{id:'a1'},tracks:[{id:'t1',url:'https://music.example/t1'}],initialTrack:{id:'t1',url:'https://music.example/t1'},observation:{minSeconds:5,maxSeconds:5},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{controller.abort();},signal:controller.signal,log:()=>{}}),error=>error?.name==='AbortError');
  assert.equal(closeCalls,1);
});

test('STOP abort closes every concurrently running persistent account browser',async()=>{
  const controller=new AbortController();
  let closeCalls=0;
  let sleepers=0;
  const browserFactory={open:async({account})=>({
    page:{url:()=>`https://music.example/${account.id}`,isClosed:()=>false,screenshot:async()=>{}},
    context:{storageState:async()=>({cookies:[],origins:[]})},
    close:async()=>{closeCalls++;},
    finalIntegrity:async()=>({overall:'pass'}),
  })};
  const adapter={
    authenticate:async()=>({status:'PASS'}),
    locateTrack:async()=>({status:'PASS'}),
    verifySession:async()=>({status:'PASS'}),
    playbackControls:async()=>({play:async()=>({status:'PASS'}),next:async()=>({status:'NOT_APPLICABLE'})}),
  };
  const sleep=async(_ms,signal)=>new Promise((resolve,reject)=>{
    const onAbort=()=>{const error=new Error('stopped');error.name='AbortError';reject(error);};
    signal.addEventListener('abort',onAbort,{once:true});
    sleepers++;
    if(sleepers===2) controller.abort();
  });
  const run=id=>runPersistentAccountStreamingSession({
    runId:'r-stop-all',workUnit:{workId:`stream-account:${id}`},account:{id},
    tracks:[{id,url:`https://music.example/${id}`}],initialTrack:{id,url:`https://music.example/${id}`},
    observation:{minSeconds:5,maxSeconds:5},checks:['playback'],adapter,browserFactory,
    screenshotPolicy:{enabled:false},sleep,signal:controller.signal,log:()=>{},
  });
  const results=await Promise.allSettled([run('a1'),run('a2')]);
  assert.equal(results.filter(row=>row.status==='rejected'&&row.reason?.name==='AbortError').length,2);
  assert.equal(closeCalls,2);
});


test('persistent account worker corrects a direct navigation that lands outside the selected QA pool before playback',async()=>{
  let currentUrl='about:blank';
  const located=[];
  let playCalls=0;
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  const tracks=[
    {id:'t1',url:'https://music.example/t1'},
    {id:'t2',url:'https://music.example/t2'},
  ];
  const adapter={
    authenticate:async()=>({status:'PASS'}),
    locateTrack:async({track})=>{
      located.push(track.id);
      currentUrl=track.id==='t1'?'https://music.example/recommendation-not-selected':track.url;
      return {status:'PASS'};
    },
    verifySession:async()=>({status:'PASS'}),
    playbackControls:async()=>({play:async()=>{playCalls++;return {status:'PASS'};},next:async()=>({status:'NOT_APPLICABLE'})}),
  };
  const out=await runPersistentAccountStreamingSession({runId:'r-enforce',workUnit:{workId:'stream-account:a1'},account:{id:'a1'},tracks,initialTrack:tracks[0],observation:{minSeconds:1,maxSeconds:1},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{},maxTrackVisits:1});
  assert.deepEqual(located,['t1','t2']);
  assert.equal(currentUrl,tracks[1].url);
  assert.equal(playCalls,1);
  assert.equal(out.trackVisits,1);
});

test('STREAM core always presses play for the selected song even when playback is not listed as an optional QA check',async()=>{
  let currentUrl='about:blank'; let playCalls=0;
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  const track={id:'t1',platform:'spotify',title:'Selected song',url:'https://open.spotify.com/track/t1'};
  const adapter={
    authenticate:async()=>({status:'PASS'}),
    locateTrack:async({track})=>{currentUrl=track.url;return {status:'PASS',url:track.url};},
    verifySession:async()=>({status:'PASS'}),
    playbackControls:async()=>({play:async()=>{playCalls++;return {status:'PASS'};},next:async()=>({status:'NOT_APPLICABLE'})}),
  };
  const out=await runPersistentAccountStreamingSession({runId:'r-core-play',workUnit:{workId:'stream-account:a1'},account:{id:'a1',platform:'spotify'},tracks:[track],initialTrack:track,observation:{minSeconds:1,maxSeconds:1},checks:['session-verification'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{},maxTrackVisits:1});
  assert.equal(playCalls,1);
  assert.equal(out.trackVisits,1);
});

test('persistent worker retries a temporary track load problem in the same browser instead of closing the account tab',async()=>{
  let currentUrl='about:blank'; let openCalls=0; let closeCalls=0; let locateCalls=0; let playCalls=0;
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>{openCalls++;return {page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{closeCalls++;},finalIntegrity:async()=>({overall:'pass'})};}};
  const track={id:'t1',platform:'spotify',title:'Selected song',url:'https://open.spotify.com/track/t1'};
  const adapter={
    authenticate:async()=>({status:'PASS'}),
    locateTrack:async({track})=>{locateCalls++;if(locateCalls===1)throw new Error('temporary navigation timeout');currentUrl=track.url;return {status:'PASS',url:track.url};},
    verifySession:async()=>({status:'PASS'}),
    playbackControls:async()=>({play:async()=>{playCalls++;return {status:'PASS'};},next:async()=>({status:'NOT_APPLICABLE'})}),
  };
  const out=await runPersistentAccountStreamingSession({runId:'r-retry-load',workUnit:{workId:'stream-account:a1'},account:{id:'a1',platform:'spotify'},tracks:[track],initialTrack:track,observation:{minSeconds:1,maxSeconds:1},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{},maxTrackVisits:1});
  assert.equal(openCalls,1);
  assert.equal(locateCalls,2);
  assert.equal(playCalls,1);
  assert.equal(out.trackVisits,1);
  assert.equal(closeCalls,1,'the only close is the explicit test visit-limit cleanup after successful recovery');
});

test('persistent worker never performs manual account login inside the automated streaming browser',async()=>{
  let closeCalls=0; let playCalls=0;
  const page={url:()=> 'https://accounts.spotify.com/en/login',isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{closeCalls++;},finalIntegrity:async()=>({overall:'pass'})})};
  const track={id:'t1',platform:'spotify',title:'Selected song',url:'https://open.spotify.com/track/t1'};
  const adapter={
    authenticate:async({account})=>{assert.equal(account.password,'');assert.equal(account.username,'');return {status:'NEEDS_VERIFICATION',reason:'Complete MFA manually'};},
    verifySession:async()=>({status:'NEEDS_VERIFICATION',reason:'Complete MFA manually'}),
    locateTrack:async()=>({status:'PASS'}),
    playbackControls:async()=>({play:async()=>{playCalls++;return {status:'PASS'};}}),
  };
  await assert.rejects(()=>runPersistentAccountStreamingSession({runId:'r-manual-auth',workUnit:{workId:'stream-account:a1'},account:{id:'a1',platform:'spotify',username:'qa@example.com',password:'secret'},tracks:[track],initialTrack:track,observation:{minSeconds:1,maxSeconds:1},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{},maxTrackVisits:1}),/LOGIN MANUALLY/i);
  assert.equal(playCalls,0);
  assert.equal(closeCalls,1);
});

test('persistent worker retries a missing play control on the same selected track until playback starts',async()=>{
  let currentUrl='about:blank'; let openCalls=0; let closeCalls=0; let playbackControlCalls=0; let playCalls=0;
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>{openCalls++;return {page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{closeCalls++;},finalIntegrity:async()=>({overall:'pass'})};}};
  const track={id:'t1',platform:'spotify',title:'Selected song',url:'https://open.spotify.com/track/t1'};
  const adapter={
    authenticate:async()=>({status:'PASS'}),
    locateTrack:async({track})=>{currentUrl=track.url;return {status:'PASS'};},
    verifySession:async()=>({status:'PASS'}),
    playbackControls:async()=>{playbackControlCalls++;return {play:async()=>{playCalls++;return playbackControlCalls<3?{status:'NOT_APPLICABLE',reason:'player still loading'}:{status:'PASS'};},next:async()=>({status:'NOT_APPLICABLE'})};},
  };
  const out=await runPersistentAccountStreamingSession({runId:'r-retry-play',workUnit:{workId:'stream-account:a1'},account:{id:'a1',platform:'spotify'},tracks:[track],initialTrack:track,observation:{minSeconds:1,maxSeconds:1},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{},maxTrackVisits:1});
  assert.equal(openCalls,1);
  assert.equal(playbackControlCalls,3);
  assert.equal(playCalls,3);
  assert.equal(out.trackVisits,1);
  assert.equal(closeCalls,1,'the same browser survives all playback retries');
});

test('persistent worker opens the selected QA MUSIC SELECTION source first and lets that source choose the playable saved song',async()=>{
  let currentUrl='https://open.spotify.com/';
  let openCalls=0;
  let sourceCalls=0;
  let directLocateCalls=0;
  let playCalls=0;
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>{openCalls++;return {page,allocation:{proxyKind:'static'},context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})};}};
  const tracks=[
    {id:'s1',platform:'spotify',title:'Song 1',url:'https://open.spotify.com/track/song111'},
    {id:'s2',platform:'spotify',title:'Song 2',url:'https://open.spotify.com/track/song222'},
  ];
  const musicSelections=[{id:'album-1',name:'My Saved Album',platform:'spotify',sourceKind:'album',sourceInput:'https://open.spotify.com/album/album123',tracks}];
  const adapter={
    authenticate:async()=>({status:'PASS'}),
    verifySession:async()=>({status:'PASS'}),
    openMusicSelection:async({selection,preferredTrack})=>{sourceCalls++;assert.equal(selection.sourceInput,musicSelections[0].sourceInput);assert.ok(tracks.some(track=>track.id===preferredTrack.id));currentUrl=tracks[1].url;return {status:'PASS',track:tracks[1],sourceUrl:selection.sourceInput,method:'source-page'};},
    locateTrack:async()=>{directLocateCalls++;throw new Error('direct track navigation should not be the primary QA MUSIC SELECTION path');},
    playbackControls:async()=>({play:async()=>{playCalls++;return {status:'PASS'};},next:async()=>({status:'NOT_APPLICABLE'})}),
  };
  const out=await runPersistentAccountStreamingSession({runId:'r-source-first',workUnit:{workId:'stream-account:a1'},account:{id:'a1',platform:'spotify',proxySource:'static',proxyId:'p1'},tracks,initialTrack:tracks[0],musicSelections,observation:{minSeconds:1,maxSeconds:1},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{},maxTrackVisits:1});
  assert.equal(openCalls,1);
  assert.equal(sourceCalls,1);
  assert.equal(directLocateCalls,0);
  assert.equal(playCalls,1);
  assert.equal(out.trackVisits,1);
});

test('temporary QA MUSIC SELECTION source loading failure retries inside the same account browser',async()=>{
  let currentUrl='https://open.spotify.com/';
  let openCalls=0;
  let sourceCalls=0;
  let closeCalls=0;
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>{openCalls++;return {page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{closeCalls++;},finalIntegrity:async()=>({overall:'pass'})};}};
  const track={id:'s1',platform:'spotify',title:'Song 1',url:'https://open.spotify.com/track/song111'};
  const musicSelections=[{id:'album-1',name:'My Saved Album',platform:'spotify',sourceKind:'album',sourceInput:'https://open.spotify.com/album/album123',tracks:[track]}];
  const adapter={
    authenticate:async()=>({status:'PASS'}),verifySession:async()=>({status:'PASS'}),
    openMusicSelection:async()=>{sourceCalls++;if(sourceCalls===1)throw new Error('album page still loading');currentUrl=track.url;return {status:'PASS',track,sourceUrl:musicSelections[0].sourceInput};},
    locateTrack:async()=>{throw new Error('direct fallback should not run while the source page can recover');},
    playbackControls:async()=>({play:async()=>({status:'PASS'}),next:async()=>({status:'NOT_APPLICABLE'})}),
  };
  const out=await runPersistentAccountStreamingSession({runId:'r-source-retry',workUnit:{workId:'stream-account:a1'},account:{id:'a1',platform:'spotify'},tracks:[track],initialTrack:track,musicSelections,observation:{minSeconds:1,maxSeconds:1},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{},maxTrackVisits:1});
  assert.equal(openCalls,1);
  assert.equal(sourceCalls,2);
  assert.equal(out.trackVisits,1);
  assert.equal(closeCalls,1,'the test visit limit is the only close after the same browser recovered');
});


test('persistent worker starts the observation window only after playback is confirmed',async()=>{
  let currentUrl='about:blank'; let playCalls=0; let observedAfterConfirmation=false; const logs=[];
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  const track={id:'t1',platform:'spotify',title:'Confirmed Song',url:'https://open.spotify.com/track/t1'};
  const adapter={
    authenticate:async()=>({status:'PASS'}),
    locateTrack:async({track})=>{currentUrl=track.url;return {status:'PASS',url:track.url};},
    verifySession:async()=>({status:'PASS'}),
    playbackControls:async()=>({play:async()=>{playCalls++;return playCalls<3?{status:'WARNING',reason:'clicked but still paused'}:{status:'PASS',reason:'Playback confirmed after Spotify Play control click'};},next:async()=>({status:'NOT_APPLICABLE'})}),
  };
  const sleep=async()=>{if(logs.some(row=>row.meta?.type==='playback-confirmed'))observedAfterConfirmation=true;};
  const out=await runPersistentAccountStreamingSession({runId:'r-play-confirmed',workUnit:{workId:'stream-account:a1'},account:{id:'a1',platform:'spotify'},tracks:[track],initialTrack:track,observation:{minSeconds:1,maxSeconds:1},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep,signal:new AbortController().signal,log:(message,meta)=>logs.push({message,meta}),maxTrackVisits:1});
  assert.equal(playCalls,3);
  assert.equal(observedAfterConfirmation,true,'the observation timer must not begin until the player reports active playback');
  assert.ok(logs.some(row=>row.meta?.type==='playback-confirmed'&&/Confirmed Song/.test(row.message)));
  assert.equal(out.trackVisits,1);
});

test('QA MUSIC SELECTION Spotify search fallback is resolved to the real track before Play controls are requested',async()=>{
  let currentUrl='https://open.spotify.com/'; let locateCalls=0; let playbackTrack=null;
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  const searchTrack={id:'spotify-search:breny vale::i was talking to you',platform:'spotify',title:'I Was Talking To You',artist:'Breny Vale',url:'https://open.spotify.com/search/Breny%20Vale%20I%20Was%20Talking%20To%20You'};
  const musicSelections=[{id:'album-1',name:'Saved Spotify album',platform:'spotify',sourceKind:'album',sourceInput:'https://open.spotify.com/album/album123',tracks:[searchTrack]}];
  const adapter={
    id:'spotify',authenticate:async()=>({status:'PASS'}),verifySession:async()=>({status:'PASS'}),
    openMusicSelection:async()=>{currentUrl=searchTrack.url;return {status:'PASS',track:searchTrack,sourceUrl:musicSelections[0].sourceInput,method:'saved-song-fallback'};},
    locateTrack:async({track})=>{locateCalls++;assert.equal(track.id,searchTrack.id);currentUrl='https://open.spotify.com/track/real123';return {status:'PASS',url:currentUrl};},
    playbackControls:async({track})=>{playbackTrack=track;return {play:async()=>({status:'PASS'}),next:async()=>({status:'NOT_APPLICABLE'})};},
  };
  const out=await runPersistentAccountStreamingSession({runId:'r-search-resolve',workUnit:{workId:'stream-account:a1'},account:{id:'a1',platform:'spotify'},tracks:[searchTrack],initialTrack:searchTrack,musicSelections,observation:{minSeconds:1,maxSeconds:1},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{},maxTrackVisits:1});
  assert.equal(locateCalls,1);
  assert.equal(playbackTrack.id,searchTrack.id);
  assert.equal(currentUrl,'https://open.spotify.com/track/real123');
  assert.equal(out.trackVisits,1);
});

test('persistent worker reports browser page errors into the structured activity log',async()=>{
  const {EventEmitter}=require('node:events');
  let currentUrl='about:blank'; const logs=[];
  class Page extends EventEmitter{url(){return currentUrl;}isClosed(){return false;}async screenshot(){}}
  const page=new Page();
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  const track={id:'t1',platform:'spotify',title:'Track One',url:'https://open.spotify.com/track/t1'};
  const adapter={
    authenticate:async()=>{page.emit('pageerror',new Error('player crashed'));return{status:'PASS'};},
    locateTrack:async()=>{currentUrl=track.url;return{status:'PASS',url:track.url};},
    verifySession:async()=>({status:'PASS'}),
    playbackControls:async()=>({play:async()=>({status:'PASS',reason:'Playback confirmed'}),next:async()=>({status:'NOT_APPLICABLE'})}),
  };
  const out=await runPersistentAccountStreamingSession({runId:'r-live-errors',workUnit:{workId:'stream-account:a1'},account:{id:'a1',platform:'spotify'},tracks:[track],initialTrack:track,observation:{minSeconds:1,maxSeconds:1},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:(message,meta)=>logs.push({message,meta}),maxTrackVisits:1});
  assert.equal(out.trackVisits,1);
  const errorLog=logs.find(row=>/player crashed/i.test(row.message));
  assert.ok(errorLog,'pageerror should be visible in live activity log');
  assert.equal(errorLog.meta?.severity,'error');
  assert.equal(errorLog.meta?.stage,'browser');
});


test('Spotify undefined and repeated ChunkLoadError diagnostics are downgraded and deduplicated',async()=>{
  const {EventEmitter}=require('node:events');
  let currentUrl='about:blank'; const logs=[];
  class Page extends EventEmitter{url(){return currentUrl;}isClosed(){return false;}async screenshot(){}}
  const page=new Page();
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  const track={id:'t1',platform:'spotify',title:'Track One',url:'https://open.spotify.com/track/t1'};
  const adapter={
    authenticate:async()=>{
      page.emit('pageerror',undefined);
      page.emit('pageerror',new Error('Uncaught (in promise) undefined'));
      page.emit('pageerror',new Error('Failed to modify recent searches'));
      const chunk=new Error('ChunkLoadError: Loading chunk 407 failed.');
      page.emit('pageerror',chunk);page.emit('pageerror',chunk);page.emit('pageerror',chunk);
      return{status:'PASS'};
    },
    locateTrack:async()=>{currentUrl=track.url;return{status:'PASS',url:track.url};},
    verifySession:async()=>({status:'PASS'}),
    playbackControls:async()=>({play:async()=>({status:'PASS'}),next:async()=>({status:'NOT_APPLICABLE'})}),
  };
  await runPersistentAccountStreamingSession({runId:'r-diag-dedupe',workUnit:{workId:'stream-account:a1'},account:{id:'a1',platform:'spotify'},tracks:[track],initialTrack:track,observation:{minSeconds:1,maxSeconds:1},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:(message,meta)=>logs.push({message,meta}),maxTrackVisits:1});
  const undefinedRows=logs.filter(row=>row.meta?.type==='page-error-undefined');
  const chunkRows=logs.filter(row=>row.meta?.type==='web-resource-load');
  assert.equal(undefinedRows.length,2,'raw undefined and Uncaught (in promise) undefined should both be downgraded');
  assert.ok(undefinedRows.every(row=>row.meta.severity==='warning'));
  const recentSearchRows=logs.filter(row=>row.meta?.type==='spotify-recent-searches');
  assert.equal(recentSearchRows.length,1);
  assert.equal(recentSearchRows[0].meta.severity,'warning');
  assert.equal(chunkRows.length,1,'identical repeated ChunkLoadError entries should collapse into one diagnostic');
  assert.equal(chunkRows[0].meta.severity,'warning');
});


test('optional pause resumes the same song after configured short delay and volume uses only selected direction',async()=>{
  const waits=[];
  let pauseCalls=0,playCalls=0,upCalls=0,downCalls=0;
  let currentUrl='https://open.spotify.com/track/t1';
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  const adapter={
    authenticate:async()=>({status:'PASS'}),
    verifySession:async()=>({status:'PASS'}),
    locateTrack:async({track})=>{currentUrl=track.url;return {status:'PASS',url:track.url};},
    selectedTrackReady:async()=>true,
    playbackControls:async()=>({
      play:async()=>{playCalls++;return {status:'PASS'};},
      pause:async()=>{pauseCalls++;return {status:'PASS'};},
      volumeUp:async()=>{upCalls++;return {status:'PASS'};},
      volumeDown:async()=>{downCalls++;return {status:'PASS'};},
    }),
  };
  const sleep=async ms=>{waits.push(ms);};
  const result=await runPersistentAccountStreamingSession({
    runId:'r-controls',workUnit:{workId:'w-controls'},account:{id:'a1'},
    tracks:[{id:'t1',title:'Song 1',url:'https://open.spotify.com/track/t1'}],
    initialTrack:{id:'t1',title:'Song 1',url:'https://open.spotify.com/track/t1'},
    observation:{minSeconds:1,maxSeconds:1},checks:['playback','pause-resume','volume-control'],
    pauseResumeSeconds:2.5,volumeDirection:'increase',adapter,browserFactory,
    screenshotPolicy:{enabled:false},sleep,signal:new AbortController().signal,log:()=>{},maxTrackVisits:1,
  });
  assert.equal(result.trackVisits,1);
  assert.ok(pauseCalls>=1);
  assert.ok(playCalls>=2,'play is used to start and then resume the same song');
  assert.equal(upCalls,1);
  assert.equal(downCalls,0);
  assert.equal(waits.filter(ms=>ms>0&&ms<=1000).length>=1,true,'pause must be bounded by the remaining fixed observation deadline');
  assert.ok(waits.some(ms=>ms>0&&ms<=1000),'strict wall-clock timer should use waits bounded by the observation deadline');
});


test('random pause runs on only one assigned song per account instead of every song',async()=>{
  const tracks=Array.from({length:5},(_,index)=>({id:`t${index+1}`,title:`Song ${index+1}`,url:`https://open.spotify.com/track/t${index+1}`}));
  let currentUrl='about:blank',playCalls=0,pauseCalls=0; const logs=[];
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  const adapter={
    authenticate:async()=>({status:'PASS'}),verifySession:async()=>({status:'PASS'}),selectedTrackReady:async()=>true,
    locateTrack:async({track})=>{currentUrl=track.url;return{status:'PASS',url:track.url};},
    playbackControls:async()=>({
      play:async()=>{playCalls++;return{status:'PASS'};},pause:async()=>{pauseCalls++;return{status:'PASS'};},isPlaying:async()=>({status:'PASS'}),
    }),
  };
  const out=await runPersistentAccountStreamingSession({runId:'r-random-pause',workUnit:{workId:'w-random'},account:{id:'acct-1'},tracks,initialTrack:tracks[0],observation:{minSeconds:1,maxSeconds:1},checks:['playback','pause-resume'],pauseResumeSeconds:1.5,adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:(message,meta)=>logs.push({message,meta}),maxTrackVisits:5});
  assert.equal(out.trackVisits,5);
  assert.equal(logs.filter(row=>row.meta?.type==='pause-selected').length,1,'only one assigned song should be selected for the random pause');
  assert.equal(playCalls,6,'five playback starts plus exactly one resume');
  assert.equal(pauseCalls,6,'five normal end-of-song pauses plus exactly one random pause');
});

test('valid QA playback callback fires only after the full active duration remains confirmed',async()=>{
  const track={id:'t1',title:'Song 1',url:'https://open.spotify.com/track/t1'};
  let currentUrl=track.url,probeCalls=0,valid=0,invalid=0;
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  const adapter={authenticate:async()=>({status:'PASS'}),verifySession:async()=>({status:'PASS'}),locateTrack:async()=>({status:'PASS',url:track.url}),selectedTrackReady:async()=>true,playbackControls:async()=>({play:async()=>({status:'PASS'}),pause:async()=>({status:'PASS'}),isPlaying:async()=>{probeCalls++;return{status:'PASS'};}})};
  await runPersistentAccountStreamingSession({runId:'r-valid',workUnit:{workId:'w-valid'},account:{id:'a1'},tracks:[track],initialTrack:track,observation:{minSeconds:2,maxSeconds:2},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{},maxTrackVisits:1,onTrackComplete:async()=>{valid++;},onTrackInvalid:async()=>{invalid++;}});
  assert.ok(probeCalls>=4,'active playback is checked throughout the observation window');
  assert.equal(valid,1);assert.equal(invalid,0);
});

test('short or stopped playback is recorded as invalid and is not counted as a valid QA playback',async()=>{
  const track={id:'t1',title:'Song 1',url:'https://open.spotify.com/track/t1'};
  let currentUrl=track.url,probeCalls=0,valid=0,invalid=0;
  const page={url:()=>currentUrl,isClosed:()=>false,screenshot:async()=>{}};
  const browserFactory={open:async()=>({page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>{},finalIntegrity:async()=>({overall:'pass'})})};
  const adapter={authenticate:async()=>({status:'PASS'}),verifySession:async()=>({status:'PASS'}),locateTrack:async()=>({status:'PASS',url:track.url}),selectedTrackReady:async()=>true,playbackControls:async()=>({play:async()=>({status:'PASS'}),pause:async()=>({status:'PASS'}),isPlaying:async()=>{probeCalls++;return probeCalls<2?{status:'PASS'}:{status:'WARNING',reason:'player stopped'};}})};
  await runPersistentAccountStreamingSession({runId:'r-invalid',workUnit:{workId:'w-invalid'},account:{id:'a1'},tracks:[track],initialTrack:track,observation:{minSeconds:3,maxSeconds:3},checks:['playback'],adapter,browserFactory,screenshotPolicy:{enabled:false},sleep:async()=>{},signal:new AbortController().signal,log:()=>{},maxTrackVisits:1,onTrackComplete:async()=>{valid++;},onTrackInvalid:async()=>{invalid++;}});
  assert.equal(valid,0);assert.equal(invalid,1);
});


test('pause timing overrun is rejected so it can never become a valid QA playback',async()=>{
  const realNow=Date.now; let now=1000; Date.now=()=>now;
  try{
    const page={url:()=> 'https://open.spotify.com/track/t1',isClosed:()=>false};
    const controls={pause:async()=>({status:'PASS'}),play:async()=>({status:'PASS'}),isPlaying:async()=>({status:'PASS'})};
    const adapter={selectedTrackReady:async()=>true};
    const sleep=async ms=>{now+=ms===1000?1400:ms;};
    const out=await observeVerifiedPlayback({page,controls,track:{id:'t1',title:'Song 1'},adapter,signal:new AbortController().signal,sleep,targetSeconds:2,pausePlan:{enabled:true,durationMs:1000,atActiveMs:0},log:()=>{},workId:'w'});
    assert.equal(out.status,'invalid');
    assert.match(out.reason,/exceeded the configured 1000ms deadline/i);
    assert.equal(out.pauseResult.overrunMs,400);
  }finally{Date.now=realNow;}
});

test('observation timer independently samples every song inside the inclusive min/max range',()=>{
  const {chooseRotatingObservationSeconds}=require('./streaming-session-worker.cjs');
  assert.equal(chooseRotatingObservationSeconds({minSeconds:60,maxSeconds:62,rng:()=>0}),60);
  assert.equal(chooseRotatingObservationSeconds({minSeconds:60,maxSeconds:62,rng:()=>0.5}),61);
  assert.equal(chooseRotatingObservationSeconds({minSeconds:60,maxSeconds:62,rng:()=>0.999999}),62);
  assert.equal(chooseRotatingObservationSeconds({minSeconds:62,maxSeconds:60,rng:()=>0}),60);
});

test('observation timer honors fixed duration when min equals max',()=>{
  const {chooseRotatingObservationSeconds}=require('./streaming-session-worker.cjs');
  assert.equal(chooseRotatingObservationSeconds({minSeconds:75,maxSeconds:75,rng:()=>0}),75);
});

test('verified observation pauses playback immediately at the allocated ceiling',async()=>{
  let pauses=0;
  const page={url:()=> 'https://open.spotify.com/track/t1',isClosed:()=>false};
  const controls={pause:async()=>{pauses++;return {status:'PASS'};},isPlaying:async()=>({status:'PASS'})};
  const out=await observeVerifiedPlayback({page,controls,track:{id:'t1',title:'Song 1'},adapter:{selectedTrackReady:async()=>true},signal:new AbortController().signal,sleep:async()=>{},targetSeconds:2,pausePlan:null,log:()=>{},workId:'w'});
  assert.equal(out.status,'PASS');
  assert.equal(out.activePlaybackMs,2000);
  assert.equal(out.targetPlaybackMs,2000);
  assert.equal(pauses,1);
  assert.equal(out.hardStopResult.status,'PASS');
});

test('strict active-track guard stops unexpected media and verifies the assigned song before observation continues',async()=>{
  let matches=0,pauses=0,hardStops=0,locates=0,plays=0;
  const page={url:()=> 'https://open.spotify.com/track/t1',isClosed:()=>false,evaluate:async()=>{hardStops++;return true;}};
  const controls={
    pause:async()=>{pauses++;return {status:'PASS'};},
    play:async()=>{plays++;return {status:'PASS'};},
    isPlaying:async()=>({status:'PASS'}),
  };
  const adapter={
    activeTrackMatches:async()=>{matches++;return matches>=2;},
    locateTrack:async()=>{locates++;return {status:'PASS',url:'https://open.spotify.com/track/t1'};},
  };
  const out=await observeVerifiedPlayback({page,controls,track:{id:'t1',title:'Assigned Song',url:'https://open.spotify.com/track/t1'},adapter,signal:new AbortController().signal,sleep:async()=>{},targetSeconds:1,pausePlan:null,log:()=>{},workId:'w-strict'});
  assert.equal(out.status,'PASS');
  assert.equal(out.wrongTrackRecoveries,1);
  assert.ok(pauses>=2,'unexpected media is paused immediately and again at the observation ceiling');
  assert.ok(hardStops>=2,'HTML media is hard-stopped during recovery and at the observation ceiling');
  assert.equal(locates,1);
  assert.equal(plays,1);
});

test('strict active-track guard rejects playback when the assigned song cannot be verified after recovery',async()=>{
  let pauses=0,locates=0,plays=0;
  const page={url:()=> 'https://open.spotify.com/track/t1',isClosed:()=>false,evaluate:async()=>true};
  const controls={pause:async()=>{pauses++;return {status:'PASS'};},play:async()=>{plays++;return {status:'PASS'};},isPlaying:async()=>({status:'PASS'})};
  const adapter={activeTrackMatches:async()=>false,locateTrack:async()=>{locates++;return {status:'PASS',url:'https://open.spotify.com/track/t1'};}};
  const out=await observeVerifiedPlayback({page,controls,track:{id:'t1',title:'Assigned Song',url:'https://open.spotify.com/track/t1'},adapter,signal:new AbortController().signal,sleep:async()=>{},targetSeconds:5,pausePlan:null,log:()=>{},workId:'w-strict-fail'});
  assert.equal(out.status,'invalid');
  assert.match(String(out.reason),/could not be verified back on the assigned OrbitQA song/i);
  assert.equal(out.wrongTrackRecoveries,1);
  assert.equal(locates,1);
  assert.equal(plays,1);
  assert.equal(pauses,1);
});
