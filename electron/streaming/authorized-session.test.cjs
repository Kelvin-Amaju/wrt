const test=require('node:test');
const assert=require('node:assert/strict');
const {captureAuthorizedSession}=require('./authorized-session.cjs');

test('captureAuthorizedSession captures IndexedDB-aware storage state in a v2 envelope',async()=>{
  const calls=[];
  const snapshot={cookies:[{name:'sid',value:'secret',domain:'.spotify.com',path:'/'}],origins:[{origin:'https://open.spotify.com',localStorage:[{name:'x',value:'1'}]}]};
  const context={storageState:async options=>{calls.push(options);return snapshot}};
  const raw=await captureAuthorizedSession(context,'2026-09-18T16:00:00.000Z');
  assert.deepEqual(calls,[{indexedDB:true}]);
  const envelope=JSON.parse(raw);
  assert.equal(envelope.version,2);
  assert.equal(envelope.kind,'playwright-storage-state');
  assert.equal(envelope.capturedAt,'2026-09-18T16:00:00.000Z');
  assert.deepEqual(envelope.storageState,snapshot);
});

test('captureAuthorizedSession falls back to ordinary storageState and then cookies while keeping the v2 envelope',async()=>{
  const calls=[];
  const snapshot={cookies:[{name:'sid',value:'secret',domain:'.deezer.com',path:'/'}],origins:[]};
  const context={storageState:async options=>{calls.push(options);if(options?.indexedDB)throw new Error('unsupported');return snapshot}};
  const raw=await captureAuthorizedSession(context,'2026-09-18T16:01:00.000Z');
  assert.deepEqual(calls,[{indexedDB:true},undefined]);
  assert.deepEqual(JSON.parse(raw).storageState,snapshot);

  const cookieContext={storageState:async()=>{throw new Error('broken')},cookies:async()=>snapshot.cookies};
  const cookieRaw=await captureAuthorizedSession(cookieContext,'2026-09-18T16:02:00.000Z');
  assert.deepEqual(JSON.parse(cookieRaw).storageState,{cookies:snapshot.cookies,origins:[]});
});
