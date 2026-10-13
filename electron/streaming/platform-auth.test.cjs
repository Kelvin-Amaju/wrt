const test=require('node:test');
const assert=require('node:assert/strict');
const {getPlatformAuthConfig,authenticatePlatformAccount}=require('./adapters/_auth.cjs');

const ids=['apple-music','youtube-music','soundcloud','deezer','tidal','audiomack','pandora'];

test('all non-Spotify streaming services have explicit current web-login configuration',()=>{
  for(const id of ids){
    const config=getPlatformAuthConfig(id);
    assert.ok(config,`${id} auth config`);
    assert.match(config.loginUrl,/^https:\/\//);
    assert.match(config.homeUrl,/^https:\/\//);
    assert.ok(Array.isArray(config.usernameSelectors)&&config.usernameSelectors.length>0);
    assert.ok(Array.isArray(config.passwordSelectors)&&config.passwordSelectors.length>0);
  }
});

function locator({visible=true,onFill,onClick,innerText=''}){
  return {
    first(){return this},
    async isVisible(){return visible},
    async fill(value){onFill?.(value)},
    async click(){onClick?.()},
    async innerText(){return innerText},
  };
}
function fakeLoginPage(config,{challengeText=''}={}){
  const state={url:'about:blank',username:'',password:'',passwordVisible:false,submitted:false,gotos:[]};
  const page={
    state,
    async goto(url){state.url=String(url);state.gotos.push(String(url));return true},
    url(){return state.url},
    async waitForTimeout(){},
    async waitForURL(){},
    getByText(){return locator({visible:false})},
    getByLabel(pattern){
      if(/password/i.test(String(pattern))) return locator({visible:state.passwordVisible,onFill:v=>state.password=v});
      return locator({visible:true,onFill:v=>state.username=v});
    },
    getByPlaceholder(pattern){
      if(/password/i.test(String(pattern))) return locator({visible:state.passwordVisible,onFill:v=>state.password=v});
      return locator({visible:true,onFill:v=>state.username=v});
    },
    locator(selector){
      const text=String(selector);
      if(text==='body') return locator({innerText:challengeText});
      if(/password|passwd/i.test(text)) return locator({visible:state.passwordVisible,onFill:v=>state.password=v});
      if(/input/i.test(text)) return locator({visible:true,onFill:v=>state.username=v});
      return locator({visible:false});
    },
    getByRole(role,{name}={}){
      if(role!=='button'&&role!=='link') return locator({visible:false});
      const label=String(name||'');
      const exactLogin=/\^\(log in\|login\|sign in\|signin\)\$/i.test(label);
      if(exactLogin && state.url===config.homeUrl) return locator({visible:false});
      return locator({visible:true,onClick:()=>{
        if(!state.passwordVisible){state.passwordVisible=true;return;}
        state.submitted=true;state.url=config.homeUrl;
      }});
    },
  };
  return page;
}

test('credential authentication can complete the explicit form flow for every configured platform',async()=>{
  for(const id of ids){
    const config=getPlatformAuthConfig(id);
    const page=fakeLoginPage(config);
    const out=await authenticatePlatformAccount({id,page,account:{authMode:'credentials',username:'qa@example.com',password:'pw'},verifySession:async()=>({status:'PASS'})});
    assert.equal(out.status,'PASS',`${id}: ${out.reason}`);
    assert.equal(page.state.username,'qa@example.com',`${id} username filled`);
    assert.equal(page.state.password,'pw',`${id} password filled`);
    assert.equal(page.state.submitted,true,`${id} submitted`);
  }
});

test('credential authentication reports CAPTCHA MFA and verification pages without bypassing them',async()=>{
  const config=getPlatformAuthConfig('youtube-music');
  const page=fakeLoginPage(config,{challengeText:'2-Step Verification: verify it is you'});
  const out=await authenticatePlatformAccount({id:'youtube-music',page,account:{authMode:'credentials',username:'qa@example.com',password:'pw'},verifySession:async()=>({status:'PASS'})});
  assert.equal(out.status,'NEEDS_VERIFICATION');
  assert.match(out.reason,/verification/i);
});

test('imported session is verified before credential entry',async()=>{
  const config=getPlatformAuthConfig('deezer');
  const page=fakeLoginPage(config);
  let verified=0;
  const out=await authenticatePlatformAccount({id:'deezer',page,account:{authMode:'session',sessionSecret:'[]'},verifySession:async()=>{verified++;return {status:'PASS'}}});
  assert.equal(out.status,'PASS');
  assert.equal(verified,2);
  assert.equal(page.state.username,'');
});

test('platform session verification distinguishes active, login-gated, challenge and region-blocked states',async()=>{
  const {verifyPlatformSession}=require('./adapters/_auth.cjs');
  const youtube=getPlatformAuthConfig('youtube-music');
  const active=fakeLoginPage(youtube);active.state.url=youtube.homeUrl;
  assert.equal((await verifyPlatformSession({id:'youtube-music',page:active})).status,'PASS');
  const gated=fakeLoginPage(youtube);gated.state.url=youtube.loginUrl;
  assert.equal((await verifyPlatformSession({id:'youtube-music',page:gated})).status,'WARNING');
  const challenge=fakeLoginPage(youtube,{challengeText:'Verify it is you with 2-Step Verification'});challenge.state.url=youtube.homeUrl;
  assert.equal((await verifyPlatformSession({id:'youtube-music',page:challenge})).status,'NEEDS_VERIFICATION');
  const pandoraConfig=getPlatformAuthConfig('pandora');
  const blocked=fakeLoginPage(pandoraConfig,{challengeText:'Pandora is unavailable in this country or region'});blocked.state.url=pandoraConfig.homeUrl;
  assert.equal((await verifyPlatformSession({id:'pandora',page:blocked})).status,'WARNING');
  assert.match((await verifyPlatformSession({id:'pandora',page:blocked})).reason,/proxy/i);
});

test('credential authentication prefers a password route and never selects a one-time-code route',async()=>{
  const config=getPlatformAuthConfig('deezer');
  const state={url:'about:blank',username:'',password:'',passwordVisible:false,clicked:[]};
  const hidden=locator({visible:false});
  const page={
    async goto(url){state.url=String(url)},url(){return state.url},async waitForTimeout(){},
    getByLabel(pattern){return /password/i.test(String(pattern))?locator({visible:state.passwordVisible,onFill:v=>state.password=v}):locator({visible:true,onFill:v=>state.username=v})},
    getByPlaceholder(pattern){return /password/i.test(String(pattern))?locator({visible:state.passwordVisible,onFill:v=>state.password=v}):hidden},
    locator(selector){const text=String(selector);if(text==='body')return locator({innerText:''});if(/password/i.test(text))return locator({visible:state.passwordVisible,onFill:v=>state.password=v});if(/input/i.test(text))return locator({visible:true,onFill:v=>state.username=v});if(/submit/i.test(text))return locator({visible:state.passwordVisible,onClick:()=>{state.clicked.push('submit');state.url=config.homeUrl}});return hidden},
    getByRole(role,{name}={}){
      const pattern=String(name||'');
      if(role!=='button'&&role!=='link')return hidden;
      if(/password/i.test(pattern)) return locator({visible:!state.passwordVisible,onClick:()=>{state.clicked.push('password-route');state.passwordVisible=true}});
      if(/code|magic/i.test(pattern)) return locator({visible:true,onClick:()=>state.clicked.push('code-route')});
      if(/log in|login|sign in/i.test(pattern) && state.passwordVisible) return locator({visible:true,onClick:()=>{state.clicked.push('submit');state.url=config.homeUrl}});
      return hidden;
    },
  };
  const out=await authenticatePlatformAccount({id:'deezer',page,account:{authMode:'credentials',username:'qa@example.com',password:'pw'},verifySession:async()=>({status:'PASS'})});
  assert.equal(out.status,'PASS');
  assert.equal(state.password,'pw');
  assert.ok(state.clicked.includes('password-route'));
  assert.equal(state.clicked.includes('code-route'),false);
});

test('optional verification-code text does not block password login when a password route is available',async()=>{
  const config=getPlatformAuthConfig('tidal');
  const state={url:'about:blank',passwordVisible:false,password:'',clicked:[]};
  const hidden=locator({visible:false});
  const page={
    async goto(url){state.url=String(url)},url(){return state.url},async waitForTimeout(){},
    getByLabel(pattern){return /password/i.test(String(pattern))?locator({visible:state.passwordVisible,onFill:v=>state.password=v}):locator({visible:true,onFill:()=>{}})},
    getByPlaceholder(){return hidden},
    locator(selector){const text=String(selector);if(text==='body')return locator({innerText:'Or receive a verification code by email'});if(/one-time-code|inputmode|name\*="code"/i.test(text))return hidden;if(/password/i.test(text))return locator({visible:state.passwordVisible,onFill:v=>state.password=v});if(/input/i.test(text))return locator({visible:true,onFill:()=>{}});return hidden},
    getByRole(role,{name}={}){const pattern=String(name||'');if(role!=='button'&&role!=='link')return hidden;if(/password/i.test(pattern))return locator({visible:!state.passwordVisible,onClick:()=>{state.clicked.push('password-route');state.passwordVisible=true}});if(/log in|login|sign in|continue/i.test(pattern)&&state.passwordVisible)return locator({visible:true,onClick:()=>{state.clicked.push('submit');state.url=config.homeUrl}});return hidden;},
  };
  const out=await authenticatePlatformAccount({id:'tidal',page,account:{authMode:'credentials',username:'qa@example.com',password:'pw'},verifySession:async()=>({status:'PASS'})});
  assert.equal(out.status,'PASS');
  assert.equal(state.password,'pw');
  assert.ok(state.clicked.includes('password-route'));
});

test('credential authentication waits for dynamically rendered identifier and password fields on every configured non-Spotify platform',async()=>{
  for(const id of ids){
    const config=getPlatformAuthConfig(id);
    const state={url:'about:blank',ticks:0,username:'',password:'',passwordEntered:false,submitted:false};
    const hidden=locator({visible:false});
    const dynamic=(kind)=>({
      first(){return this},
      async isVisible(){return kind==='username'?state.ticks>=2:state.ticks>=5},
      async fill(value){if(kind==='username')state.username=value;else {state.password=value;state.passwordEntered=true}},
      async click(){},
    });
    const page={
      async goto(url){state.url=String(url)},
      url(){return state.url},
      async waitForTimeout(){state.ticks++},
      getByLabel(pattern){return /password/i.test(String(pattern))?dynamic('password'):dynamic('username')},
      getByPlaceholder(pattern){return /password/i.test(String(pattern))?dynamic('password'):dynamic('username')},
      locator(selector){
        const text=String(selector);
        if(text==='body')return locator({innerText:''});
        if(/password|passwd/i.test(text))return dynamic('password');
        if(/input/i.test(text))return dynamic('username');
        if(/submit/i.test(text))return locator({visible:state.ticks>=5,onClick:()=>{state.submitted=true;state.url=config.homeUrl}});
        return hidden;
      },
      getByRole(role,{name}={}){
        if(role!=='button'&&role!=='link')return hidden;
        const pattern=String(name||'');
        if(state.passwordEntered&&/next|continue|log in|login|sign in/i.test(pattern))return locator({visible:state.ticks>=5,onClick:()=>{state.submitted=true;state.url=config.homeUrl}});
        if(config.preLoginNames&&config.preLoginNames.test?.('Sign In')&&/sign in/i.test(pattern))return locator({visible:state.ticks>=1,onClick:()=>{state.ticks=Math.max(state.ticks,2)}});
        if(/continue|next/i.test(pattern))return locator({visible:state.ticks>=2,onClick:()=>{state.ticks=Math.max(state.ticks,3)}});
        if(/log in|login|sign in/i.test(pattern))return locator({visible:state.ticks>=5,onClick:()=>{state.submitted=true;state.url=config.homeUrl}});
        return hidden;
      },
    };
    const out=await authenticatePlatformAccount({id,page,account:{authMode:'credentials',username:'qa@example.com',password:'pw'},verifySession:async()=>({status:'PASS'})});
    assert.equal(out.status,'PASS',`${id}: ${out.reason}`);
    assert.equal(state.username,'qa@example.com',`${id} username`);
    assert.equal(state.password,'pw',`${id} password`);
    assert.equal(state.submitted,true,`${id} submitted`);
  }
});

test('invalid imported session falls back to stored password credentials instead of stopping at the home page',async()=>{
  const id='soundcloud';
  const config=getPlatformAuthConfig(id);
  const page=fakeLoginPage(config);
  let checks=0;
  const out=await authenticatePlatformAccount({
    id,page,
    account:{authMode:'credentials',username:'qa@example.com',password:'pw',sessionSecret:'[{"name":"sid","value":"expired"}]'},
    verifySession:async()=>{checks++;return checks===1?{status:'WARNING',reason:'expired'}:{status:'PASS',reason:'active'};},
  });
  assert.equal(out.status,'PASS',out.reason);
  assert.equal(page.state.username,'qa@example.com');
  assert.equal(page.state.password,'pw');
  assert.equal(page.state.submitted,true);
  assert.ok(page.state.gotos.includes(config.homeUrl));
  assert.ok(page.state.gotos.includes(config.loginUrl));
});

test('a passive reCAPTCHA footer does not stop credential login when no CAPTCHA widget or verification prompt is active',async()=>{
  const id='deezer';
  const config=getPlatformAuthConfig(id);
  const page=fakeLoginPage(config,{challengeText:'This site is protected by reCAPTCHA and the Google Privacy Policy and Terms of Service apply.'});
  const out=await authenticatePlatformAccount({id,page,account:{authMode:'credentials',username:'qa@example.com',password:'pw'},verifySession:async()=>({status:'PASS'})});
  assert.equal(out.status,'PASS',out.reason);
  assert.equal(page.state.username,'qa@example.com');
  assert.equal(page.state.password,'pw');
  assert.equal(page.state.submitted,true);
});

test('cookie restore requires a stable authenticated session before skipping stored credentials',async()=>{
  const id='deezer';
  const config=getPlatformAuthConfig(id);
  const page=fakeLoginPage(config);
  let checks=0;
  const out=await authenticatePlatformAccount({
    id,page,
    account:{authMode:'credentials',username:'qa@example.com',password:'pw',sessionSecret:'[{"name":"sid","value":"stale"}]'},
    verifySession:async()=>{checks++;return checks===1?{status:'PASS',reason:'not settled'}:checks===2?{status:'WARNING',reason:'login gate appeared'}:{status:'PASS',reason:'credentials active'};},
  });
  assert.equal(out.status,'PASS',out.reason);
  assert.equal(page.state.username,'qa@example.com');
  assert.equal(page.state.password,'pw');
  assert.equal(page.state.submitted,true);
  assert.ok(checks>=3);
});

test('session verification treats a visible Something went wrong page as transient instead of authenticated',async()=>{
  const {verifyPlatformSession}=require('./adapters/_auth.cjs');
  const config=getPlatformAuthConfig('deezer');
  const page=fakeLoginPage(config,{challengeText:'Something went wrong. Please try again.'});
  page.state.url=config.homeUrl;
  const result=await verifyPlatformSession({id:'deezer',page});
  assert.equal(result.status,'WARNING');
  assert.equal(result.transient,true);
  assert.match(result.reason,/temporary|something went wrong/i);
});

test('saved streaming session reloads a temporary error page and keeps the authorized session path',async()=>{
  const id='spotify';
  const config=getPlatformAuthConfig(id);
  let reloads=0;
  const page={
    async goto(url){this.current=String(url);},
    async reload(){reloads++;},
    async waitForTimeout(){},
    url(){return this.current||config.homeUrl;},
  };
  const out=await authenticatePlatformAccount({
    id,page,
    account:{authMode:'session',sessionSecret:'saved-session'},
    verifySession:async()=>reloads>0?{status:'PASS',reason:'restored after reload'}:{status:'WARNING',transient:true,reason:'Something went wrong. Try reloading the page.'},
  });
  assert.equal(out.status,'PASS',out.reason);
  assert.equal(reloads,1);
  assert.match(out.reason,/session restored/i);
});
