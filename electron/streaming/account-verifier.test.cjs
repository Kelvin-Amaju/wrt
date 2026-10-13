const test=require('node:test');
const assert=require('node:assert/strict');
const {verifyStreamingSavedAccount}=require('./account-verifier.cjs');

test('saved-session verification checks only the stored authorized session and never passes website credentials to the adapter',async()=>{
  const saved=[];let closed=0;
  const account={id:'a1',platform:'spotify',username:'qa@example.com',password:'secret',authMode:'credentials',proxySource:'static',sessionSecret:'stored-session'};
  const accountStore={getInternal:id=>id==='a1'?{...account}:null,save:value=>{saved.push(value);return {...account,...value}}};
  const context={storageState:async()=>({cookies:[{name:'sp_dc',value:'cookie-secret',domain:'.spotify.com',path:'/'}],origins:[]})};
  const browserFactory={open:async args=>{assert.equal(args.account.proxySource,'static');assert.equal(args.account.authMode,'session');assert.equal(args.account.username,'');assert.equal(args.account.password,'');assert.equal(args.account.sessionSecret,'stored-session');return {page:{},context,close:async()=>{closed++}};}};
  const adapterRegistry={get:()=>({authenticate:async({account:a})=>{assert.equal(a.password,'');assert.equal(a.username,'');return {status:'PASS',reason:'Stored session active'};},verifySession:async()=>({status:'PASS'})})};
  const result=await verifyStreamingSavedAccount({accountId:'a1',accountStore,adapterRegistry,browserFactory});
  assert.equal(result.ok,true);
  assert.equal(closed,1);
  assert.equal(saved.at(-1).status,'ready');
  assert.match(saved.at(-1).sessionSecret,/cookie-secret/);
  assert.equal(JSON.stringify(result).includes('cookie-secret'),false);
  assert.equal(JSON.stringify(result).includes('secret'),false);
});

test('saved-session verification automatically retries stored credentials when the durable profile is signed out and no snapshot exists',async()=>{
  let opens=0;let receivedAccount=null;
  const account={id:'yt1',platform:'youtube-music',username:'qa@example.com',password:'secret',authMode:'credentials',proxySource:'none',sessionSecret:''};
  const accountStore={getInternal:()=>({...account}),save:value=>({...account,...value})};
  const browserFactory={open:async args=>{opens++;assert.equal(args.usePersistentProfile,true);assert.equal(args.account.username,'');assert.equal(args.account.password,'');return {page:{},context:{},close:async()=>{}};}};
  const adapterRegistry={get:()=>({authenticate:async({account:a})=>{receivedAccount=a;return {status:'NEEDS_VERIFICATION',reason:'Use LOGIN MANUALLY to sign in again'};}})};
  const result=await verifyStreamingSavedAccount({accountId:'yt1',accountStore,adapterRegistry,browserFactory});
  assert.equal(result.ok,false);
  assert.match(result.reason,/LOGIN MANUALLY/i);
  assert.equal(opens,1);
  assert.equal(receivedAccount.username,'qa@example.com');
  assert.equal(receivedAccount.password,'secret');
});

test('expired saved session attempts stored credential recovery before recording the platform reason',async()=>{
  const account={id:'d1',platform:'deezer',username:'qa@example.com',password:'secret',authMode:'credentials',proxySource:'none',sessionSecret:'old-session'};
  const saves=[];let receivedAccount=null;
  const accountStore={getInternal:()=>({...account}),save:value=>{saves.push(value);return {...account,...value}}};
  const browserFactory={open:async()=>({page:{},context:{},close:async()=>{}})};
  const adapterRegistry={get:()=>({authenticate:async({account:a})=>{receivedAccount=a;return {status:'WARNING',reason:'Deezer saved session is no longer active'};}})};
  const result=await verifyStreamingSavedAccount({accountId:'d1',accountStore,adapterRegistry,browserFactory});
  assert.equal(result.ok,false);
  assert.equal(receivedAccount.password,'secret');
  assert.equal(receivedAccount.username,'qa@example.com');
  assert.equal(saves.at(-1).status,'ready');
  assert.match(result.reason,/no longer active/i);
});


test('saved-account verification checks the durable persistent profile even when no encrypted snapshot exists',async()=>{
  const saved=[];let opened=0;
  const account={id:'a2',platform:'spotify',username:'',password:'',authMode:'session',proxySource:'none',sessionSecret:'',status:'ready'};
  const accountStore={getInternal:id=>id==='a2'?{...account}:null,save:value=>{saved.push(value);return {...account,...value}}};
  const context={storageState:async()=>({cookies:[{name:'sp_dc',value:'fresh-profile-cookie',domain:'.spotify.com',path:'/'}],origins:[]})};
  const browserFactory={open:async args=>{opened++;assert.equal(args.usePersistentProfile,true);return {page:{},context,close:async()=>{}};}};
  const adapterRegistry={get:()=>({authenticate:async()=>({status:'PASS'}),verifySession:async()=>({status:'PASS'})})};
  const result=await verifyStreamingSavedAccount({accountId:'a2',accountStore,adapterRegistry,browserFactory});
  assert.equal(opened,1);
  assert.equal(result.ok,true);
  assert.equal(saved.at(-1).status,'ready');
  assert.match(saved.at(-1).sessionSecret,/fresh-profile-cookie/);
});
