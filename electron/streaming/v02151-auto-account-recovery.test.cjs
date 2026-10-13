const test=require('node:test');const assert=require('node:assert/strict');
const {_test}=require('./streaming-session-worker.cjs');

test('streaming saved session automatically falls back to stored credentials and continues',async()=>{
  const calls=[];let persisted=0;
  const adapter={authenticate:async({account})=>{calls.push({authMode:account.authMode,username:account.username,password:account.password});return calls.length===1?{status:'WARNING',reason:'saved session expired'}:{status:'PASS',reason:'credentials authenticated'};}};
  const out=await _test.waitForAuthorizedAccount({page:{url:()=> 'https://service.test/'},context:{storageState:async()=>({cookies:[{name:'sid',value:'x',domain:'service.test',path:'/'}],origins:[]})},account:{platform:'spotify',authMode:'credentials',username:'qa@example.com',password:'pw',sessionSecret:'old'},adapter,signal:new AbortController().signal,log:()=>{},sleep:async()=>{},persistAuthorizedSession:async()=>{persisted++;},workId:'w'});
  assert.equal(out.status,'PASS');assert.equal(out.autoRecovered,true);assert.equal(calls.length,2);assert.equal(calls[0].username,'');assert.equal(calls[1].username,'qa@example.com');assert.equal(calls[1].password,'pw');assert.equal(persisted,1);
});

test('streaming security challenge never attempts automatic credential bypass',async()=>{
  let calls=0;const adapter={authenticate:async()=>{calls++;return {status:'NEEDS_VERIFICATION',challenge:true,reason:'CAPTCHA required'};}};
  const out=await _test.waitForAuthorizedAccount({page:{url:()=> 'https://service.test/'},context:{},account:{platform:'spotify',username:'qa@example.com',password:'pw',sessionSecret:'old'},adapter,signal:new AbortController().signal,log:()=>{},sleep:async()=>{},workId:'w'});
  assert.equal(out.status,'NEEDS_VERIFICATION');assert.equal(out.challenge,true);assert.equal(calls,1);
});
