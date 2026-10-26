const {captureAuthorizedSession}=require('./authorized-session.cjs');
const {createPersistentTrackDeck,nextTrack,chooseObservationSeconds,trackForCurrentUrl,canonicalTrackUrlKey}=require('./playback-planner.cjs');
function chooseRotatingObservationSeconds({minSeconds=60,maxSeconds=110,rng=Math.random}={}){
  // Every song receives a fresh independent random draw. Repeats remain possible by chance.
  return chooseObservationSeconds({minSeconds,maxSeconds,rng});
}
const {normalizeContentIntelligence,analyzeContent,chooseIntelligenceObservation,resolvePassiveDecisions,gentleHumanScroll,pacingProfile,pausePageMedia}=require('../content-intelligence.cjs');
const {getPlatformAuthConfig}=require('./adapters/_auth.cjs');
function abortError(){const e=new Error('Streaming QA session cancelled');e.name='AbortError';return e;}
function throwIfAborted(signal){if(signal?.aborted) throw abortError();}
function delay(ms,signal){return new Promise((resolve,reject)=>{throwIfAborted(signal); const t=setTimeout(resolve,ms); const onAbort=()=>{clearTimeout(t);reject(abortError());}; signal?.addEventListener?.('abort',onAbort,{once:true}); if(t.unref) t.unref();});}
function safeLog(log,message,meta={}){if(typeof log==='function') log(message,meta);}
// A stalled remote browser must never hold a worker forever. Timeout failures
// are retryable; they are not proof that a saved profile or login is invalid.
async function boundedBrowserProbe(label, operation, {timeoutMs=9000, signal}={}){
  throwIfAborted(signal);
  let timer;
  let abortListener;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>{const error=new Error(`${label} did not respond within ${timeoutMs}ms`);error.code='ORBITQA_STREAMING_PROBE_STALLED';reject(error);},timeoutMs);
  });
  const cancelled=new Promise((_,reject)=>{
    if(signal?.addEventListener){abortListener=()=>reject(abortError());signal.addEventListener('abort',abortListener,{once:true});}
  });
  try{return await Promise.race([Promise.resolve().then(operation),deadline,cancelled]);}
  finally{clearTimeout(timer);if(abortListener)signal?.removeEventListener?.('abort',abortListener);}
}

