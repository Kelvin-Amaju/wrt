const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const { installStrictPrivacyGuard, collectPrivacyReport } = require('../privacy-probe.cjs');
const { buildSessionIntegrityReport } = require('../session-integrity.cjs');
const { verifyPoolProxyRouteInBrowser, buildWebRtcLaunchPolicy, buildRuntimePerformanceLaunchPolicy, buildProxyContainmentLaunchPolicy, mergeLaunchArgs } = require('../qa-runner.cjs');
const { backgroundWindowArgs:buildBackgroundWindowArgs, concealBackgroundWorkerWindow } = require('../background-window.cjs');
const { resolveAutomationBrowserPolicy, assertSupportedChromiumVersion }=require('./supported-browser-policy.cjs');
const { profileForCountry }=require('../social/geo-profile.cjs');
const { buildConsistentWorkerContext, validateWorkerContext }=require('../worker-context-policy.cjs');
const { synchronizeProxyTimezone }=require('../proxy-timezone-consistency.cjs');
const { buildDeviceExpectation, collectRuntimeIdentity, assessDeviceConsistency, compareGraphicsStability }=require('../device-consistency.cjs');
const { createProfileLockManager }=require('./profile-lock-manager.cjs');
const {normalizeChromeProfileShutdownState}=require('../chrome-profile-state.cjs');


