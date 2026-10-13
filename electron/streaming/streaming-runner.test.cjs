const test=require('node:test'); const assert=require('node:assert/strict'); const {executeStreamingRun}=require('./streaming-runner.cjs');

test('streaming runner creates one persistent browser task per selected account', async()=>{
  const events=[]; let active=0, peak=0; const calls=[];
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'u1',title:'A'},{id:'t2',url:'u2',title:'B'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',label:id,proxySource:'none'})};
  const adapter={id:'spotify'};
  const runSession=async({workUnit,tracks})=>{active++;peak=Math.max(peak,active);calls.push({workId:workUnit.workId,tracks:tracks.length}); await new Promise(r=>setTimeout(r,5)); active--; return {reason:'browser-closed',trackVisits:2};};
  const summary=await executeStreamingRun({runId:'R',request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1','t2'],accountIds:['a1','a2'],slots:1,queueMode:'sequential',observation:{minSeconds:1,maxSeconds:1},checks:['playback'],executionMode:'background',captureScreenshots:false},emit:e=>events.push(e),signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>adapter},runSession,globalRunScheduler:null,checkpoint:{terminalWorkIds:[]}});
  assert.equal(summary.total,2); assert.equal(summary.completed,2); assert.equal(calls.length,2); assert.equal(peak,2); assert.ok(calls.every(call=>call.tracks===2)); assert.ok(events.some(e=>e.type==='session-start')); assert.ok(events.some(e=>e.type==='streaming-summary'));
});

test('resume skips terminal persistent streaming account work ids', async()=>{
  let calls=0; const collectionStore={get:()=>({tracks:[{id:'t1',url:'u1',title:'A'}]})}; const accountStore={getInternal:id=>({id,platform:'spotify',proxySource:'none'})};
  const summary=await executeStreamingRun({runId:'R',request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1'],accountIds:['a1','a2'],slots:1,queueMode:'sequential',observation:{minSeconds:1,maxSeconds:1},checks:['playback']},emit:()=>{},signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},runSession:async()=>{calls++;return{reason:'browser-closed',trackVisits:1}},checkpoint:{terminalWorkIds:['stream-account:a1']}});
  assert.equal(calls,1); assert.equal(summary.total,2); assert.equal(summary.completed,2);
});

test('streaming runner forwards configured rest policy into the persistent account worker', async()=>{
  let restPolicy=null;
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'u1',title:'A'},{id:'t2',url:'u2',title:'B'},{id:'t3',url:'u3',title:'C'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',proxySource:'none'})};
  const summary=await executeStreamingRun({runId:'R-rest',request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1','t2','t3'],accountIds:['a1'],slots:1,queueMode:'sequential',observation:{minSeconds:1,maxSeconds:1},checks:['playback'],restAfterTracks:2,restMinutes:3},emit:()=>{},signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},runSession:async payload=>{restPolicy={restAfterTracks:payload.restAfterTracks,restMinutes:payload.restMinutes};return{reason:'browser-closed',trackVisits:3}},checkpoint:{terminalWorkIds:[]}});
  assert.equal(summary.completed,1);
  assert.deepEqual(restPolicy,{restAfterTracks:2,restMinutes:3});
});

test('slots never double-assign the same streaming account concurrently', async()=>{
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'u1',title:'A'},{id:'t2',url:'u2',title:'B'},{id:'t3',url:'u3',title:'C'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',proxySource:'none'})};
  const activeByAccount=new Map(); let doubleAssigned=false; let peak=0;
  await executeStreamingRun({runId:'R-slots',request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1','t2','t3'],accountIds:['a1','a2'],slots:2,queueMode:'sequential',observation:{minSeconds:1,maxSeconds:1},checks:['playback']},emit:()=>{},signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},runSession:async({account})=>{const next=(activeByAccount.get(account.id)||0)+1;activeByAccount.set(account.id,next);if(next>1) doubleAssigned=true;peak=Math.max(peak,[...activeByAccount.values()].filter(v=>v>0).length);await new Promise(r=>setTimeout(r,5));activeByAccount.set(account.id,next-1);return{};},checkpoint:{terminalWorkIds:[]}});
  assert.equal(doubleAssigned,false);
  assert.equal(peak,2);
});

test('streaming runner persists a reusable full session without falsely adding human verification status', async()=>{
  const saves=[];
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'u1',title:'A'}]})};
  const accountStore={
    getInternal:id=>({id,platform:'spotify',proxySource:'none',authMode:'credentials',username:'qa@example.com',password:'secret',status:'unverified'}),
    save:value=>{saves.push(value);return value;}
  };
  const envelope=JSON.stringify({version:2,kind:'playwright-storage-state',capturedAt:'now',storageState:{cookies:[{name:'sp_dc',value:'authorized-cookie',domain:'.spotify.com',path:'/'}],origins:[]}});
  await executeStreamingRun({
    runId:'R-auth-persist',
    request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1'],accountIds:['a1'],slots:1,queueMode:'sequential',observation:{minSeconds:1,maxSeconds:1},checks:['playback']},
    emit:()=>{},
    signal:new AbortController().signal,
    collectionStore,
    accountStore,
    adapterRegistry:{get:()=>({id:'spotify'})},
    runSession:async({persistAuthorizedSession})=>{await persistAuthorizedSession(envelope);return {};},
    checkpoint:{terminalWorkIds:[]}
  });
  assert.equal(saves.length,1);
  assert.equal(saves[0].id,'a1');
  assert.equal(saves[0].status,'unverified');
  assert.equal(saves[0].sessionSecret,envelope);
  assert.equal(JSON.parse(saves[0].sessionSecret).kind,'playwright-storage-state');
  assert.equal(saves[0].lastVerifiedAt,undefined);
});

test('streaming work units carry the selected device mode and profile into each browser session',()=>{
  const {makeWorkUnits}=require('./streaming-runner.cjs');
  const tracks=[{id:'t1',url:'https://example.com/t1'}];
  const units=makeWorkUnits({accountIds:['a1'],queueMode:'sequential',deviceMode:'ios',deviceProfile:'iPhone 13',executionMode:'visible'},tracks);
  assert.equal(units[0].deviceMode,'ios');
  assert.equal(units[0].deviceProfile,'iPhone 13');
});

test('mixed device mode rotates only through the device families the user selected',()=>{
  const {makeWorkUnits}=require('./streaming-runner.cjs');
  const tracks=[1,2,3,4].map(n=>({id:`t${n}`,url:`https://example.com/t${n}`}));
  const units=makeWorkUnits({
    accountIds:['a1'],queueMode:'sequential',executionMode:'visible',deviceMode:'mixed',
    mixedDeviceModes:['desktop','ios'],
    mixedDeviceProfiles:{desktop:'Desktop 1280x720',android:'Galaxy S23',ios:'iPad Mini'},
  },tracks);
  assert.deepEqual(units.map(unit=>unit.deviceMode),['desktop','ios','desktop','ios']);
  assert.deepEqual(units.map(unit=>unit.deviceProfile),['Desktop 1280x720','iPad Mini','Desktop 1280x720','iPad Mini']);
});

test('mixed device mode supports a single selected family without silently adding others',()=>{
  const {makeWorkUnits}=require('./streaming-runner.cjs');
  const tracks=[{id:'t1',url:'u1'},{id:'t2',url:'u2'}];
  const units=makeWorkUnits({accountIds:['a1'],queueMode:'sequential',deviceMode:'mixed',mixedDeviceModes:['android'],mixedDeviceProfiles:{android:'Galaxy S23'}},tracks);
  assert.deepEqual(units.map(unit=>unit.deviceMode),['android','android']);
  assert.deepEqual(units.map(unit=>unit.deviceProfile),['Galaxy S23','Galaxy S23']);
});

test('streaming runner stores a canonical v2 full session unchanged and never downgrades it to cookie-only JSON',async()=>{
  const saves=[];
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'u1',title:'A'}]})};
  const original={id:'a1',platform:'spotify',proxySource:'none',authMode:'credentials',username:'qa@example.com',password:'secret',status:'ready'};
  const accountStore={getInternal:()=>({...original}),save:value=>{saves.push(value);return {...original,...value}}};
  const envelope=JSON.stringify({version:2,kind:'playwright-storage-state',capturedAt:'2026-09-18T16:20:00.000Z',storageState:{cookies:[{name:'sp_dc',value:'authorized-cookie',domain:'.spotify.com',path:'/'}],origins:[{origin:'https://open.spotify.com',localStorage:[{name:'session',value:'ready'}]}]}});
  await executeStreamingRun({runId:'R-auth-v2',request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1'],accountIds:['a1'],slots:1,queueMode:'sequential',observation:{minSeconds:1,maxSeconds:1},checks:['playback']},emit:()=>{},signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},runSession:async({persistAuthorizedSession})=>{await persistAuthorizedSession(envelope);return{}},checkpoint:{terminalWorkIds:[]}});
  assert.equal(saves.length,1);
  assert.equal(saves[0].sessionSecret,envelope);
  assert.equal(JSON.parse(saves[0].sessionSecret).kind,'playwright-storage-state');
  assert.equal(saves[0].status,'ready');
});

