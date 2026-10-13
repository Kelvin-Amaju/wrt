const {clickWithInteractionIndicator}=require('../../interaction-indicator.cjs');
const AUTH_CONFIGS={
  spotify:{
    label:'Spotify',loginUrl:'https://accounts.spotify.com/en/login',homeUrl:'https://open.spotify.com/',
    usernameSelectors:['input[name="username"]','input[name="email"]','input[type="email"]','input[autocomplete="username"]'],passwordSelectors:['input[name="password"]','input[type="password"]','input[autocomplete="current-password"]'],
    usernameLabels:/email|username/i,passwordLabels:/password/i,continueNames:/continue|next/i,submitNames:/log in|login|sign in/i,loginUrlPattern:/accounts\.spotify\.com/i,authenticatedSelectors:['[data-testid="user-widget-link"]','button[aria-label*="profile" i]','a[href*="/user/"]'],
  },
  'apple-music':{
    label:'Apple Music',loginUrl:'https://music.apple.com/',homeUrl:'https://music.apple.com/',
    usernameSelectors:['input[type="email"]','input[autocomplete="username"]'],passwordSelectors:['input[type="password"]','input[autocomplete="current-password"]'],
    usernameLabels:/apple id|email/i,passwordLabels:/password/i,continueNames:/continue|next/i,submitNames:/sign in|continue/i,loginUrlPattern:/appleid\.apple\.com|music\.apple\.com.*signin/i,authenticatedSelectors:['button[aria-label*="Account" i]','button[aria-label*="profile" i]','[data-testid*="account" i]'],
  },
  'youtube-music':{
    label:'YouTube Music / Google',
    loginUrl:'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmusic.youtube.com%2F',
    homeUrl:'https://music.youtube.com/',
    usernameSelectors:['input[type="email"]','input[name="identifier"]'],
    passwordSelectors:['input[type="password"]','input[name="Passwd"]'],
    usernameLabels:/email|phone/i,
    passwordLabels:/password/i,
    continueNames:/next|continue/i,
    submitNames:/next|sign in|log in/i,
    loginUrlPattern:/accounts\.google\.com/i,authenticatedSelectors:['button#avatar-btn','yt-img-shadow#avatar','button[aria-label*="account" i]'],
  },
  soundcloud:{
    label:'SoundCloud',loginUrl:'https://soundcloud.com/signin',homeUrl:'https://soundcloud.com/you/library',
    usernameSelectors:['input[type="email"]','input[name*="email" i]','input[name*="username" i]'],passwordSelectors:['input[type="password"]'],
    usernameLabels:/email|username/i,passwordLabels:/password/i,continueNames:/continue|next|sign in/i,submitNames:/sign in|log in|continue/i,loginUrlPattern:/soundcloud\.com\/signin/i,authenticatedSelectors:['.header__userNav','a[href*="/you/library"]','button[aria-label*="profile" i]'],
  },
  deezer:{
    label:'Deezer',loginUrl:'https://www.deezer.com/login',homeUrl:'https://www.deezer.com/',
    usernameSelectors:['input[type="email"]','input[name*="email" i]','input[name*="login" i]'],passwordSelectors:['input[type="password"]'],
    usernameLabels:/email|username|login/i,passwordLabels:/password/i,continueNames:/continue|next/i,submitNames:/log in|login|sign in/i,loginUrlPattern:/deezer\.com\/login/i,authenticatedSelectors:['[data-testid*="profile" i]','button[aria-label*="profile" i]','a[href*="/profile/"]'],
  },
  tidal:{
    label:'TIDAL',loginUrl:'https://account.tidal.com/',homeUrl:'https://listen.tidal.com/',
    usernameSelectors:['input[type="email"]','input[name*="email" i]','input[name*="username" i]','input[name*="login" i]'],passwordSelectors:['input[type="password"]'],
    usernameLabels:/email|login name|username/i,passwordLabels:/password/i,continueNames:/continue|next/i,submitNames:/continue|log in|login|sign in/i,loginUrlPattern:/login\.tidal\.com|account\.tidal\.com\/login/i,authenticatedSelectors:['[data-test*="profile" i]','[data-testid*="profile" i]','button[aria-label*="profile" i]'],
  },
  audiomack:{
    label:'Audiomack',loginUrl:'https://audiomack.com/login',homeUrl:'https://audiomack.com/',
    usernameSelectors:['input[type="email"]','input[name*="email" i]','input[name*="username" i]'],passwordSelectors:['input[type="password"]'],
    usernameLabels:/email|username/i,passwordLabels:/password/i,preLoginNames:/sign in/i,continueNames:/continue|next/i,submitNames:/sign in|log in|login/i,loginUrlPattern:/audiomack\.com\/login/i,authenticatedSelectors:['a[href*="/profile"]','button[aria-label*="profile" i]','[data-testid*="user" i]'],
  },
  pandora:{
    label:'Pandora',loginUrl:'https://www.pandora.com/account/sign-in',homeUrl:'https://www.pandora.com/',
    usernameSelectors:['input[type="email"]','input[name*="email" i]','input[name*="username" i]'],passwordSelectors:['input[type="password"]'],
    usernameLabels:/email/i,passwordLabels:/password/i,continueNames:/continue|next/i,submitNames:/log in|login|sign in/i,loginUrlPattern:/pandora\.com\/account\/sign-in/i,authenticatedSelectors:['[data-qa*="account" i]','button[aria-label*="profile" i]','button[aria-label*="account" i]'],
    blockedPatterns:[/unavailable in (?:this|your) country|not available in (?:this|your) (?:country|region)/i],
  },
};
function getPlatformAuthConfig(id){return AUTH_CONFIGS[String(id||'')]||null;}
function first(locator){try{return locator?.first?.()||locator;}catch{return locator;}}
async function visible(locator){try{return Boolean(locator&&await first(locator)?.isVisible?.());}catch{return false;}}
async function fillOne(locator,value){const item=first(locator);if(!item||!await visible(item))return false;try{await item.fill(String(value));return true;}catch{return false;}}
async function clickOne(page,locator){const item=first(locator);if(!item||!await visible(item))return false;try{await clickWithInteractionIndicator(page,item,{timeout:5000});return true;}catch{return false;}}
async function safeGoto(page,url){try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});return true;}catch{return false;}}
async function safeReload(page){try{await page.reload({waitUntil:'domcontentloaded',timeout:30000});return true;}catch{return false;}}
async function bodyText(page){try{return String(await first(page.locator?.('body'))?.innerText?.({timeout:3000})||'');}catch{return '';}}
const TRANSIENT_AUTH_PATTERNS=[
  /(?:^|\n)\s*something went wrong[.!]?/i,
  /(?:^|\n)\s*please try again(?: later)?[.!]?/i,
  /temporarily unavailable/i,
  /we(?:'re| are) having trouble loading/i,
  /couldn(?:'t| not) load (?:this|the) page/i,
];
async function transientPageReason(page,config){
  const text=await bodyText(page);
  const match=TRANSIENT_AUTH_PATTERNS.find(pattern=>pattern.test(text));
  if(!match)return null;
  return {status:'WARNING',transient:true,reason:`${config.label} returned a temporary error page. OrbitQA will retry once, then use a clean login session.`};
}
async function challengeReason(page,config){
  const text=await bodyText(page);
  const blocked=(config.blockedPatterns||[]).find(pattern=>pattern.test(text));
  if(blocked) return {status:'WARNING',reason:`${config.label} is unavailable from the current network. Switch this account to a compatible proxy and check again.`};
  const strongPatterns=[/verify (?:that )?you(?:'re| are)? (?:a )?human/i,/verify it(?:'s| is) you/i,/2[- ]step verification/i,/two[- ]factor/i,/security check/i,/complete (?:the )?captcha/i,/solve (?:the )?captcha/i,/captcha required/i,/i(?:'m| am) not a robot/i];
  if(strongPatterns.some(pattern=>pattern.test(text)) || await visibleCaptchaWidget(page)) return {status:'NEEDS_VERIFICATION',reason:`${config.label} requires CAPTCHA, MFA, or manual verification. OrbitQA will not bypass it.`};
  const codeText=/verification code|enter (?:the )?code|check your (?:phone|email)/i.test(text);
  if(codeText){
    const otpSelectors=['input[autocomplete="one-time-code"]','input[name*="code" i]','input[inputmode="numeric"]'];
    for(const selector of otpSelectors){
      if(await visible(page.locator?.(selector))) return {status:'NEEDS_VERIFICATION',reason:`${config.label} requires a verification code. Complete it manually in the open browser.`};
    }
  }
  return null;
}
function fieldCandidates(page,config,type){
  const selectors=type==='password'?config.passwordSelectors:config.usernameSelectors;
  const label=type==='password'?config.passwordLabels:config.usernameLabels;
  const out=[];
  if(label){out.push(page.getByLabel?.(label),page.getByPlaceholder?.(label));}
  for(const selector of selectors||[]) out.push(page.locator?.(selector));
  return out.filter(Boolean);
}
async function fillCandidates(candidates,value){for(const candidate of candidates){if(await fillOne(candidate,value))return true;}return false;}
async function waitStep(page){try{await page.waitForTimeout?.(250);}catch{}}
async function waitFillCandidates(page,candidates,value,{attempts=40}={}){for(let i=0;i<attempts;i++){if(await fillCandidates(candidates,value))return true;if(i<attempts-1)await waitStep(page);}return false;}
async function clickNamed(page,pattern){
  if(!pattern)return false;
  for(const role of ['button','link']) if(await clickOne(page,page.getByRole?.(role,{name:pattern}))) return true;
  return false;
}
async function clickPasswordRoute(page){
  return clickNamed(page,/use (?:a )?password|log in with password|login with password|sign in with password|password instead|enter password/i);
}
async function waitClickNamed(page,pattern,{attempts=20}={}){for(let i=0;i<attempts;i++){if(await clickNamed(page,pattern))return true;if(i<attempts-1)await waitStep(page);}return false;}
async function verifyStableRestoredSession(page,verify){
  let last={status:'WARNING',reason:'Session verification is still settling'};
  let consecutivePasses=0;
  for(let attempt=0;attempt<12;attempt++){
    last=await verify();
    if(last?.status==='NEEDS_VERIFICATION'||last?.status==='FAILED')return last;
    if(last?.status==='PASS'){
      consecutivePasses++;
      if(consecutivePasses>=2)return last;
    }else{
      consecutivePasses=0;
      // Only wait through states that the verifier explicitly marks as temporary.
      // A normal WARNING (expired cookie, login page, etc.) must immediately fall
      // back to the caller's recovery path instead of being mistaken for hydration.
      if(!last?.transient)return last;
    }
    if(attempt<11){try{await page?.waitForTimeout?.(400);}catch{await waitStep(page);}}
  }
  return last;
}
async function authenticatedMarkerVisible(page,config){
  for(const selector of config?.authenticatedSelectors||[]){
    try{if(await visible(page.locator?.(selector)))return true;}catch{}
  }
  return false;
}
async function visibleCaptchaWidget(page){
  for(const selector of ['iframe[src*="recaptcha" i]','iframe[src*="hcaptcha" i]','.g-recaptcha','.h-captcha','[data-testid*="captcha" i]']){
    try{
      const candidate=page.locator?.(selector);
      if(!candidate)continue;
      if(typeof candidate.count==='function'&&await candidate.count()===0)continue;
      if(typeof candidate.count!=='function')continue;
      if(await visible(candidate))return true;
    }catch{}
  }
  return false;
}

async function verifyPlatformSession({id,page}){
  const config=getPlatformAuthConfig(id);
  if(!config||!page) return {status:'NOT_APPLICABLE',reason:!page?'No browser page':`No authentication configuration for ${id}`};
  const url=String(page.url?.()||'');
  if(!url) return {status:'WARNING',reason:`${config.label} did not expose a current page URL`};
  const challenge=await challengeReason(page,config); if(challenge)return challenge;
  const transient=await transientPageReason(page,config); if(transient)return transient;
  if(config.loginUrlPattern?.test(url)) return {status:'WARNING',reason:`${config.label} is still on its login page`};
  if(await authenticatedMarkerVisible(page,config)) return {status:'PASS',reason:`${config.label} authenticated account controls are visible`};
  for(const role of ['button','link']){
    try{
      const control=page.getByRole?.(role,{name:/^(log in|login|sign in|signin)$/i});
      if(await visible(control)) return {status:'WARNING',transient:true,reason:`${config.label} still exposes a login control while the page is settling; the session is not confirmed active yet`};
    }catch{}
  }
  return {status:'PASS',reason:`${config.label} session is active without a visible login gate`};
}
async function authenticatePlatformAccount({id,page,account={},verifySession}){
  const config=getPlatformAuthConfig(id);
  if(!config) return {status:'NOT_APPLICABLE',reason:`No authentication configuration for ${id}`};
  if(!page) return {status:'NOT_APPLICABLE',reason:'No browser page'};
  const verify=async()=>typeof verifySession==='function'?verifySession({page,account}):({status:'WARNING',reason:'Session verification unavailable'});

  if(account.sessionSecret){
    await safeGoto(page,config.homeUrl);
    let restored=await verifyStableRestoredSession(page,verify);
    // Streaming services occasionally return a temporary "Something went wrong / reload"
    // shell while an otherwise-valid durable profile is initializing. Retry the same saved
    // account session with a bounded page reload; never fall back to automated credentials.
    for(let retry=0;restored?.transient&&retry<2;retry++){
      const reloaded=await safeReload(page);
      if(!reloaded)break;
      try{await page.waitForTimeout?.(700);}catch{}
      restored=await verifyStableRestoredSession(page,verify);
    }
    if(restored?.status==='PASS') return {status:'PASS',reason:`Authorized ${config.label} session restored`};
    if(restored?.transient) return {status:'WARNING',transient:true,reason:`${config.label} is still showing a temporary error page after reload; keep the saved account profile and retry this QA task later`};
  }
  if(account.authMode==='oauth') return {status:'NEEDS_VERIFICATION',reason:`${config.label} OAuth requires an already-authorized imported session or manual authorization`};
  if(!account.username||!account.password) return {status:'WARNING',reason:`${config.label} credential login requires both email/username and password`};
  if(!await safeGoto(page,config.loginUrl)) return {status:'WARNING',reason:`${config.label} login page could not be opened`};
  let challenge=await challengeReason(page,config); if(challenge) return challenge;

  let usernameFilled=await waitFillCandidates(page,fieldCandidates(page,config,'username'),account.username,{attempts:12});
  if(!usernameFilled&&config.preLoginNames){
    await waitClickNamed(page,config.preLoginNames,{attempts:8});
    usernameFilled=await waitFillCandidates(page,fieldCandidates(page,config,'username'),account.username,{attempts:32});
  }else if(!usernameFilled){
    usernameFilled=await waitFillCandidates(page,fieldCandidates(page,config,'username'),account.username,{attempts:28});
  }
  if(!usernameFilled) return {status:'WARNING',reason:`${config.label} email/username field was not available after waiting for the login form`};

  let passwordFilled=await waitFillCandidates(page,fieldCandidates(page,config,'password'),account.password,{attempts:6});
  if(!passwordFilled&&await clickPasswordRoute(page)){
    challenge=await challengeReason(page,config); if(challenge) return challenge;
    passwordFilled=await waitFillCandidates(page,fieldCandidates(page,config,'password'),account.password,{attempts:32});
  }
  if(!passwordFilled){
    await waitClickNamed(page,config.continueNames,{attempts:16});
    challenge=await challengeReason(page,config); if(challenge) return challenge;
    passwordFilled=await waitFillCandidates(page,fieldCandidates(page,config,'password'),account.password,{attempts:8});
    if(!passwordFilled&&await clickPasswordRoute(page)){
      challenge=await challengeReason(page,config); if(challenge) return challenge;
      passwordFilled=await waitFillCandidates(page,fieldCandidates(page,config,'password'),account.password,{attempts:32});
    }else if(!passwordFilled){
      passwordFilled=await waitFillCandidates(page,fieldCandidates(page,config,'password'),account.password,{attempts:24});
    }
  }
  if(!passwordFilled) return {status:'WARNING',reason:`${config.label} password field was not available after the identifier step`};
  let submitted=await waitClickNamed(page,config.submitNames,{attempts:16});
  if(!submitted){
    const submit=page.locator?.('button[type="submit"],input[type="submit"]');
    for(let i=0;i<16&&!submitted;i++){submitted=await clickOne(page,submit);if(!submitted)await waitStep(page);}
    if(!submitted) return {status:'WARNING',reason:`${config.label} login button was not available`};
  }
  let verified={status:'WARNING',reason:`${config.label} login is still settling`};
  for(let i=0;i<40;i++){
    challenge=await challengeReason(page,config); if(challenge) return challenge;
    verified=await verify();
    if(verified?.status==='PASS') return {status:'PASS',reason:`${config.label} credentials authenticated`};
    if(verified?.status==='NEEDS_VERIFICATION') return verified;
    if(i<39)await waitStep(page);
  }
  const url=String(page.url?.()||'');
  if(config.loginUrlPattern?.test(url)) return {status:'WARNING',reason:`${config.label} login did not complete; the browser is still on the login page`};
  return {status:'WARNING',reason:verified?.reason||`${config.label} login did not reach a verified active session`};
}
module.exports={getPlatformAuthConfig,authenticatePlatformAccount,verifyPlatformSession,_test:{challengeReason,transientPageReason,fieldCandidates,clickNamed,clickPasswordRoute,safeReload}};
