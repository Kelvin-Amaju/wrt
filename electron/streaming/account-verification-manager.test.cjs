const test=require('node:test');
const assert=require('node:assert/strict');
const {createAccountVerificationManager}=require('./account-verification-manager.cjs');

function buildManager({accounts,verify=async()=>({status:'PASS',reason:'active'})}={}){
  const accountRows=accounts||[{id:'a1',platform:'spotify',label:'Spotify QA',username:'qa@example.com',password:'secret',authMode:'credentials',proxySource:'static',status:'unverified'}];
  const saves=[];const manualOpens=[];const captureOpens=[];const manualCloses=[];const captureCloses=[];const cleanups=[];
  const accountStore={
    getInternal:id=>{const found=accountRows.find(item=>item.id===id);return found?{...found}:null;},
    save:value=>{saves.push(value);const found=accountRows.find(item=>item.id===value.id)||{};return {...found,...value,hasPassword:Boolean(found.password),hasSessionSecret:Boolean(value.sessionSecret||found.sessionSecret)};},
  };
  const adapterRegistry={get:()=>({verifySession:verify})};
  const browserFactory={
    openManualLogin:async payload=>{
      manualOpens.push(payload);
      const profileDir=payload.profileDir||`C:/OrbitQA/manual/${payload.account.platform}/${payload.account.id}/${payload.profileToken}`;
      return {browserLabel:'Google Chrome',profileDir,close:async()=>manualCloses.push(profileDir)};
    },
    open:async payload=>{
      captureOpens.push(payload);
      const snapshot={cookies:[{name:'sid',value:`cookie-${payload.account.id}`,domain:'.example.com',path:'/'}],origins:[{origin:'https://example.com',localStorage:[{name:'ready',value:'1'}]}]};
      return {page:{goto:async()=>{},reload:async()=>{},waitForTimeout:async()=>{}},context:{storageState:async()=>snapshot},browserPolicy:{browserLabel:'Google Chrome'},close:async()=>captureCloses.push(payload.profileDirOverride)};
    },
    cleanupManualLoginProfile:dir=>cleanups.push(dir),
    getAccountProfileDir:account=>`C:/OrbitQA/profiles/${account.platform}/${account.id}`,
  };
  const manager=createAccountVerificationManager({accountStore,adapterRegistry,browserFactory,now:()=>new Date('2026-09-25T18:00:00.000Z')});
  return {manager,saves,manualOpens,captureOpens,manualCloses,captureCloses,cleanups};
}

test('manual login preserves the saved account proxy and never downgrades a proxied account to Direct',async()=>{
  const f=buildManager();
  const started=await f.manager.start({accountId:'a1',proxySource:'static',deviceMode:'android',deviceProfile:'Pixel 7'});
  assert.equal(started.status,'pending');
  assert.equal(started.proxySource,'static');
  assert.equal(started.deviceMode,'desktop');
  assert.equal(started.browserLabel,'Google Chrome');
  assert.match(started.reason,/Sign in .* yourself/i);
  assert.equal(f.manualOpens.length,1);
  assert.equal(f.captureOpens.length,0);
  assert.equal(f.manualOpens[0].account.proxySource,'static');
  assert.equal(f.manualOpens[0].freshProfile,false);
  assert.equal(f.manualOpens[0].profileDir,'C:/OrbitQA/profiles/spotify/a1');
  assert.ok(f.manualOpens[0].profileToken);
});

test('different accounts always receive different isolated manual-login profiles',async()=>{
  const f=buildManager({accounts:[
    {id:'a1',platform:'spotify',label:'One',proxySource:'none'},
    {id:'a2',platform:'spotify',label:'Two',proxySource:'none'},
  ]});
  const a=await f.manager.start({accountId:'a1'});
  const b=await f.manager.start({accountId:'a2'});
  assert.notEqual(a.sessionId,b.sessionId);
  assert.equal(f.manualOpens.length,2);
  assert.notEqual(f.manualOpens[0].profileDir,f.manualOpens[1].profileDir);
  assert.equal(f.manualOpens[0].profileDir,'C:/OrbitQA/profiles/spotify/a1');
  assert.equal(f.manualOpens[1].profileDir,'C:/OrbitQA/profiles/spotify/a2');
  assert.notEqual(f.manager.get(a.sessionId)?.accountId,f.manager.get(b.sessionId)?.accountId);
});

test('MARK VERIFIED captures only the account-specific manual profile and stores a reusable encrypted-session payload',async()=>{
  const f=buildManager();
  const started=await f.manager.start({accountId:'a1'});
  const manualProfile=f.manualOpens[0].profileDir||`C:/OrbitQA/manual/spotify/a1/${f.manualOpens[0].profileToken}`;
  const result=await f.manager.complete(started.sessionId);
  assert.equal(result.ok,true);
  assert.equal(result.account.status,'ready');
  assert.equal(f.captureOpens.length,1);
  assert.equal(f.captureOpens[0].profileDirOverride,manualProfile);
  assert.equal(f.captureOpens[0].restoreStoredSession,false);
  assert.equal(f.captureOpens[0].ignoreStoredSession,true);
  assert.equal(f.captureOpens[0].usePersistentProfile,true);
  assert.equal(f.captureOpens[0].account.proxySource,'static');
  assert.equal(f.saves.at(-1).status,'ready');
  const envelope=JSON.parse(f.saves.at(-1).sessionSecret);
  assert.equal(envelope.version,2);
  assert.match(JSON.stringify(envelope),/cookie-a1/);
  assert.equal(JSON.stringify(result).includes('cookie-a1'),false);
  assert.equal(f.cleanups.includes(manualProfile),false);
});

