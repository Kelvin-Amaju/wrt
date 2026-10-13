const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {verifyPoolProxyRouteInBrowser}=require('../qa-runner.cjs');

test('proxy-only route verification falls back when the first IP checker times out',async()=>{
  const calls=[];
  const page={
    async goto(url){calls.push(url); if(calls.length===1) throw new Error('page.goto: Timeout 7000ms exceeded'); return {ok:()=>true,status:()=>200};},
    async textContent(){return calls.length===2?'203.0.113.25':'';},
  };
  const result=await verifyPoolProxyRouteInBrowser({page,routeCheckUrl:'https://api64.ipify.org?format=json',proxyPoolService:{async getDirectIp(){return null;}}});
  assert.equal(result.proxiedIp,'203.0.113.25');
  assert.equal(result.error,null);
  assert.equal(result.proxyOnly,true);
  assert.equal(result.attempts,2);
  assert.ok(calls[1].includes('api.ipify.org'));
});

test('proxy-only route verification fails only after all fallback endpoints fail',async()=>{
  const calls=[];
  const page={async goto(url){calls.push(url);throw new Error('net::ERR_TIMED_OUT');}};
  const result=await verifyPoolProxyRouteInBrowser({page,routeCheckUrl:'https://custom-check.invalid/ip',proxyPoolService:{async getDirectIp(){return null;}}});
  assert.equal(result.proxiedIp,undefined);
  assert.equal(result.proxyOnly,true);
  assert.equal(result.attempts,5);
  assert.match(result.error,/All proxy-only route checks failed/);
  assert.equal(calls.length,5);
});

test('Spotify network-noise classifier keeps x-resolve aborts and socket disconnects non-fatal',()=>{
  const source=fs.readFileSync(path.join(__dirname,'streaming-session-worker.cjs'),'utf8');
  assert.match(source,/x-resolve request timed out/);
  assert.match(source,/spotify-endpoint-fallback/);
  assert.match(source,/signal is aborted without reason/);
  assert.match(source,/spotify-request-aborted/);
  assert.match(source,/ERR_SOCKET_NOT_CONNECTED/);
  assert.match(source,/network-socket-not-connected/);
  assert.match(source,/retryable-network-error/);
});
