const {clickWithInteractionIndicator}=require('./interaction-indicator.cjs');
function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
function uniqWords(text){return [...new Set(String(text||'').toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g)||[])];}
function normalizeContentIntelligence(input={}){
  return {
    enabled: input?.enabled===true,
    decisionMode: input?.decisionMode==='manual'?'manual':'auto',
    pacingMode: ['slow','medium','fast'].includes(String(input?.pacingMode||'').toLowerCase())?String(input.pacingMode).toLowerCase():'medium',
    maxSessionSeconds: clamp(Math.floor(Number(input?.maxSessionSeconds)||200),5,3600),
    // Pre-target feed observation is mandatory while Intelligence is enabled.
    feedSampling: true,
    feedSampleCount: clamp(Math.floor(Number(input?.feedSampleCount)||2),1,2),
    feedSampleSeconds: clamp(Math.floor(Number(input?.feedSampleSeconds)||3),1,8),
    creatorExploration: input?.creatorExploration!==false,
    allowRepeat: input?.allowRepeat!==false,
    maxPerSongSeconds: clamp(Math.floor(Number(input?.maxPerSongSeconds)||120),5,3600),
    streamingWarmupMaxSeconds: clamp(Math.floor(Number(input?.streamingWarmupMaxSeconds)||20),3,120),
    streamingRandomWarmupTrack: input?.streamingRandomWarmupTrack!==false,
    streamingVolumeVariation: input?.streamingVolumeVariation!==false,
    streamingRepeatMode: ['off','adaptive','each-song'].includes(String(input?.streamingRepeatMode||'').toLowerCase())?String(input.streamingRepeatMode).toLowerCase():'adaptive',
    repeatAllGroupCycles: clamp(Math.floor(Number(input?.repeatAllGroupCycles)||1),1,100),
    groupRepeatCounts: Array.isArray(input?.groupRepeatCounts)?input.groupRepeatCounts.slice(0,50).map(v=>clamp(Math.floor(Number(v)||1),1,100)):[],
    streamingFavoriteAllowed: input?.streamingFavoriteAllowed===true,
    streamingFollowAllowed: input?.streamingFollowAllowed===true,
    socialLikeAllowed: input?.socialLikeAllowed===true,
    socialFollowAllowed: input?.socialFollowAllowed===true,
    socialCommentAllowed: input?.socialCommentAllowed===true,
    socialCommentDraft: String(input?.socialCommentDraft||'').slice(0,1200),
    interestKeywords: String(input?.interestKeywords||'').split(/[\n,;]+/).map(x=>x.trim().toLowerCase()).filter(Boolean).slice(0,40),
    // Retained only for backward-compatible persisted settings. No public-action queue is created.
    suggestedActions: false,
  };
}
function analyzeContent({title='',creator='',text='',comments=[],keywords=[]}={}){
  const corpus=`${title} ${creator} ${text} ${(comments||[]).join(' ')}`.toLowerCase();
  const terms=(keywords||[]).map(x=>String(x).toLowerCase()).filter(Boolean);
  let keywordHits=0;for(const term of terms)if(corpus.includes(term))keywordHits++;
  const words=uniqWords(corpus);const richness=clamp(words.length/120,0,1);
  const sentimentHints=(corpus.match(/\b(great|love|amazing|helpful|interesting|beautiful|excellent|fun|useful|wow|best)\b/g)||[]).length;
  const negativeHints=(corpus.match(/\b(hate|awful|terrible|spam|scam|boring|bad|worst)\b/g)||[]).length;
  const keywordScore=terms.length?keywordHits/Math.max(1,Math.min(terms.length,6)):0.35;
  const sentimentScore=clamp(0.5+(sentimentHints-negativeHints)*0.06,0,1);
  const score=clamp(keywordScore*0.55+richness*0.25+sentimentScore*0.20,0,1);
  const label=score>=0.72?'high':score>=0.45?'medium':'low';
  const suggested=[];
  if(score>=0.58)suggested.push('like');
  if(score>=0.76)suggested.push('follow');
  if(score>=0.66)suggested.push('comment');
  return {score:Number(score.toFixed(3)),label,keywordHits,wordCount:words.length,suggestedActions:suggested};
}
function chooseAdaptiveObservation(minSeconds,maxSeconds,analysis){const min=Math.max(1,Math.floor(Number(minSeconds)||1));const max=Math.max(min,Math.floor(Number(maxSeconds)||min));const raw=Number(analysis?.score);const score=clamp(Number.isFinite(raw)?raw:0.5,0,1);return Math.round(min+(max-min)*score);}
function chooseIntelligenceObservation(maxSeconds,analysis,rng=Math.random){const max=Math.max(1,Math.floor(Number(maxSeconds)||1));const raw=Number(analysis?.score);const score=clamp(Number.isFinite(raw)?raw:0.5,0,1);const rv=Number(rng?.());const jitter=(clamp(Number.isFinite(rv)?rv:0.5,0,1)-0.5)*0.28;const ratio=clamp(0.06+(score*0.78)+jitter,0.02,1);return Math.max(1,Math.min(max,Math.round(max*ratio)));}
function resolvePassiveDecisions(config,analysis,rng=Math.random){const c=normalizeContentIntelligence(config);const score=clamp(Number(analysis?.score)||0,0,1);if(c.decisionMode==='manual')return {sampleFeed:true,exploreCreator:c.creatorExploration,revisit:c.allowRepeat};const roll=()=>{const v=Number(rng?.());return clamp(Number.isFinite(v)?v:0.5,0,1)};return {sampleFeed:true,exploreCreator:score>=0.50&&roll()<Math.max(0.2,score),revisit:score>=0.62&&roll()<0.38};}
const PACING_PROFILES={
  slow:{typingMinMs:150,typingMaxMs:240,scrollPauseMinMs:1200,scrollPauseMaxMs:2400,scrollRatioMin:0.055,scrollRatioMax:0.11,contentSettleMinMs:1900,contentSettleMaxMs:3600,contentWatchMinMs:5200,contentWatchMaxMs:12500},
  medium:{typingMinMs:90,typingMaxMs:155,scrollPauseMinMs:800,scrollPauseMaxMs:1650,scrollRatioMin:0.075,scrollRatioMax:0.15,contentSettleMinMs:1400,contentSettleMaxMs:2800,contentWatchMinMs:4000,contentWatchMaxMs:9500},
  fast:{typingMinMs:45,typingMaxMs:85,scrollPauseMinMs:450,scrollPauseMaxMs:950,scrollRatioMin:0.10,scrollRatioMax:0.20,contentSettleMinMs:900,contentSettleMaxMs:1800,contentWatchMinMs:2800,contentWatchMaxMs:7000},
};
function pacingProfile(mode='medium'){return PACING_PROFILES[String(mode||'').toLowerCase()]||PACING_PROFILES.medium;}
function randomInt(min,max,rng=Math.random){const v=clamp(Number(rng?.())||0,0,0.999999);return Math.floor(min+v*(max-min+1));}
async function pausePageMedia(page){
  if(!page)return false;
  try{await page.locator('video,audio').evaluateAll((els)=>{for(const el of els){try{if(!el.paused)el.pause?.();}catch{}}});return true;}catch{}
  try{return Boolean(await page.evaluate(()=>{let changed=false;for(const el of document.querySelectorAll('video,audio')){try{if(!el.paused){el.pause?.();changed=true;}}catch{}}return changed;}));}catch{return false;}
}
async function gentleHumanScroll({page,signal,sleep,rng=Math.random,steps,pacingMode='medium'}={}){
  const pace=pacingProfile(pacingMode);
  const count=steps==null?randomInt(pacingMode==='slow'?6:4,pacingMode==='fast'?6:8,rng):Math.max(1,Number(steps)||1);
  for(let i=0;i<count;i++){
    if(signal?.aborted)break;
    const ratio=pace.scrollRatioMin+(clamp(Number(rng?.())||0.5,0,1)*(pace.scrollRatioMax-pace.scrollRatioMin));
    try{await page.evaluate((r)=>window.scrollBy({top:Math.max(90,window.innerHeight*r),behavior:'smooth'}),ratio);}catch{}
    await sleep(randomInt(pace.scrollPauseMinMs,pace.scrollPauseMaxMs,rng),signal);
    if(i>0&&i<count-1&&i%2===1)await sleep(randomInt(Math.round(pace.scrollPauseMinMs*0.65),Math.round(pace.scrollPauseMaxMs*1.15),rng),signal);
  }
}
const FEED_SELECTORS={
  youtube:['a#thumbnail[href*="/watch"]','ytd-rich-item-renderer a[href*="/watch"]','a[href*="/shorts/"]'],
  facebook:['a[href*="/watch/"]','a[href*="/reel/"]','a[href*="/videos/"]'],
  instagram:['a[href*="/reel/"]','a[href*="/p/"]'],
  x:['article a[href*="/status/"]'],
  pinterest:['a[href*="/pin/"]'],
  tiktok:['a[href*="/video/"]'],
  linkedin:['a[href*="/posts/"]','a[href*="/feed/update/"]'],
  reddit:['a[data-click-id="body"]','a[href*="/comments/"]'],
};
async function chooseRandomVisibleCandidate(page,platform,rng=Math.random){
  const selectors=FEED_SELECTORS[String(platform||'').toLowerCase()]||['main a[href]','article a[href]'];
  for(const selector of selectors){
    try{
      const loc=page.locator(selector);const count=Math.min(24,await loc.count());if(!count)continue;
      const start=randomInt(0,count-1,rng);
      for(let n=0;n<count;n++){
        const item=loc.nth((start+n)%count);if(!await item.isVisible().catch(()=>false))continue;
        const href=String(await item.getAttribute('href').catch(()=> '')||'');if(!href||href==='#'||/^javascript:/i.test(href))continue;
        return item;
      }
    }catch{}
  }
  return null;
}
async function trySkipVisibleAd(page,{interactionMode='cursor'}={}){
  const selectors=['button:has-text("Skip Ad")','button:has-text("Skip ads")','button:has-text("Skip")','.ytp-ad-skip-button-slot button','[class*="skip-ad"] button'];
  for(const selector of selectors){try{const loc=page.locator(selector).first();if(await loc.isVisible()){await clickWithInteractionIndicator(page,loc,{mode:interactionMode,timeout:1800}).catch(()=>undefined);return true;}}catch{}}
  return false;
}
async function observeRandomPlatformContent({page,platform,signal,sleep,rng=Math.random,pacingMode='medium',interactionMode='cursor'}={}){
  const pace=pacingProfile(pacingMode);
  await gentleHumanScroll({page,signal,sleep,rng,pacingMode});
  let candidate=await chooseRandomVisibleCandidate(page,platform,rng);
  if(!candidate){await gentleHumanScroll({page,signal,sleep,rng,steps:3,pacingMode});candidate=await chooseRandomVisibleCandidate(page,platform,rng);}
  if(!candidate)return {opened:false,text:''};
  const before=String(page.url?.()||'');
  try{await candidate.scrollIntoViewIfNeeded?.().catch?.(()=>undefined);await sleep(randomInt(Math.max(450,Math.round(pace.scrollPauseMinMs*0.55)),Math.max(900,pace.scrollPauseMaxMs-350),rng),signal);await clickWithInteractionIndicator(page,candidate,{mode:interactionMode,timeout:7000});}catch{return {opened:false,text:''};}
  await page.waitForLoadState?.('domcontentloaded',{timeout:9000}).catch?.(()=>undefined);
  await sleep(randomInt(pace.contentSettleMinMs,pace.contentSettleMaxMs,rng),signal);
  await trySkipVisibleAd(page,{interactionMode}).catch(()=>undefined);
  try{const v=page.locator('video').first();if(await v.isVisible().catch(()=>false))await v.evaluate(el=>{try{const p=el.play?.();if(p&&typeof p.catch==='function')p.catch(()=>undefined);}catch{}}).catch(()=>undefined);}catch{}
  await gentleHumanScroll({page,signal,sleep,rng,steps:randomInt(2,pacingMode==='slow'?5:4,rng),pacingMode});
  await sleep(randomInt(pace.contentWatchMinMs,pace.contentWatchMaxMs,rng),signal);
  let text='';try{text=String(await page.locator('body').innerText({timeout:2500})||'').replace(/\s+/g,' ').trim().slice(0,700);}catch{}
  return {opened:true,text,before,after:String(page.url?.()||'')};
}
async function sampleSocialFeed({page,homeUrl,platform,count,signal,sleep,rng=Math.random,pacingMode='medium',interactionMode='cursor'}={}){
  if(!page||!homeUrl)return {samples:[],openedCount:0};
  const samples=[];let openedCount=0;
  await page.goto(homeUrl,{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>undefined);
  const sampleCount=count==null?(rng()<0.5?1:2):clamp(Number(count)||1,1,2);
  for(let i=0;i<sampleCount;i++){
    if(signal?.aborted)break;
    const observed=await observeRandomPlatformContent({page,platform,signal,sleep,rng,pacingMode,interactionMode});
    if(observed.opened){openedCount++;if(observed.text)samples.push(observed.text);}
    if(i<sampleCount-1){await pausePageMedia(page);try{if(page.goBack)await page.goBack({waitUntil:'domcontentloaded',timeout:9000});else await page.goto(homeUrl,{waitUntil:'domcontentloaded',timeout:12000});}catch{await page.goto(homeUrl,{waitUntil:'domcontentloaded',timeout:12000}).catch(()=>undefined);}await sleep(randomInt(1200,2600,rng),signal);}
  }
  return {samples:samples.filter(Boolean),openedCount};
}
module.exports={normalizeContentIntelligence,analyzeContent,chooseAdaptiveObservation,chooseIntelligenceObservation,resolvePassiveDecisions,sampleSocialFeed,gentleHumanScroll,observeRandomPlatformContent,pacingProfile,pausePageMedia};