function safePageUrl(page){try{return String(page?.url?.()||'');}catch{return '';} }
function safeProxyDisplayEndpoint(value){
  const raw=String(value||'').trim();
  if(!raw)return '';
  try{
    const parsed=new URL(raw.includes('://')?raw:`http://${raw}`);
    const protocol=raw.includes('://')?`${parsed.protocol}//`:'';
    return `${protocol}${parsed.hostname}${parsed.port?`:${parsed.port}`:''}`;
  }catch{
    return raw.replace(/^.*@/,'').replace(/:([^:\s]+):([^:\s]+)$/,'');
  }
}
const {clickWithInteractionIndicator}=require('../interaction-indicator.cjs');
const {classifyTransientRuntimeError,transientRuntimeMessage}=require('../transient-runtime-errors.cjs');
const TRANSIENT_STREAM_PAGE_PATTERNS=[
  /(?:^|\n)\s*something went wrong[.!]?/i,
  /try reloading (?:the )?page/i,
  /please try again(?: later)?[.!]?/i,
  /temporarily unavailable/i,
  /we(?:'re| are) having trouble loading/i,
  /couldn(?:'t| not) load (?:this|the) page/i,
];
async function transientStreamingPage(page){
  try{
    const body=page?.locator?.('body');
    const item=body?.first?.()||body;
    const text=String(await item?.innerText?.({timeout:2500})||'');
    return TRANSIENT_STREAM_PAGE_PATTERNS.find(pattern=>pattern.test(text))?.source||'';
  }catch{return '';}
}
async function reloadTransientStreamingPage({page,signal,log,workId,stage='browser'}={}){
  const match=await transientStreamingPage(page);
  if(!match)return false;
  throwIfAborted(signal);
  safeLog(log,'Temporary streaming page error detected; reloading the same account page',{workId,type:'transient-page-reload',severity:'warning',stage,action:'reload-transient-page',currentUrl:safePageUrl(page)});
  try{await page.reload?.({waitUntil:'domcontentloaded',timeout:30000});return true;}catch(error){
    safeLog(log,`Temporary page reload failed: ${error instanceof Error?error.message:String(error)}`,{workId,type:'transient-page-reload-failed',severity:'warning',stage,action:'reload-transient-page',currentUrl:safePageUrl(page)});
    return false;
  }
}
function savedSessionAccount(account={}){return {...account,authMode:'session',username:'',password:''};}
function missingSessionReason(){return 'No active saved login session is available. Open Accounts, use LOGIN MANUALLY, finish sign-in in normal Chrome/Edge, then MARK VERIFIED before starting Streaming QA.';}
function authRequiredError(reason){
  const error=new Error(reason||missingSessionReason());
  error.code='ORBITQA_STREAMING_AUTH_REQUIRED';
  return error;
}
function retryableSessionError(reason){
  const error=new Error(reason||'The saved streaming profile hit a temporary browser or service error. The account login has been preserved; retry the QA task.');
  error.code='ORBITQA_STREAMING_RETRYABLE';
  return error;
}
function attachStreamingPageDiagnostics({page,log,workId,platform='streaming',onTransientIssue=()=>{}}){
  if(!page||typeof page.on!=='function')return()=>{};
  const bindings=[];
  const recent=new Map();
  const duplicateWindowMs=5000;
  const dedupe=(key)=>{
    const now=Date.now();
    const previous=recent.get(key)||0;
    recent.set(key,now);
    if(recent.size>80){for(const [item,at] of recent){if(now-at>duplicateWindowMs)recent.delete(item);}}
    return now-previous<duplicateWindowMs;
  };
  const bind=(name,handler)=>{page.on(name,handler);bindings.push([name,handler]);};
  bind('pageerror',error=>{
    const text=String(error?.message||error||'').trim();
    const key=`pageerror:${text||'undefined'}:${safePageUrl(page)}`;
    if(dedupe(key))return;
    if(/recaptcha timeout/i.test(text)){
      safeLog(log,`Spotify/Google verification timed out: ${text}`,{workId,type:'verification-timeout',severity:'warning',stage:'authentication',action:'manual-verification-required',currentUrl:safePageUrl(page)});return;
    }
    const transientIssue=classifyTransientRuntimeError(text);
    if(transientIssue){try{onTransientIssue(transientIssue);}catch{}safeLog(log,transientRuntimeMessage(transientIssue,{platform}),{workId,type:`transient-${transientIssue.kind}`,severity:'warning',stage:transientIssue.playerRecovery?'playback':'network',action:transientIssue.playerRecovery?'recover-player-state':'retryable-network-error',currentUrl:safePageUrl(page),reason:text});return;}
    if(/ChunkLoadError|Loading chunk \d+ failed/i.test(text)){
      safeLog(log,`Spotify web resource failed to load; the current page may need a normal retry: ${text.split(/\r?\n/)[0]}`,{workId,type:'web-resource-load',severity:'warning',stage:'network',action:'retryable-resource-error',currentUrl:safePageUrl(page)});return;
    }
    if(/x-resolve request timed out|Failed to resolve endpoints via x-resolve/i.test(text)){safeLog(log,'Spotify endpoint discovery timed out and reported that it is using fallback endpoints; continuing unless the required QA action fails',{workId,type:'spotify-x-resolve',severity:'warning',stage:'network',action:'spotify-endpoint-fallback',currentUrl:safePageUrl(page)});return;}
    if(/AbortError:\s*signal is aborted without reason|signal is aborted without reason/i.test(text)){safeLog(log,'Spotify cancelled an internal request; continuing unless the required QA action fails',{workId,type:'spotify-internal-abort',severity:'warning',stage:'network',action:'spotify-request-aborted',currentUrl:safePageUrl(page)});return;}
    if(/ERR_SOCKET_NOT_CONNECTED/i.test(text)){safeLog(log,'A page resource hit a temporary disconnected socket; keeping the account profile intact and allowing normal page/action retry',{workId,type:'network-socket-not-connected',severity:'warning',stage:'network',action:'retryable-network-error',currentUrl:safePageUrl(page)});return;}
    if(/^Timed out\.?$/i.test(text)||/^(?:Navigation|page\.goto).*Timeout/i.test(text)){safeLog(log,`Spotify page reported a transient timeout: ${text}`,{workId,type:'spotify-page-timeout',severity:'warning',stage:'network',action:'retryable-network-error',currentUrl:safePageUrl(page)});return;}
    if(!text||/^undefined$/i.test(text)||/^Uncaught \(in promise\) undefined$/i.test(text)){
      safeLog(log,'Spotify reported an internal page error without details; OrbitQA will only fail if the required QA action also fails',{workId,type:'page-error-undefined',severity:'warning',stage:'browser',action:'pageerror-diagnostic',currentUrl:safePageUrl(page)});return;
    }
    if(/Failed to modify recent searches/i.test(text)){
      safeLog(log,'Spotify could not update its recent-search history; this does not affect the saved login or the active QA session',{workId,type:'spotify-recent-searches',severity:'warning',stage:'browser',action:'recent-search-history-diagnostic',currentUrl:safePageUrl(page)});return;
    }
    safeLog(log,`Browser page error: ${text}`,{workId,type:'page-error',severity:'error',stage:'browser',action:'pageerror',currentUrl:safePageUrl(page)});
  });
  bind('console',message=>{
    let kind='';let text='';
    try{kind=String(message?.type?.()||'');text=String(message?.text?.()||'');}catch{return;}
    if(kind!=='error')return;
    const key=`console:${text||'undefined'}:${safePageUrl(page)}`;
    if(dedupe(key))return;
    const transientConsoleIssue=classifyTransientRuntimeError(text);
    if(transientConsoleIssue){try{onTransientIssue(transientConsoleIssue);}catch{}safeLog(log,transientRuntimeMessage(transientConsoleIssue,{platform}),{workId,type:`transient-${transientConsoleIssue.kind}`,severity:'warning',stage:transientConsoleIssue.playerRecovery?'playback':'network',action:transientConsoleIssue.playerRecovery?'recover-player-state':'retryable-network-error',currentUrl:safePageUrl(page),reason:text});return;}
    if(/Not allowed to launch ['\"]spotify:\/\/|Failed to launch ['\"]spotify:\/\//i.test(text)){safeLog(log,'Spotify native-app deep link was ignored; continuing in the web player',{workId,type:'native-deeplink',severity:'info',stage:'browser',action:'native-deeplink-ignored',currentUrl:safePageUrl(page)});return;}
    if(/ChunkLoadError|Loading chunk \d+ failed/i.test(text)){safeLog(log,`Spotify web resource failed to load; the current page may need a normal retry: ${text.split(/\r?\n/)[0]}`,{workId,type:'web-resource-load',severity:'warning',stage:'network',action:'retryable-resource-error',currentUrl:safePageUrl(page)});return;}
    if(/x-resolve request timed out|Failed to resolve endpoints via x-resolve/i.test(text)){safeLog(log,'Spotify endpoint discovery timed out and reported that it is using fallback endpoints; continuing unless the required QA action fails',{workId,type:'spotify-x-resolve',severity:'warning',stage:'network',action:'spotify-endpoint-fallback',currentUrl:safePageUrl(page)});return;}
    if(/AbortError:\s*signal is aborted without reason|signal is aborted without reason/i.test(text)){safeLog(log,'Spotify cancelled an internal request; continuing unless the required QA action fails',{workId,type:'spotify-internal-abort',severity:'warning',stage:'network',action:'spotify-request-aborted',currentUrl:safePageUrl(page)});return;}
    if(/ERR_CONNECTION_CLOSED/i.test(text)){safeLog(log,'A Spotify page resource connection closed before completion; treating it as a recoverable network condition',{workId,type:'network-connection-closed',severity:'warning',stage:'network',action:'retryable-network-error',currentUrl:safePageUrl(page)});return;}
    if(/ERR_SOCKET_NOT_CONNECTED/i.test(text)){safeLog(log,'A page resource hit a temporary disconnected socket; keeping the account profile intact and allowing normal page/action retry',{workId,type:'network-socket-not-connected',severity:'warning',stage:'network',action:'retryable-network-error',currentUrl:safePageUrl(page)});return;}
    if(/requestStorageAccess:\s*Permission denied/i.test(text)){safeLog(log,'Browser storage-access request was denied; continuing with the dedicated account profile',{workId,type:'storage-access',severity:'warning',stage:'browser',action:'storage-access-denied',currentUrl:safePageUrl(page)});return;}
    if(/frame-ancestors ['\"]self['\"]|Content Security Policy directive/i.test(text)){safeLog(log,'A report-only browser content-security warning was recorded; no account state was changed',{workId,type:'csp-report-only',severity:'info',stage:'browser',action:'csp-diagnostic',currentUrl:safePageUrl(page)});return;}
    if(/Failed to load resource:.*status of 404/i.test(text)){safeLog(log,'A page resource returned 404; OrbitQA will keep the streaming page active unless playback/navigation itself fails',{workId,type:'browser-console-404',severity:'info',stage:'browser',action:'console-404',currentUrl:safePageUrl(page)});return;}
    if(!text||/^undefined$/i.test(text)){safeLog(log,'Spotify reported an internal console error without details; OrbitQA will only fail if the required QA action also fails',{workId,type:'browser-console-undefined',severity:'warning',stage:'browser',action:'console-diagnostic',currentUrl:safePageUrl(page)});return;}
    safeLog(log,`Browser console error: ${text}`,{workId,type:'browser-console',severity:'error',stage:'browser',action:'console-error',currentUrl:safePageUrl(page)});
  });
  bind('response',response=>{
    let status=0,url='',resource='';
    try{status=Number(response?.status?.()||0);url=String(response?.url?.()||'');resource=String(response?.request?.()?.resourceType?.()||'');}catch{return;}
    if(status!==404)return;
    const thirdParty=/(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|google-analytics\.com|gstatic\.com)/i.test(url);
    const critical=['document','media','script'].includes(resource)&&!thirdParty;
    const key=`http404:${url}:${resource}`;if(dedupe(key))return;
    safeLog(log,`${thirdParty?'Third-party':'Page'} resource returned 404: ${url||'unknown URL'}`,{workId,type:'http-404',severity:critical?'warning':'info',stage:'network',action:'http-404',currentUrl:url,resourceType:resource,critical});
  });
  bind('requestfailed',request=>{
    let resource='';let url='';let reason='';
    try{resource=String(request?.resourceType?.()||'');url=String(request?.url?.()||'');reason=String(request?.failure?.()?.errorText||'request failed');}catch{return;}
    if(!['document','media','script'].includes(resource))return;
    const key=`requestfailed:${resource}:${url}:${reason}`;if(dedupe(key))return;
    const transientRequestIssue=classifyTransientRuntimeError(reason);
    if(transientRequestIssue){try{onTransientIssue(transientRequestIssue);}catch{}safeLog(log,transientRuntimeMessage(transientRequestIssue,{platform}),{workId,type:`transient-${transientRequestIssue.kind}`,severity:'warning',stage:transientRequestIssue.playerRecovery?'playback':'network',action:transientRequestIssue.playerRecovery?'recover-player-state':'retryable-network-error',currentUrl:url,reason});return;}
    if(/^spotify:\/\//i.test(url)){safeLog(log,'Spotify native-app deep link was ignored; web playback remains active',{workId,type:'native-deeplink',severity:'info',stage:'network',action:'native-deeplink-ignored',currentUrl:url,reason});return;}
    if(/google\.com\/recaptcha\/enterprise\/anchor/i.test(url)&&/ERR_ABORTED/i.test(reason)){safeLog(log,'Background reCAPTCHA request was cancelled by the page; no action required',{workId,type:'recaptcha-background',severity:'debug',stage:'network',action:'recaptcha-aborted',currentUrl:url,reason});return;}
    if(/ERR_CONNECTION_CLOSED/i.test(reason)){safeLog(log,`${resource} resource connection closed before completion; the account profile remains intact and the page may retry normally`,{workId,type:'network-connection-closed',severity:'warning',stage:'network',action:'retryable-network-error',currentUrl:url,reason});return;}
    if(/ERR_SOCKET_NOT_CONNECTED/i.test(reason)){safeLog(log,`${resource} resource hit a temporary disconnected socket; OrbitQA will keep the profile intact and let the normal navigation/playback retry path recover it`,{workId,type:'network-socket-not-connected',severity:'warning',stage:'network',action:'retryable-network-error',currentUrl:url,reason});return;}
    safeLog(log,`${resource==='media'?'Media':resource==='script'?'Script':'Document'} request failed: ${reason}`,{workId,type:'request-failed',severity:'warning',stage:'network',action:`${resource}-request`,currentUrl:url,reason});
  });
  return()=>{recent.clear();for(const [name,handler] of bindings){try{page.off?.(name,handler);}catch{}}};
}

const STREAMING_WARMUP_SELECTORS={
  spotify:['a[href*="/track/"]','a[href*="/album/"]'],
  'apple-music':['a[href*="/song/"]','a[href*="/album/"]'],
  'youtube-music':['a[href*="watch?v="]','ytmusic-responsive-list-item-renderer a[href*="watch?v="]'],
  soundcloud:['a[href*="/tracks/"]','a.soundTitle__title'],
  deezer:['a[href*="/track/"]','a[href*="/album/"]'],
  tidal:['a[href*="/track/"]','a[href*="/album/"]'],
  audiomack:['a[href*="/song/"]','a[href*="/album/"]'],
  pandora:['a[href*="/station/"]','a[href*="/artist/"]'],
};
async function streamingIntelligenceWarmup({page,platform,intelligence,signal,sleep,log,workId}={}){
  if(!intelligence?.enabled||!page)return {visited:false,randomPlayed:false,randomPlayedCount:0};
  const auth=getPlatformAuthConfig(platform);const home=auth?.homeUrl;if(!home)return {visited:false,randomPlayed:false,randomPlayedCount:0};
  const pace=pacingProfile(intelligence.pacingMode);let randomPlayedCount=0;
  const warmupMs=Math.max(3000,Math.min((Number(intelligence.streamingWarmupMaxSeconds)||20)*1000,3000+Math.floor(Math.random()*(Math.max(3000,(Number(intelligence.streamingWarmupMaxSeconds)||20)*1000)-2999))));
  const started=Date.now();
  safeLog(log,`Content intelligence group warm-up started · up to ${Math.round(warmupMs/1000)}s`,{workId,type:'content-intelligence-warmup',severity:'info',stage:'intelligence',action:'platform-warmup',currentUrl:safePageUrl(page)});
  const requestedWarmupTracks=intelligence.decisionMode==='auto'?(Math.random()<0.5?1:2):(intelligence.streamingRandomWarmupTrack?1:0);
  for(let warmupIndex=0;warmupIndex<requestedWarmupTracks;warmupIndex++){
    if(signal?.aborted||Date.now()-started>=warmupMs-1200)break;
    try{await page.goto(home,{waitUntil:'domcontentloaded',timeout:30000});}catch{}
    await gentleHumanScroll({page,signal,sleep,rng:Math.random,steps:intelligence.pacingMode==='slow'?5:3,pacingMode:intelligence.pacingMode}).catch(()=>undefined);
    const selectors=STREAMING_WARMUP_SELECTORS[String(platform||'')]||['main a[href]'];let candidates=[];
    for(const selector of selectors){try{const loc=page.locator(selector);const count=Math.min(20,await loc.count());for(let i=0;i<count;i++){const item=loc.nth(i);if(await item.isVisible().catch(()=>false))candidates.push(item);}if(candidates.length)break;}catch{}}
    if(!candidates.length)continue;
    const candidate=candidates[Math.floor(Math.random()*candidates.length)];
    try{
      await candidate.scrollIntoViewIfNeeded?.();await sleep(Math.max(500,Math.round(pace.scrollPauseMinMs*0.7)),signal);await clickWithInteractionIndicator(page,candidate,{timeout:7000});
      await page.waitForLoadState?.('domcontentloaded',{timeout:9000}).catch(()=>undefined);await sleep(1000+Math.floor(Math.random()*1600),signal);
      const media=page.locator('audio,video').first();if(await media.isVisible().catch(()=>false)){
        await media.evaluate(el=>{try{const p=el.play?.();if(p&&typeof p.catch==='function')p.catch(()=>undefined);}catch{}}).catch(()=>undefined);
        randomPlayedCount++;
        const remain=Math.max(900,Math.min(5500,warmupMs-(Date.now()-started)));await sleep(remain,signal);await pausePageMedia(page);
      }
    }catch{}
  }
  if(!randomPlayedCount){
    try{await page.goto(home,{waitUntil:'domcontentloaded',timeout:30000});}catch{}
    await gentleHumanScroll({page,signal,sleep,rng:Math.random,steps:intelligence.pacingMode==='slow'?5:3,pacingMode:intelligence.pacingMode}).catch(()=>undefined);
    const remaining=Math.max(0,warmupMs-(Date.now()-started));if(remaining)await sleep(Math.min(remaining,5000),signal).catch(()=>undefined);
  }
  await pausePageMedia(page).catch(()=>undefined);
  safeLog(log,`Content intelligence group warm-up completed${randomPlayedCount?` · ${randomPlayedCount} random song${randomPlayedCount===1?'':'s'} played briefly and paused`:''}`,{workId,type:'content-intelligence-warmup-complete',severity:'success',stage:'intelligence',action:'platform-warmup-complete',currentUrl:safePageUrl(page),randomPlayedCount});
  return {visited:true,randomPlayed:randomPlayedCount>0,randomPlayedCount};
}

async function maybeScreenshot(page,policy,workId,stage,files){if(!policy?.enabled||!page?.screenshot||typeof policy.pathFor!=='function') return; const file=policy.pathFor(workId,stage); if(!file) return; await page.screenshot({path:file,fullPage:false}).catch(()=>undefined); files.push(file);}
async function runStreamingSession({runId,workUnit,account,trackPlan,adapter,browserFactory,screenshotPolicy={enabled:false},signal,log,sleep=delay,persistAuthorizedSession}){
  if(!browserFactory?.open) throw new Error('Streaming browser factory is unavailable');
  if(!adapter) throw new Error('Streaming platform adapter is unavailable');
  const result={runId,workId:workUnit?.workId,accountId:account?.id,trackId:trackPlan?.track?.id,checks:{},screenshots:[],privacy:null,integrity:null};
  let session;
  try{
    throwIfAborted(signal);
    safeLog(log,'Opening isolated streaming QA browser session',{workId:workUnit?.workId});
    session=await browserFactory.open({runId,workUnit,account,executionMode:workUnit?.executionMode || 'visible',muteAudio:Boolean(workUnit?.muteAudio),signal,geoConsistencyFromProxy:true});
    if (['rotating','static'].includes(session?.allocation?.proxyKind)) safeLog(log,`Proxy source selected: ${session.allocation.proxyKind}`,{type:'proxy-selection',selectedProxyKind:session.allocation.proxyKind});
    throwIfAborted(signal);
    const page=session.page;
    result.privacy=session.privacyReport||null;
    if(typeof adapter.authenticate==='function'){
      const authentication=await waitForAuthorizedAccount({page,context:session.context,account,adapter,signal,log,sleep,persistAuthorizedSession,workId:workUnit?.workId});
      result.checks.authentication=authentication;
      if(authentication?.status!=='PASS'){
        if(authentication?.transient)throw retryableSessionError(authentication?.reason);
        throw authRequiredError(authentication?.reason||missingSessionReason());
      }
    }
    const locate=await adapter.locateTrack({page,track:trackPlan.track,signal});
    result.checks['track-location']=locate;
    throwIfAborted(signal);
    const sessionVerification=await adapter.verifySession({page,account,signal});
    result.checks['session-verification']=sessionVerification;
    await maybeScreenshot(page,screenshotPolicy,workUnit?.workId,'track-ready',result.screenshots);
    throwIfAborted(signal);
    const controls=await adapter.playbackControls({page,signal,track:trackPlan.track});
    if((trackPlan.checks||[]).includes('playback')){
      result.checks.playback=controls?.play?await controls.play():{status:'NOT_APPLICABLE',reason:'No safe playback control exposed'};
      await maybeScreenshot(page,screenshotPolicy,workUnit?.workId,'playback',result.screenshots);
    }
    const observationSeconds=Math.max(1,Number(trackPlan.observationSeconds)||1);
    safeLog(log,`Observing playback state for ${observationSeconds}s`,{workId:workUnit?.workId});
    await sleep(observationSeconds*1000,signal);
    throwIfAborted(signal);
    const requestedChecks = Array.isArray(trackPlan.checks) ? trackPlan.checks : [];
    if(requestedChecks.includes('favorite-track')||requestedChecks.includes('follow-artist')){
      const engagement=typeof adapter.engagementControls==='function'?await adapter.engagementControls({page,track:trackPlan.track,signal}):null;
      if(requestedChecks.includes('favorite-track'))result.checks['favorite-track']=engagement?.favoriteTrack?await engagement.favoriteTrack():{status:'NOT_APPLICABLE',reason:'Like/favorite song control unavailable'};
      if(requestedChecks.includes('follow-artist'))result.checks['follow-artist']=engagement?.followArtist?await engagement.followArtist():{status:'NOT_APPLICABLE',reason:'Follow/favorite artist control unavailable'};
    }
    if(requestedChecks.includes('pause-resume')) {
      if(controls?.pause && controls?.play) {
        const paused=await controls.pause();
        const pauseSeconds=Math.max(0.5,Math.min(3,Number(trackPlan?.pauseResumeSeconds)||3));
        if(paused?.status==='PASS')await sleep(pauseSeconds*1000,signal);
        const resumed=paused?.status==='PASS' ? await controls.play() : {status:'NOT_APPLICABLE',reason:'Pause did not succeed'};
        result.checks['pause-resume']={status:paused?.status==='PASS'&&resumed?.status==='PASS'?'PASS':'NOT_APPLICABLE',pauseSeconds,pause:paused,resume:resumed};
      } else result.checks['pause-resume']={status:'NOT_APPLICABLE',reason:'Safe pause/resume controls are unavailable'};
    }
    let nextResult=null;
    if(requestedChecks.includes('next-track') || requestedChecks.includes('queue-transition')) {
      nextResult=controls?.next?await controls.next():{status:'NOT_APPLICABLE',reason:'Safe next-track control is unavailable'};
    }
    if(requestedChecks.includes('next-track')) result.checks['next-track']=nextResult;
    if(requestedChecks.includes('queue-transition')) result.checks['queue-transition']=nextResult?.status==='PASS'?{status:'PASS'}:{status:'NOT_APPLICABLE',reason:'Queue transition could not be verified safely'};
    for (const check of ['previous-track','volume-control','artist-navigation','album-navigation','playlist-loading']) {
      if(requestedChecks.includes(check) && !result.checks[check]) result.checks[check]={status:'NOT_APPLICABLE',reason:'This platform adapter does not expose a safe automated control for this check'};
    }
    if(requestedChecks.includes('session-verification') && !result.checks['session-verification']) result.checks['session-verification']=sessionVerification;
    result.integrity=session.finalIntegrity?await session.finalIntegrity():session.integrity||null;
    return result;
  } finally {
    if(session?.close) await session.close().catch(()=>undefined);
  }
}

function pageClosed(page){
  try{return Boolean(page?.isClosed?.());}catch{return true;}
}
async function waitObservationWindow({page,milliseconds,signal,sleep=delay,pollMs=500}){
  let remaining=Math.max(0,Number(milliseconds)||0);
  while(remaining>0){
    throwIfAborted(signal);
    if(pageClosed(page)) return {status:'browser-closed'};
    const step=Math.min(Math.max(50,Number(pollMs)||500),remaining);
    await sleep(step,signal);
    remaining-=step;
  }
  return {status:pageClosed(page)?'browser-closed':'elapsed'};
}
async function persistCurrentAuthorizedSession(context,persistAuthorizedSession){
  if(typeof persistAuthorizedSession!=='function'||!context)return '';
  const sessionSecret=await captureAuthorizedSession(context,new Date().toISOString());
  if(sessionSecret) await persistAuthorizedSession(sessionSecret);
  return sessionSecret;
}
async function ensureSelectedTrackLocation({page,tracks,currentTrack,deck,adapter,signal,log,workId,shouldLocate=true}){
  let locate={status:'PASS',reason:'Already on selected track'};
  if(shouldLocate){
    locate=await adapter.locateTrack({page,track:currentTrack,signal});
    if(locate?.status==='WARNING'||locate?.status==='FAIL') throw new Error(locate?.reason||'Selected track could not be opened');
  }
  throwIfAborted(signal);
  let selected=trackForCurrentUrl(tracks,page?.url?.()||'');
  if(selected) return {track:selected,deck,locate};

  safeLog(log,'Current page is outside the selected QA song pool; opening another selected track',{workId,url:String(page?.url?.()||''),requestedTrackId:currentTrack?.id});
  const attempts=Math.max(1,tracks.length);
  for(let attempt=0;attempt<attempts;attempt++){
    throwIfAborted(signal);
    const picked=nextTrack(deck);
    deck=picked.state;
    const candidate=picked.track||tracks[attempt%tracks.length]||currentTrack;
    if(!candidate) break;
    locate=await adapter.locateTrack({page,track:candidate,signal});
    if(locate?.status==='WARNING'||locate?.status==='FAIL') continue;
    throwIfAborted(signal);
    selected=trackForCurrentUrl(tracks,page?.url?.()||'');
    if(selected) return {track:selected,deck,locate};
  }
  throw new Error('Unable to keep playback inside the selected OrbitQA song pool');
}
function requiresManualChallenge(result={}){
  const reason=String(result?.reason||'');
  return Boolean(result?.challenge)||/captcha|mfa|multi[- ]factor|two[- ]factor|verification code|security check|verify you are human|manual verification/i.test(reason);
}
function hasStoredCredentials(account={}){return Boolean(String(account?.username||'').trim()&&String(account?.password||'').trim());}
async function waitForAuthorizedAccount({page,context,account,adapter,signal,log,sleep,persistAuthorizedSession,workId}){
  if(typeof adapter.authenticate!=='function')return {status:'PASS',reason:'No platform authentication hook required'};
  const authAccount=savedSessionAccount(account);
  let authentication;
  try{authentication=await adapter.authenticate({page,context,account:authAccount,signal});}
  catch(error){authentication={status:'WARNING',transient:true,reason:error instanceof Error?error.message:String(error)};}
  if(authentication?.status==='PASS'){
    await persistCurrentAuthorizedSession(context,persistAuthorizedSession);
    return authentication;
  }
  if(authentication?.transient&&authentication?.status==='WARNING'){
    const reason=String(authentication?.reason||'The streaming service returned a temporary page or network error.');
    safeLog(log,`${reason} The dedicated account profile remains verified and has not been logged out.`,{workId,type:'account-transient',severity:'warning',stage:'authentication',action:'retry-later',reason,currentUrl:safePageUrl(page)});
    return {status:'WARNING',transient:true,reason};
  }
  if(!requiresManualChallenge(authentication)&&hasStoredCredentials(account)){
    safeLog(log,`Saved ${account?.platform||'streaming'} session is stale; attempting automatic credential recovery in the same account profile`,{workId,type:'account-auto-recovery',severity:'warning',stage:'authentication',action:'auto-login',reason:authentication?.reason||authentication?.status,currentUrl:safePageUrl(page)});
    let recovered;
    try{recovered=await adapter.authenticate({page,context,account:{...account,authMode:'credentials'},signal});}
    catch(error){recovered={status:'WARNING',transient:true,reason:error instanceof Error?error.message:String(error)};}
    if(recovered?.status==='PASS'){
      await persistCurrentAuthorizedSession(context,persistAuthorizedSession);
      safeLog(log,`Automatic account recovery succeeded; continuing the current task`,{workId,type:'account-auto-recovery-success',severity:'success',stage:'authentication',action:'continue-task',currentUrl:safePageUrl(page)});
      return {status:'PASS',reason:recovered.reason||'Saved credentials restored the streaming account automatically',autoRecovered:true};
    }
    if(recovered?.transient){
      const reason=String(recovered?.reason||'Automatic account recovery hit a temporary page or network error.');
      safeLog(log,reason,{workId,type:'account-auto-recovery-transient',severity:'warning',stage:'authentication',action:'retry-later',reason,currentUrl:safePageUrl(page)});
      return {status:'WARNING',transient:true,reason};
    }
    authentication=recovered||authentication;
  }
  const manualChallenge=requiresManualChallenge(authentication);
  const reason=manualChallenge
    ? `${authentication?.reason||'The account requires CAPTCHA, MFA, or another manual security challenge.'} Use LOGIN MANUALLY only to complete this security challenge.`
    : `${authentication?.reason||authentication?.status||'Saved session is not active'}. Automatic recovery could not confirm the account; manual verification is required.`;
  safeLog(log,reason,{workId,type:'account-attention',severity:'warning',stage:'authentication',action:manualChallenge?'manual-security-challenge':'manual-verification-required',reason,currentUrl:safePageUrl(page)});
  return {status:'NEEDS_VERIFICATION',reason,challenge:manualChallenge};
}



function trackMatches(left,right){
  if(!left||!right)return false;
  if(String(left.id||'')&&String(left.id||'')===String(right.id||''))return true;
  const a=canonicalTrackUrlKey(left.url||''),b=canonicalTrackUrlKey(right.url||'');
  return Boolean(a&&b&&a===b);
}
function selectionForTrack(musicSelections=[],track){
  return (musicSelections||[]).find(selection=>(selection.tracks||[]).some(candidate=>trackMatches(candidate,track)))||null;
}
function trackFromPool(tracks=[],candidate){return (tracks||[]).find(track=>trackMatches(track,candidate))||null;}
async function ensureQaMusicSelectionLocation({page,tracks,musicSelections,currentTrack,deck,adapter,signal,log,workId,shouldLocate=true}){
  const selection=selectionForTrack(musicSelections,currentTrack);
  if(selection&&typeof adapter.openMusicSelection==='function'){
    const opened=await adapter.openMusicSelection({page,selection,preferredTrack:currentTrack,signal});
    if(opened?.status==='WARNING'||opened?.status==='FAIL'||opened?.status==='NOT_APPLICABLE')throw new Error(opened?.reason||'Selected QA music link could not provide a playable song');
    const chosen=trackFromPool(tracks,opened?.track)||trackFromPool(tracks,currentTrack);
    if(!chosen)throw new Error('QA MUSIC SELECTION resolved a song outside the selected saved song pool');
    safeLog(log,`QA MUSIC SELECTION opened: ${selection.name||selection.id} -> ${chosen.title||chosen.id}`,{workId,type:'qa-music-selection',severity:'success',stage:'selection',action:'open-selection',selectionId:selection.id,selectionName:selection.name,sourceInput:selection.sourceInput,sourceUrl:opened?.sourceUrl||selection.sourceInput,trackId:chosen.id,trackTitle:chosen.title,method:opened?.method,currentUrl:safePageUrl(page)});
    let locate={status:'PASS',url:chosen.url,sourceInput:selection.sourceInput,sourceKind:selection.sourceKind,method:opened?.method||'source-page'};
    const spotifySearch=String(adapter?.id||chosen?.platform||'')==='spotify'&&/open\.spotify\.com\/search\//i.test(String(chosen.url||''));
    if(spotifySearch&&typeof adapter.locateTrack==='function'){
      try{
        const resolved=await adapter.locateTrack({page,track:chosen,signal});
        if(resolved?.status==='PASS'){
          locate={...locate,...resolved,method:resolved.method||'spotify-search-resolved'};
          safeLog(log,`Spotify search result resolved before Play: ${chosen.title||chosen.id}`,{workId,type:'spotify-search-resolved',severity:'success',stage:'navigation',action:'resolve-track-url',trackId:chosen.id,trackTitle:chosen.title,currentUrl:resolved.url});
        }else{
          safeLog(log,`Spotify search result will be played from the visible result card: ${resolved?.reason||'direct track URL was not exposed'}`,{workId,type:'spotify-search-card-play',severity:'info',stage:'navigation',action:'use-result-card',trackId:chosen.id,trackTitle:chosen.title,reason:resolved?.reason,currentUrl:safePageUrl(page)});
        }
      }catch(error){
        safeLog(log,`Spotify search result will be played from the visible result card: ${error instanceof Error?error.message:String(error)}`,{workId,type:'spotify-search-card-play',severity:'warning',stage:'navigation',action:'use-result-card',trackId:chosen.id,trackTitle:chosen.title,reason:error instanceof Error?error.message:String(error),currentUrl:safePageUrl(page)});
      }
    }
    if(typeof adapter.selectedTrackReady==='function'){
      let ready=false;
      try{ready=Boolean(await adapter.selectedTrackReady({page,track:chosen,signal}));}catch{ready=false;}
      if(!ready&&typeof adapter.locateTrack==='function'){
        const exact=await adapter.locateTrack({page,track:chosen,signal});
        if(exact?.status==='WARNING'||exact?.status==='FAIL'||exact?.status==='NOT_APPLICABLE')throw new Error(exact?.reason||'Selected song could not be opened directly');
        locate={...locate,...exact,method:exact.method||'strict-selected-track'};
        try{ready=Boolean(await adapter.selectedTrackReady({page,track:chosen,signal}));}catch{ready=false;}
      }
      if(!ready)throw new Error('Playback blocked: browser location does not match the selected OrbitQA song');
    }
    return {track:chosen,deck,locate};
  }
  const located=await ensureSelectedTrackLocation({page,tracks,currentTrack,deck,adapter,signal,log,workId,shouldLocate});
  if(located?.track&&typeof adapter.selectedTrackReady==='function'){
    let ready=false;try{ready=Boolean(await adapter.selectedTrackReady({page,track:located.track,signal}));}catch{ready=false;}
    if(!ready)throw new Error('Playback blocked: browser location does not match the selected OrbitQA song');
  }
  return located;
}

async function waitForSelectedTrackLocation({page,tracks,musicSelections=[],currentTrack,deck,adapter,signal,log,sleep,workId,shouldLocate=true}){
  let locateThisAttempt=shouldLocate;
  let attempt=0;
  let transientReloads=0;
  let stallReloads=0;
  const rejectedTracks=new Set();
  while(attempt<20){
    throwIfAborted(signal);
    if(pageClosed(page)) return {status:'browser-closed',track:null,deck};
    attempt++;
    try{
      const located=await ensureQaMusicSelectionLocation({page,tracks,musicSelections,currentTrack,deck,adapter,signal,log,workId,shouldLocate:locateThisAttempt});
      return {status:'ready',...located};
    }catch(error){
      const reason=error instanceof Error?error.message:String(error);
      // Catalog links can disappear or become region-unavailable between refreshes.
      // Rotate only within the explicitly selected QA pool; do not retry the missing
      // record twenty times or broaden the catalog outside the user's selection.
      if(/(?:song|track|music|result).{0,45}(?:not found|unavailable|does not exist|removed)|(?:not found|unavailable).{0,45}(?:song|track)|404(?:\b|$)/i.test(reason)){
        rejectedTracks.add(String(currentTrack?.id||currentTrack?.url||''));
        const alternative=tracks.find(candidate=>candidate&&!candidate.unavailable&&!rejectedTracks.has(String(candidate.id||candidate.url||'')));
        if(alternative){
          safeLog(log,`Selected song unavailable; switching to another selected song: ${alternative.title||alternative.id}`,{workId,type:'track-unavailable-skip',severity:'warning',stage:'navigation',action:'switch-selected-track',trackId:currentTrack?.id,trackTitle:currentTrack?.title,nextTrackId:alternative.id,reason,currentUrl:safePageUrl(page)});
          currentTrack=alternative;
          locateThisAttempt=true;
          continue;
        }
        // No different selected track remains: report the unavailable pool clearly.
        throw new Error(`No playable selected song remains in this QA pool: ${reason}`);
      }
      if(transientReloads<2&&await reloadTransientStreamingPage({page,signal,log,workId,stage:'navigation'})){
        transientReloads++;
        const recovered=await waitObservationWindow({page,milliseconds:700,signal,sleep,pollMs:350});
        if(recovered.status==='browser-closed') return {status:'browser-closed',track:null,deck};
        locateThisAttempt=true;
        continue;
      }
      // A page can be visually stuck without exposing one of the known service-error strings.
      // Recover at bounded checkpoints so an account never waits forever for a manual refresh.
      if([6,13].includes(attempt)&&stallReloads<2&&typeof page?.reload==='function'){
        stallReloads++;
        try{
          await page.reload({waitUntil:'domcontentloaded',timeout:30000});
          safeLog(log,`Streaming page stopped making navigation progress; refreshed automatically before retry ${attempt+1}`,{workId,type:'navigation-stall-recovery',severity:'warning',stage:'navigation',action:'auto-refresh-stalled-page',attempt,trackId:currentTrack?.id,trackTitle:currentTrack?.title,currentUrl:safePageUrl(page)});
          const recovered=await waitObservationWindow({page,milliseconds:800,signal,sleep,pollMs:400});
          if(recovered.status==='browser-closed') return {status:'browser-closed',track:null,deck};
          locateThisAttempt=true;
          continue;
        }catch(reloadError){
          safeLog(log,`Automatic stalled-page refresh did not complete: ${reloadError instanceof Error?reloadError.message:String(reloadError)}`,{workId,type:'navigation-stall-recovery',severity:'warning',stage:'navigation',action:'auto-refresh-stalled-page',attempt,trackId:currentTrack?.id,trackTitle:currentTrack?.title,currentUrl:safePageUrl(page)});
        }
      }
      safeLog(log,`Selected track is still loading; retrying in the same browser: ${error instanceof Error?error.message:String(error)}`,{workId,type:'track-retry',severity:'warning',stage:'navigation',action:'retry-track',attempt,trackId:currentTrack?.id,trackTitle:currentTrack?.title,reason:error instanceof Error?error.message:String(error),currentUrl:safePageUrl(page)});
      const waited=await waitObservationWindow({page,milliseconds:1000,signal,sleep,pollMs:500});
      if(waited.status==='browser-closed') return {status:'browser-closed',track:null,deck};
      locateThisAttempt=true;
    }
  }
  throw new Error('Selected song did not become ready after bounded navigation retries');
}

async function waitForPlaybackStart({page,adapter,signal,log,sleep,workId,track,consumeTransientPlayerIssue=()=>null}){
  let attempt=0;
  let transientReloads=0;
  let stalePlayerReloads=0;
  let lastPlayback={status:'NOT_APPLICABLE',reason:'Player controls are still loading'};
  const recentReasons=[];
  while(attempt<16){
    throwIfAborted(signal);
    if(pageClosed(page)) return {status:'browser-closed',controls:null,playback:{status:'NOT_APPLICABLE',reason:'Browser was closed manually'}};
    attempt++;
    let controls=null;
    let playback={status:'NOT_APPLICABLE',reason:'Player controls are still loading'};
    try{
      safeLog(log,`Playback attempt ${attempt}: ${track?.title||track?.id||'selected track'}`,{workId,type:'playback-attempt',severity:'info',stage:'playback',action:'activate-play',attempt,trackId:track?.id,trackTitle:track?.title,currentUrl:safePageUrl(page)});
      controls=await adapter.playbackControls({page,signal,track});
      playback=controls?.play?await controls.play():playback;
    }catch(error){
      playback={status:'WARNING',reason:error instanceof Error?error.message:String(error)};
    }
    lastPlayback=playback||lastPlayback;
    const reason=String(playback?.reason||playback?.status||'Playback did not start').trim();
    if(reason){recentReasons.push(reason);if(recentReasons.length>4)recentReasons.shift();}
    if(playback?.status==='PASS') return {status:'playing',controls,playback};

    // A genuine protected-media/DRM failure is not improved by repeating the same Play click.
    // Stop the blind retry loop and surface the actual cause immediately.
    if(/protected-media|DRM|Widevine.*unavailable|Encrypted Media Extensions are unavailable/i.test(reason)){
      const error=new Error(`Playback could not start because protected media is unavailable: ${reason}`);
      error.code='ORBITQA_STREAMING_MEDIA_UNAVAILABLE';
      throw error;
    }

    const transientPlayerIssue=consumeTransientPlayerIssue?.()||null;
    if(transientPlayerIssue?.playerRecovery){
      safeLog(log,`Recovering temporary player state before retry ${attempt+1}: ${transientPlayerIssue.reason||transientPlayerIssue.kind}`,{workId,type:'player-state-recovery',severity:'warning',stage:'playback',action:'recover-player-state',attempt,trackId:track?.id,trackTitle:track?.title,reason:transientPlayerIssue.reason||transientPlayerIssue.kind,currentUrl:safePageUrl(page)});
      try{if(transientPlayerIssue.kind==='player-device-lost'&&typeof page?.reload==='function')await page.reload({waitUntil:'domcontentloaded',timeout:30000});if(typeof adapter?.locateTrack==='function')await adapter.locateTrack({page,track,signal}).catch(()=>undefined);}catch{}
      const recoveryWait=await waitObservationWindow({page,milliseconds:transientPlayerIssue.kind==='player-device-lost'?1100:750,signal,sleep,pollMs:250});
      if(recoveryWait.status==='browser-closed')return {status:'browser-closed',controls,playback};
      continue;
    }

    if(transientReloads<2&&await reloadTransientStreamingPage({page,signal,log,workId,stage:'playback'})){
      transientReloads++;
      const recovered=await waitObservationWindow({page,milliseconds:700,signal,sleep,pollMs:350});
      if(recovered.status==='browser-closed') return {status:'browser-closed',controls,playback};
      continue;
    }

    // If Spotify's player shell is stale even though the page is not showing the generic error
    // screen, re-open the exact selected track at bounded checkpoints instead of clicking the same
    // dead control sixteen times. This stays on the same account/profile and selected song.
    if([4,9,13].includes(attempt)&&typeof adapter?.locateTrack==='function'){
      try{
        const relocated=await adapter.locateTrack({page,track,signal});
        if(relocated?.status==='PASS'){
          safeLog(log,`Playback recovery reopened the selected song before retry ${attempt+1}`,{workId,type:'playback-track-recovery',severity:'info',stage:'playback',action:'relocate-selected-track',attempt,trackId:track?.id,trackTitle:track?.title,currentUrl:safePageUrl(page)});
          const waited=await waitObservationWindow({page,milliseconds:650,signal,sleep,pollMs:325});
          if(waited.status==='browser-closed') return {status:'browser-closed',controls,playback};
          continue;
        }
      }catch(error){
        safeLog(log,`Playback recovery could not reopen the selected song: ${error instanceof Error?error.message:String(error)}`,{workId,type:'playback-track-recovery',severity:'warning',stage:'playback',action:'relocate-selected-track',attempt,trackId:track?.id,trackTitle:track?.title,currentUrl:safePageUrl(page)});
      }
    }

    // One bounded normal reload can recover a stale Spotify web-player runtime. Never loop this.
    if(attempt===11&&stalePlayerReloads<1&&typeof page?.reload==='function'){
      stalePlayerReloads++;
      try{
        await page.reload({waitUntil:'domcontentloaded',timeout:30000});
        safeLog(log,'Playback recovery refreshed the selected-song page once before continuing',{workId,type:'playback-page-recovery',severity:'info',stage:'playback',action:'reload-selected-track',attempt,trackId:track?.id,trackTitle:track?.title,currentUrl:safePageUrl(page)});
        const waited=await waitObservationWindow({page,milliseconds:900,signal,sleep,pollMs:300});
        if(waited.status==='browser-closed') return {status:'browser-closed',controls,playback};
        continue;
      }catch(error){
        safeLog(log,`Playback recovery page refresh failed: ${error instanceof Error?error.message:String(error)}`,{workId,type:'playback-page-recovery',severity:'warning',stage:'playback',action:'reload-selected-track',attempt,trackId:track?.id,trackTitle:track?.title,currentUrl:safePageUrl(page)});
      }
    }

    safeLog(log,`Playback has not started yet; keeping the same selected track open and retrying (${attempt})`,{workId,type:'playback-retry',severity:'warning',stage:'playback',action:'retry-play',attempt,trackId:track?.id,trackTitle:track?.title,reason,currentUrl:safePageUrl(page)});
    const waited=await waitObservationWindow({page,milliseconds:750,signal,sleep,pollMs:250});
    if(waited.status==='browser-closed') return {status:'browser-closed',controls,playback};
  }
  const lastReason=String(lastPlayback?.reason||lastPlayback?.status||recentReasons.at(-1)||'unknown playback failure').trim();
  const error=new Error(`Playback did not start for the selected song after ${attempt} attempts. Last reason: ${lastReason}`);
  error.code='ORBITQA_STREAMING_PLAYBACK_START_FAILED';
  error.playbackReason=lastReason;
  error.recentReasons=[...recentReasons];
  throw error;
}


function stableSeed(value=''){
  let hash=2166136261;
  for(const ch of String(value)){hash^=ch.charCodeAt(0);hash=Math.imul(hash,16777619);}
  return hash>>>0;
}
function randomPauseVisit({runId='',accountId='',visitLimit=1}={}){
  const total=Math.max(1,Math.floor(Number(visitLimit)||1));
  return 1+(stableSeed(`${runId}:${accountId}:pause-visit`)%total);
}
function randomPauseOffsetMs({runId='',accountId='',visit=1,targetMs=1000}={}){
  const target=Math.max(1,Math.floor(Number(targetMs)||1));
  const unit=(stableSeed(`${runId}:${accountId}:${visit}:pause-offset`)%10000)/10000;
  const ratio=0.2+(unit*0.55);
  return Math.max(0,Math.min(Math.max(0,target-100),Math.floor(target*ratio)));
}
function activeTrackMatchesCached(page,id,track,cacheRef){
  if(!cacheRef) return null;
  try {
    const now = Date.now();
    if(cacheRef.trackKey === (track?.id||track?.url) && cacheRef.id === id && (now - cacheRef.ts) < 250) return cacheRef.value;
  } catch {}
  return null;
}
async function playbackEvidence(controls,signal){
  if(typeof controls?.isPlaying!=='function')return {status:'PASS',reason:'Playback start was confirmed; continuous playback probe is unavailable'};
  try{return await boundedBrowserProbe('Playback status',()=>controls.isPlaying(),{signal});}catch(error){if(error?.code==='ORBITQA_STREAMING_PROBE_STALLED')throw error;return {status:'WARNING',reason:error instanceof Error?error.message:String(error)};}
}
async function observeVerifiedPlayback({page,controls,track,adapter,signal,sleep,targetSeconds,pausePlan,log,workId,intelligencePlan}){
  const targetMs=Math.max(1000,Math.floor(Number(targetSeconds)||1)*1000);
  const observationStartedAt=Date.now();
  const observationDeadline=observationStartedAt+targetMs;
  let activeMs=0;
  let pauseResult=null;
  let intelligenceVolumeDone=false;
  let intelligenceReplayDone=false;
  let lastTickAt=observationStartedAt;
  let previousPlaying=true;
  let wrongTrackRecoveries=0;
  let adInterrupted=false;
  let recoveryAttempts=0;
  const pollMs=200; // DOM/Playwright probes are asynchronous; avoid overlapping timers.
  const adActive=async()=>{
    try{return Boolean(await adapter?.advertisementActive?.({page,track,signal}));}catch{return false;}
  };
  while(Date.now()<observationDeadline){
    throwIfAborted(signal);
    if(pageClosed(page))return {status:'browser-closed',activePlaybackMs:activeMs,targetPlaybackMs:targetMs,pauseResult,elapsedPlaybackMs:Date.now()-observationStartedAt};

    // Strict selected-media guard. The observation may never continue on an unassigned song.
    // Prefer the adapter's active-player identity check because a service page URL may stay
    // unchanged after autoplay/queue advances to a different song.
    const matchAssignedTrack=async()=>{
      try{
        if(typeof adapter?.activeTrackMatches==='function')return Boolean(await boundedBrowserProbe('Selected track identity',()=>adapter.activeTrackMatches({page,track,signal}),{signal}));
        if(typeof adapter?.selectedTrackReady==='function')return Boolean(await boundedBrowserProbe('Selected track readiness',()=>adapter.selectedTrackReady({page,track,signal}),{signal}));
      }catch(error){if(error?.code==='ORBITQA_STREAMING_PROBE_STALLED')throw error;}
      return false;
    };
    if(typeof adapter?.activeTrackMatches==='function'||typeof adapter?.selectedTrackReady==='function'){
      const selected=await matchAssignedTrack();
      if(!selected){
        if(await adActive()){
          if(!adInterrupted)safeLog(log,'AD_INTERRUPTED: advertisement active; selected-song credit suspended until playback is verified again',{workId,type:'ad-interrupted',severity:'info',stage:'observation',trackId:track?.id,trackTitle:track?.title});
          adInterrupted=true;
          previousPlaying=false;
          lastTickAt=Date.now();
          await sleep(Math.min(pollMs,Math.max(0,observationDeadline-Date.now())),signal);
          continue;
        }
        if(adInterrupted){
          adInterrupted=false;
          safeLog(log,'Advertisement ended; recovering assigned song',{workId,type:'ad-finished',severity:'info',stage:'observation',trackId:track?.id,trackTitle:track?.title});
        }
        wrongTrackRecoveries++;
        previousPlaying=false;
        try{if(controls?.pause)await controls.pause();}catch{}
        // Hard-stop any HTML media element too, so an auto-advanced song cannot keep sounding
        // while OrbitQA is navigating back to the assigned song.
        try{await page?.evaluate?.(()=>{for(const el of document.querySelectorAll('audio,video')){try{el.pause?.();}catch{}}});}catch{}
        safeLog(log,`Unexpected media detected during observation; stopping it and restoring ${track?.title||track?.id}`,{workId,type:'unexpected-media-blocked',severity:'warning',stage:'observation',action:'restore-selected-track',trackId:track?.id,trackTitle:track?.title,recoveryCount:wrongTrackRecoveries,currentUrl:safePageUrl(page)});
        let located=null;try{located=await adapter.locateTrack({page,track,signal});}catch(error){located={status:'FAIL',reason:error instanceof Error?error.message:String(error)};}
        if(located?.status==='WARNING'||located?.status==='FAIL')return {status:'invalid',reason:located?.reason||'Unexpected song could not be stopped/restored before the fixed observation deadline',activePlaybackMs:activeMs,targetPlaybackMs:targetMs,pauseResult,wrongTrackRecoveries,elapsedPlaybackMs:Date.now()-observationStartedAt};
        if(Date.now()>=observationDeadline)break;
        let restoredPlay={status:'WARNING',reason:'Assigned song did not restart'};
        try{if(controls?.play)restoredPlay=await controls.play();}catch(error){restoredPlay={status:'WARNING',reason:error instanceof Error?error.message:String(error)};}
        if(restoredPlay?.status!=='PASS')return {status:'invalid',reason:restoredPlay?.reason||'Assigned song could not be restarted after unexpected media was stopped',activePlaybackMs:activeMs,targetPlaybackMs:targetMs,pauseResult,wrongTrackRecoveries,elapsedPlaybackMs:Date.now()-observationStartedAt};
        let restored=false;
        for(let verifyAttempt=0;verifyAttempt<6&&!restored;verifyAttempt++){
          if(Date.now()>=observationDeadline)break;
          restored=await matchAssignedTrack();
          if(!restored)await sleep(Math.min(150,Math.max(0,observationDeadline-Date.now())),signal);
        }
        if(!restored)return {status:'invalid',reason:'Unexpected song was stopped, but the active player could not be verified back on the assigned OrbitQA song',activePlaybackMs:activeMs,targetPlaybackMs:targetMs,pauseResult,wrongTrackRecoveries,elapsedPlaybackMs:Date.now()-observationStartedAt};
        lastTickAt=Date.now();previousPlaying=false;
        continue;
      }
    }

    const nowBeforeActions=Date.now();
    const elapsedBefore=Math.max(0,nowBeforeActions-observationStartedAt);
    if(pausePlan?.enabled&&!pauseResult&&elapsedBefore>=pausePlan.atActiveMs&&nowBeforeActions<observationDeadline){
      const configuredMs=Math.max(500,Math.min(3000,Math.floor(Number(pausePlan.durationMs)||3000)));
      const remaining=Math.max(0,observationDeadline-Date.now());
      const boundedPauseMs=Math.min(configuredMs,remaining);
      const paused=controls?.pause?await controls.pause():{status:'NOT_APPLICABLE',reason:'Pause control unavailable'};
      let resumed={status:'NOT_APPLICABLE',reason:'Pause did not succeed'};
      if(paused?.status==='PASS'&&boundedPauseMs>0){
        safeLog(log,`Random pause started: ${track?.title||track?.id} · ${boundedPauseMs/1000}s`,{workId,type:'pause-start',severity:'info',stage:'playback',action:'pause-resume',trackId:track?.id,trackTitle:track?.title,pauseSeconds:boundedPauseMs/1000});
        const started=Date.now();await sleep(boundedPauseMs,signal);const actualMs=Math.max(0,Date.now()-started);const overrunMs=Math.max(0,actualMs-boundedPauseMs);
        if(Date.now()<observationDeadline)resumed=controls?.play?await controls.play():{status:'NOT_APPLICABLE',reason:'Resume control unavailable'};
        pauseResult={status:overrunMs>250?'WARNING':Date.now()>=observationDeadline?'PASS':resumed?.status==='PASS'?'PASS':'NOT_APPLICABLE',reason:overrunMs>250?`Pause timing exceeded the configured ${boundedPauseMs}ms deadline by ${overrunMs}ms`:Date.now()>=observationDeadline?'Observation deadline arrived during the configured pause':(resumed?.reason||'Paused and resumed'),configuredMs:boundedPauseMs,actualMs,overrunMs,pause:paused,resume:resumed};
        if(overrunMs>250)return {status:'invalid',reason:pauseResult.reason,activePlaybackMs:activeMs,targetPlaybackMs:targetMs,pauseResult,wrongTrackRecoveries,elapsedPlaybackMs:Date.now()-observationStartedAt};
        lastTickAt=Date.now();previousPlaying=false;
        if(Date.now()>=observationDeadline)break;
      }else pauseResult={status:'NOT_APPLICABLE',reason:paused?.reason||'Pause control unavailable',configuredMs:boundedPauseMs,pause:paused,resume:resumed};
    }

    if(intelligencePlan?.enabled&&intelligencePlan.volumeDirection&&!intelligenceVolumeDone&&elapsedBefore>=targetMs*0.30){
      intelligenceVolumeDone=true;const direction=intelligencePlan.volumeDirection==='up'?'up':'down';const changed=direction==='up'?await controls?.volumeUp?.():await controls?.volumeDown?.();
      safeLog(log,`Content intelligence ${direction==='up'?'increased':'reduced'} volume${changed?.reason?` · ${changed.reason}`:''}`,{workId,type:'content-intelligence-volume',severity:'info',stage:'intelligence',action:'volume',trackId:track?.id,trackTitle:track?.title});
    }
    if(intelligencePlan?.enabled&&intelligencePlan.replay&&!intelligenceReplayDone&&targetMs>=12000&&elapsedBefore>=targetMs*0.68){
      intelligenceReplayDone=true;let replayed=false;try{replayed=Boolean(await page?.evaluate?.(()=>{const el=[...document.querySelectorAll('audio,video')].find(x=>!x.paused)||document.querySelector('audio,video');if(!el)return false;try{el.currentTime=0;const p=el.play?.();if(p&&typeof p.catch==='function')p.catch(()=>undefined);return true;}catch{return false;}}));}catch{}
      if(replayed)safeLog(log,`Content intelligence replayed the selected song from the beginning`,{workId,type:'content-intelligence-replay',severity:'info',stage:'intelligence',action:'replay',trackId:track?.id,trackTitle:track?.title});
    }

    const before=await playbackEvidence(controls,signal);
    const now=Date.now();
    if(previousPlaying)activeMs+=Math.max(0,Math.min(now,observationDeadline)-lastTickAt);
    lastTickAt=now;previousPlaying=before?.status==='PASS';
    if(before?.status!=='PASS'){
      previousPlaying=false;
      if(await adActive()){
        if(!adInterrupted)safeLog(log,'AD_INTERRUPTED: playback stopped for advertisement; credit suspended',{workId,type:'ad-interrupted',severity:'info',stage:'observation',trackId:track?.id,trackTitle:track?.title});
        adInterrupted=true;
        await sleep(Math.min(pollMs,Math.max(0,observationDeadline-Date.now())),signal);
        continue;
      }
      // A transient player stall is not a terminal session error. Give the
      // selected track a bounded, non-overlapping recovery attempt.
      if(++recoveryAttempts<=3&&Date.now()<observationDeadline){
        safeLog(log,'Playback stalled; retrying the selected song without crediting downtime',{workId,type:'playback-stall-recovery',severity:'warning',stage:'observation',trackId:track?.id,trackTitle:track?.title,recoveryAttempts});
        const resumed=await controls?.play?.().catch(()=>({status:'WARNING'}));
        if(resumed?.status==='PASS'){
          const selected=typeof adapter?.activeTrackMatches==='function'?await adapter.activeTrackMatches({page,track,signal}).catch(()=>false):false;
          if(selected){lastTickAt=Date.now();continue;}
        }
        await sleep(Math.min(500,Math.max(0,observationDeadline-Date.now())),signal);
        continue;
      }
      return {status:'invalid',reason:before?.reason||'Selected playback could not recover before the observation deadline',activePlaybackMs:activeMs,targetPlaybackMs:targetMs,pauseResult,wrongTrackRecoveries,elapsedPlaybackMs:Date.now()-observationStartedAt};
    }
    recoveryAttempts=0;
    const remaining=Math.max(0,observationDeadline-Date.now());
    if(!remaining)break;
    await sleep(Math.min(pollMs,remaining),signal);
  }

  const finalNow=Date.now();if(previousPlaying)activeMs+=Math.max(0,Math.min(finalNow,observationDeadline)-lastTickAt);
  let hardStopResult={status:'NOT_APPLICABLE',reason:'Pause control unavailable'};
  try{if(controls?.pause)hardStopResult=await controls.pause();}catch(error){hardStopResult={status:'WARNING',reason:error instanceof Error?error.message:String(error)};}
  // Also pause every HTML media element so an auto-advanced/unassigned song cannot continue after the deadline.
  try{await page?.evaluate?.(()=>{for(const el of document.querySelectorAll('audio,video')){try{el.pause?.();}catch{}}});}catch{}
  safeLog(log,`Observation deadline reached for ${track?.title||track?.id} · hard wall-clock stop at ${Math.round(targetMs/1000)}s`,{workId,type:'observation-hard-stop',severity:hardStopResult?.status==='PASS'?'success':'warning',stage:'observation',action:'hard-stop',trackId:track?.id,trackTitle:track?.title,targetPlaybackMs:targetMs,activePlaybackMs:activeMs,elapsedPlaybackMs:Math.min(targetMs,finalNow-observationStartedAt),wrongTrackRecoveries,reason:hardStopResult?.reason});
  return {status:'PASS',reason:'Fixed wall-clock observation deadline completed; only the assigned OrbitQA song was permitted and media was stopped at the ceiling',activePlaybackMs:activeMs,targetPlaybackMs:targetMs,elapsedPlaybackMs:Math.min(targetMs,finalNow-observationStartedAt),pauseResult,hardStopResult,wrongTrackRecoveries};
}

async function runPersistentAccountStreamingSession({
  runId,
  workUnit,
  account,
  tracks=[],
  musicSelections=[],
  initialTrack,
  observation={minSeconds:60,maxSeconds:110},
  queueMode='sequential',
  checks=['playback','session-verification'],
  pauseResumeSeconds=3,
  volumeDirection='decrease',
  adapter,
  browserFactory,
  screenshotPolicy={enabled:false},
  signal,
  log,
  sleep=delay,
  persistAuthorizedSession,
  onTrackStart,
  onTrackComplete,
  onTrackInvalid,
  restAfterTracks=0,
  restMinutes=0,
  restAndReplay=false,
  maxTrackVisits=Infinity,
  trackCoordinator=null,
}){
  if(!browserFactory?.open) throw new Error('Streaming browser factory is unavailable');
  if(!adapter) throw new Error('Streaming platform adapter is unavailable');
  if(!Array.isArray(tracks)||!tracks.length) throw new Error('Persistent streaming account session requires selected tracks');
  const screenshots=[];
  const requestedChecks=Array.isArray(checks)?checks:[];
  const checkTotals={};
  const visitedKeys=new Set();
  const visitLimit=Math.max(1,Math.min(Number.isFinite(Number(maxTrackVisits))?Math.floor(Number(maxTrackVisits)):tracks.length,tracks.length));
  const pauseVisit=requestedChecks.includes('pause-resume')?randomPauseVisit({runId,accountId:account?.id||workUnit?.accountId,visitLimit}):0;
  let session=null;
  let detachPageDiagnostics=()=>{};
  let pendingTransientPlayerIssue=null;
  let visits=0;
  let currentTrack=null;
  let currentAlreadyLocated=false;
  let terminalReason='unexpected-error';
  let activeLease=null;
  let previousTrack=null;
  let deck=createPersistentTrackDeck({tracks,initialTrack:initialTrack||tracks[0],seed:`${runId||'stream'}:${account?.id||workUnit?.accountId||'account'}`,mode:queueMode});
  let first=nextTrack(deck); deck=first.state; currentTrack=first.track||initialTrack||tracks[0];
  const keyOf=track=>String(track?.id||track?.url||'');
  const releaseLease=()=>{try{activeLease?.release?.();}catch{}activeLease=null;};
  const recordCheck=(name,result,track)=>{
    const status=String(result?.status||'NOT_APPLICABLE');
    checkTotals[name]=checkTotals[name]||{PASS:0,WARNING:0,NOT_APPLICABLE:0,FAIL:0};
    if(checkTotals[name][status]===undefined)checkTotals[name][status]=0;
    checkTotals[name][status]++;
    safeLog(log,`${name}: ${status}${result?.reason?` · ${result.reason}`:''}`,{workId:workUnit?.workId,type:'qa-check',severity:status==='PASS'?'success':status==='WARNING'||status==='FAIL'?'warning':'info',stage:'qa-check',action:name,trackId:track?.id,trackTitle:track?.title,reason:result?.reason,currentUrl:safePageUrl(session?.page)});
    return result;
  };
  const nextUnvisited=()=>{
    const order=Array.isArray(deck?.order)&&deck.order.length?deck.order:tracks;
    for(let attempt=0;attempt<order.length+tracks.length;attempt++){
      const picked=nextTrack(deck);deck=picked.state;
      const candidate=picked.track||tracks[attempt%tracks.length];
      if(candidate&&!visitedKeys.has(keyOf(candidate)))return candidate;
    }
    return tracks.find(track=>!visitedKeys.has(keyOf(track)))||null;
  };
  async function restoreSelectedTrack(page,track){
    if(!track)return {status:'NOT_APPLICABLE',reason:'No selected track to restore'};
    try{
      const located=await adapter.locateTrack({page,track,signal});
      if(located?.status==='WARNING'||located?.status==='FAIL'||located?.status==='NOT_APPLICABLE')return located;
      if(typeof adapter.selectedTrackReady==='function'&&!await adapter.selectedTrackReady({page,track,signal}))return {status:'WARNING',reason:'Returned page does not match the selected OrbitQA song'};
      const controls=await adapter.playbackControls({page,signal,track}).catch(()=>null);
      await controls?.pause?.().catch(()=>undefined);
      return {status:'PASS',reason:'Returned to selected OrbitQA song'};
    }catch(error){return {status:'WARNING',reason:error instanceof Error?error.message:String(error)};}
  }
  async function navigationCheck(page,kind,track){
    if(typeof adapter.navigationCheck!=='function')return {status:'NOT_APPLICABLE',reason:`${kind} navigation is unavailable`};
    const selection=selectionForTrack(musicSelections,track);
    let result;
    try{result=await adapter.navigationCheck({page,kind,selection,track,signal});}
    catch(error){result={status:'WARNING',reason:error instanceof Error?error.message:String(error)};}
    await restoreSelectedTrack(page,track);
    return result;
  }
  try{
    throwIfAborted(signal);
    safeLog(log,'Opening persistent authorized streaming QA browser',{workId:workUnit?.workId,accountId:account?.id,severity:'info',stage:'browser',action:'open-browser'});
    session=await browserFactory.open({runId,workUnit,account,executionMode:workUnit?.executionMode||'visible',muteAudio:Boolean(workUnit?.muteAudio),signal,usePersistentProfile:true,geoConsistencyFromProxy:true});
    let assignedProxy='';
    let currentExitIp='';
    let proxyKind='';
    if(['rotating','static'].includes(session?.allocation?.proxyKind)){
      proxyKind=String(session.allocation.proxyKind||'');
      assignedProxy=safeProxyDisplayEndpoint(session.allocation.server);
      currentExitIp=String(session?.initialRoute?.proxiedIp||'');
      safeLog(log,`Proxy route active · assigned ${assignedProxy||proxyKind} · current exit IP ${currentExitIp||'verified through proxy'}`,{type:'proxy-selection',selectedProxyKind:session.allocation.proxyKind,proxyKind,assignedProxy,currentExitIp,severity:'success',stage:'proxy',action:'proxy-route-active'});
    }
    const page=session.page;
    detachPageDiagnostics=attachStreamingPageDiagnostics({page,log,workId:workUnit?.workId,platform:account?.platform||'streaming',onTransientIssue:(issue)=>{if(issue?.playerRecovery)pendingTransientPlayerIssue={...issue,at:Date.now()};}});
    safeLog(log,'Persistent account browser opened',{workId:workUnit?.workId,accountId:account?.id,severity:'success',stage:'browser',action:'browser-ready',currentUrl:safePageUrl(page),deviceMode:workUnit?.deviceMode,deviceProfile:workUnit?.deviceProfile});
    if(session?.privacyReport){
      const permissionStates=session.privacyReport?.observed?.permissionStates||{};
      const permissionSummary=['camera','microphone','geolocation','notifications'].map(key=>permissionStates[key]?`${key}=${permissionStates[key]}`:'').filter(Boolean).join(' · ');
      safeLog(log,`${session.privacyReport.overall==='warning'?'Privacy preflight accepted with warnings':'Privacy preflight passed'}${permissionSummary?` · ${permissionSummary}`:''}`,{workId:workUnit?.workId,type:'privacy-preflight',severity:session.privacyReport.overall==='warning'?'warning':'success',stage:'privacy',action:'privacy-ready',reason:session.privacyReport.overall||'pass',currentUrl:safePageUrl(page)});
    }
    if(pageClosed(page)){terminalReason='browser-closed';return {runId,workId:workUnit?.workId,accountId:account?.id,trackVisits:0,reason:terminalReason,screenshots,checkTotals};}

    const initialAuthentication=await waitForAuthorizedAccount({page,context:session.context,account,adapter,signal,log,sleep,persistAuthorizedSession,workId:workUnit?.workId});
    if(initialAuthentication?.status==='browser-closed'){terminalReason='browser-closed';return {runId,workId:workUnit?.workId,accountId:account?.id,trackVisits:0,reason:terminalReason,screenshots,checkTotals};}
    if(requestedChecks.includes('session-verification'))recordCheck('session-verification',initialAuthentication,currentTrack);
    if(initialAuthentication?.status!=='PASS'){if(initialAuthentication?.transient){terminalReason='error';throw retryableSessionError(initialAuthentication?.reason);}terminalReason='auth-required';throw authRequiredError(initialAuthentication?.reason||missingSessionReason());}

    if(typeof session?.revalidateWorkerIdentity==='function'){
      const identityCheck=await session.revalidateWorkerIdentity();
      if(identityCheck?.status!=='PASS')throw new Error(`Worker identity revalidation failed before streaming: ${identityCheck?.reason||'proxy/timezone/locale mismatch'}`);
      safeLog(log,`Worker identity revalidated · ${identityCheck.proxiedIp||'direct'} · ${identityCheck.timezoneId||'native timezone'} · ${identityCheck.locale||'native locale'}`,{workId:workUnit?.workId,type:'worker-identity-revalidated',severity:'success',stage:'identity',action:'revalidate-worker-identity'});
    }

    const sessionIntelligence=normalizeContentIntelligence(workUnit?.contentIntelligence||{});
    if(sessionIntelligence.enabled)await streamingIntelligenceWarmup({page,platform:account?.platform,intelligence:sessionIntelligence,signal,sleep,log,workId:workUnit?.workId});

    while(visits<visitLimit){
      throwIfAborted(signal);
      if(pageClosed(page)){terminalReason='browser-closed';return {runId,workId:workUnit?.workId,accountId:account?.id,trackVisits:visits,reason:terminalReason,screenshots,checkTotals};}
      if(!currentTrack||visitedKeys.has(keyOf(currentTrack))){currentTrack=nextUnvisited();currentAlreadyLocated=false;}
      if(!currentTrack)break;
      if(trackCoordinator?.acquire){
        activeLease=await trackCoordinator.acquire({preferredTrack:currentTrack,alternatives:(deck?.order||tracks).filter(track=>!visitedKeys.has(keyOf(track))),accountId:account?.id,signal});
        currentTrack=activeLease.track||currentTrack;
      }
      let observationSeconds=chooseRotatingObservationSeconds(observation);
      const intelligence=normalizeContentIntelligence(workUnit?.contentIntelligence||{});
      let intelligencePlan=null;if(intelligence.enabled){const contentAnalysis=analyzeContent({title:currentTrack?.title||'',creator:currentTrack?.artist||'',text:currentTrack?.album||'',keywords:intelligence.interestKeywords});observationSeconds=Math.min(intelligence.maxPerSongSeconds,chooseIntelligenceObservation(intelligence.maxSessionSeconds,contentAnalysis));const passiveDecisions=resolvePassiveDecisions(intelligence,contentAnalysis);const replay=intelligence.decisionMode==='manual'?(intelligence.allowRepeat&&(intelligence.streamingRepeatMode==='each-song'||(intelligence.streamingRepeatMode==='adaptive'&&Boolean(passiveDecisions.revisit)))):Boolean(passiveDecisions.revisit&&Math.random()<0.45);const volumeAllowed=intelligence.decisionMode==='manual'?intelligence.streamingVolumeVariation:Math.random()<0.68;intelligencePlan={enabled:true,volumeDirection:volumeAllowed?(Math.random()<0.5?'up':'down'):null,replay};safeLog(log,`Content intelligence: ${contentAnalysis.label} interest ${Math.round(contentAnalysis.score*100)}% · observation ${observationSeconds}s · per-song max ${intelligence.maxPerSongSeconds}s`,{workId:workUnit?.workId,type:'content-intelligence',severity:'info',stage:'intelligence',action:'analyze-content',trackId:currentTrack?.id,trackTitle:currentTrack?.title,interestScore:contentAnalysis.score,interestLabel:contentAnalysis.label,passiveDecisions,maxSessionSeconds:intelligence.maxSessionSeconds,maxPerSongSeconds:intelligence.maxPerSongSeconds,currentUrl:safePageUrl(page)});if(passiveDecisions.exploreCreator&&currentTrack?.artist)safeLog(log,`Content intelligence chose deeper artist exploration for ${currentTrack.artist}`,{workId:workUnit?.workId,type:'content-intelligence-creator',severity:'info',stage:'intelligence',action:'recommend-creator',trackId:currentTrack?.id,trackTitle:currentTrack?.title,artist:currentTrack.artist});}
      const visitWorkId=`${workUnit?.workId||`account:${account?.id||'account'}`}:visit:${visits+1}`;
      const located=await waitForSelectedTrackLocation({page,tracks,musicSelections,currentTrack,deck,adapter,signal,log,sleep,workId:workUnit?.workId,shouldLocate:!currentAlreadyLocated});
      if(located.status==='browser-closed'){terminalReason='browser-closed';return {runId,workId:workUnit?.workId,accountId:account?.id,trackVisits:visits,reason:terminalReason,screenshots,checkTotals};}
      currentTrack=located.track;deck=located.deck;const locate=located.locate;currentAlreadyLocated=false;
      if(!tracks.some(track=>trackMatches(track,currentTrack)))throw new Error('Playback blocked: resolved song is outside the selected OrbitQA music list');
      if(typeof adapter.selectedTrackReady==='function'&&!await adapter.selectedTrackReady({page,track:currentTrack,signal}))throw new Error('Playback blocked: browser is not on the selected OrbitQA song');
      if(proxyKind&&typeof session?.refreshProxyRoute==='function'){
        const route=await session.refreshProxyRoute();
        currentExitIp=String(route?.proxiedIp||currentExitIp||'');
        safeLog(log,`Proxy route confirmed for selected song · assigned ${assignedProxy||proxyKind} · current exit IP ${currentExitIp||'unavailable'}`,{workId:workUnit?.workId,type:'proxy-route-song',selectedProxyKind:session.allocation?.proxyKind,proxyKind,assignedProxy,currentExitIp,severity:'success',stage:'proxy',action:'verify-song-proxy-route',trackId:currentTrack?.id,trackTitle:currentTrack?.title,currentUrl:safePageUrl(page)});
      }
      if(typeof session?.revalidateWorkerIdentity==='function'){
        const identityCheck=await session.revalidateWorkerIdentity();
        if(identityCheck?.status!=='PASS')throw new Error(`Worker identity revalidation failed before selected song: ${identityCheck?.reason||'proxy/timezone/locale mismatch'}`);
      }
      if(typeof onTrackStart==='function') await onTrackStart({track:currentTrack,visit:visits+1,observationSeconds,workId:visitWorkId,assignedProxy,currentExitIp,proxyKind});
      safeLog(log,`Selected QA track: ${currentTrack?.title||currentTrack?.id} · starting playback · observation ${observationSeconds}s`,{workId:workUnit?.workId,type:'track-selected',severity:'info',stage:'selection',action:'selected-track',trackId:currentTrack?.id,trackTitle:currentTrack?.title,observationSeconds,assignedProxy,currentExitIp,proxyKind,currentUrl:safePageUrl(page)});

      let sessionVerification;
      try{sessionVerification=await adapter.verifySession({page,account,signal});}
      catch(error){sessionVerification={status:'WARNING',reason:error instanceof Error?error.message:String(error)};}
      if(requestedChecks.includes('session-verification'))recordCheck('session-verification',sessionVerification,currentTrack);
      if(sessionVerification?.status && !['PASS','NOT_APPLICABLE'].includes(sessionVerification.status)){
        releaseLease();
        safeLog(log,`Account session needs recovery before playback: ${sessionVerification.reason||sessionVerification.status}`,{workId:workUnit?.workId,type:'account-recovery',severity:'warning',stage:'authentication',action:'recover-session',reason:sessionVerification.reason||sessionVerification.status,currentUrl:safePageUrl(page)});
        const recovered=await waitForAuthorizedAccount({page,context:session.context,account,adapter,signal,log,sleep,persistAuthorizedSession,workId:workUnit?.workId});
        if(recovered?.status==='browser-closed'){terminalReason='browser-closed';return {runId,workId:workUnit?.workId,accountId:account?.id,trackVisits:visits,reason:terminalReason,screenshots,checkTotals};}
        if(recovered?.status!=='PASS'){if(recovered?.transient){terminalReason='error';throw retryableSessionError(recovered?.reason);}terminalReason='auth-required';throw authRequiredError(recovered?.reason||missingSessionReason());}
        currentAlreadyLocated=false;continue;
      }

      await maybeScreenshot(page,screenshotPolicy,visitWorkId,'track-ready',screenshots);
      const playing=await waitForPlaybackStart({page,adapter,signal,log,sleep,workId:workUnit?.workId,track:currentTrack,consumeTransientPlayerIssue:()=>{const issue=pendingTransientPlayerIssue;pendingTransientPlayerIssue=null;return issue;}});
      if(playing.status==='browser-closed'){terminalReason='browser-closed';return {runId,workId:workUnit?.workId,accountId:account?.id,trackVisits:visits,reason:terminalReason,screenshots,checkTotals};}
      const controls=playing.controls;const playback=playing.playback;
      if(requestedChecks.includes('playback'))recordCheck('playback',playback,currentTrack);
      safeLog(log,`Playback confirmed: ${currentTrack?.title||currentTrack?.id}`,{workId:workUnit?.workId,type:'playback-confirmed',severity:'success',stage:'playback',action:'playback-confirmed',trackId:currentTrack?.id,trackTitle:currentTrack?.title,reason:playback?.reason||'Player reports active playback',currentUrl:safePageUrl(page)});
      await maybeScreenshot(page,screenshotPolicy,visitWorkId,'playback',screenshots);

      if(requestedChecks.includes('volume-control')){
        const direction=volumeDirection==='increase'?'increase':'decrease';
        const action=direction==='increase'
          ? (controls?.volumeUp?await controls.volumeUp():{status:'NOT_APPLICABLE',reason:'Volume increase control unavailable'})
          : (controls?.volumeDown?await controls.volumeDown():{status:'NOT_APPLICABLE',reason:'Volume decrease control unavailable'});
        recordCheck('volume-control',{status:action?.status==='PASS'?'PASS':'NOT_APPLICABLE',reason:action?.status==='PASS'?`Volume ${direction} succeeded`:action?.reason,direction,action},currentTrack);
      }

      const shouldPause=requestedChecks.includes('pause-resume')&&(visits+1)===pauseVisit;
      const pauseMs=Math.max(500,Math.min(3000,Math.round((Number(pauseResumeSeconds)||3)*1000)));
      const pausePlan=shouldPause?{enabled:true,durationMs:pauseMs,atActiveMs:randomPauseOffsetMs({runId,accountId:account?.id||workUnit?.accountId,visit:visits+1,targetMs:observationSeconds*1000})}:null;
      if(shouldPause)safeLog(log,`Random pause selected for QA song ${visits+1}/${visitLimit}: ${currentTrack?.title||currentTrack?.id}`,{workId:workUnit?.workId,type:'pause-selected',severity:'info',stage:'playback',action:'pause-scheduled',trackId:currentTrack?.id,trackTitle:currentTrack?.title,pauseSeconds:pauseMs/1000,pauseAtActiveMs:pausePlan.atActiveMs});
      safeLog(log,`Verified playback observation started: ${currentTrack?.title||currentTrack?.id} · hard wall-clock deadline ${observationSeconds}s`,{workId:workUnit?.workId,type:'observation-start',severity:'info',stage:'observation',action:'observe-playback',trackId:currentTrack?.id,trackTitle:currentTrack?.title,observationSeconds,currentUrl:safePageUrl(page)});
      const observed=await observeVerifiedPlayback({page,controls,track:currentTrack,adapter,signal,sleep,targetSeconds:observationSeconds,pausePlan,log,workId:workUnit?.workId,intelligencePlan});
      if(observed.status==='browser-closed'){terminalReason='browser-closed';return {runId,workId:workUnit?.workId,accountId:account?.id,trackVisits:visits,reason:terminalReason,screenshots,checkTotals};}
      if(shouldPause)recordCheck('pause-resume',observed.pauseResult||{status:'NOT_APPLICABLE',reason:'Random pause was selected but could not be executed'},currentTrack);
      visits++;visitedKeys.add(keyOf(currentTrack));
      const validPlayback=observed.status==='PASS';
      safeLog(log,`${validPlayback?'Valid QA playback':'QA playback not valid'}: ${currentTrack?.title||currentTrack?.id} · ${Math.round((observed.activePlaybackMs||0)/1000)}s / ${observationSeconds}s active`,{workId:workUnit?.workId,type:validPlayback?'valid-playback':'invalid-playback',severity:validPlayback?'success':'warning',stage:'observation',action:validPlayback?'valid-playback':'invalid-playback',trackId:currentTrack?.id,trackTitle:currentTrack?.title,activePlaybackMs:observed.activePlaybackMs,targetPlaybackMs:observed.targetPlaybackMs,reason:observed.reason,currentUrl:safePageUrl(page)});
      const intelligenceActions=intelligence.enabled&&intelligence.decisionMode==='manual';
      const favoriteRequested=requestedChecks.includes('favorite-track')||(intelligenceActions&&intelligence.streamingFavoriteAllowed);
      const followRequested=requestedChecks.includes('follow-artist')||(intelligenceActions&&intelligence.streamingFollowAllowed);
      if(favoriteRequested||followRequested){
        const engagement=typeof adapter.engagementControls==='function'?await adapter.engagementControls({page,track:currentTrack,signal}).catch(()=>null):null;
        if(favoriteRequested)recordCheck('favorite-track',engagement?.favoriteTrack?await engagement.favoriteTrack():{status:'NOT_APPLICABLE',reason:'Like/favorite song control unavailable'},currentTrack);
        if(followRequested)recordCheck('follow-artist',engagement?.followArtist?await engagement.followArtist():{status:'NOT_APPLICABLE',reason:'Follow/favorite artist control unavailable'},currentTrack);
      }
      if(!validPlayback||observed?.hardStopResult?.status!=='PASS')await controls?.pause?.().catch(()=>undefined);
      releaseLease();
      await persistCurrentAuthorizedSession(session.context,persistAuthorizedSession);
      if(validPlayback&&typeof onTrackComplete==='function') await onTrackComplete({track:currentTrack,visit:visits,observationSeconds,activePlaybackMs:observed.activePlaybackMs,workId:visitWorkId,locate,playback,sessionVerification,pauseResult:observed.pauseResult,validPlayback:true});
      if(!validPlayback&&typeof onTrackInvalid==='function') await onTrackInvalid({track:currentTrack,visit:visits,observationSeconds,activePlaybackMs:observed.activePlaybackMs,workId:visitWorkId,reason:observed.reason,pauseResult:observed.pauseResult,validPlayback:false});

      if(requestedChecks.includes('artist-navigation'))recordCheck('artist-navigation',await navigationCheck(page,'artist',currentTrack),currentTrack);
      if(requestedChecks.includes('album-navigation'))recordCheck('album-navigation',await navigationCheck(page,'album',currentTrack),currentTrack);
      if(requestedChecks.includes('playlist-loading'))recordCheck('playlist-loading',await navigationCheck(page,'playlist',currentTrack),currentTrack);
      if(requestedChecks.includes('previous-track')){
        if(previousTrack){
          const result=await restoreSelectedTrack(page,previousTrack);
          recordCheck('previous-track',result?.status==='PASS'?{status:'PASS',reason:'Controlled previous-song navigation stayed inside the selected OrbitQA list'}:result,currentTrack);
          await restoreSelectedTrack(page,currentTrack);
        }else recordCheck('previous-track',{status:'NOT_APPLICABLE',reason:'No previous selected song exists on the first QA song'},currentTrack);
      }
      previousTrack=currentTrack;

      if(visits>=visitLimit){
        if(restAndReplay){
          try{await page?.evaluate?.(()=>{for(const el of document.querySelectorAll('audio,video')){try{el.pause?.();}catch{}}});}catch{}
          const restSeconds=chooseRotatingObservationSeconds(observation);
          safeLog(log,`Rest & Replay: cycle complete · resting ${restSeconds}s before restarting this account from the first selected song`,{workId:workUnit?.workId,type:'rest-replay',severity:'info',stage:'session',action:'rest-replay',restSeconds});
          const rested=await waitObservationWindow({page,milliseconds:restSeconds*1000,signal,sleep,pollMs:250});
          if(rested.status==='browser-closed'){terminalReason='browser-closed';return {runId,workId:workUnit?.workId,accountId:account?.id,trackVisits:visits,reason:terminalReason,screenshots,checkTotals};}
          visitedKeys.clear();visits=0;previousTrack=null;
          deck=createPersistentTrackDeck({tracks,initialTrack:initialTrack||tracks[0],seed:`${runId||'stream'}:${account?.id||workUnit?.accountId||'account'}:replay:${Date.now()}`,mode:queueMode});
          const replayFirst=nextTrack(deck);deck=replayFirst.state;currentTrack=replayFirst.track||initialTrack||tracks[0];currentAlreadyLocated=false;
          safeLog(log,`Rest & Replay: restarting this account from the beginning`,{workId:workUnit?.workId,type:'rest-replay-start',severity:'success',stage:'session',action:'replay-cycle-start',trackId:currentTrack?.id,trackTitle:currentTrack?.title});
          continue;
        }
        terminalReason='visit-limit';return {runId,workId:workUnit?.workId,accountId:account?.id,trackVisits:visits,reason:terminalReason,screenshots,checkTotals};
      }
      const restAfter=Math.max(0,Math.floor(Number(restAfterTracks)||0));
      const restMs=Math.max(0,Number(restMinutes)||0)*60000;
      if(restAfter>0&&restMs>0&&visits%restAfter===0){
        safeLog(log,`Rest period: ${restMinutes} minute(s) before continuing this account session`,{workId:workUnit?.workId,type:'rest-period',severity:'info',stage:'session',action:'rest'});
        const rested=await waitObservationWindow({page,milliseconds:restMs,signal,sleep});
        if(rested.status==='browser-closed'){terminalReason='browser-closed';return {runId,workId:workUnit?.workId,accountId:account?.id,trackVisits:visits,reason:terminalReason,screenshots,checkTotals};}
      }

      const planned=nextUnvisited();
      if((requestedChecks.includes('next-track')||requestedChecks.includes('queue-transition'))&&planned){
        const transition={status:'PASS',reason:`Controlled transition prepared to selected song: ${planned.title||planned.id}`};
        if(requestedChecks.includes('next-track'))recordCheck('next-track',transition,currentTrack);
        if(requestedChecks.includes('queue-transition'))recordCheck('queue-transition',transition,currentTrack);
      }
      currentTrack=planned;currentAlreadyLocated=false;
    }
    terminalReason='visit-limit';
    return {runId,workId:workUnit?.workId,accountId:account?.id,trackVisits:visits,reason:terminalReason,screenshots,checkTotals};
  } catch(error) {
    if(error?.code==='ORBITQA_STREAMING_PROBE_STALLED'){
      terminalReason='retryable-stall';
      safeLog(log,`Streaming browser became unresponsive: ${error.message}. Preserving the saved account profile for recovery.`,{workId:workUnit?.workId,type:'streaming-browser-stall',severity:'warning',stage:'browser',action:'retryable-session-recovery',currentUrl:safePageUrl(session?.page)});
      throw retryableSessionError(error.message);
    }
    terminalReason='error';
    throw error;
  } finally {
    releaseLease();
    const manuallyClosed=pageClosed(session?.page);
    const shouldClose=Boolean(signal?.aborted||manuallyClosed||terminalReason==='visit-limit'||terminalReason==='auth-required'||terminalReason==='error');
    if(signal?.aborted) safeLog(log,'STOP received; closing this persistent account browser',{workId:workUnit?.workId,type:'browser-stop',severity:'info',stage:'browser',action:'close-browser'});
    else if(manuallyClosed) safeLog(log,'Account browser was closed manually',{workId:workUnit?.workId,type:'browser-manual-close',severity:'info',stage:'browser',action:'manual-close'});
    else if(terminalReason==='visit-limit') safeLog(log,'Assigned QA song count completed; closing this account browser before the next group',{workId:workUnit?.workId,type:'browser-group-complete',severity:'success',stage:'browser',action:'close-browser'});
    else if(terminalReason==='error') safeLog(log,'Streaming session ended with an error; closing the browser fully before any retry or Run Again',{workId:workUnit?.workId,type:'browser-error-cleanup',severity:'warning',stage:'browser',action:'close-browser'});
    else if(terminalReason==='auth-required') safeLog(log,'Saved account session is not active; closing the automated browser. Re-verify this account with LOGIN MANUALLY in Accounts.',{workId:workUnit?.workId,type:'browser-auth-required',severity:'warning',stage:'authentication',action:'close-browser'});
    if(shouldClose&&session?.close) await session.close().catch(()=>undefined);
    else if(session) safeLog(log,'Persistent account browser left open because Streaming QA did not receive STOP and the assigned QA workload did not finish',{workId:workUnit?.workId,type:'browser-retained',severity:'warning',stage:'browser',action:'retain-browser',currentUrl:safePageUrl(session?.page)});
    detachPageDiagnostics();
  }
}

module.exports={runStreamingSession,runPersistentAccountStreamingSession,waitForPlaybackStart,waitObservationWindow,observeVerifiedPlayback,randomPauseVisit,randomPauseOffsetMs,transientStreamingPage,reloadTransientStreamingPage,throwIfAborted,chooseRotatingObservationSeconds,_test:{waitForAuthorizedAccount,requiresManualChallenge,hasStoredCredentials,waitForSelectedTrackLocation}};
