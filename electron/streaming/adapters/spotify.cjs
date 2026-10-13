const { makeAdapter, warmCatalogPage } = require('./_factory.cjs');
const {clickWithInteractionIndicator}=require('../../interaction-indicator.cjs');

const base = makeAdapter({id:'spotify',label:'Spotify',hosts:['spotify.com']});
const SPOTIFY_HOME = 'https://open.spotify.com/';
const SPOTIFY_LOGIN = 'https://accounts.spotify.com/en/login';

function firstOf(value){ return value?.first ? value.first() : value; }
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
      const currentUrl=String(page.url?.()||'');
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
    if(page.url?.()!==original) await safeGoto(page,original);
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
async function verifyStableSpotifySession(page,account){
  let last={status:'WARNING',reason:'Spotify session is still settling'};
  let consecutivePasses=0;
  for(let attempt=0;attempt<12;attempt++){
    last=await base.verifySession({page,account});
    const onAccounts=/accounts\.spotify\.com/i.test(String(page.url?.()||''));
    if(last?.status==='NEEDS_VERIFICATION'||last?.status==='FAILED')return last;
    if(last?.status==='PASS'&&!onAccounts){
      consecutivePasses++;
      if(consecutivePasses>=2)return last;
    }else{
      consecutivePasses=0;
      if(onAccounts||!last?.transient)return last;
    }
    if(attempt<11){try{await page.waitForTimeout?.(400);}catch{await waitStep(page);}}
  }
  return last;
}
async function hasChallenge(page){
  const strongCandidates=[/verify (?:that )?you(?:'re| are)? (?:a )?human/i,/security check/i,/two[- ]factor/i,/2[- ]step verification/i,/verify it(?:'s| is) you/i,/complete (?:the )?captcha/i,/solve (?:the )?captcha/i,/captcha required/i,/i(?:'m| am) not a robot/i];
  for(const pattern of strongCandidates){
    try{if(await visible(page.getByText?.(pattern))) return true;}catch{}
  }
  for(const selector of ['iframe[src*="recaptcha" i]','iframe[src*="hcaptcha" i]','.g-recaptcha','.h-captcha','[data-testid*="captcha" i]']){
    try{
      const candidate=page.locator?.(selector);
      if(candidate && typeof candidate.count==='function' && await candidate.count()>0 && await visible(candidate)) return true;
    }catch{}
  }
  let codeOfferVisible=false;
  for(const pattern of [/verification code/i,/check your email/i,/enter (?:the )?code/i]){
    try{if(await visible(page.getByText?.(pattern))){codeOfferVisible=true;break;}}catch{}
  }
  if(codeOfferVisible){
    for(const selector of ['input[autocomplete="one-time-code"]','input[name*="code" i]','input[inputmode="numeric"]']){
      try{if(await visible(page.locator?.(selector))) return true;}catch{}
    }
  }
  return false;
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

async function authenticateSpotify({page,account={}}){
  if(!page) return {status:'NOT_APPLICABLE',reason:'No browser page'};

  // Imported cookies are installed by the browser factory before this step. Try them first.
  if(account.sessionSecret){
    const homeNavigation=await safeGoto(page,SPOTIFY_HOME);
    if(homeNavigation.ok){
      const existing=await verifyStableSpotifySession(page,account);
      if(existing?.status==='PASS' && !/accounts\.spotify\.com/i.test(String(page.url?.()||''))) return {status:'PASS',reason:'Authorized Spotify session restored'};
    }
  }

  if(account.authMode==='oauth') return {status:'WARNING',reason:'OAuth requires an already-authorized imported session in this build'};
  if(!account.username || !account.password) return {status:'WARNING',reason:'Spotify credential login requires both username/email and password'};

  const loginNavigation=await safeGoto(page,SPOTIFY_LOGIN);
  if(!loginNavigation.ok) return {status:'WARNING',reason:`Spotify login page could not be opened: ${loginNavigation.reason}`};
  if(await hasChallenge(page)) return {status:'WARNING',reason:'Spotify requires manual verification before login can continue'};
  const initialVerification=await base.verifySession({page,account});
  if(initialVerification?.transient) return spotifyManualLoginFallback(page,'Spotify returned a temporary login error before credential entry.');

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

  let passwordFilled=await waitFillFirst(page,passwordCandidates,account.password,{attempts:5});
  if(!passwordFilled&&await clickPasswordRoute(page)){
    if(await hasChallenge(page)) return {status:'WARNING',reason:'Spotify requires manual verification before password entry'};
    passwordFilled=await waitFillFirst(page,passwordCandidates,account.password,{attempts:32});
  }
  if(!passwordFilled){
    await waitClickFirst(page,[
      page.getByRole?.('button',{name:/continue|next/i}),
      page.locator?.('button[type="submit"]'),
    ].filter(Boolean),{attempts:16});
    if(await hasChallenge(page)) return {status:'WARNING',reason:'Spotify requires manual verification before password entry'};
    passwordFilled=await waitFillFirst(page,passwordCandidates,account.password,{attempts:8});
    if(!passwordFilled&&await clickPasswordRoute(page)){
      if(await hasChallenge(page)) return {status:'WARNING',reason:'Spotify requires manual verification before password entry'};
      passwordFilled=await waitFillFirst(page,passwordCandidates,account.password,{attempts:32});
    }else if(!passwordFilled){
      passwordFilled=await waitFillFirst(page,passwordCandidates,account.password,{attempts:24});
    }
  }
  if(!passwordFilled) return {status:'WARNING',reason:'Spotify password field was not available after the identifier step'};

  const submitted=await waitClickFirst(page,[
    page.getByRole?.('button',{name:/^(log in|login|sign in)$/i}),
    page.locator?.('button[type="submit"],input[type="submit"]'),
  ].filter(Boolean),{attempts:16});
  if(!submitted) return {status:'WARNING',reason:'Spotify login button was not available'};

  let lastVerification={status:'WARNING',reason:'Spotify login is still settling'};
  for(let i=0;i<40;i++){
    if(await hasChallenge(page)) return {status:'WARNING',reason:'Spotify requires CAPTCHA/MFA/manual verification; OrbitQA will not bypass it'};
    lastVerification=await base.verifySession({page,account});
    if(lastVerification?.transient) return spotifyManualLoginFallback(page,'Spotify returned a temporary login error after automated credential submission.');
    if(lastVerification?.status==='NEEDS_VERIFICATION') return lastVerification;
    const currentUrl=String(page.url?.()||'');
    if(lastVerification?.status==='PASS' && !/accounts\.spotify\.com.*\/login/i.test(currentUrl)) return {status:'PASS',reason:'Spotify credentials authenticated'};
    if(i<39) await waitStep(page);
  }
  const currentUrl=String(page.url?.()||'');
  if(/accounts\.spotify\.com.*\/login/i.test(currentUrl)) return {status:'WARNING',reason:'Spotify login did not complete; the account is still on the login page'};
  return {status:'WARNING',reason:lastVerification.reason||'Spotify login did not reach an authenticated session'};
}

module.exports={...base,resolveCatalog:resolveSpotifyCatalog,locateTrack:locateSpotifyTrack,authenticate:authenticateSpotify,_test:{readSpotifyLinks,readSpotifyTextTracks,parseSpotifyEmbedTrackText,collectReleaseUrls,extractTracksFromCurrentPage,spotifyIdFromUrl,embedUrl,expandSpotifyDiscography,locateSpotifyTrack,resolveSpotifySearchTrackHref}};
