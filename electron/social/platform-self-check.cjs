const {getSocialPlatform}=require('./platforms.cjs');
const {verifySocialSession}=require('./page-inspector.cjs');

function hostMatches(url,hosts=[]){
  try{const host=new URL(String(url||'')).hostname.toLowerCase().replace(/^www\./,'');return (hosts||[]).some(item=>{const h=String(item||'').toLowerCase().replace(/^www\./,'');return host===h||host.endsWith(`.${h}`);});}catch{return false;}
}
async function locatorExists(page,selectors=[]){
  for(const selector of selectors||[]){
    try{const loc=page.locator?.(selector);if(!loc)continue;const count=Number(await loc.count?.()||0);if(count>0)return {found:true,selector};}catch{}
  }
  return {found:false,selector:''};
}
async function namedExists(page,pattern){
  if(!pattern)return {found:false,label:''};
  for(const role of ['button','link']){
    try{const loc=page.getByRole?.(role,{name:pattern})?.first?.();if(loc&&await loc.count?.())return {found:true,label:String(await loc.innerText?.().catch?.(()=>'' )||'').trim()};}catch{}
  }
  return {found:false,label:''};
}
function requiredCapabilities(checks=[]){
  const set=new Set((Array.isArray(checks)?checks:[]).map(String));
  return {
    visit:set.has('visit')||set.has('search-before-open')||set.has('resolve-creator')||set.has('media-playback')||set.has('comments-present')||set.has('read-comments')||set.has('follow-state')||set.has('like-state')||set.has('share-control')||set.has('comment-composer')||set.has('comment-submit')||set.has('like-action')||set.has('follow-toggle'),
    comment:set.has('comment-submit')||set.has('comment-composer'),
    like:set.has('like-action')||set.has('like-state'),
    follow:set.has('follow-toggle')||set.has('follow-state'),
    share:set.has('share-control'),
    media:set.has('media-playback')
  };
}
async function checkAccountSession({page,platform}={}){
  const config=getSocialPlatform(platform);if(!config)return {status:'FAILED',blocking:true,reason:'Unsupported social platform'};
  const result=await verifySocialSession({page,platform});
  if(result.status==='PASS')return {status:'PASS',blocking:false,reason:result.reason};
  if(result.status==='NEEDS_VERIFICATION')return {status:'NEEDS_VERIFICATION',blocking:true,challenge:Boolean(result.challenge),reason:result.reason};
  return {status:'WARNING',blocking:false,transient:Boolean(result.transient),reason:result.reason};
}
async function checkTargetCapabilities({page,platform,targetUrl,checks=[],attempts=3,signal,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
  const config=getSocialPlatform(platform);if(!config)return {status:'FAILED',blocking:true,reason:'Unsupported social platform',missing:['platform']};
  const required=requiredCapabilities(checks);const currentUrl=String(page?.url?.()||'');
  if(required.visit&&!hostMatches(currentUrl,config.hosts))return {status:'FAILED',blocking:true,reason:`Target opened outside ${config.label}`,missing:['target-host'],currentUrl};
  const found={comment:false,like:false,follow:false,share:false,media:false};
  for(let pass=0;pass<Math.max(1,Number(attempts)||1);pass++){
    if(signal?.aborted){const e=new Error('Social run stopped');e.name='AbortError';throw e;}
    if(required.comment&&!found.comment){const composer=await locatorExists(page,config.commentComposerSelectors);const activator=await locatorExists(page,config.commentActivatorSelectors);const section=await locatorExists(page,config.commentSectionSelectors);found.comment=composer.found||activator.found||section.found;}
    if(required.like&&!found.like){const liked=await locatorExists(page,config.likedSelectors);const like=await locatorExists(page,config.likeSelectors);found.like=liked.found||like.found;}
    if(required.follow&&!found.follow){const selector=await locatorExists(page,config.followSelectors);const named=await namedExists(page,config.followPatterns);found.follow=selector.found||named.found;}
    if(required.share&&!found.share){found.share=(await locatorExists(page,config.shareSelectors)).found;}
    if(required.media&&!found.media){try{found.media=Number(await page.locator?.('video,audio')?.count?.()||0)>0;}catch{}}
    const complete=(!required.comment||found.comment)&&(!required.like||found.like)&&(!required.follow||found.follow)&&(!required.share||found.share)&&(!required.media||found.media);
    if(complete)break;
    if(pass<Math.max(1,Number(attempts)||1)-1){try{await page.evaluate?.(()=>window.scrollBy({top:Math.max(220,window.innerHeight*0.38),behavior:'auto'}));}catch{}await sleep(350,signal);}
  }
  try{await page.evaluate?.(()=>window.scrollTo({top:0,behavior:'auto'}));}catch{}
  const missing=[];if(required.comment&&!found.comment)missing.push('comment');if(required.like&&!found.like)missing.push('like');if(required.follow&&!found.follow)missing.push('follow/subscribe');if(required.share&&!found.share)missing.push('share');if(required.media&&!found.media)missing.push('media');
  const blocking=missing.some(x=>['comment','like','follow/subscribe'].includes(x));
  if(!missing.length)return {status:'PASS',blocking:false,reason:`${config.label} target and required controls are detectable`,found,currentUrl:String(page?.url?.()||currentUrl)};
  return {status:blocking?'FAILED':'WARNING',blocking,reason:`${config.label} self-check could not detect required ${missing.join(', ')} control${missing.length===1?'':'s'}`,missing,found,currentUrl:String(page?.url?.()||currentUrl)};
}
module.exports={checkAccountSession,checkTargetCapabilities,requiredCapabilities,_test:{hostMatches,locatorExists,namedExists}};