function allOtherStaticProxyIds(records,selectedId){const selected=String(selectedId||'');return (records||[]).map(r=>String(r.id||'')).filter(id=>id&&id!==selected);}
function staticProxyPlatformScope(account){
  const platform=String(account?.platform||'').trim().toLowerCase();
  return platform?`platform:${platform}`:`account:${String(account?.id||'unknown')}`;
}
const STREAMING_DEVICE_PROFILES={
  desktop:{'Desktop 1280x720':{viewport:{width:1280,height:720},screen:{width:1280,height:720},deviceScaleFactor:1,isMobile:false,hasTouch:false,userAgent:null,userAgentIncludes:'',touch:false}},
  android:{
    'Pixel 11':{viewport:{width:412,height:923},screen:{width:412,height:923},deviceScaleFactor:2.625,isMobile:true,hasTouch:true,deviceName:'Pixel 11',androidVersion:'17',userAgentIncludes:'Android',touch:true},
    'Pixel 11 Pro':{viewport:{width:427,height:952},screen:{width:427,height:952},deviceScaleFactor:3,isMobile:true,hasTouch:true,deviceName:'Pixel 11 Pro',androidVersion:'17',userAgentIncludes:'Android',touch:true},
    'Pixel 11 Pro XL':{viewport:{width:448,height:997},screen:{width:448,height:997},deviceScaleFactor:3,isMobile:true,hasTouch:true,deviceName:'Pixel 11 Pro XL',androidVersion:'17',userAgentIncludes:'Android',touch:true},
    'Galaxy S26':{viewport:{width:360,height:780},screen:{width:360,height:780},deviceScaleFactor:3,isMobile:true,hasTouch:true,deviceName:'SM-S942B',androidVersion:'16',userAgentIncludes:'Android',touch:true},
    'Galaxy S26+':{viewport:{width:384,height:832},screen:{width:384,height:832},deviceScaleFactor:3.75,isMobile:true,hasTouch:true,deviceName:'SM-S947B',androidVersion:'16',userAgentIncludes:'Android',touch:true},
    'Galaxy S26 Ultra':{viewport:{width:384,height:832},screen:{width:384,height:832},deviceScaleFactor:3.75,isMobile:true,hasTouch:true,deviceName:'SM-S948B',androidVersion:'16',userAgentIncludes:'Android',touch:true},
    'Galaxy S26 FE':{viewport:{width:360,height:780},screen:{width:360,height:780},deviceScaleFactor:3,isMobile:true,hasTouch:true,deviceName:'SM-S741B',androidVersion:'16',userAgentIncludes:'Android',touch:true},
    'Galaxy Z Flip8':{viewport:{width:360,height:840},screen:{width:360,height:840},deviceScaleFactor:3,isMobile:true,hasTouch:true,deviceName:'SM-F776B',androidVersion:'16',userAgentIncludes:'Android',touch:true},
    'Galaxy Z Fold8 (Open)':{viewport:{width:816,height:616},screen:{width:816,height:616},deviceScaleFactor:3,isMobile:true,hasTouch:true,deviceName:'SM-F971B',androidVersion:'16',userAgentIncludes:'Android',touch:true},
    // Previous profiles remain selectable alongside the latest profiles.
    'Pixel 7':{viewport:{width:412,height:915},screen:{width:412,height:915},deviceScaleFactor:2.625,isMobile:true,hasTouch:true,deviceName:'Pixel 7',androidVersion:'14',userAgentIncludes:'Android',touch:true},
    'Pixel 5':{viewport:{width:393,height:851},screen:{width:393,height:851},deviceScaleFactor:2.75,isMobile:true,hasTouch:true,deviceName:'Pixel 5',androidVersion:'14',userAgentIncludes:'Android',touch:true},
    'Galaxy S23':{viewport:{width:360,height:780},screen:{width:360,height:780},deviceScaleFactor:3,isMobile:true,hasTouch:true,deviceName:'SM-S911B',androidVersion:'14',userAgentIncludes:'Android',touch:true},
  },
  ios:{
    'iPhone 18 Pro':{viewport:{width:402,height:874},screen:{width:402,height:874},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',userAgentIncludes:'iPhone',touch:true},
    'iPhone 18 Pro Max':{viewport:{width:440,height:956},screen:{width:440,height:956},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',userAgentIncludes:'iPhone',touch:true},
    'iPhone Duo (Closed)':{viewport:{width:466,height:678},screen:{width:466,height:678},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',userAgentIncludes:'iPhone',touch:true},
    'iPhone Duo (Open)':{viewport:{width:890,height:626},screen:{width:890,height:626},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',userAgentIncludes:'iPhone',touch:true},
    'iPad Pro 11':{viewport:{width:834,height:1210},screen:{width:834,height:1210},deviceScaleFactor:2,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPad; CPU OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',userAgentIncludes:'iPad',touch:true},
    'iPad Mini':{viewport:{width:744,height:1133},screen:{width:744,height:1133},deviceScaleFactor:2,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPad; CPU OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',userAgentIncludes:'iPad',touch:true},
    // Previous profiles remain selectable alongside the latest profiles.
    'iPhone 13':{viewport:{width:390,height:844},screen:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',userAgentIncludes:'iPhone',touch:true},
    'iPhone 13 Pro':{viewport:{width:390,height:844},screen:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',userAgentIncludes:'iPhone',touch:true},
    'iPhone 13 Pro Max':{viewport:{width:428,height:926},screen:{width:428,height:926},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',userAgentIncludes:'iPhone',touch:true},
    'iPhone 13 Mini':{viewport:{width:375,height:812},screen:{width:375,height:812},deviceScaleFactor:3,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',userAgentIncludes:'iPhone',touch:true},
  }
};
function streamingDeviceProfile(mode='desktop',name=''){
  const group=STREAMING_DEVICE_PROFILES[mode]||STREAMING_DEVICE_PROFILES.desktop;
  return group[name]||Object.values(group)[0];
}

const STREAMING_PLATFORM_LABELS={
  spotify:'Spotify',
  'apple-music':'Apple Music',
  'youtube-music':'YouTube Music',
  soundcloud:'SoundCloud',
  deezer:'Deezer',
  tidal:'TIDAL',
  audiomack:'Audiomack',
  pandora:'Pandora',
};
function streamingPlatformLabel(platform){
  const key=String(platform||'').trim().toLowerCase();
  return STREAMING_PLATFORM_LABELS[key]||String(platform||'Streaming').trim()||'Streaming';
}

const PLATFORM_COOKIE_URLS={
  spotify:'https://open.spotify.com/',
  'apple-music':'https://music.apple.com/',
  'youtube-music':'https://music.youtube.com/',
  soundcloud:'https://soundcloud.com/',
  deezer:'https://www.deezer.com/',
  tidal:'https://listen.tidal.com/',
  audiomack:'https://audiomack.com/',
  pandora:'https://www.pandora.com/',
  youtube:'https://www.youtube.com/',
  facebook:'https://www.facebook.com/',
  instagram:'https://www.instagram.com/',
  x:'https://x.com/',
  pinterest:'https://www.pinterest.com/',
  tiktok:'https://www.tiktok.com/',
  linkedin:'https://www.linkedin.com/',
  reddit:'https://www.reddit.com/',
};

function normalizeAuthorizedCookie(raw){
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim();
  const cookieValue = String(raw.value ?? '');
  const domain = raw.domain ? String(raw.domain).trim() : '';
  const url = raw.url ? String(raw.url).trim() : '';
  if (!name || (!domain && !/^https?:\/\//i.test(url))) return null;
  const cookie = { name, value: cookieValue, path: String(raw.path || '/') };
  if (domain) cookie.domain = domain;
  else cookie.url = url;
  if (typeof raw.expires === 'number' && Number.isFinite(raw.expires)) cookie.expires = raw.expires;
  if (typeof raw.secure === 'boolean') cookie.secure = raw.secure;
  if (typeof raw.httpOnly === 'boolean') cookie.httpOnly = raw.httpOnly;
  const sameSite = String(raw.sameSite || '').toLowerCase();
  if (sameSite === 'strict') cookie.sameSite = 'Strict';
  else if (sameSite === 'lax') cookie.sameSite = 'Lax';
  else if (sameSite === 'none' || sameSite === 'no_restriction') cookie.sameSite = 'None';
  return cookie;
}

function parseAuthorizedCookies(value,platform='') {
  if (!value || typeof value !== 'string') return [];
  let parsed;
  try { parsed = JSON.parse(value); } catch { parsed = null; }
  if(parsed!==null){
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cookies) ? parsed.cookies : [];
    return rows.slice(0, 250).map(normalizeAuthorizedCookie).filter(Boolean);
  }
  const url=PLATFORM_COOKIE_URLS[String(platform||'')];
  if(!url) return [];
  const reserved=new Set(['path','domain','expires','max-age','secure','httponly','samesite','priority']);
  return String(value).split(/[;\r\n]+/).map(part=>part.trim()).filter(Boolean).map(part=>{
    const index=part.indexOf('=');
    if(index<=0)return null;
    const name=part.slice(0,index).trim();
    const cookieValue=part.slice(index+1).trim();
    if(!name||reserved.has(name.toLowerCase()))return null;
    return {name,value:cookieValue,url,path:'/'};
  }).filter(Boolean).slice(0,250);
}

function parseAuthorizedSessionState(value,platform='') {
  if (!value || typeof value !== 'string') return {kind:'none',storageState:null,cookies:[]};
  let parsed;
  try { parsed=JSON.parse(value); } catch { parsed=null; }
  const envelopeState=parsed&&parsed.version===2&&parsed.kind==='playwright-storage-state'&&parsed.storageState;
  if(envelopeState&&typeof envelopeState==='object'){
    return {kind:'storage-state',storageState:envelopeState,cookies:[]};
  }
  if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)&&Array.isArray(parsed.cookies)&&Array.isArray(parsed.origins)){
    return {kind:'storage-state',storageState:{cookies:parsed.cookies,origins:parsed.origins},cookies:[]};
  }
  const cookies=parseAuthorizedCookies(value,platform);
  return {kind:cookies.length?'cookies':'none',storageState:null,cookies};
}


function safeProfileSegment(value){
  const text=String(value||'account').trim().replace(/[^a-zA-Z0-9._-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,96);
  return text||'account';
}
function persistentProfileDir(profileBaseDir,account={}){
  if(!profileBaseDir)return '';
  return path.join(String(profileBaseDir),safeProfileSegment(account.platform||'platform'),safeProfileSegment(account.id||account.label||'account'));
}
function manualLoginProfileDir(profileBaseDir,account={},token=''){
  if(!profileBaseDir)return '';
  return path.join(String(profileBaseDir),'manual-login',safeProfileSegment(account.platform||'platform'),safeProfileSegment(account.id||account.label||'account'),safeProfileSegment(token||Date.now()));
}
function accountProfileDir(profileBaseDir,account={}){
  return persistentProfileDir(profileBaseDir,account);
}
function removeProfileDir(profileDir){
  if(!profileDir)return;
  try{fs.rmSync(profileDir,{recursive:true,force:true,maxRetries:4,retryDelay:150});}catch{}
}
async function restoreAuthorizedSessionIntoContext(context,authorizedSession){
  if(!context||!authorizedSession)return;
  if(authorizedSession.storageState){
    if(typeof context.setStorageState==='function'){
      await context.setStorageState(authorizedSession.storageState);
      return;
    }
    const cookies=Array.isArray(authorizedSession.storageState.cookies)?authorizedSession.storageState.cookies:[];
    if(cookies.length&&typeof context.addCookies==='function')await context.addCookies(cookies);
    return;
  }
  if(authorizedSession.cookies?.length&&typeof context.addCookies==='function')await context.addCookies(authorizedSession.cookies);
}

function createStreamingBrowserFactory({
  chromium,
  webkit,
  devices,
  proxyPoolService,
  verifyRoute = verifyPoolProxyRouteInBrowser,
  collectPrivacy = collectPrivacyReport,
  routeCheckUrl = 'https://api64.ipify.org?format=json',
  browserPolicyResolver = resolveAutomationBrowserPolicy,
  profileBaseDir = '',
  spawnImpl = spawn,
  profileLockManager = null,
  onStaticProxyAssigned = null,
  getStaticProxyExclusions = null,
} = {}) {
  if (!chromium?.launch && !chromium?.launchPersistentContext) throw new Error('Chromium launcher is required for Streaming Hub');
  const profileLocks=profileLockManager||createProfileLockManager();

  return {
    getAccountProfileDir(account={}){return accountProfileDir(profileBaseDir,account);},
    getProfileLockState(account={}){const dir=accountProfileDir(profileBaseDir,account);return {profileDir:dir,locked:profileLocks.isLocked(dir),owner:profileLocks.describe(dir)};},
    repairAccountProfile(account={}){const dir=accountProfileDir(profileBaseDir,account);return {...profileLocks.repair(dir),profileDir:dir};},
    async openManualLogin({account={},url,profileToken='',profileDir:requestedProfileDir='',freshProfile=false}={}){
      const targetUrl=String(url||'').trim();
      if(!/^https?:\/\//i.test(targetUrl)) throw new Error('A valid login URL is required');
      const proxySource=['rotating','static','smart-mix'].includes(account.proxySource)?account.proxySource:'none';
      const browserRuntime=String(account?.defaultBrowserRuntime||'chrome-installed');
      const browserPolicy=browserPolicyResolver({deviceMode:'desktop',browserRuntime});
      if(browserPolicy?.engine!=='chromium'||!browserPolicy?.executablePath) throw new Error('Google Chrome or Microsoft Edge was not found for manual account login');
      const profileDir=String(requestedProfileDir||accountProfileDir(profileBaseDir,account)||manualLoginProfileDir(profileBaseDir,account,profileToken)).trim();
      if(!profileDir) throw new Error('OrbitQA could not create an isolated manual-login browser profile');
      if(freshProfile)removeProfileDir(profileDir);
      fs.mkdirSync(profileDir,{recursive:true});
      profileLocks.cleanStaleLockFiles(profileDir);
      const releaseProfileLock=profileLocks.acquire(profileDir,{kind:'manual-login',accountId:account.id,platform:account.platform});

      // Direct mode keeps the existing installed-browser launch behavior.
      if(proxySource==='none'){
        normalizeChromeProfileShutdownState(profileDir);
        const args=[
          '--new-window',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-background-mode',
          '--disable-background-timer-throttling',
          '--disable-renderer-backgrounding',
          '--disable-backgrounding-occluded-windows',
          '--disable-features=CalculateNativeWinOcclusion',
          '--disable-ipc-flooding-protection',
          '--hide-crash-restore-bubble',
          '--disable-session-crashed-bubble',
          `--user-data-dir=${profileDir}`,
          targetUrl,
        ];
        let child;
        try{child=spawnImpl(browserPolicy.executablePath,args,{stdio:'ignore',windowsHide:false});}
        catch(error){await releaseProfileLock();throw error;}
        let closed=false;
        let released=false;
        const releaseOnce=async()=>{if(released)return;released=true;await releaseProfileLock();};
        let exitPromise=null;
        const waitForExit=()=>{
          if(exitPromise)return exitPromise;
          exitPromise=new Promise(resolve=>{
            if(closed){resolve();return;}
            const done=()=>{closed=true;normalizeChromeProfileShutdownState(profileDir);void releaseOnce();resolve();};
            child.once?.('exit',done);
            child.once?.('error',done);
          });
          return exitPromise;
        };
        void waitForExit();
        return {
          browserLabel:browserPolicy.browserLabel||'Google Chrome / Microsoft Edge',
          profileDir,
          processId:Number(child.pid)||0,
          proxySource:'none',
          async close(){
            if(closed)return;
            try{child.kill?.();}catch{}
            await Promise.race([waitForExit(),new Promise(resolve=>setTimeout(resolve,2500))]);
            closed=true;
            await new Promise(resolve=>setTimeout(resolve,350));
            normalizeChromeProfileShutdownState(profileDir);
            await releaseOnce();
          },
        };
      }

      // Strict proxy mode: manual login uses the same dedicated account profile AND the
      // assigned proxy. No host/direct browser launch is allowed for a proxied account.
      if(!proxyPoolService){await releaseProfileLock();throw new Error('Proxy pool service is unavailable for manual account login');}
      let allocation=null;
      let context=null;
      try{
        const excludeProxyIds=proxySource==='static'?(account?.staticProxyMode==='manual'?[]:await getStaticProxyExclusions?.(account).catch?.(()=>[])||[]):[];
        allocation=await proxyPoolService.allocate(proxySource,`manual-login:${account.id||profileToken||Date.now()}`,{
          allowSlow:true,
          preferredProxyId:proxySource==='static'?account.staticProxyId:undefined,
          excludeProxyIds:proxySource==='static'&&account?.staticProxyMode==='manual'&&account?.staticProxyId?allOtherStaticProxyIds(await proxyPoolService.list('static'),account.staticProxyId):excludeProxyIds,
          reservationScope:staticProxyPlatformScope(account),
          allowSharedStatic:proxySource==='static'&&account?.staticProxyMode==='manual',
        });
        if(proxySource==='static'&&account?.id&&allocation?.proxyId&&allocation.proxyId!==account.staticProxyId){
          await onStaticProxyAssigned?.(account.id,allocation.proxyId).catch?.(()=>undefined);
          account.staticProxyId=allocation.proxyId;
        }
        const launchPolicy=buildWebRtcLaunchPolicy({strictMode:true,browserEngine:'chromium',headless:false});
        const containmentPolicy=buildProxyContainmentLaunchPolicy({proxyRequired:true,browserEngine:'chromium',proxyServer:allocation.server});
        const performancePolicy=buildRuntimePerformanceLaunchPolicy({browserEngine:'chromium'});
        const geoProfile=allocation?.countryCode?profileForCountry(allocation.countryCode):null;
        const proxyTimezone=String(allocation?.timezoneId||geoProfile?.timezoneId||'').trim();
        normalizeChromeProfileShutdownState(profileDir);
        context=await chromium.launchPersistentContext(profileDir,{
          headless:false,
          executablePath:browserPolicy.executablePath,
          chromiumSandbox:true,
          ignoreDefaultArgs:['--disable-component-update'],
          args:mergeLaunchArgs(launchPolicy?.args||[],containmentPolicy?.args||[],performancePolicy?.args||[]),
          serviceWorkers:'allow',
          locale:geoProfile?.locale||'en-US',
          ...(proxyTimezone?{timezoneId:proxyTimezone}:{}),
          ...(geoProfile?.languageHeader?{extraHTTPHeaders:{'Accept-Language':geoProfile.languageHeader}}:{}),
          proxy:{server:allocation.server,username:allocation.username||undefined,password:allocation.password||undefined},
        });
        await installStrictPrivacyGuard(context,true);
        const existingPages=typeof context.pages==='function'?context.pages():[];
        const page=existingPages?.[0]||await context.newPage();
        const route=await verifyRoute({page,proxyPoolService,routeCheckUrl,secrets:[allocation.username,allocation.password].filter(Boolean)});
        if(route?.error||!route?.proxiedIp)throw new Error(route?.error||'Assigned proxy route could not be verified for manual login');
        if((String(allocation?.observedIp||'').trim()&&String(allocation.observedIp).trim()!==String(route.proxiedIp||'').trim())||(!String(allocation?.observedIp||'').trim()&&typeof context?.newCDPSession==='function')){
          const timezoneSync=await synchronizeProxyTimezone({context,browserEngine:'chromium',proxiedIp:route.proxiedIp,currentTimezoneId:proxyTimezone});
          if(timezoneSync.status!=='PASS')throw new Error(`Proxy timezone consistency failed for manual login: ${timezoneSync.reason||'timezone mismatch'}`);
          allocation.timezoneId=timezoneSync.timezoneId;allocation.observedIp=route.proxiedIp;Object.assign(allocation,timezoneSync.geo||{});
        }
        await page.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:30000});
        let closed=false;
        return {
          browserLabel:browserPolicy.browserLabel||'Google Chrome / Microsoft Edge',
          profileDir,
          processId:0,
          proxySource,
          proxyExitIp:route.proxiedIp,
          async close(){
            if(closed)return;closed=true;
            await context?.close?.().catch(()=>undefined);
            normalizeChromeProfileShutdownState(profileDir);
            if(allocation?.allocationId)await proxyPoolService.release?.(allocation.allocationId).catch(()=>undefined);
            await releaseProfileLock();
          },
        };
      }catch(error){
        await context?.close?.().catch(()=>undefined);
        if(allocation?.allocationId)await proxyPoolService.release?.(allocation.allocationId).catch(()=>undefined);
        await releaseProfileLock();
        throw error;
      }
    },
    cleanupManualLoginProfile(profileDir){removeProfileDir(profileDir);},
    async open({ runId, workUnit, account = {}, executionMode = 'visible', signal, ignoreStoredSession = false, usePersistentProfile = false, profileDirOverride = '', restoreStoredSession = true, geoConsistencyFromProxy = true, muteAudio = false } = {}) {
      if (signal?.aborted) { const e=new Error('Streaming QA stopped'); e.name='AbortError'; throw e; }
      const proxySource = ['rotating','static','smart-mix'].includes(account.proxySource) ? account.proxySource : 'none';
      let allocation = null;
      let browser = null;
      let context = null;
      let page = null;
      let initialRoute = null;
      let privacyReport = null;
      let releaseProfileLock = null;
      const proxyRequired = proxySource !== 'none';
      try {
        if (proxyRequired) {
          if (!proxyPoolService) throw new Error('Proxy pool service is unavailable for streaming QA');
          const excludeProxyIds=proxySource==='static'?(account?.staticProxyMode==='manual'?[]:await getStaticProxyExclusions?.(account).catch?.(()=>[])||[]):[];
          allocation = await proxyPoolService.allocate(proxySource, `${runId}:${workUnit?.workId || 'stream'}`, { allowSlow: true, preferredProxyId: proxySource==='static' ? account.staticProxyId : undefined, excludeProxyIds:proxySource==='static'&&account?.staticProxyMode==='manual'&&account?.staticProxyId?allOtherStaticProxyIds(await proxyPoolService.list('static'),account.staticProxyId):excludeProxyIds, reservationScope:staticProxyPlatformScope(account), allowSharedStatic:proxySource==='static'&&account?.staticProxyMode==='manual' });
          if(proxySource==='static'&&account?.id&&allocation?.proxyId&&allocation.proxyId!==account.staticProxyId){await onStaticProxyAssigned?.(account.id,allocation.proxyId).catch?.(()=>undefined);account.staticProxyId=allocation.proxyId;}
        }
        const deviceMode=['android','ios'].includes(workUnit?.deviceMode)?workUnit.deviceMode:'desktop';
        const profile=streamingDeviceProfile(deviceMode,workUnit?.deviceProfile);
        const browserRuntime=String(workUnit?.browserRuntime||account?.defaultBrowserRuntime||'chrome-installed');
        const browserPolicy=browserPolicyResolver({deviceMode,browserRuntime});
        const browserEngine=browserPolicy.engine;
        const launcher=browserEngine==='webkit'?webkit:chromium;
        if(!launcher?.launch && !launcher?.launchPersistentContext) throw new Error(browserEngine==='webkit'?'WebKit launcher is required for iOS streaming QA':'Chromium launcher is required for Streaming Hub');
        const chromiumBackground = browserEngine==='chromium' && executionMode==='background';
        // Keep installed Chromium headed even for Background Activity. Media-heavy sites such as
        // YouTube/Facebook/Spotify are materially more reliable in a real browser renderer than in
        // headless mode. Background Chromium starts minimized and receives the anti-occlusion flags
        // from the shared runtime performance policy, so every account can continue independently.
        const runtimeHeadless = false;
        const launchPolicy = browserEngine==='chromium'?buildWebRtcLaunchPolicy({ strictMode:true, browserEngine, headless:runtimeHeadless }):{args:[]};
        const containmentPolicy = buildProxyContainmentLaunchPolicy({ proxyRequired:Boolean(allocation), browserEngine, proxyServer:allocation?.server });
        const performancePolicy = buildRuntimePerformanceLaunchPolicy({ browserEngine });
        const backgroundWindowArgs = chromiumBackground ? ['--start-minimized',...buildBackgroundWindowArgs({browserEngine,executionMode})] : [];
        // Mobile streaming intentionally preserves the installed Chromium media identity.
        // We emulate the selected device's viewport/touch/DPR while keeping the same durable
        // account-specific Chrome/Edge profile that was verified during manual login. This
        // avoids turning a valid desktop-authorized profile into an unsupported Safari/Android
        // web-player identity and preserves DRM/session state across device selections.
        const geoProfile=geoConsistencyFromProxy&&allocation?.countryCode?profileForCountry(allocation.countryCode):null;
        const proxyTimezone=geoConsistencyFromProxy?String(allocation?.timezoneId||geoProfile?.timezoneId||'').trim():'';
        const resolvedWorkerContext=buildConsistentWorkerContext({
          profile,
          deviceMode,
          browserEngine,
          allocation:geoConsistencyFromProxy?allocation:null,
          fallbackLocale:geoProfile?.locale||'en-US',
          fallbackTimezoneId:proxyTimezone,
          base:{permissions:[],serviceWorkers:'allow'},
          exposeProxyGeolocation:false,
        });
        const contextOptions=resolvedWorkerContext.options;
        // Installed-Chromium mobile Streaming remains explicitly a compatibility runtime.
        // Preserve its native UA instead of claiming to be physical Android/iOS hardware;
        // viewport/touch/DPR are still selected-device accurate and diagnostics report this limitation.
        if(browserPolicy?.compatibilityMode) delete contextOptions.userAgent;
        const contextValidation=validateWorkerContext({profile,deviceMode,contextOptions,allocation:geoConsistencyFromProxy&&allocation?.geoVerified===true?allocation:null,compatibilityMode:Boolean(browserPolicy?.compatibilityMode)});
        if(!contextValidation.ok) throw new Error(`Streaming worker identity is inconsistent: ${contextValidation.issues.join(', ')}`);
        const authorizedSession=(!restoreStoredSession||ignoreStoredSession)?{kind:'none',storageState:null,cookies:[]}:parseAuthorizedSessionState(account.sessionSecret,account.platform);
        const profileDir=browserEngine==='chromium'?String(profileDirOverride||persistentProfileDir(profileBaseDir,account)):'';
        const shouldUsePersistentProfile=Boolean(usePersistentProfile&&profileDir&&typeof launcher.launchPersistentContext==='function');
        if(shouldUsePersistentProfile){
          fs.mkdirSync(profileDir,{recursive:true});
          profileLocks.cleanStaleLockFiles(profileDir);
          try{releaseProfileLock=profileLocks.acquire(profileDir,{kind:'streaming',runId,workId:workUnit?.workId,accountId:account.id,platform:account.platform});}
          catch(error){
            const friendly=new Error(`${streamingPlatformLabel(account.platform)} profile is locked by another browser session`);
            friendly.code='ORBITQA_PROFILE_LOCKED'; friendly.cause=error; throw friendly;
          }
          const persistentOptions={...contextOptions,headless:runtimeHeadless};
          if(browserEngine==='chromium'){
            persistentOptions.chromiumSandbox=true;
            persistentOptions.ignoreDefaultArgs=['--disable-component-update'];
          }
          if(browserPolicy.executablePath)persistentOptions.executablePath=browserPolicy.executablePath;
          if(launchPolicy?.args?.length||containmentPolicy?.args?.length)persistentOptions.args=mergeLaunchArgs(launchPolicy?.args||[],containmentPolicy?.args||[],performancePolicy?.args||[],backgroundWindowArgs);
          if(muteAudio)persistentOptions.args=[...(persistentOptions.args||[]),'--mute-audio'];
          if(allocation)persistentOptions.proxy={server:allocation.server,username:allocation.username||undefined,password:allocation.password||undefined};
          normalizeChromeProfileShutdownState(profileDir);
          let launchError=null;
          for(let attempt=1;attempt<=4;attempt++){
            try{context=await launcher.launchPersistentContext(profileDir,persistentOptions);launchError=null;break;}catch(error){
              launchError=error;
              if(attempt>=4||signal?.aborted)break;
              profileLocks.cleanStaleLockFiles(profileDir,{allowOwnedActive:true});
              await new Promise(resolve=>setTimeout(resolve,500*attempt));
            }
          }
          if(!context){
            const error=new Error(`${streamingPlatformLabel(account.platform)} browser could not start. The saved account profile may be locked or damaged. Close any browser using this account, then try again or use Repair Profile.`);
            error.code='ORBITQA_PROFILE_START_FAILED'; error.cause=launchError; throw error;
          }
          browser=typeof context.browser==='function'?context.browser():null;
          const browserVersion=browser?.version?.()||'';
          if(browserEngine==='chromium'&&browserVersion)assertSupportedChromiumVersion(browserVersion);
          // A persistent Chrome/Edge profile is the source of truth for authenticated streaming state.
          // Do not inject an older encrypted storage snapshot into it on every launch: doing so can
          // overwrite fresher cookies/local storage and force Spotify/other services to sign out.
          // Saved snapshots remain available for non-persistent/recovery contexts below.
          const existingPages=typeof context.pages==='function'?context.pages():[];
          await installStrictPrivacyGuard(context,true);
          if(typeof context.newPage==='function'){
            page=await context.newPage();
            for(const existingPage of existingPages||[]){
              if(existingPage&&existingPage!==page&&typeof existingPage.close==='function') await existingPage.close().catch(()=>undefined);
            }
          }else{
            page=existingPages?.[0];
            if(!page) throw new Error('Persistent streaming profile did not provide a browser page');
            if(typeof page.reload==='function') await page.reload({waitUntil:'domcontentloaded'}).catch(()=>undefined);
          }
        }else{
          const launchOptions={headless:runtimeHeadless};
          if(browserEngine==='chromium'){
            launchOptions.chromiumSandbox=true;
            launchOptions.ignoreDefaultArgs=['--disable-component-update'];
          }
          if(browserPolicy.executablePath)launchOptions.executablePath=browserPolicy.executablePath;
          if(launchPolicy?.args?.length||containmentPolicy?.args?.length)launchOptions.args=mergeLaunchArgs(launchPolicy?.args||[],containmentPolicy?.args||[],performancePolicy?.args||[],backgroundWindowArgs);
          if(muteAudio)launchOptions.args=[...(launchOptions.args||[]),'--mute-audio'];
          if(allocation)launchOptions.proxy={server:allocation.server,username:allocation.username||undefined,password:allocation.password||undefined};
          browser=await launcher.launch(launchOptions);
          if(browserEngine==='chromium')assertSupportedChromiumVersion(browser.version?.()||'');
          if(authorizedSession.storageState)contextOptions.storageState=authorizedSession.storageState;
          context=await browser.newContext(contextOptions);
          await installStrictPrivacyGuard(context,true);
          if(authorizedSession.cookies.length&&typeof context.addCookies==='function')await context.addCookies(authorizedSession.cookies);
          page=await context.newPage();
        }
        if(chromiumBackground) await concealBackgroundWorkerWindow({page,browserEngine,executionMode,log:()=>undefined}).catch(()=>undefined);
        page.__orbitqaInteractionMode=deviceMode==='desktop'?'cursor':'touch';
        page.setDefaultTimeout?.(10000);

        const verifyCurrentProxyRoute=async({isolated=false}={})=>{
          if(!proxyRequired)return {directIp:undefined,proxiedIp:'',error:null};
          let routePage=page;
          let temporaryPage=null;
          if(isolated&&typeof context?.newPage==='function'){
            temporaryPage=await context.newPage();
            if(temporaryPage)routePage=temporaryPage;
          }
          try{
            const route=await verifyRoute({ page:routePage, proxyPoolService, routeCheckUrl, secrets:[allocation?.username,allocation?.password].filter(Boolean) });
            if(route?.error || !route?.proxiedIp) throw new Error(route?.error || 'Proxy route could not be verified');
            if(route?.directIp && route.directIp===route.proxiedIp)throw new Error('Proxy route matched a known direct route; direct fallback is blocked');
            return route;
          }finally{
            if(temporaryPage&&temporaryPage!==page&&typeof temporaryPage.close==='function')await temporaryPage.close().catch(()=>undefined);
          }
        };
        if (proxyRequired) {
          initialRoute = await verifyCurrentProxyRoute();
          const actualExitIp=String(initialRoute.proxiedIp||'').trim();
          const verifiedExitIp=String(allocation?.observedIp||'').trim();
          if((verifiedExitIp&&verifiedExitIp!==actualExitIp)||(!verifiedExitIp&&browserEngine==='chromium'&&typeof context?.newCDPSession==='function')){
            const timezoneSync=await synchronizeProxyTimezone({context,browserEngine,proxiedIp:actualExitIp,currentTimezoneId:contextOptions.timezoneId||''});
            if(timezoneSync.status!=='PASS')throw new Error(`Proxy timezone consistency failed: ${timezoneSync.reason||'timezone mismatch'}`);
            contextOptions.timezoneId=timezoneSync.timezoneId;
            if(allocation){allocation.timezoneId=timezoneSync.timezoneId;allocation.observedIp=actualExitIp;Object.assign(allocation,timezoneSync.geo||{});}
            resolvedWorkerContext.geo={...(resolvedWorkerContext.geo||{}),...(timezoneSync.geo||{}),timezoneId:timezoneSync.timezoneId};
          }
        }

        privacyReport = await collectPrivacy({
          page,
          expected:{viewport:profile.viewport,dpr:profile.deviceScaleFactor,userAgentIncludes:deviceMode==='desktop'?(profile.userAgentIncludes||''):'',platformIncludes:'',locale:contextOptions.locale||'',timezoneId:contextOptions.timezoneId||'',touch:profile.touch},
          proxyChecks:[], strictMode:true, routeObservation:initialRoute, proxyRequired,
          webRtcPreventionApplied:Boolean(launchPolicy?.args?.length),
        });
        if (privacyReport?.blocked) throw new Error(`Streaming privacy checks blocked this session: ${(privacyReport.blockingReasons||[]).join(', ')}`);

        const identitySettings={
          deviceMode:deviceMode==='android'?'android-emulation':deviceMode==='ios'?'ios-emulation':'desktop',
          deviceName:workUnit?.deviceProfile||'',
          browser:browserPolicy?.browserFamily||'chromium',
          locale:contextOptions.locale||'',
          timezoneId:contextOptions.timezoneId||'',
        };
        const identityBaseline=await collectRuntimeIdentity(page).catch(()=>null);
        const identityReport=identityBaseline?assessDeviceConsistency(buildDeviceExpectation(identitySettings,contextOptions),identityBaseline):null;
        if(identityReport?.blocked) throw new Error(`Streaming device consistency blocked this session: ${(identityReport.blockingReasons||[]).join(', ')}`);

        let closed=false;
        return {
          page, context, browser, allocation, privacyReport, identityReport, workerGeo:resolvedWorkerContext.geo, contextValidation, browserPolicy, initialRoute,
          persistentProfile:shouldUsePersistentProfile, profileDir:shouldUsePersistentProfile?profileDir:undefined,
          async refreshProxyRoute(){return await verifyCurrentProxyRoute({isolated:true});},
          async revalidateWorkerIdentity(){
            const route=proxyRequired?await verifyCurrentProxyRoute({isolated:true}):{proxiedIp:'',error:null};
            if(proxyRequired&&route?.proxiedIp&&((String(allocation?.observedIp||'').trim()&&String(allocation.observedIp).trim()!==String(route.proxiedIp).trim())||(!String(allocation?.observedIp||'').trim()&&browserEngine==='chromium'&&typeof context?.newCDPSession==='function'))){
              try{const timezoneSync=await synchronizeProxyTimezone({context,browserEngine,proxiedIp:route.proxiedIp,currentTimezoneId:contextOptions.timezoneId||''});if(timezoneSync.status!=='PASS')return {status:'FAIL',reason:timezoneSync.reason||'proxy timezone mismatch',proxiedIp:route.proxiedIp};contextOptions.timezoneId=timezoneSync.timezoneId;if(allocation){allocation.timezoneId=timezoneSync.timezoneId;allocation.observedIp=route.proxiedIp;Object.assign(allocation,timezoneSync.geo||{});}resolvedWorkerContext.geo={...(resolvedWorkerContext.geo||{}),...(timezoneSync.geo||{}),timezoneId:timezoneSync.timezoneId};}catch(error){return {status:'FAIL',reason:error instanceof Error?error.message:String(error),proxiedIp:route.proxiedIp};}
            }
            let observed={};try{observed=await page.evaluate(()=>({timezoneId:Intl.DateTimeFormat().resolvedOptions().timeZone||'',locale:navigator.language||'',languages:Array.isArray(navigator.languages)?navigator.languages:[]}));}catch(error){return {status:'FAIL',reason:error instanceof Error?error.message:String(error),proxiedIp:route?.proxiedIp||''};}
            const expectedTimezone=String(contextOptions.timezoneId||'');const expectedLocale=String(contextOptions.locale||'');
            const timezoneOk=!expectedTimezone||observed.timezoneId===expectedTimezone;
            const localeOk=!expectedLocale||String(observed.locale||'').toLowerCase()===expectedLocale.toLowerCase()||String(observed.locale||'').toLowerCase().startsWith(expectedLocale.toLowerCase().split('-')[0]);
            const routeOk=!proxyRequired||Boolean(route?.proxiedIp&&!route?.error);
            const status=routeOk&&timezoneOk&&localeOk?'PASS':'FAIL';
            return {status,reason:status==='PASS'?'Proxy route, timezone and locale are consistent':`Mismatch: ${!routeOk?'proxy route ':''}${!timezoneOk?'timezone ':''}${!localeOk?'locale ':''}`.trim(),proxiedIp:route?.proxiedIp||'',timezoneId:observed.timezoneId||'',locale:observed.locale||'',languages:observed.languages||[]};
          },
          async finalIntegrity(){
            const finalRoute=proxyRequired?await verifyCurrentProxyRoute({isolated:true}):initialRoute;
            const identityCurrent=await collectRuntimeIdentity(page).catch(()=>null);
            const graphicsStability=identityBaseline&&identityCurrent?compareGraphicsStability(identityBaseline,identityCurrent):null;
            const report=buildSessionIntegrityReport({proxySource:allocation?.proxyKind || proxySource,proxyRequired,initialRoute,finalRoute,privacyReport,identityReport});
            return {...report,workerGeo:resolvedWorkerContext.geo,contextValidation,graphicsStability};
          },
          async close(){
            if (closed) return; closed=true;
            await context?.close?.().catch(()=>undefined);
            await browser?.close?.().catch(()=>undefined);
            if(shouldUsePersistentProfile)normalizeChromeProfileShutdownState(profileDir);
            if(releaseProfileLock){await releaseProfileLock().catch(()=>undefined);releaseProfileLock=null;}
            if (allocation?.allocationId && proxyPoolService) await proxyPoolService.release(allocation.allocationId).catch(()=>undefined);
          }
        };
      } catch (error) {
        await context?.close?.().catch(()=>undefined);
        await browser?.close?.().catch(()=>undefined);
        try{if(typeof profileDir!=='undefined'&&profileDir)normalizeChromeProfileShutdownState(profileDir);}catch{}
        if(releaseProfileLock){await releaseProfileLock().catch(()=>undefined);releaseProfileLock=null;}
        if (allocation?.allocationId && proxyPoolService) await proxyPoolService.release(allocation.allocationId).catch(()=>undefined);
        if(error?.code==='ORBITQA_PROFILE_LOCKED'||error?.code==='ORBITQA_PROFILE_START_FAILED')throw error;
        const text=error instanceof Error?error.message:String(error);
        if(/launchPersistentContext|Target page, context or browser has been closed|process did exit|Singleton|profile.*(?:lock|use)/i.test(text)){
          const friendly=new Error(`${streamingPlatformLabel(account.platform)} browser could not start. The saved account profile may be locked or damaged. Close any browser using this account, then try again or use Repair Profile.`);
          friendly.code='ORBITQA_PROFILE_START_FAILED'; throw friendly;
        }
        throw error;
      }
    }
  };
}
module.exports={createStreamingBrowserFactory,parseAuthorizedCookies,parseAuthorizedSessionState,streamingDeviceProfile,persistentProfileDir,manualLoginProfileDir,accountProfileDir,restoreAuthorizedSessionIntoContext};
