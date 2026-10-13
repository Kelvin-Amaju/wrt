const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

test('spotify catalog auth module provides protected PKCE connection', async()=>{
  const {createSpotifyCatalogAuth}=require('./spotify-catalog-auth.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbitqa-spotify-auth-'));
  const encoded=[];
  const secretCodec={encode:v=>{encoded.push(String(v)); return `ENC:${Buffer.from(String(v)).toString('base64')}`},decode:v=>Buffer.from(String(v).slice(4),'base64').toString('utf8')};
  let opened='';
  const requests=[];
  const auth=createSpotifyCatalogAuth({
    baseDir:dir, secretCodec,
    openExternal:async url=>{opened=url;},
    randomBytes:n=>Buffer.alloc(n,7),
    now:()=>new Date('2026-09-17T12:00:00.000Z'),
    oauthCallbackProvider:async ({authorizationUrl,state})=>{assert.match(authorizationUrl,/code_challenge_method=S256/); return {code:'AUTH-CODE',state};},
    fetchImpl:async (url,opts)=>{requests.push({url:String(url),opts}); return {ok:true,status:200,json:async()=>({access_token:'RAW-ACCESS',refresh_token:'RAW-REFRESH',expires_in:3600,token_type:'Bearer'})};},
  });
  assert.deepEqual(auth.configureClientId('client-123'),{configured:true,connected:false,clientId:'client-123'});
  const status=await auth.connect();
  assert.equal(status.connected,true);
  assert.equal(status.clientId,'client-123');
  assert.equal(opened,''); // injected callback provider replaces browser launch in test
  assert.equal(requests.length,1);
  const body=String(requests[0].opts.body);
  assert.match(body,/grant_type=authorization_code/);
  assert.match(body,/code_verifier=/);
  const disk=fs.readFileSync(path.join(dir,'streaming-catalog','spotify.json'),'utf8');
  assert.doesNotMatch(disk,/RAW-ACCESS|RAW-REFRESH/);
  assert.match(disk,/ENC:/);
  assert.ok(encoded.includes('RAW-ACCESS'));
  assert.ok(encoded.includes('RAW-REFRESH'));
  const publicJson=JSON.stringify(status);
  assert.doesNotMatch(publicJson,/RAW-ACCESS|RAW-REFRESH|codeVerifier|pkce/i);
});

test('refreshes expired token and disconnect removes tokens but keeps client id', async()=>{
  const {createSpotifyCatalogAuth}=require('./spotify-catalog-auth.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbitqa-spotify-auth-refresh-'));
  const codec={encode:v=>Buffer.from(String(v)).toString('base64'),decode:v=>Buffer.from(String(v),'base64').toString('utf8')};
  let phase='connect';
  let nowMs=Date.parse('2026-09-17T12:00:00.000Z');
  const calls=[];
  const auth=createSpotifyCatalogAuth({baseDir:dir,secretCodec:codec,now:()=>new Date(nowMs),randomBytes:n=>Buffer.alloc(n,3),oauthCallbackProvider:async ({state})=>({code:'CODE',state}),fetchImpl:async (_url,opts)=>{calls.push(String(opts.body)); if(phase==='connect') return {ok:true,status:200,json:async()=>({access_token:'A1',refresh_token:'R1',expires_in:60})}; return {ok:true,status:200,json:async()=>({access_token:'A2',expires_in:3600})};}});
  auth.configureClientId('client');
  await auth.connect();
  nowMs+=61_000; phase='refresh';
  assert.equal(await auth.getValidAccessToken(),'A2');
  assert.match(calls[1],/grant_type=refresh_token/);
  assert.match(calls[1],/refresh_token=R1/);
  const disconnected=auth.disconnect();
  assert.deepEqual(disconnected,{configured:true,connected:false,clientId:'client'});
  const disk=JSON.parse(fs.readFileSync(path.join(dir,'streaming-catalog','spotify.json'),'utf8'));
  assert.equal(disk.clientId,'client');
  assert.equal(disk.accessTokenBlob,undefined);
  assert.equal(disk.refreshTokenBlob,undefined);
});

test('rejects oauth state mismatch and redacts token endpoint errors', async()=>{
  const {createSpotifyCatalogAuth}=require('./spotify-catalog-auth.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbitqa-spotify-auth-state-'));
  const codec={encode:v=>String(v),decode:v=>String(v)};
  const auth=createSpotifyCatalogAuth({baseDir:dir,secretCodec:codec,randomBytes:n=>Buffer.alloc(n,9),oauthCallbackProvider:async()=>({code:'CODE',state:'WRONG'}),fetchImpl:async()=>({ok:false,status:400,text:async()=>'{"access_token":"SECRET","error":"bad"}'})});
  auth.configureClientId('client');
  await assert.rejects(()=>auth.connect(),/state/i);
});