test('persistent account plans create one long-lived work unit per account with balanced initial tracks',()=>{
  const {makePersistentAccountPlans}=require('./streaming-runner.cjs');
  const tracks=Array.from({length:5},(_,i)=>({id:`t${i+1}`,url:`https://music.example/t${i+1}`}));
  const plans=makePersistentAccountPlans({accountIds:Array.from({length:10},(_,i)=>`a${i+1}`),deviceMode:'desktop',deviceProfile:'Desktop 1280x720',runSeed:'r'},tracks);
  assert.equal(plans.length,10);
  assert.equal(new Set(plans.map(plan=>plan.workId)).size,10);
  const counts=new Map();
  for(const plan of plans) counts.set(plan.initialTrack.id,(counts.get(plan.initialTrack.id)||0)+1);
  assert.deepEqual([...counts.values()].sort((a,b)=>a-b),[2,2,2,2,2]);
});

test('persistent runner starts every selected account even when legacy slots is lower',async()=>{
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'https://music.example/t1',title:'A'},{id:'t2',url:'https://music.example/t2',title:'B'},{id:'t3',url:'https://music.example/t3',title:'C'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',label:id,proxySource:'none'})};
  let active=0,peak=0; const calls=[];
  const summary=await executeStreamingRun({runId:'R-persistent',request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1','t2','t3'],accountIds:['a1','a2','a3'],slots:1,observation:{minSeconds:1,maxSeconds:2},checks:['playback']},emit:()=>{},signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},runSession:async({account,tracks,initialTrack})=>{active++;peak=Math.max(peak,active);calls.push({account:account.id,trackCount:tracks.length,initial:initialTrack.id});await new Promise(r=>setTimeout(r,5));active--;return {reason:'browser-closed',trackVisits:2};},checkpoint:{terminalWorkIds:[]}});
  assert.equal(calls.length,3);
  assert.equal(peak,3);
  assert.equal(summary.total,3);
  assert.equal(summary.completed,3);
  assert.equal(new Set(calls.map(call=>call.initial)).size,3);
});

test('persistent runner resume skips terminal account session ids instead of account-track ids',async()=>{
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'https://music.example/t1'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',proxySource:'none'})};
  const calls=[];
  const summary=await executeStreamingRun({runId:'R-resume-account',request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1'],accountIds:['a1','a2'],slots:1,observation:{minSeconds:1,maxSeconds:1},checks:['playback']},emit:()=>{},signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},runSession:async({account})=>{calls.push(account.id);return {reason:'browser-closed',trackVisits:1};},checkpoint:{terminalWorkIds:['stream-account:a1']}});
  assert.deepEqual(calls,['a2']);
  assert.equal(summary.total,2);
  assert.equal(summary.completed,2);
});

test('persistent runner passes rest policy and selected track pool into the one account browser',async()=>{
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'u1'},{id:'t2',url:'u2'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',proxySource:'none'})};
  let received=null;
  await executeStreamingRun({runId:'R-rest-persistent',request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1','t2'],accountIds:['a1'],slots:1,observation:{minSeconds:5,maxSeconds:9},checks:['playback'],restAfterTracks:2,restMinutes:3},emit:()=>{},signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},runSession:async payload=>{received=payload;return {reason:'browser-closed',trackVisits:2};},checkpoint:{terminalWorkIds:[]}});
  assert.equal(received.tracks.length,2);
  assert.deepEqual(received.observation,{minSeconds:5,maxSeconds:9});
  assert.equal(received.restAfterTracks,2);
  assert.equal(received.restMinutes,3);
});

test('manual close of one persistent account worker does not cancel the other account worker',async()=>{
  const calls=[];
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'https://music.example/t1'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',label:id,proxySource:'none'})};
  const controller=new AbortController();
  const summary=await executeStreamingRun({
    runId:'R-manual-isolation',
    request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1'],accountIds:['a1','a2'],slots:1,observation:{minSeconds:1,maxSeconds:1},checks:['playback']},
    emit:()=>{},signal:controller.signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},
    runSession:async({account})=>{
      calls.push(`start:${account.id}`);
      if(account.id==='a1') return {reason:'browser-closed',trackVisits:0};
      await new Promise(resolve=>setTimeout(resolve,10));
      calls.push('a2:continued');
      return {reason:'browser-closed',trackVisits:1};
    },
    checkpoint:{terminalWorkIds:[]},
  });
  assert.equal(controller.signal.aborted,false);
  assert.ok(calls.includes('a2:continued'));
  assert.equal(summary.completed,2);
  assert.equal(summary.failed,0);
});

test('persistent runner refuses to pair a selected account with a different platform',async()=>{
  const collectionStore={get:()=>({tracks:[{id:'t1',platform:'spotify',url:'https://open.spotify.com/track/t1'}]})};
  const accountStore={getInternal:()=>({id:'a1',platform:'deezer',proxySource:'none'})};
  const events=[];
  const summary=await executeStreamingRun({runId:'R-platform-account',request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1'],accountIds:['a1'],slots:1,observation:{minSeconds:1,maxSeconds:1},checks:['playback']},emit:e=>events.push(e),signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},runSession:async()=>{throw new Error('must not launch mismatched account');},checkpoint:{terminalWorkIds:[]}});
  assert.equal(summary.failed,1);
  assert.ok(events.some(event=>event.type==='session-error'&&/belongs to deezer/i.test(event.message)));
});

test('persistent runner uses only selected tracks for the active platform',async()=>{
  const collectionStore={get:()=>({tracks:[
    {id:'s1',platform:'spotify',url:'https://open.spotify.com/track/s1'},
    {id:'d1',platform:'deezer',url:'https://www.deezer.com/track/d1'},
  ]})};
  const accountStore={getInternal:()=>({id:'a1',platform:'spotify',proxySource:'none'})};
  let received=[];
  const summary=await executeStreamingRun({runId:'R-platform-tracks',request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['s1','d1'],accountIds:['a1'],slots:1,observation:{minSeconds:1,maxSeconds:1},checks:['playback']},emit:()=>{},signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},runSession:async({tracks})=>{received=tracks;return {reason:'browser-closed',trackVisits:1};},checkpoint:{terminalWorkIds:[]}});
  assert.equal(summary.failed,0);
  assert.deepEqual(received.map(track=>track.id),['s1']);
});

test('real persistent worker flow opens one browser per selected account, plays selected songs repeatedly, and closes them only on STOP',async()=>{
  const {runPersistentAccountStreamingSession}=require('./streaming-session-worker.cjs');
  const controller=new AbortController();
  const tracks=[
    {id:'s1',platform:'spotify',title:'Song 1',url:'https://open.spotify.com/track/s1'},
    {id:'s2',platform:'spotify',title:'Song 2',url:'https://open.spotify.com/track/s2'},
  ];
  const collectionStore={get:()=>({tracks})};
  const accountStore={getInternal:id=>({id,platform:'spotify',label:id,proxySource:'none'}),save:value=>value};
  const opened=new Map(); const closed=new Map(); const played=new Map(); const located=new Map();
  const browserFactory={open:async({account})=>{
    opened.set(account.id,(opened.get(account.id)||0)+1);
    const page={accountId:account.id,currentUrl:'about:blank',url(){return this.currentUrl;},isClosed:()=>false,screenshot:async()=>{}};
    return {page,context:{storageState:async()=>({cookies:[],origins:[]})},close:async()=>closed.set(account.id,(closed.get(account.id)||0)+1),finalIntegrity:async()=>({overall:'pass'})};
  }};
  const adapter={
    id:'spotify',
    authenticate:async()=>({status:'PASS'}),
    verifySession:async()=>({status:'PASS'}),
    locateTrack:async({page,track})=>{page.currentUrl=track.url;const rows=located.get(page.accountId)||[];rows.push(track.id);located.set(page.accountId,rows);return {status:'PASS',url:track.url};},
    playbackControls:async({page})=>({
      play:async()=>{
        played.set(page.accountId,(played.get(page.accountId)||0)+1);
        if(['a1','a2'].every(id=>(played.get(id)||0)>=2)) controller.abort();
        return {status:'PASS'};
      },
      next:async()=>({status:'NOT_APPLICABLE'}),
    }),
  };
  await assert.rejects(()=>executeStreamingRun({
    runId:'R-real-persistent-stop',
    request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['s1','s2'],accountIds:['a1','a2'],slots:1,observation:{minSeconds:1,maxSeconds:1},checks:['playback'],executionMode:'visible'},
    emit:()=>{},signal:controller.signal,collectionStore,accountStore,adapterRegistry:{get:()=>adapter},browserFactory,
    runSession:payload=>runPersistentAccountStreamingSession({...payload,sleep:async()=>{}}),checkpoint:{terminalWorkIds:[]},
  }),error=>error?.name==='AbortError');
  assert.deepEqual([...opened.entries()].sort(),[['a1',1],['a2',1]]);
  assert.deepEqual([...closed.entries()].sort(),[['a1',1],['a2',1]]);
  assert.ok((played.get('a1')||0)>=2);
  assert.ok((played.get('a2')||0)>=2);
  for(const id of ['a1','a2']) assert.ok((located.get(id)||[]).every(trackId=>['s1','s2'].includes(trackId)));
});

test('persistent runner passes the selected QA MUSIC SELECTION source link and its saved songs to the account worker',async()=>{
  const collection={
    id:'album-1',name:'My Saved Album',platform:'spotify',sourceKind:'album',
    sourceInput:'https://open.spotify.com/album/album123?si=original-saved-link',canonicalSourceInput:'https://open.spotify.com/album/album123',
    tracks:[
      {id:'s1',platform:'spotify',title:'Song 1',url:'https://open.spotify.com/track/song111'},
      {id:'s2',platform:'spotify',title:'Song 2',url:'https://open.spotify.com/track/song222'},
    ],
  };
  const collectionStore={get:id=>id==='album-1'?collection:null};
  const accountStore={getInternal:()=>({id:'a1',platform:'spotify',proxySource:'static',proxyId:'p1'})};
  let receivedSelections=[];
  const summary=await executeStreamingRun({
    runId:'R-music-selection',
    request:{runKind:'streaming',platform:'spotify',collectionIds:['album-1'],trackIds:['s1','s2'],accountIds:['a1'],slots:1,observation:{minSeconds:1,maxSeconds:1},checks:['playback']},
    emit:()=>{},signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},
    runSession:async({musicSelections})=>{receivedSelections=musicSelections;return {reason:'browser-closed',trackVisits:1};},
    checkpoint:{terminalWorkIds:[]},
  });
  assert.equal(summary.failed,0);
  assert.equal(receivedSelections.length,1);
  assert.equal(receivedSelections[0].sourceInput,collection.sourceInput);
  assert.equal(receivedSelections[0].sourceKind,'album');
  assert.deepEqual(receivedSelections[0].tracks.map(track=>track.id),['s1','s2']);
});

test('streaming runner enriches live activity events with account and platform context', async()=>{
  const events=[];
  const collectionStore={get:()=>({tracks:[{id:'t1',platform:'spotify',url:'https://open.spotify.com/track/t1',title:'Track One'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',label:'QA Account',proxySource:'none'})};
  await executeStreamingRun({
    runId:'R-live-log',
    request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1'],accountIds:['a1'],observation:{minSeconds:1,maxSeconds:1},checks:['playback']},
    emit:event=>events.push(event),
    signal:new AbortController().signal,
    collectionStore,
    accountStore,
    adapterRegistry:{get:()=>({id:'spotify'})},
    runSession:async({log})=>{log('Play control retry',{severity:'warning',stage:'playback',action:'click-play',trackId:'t1',currentUrl:'https://open.spotify.com/track/t1?si=secret'});return{reason:'browser-closed',trackVisits:1};},
    checkpoint:{terminalWorkIds:[]},
  });
  const row=events.find(event=>event.message==='Play control retry');
  assert.ok(row);
  assert.equal(row.accountId,'a1');
  assert.equal(row.accountLabel,'QA Account');
  assert.equal(row.platform,'spotify');
  assert.equal(row.severity,'warning');
  assert.equal(row.stage,'playback');
  assert.equal(row.action,'click-play');
  assert.equal(row.currentUrl,'https://open.spotify.com/track/t1');
});

test('live streaming events distinguish workers when selected accounts share the same visible label',async()=>{
  const events=[];
  const collectionStore={get:()=>({tracks:[{id:'t1',platform:'spotify',url:'https://open.spotify.com/track/t1',title:'Song 1'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',label:'Spotify QA account',proxySource:'none'})};
  await executeStreamingRun({
    runId:'R-worker-identity',
    request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1'],accountIds:['account-alpha-111111','account-beta-222222'],observation:{minSeconds:1,maxSeconds:1},checks:['playback']},
    emit:event=>events.push(event),signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},
    runSession:async({account,log})=>{log(`worker active for ${account.id}`,{stage:'browser',action:'identity-check'});return {reason:'browser-closed',trackVisits:1};},
    checkpoint:{terminalWorkIds:[]},
  });
  const starts=events.filter(event=>event.type==='session-start');
  assert.equal(starts.length,2);
  assert.deepEqual(starts.map(event=>event.workerIndex).sort((a,b)=>a-b),[1,2]);
  assert.equal(new Set(starts.map(event=>event.workerLabel)).size,2,'each browser must have a distinct worker label even when account labels match');
  assert.ok(starts.every(event=>/Worker #\d+/.test(event.workerLabel||'')));
  const activity=events.filter(event=>event.action==='identity-check');
  assert.equal(activity.length,2);
  assert.equal(new Set(activity.map(event=>event.workerLabel)).size,2,'worker identity must be preserved on nested live-log activity');
});

test('group plans preserve order, keep each account in one group, and cap per-account QA songs to the selected pool',()=>{
  const {normalizeGroupPlans}=require('./streaming-runner.cjs');
  const tracks=[{id:'t1'},{id:'t2'},{id:'t3'}];
  const groups=normalizeGroupPlans({accountIds:['a1','a2','a3','a4'],groupPlans:[
    {groupId:'Group 1',accountIds:['a1','a2'],trackMode:'count',trackCount:99},
    {groupId:'Group 2',accountIds:['a2','a3'],trackMode:'count',trackCount:2},
  ]},tracks);
  assert.deepEqual(groups.map(group=>group.groupId),['Group 1','Group 2','Ungrouped']);
  assert.deepEqual(groups[0].accountIds,['a1','a2']);
  assert.equal(groups[0].trackCount,3);
  assert.deepEqual(groups[1].accountIds,['a3']);
  assert.equal(groups[1].trackCount,2);
  assert.deepEqual(groups[2].accountIds,['a4']);
  assert.equal(groups[2].trackCount,3);
});

test('grouped streaming executes groups sequentially while accounts inside one group may run together',async()=>{
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'u1'},{id:'t2',url:'u2'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',proxySource:'none'})};
  const order=[];
  await executeStreamingRun({
    runId:'R-groups',
    request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1','t2'],accountIds:['a1','a2','a3'],groupPlans:[
      {groupId:'Group 1',accountIds:['a1','a2'],trackMode:'count',trackCount:1},
      {groupId:'Group 2',accountIds:['a3'],trackMode:'all'},
    ],observation:{minSeconds:1,maxSeconds:1},checks:['playback']},
    emit:()=>{},signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},
    runSession:async({account,workUnit})=>{order.push(`start:${workUnit.groupId}:${account.id}`);await new Promise(r=>setTimeout(r,account.id==='a1'?8:3));order.push(`end:${workUnit.groupId}:${account.id}`);return {reason:'visit-limit',trackVisits:1};},
    checkpoint:{terminalWorkIds:[]},
  });
  const group2Start=order.findIndex(item=>item.startsWith('start:Group 2'));
  assert.ok(group2Start>order.findIndex(item=>item==='end:Group 1:a1'));
  assert.ok(group2Start>order.findIndex(item=>item==='end:Group 1:a2'));
});

test('track reservation avoids simultaneous duplicate songs when the selected pool is large enough',async()=>{
  const {createTrackReservationCoordinator}=require('./streaming-runner.cjs');
  const t1={id:'t1'},t2={id:'t2'};
  const coordinator=createTrackReservationCoordinator({tracks:[t1,t2],accountCount:2,signal:new AbortController().signal});
  const first=await coordinator.acquire({preferredTrack:t1,alternatives:[t2]});
  const second=await coordinator.acquire({preferredTrack:t1,alternatives:[t2]});
  assert.equal(first.track.id,'t1');
  assert.equal(second.track.id,'t2');
  assert.equal(coordinator.activeCount(),2);
  first.release();second.release();
  assert.equal(coordinator.activeCount(),0);
});


test('grouped runner forwards optional pause duration and one volume direction to each account worker',async()=>{
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'u1'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',proxySource:'none'})};
  const seen=[];
  await executeStreamingRun({
    runId:'R-controls',
    request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1'],accountIds:['a1'],groupPlans:[{groupId:'Group 1',accountIds:['a1'],trackMode:'all'}],observation:{minSeconds:1,maxSeconds:1},checks:['playback','pause-resume','volume-control'],pauseResumeSeconds:2,volumeDirection:'decrease'},
    emit:()=>{},signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},
    runSession:async payload=>{seen.push({pauseResumeSeconds:payload.pauseResumeSeconds,volumeDirection:payload.volumeDirection});return {reason:'visit-limit',trackVisits:1};},
    checkpoint:{terminalWorkIds:[]},
  });
  assert.deepEqual(seen,[{pauseResumeSeconds:2,volumeDirection:'decrease'}]);
});

test('completed selected-song duration increments Run Center playCount and per-account play records',async()=>{
  const events=[];
  const collectionStore={get:()=>({tracks:[{id:'t1',platform:'spotify',title:'Song 1',url:'https://open.spotify.com/track/t1'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',label:'Account One',proxySource:'none'})};
  const summary=await executeStreamingRun({
    runId:'R-play-count',
    request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1'],accountIds:['a1'],observation:{minSeconds:60,maxSeconds:60},checks:['playback']},
    emit:event=>events.push(event),signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},
    runSession:async({onTrackComplete})=>{await onTrackComplete({track:{id:'t1',title:'Song 1'},activePlaybackMs:60000,observationSeconds:60});return {reason:'visit-limit',trackVisits:1};},
    checkpoint:{terminalWorkIds:[]},
  });
  assert.equal(summary.playCount,1);
  assert.equal(summary.validQaPlaybacks,1);
  assert.equal(summary.playsByAccount.a1,1);
  const update=events.find(event=>event.type==='streaming-summary'&&event.streamingSummary?.playCount===1);
  assert.ok(update,'play count must be emitted for Run Center persistence');
  assert.equal(update.streamingSummary.playsByAccount.a1,1);
  assert.ok(events.some(event=>event.activityType==='valid-playback'&&/^COMPLETED PLAY 1\//.test(event.message)));
});


test('streaming runner marks a saved account needs-verification when the live persistent profile is signed out',async()=>{
  const saves=[];
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'u1',title:'A'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',label:'Spotify QA',proxySource:'none',status:'ready'}),save:value=>{saves.push(value);return value;}};
  const error=new Error('Spotify saved session is no longer active. Re-verify this account from Test Accounts with LOGIN MANUALLY.');
  error.code='ORBITQA_STREAMING_AUTH_REQUIRED';
  const summary=await executeStreamingRun({runId:'R-auth-invalid',request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1'],accountIds:['a1'],observation:{minSeconds:1,maxSeconds:1},checks:['playback']},emit:()=>{},signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},runSession:async()=>{throw error;},checkpoint:{terminalWorkIds:[]}});
  assert.equal(summary.failed,1);
  assert.equal(saves.at(-1).status,'needs-verification');
  assert.match(saves.at(-1).lastVerificationReason,/no longer active/i);
});


test('streaming runner preserves ready account state for retryable browser/service failures',async()=>{
  const saves=[];
  const events=[];
  const collectionStore={get:()=>({tracks:[{id:'t1',url:'u1',title:'A'}]})};
  const accountStore={getInternal:id=>({id,platform:'spotify',label:'Spotify QA',proxySource:'none',status:'ready'}),save:value=>{saves.push(value);return value;}};
  const error=new Error('Spotify returned a temporary error page after reload');
  error.code='ORBITQA_STREAMING_RETRYABLE';
  const summary=await executeStreamingRun({runId:'R-auth-transient',request:{runKind:'streaming',platform:'spotify',collectionIds:['c'],trackIds:['t1'],accountIds:['a1'],observation:{minSeconds:1,maxSeconds:1},checks:['playback']},emit:event=>events.push(event),signal:new AbortController().signal,collectionStore,accountStore,adapterRegistry:{get:()=>({id:'spotify'})},runSession:async()=>{throw error;},checkpoint:{terminalWorkIds:[]}});
  assert.equal(summary.failed,1);
  assert.equal(saves.length,0,'temporary browser/service failures must not downgrade the saved login state');
  assert.ok(events.some(event=>event.type==='session-error'&&/temporary error page/i.test(event.message)));
});

test('account browser startup ramp is lightweight, ordered, and bounded for larger account sets',()=>{
  const {accountLaunchRampMs}=require('./streaming-runner.cjs');
  assert.equal(accountLaunchRampMs(1),0);
  assert.equal(accountLaunchRampMs(2),180);
  assert.equal(accountLaunchRampMs(10),1620);
  assert.equal(accountLaunchRampMs(100),2500);
});
