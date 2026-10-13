const {getSocialPlatform}=require('./platforms.cjs');
async function firstVisible(page,selectors=[]){for(const selector of selectors){try{const loc=page.locator?.(selector)?.first?.();if(loc&&await loc.isVisible?.())return loc;}catch{}}return null;}
async function safeText(loc,max=240){try{return String(await loc?.innerText?.({timeout:1800})||'').replace(/\s+/g,' ').trim().slice(0,max);}catch{return '';}}
async function meta(page,name){try{return String(await page.locator?.(`meta[property="${name}"],meta[name="${name}"]`)?.first?.().getAttribute?.('content')||'').trim();}catch{return '';}}
async function anchorHref(loc){try{return String(await loc?.getAttribute?.('href')||'').trim();}catch{return '';}}
function absolute(base,href){if(!href)return '';try{return new URL(href,base).toString();}catch{return '';}}
async function bodyText(page){try{return String(await page.locator?.('body')?.innerText?.({timeout:2000})||'');}catch{return '';}}
async function findNamedControl(page,pattern){if(!pattern)return null;for(const role of ['button','link']){try{const loc=page.getByRole?.(role,{name:pattern})?.first?.();if(loc&&await loc.isVisible?.())return {locator:loc,label:await safeText(loc,80)};}catch{}}return null;}
async function controlState(loc){if(!loc)return {active:false,label:''};let label=await safeText(loc,100);let aria='';let pressed='';try{aria=String(await loc.getAttribute?.('aria-label')||'');}catch{}try{pressed=String(await loc.getAttribute?.('aria-pressed')||'');}catch{}return {active:pressed==='true'||/unlike|following|subscribed|joined|requested/i.test(`${label} ${aria}`),label:label||aria};}
async function inspectSocialPage({page,platform}={}){
  const config=getSocialPlatform(platform);if(!config||!page)throw new Error('Social page inspector requires a supported platform page');
  const url=String(page.url?.()||'');const title=String(await page.title?.().catch?.(()=>'' )||'')||await meta(page,'og:title');
  const creatorLoc=await firstVisible(page,config.creatorSelectors);const creatorName=(await safeText(creatorLoc,120))||await meta(page,'author');const creatorUrl=absolute(url,await anchorHref(creatorLoc));
  let commentsFound=false,commentCount=0,commentSamples=[];for(const selector of config.commentSelectors||[]){try{const loc=page.locator?.(selector);const count=Math.min(Number(await loc?.count?.()||0),20);if(count){commentsFound=true;commentCount=Math.max(commentCount,count);for(let i=0;i<Math.min(count,3);i++){const text=await safeText(loc.nth?.(i),220);if(text&&!commentSamples.includes(text))commentSamples.push(text);}}}catch{}}
  const composer=await firstVisible(page,config.commentComposerSelectors);const follow=await findNamedControl(page,config.followPatterns);const like=await firstVisible(page,config.likeSelectors);const liked=await firstVisible(page,config.likedSelectors||[]);const share=await firstVisible(page,config.shareSelectors);
  let mediaFound=false,mediaPlaying=false;try{mediaFound=Number(await page.locator?.('video,audio')?.count?.()||0)>0;mediaPlaying=Boolean(await page.locator?.('video,audio')?.first?.().evaluate?.(el=>!el.paused&&!el.ended&&el.readyState>=2));}catch{}
  const text=await bodyText(page);const temporaryError=/something went wrong|try reloading the page|temporarily unavailable|please try again later/i.test(text);const followState=await controlState(follow?.locator);const likeState=await controlState(liked||like);
  return {url,title,creatorName,creatorUrl,commentsFound,commentCount,commentSamples,commentComposerReady:Boolean(composer),followControl:{found:Boolean(follow),label:followState.label||follow?.label||'',active:followState.active},likeControl:{found:Boolean(like||liked),active:Boolean(liked)||likeState.active,label:likeState.label},shareControl:{found:Boolean(share)},mediaFound,mediaPlaying,temporaryError};
}
async function verifySocialSession({page,platform}={}){
  const config=getSocialPlatform(platform);if(!config||!page)return {status:'FAILED',reason:'Unsupported social platform'};
  const url=String(page.url?.()||'');
  if(config.loginPattern.test(url))return {status:'NEEDS_VERIFICATION',definitive:true,reason:`${config.label} is on its login page`};
  const text=await bodyText(page);
  if(/captcha|verify you are human|security check|verification code|two[- ]factor|2fa|multi[- ]factor|enter the code|confirm it['’]?s you/i.test(text))return {status:'NEEDS_VERIFICATION',definitive:true,challenge:true,reason:`${config.label} requires CAPTCHA, MFA, or manual verification`};
  for(const selector of config.authenticatedSelectors||[]){try{const loc=page.locator?.(selector)?.first?.();if(loc&&await loc.isVisible?.())return {status:'PASS',reason:`${config.label} account controls are visible`};}catch{}}
  try{const password=page.locator?.('input[type="password"]')?.first?.();if(password&&await password.isVisible?.())return {status:'NEEDS_VERIFICATION',definitive:true,reason:`${config.label} is showing a login form`};}catch{}
  if(/something went wrong|try reloading the page|temporarily unavailable|please try again later|service unavailable|network error/i.test(text))return {status:'WARNING',transient:true,reason:`${config.label} returned a temporary page or network error`};
  try{for(const role of ['button','link']){const login=page.getByRole?.(role,{name:/^(log in|login|sign in|signin)$/i})?.first?.();if(login&&await login.isVisible?.())return {status:'WARNING',transient:true,reason:`${config.label} exposes a login control, but logout is not confirmed`};}}catch{}
  return {status:'PASS',reason:`${config.label} page is available without a definitive login gate`};
}
module.exports={inspectSocialPage,verifySocialSession,firstVisible,findNamedControl,_test:{firstVisible,safeText,absolute,controlState}};
