const { makeAdapter, warmCatalogPage } = require('./_factory.cjs');
const {clickWithInteractionIndicator}=require('../../interaction-indicator.cjs');

const base = makeAdapter({id:'spotify',label:'Spotify',hosts:['spotify.com']});
const SPOTIFY_HOME = 'https://open.spotify.com/';
const SPOTIFY_LOGIN = 'https://accounts.spotify.com/en/login';

let recaptchaModule = null;
try { recaptchaModule = require('../../recaptcha-solver.cjs'); } catch { recaptchaModule = null; }
const solveRecaptcha = typeof recaptchaModule === 'function'
  ? recaptchaModule
  : typeof recaptchaModule?.solveRecaptcha === 'function'
    ? recaptchaModule.solveRecaptcha
    : typeof recaptchaModule?.solve === 'function'
      ? recaptchaModule.solve
      : null;

// Spotify paints a login control in the header for a moment while the page hydrates, before the
// profile chip replaces it. A verification that lands in that window is not evidence of a dead
// session, so it is retried rather than believed.
const SESSION_SETTLING = /still exposes a login control|not confirmed active yet|is still settling/i;

// Spotify uses two different widgets. A standalone challenge page serves a visible checkbox; the
// login page itself carries an invisible reCAPTCHA Enterprise that resolves on submit and has no
// checkbox at all. They need different handling, so they are distinct shapes.
const CHALLENGE_URL = /challenge\.spotify\.com/i;
const RECAPTCHA_FRAME_SELECTORS = [
  'iframe[src*="recaptcha" i]',
  'iframe[src*="challenge.spotify.com"]',
  'iframe[src*="hcaptcha" i]',
  '.g-recaptcha',
  '.h-captcha',
  '.recaptcha',
  'div[data-testid*="recaptcha" i]',
  '[data-testid*="captcha" i]',
];
const RECAPTCHA_FRAME_URL = /recaptcha/i;
const RECAPTCHA_BFRAME_URL = /recaptcha.*bframe/i;
const INVISIBLE_MARKER = /[?&]size=invisible/i;
const ANCHOR_SELECTORS = ['#recaptcha-anchor','.recaptcha-checkbox-border','.recaptcha-checkbox','[role="checkbox"]'];
const RECAPTCHA_TOKEN_SELECTORS = [
  'textarea[name="g-recaptcha-response"]',
  '#g-recaptcha-response',
  'textarea[name="h-captcha-response"]',
];
const CODE_SELECTORS = [
  'input[autocomplete="one-time-code"]',
  'input[name*="code" i]',
  'input[inputmode="numeric"]',
];
const CHALLENGE_TEXT_PATTERNS = [
  /verify (?:that )?you(?:'re| are)? (?:a )?human/i,
  /security check/i,
  /two[- ]factor/i,
  /2[- ]step verification/i,
  /verify it(?:'s| is) you/i,
  /complete (?:the )?captcha/i,
  /solve (?:the )?captcha/i,
  /captcha required/i,
  /i(?:'m| am) not a robot/i,
  /verification code/i,
  /check your email/i,
  /enter (?:the )?code/i,
];
const SOLVER_TIMEOUT_MS = 12000;
const MAX_CHALLENGE_SOLVES = 3;
const MAX_INVISIBLE_SUBMITS = 3;

const PLAYER_PLAY_SELECTORS = [
  '[data-testid="control-button-playpause"]',
  '[data-testid="control-button-play"]',
  '[data-testid="play-button"]',
  'button[aria-label="Play"]',
  'button[aria-label^="Play" i]',
];
const PLAYER_PAUSE_SELECTORS = [
  '[data-testid="control-button-pause"]',
  'button[aria-label="Pause"]',
  'button[aria-label^="Pause" i]',
];
const NOW_PLAYING_TRACK_SELECTORS = [
  '[data-testid="now-playing-widget"] a[href*="/track/"]',
  '[data-testid="context-item-link"][href*="/track/"]',
  'footer a[href*="/track/"]',
];

function firstOf(value){ return value?.first ? value.first() : value; }
function safeUrl(page){ try{return String(page?.url?.()||'');}catch{return '';} }
function spotifyIdFromUrl(url,kind){
  const match=String(url||'').match(new RegExp(`/${kind}/([A-Za-z0-9]+)`,'i'));
  return match ? match[1] : '';
}
function embedUrl(url,kind){
  const id=spotifyIdFromUrl(url,kind);
  return id ? `https://open.spotify.com/embed/${kind}/${id}` : String(url||'');
}
function dedupeRows(rows=[]){
  const seen=new Set(); const out=[];
  for(const row of rows){
    const url=String(row?.url||row?.href||'');
    if(!url||seen.has(url)) continue;
    seen.add(url); out.push({...row,url,id:String(row?.id||url)});
  }
  return out;
}
async function readSpotifyLinks(page){
  if(!page?.evaluate) return [];
  const rows=await page.evaluate(()=>{
    const out=[]; const seen=new Set();
    for(const a of document.querySelectorAll('a[href]')){
      const href=a.href; if(!href||seen.has(href)) continue;
      let u; try{u=new URL(href);}catch{continue;}
      if(!/(^|\.)spotify\.com$/i.test(u.hostname) && !u.hostname.endsWith('.spotify.com')) continue;
      if(!/(\/track\/|\/album\/|\/playlist\/|\/discography\/)/i.test(u.pathname)) continue;
      const title=(a.getAttribute('aria-label')||a.textContent||a.getAttribute('title')||'').trim().replace(/\s+/g,' ');
      seen.add(href); out.push({id:href,title:title||'Spotify item',url:href});
    }
    return out;
  }).catch(()=>[]);
  return Array.isArray(rows)?rows:[];
}
function spotifyNavigationError(error){
  const message=String(error?.message||error||'navigation failed').split(/\r?\n/)[0].trim();
  return message.slice(0,240)||'navigation failed';
}
function isSpotifyPageUrl(value){
  try{const url=new URL(String(value||''));return url.hostname==='spotify.com'||url.hostname.endsWith('.spotify.com');}catch{return false;}
}
async function safeGoto(page,url,timeout=20000){
  if(!page?.goto||!url) return {ok:false,reason:'Browser page navigation is unavailable'};
  let lastError=null;
  for(const waitUntil of ['domcontentloaded','commit']){
    try{
      await page.goto(url,{waitUntil,timeout});
      await page.waitForTimeout?.(350);
      return {ok:true,url:String(page.url?.()||url)};
    }catch(error){
      lastError=error;
      const currentUrl=safeUrl(page);
      if(currentUrl&&!/^about:blank$/i.test(currentUrl)&&isSpotifyPageUrl(currentUrl)){
        await page.waitForTimeout?.(350);
        return {ok:true,url:currentUrl,warning:spotifyNavigationError(error)};
      }
      await waitStep(page);
    }
  }
  return {ok:false,reason:spotifyNavigationError(lastError)};
}
function durationSecondsFromText(value){
  const match=String(value||'').trim().match(/^(\d{1,2}):(\d{2})$/);
  return match ? (Number(match[1])*60)+Number(match[2]) : undefined;
}
function parseSpotifyEmbedTrackText(text=''){
  const lines=String(text||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const out=[];
  for(let i=0;i<lines.length;i++){
    if(!/^\d{1,3}\.?$/.test(lines[i])) continue;
    const title=lines[i+1];
    const artist=lines[i+2];
    const durationText=lines[i+3];
    const durationSeconds=durationSecondsFromText(durationText);
    if(!title || !artist || !durationSeconds) continue;
    if(/^(top tracks|popular|more)$/i.test(title)) continue;
    const query=[artist,title].filter(Boolean).join(' ');
    const id=`spotify-search:${artist.toLowerCase()}::${title.toLowerCase()}`;
    out.push({id,title,artist,url:`https://open.spotify.com/search/${encodeURIComponent(query)}`,durationSeconds});
    i+=3;
  }
  return dedupeRows(out);
}
async function readSpotifyTextTracks(page){
  try{
    const body=page?.locator?.('body');
    const text=await body?.innerText?.({timeout:5000});
    return parseSpotifyEmbedTrackText(text);
  }catch{return [];}
}
async function extractTracksFromCurrentPage(page){
  const rows=await readSpotifyLinks(page);
  const linked=dedupeRows(rows.filter(row=>/\/track\//i.test(String(row.url||''))));
  if(linked.length) return linked;
  return readSpotifyTextTracks(page);
}

async function expandSpotifyDiscography(page){
  for(let i=0;i<12;i++){
    const button=firstOf(page.getByRole?.('button',{name:/show more/i}));
    if(!button || !await visible(button)) break;
    try{await clickWithInteractionIndicator(page,button,{timeout:4000});}catch{break;}
    await page.waitForTimeout?.(180);
  }
}
async function collectReleaseUrls(page,input){
  await warmCatalogPage(page,'artist');
  let rows=await readSpotifyLinks(page);
  let releases=rows.filter(row=>/\/album\//i.test(String(row.url||''))).map(row=>row.url);
  const discography=rows.filter(row=>/\/discography\//i.test(String(row.url||''))).map(row=>row.url);
  const artistId=spotifyIdFromUrl(input,'artist');
  if(!discography.length && artistId) discography.push(`https://open.spotify.com/artist/${artistId}/discography/all`);
  for(const url of discography.slice(0,3)){
    if((await safeGoto(page,url)).ok){
      await warmCatalogPage(page,'artist');
      await expandSpotifyDiscography(page);
      await warmCatalogPage(page,'artist');
      rows=await readSpotifyLinks(page);
      releases.push(...rows.filter(row=>/\/album\//i.test(String(row.url||''))).map(row=>row.url));
    }
  }
  return [...new Set(releases)].slice(0,200);
}
async function resolveSpotifyCatalog({input,page}){
  const kind=base.classifyInput(input);
  if(!page) return {kind,tracks:[]};
  if(kind==='track'){
    const rows=await readSpotifyLinks(page);
    const direct=rows.find(row=>/\/track\//i.test(String(row.url||'')) && spotifyIdFromUrl(row.url,'track')===spotifyIdFromUrl(input,'track'));
    return {kind,tracks:[direct||{id:String(input),title:'Spotify track',url:String(input)}]};
  }
  if(kind==='album' || kind==='playlist'){
    await safeGoto(page,embedUrl(input,kind));
    await warmCatalogPage(page,kind);
    return {kind,tracks:await extractTracksFromCurrentPage(page)};
  }
  if(kind==='artist'){
    const tracks=[];
    const original=String(input);
    if(safeUrl(page)!==original) await safeGoto(page,original);
    tracks.push(...await extractTracksFromCurrentPage(page));
    const releases=await collectReleaseUrls(page,original);
    for(const release of releases){
      const target=embedUrl(release,'album');
      if(!(await safeGoto(page,target)).ok) continue;
      tracks.push(...await extractTracksFromCurrentPage(page));
    }
    if(!tracks.length){
      const artistId=spotifyIdFromUrl(original,'artist');
      if(artistId && (await safeGoto(page,`https://open.spotify.com/embed/artist/${artistId}`)).ok) tracks.push(...await extractTracksFromCurrentPage(page));
    }
    return {kind,tracks:dedupeRows(tracks)};
  }
  return base.resolveCatalog({input,page});
}
async function visible(locator){
  try{return Boolean(locator && await firstOf(locator)?.isVisible?.());}catch{return false;}
}
async function anyVisible(page,candidates){
  for(const candidate of candidates||[]){
    const item=firstOf(candidate); if(!item) continue;
    try{if(await item.isVisible?.()) return true;}catch{}
  }
  return false;
}
async function fillFirst(candidates,value){
  for(const candidate of candidates){
    const item=firstOf(candidate); if(!item) continue;
    try{if(await item.isVisible?.()){await item.fill(String(value)); return true;}}catch{}
  }
  return false;
}
async function waitStep(page){try{await page.waitForTimeout?.(250);}catch{}}
async function waitFillFirst(page,candidates,value,{attempts=40}={}){
  for(let i=0;i<attempts;i++){
    if(await fillFirst(candidates,value)) return true;
    if(i<attempts-1) await waitStep(page);
  }
  return false;
}
async function clickFirst(page,candidates){
  for(const candidate of candidates){
    const item=firstOf(candidate); if(!item) continue;
    try{if(await item.isVisible?.()){await clickWithInteractionIndicator(page,item,{timeout:5000}); return true;}}catch{}
  }
  return false;
}
async function clickPasswordRoute(page){
  return clickFirst(page,[
    page.getByRole?.('button',{name:/use (?:a )?password|log in with password|login with password|sign in with password|password instead|enter password/i}),
    page.getByRole?.('link',{name:/use (?:a )?password|log in with password|login with password|sign in with password|password instead|enter password/i}),
  ].filter(Boolean));
}
async function waitClickFirst(page,candidates,{attempts=20}={}){
  for(let i=0;i<attempts;i++){
    if(await clickFirst(page,candidates)) return true;
    if(i<attempts-1) await waitStep(page);
  }
  return false;
}

// Retries a settling result instead of reporting it. Six passes at roughly 450ms covers the
// hydration window without stalling the run; a result that survives that is marked transient so
// the caller retries rather than escalating to a full credential recovery.
const baseVerifySession=typeof base.verifySession==='function'?base.verifySession:null;
async function spotifyVerifySession({page,account,signal}={}){
  if(!baseVerifySession) return {status:'PASS',reason:'No session verification available'};
  let last={status:'WARNING',reason:'Spotify session is still settling'};
  for(let attempt=0;attempt<6;attempt++){
    if(signal?.aborted) return {status:'WARNING',transient:true,reason:'Spotify session check was cancelled'};
    try{last=await baseVerifySession({page,account,signal});}
    catch(error){last={status:'WARNING',transient:true,reason:error instanceof Error?error.message:String(error)};}
    if(last?.status!=='WARNING') return last;
    if(!SESSION_SETTLING.test(String(last?.reason||''))) return last;
    if(attempt<5) await waitStep(page);
  }
  return {...last,transient:true,settling:true};
}

async function verifyStableSpotifySession(page,account){
  let last={status:'WARNING',reason:'Spotify session is still settling'};
  let consecutivePasses=0;
  for(let attempt=0;attempt<12;attempt++){
    last=await base.verifySession({page,account});
    const onAccounts=/accounts\.spotify\.com/i.test(safeUrl(page));
    if(last?.status==='NEEDS_VERIFICATION'||last?.status==='FAILED')return last;
    if(last?.status==='PASS'&&!onAccounts){
      consecutivePasses++;
      if(consecutivePasses>=2)return last;
    }else{
      consecutivePasses=0;
      // A settling page is retried here too; only a settled non-pass ends the loop early.
      if(onAccounts||(!last?.transient&&!SESSION_SETTLING.test(String(last?.reason||''))))return last;
    }
    if(attempt<11){try{await page.waitForTimeout?.(400);}catch{await waitStep(page);}}
  }
  return last;
}

// Shapes: 'invisible' for the login page's zero-size reCAPTCHA Enterprise (no checkbox, resolves
// on submit), 'recaptcha' for a visible widget on the challenge page, 'code' for a one-time-code
// step, 'text' when only challenge copy is visible, '' for none.
async function challengeShape(page){
  const frames=page.frames?.()||[];
  // Invisible widgets are zero-size, so they must be matched on the URL, never on visibility.
  for(const frame of frames){
    let url='';
    try{url=String(frame.url?.()||'');}catch{continue;}
    if(RECAPTCHA_FRAME_URL.test(url)&&INVISIBLE_MARKER.test(url)) return 'invisible';
  }
  for(const selector of RECAPTCHA_FRAME_SELECTORS){
    try{
      const candidate=page.locator?.(selector);
      if(candidate && typeof candidate.count==='function' && await candidate.count()>0 && await visible(candidate)) return 'recaptcha';
    }catch{}
  }
  if(CHALLENGE_URL.test(safeUrl(page))) return 'recaptcha';
  for(const selector of CODE_SELECTORS){
    try{if(await visible(page.locator?.(selector))) return 'code';}catch{}
  }
  for(const pattern of CHALLENGE_TEXT_PATTERNS){
    try{if(await visible(page.getByText?.(pattern))) return 'text';}catch{}
  }
  return '';
}
async function hasChallenge(page){
  return Boolean(await challengeShape(page));
}

async function waitChallengeClear(page,{signal,timeoutMs=12000}={}){
  const deadline=Date.now()+Math.max(1000,timeoutMs);
  let clearStreak=0;
  while(Date.now()<deadline){
    if(signal?.aborted) return false;
    if(!await challengeShape(page)){
      clearStreak++;
      if(clearStreak>=2) return true;
    }else{
      clearStreak=0;
    }
    await waitStep(page);
  }
  return false;
}

async function withTimeout(promise,ms,onTimeout){
  let timer=null;
  const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve(onTimeout),ms);});
  try{return await Promise.race([promise,timeout]);}finally{if(timer)clearTimeout(timer);}
}

// --- reCAPTCHA --------------------------------------------------------------------------------

function recaptchaBFrame(page){
  try{
    return (page.frames?.()||[]).find((frame)=>RECAPTCHA_BFRAME_URL.test(String(frame.url?.()||'')))||null;
  }catch{return null;}
}
function invisibleRecaptchaFrame(page){
  try{
    return (page.frames?.()||[]).find((frame)=>{
      const url=String(frame.url?.()||'');
      return RECAPTCHA_FRAME_URL.test(url)&&INVISIBLE_MARKER.test(url);
    })||null;
  }catch{return null;}
}
async function recaptchaAnchor(page){
  for(const frame of page.frames?.()||[]){
    let url='';
    try{url=String(frame.url?.()||'');}catch{continue;}
    if(url&&!RECAPTCHA_FRAME_URL.test(url)) continue;
    for(const selector of ANCHOR_SELECTORS){
      try{
        if(await frame.locator(selector).first().count()>0) return {frame,selector};
      }catch{}
    }
  }
  return null;
}
async function recaptchaTokenPresent(page){
  for(const selector of RECAPTCHA_TOKEN_SELECTORS){
    try{
      const value=await page.locator?.(selector).first().inputValue({timeout:800});
      if(String(value||'').trim()) return true;
    }catch{}
  }
  return false;
}
async function recaptchaCheckboxChecked(page){
  const anchor=await recaptchaAnchor(page);
  if(!anchor) return false;
  try{return (await anchor.frame.locator('#recaptcha-anchor').first().getAttribute('aria-checked'))==='true';}catch{return false;}
}
async function recaptchaSolved(page){
  return (await recaptchaTokenPresent(page)) || (await recaptchaCheckboxChecked(page));
}
async function waitRecaptchaToken(page,{signal,timeoutMs=15000}={}){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    if(signal?.aborted) return false;
    if(await recaptchaSolved(page)) return true;
    await waitStep(page);
  }
  return false;
}
async function waitCheckboxChecked(page,{timeoutMs=2500}={}){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    if(await recaptchaCheckboxChecked(page)) return true;
    await waitStep(page);
  }
  return false;
}

async function clickRecaptchaCheckbox(page){
  const anchor=await recaptchaAnchor(page);
  if(!anchor) return false;
  const targets=anchor.selector==='#recaptcha-anchor'?ANCHOR_SELECTORS:[anchor.selector,...ANCHOR_SELECTORS];
  for(const selector of targets){
    let checkbox=null;
    try{checkbox=anchor.frame.locator(selector).first();}catch{continue;}
    if(!checkbox || !await checkbox.count().catch(()=>0)) continue;
    if(!await checkbox.isVisible().catch(()=>false)) continue;

    try{await checkbox.click({timeout:4000});}catch{}
    if(await waitCheckboxChecked(page)) return true;

    try{await checkbox.click({timeout:4000,force:true});}catch{}
    if(await waitCheckboxChecked(page)) return true;

    try{await clickWithInteractionIndicator(page,checkbox,{timeout:5000});}catch{}
    if(await waitCheckboxChecked(page)) return true;
  }
  return false;
}

async function executeInvisibleRecaptcha(page){
  const frame=invisibleRecaptchaFrame(page);
  if(!frame) return false;
  let key='';
  try{key=(String(frame.url?.()||'').match(/[?&]k=([^&]+)/)||[])[1]||'';}catch{return false;}
  if(!key) return false;
  try{
    return Boolean(await page.evaluate((siteKey)=>{
      const api=globalThis.grecaptcha?.enterprise||globalThis.grecaptcha;
      if(!api||typeof api.execute!=='function') return false;
      try{api.execute(siteKey);return true;}catch{return false;}
    },key));
  }catch{return false;}
}
async function submitIdentifier(page){
  return waitClickFirst(page,[
    page.getByRole?.('button',{name:/continue|next/i}),
    page.locator?.('button[type="submit"],input[type="submit"]'),
  ].filter(Boolean),{attempts:6});
}
async function attemptInvisibleSolve({page,signal,passwordCandidates,usernameCandidates,username}){
  if(username)await ensureUsername(page,usernameCandidates,username);
  const executed=await executeInvisibleRecaptcha(page);
  const before=safeUrl(page);
  await submitIdentifier(page);
  const deadline=Date.now()+9000;
  while(Date.now()<deadline){
    if(signal?.aborted) return {solved:false,reason:'Spotify login was cancelled'};
    if(await anyVisible(page,passwordCandidates)) return {solved:true,method:'invisible-password'};
    if(await recaptchaTokenPresent(page)) return {solved:true,method:'invisible-token'};
    if(safeUrl(page)!==before) return {solved:true,method:'invisible-navigate'};
    await waitStep(page);
  }
  return {
    solved:false,
    reason:`the invisible reCAPTCHA did not let the identifier submit${executed?'':' (grecaptcha.execute was unavailable)'}`,
  };
}

async function clickRecaptchaAudio(page){
  const bframe=recaptchaBFrame(page);
  if(!bframe) return false;
  try{
    const button=bframe.locator('#recaptcha-audio-button').first();
    if(!await button.count()) return false;
    await button.click({timeout:4000});
    return true;
  }catch{return false;}
}
async function clickChallengeContinue(page){
  return clickFirst(page,[
    page.getByRole?.('button',{name:/^(continue|verify|next|submit|log in|login|sign in)$/i}),
    page.locator?.('button[type="submit"],input[type="submit"]'),
  ].filter(Boolean));
}
async function diagnoseChallengePage(page){
  try{
    let title='';
    try{title=String(await page.title?.()||'');}catch{}
    const frames=[];
    for(const frame of page.frames?.()||[]){
      try{frames.push(String(frame.url?.()||'about:blank'));}catch{frames.push('unknown');}
    }
    const anchors=[];
    for(const frame of page.frames?.()||[]){
      for(const selector of ANCHOR_SELECTORS){
        try{if(await frame.locator(selector).first().count()>0) anchors.push(selector);}catch{}
      }
    }
    const checked=await recaptchaCheckboxChecked(page);
    const hasToken=await recaptchaTokenPresent(page);
    const bframe=Boolean(recaptchaBFrame(page));
    const invisible=Boolean(invisibleRecaptchaFrame(page));
    return `title="${title.slice(0,50)}" imageChallenge=${bframe} invisible=${invisible} checked=${checked} responseToken=${hasToken} frames=[${frames.join(' | ').slice(0,320)}]`;
  }catch{return 'page diagnosis unavailable';}
}

async function attemptRecaptchaSolve({page,signal,account}){
  const clicked=await clickRecaptchaCheckbox(page);
  const imageChallenge=Boolean(recaptchaBFrame(page));
  if(clicked){
    if(await waitRecaptchaToken(page,{signal,timeoutMs:imageChallenge?9000:15000})) return {solved:true,method:'checkbox'};
    await clickChallengeContinue(page);
    if(await waitRecaptchaToken(page,{signal,timeoutMs:4000})) return {solved:true,method:'checkbox+continue'};
  }
  const clickNote=clicked
    ? (imageChallenge
        ? 'the checkbox was ticked and Google served an image challenge'
        : 'the checkbox was clicked but no response token was issued')
    : 'no visible reCAPTCHA checkbox was found';

  if(solveRecaptcha){
    const outcome=await withTimeout(
      Promise.resolve()
        .then(()=>solveRecaptcha({page,signal,sttApiKey:account?.sttApiKey,platform:'spotify',context:'spotify-credential-login',log:()=>{}}))
        .catch(error=>({status:'WARNING',reason:error instanceof Error?error.message:String(error)})),
      SOLVER_TIMEOUT_MS,
      {status:'WARNING',reason:'solver timed out'},
    );
    if(await waitRecaptchaToken(page,{signal,timeoutMs:6000})) return {solved:true,method:'solver'};
    const solverNote=String(outcome?.reason||'').trim()||'the solver produced no token';
    return {solved:false,reason:`${clickNote}; ${solverNote}`};
  }

  if(await clickRecaptchaAudio(page)){
    if(await waitRecaptchaToken(page,{signal,timeoutMs:10000})) return {solved:true,method:'audio'};
    return {solved:false,reason:`${clickNote}; audio challenge offered but no response token was issued`};
  }
  return {solved:false,reason:clickNote};
}

async function clearLoginChallenge({page,signal,account={},passwordCandidates=[],usernameCandidates=[],username='',maxSolves=MAX_CHALLENGE_SOLVES}={}){
  let solves=0;
  let invisibleSubmits=0;
  let reason='';
  for(let round=0;round<maxSolves+6;round++){
    const shape=await challengeShape(page);
    if(!shape) return {cleared:true,reason:reason||'Spotify challenge cleared'};
    if(shape==='code') return {cleared:false,code:true,reason:'Spotify asked for a verification code (MFA)'};
    if(shape==='invisible'){
      if(invisibleSubmits>=MAX_INVISIBLE_SUBMITS) return {cleared:false,reason:`${reason||'the invisible reCAPTCHA kept rejecting the submit'} · ${await diagnoseChallengePage(page)}`};
      invisibleSubmits++;
      const outcome=await attemptInvisibleSolve({page,signal,passwordCandidates,usernameCandidates,username});
      if(outcome.solved) return {cleared:true,reason:`invisible reCAPTCHA cleared via ${outcome.method}`};
      reason=outcome.reason;
      await waitStep(page);
      continue;
    }
    if(shape==='recaptcha'){
      if(solves>=maxSolves) return {cleared:false,reason:`${reason||'Spotify reCAPTCHA kept reappearing'} · ${await diagnoseChallengePage(page)}`};
      solves++;
      const outcome=await attemptRecaptchaSolve({page,signal,account});
      if(!outcome.solved) reason=outcome.reason;
      if(outcome.solved&&await waitChallengeClear(page,{signal,timeoutMs:20000})) return {cleared:true,reason:'Spotify reCAPTCHA cleared'};
      await waitStep(page);
      continue;
    }
    if(await waitChallengeClear(page,{signal,timeoutMs:6000})) return {cleared:true,reason:reason||'Spotify challenge cleared'};
  }
  return {cleared:false,reason:`${reason||'Spotify challenge did not clear'} · ${await diagnoseChallengePage(page)}`};
}

async function awaitPasswordOrChallenge({page,signal,account={},passwordCandidates,usernameCandidates=[],username='',timeoutMs=75000,maxSolves=MAX_CHALLENGE_SOLVES}={}){
  const deadline=Date.now()+timeoutMs;
  let solves=0;
  let invisibleSubmits=0;
  let reason='';
  while(Date.now()<deadline){
    if(signal?.aborted) return {status:'aborted',reason:'Spotify login was cancelled'};
    if(await anyVisible(page,passwordCandidates)) return {status:'password',reason:'Password step reached'};
    const shape=await challengeShape(page);
    if(!shape){await waitStep(page);continue;}
    if(shape==='code') return {status:'code',reason:'Spotify asked for a verification code (MFA)'};
    if(shape==='invisible'){
      if(invisibleSubmits>=MAX_INVISIBLE_SUBMITS) return {status:'challenge',reason:`${reason||'the invisible reCAPTCHA kept rejecting the submit'} · ${await diagnoseChallengePage(page)}`};
      invisibleSubmits++;
      const outcome=await attemptInvisibleSolve({page,signal,passwordCandidates,usernameCandidates,username});
      if(outcome.solved) continue;
      reason=outcome.reason;
      await waitStep(page);
      continue;
    }
    if(shape==='recaptcha'){
      if(solves>=maxSolves) return {status:'challenge',reason:`${reason||'Spotify reCAPTCHA kept reappearing'} · ${await diagnoseChallengePage(page)}`};
      solves++;
      const outcome=await attemptRecaptchaSolve({page,signal,account});
      if(!outcome.solved) reason=outcome.reason;
      if(await anyVisible(page,passwordCandidates)) return {status:'password',reason:'Password step reached after clearing the challenge'};
      if(outcome.solved&&await waitChallengeClear(page,{signal,timeoutMs:20000})) continue;
      await waitStep(page);
      continue;
    }
    if(await waitChallengeClear(page,{signal,timeoutMs:6000})) continue;
    return {status:'challenge',reason:`${reason||'Spotify challenge did not clear'} · ${await diagnoseChallengePage(page)}`};
  }
  return {status:'timeout',reason:`${reason||'Spotify password field did not appear'} · ${await diagnoseChallengePage(page)}`};
}

function challengeFailure(stage,detail){
  return {status:'WARNING',challenge:true,reason:`Spotify requires CAPTCHA/MFA/manual verification ${stage}: ${detail}`};
}

async function ensureUsername(page,candidates,value){
  try{
    for(const candidate of candidates||[]){
      const item=firstOf(candidate); if(!item) continue;
      if(!await item.isVisible?.()) continue;
      let current='';
      try{current=await item.inputValue({timeout:800});}catch{}
      if(String(current||'').trim()) return true;
      return await fillFirst([candidate],value);
    }
  }catch{}
  return false;
}

// --- player readiness and identity ------------------------------------------------------------

async function playerReady(page){
  for(const selector of PLAYER_PAUSE_SELECTORS){
    try{if(await visible(page.locator?.(selector))) return true;}catch{}
  }
  for(const selector of PLAYER_PLAY_SELECTORS){
    try{
      const control=page.locator?.(selector).first();
      if(!control || !await control.isVisible()) continue;
      if(await control.isDisabled?.()) continue;
      if((await control.getAttribute('aria-disabled'))==='true') continue;
      return true;
    }catch{}
  }
  return false;
}
async function waitForPlayerReady(page,{signal,timeoutMs=8000}={}){
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline){
    if(signal?.aborted) return false;
    if(await playerReady(page)) return true;
    await waitStep(page);
  }
  return false;
}

async function readNowPlayingTrackHrefs(page){
  if(!page?.evaluate) return [];
  try{
    const hrefs=await page.evaluate((selectors)=>{
      const out=[];
      for(const selector of selectors){
        for(const element of document.querySelectorAll(selector)){
          const href=element.getAttribute('href');
          if(href) out.push(href);
        }
      }
      return out;
    },NOW_PLAYING_TRACK_SELECTORS);
    return Array.isArray(hrefs)?hrefs:[];
  }catch{return [];}
}

async function spotifyActiveTrackMatches({page,track={},signal}={}){
  if(!page) return false;
  const wanted=spotifyIdFromUrl(track?.url||'','track');
  if(!wanted) return false;
  const hrefs=await readNowPlayingTrackHrefs(page);
  if(hrefs.length) return hrefs.some((href)=>spotifyIdFromUrl(href,'track')===wanted);
  if(spotifyIdFromUrl(safeUrl(page),'track')===wanted) return true;
  if(typeof base.selectedTrackReady==='function'){
    try{return Boolean(await base.selectedTrackReady({page,track,signal}));}catch{return false;}
  }
  return false;
}

const basePlaybackControls=typeof base.playbackControls==='function'?base.playbackControls:null;
async function spotifyPlaybackControls(args={}){
  const controls=basePlaybackControls?await basePlaybackControls(args):{};
  const page=args.page;
  const signal=args.signal;
  if(!controls||typeof controls.play!=='function') return controls;
  return {
    ...controls,
    async play(){
      if(!await waitForPlayerReady(page,{signal,timeoutMs:8000})) return {status:'WARNING',reason:'Spotify Play control is not ready yet'};
      let result=await controls.play();
      if(result?.status==='PASS') return result;
      if(await waitForPlayerReady(page,{signal,timeoutMs:5000})) result=await controls.play();
      return result;
    },
  };
}

async function resolveSpotifySearchTrackHref(page,track={}){
  if(!page?.evaluate||!String(track?.title||'').trim())return '';
  try{
    const href=await page.evaluate(({title,artist})=>{
      const norm=value=>String(value||'').replace(/\s+/g,' ').trim().toLowerCase();
      const wantedTitle=norm(title),wantedArtist=norm(artist);
      const links=[...document.querySelectorAll('a[href*="/track/"]')];
      let best=null; let bestScore=-1;
      for(const link of links){
        let container=link; let text=norm(link.textContent);
        for(let depth=0;container&&depth<7;depth++,container=container.parentElement){
          const candidate=norm(container.textContent);
          if(candidate.includes(wantedTitle)){text=candidate;break;}
        }
        let score=0;
        if(norm(link.textContent)===wantedTitle)score+=8;
        if(text.includes(wantedTitle))score+=5;
        if(wantedArtist&&text.includes(wantedArtist))score+=3;
        const raw=String(link.getAttribute('href')||'');
        if(/\/track\/[A-Za-z0-9]+/.test(raw))score+=2;
        if(score>bestScore){bestScore=score;best=link.href||raw;}
      }
      return bestScore>=5?String(best||''):'';
    },{title:String(track?.title||''),artist:String(track?.artist||'')});
    if(!href)return '';
    const parsed=new URL(String(href),'https://open.spotify.com');
    if(!/(^|\.)spotify\.com$/i.test(parsed.hostname)||!/\/track\/[A-Za-z0-9]+/i.test(parsed.pathname))return '';
    return parsed.toString();
  }catch{return '';}
}

async function locateSpotifyTrack({page,track={}}){
  if(!page || !track?.url) return {status:'NOT_APPLICABLE',reason:'No canonical or searchable Spotify track reference'};
  const target=String(track.url||'');
  const isSearch=String(track.id||'').startsWith('spotify-search:') || /open\.spotify\.com\/search\//i.test(target);
  if(!isSearch) return base.locateTrack({page,track});
  const searchNavigation=await safeGoto(page,target);
  if(!searchNavigation.ok) return {status:'WARNING',reason:`Spotify track search could not be opened: ${searchNavigation.reason}`};
  await page.waitForTimeout?.(700);
  const title=String(track.title||'').trim();
  const candidate=firstOf(page.locator?.('a[href*="/track/"]',{hasText:title}));
  if(candidate && await visible(candidate)){
    let href=null;
    try{href=await candidate.getAttribute?.('href');}catch{}
    if(href){
      const canonical=new URL(href,'https://open.spotify.com').toString();
      if((await safeGoto(page,canonical)).ok) return {status:'PASS',url:canonical,method:'title-anchor'};
    }
  }
  const cardHref=await resolveSpotifySearchTrackHref(page,track);
  if(cardHref&&(await safeGoto(page,cardHref)).ok) return {status:'PASS',url:cardHref,method:'matching-result-card'};
  return {status:'WARNING',reason:`Spotify could not resolve the exact track from search: ${title || 'Untitled track'}`,url:target};
}

async function spotifyManualLoginFallback(page,reason){
  const reopened=await safeGoto(page,SPOTIFY_LOGIN);
  const detail=reopened.ok?'Spotify reopened the normal login page for manual sign-in.':`Spotify login page could not be reopened: ${reopened.reason}`;
  return {status:'NEEDS_VERIFICATION',transient:true,useSystemBrowser:true,url:SPOTIFY_LOGIN,reason:`${reason} ${detail} OrbitQA will reopen Spotify in a normal system Chrome/Edge window for manual sign-in. Complete sign-in there, then mark the account verified.`};
}

async function authenticateSpotify({page,account={},signal}){
  if(!page) return {status:'NOT_APPLICABLE',reason:'No browser page'};

  if(account.sessionSecret){
    const homeNavigation=await safeGoto(page,SPOTIFY_HOME);
    if(homeNavigation.ok){
      const existing=await verifyStableSpotifySession(page,account);
      if(existing?.status==='PASS' && !/accounts\.spotify\.com/i.test(safeUrl(page))) return {status:'PASS',reason:'Authorized Spotify session restored'};
    }
  }

  if(account.authMode==='oauth') return {status:'WARNING',reason:'OAuth requires an already-authorized imported session in this build'};
  if(!account.username || !account.password) return {status:'WARNING',reason:'Spotify credential login requires both username/email and password'};

  const loginNavigation=await safeGoto(page,SPOTIFY_LOGIN);
  if(!loginNavigation.ok) return {status:'WARNING',reason:`Spotify login page could not be opened: ${loginNavigation.reason}`};

  const usernameCandidates=[
    page.getByLabel?.(/email|username/i),
    page.getByPlaceholder?.(/email|username/i),
    page.locator?.('input[name="username"],input[name="email"],input[type="email"],input[id*="username" i],input[id*="email" i],input[autocomplete="username"],input[autocomplete="email"]'),
  ].filter(Boolean);
  const passwordCandidates=[
    page.getByLabel?.(/password/i),
    page.getByPlaceholder?.(/password/i),
    page.locator?.('input[name="password"],input[type="password"],input[id*="password" i],input[autocomplete="current-password"]'),
  ].filter(Boolean);
  if(!await waitFillFirst(page,usernameCandidates,account.username,{attempts:40})) return {status:'WARNING',reason:'Spotify username/email field was not available after waiting for the login form'};

  const gateContext={passwordCandidates,usernameCandidates,username:account.username};
  let passwordFilled=false;
  if(await anyVisible(page,passwordCandidates)) passwordFilled=await fillFirst(passwordCandidates,account.password);

  if(!passwordFilled){
    await submitIdentifier(page);

    const gate=await awaitPasswordOrChallenge({page,signal,account,...gateContext});
    if(gate.status==='password'){
      await ensureUsername(page,usernameCandidates,account.username);
      passwordFilled=await fillFirst(passwordCandidates,account.password);
    }else if(gate.status==='aborted'){
      return {status:'WARNING',transient:true,reason:gate.reason};
    }else{
      if(await clickPasswordRoute(page)){
        const retry=await awaitPasswordOrChallenge({page,signal,account,...gateContext,timeoutMs:40000,maxSolves:2});
        if(retry.status==='password'){
          await ensureUsername(page,usernameCandidates,account.username);
          passwordFilled=await fillFirst(passwordCandidates,account.password);
        }else{
          return challengeFailure('before password entry',retry.reason||retry.status);
        }
      }else{
        return challengeFailure('before password entry',gate.reason||gate.status);
      }
    }
  }
  if(!passwordFilled) return challengeFailure('before password entry','Spotify password field was not available after the identifier step');

  const submitted=await waitClickFirst(page,[
    page.getByRole?.('button',{name:/^(log in|login|sign in)$/i}),
    page.locator?.('button[type="submit"],input[type="submit"]'),
  ].filter(Boolean),{attempts:16});
  if(!submitted) return {status:'WARNING',reason:'Spotify login button was not available'};

  let lastVerification={status:'WARNING',reason:'Spotify login is still settling'};
  let solvesUsed=0;
  for(let i=0;i<40;i++){
    if(signal?.aborted) return {status:'WARNING',transient:true,reason:'Spotify login was cancelled'};

    if(await challengeShape(page)){
      const gate=await clearLoginChallenge({page,signal,account,...gateContext,maxSolves:solvesUsed<MAX_CHALLENGE_SOLVES?1:0});
      if(gate.cleared){
        if(solvesUsed<MAX_CHALLENGE_SOLVES)solvesUsed++;
        continue;
      }
      return challengeFailure('after the credential submit',gate.reason);
    }

    lastVerification=await spotifyVerifySession({page,account,signal});
    if(lastVerification?.transient) return spotifyManualLoginFallback(page,'Spotify returned a temporary login error after automated credential submission.');
    if(lastVerification?.status==='NEEDS_VERIFICATION') return lastVerification;
    const currentUrl=safeUrl(page);
    if(lastVerification?.status==='PASS' && !/accounts\.spotify\.com.*\/login/i.test(currentUrl)) return {status:'PASS',reason:'Spotify credentials authenticated'};
    if(i<39) await waitStep(page);
  }
  const currentUrl=safeUrl(page);
  if(/accounts\.spotify\.com.*\/login/i.test(currentUrl)) return {status:'WARNING',reason:'Spotify login did not complete; the account is still on the login page'};
  return {status:'WARNING',reason:lastVerification.reason||'Spotify login did not reach an authenticated session'};
}

module.exports={...base,resolveCatalog:resolveSpotifyCatalog,locateTrack:locateSpotifyTrack,authenticate:authenticateSpotify,verifySession:spotifyVerifySession,playbackControls:spotifyPlaybackControls,activeTrackMatches:spotifyActiveTrackMatches,_test:{readSpotifyLinks,readSpotifyTextTracks,parseSpotifyEmbedTrackText,collectReleaseUrls,extractTracksFromCurrentPage,spotifyIdFromUrl,embedUrl,expandSpotifyDiscography,locateSpotifyTrack,resolveSpotifySearchTrackHref,challengeShape,clearLoginChallenge,awaitPasswordOrChallenge,attemptRecaptchaSolve,attemptInvisibleSolve,clickRecaptchaCheckbox,executeInvisibleRecaptcha,recaptchaSolved,diagnoseChallengePage,playerReady,spotifyActiveTrackMatches,spotifyVerifySession}};