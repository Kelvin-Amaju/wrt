const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {verifySocialSession}=require('./social/page-inspector.cjs');
const {createSocialAccountVerificationManager}=require('./social/account-verification-manager.cjs');

function hidden(){return {first(){return this;},async isVisible(){return false;},async innerText(){return '';},async getAttribute(){return '';}};}
function visible(text=''){return {first(){return this;},async isVisible(){return true;},async innerText(){return text;},async getAttribute(){return '';}};}
function pageMock({url='https://www.youtube.com/',body='',loginVisible=false,passwordVisible=false,authVisible=false}={}){
  let currentUrl=url;
  return {
    url:()=>currentUrl,
    async goto(next){currentUrl=next;},
    async reload(){},
    locator(selector){
      if(selector==='body')return {first(){return this;},async innerText(){return body;},async isVisible(){return true;}};
      if(selector==='input[type="password"]')return passwordVisible?visible():hidden();
      if(authVisible && /avatar-btn|yt-img-shadow|account/i.test(selector))return visible('Account');
      return hidden();
    },
    getByRole(role,{name}={}){
      const matches=loginVisible && name instanceof RegExp && (name.test('Sign in')||name.test('Log in'));
      return matches?visible('Sign in'):hidden();
    }
  };
}

test('social verifier treats a visible login button alone as transient, not definitive logout',async()=>{
  const out=await verifySocialSession({page:pageMock({loginVisible:true}),platform:'youtube'});
  assert.equal(out.status,'WARNING');
  assert.equal(out.transient,true);
  assert.notEqual(out.definitive,true);
});

test('social verifier treats a real login URL as definitive needs-verification',async()=>{
  const out=await verifySocialSession({page:pageMock({url:'https://accounts.google.com/ServiceLogin'}),platform:'youtube'});
  assert.equal(out.status,'NEEDS_VERIFICATION');
  assert.equal(out.definitive,true);
});

test('social verifier treats a visible password form as definitive logout evidence',async()=>{
  const out=await verifySocialSession({page:pageMock({passwordVisible:true}),platform:'youtube'});
  assert.equal(out.status,'NEEDS_VERIFICATION');
  assert.equal(out.definitive,true);
});

test('social verifySaved preserves ready state when verification is transient/indeterminate',async()=>{
  const saves=[];
  const account={id:'a1',platform:'youtube',label:'YouTube QA',status:'ready',proxySource:'none',lastVerifiedAt:'2026-10-05T00:00:00.000Z'};
  const page=pageMock({loginVisible:true});
  const manager=createSocialAccountVerificationManager({
    accountStore:{getInternal:()=>account,save:value=>{saves.push(value);return {...account,...value};}},
    browserFactory:{
      open:async()=>({page,close:async()=>{},browserPolicy:{browserLabel:'Chrome'}}),
      openManualLogin:async()=>({close:async()=>{},profileDir:'x',browserLabel:'Chrome'}),
      getAccountProfileDir:()=> 'x'
    },
    now:()=>new Date('2026-10-05T01:00:00.000Z')
  });
  const out=await manager.verifySaved('a1');
  assert.equal(out.ok,false);
  assert.equal(out.transient,true);
  assert.equal(saves.at(-1).status,'ready');
  assert.equal(saves.at(-1).lastVerifiedAt,'2026-10-05T00:00:00.000Z');
});

test('social verifySaved downgrades only on definitive signed-out evidence',async()=>{
  const saves=[];
  const account={id:'a1',platform:'youtube',label:'YouTube QA',status:'ready',proxySource:'none',lastVerifiedAt:'2026-10-05T00:00:00.000Z'};
  const page=pageMock({passwordVisible:true});
  const manager=createSocialAccountVerificationManager({
    accountStore:{getInternal:()=>account,save:value=>{saves.push(value);return {...account,...value};}},
    browserFactory:{
      open:async()=>({page,close:async()=>{},browserPolicy:{browserLabel:'Chrome'}}),
      openManualLogin:async()=>({close:async()=>{},profileDir:'x',browserLabel:'Chrome'}),
      getAccountProfileDir:()=> 'x'
    }
  });
  const out=await manager.verifySaved('a1');
  assert.equal(out.needsVerification,true);
  assert.equal(saves.at(-1).status,'needs-verification');
});

test('streaming authentication exceptions are classified transient before account-state conversion',()=>{
  const source=fs.readFileSync(path.join(__dirname,'streaming','streaming-session-worker.cjs'),'utf8');
  assert.match(source,/catch\(error\)\{authentication=\{status:'WARNING',transient:true,reason:/);
});