test('MARK VERIFIED never marks ready if the platform still reports a login gate and reopens the same normal profile',async()=>{
  let checks=0;
  const f=buildManager({verify:async()=>{checks++;return {status:'WARNING',reason:'Platform is still on its login page'};}});
  const started=await f.manager.start({accountId:'a1'});
  const firstProfile=f.manualOpens[0].profileDir||`C:/OrbitQA/manual/spotify/a1/${f.manualOpens[0].profileToken}`;
  const result=await f.manager.complete(started.sessionId);
  assert.equal(result.ok,false);
  assert.equal(result.pending,true);
  assert.match(result.reason,/still on its login page/i);
  assert.equal(f.saves.length,0);
  assert.equal(f.manualOpens.length,2);
  assert.equal(f.manualOpens[1].profileDir,firstProfile);
  assert.equal(f.manualOpens[1].freshProfile,false);
  assert.ok(checks>=1);
});

test('cancel closes the account-specific browser but preserves its durable account profile',async()=>{
  const f=buildManager();
  const started=await f.manager.start({accountId:'a1'});
  const profile=f.manualOpens[0].profileDir||`C:/OrbitQA/manual/spotify/a1/${f.manualOpens[0].profileToken}`;
  const result=await f.manager.cancel(started.sessionId);
  assert.equal(result.cancelled,true);
  assert.ok(f.manualCloses.includes(profile));
  assert.equal(f.cleanups.includes(profile),false);
  assert.equal(f.saves.length,0);
});

test('starting manual login again for the same account closes the older window and reuses the same durable account profile',async()=>{
  const f=buildManager();
  const first=await f.manager.start({accountId:'a1'});
  const second=await f.manager.start({accountId:'a1'});
  assert.notEqual(first.sessionId,second.sessionId);
  assert.equal(f.manager.get(first.sessionId),null);
  assert.equal(f.manualCloses.length,1);
  assert.equal(f.cleanups.length,0);
  assert.equal(f.manualOpens.length,2);
  assert.equal(f.manualOpens[0].profileDir,f.manualOpens[1].profileDir);
});

test('LOGIN MANUALLY reopens a verified account at the platform home page using the same saved profile',async()=>{
  const f=buildManager({accounts:[{id:'a1',platform:'spotify',label:'Spotify QA',status:'ready',sessionSecret:'saved',proxySource:'none'}]});
  const first=await f.manager.start({accountId:'a1'});
  assert.equal(first.status,'pending');
  assert.equal(f.manualOpens[0].url,'https://open.spotify.com/');
  assert.equal(f.manualOpens[0].profileDir,'C:/OrbitQA/profiles/spotify/a1');
  await f.manager.cancel(first.sessionId);
  const second=await f.manager.start({accountId:'a1'});
  assert.equal(f.manualOpens[1].url,'https://open.spotify.com/');
  assert.equal(f.manualOpens[1].profileDir,f.manualOpens[0].profileDir);
});

test('verified accounts on every configured streaming platform reopen at the platform home page, not the login page',async()=>{
  const cases=[
    ['spotify','https://open.spotify.com/'],
    ['youtube-music','https://music.youtube.com/'],
    ['soundcloud','https://soundcloud.com/you/library'],
    ['deezer','https://www.deezer.com/'],
    ['tidal','https://listen.tidal.com/'],
    ['audiomack','https://audiomack.com/'],
    ['pandora','https://www.pandora.com/'],
  ];
  const accounts=cases.map(([platform],index)=>({id:`ready${index}`,platform,label:platform,status:'ready',sessionSecret:'saved',proxySource:'none'}));
  const f=buildManager({accounts});
  for(const account of accounts)await f.manager.start({accountId:account.id});
  assert.deepEqual(f.manualOpens.map(item=>item.url),cases.map(([,home])=>home));
  for(let index=0;index<accounts.length;index++)assert.equal(f.manualOpens[index].profileDir,`C:/OrbitQA/profiles/${accounts[index].platform}/${accounts[index].id}`);
});

test('manual login uses each configured platform login URL instead of a Spotify-only fallback',async()=>{
  const platforms=['spotify','apple-music','youtube-music','soundcloud','deezer','tidal','audiomack','pandora'];
  const accounts=platforms.map((platform,index)=>({id:`a${index}`,platform,label:platform,proxySource:'none'}));
  const f=buildManager({accounts});
  for(const account of accounts)await f.manager.start({accountId:account.id});
  assert.equal(f.manualOpens.length,platforms.length);
  const urls=f.manualOpens.map(item=>item.url);
  assert.ok(urls.some(url=>/spotify\.com/i.test(url)));
  assert.ok(urls.some(url=>/google\.com/i.test(url)));
  assert.ok(urls.some(url=>/soundcloud\.com/i.test(url)));
  assert.ok(urls.some(url=>/deezer\.com/i.test(url)));
  assert.ok(urls.some(url=>/tidal\.com/i.test(url)));
  assert.ok(urls.some(url=>/audiomack\.com/i.test(url)));
  assert.ok(urls.some(url=>/pandora\.com/i.test(url)));
});
