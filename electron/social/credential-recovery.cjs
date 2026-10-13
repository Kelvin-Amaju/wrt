const {getSocialPlatform}=require('./platforms.cjs');
const {verifySocialSession}=require('./page-inspector.cjs');
const {clickWithInteractionIndicator}=require('../interaction-indicator.cjs');

const FIELD_SELECTORS={
  youtube:{username:['input#identifierId','input[type="email"]','input[autocomplete="username"]'],password:['input[name="Passwd"]','input[type="password"]','input[autocomplete="current-password"]']},
  facebook:{username:['input[name="email"]','input[type="email"]','input[autocomplete="username"]'],password:['input[name="pass"]','input[type="password"]']},
  instagram:{username:['input[name="username"]','input[type="text"]','input[autocomplete="username"]'],password:['input[name="password"]','input[type="password"]']},
  x:{username:['input[autocomplete="username"]','input[name="text"]','input[type="text"]'],password:['input[name="password"]','input[type="password"]']},
  pinterest:{username:['input[name="id"]','input[name="email"]','input[type="email"]'],password:['input[name="password"]','input[type="password"]']},
  tiktok:{username:['input[name="username"]','input[type="email"]','input[type="text"]'],password:['input[type="password"]']},
  linkedin:{username:['input#username','input[name="session_key"]','input[type="email"]'],password:['input#password','input[name="session_password"]','input[type="password"]']},
  reddit:{username:['input[name="username"]','input[autocomplete="username"]','input[type="text"]'],password:['input[name="password"]','input[type="password"]']},
};

function wait(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted){const e=new Error('Social QA stopped');e.name='AbortError';reject(e);return;}const t=setTimeout(resolve,Math.max(0,ms));signal?.addEventListener?.('abort',()=>{clearTimeout(t);const e=new Error('Social QA stopped');e.name='AbortError';reject(e);},{once:true});});}
async function visible(locator){try{const loc=locator?.first?.()||locator;return Boolean(loc&&await loc.isVisible?.());}catch{return false;}}
async function firstVisible(page,selectors=[]){for(const selector of selectors){try{const loc=page.locator?.(selector)?.first?.();if(await visible(loc))return loc;}catch{}}return null;}
async function fill(locator,value){if(!locator)return false;try{await locator.fill?.(String(value),{timeout:5000});return true;}catch{}try{await locator.click?.({timeout:3000});await locator.press?.('Control+A');await locator.type?.(String(value),{delay:25,timeout:7000});return true;}catch{return false;}}
async function clickNamed(page,pattern,interactionMode='cursor'){for(const role of ['button','link']){try{const loc=page.getByRole?.(role,{name:pattern})?.first?.();if(!await visible(loc))continue;await clickWithInteractionIndicator(page,loc,{mode:interactionMode});return true;}catch{}}return false;}
async function challengeVisible(page){
  try{const body=String(await page.locator?.('body')?.innerText?.({timeout:2000})||'');if(/captcha|verify you are human|security check|verification code|two[- ]factor|2fa|multi[- ]factor|enter the code|confirm it['’]?s you/i.test(body))return true;}catch{}
  for(const selector of ['iframe[src*="recaptcha" i]','iframe[src*="hcaptcha" i]','.g-recaptcha','.h-captcha','input[autocomplete="one-time-code"]']){try{if(await visible(page.locator?.(selector)))return true;}catch{}}
  return false;
}
function hasCredentials(account={}){return Boolean(String(account.username||'').trim()&&String(account.password||'').trim());}

async function recoverSocialSessionWithCredentials({page,account,signal,interactionMode='cursor'}={}){
  const config=getSocialPlatform(account?.platform);
  if(!config||!page)return {status:'WARNING',reason:'Social credential recovery is unavailable'};
  if(!hasCredentials(account))return {status:'WARNING',reason:`No saved ${config.label} password is available for automatic recovery`,credentialsUnavailable:true};
  try{await page.goto(config.loginUrl,{waitUntil:'domcontentloaded',timeout:30000});}catch(error){return {status:'WARNING',transient:true,reason:`${config.label} login page could not be opened: ${error instanceof Error?error.message:String(error)}`};}
  if(await challengeVisible(page))return {status:'NEEDS_VERIFICATION',definitive:true,challenge:true,reason:`${config.label} requires CAPTCHA, MFA, or manual verification`};
  const fields=FIELD_SELECTORS[account.platform]||{username:['input[type="email"]','input[autocomplete="username"]','input[type="text"]'],password:['input[type="password"]']};
  let user=await firstVisible(page,fields.username);
  if(!user){await wait(500,signal);user=await firstVisible(page,fields.username);}
  if(!await fill(user,account.username))return {status:'WARNING',reason:`${config.label} username/email field was not available for automatic recovery`};
  let password=await firstVisible(page,fields.password);
  if(!password){
    await clickNamed(page,/^(next|continue|log in|login|sign in)$/i,interactionMode).catch(()=>false);
    await wait(650,signal);
    if(await challengeVisible(page))return {status:'NEEDS_VERIFICATION',definitive:true,challenge:true,reason:`${config.label} requires CAPTCHA, MFA, or manual verification`};
    password=await firstVisible(page,fields.password);
  }
  if(!await fill(password,account.password))return {status:'WARNING',reason:`${config.label} password field was not available for automatic recovery`};
  let submitted=await clickNamed(page,/^(next|continue|log in|login|sign in)$/i,interactionMode);
  if(!submitted){
    const submit=await firstVisible(page,['button[type="submit"]','input[type="submit"]']);
    if(submit){try{await clickWithInteractionIndicator(page,submit,{mode:interactionMode});submitted=true;}catch{}}
  }
  if(!submitted)return {status:'WARNING',reason:`${config.label} login submit control was not available for automatic recovery`};
  let last={status:'WARNING',reason:`${config.label} login is still settling`};
  for(let attempt=0;attempt<40;attempt++){
    if(await challengeVisible(page))return {status:'NEEDS_VERIFICATION',definitive:true,challenge:true,reason:`${config.label} requires CAPTCHA, MFA, or manual verification`};
    last=await verifySocialSession({page,platform:account.platform});
    if(last?.status==='PASS')return {status:'PASS',reason:`${config.label} saved credentials restored the account automatically`,autoRecovered:true};
    if(last?.status==='NEEDS_VERIFICATION'&&last?.definitive&&!config.loginPattern.test(String(page.url?.()||'')))return last;
    if(attempt<39)await wait(250,signal);
  }
  return {status:'WARNING',reason:last?.reason||`${config.label} automatic login did not reach a verified session`};
}

module.exports={recoverSocialSessionWithCredentials,hasCredentials,_test:{challengeVisible,firstVisible,fill,clickNamed}};
