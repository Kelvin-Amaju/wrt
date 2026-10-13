const {canonicalTrackUrlKey}=require('../playback-planner.cjs');
const {createBlockingSurfaceResolver}=require('../../blocking-surface-resolver.cjs');
const {clickWithInteractionIndicator}=require('../../interaction-indicator.cjs');
const {waitBeforePageInteraction}=require('../../mandatory-interaction-delay.cjs');
const {authenticatePlatformAccount,verifyPlatformSession,getPlatformAuthConfig}=require('./_auth.cjs');
const {fetchPublicCatalog,buildYouTubeArtistFallbackUrl,buildYouTubeFeedUrl,buildYouTubeChannelFeedUrl,parseYouTubeChannelFeed,tryYouTubeFeedCatalog,normalizePublicCatalogResponse}=require('../service-catalog-resolver.cjs');
function classifyInputGeneric(input='') {
  const text=String(input).trim();
  if (!/^https?:\/\//i.test(text)) return 'search';
  const low=text.toLowerCase();
  if (/\/track\//.test(low) || /\/song\//.test(low) || /\/watch(?:\?|\/)/.test(low) || /\/shorts\//.test(low)) return 'track';
  if (/\/album\//.test(low)) return 'album';
  if (/\/playlist\//.test(low) || /\/sets\//.test(low) || /[?&]list=/.test(low)) return 'playlist';
  if (/\/artist\//.test(low) || /\/channel\//.test(low) || /\/@[^/]+/.test(low)) return 'artist';
  return 'search';
}
function classifyInputForPlatform(id,input=''){
  const generic=classifyInputGeneric(input);
  if(!/^https?:\/\//i.test(String(input||''))) return generic;
  let url; try{url=new URL(String(input));}catch{return generic;}
  if(id==='soundcloud'){
    if(!hostMatches(url.hostname,['soundcloud.com'])) return generic;
    const parts=url.pathname.split('/').filter(Boolean);
    if(parts.length>=3 && parts[1].toLowerCase()==='sets') return 'playlist';
    if(parts.length===2) return 'track';
    if(parts.length===1) return 'artist';
    return generic;
  }
  if(id==='pandora'&&hostMatches(url.hostname,['pandora.com'])){
    if(isTrackLikeUrl('pandora',url.toString())) return 'track';
    if(/\/album\//i.test(url.pathname)) return 'album';
    if(/\/playlist\//i.test(url.pathname)) return 'playlist';
  }
  return generic;
}

function makeSearchUrl(id, query) {
  const q=encodeURIComponent(String(query||'').trim());
  if(id==='spotify') return `https://open.spotify.com/search/${q}`;
  if(id==='apple-music') return `https://music.apple.com/us/search?term=${q}`;
  if(id==='youtube-music') return `https://music.youtube.com/search?q=${q}`;
  if(id==='soundcloud') return `https://soundcloud.com/search?q=${q}`;
  if(id==='deezer') return `https://www.deezer.com/search/${q}`;
  if(id==='tidal') return `https://listen.tidal.com/search?q=${q}`;
  if(id==='audiomack') return `https://audiomack.com/search?q=${q}`;
  if(id==='pandora') return `https://www.pandora.com/search/${q}`;
  return '';
}

async function warmCatalogPage(page, kind) {
  if (!page?.evaluate || !['artist','album','playlist','search'].includes(kind)) return;
  for (const ratio of [0.45, 0.8, 1]) {
    await page.evaluate((r) => { const max=Math.max(0,document.documentElement.scrollHeight-window.innerHeight); window.scrollTo({top:max*r,behavior:'auto'}); }, ratio).catch(()=>undefined);
    try { await page.waitForTimeout?.(250); } catch { /* catalog warm-up is best effort */ }
  }
  await page.evaluate(() => window.scrollTo({top:0,behavior:'auto'})).catch(()=>undefined);
}

async function expandCatalogPage(page,id){
  if(id!=='audiomack'||!page?.getByRole) return;
  for(let attempt=0;attempt<20;attempt++){
    try{
      const locator=page.getByRole('button',{name:/load more tracks/i});
      const button=locator?.first?.()||locator;
      if(!button||!(await button.isVisible?.())) break;
      await clickWithInteractionIndicator(page,button,{timeout:3000});
      await page.waitForTimeout?.(250);
    }catch{break;}
  }
}

function hostMatches(hostname,expected=[]){
  const host=String(hostname||'').toLowerCase();
  return expected.some(value=>host===String(value).toLowerCase()||host.endsWith(`.${String(value).toLowerCase()}`));
}
function isTrackLikeUrl(id,rawUrl){
  let url; try{url=new URL(String(rawUrl||''));}catch{return false;}
  const path=url.pathname.toLowerCase();
  if(id==='spotify') return hostMatches(url.hostname,['spotify.com']) && /\/track\/[a-z0-9]+/i.test(path);
  if(id==='apple-music') return hostMatches(url.hostname,['music.apple.com']) && (/\/song\//i.test(path)||(/\/album\//i.test(path)&&Boolean(url.searchParams.get('i'))));
  if(id==='youtube-music') return (hostMatches(url.hostname,['youtube.com'])||hostMatches(url.hostname,['youtu.be'])) && ((path==='/watch'&&Boolean(url.searchParams.get('v')))||hostMatches(url.hostname,['youtu.be']));
  if(id==='soundcloud'){
    if(!hostMatches(url.hostname,['soundcloud.com'])) return false;
    const parts=path.split('/').filter(Boolean);
    const blocked=new Set(['discover','stream','you','search','charts','stations','upload','settings']);
    return parts.length===2 && !blocked.has(parts[0]);
  }
  if(id==='deezer') return hostMatches(url.hostname,['deezer.com']) && /\/track\/\d+/i.test(path);
  if(id==='tidal') return hostMatches(url.hostname,['tidal.com']) && /\/track\/\d+/i.test(path);
  if(id==='audiomack') return hostMatches(url.hostname,['audiomack.com']) && /\/song\/[^/]+/i.test(path);
  if(id==='pandora') return hostMatches(url.hostname,['pandora.com']) && (/\/(track|song)\//i.test(path)||(/\/artist\//i.test(path)&&/\/tr[a-z0-9]+\/?$/i.test(path)));
  return /\/(track|song)\//i.test(path)||(path==='/watch'&&Boolean(url.searchParams.get('v')));
}


function textFromRuns(value){
  if(!value) return '';
  if(typeof value==='string') return value.trim();
  if(typeof value.simpleText==='string') return value.simpleText.trim();
  if(Array.isArray(value.runs)) return value.runs.map(row=>String(row?.text||'')).join('').trim();
  return '';
}
function titleFromObject(obj={}){
  for(const candidate of [obj.title,obj.name,obj.trackTitle,obj.songTitle,obj.attributes?.title,obj.attributes?.name]){
    const text=textFromRuns(candidate); if(text) return text;
  }
  const columns=obj.flexColumns||obj.musicResponsiveListItemRenderer?.flexColumns;
  if(Array.isArray(columns)){
    for(const col of columns){
      const text=textFromRuns(col?.musicResponsiveListItemFlexColumnRenderer?.text||col?.text);
      if(text) return text;
    }
  }
  return '';
}
function artistFromObject(obj={}){
  const direct=obj.artist_name||obj.artistName||obj.user?.username||obj.artist?.name||obj.attributes?.artistName;
  if(direct) return String(direct);
  if(Array.isArray(obj.artists)) return obj.artists.map(a=>String(a?.name||'')).filter(Boolean).join(', ');
  if(Array.isArray(obj.attributes?.artists)) return obj.attributes.artists.map(a=>String(a?.name||'')).filter(Boolean).join(', ');
  return undefined;
}
function dedupeTracks(rows=[]){
  const out=[]; const seen=new Set();
  for(const row of rows){
    if(!row?.url) continue;
    const key=String(row.url); if(seen.has(key)) continue; seen.add(key);
    out.push({id:String(row.id||row.url),title:String(row.title||'Untitled track').trim().slice(0,180)||'Untitled track',...(row.artist?{artist:String(row.artist)}:{}),...(row.album?{album:String(row.album)}:{}),url:String(row.url)});
  }
  return out;
}
function walkJson(value,visit,seen=new Set(),depth=0){
  if(value==null||depth>18) return;
  if(typeof value==='string'){visit(value,null);return;}
  if(typeof value!=='object'||seen.has(value)) return;
  seen.add(value); visit(value,value);
  if(Array.isArray(value)){for(const item of value) walkJson(item,visit,seen,depth+1);return;}
  for(const child of Object.values(value)) walkJson(child,visit,seen,depth+1);
}
function extractTracksFromSnapshot(id,snapshot={},input=''){
  const source=String(input||'').trim();
  if(isTrackLikeUrl(id,source)) return [{id:source,title:String(snapshot.title||`${id} track`).replace(/\s*[|\-–—]\s*(YouTube Music|SoundCloud|Deezer|TIDAL|Audiomack|Pandora).*$/i,'').trim().slice(0,180)||`${id} track`,url:source}];
  const rows=[];
  const push=(row)=>{if(row?.url&&isTrackLikeUrl(id,row.url)) rows.push(row);};
  for(const link of snapshot.links||[]){
    const href=String(link?.href||link?.url||'');
    push({id:href,title:String(link?.text||link?.ariaLabel||link?.title||'').trim()||`${id} track`,url:href});
  }
  const visit=(value,obj)=>{
    if(typeof value==='string'){
      if(/^https?:\/\//i.test(value)) push({id:value,title:`${id} track`,url:value});
      return;
    }
    if(!obj) return;
    const title=titleFromObject(obj);
    const artist=artistFromObject(obj);
    if(id==='youtube-music'){
      const videoId=obj.videoId||obj.playlistItemData?.videoId||obj.navigationEndpoint?.watchEndpoint?.videoId||obj.watchEndpoint?.videoId;
      if(videoId) push({id:String(videoId),title:title||'YouTube Music track',artist,url:`https://music.youtube.com/watch?v=${encodeURIComponent(String(videoId))}`});
      return;
    }
    if(id==='soundcloud'){
      const url=obj.permalink_url||obj.permalinkUrl||obj.uri;
      if(url&&/^https?:\/\//i.test(String(url))) push({id:obj.id||url,title:title||'SoundCloud track',artist,url:String(url)});
      return;
    }
    if(id==='deezer'){
      const url=obj.link||obj.url;
      if(url&&isTrackLikeUrl(id,url)) push({id:obj.id||url,title:title||'Deezer track',artist,url:String(url)});
      else if(obj.id&&title&&(String(obj.type||obj.__typename||'').toLowerCase().includes('track')||obj.duration||obj.durationSeconds)) push({id:String(obj.id),title,artist,url:`https://www.deezer.com/track/${obj.id}`});
      return;
    }
    if(id==='tidal'){
      const target=String(obj.type||obj.__typename||obj.mediaType||'').toLowerCase();
      const item=(target==='track'||target==='tracks')&&obj.item&&typeof obj.item==='object'?obj.item:obj;
      const attrs=item.attributes&&typeof item.attributes==='object'?item.attributes:{};
      const itemTitle=attrs.title||titleFromObject(item)||title;
      const itemArtist=artistFromObject(item)||artist;
      const url=item.url||item.shareUrl||item.externalUrl;
      if(url&&isTrackLikeUrl(id,url)) push({id:item.id||url,title:itemTitle||'TIDAL track',artist:itemArtist,url:String(url)});
      else if(item.id&&itemTitle&&(target==='track'||target==='tracks'||String(item.type||item.__typename||'').toLowerCase().includes('track')||Array.isArray(item.artists)||Array.isArray(attrs.artists))) push({id:String(item.id),title:itemTitle,artist:itemArtist,url:`https://tidal.com/track/${item.id}`});
      return;
    }
    if(id==='audiomack'){
      const url=obj.url||obj.permalink_url||obj.permalinkUrl||obj.share_url||obj.shareUrl;
      if(url&&isTrackLikeUrl(id,url)) push({id:obj.id||url,title:title||'Audiomack track',artist,url:String(url)});
      else if(obj.url_slug&&obj.uploader_url_slug&&title) push({id:obj.id||obj.url_slug,title,artist,url:`https://audiomack.com/${obj.uploader_url_slug}/song/${obj.url_slug}`});
      return;
    }
    if(id==='pandora'){
      const url=obj.url||obj.shareUrl||obj.share_url||obj.webUrl;
      if(url&&isTrackLikeUrl(id,url)) push({id:obj.id||obj.token||url,title:title||'Pandora track',artist,url:String(url)});
    }
  };
  for(const blob of snapshot.json||[]) walkJson(blob,visit);
  return dedupeTracks(rows).slice(0,500);
}

function createCatalogResponseCapture(page,{limit=100,maxBytes=6_000_000}={}){
  const json=[];
  if(!page?.on) return {json,stop(){}};
  const handler=async(response)=>{
    try{
      const headers=await response.allHeaders?.()||response.headers?.()||{};
      const type=String(headers['content-type']||headers['Content-Type']||'').toLowerCase();
      const responseUrl=String(response.url?.()||'');
      let knownCatalogResponse=false;
      try{
        const parsed=new URL(responseUrl); const host=parsed.hostname.toLowerCase(); const path=parsed.pathname.toLowerCase();
        const musicHost=['youtube.com','music.youtube.com','music.apple.com','deezer.com','tidal.com','audiomack.com','pandora.com','soundcloud.com'].some(value=>host===value||host.endsWith(`.${value}`));
        knownCatalogResponse=musicHost && /(youtubei|\/api(?:\/|$)|\/v\d+(?:\/|$)|graphql|_next\/data|browse|catalog)/i.test(path);
      }catch{}
      if(!type.includes('json')&&!type.includes('+json')&&!knownCatalogResponse) return;
      const length=Number(headers['content-length']||headers['Content-Length']||0);
      if(Number.isFinite(length)&&length>maxBytes) return;
      const data=await response.json?.();
      if(data&&typeof data==='object'&&json.length<limit) json.push(data);
    }catch{}
  };
  page.on('response',handler);
  return {json,stop(){try{page.off?.('response',handler);}catch{}}};
}

function catalogBlockReason(id,snapshot={}){
  const text=`${snapshot.title||''}\n${snapshot.bodyText||''}`.toLowerCase();
  if(id==='pandora' && /(unavailable in this country|unavailable in your country|unavailable in this region|country or region|\/restricted)/i.test(text)) return 'Pandora is unavailable in this country or region for the current catalog connection. A supported-region connection is required for Pandora collection pages.';
  if(id==='youtube-music' && /(before you continue to youtube|accept all.*reject all|reject all.*accept all|cookie consent)/i.test(text)) return 'YouTube Music is showing a cookie/consent page instead of the music catalog. OrbitQA could not dismiss the consent page automatically.';
  if(/access denied|temporarily blocked|unusual traffic|verify you are human|captcha/i.test(text)) return 'The music service returned an access/challenge page instead of the track catalog.';
  return null;
}

async function dismissCatalogConsent(page,id){
  if(id!=='youtube-music'||!page?.getByRole) return false;
  for(const name of [/^reject all$/i,/reject all/i,/^accept all$/i]){
    try{
      const locator=page.getByRole('button',{name});
      const button=locator?.first?.()||locator;
      if(button&&await button.isVisible?.()){
        await clickWithInteractionIndicator(page,button,{timeout:3000});
        await page.waitForTimeout?.(400);
        return true;
      }
    }catch{}
  }
  return false;
}

async function snapshotCatalogPage(page){
  if(!page?.evaluate) return {title:'',links:[],json:[]};
  return await page.evaluate(()=>{
    const links=[];
    for(const a of document.querySelectorAll('a[href]')){
      links.push({href:a.href,text:String(a.textContent||'').trim().replace(/\s+/g,' '),ariaLabel:a.getAttribute('aria-label')||'',title:a.getAttribute('title')||''});
      if(links.length>=2500) break;
    }
    const json=[];
    const push=(value)=>{if(value&&json.length<80) json.push(value);};
    for(const script of document.querySelectorAll('script')){
      const text=String(script.textContent||'').trim();
      if(!text||text.length>4_000_000) continue;
      const type=String(script.type||'').toLowerCase();
      if(type.includes('json')||text.startsWith('{')||text.startsWith('[')){
        try{push(JSON.parse(text));continue;}catch{}
      }
      for(const marker of ['ytInitialData','__NEXT_DATA__','__sc_hydration__','__DZR_APP_STATE__','__APOLLO_STATE__','__PRELOADED_STATE__','__INITIAL_STATE__','__NUXT__']){
        const idx=text.indexOf(marker); if(idx<0) continue;
        const startCandidates=[text.indexOf('{',idx),text.indexOf('[',idx)].filter(v=>v>=0).sort((a,b)=>a-b);
        const start=startCandidates[0]; if(start<0) continue;
        const open=text[start],close=open==='{'?'}':']'; let depth=0,quoted=false,escape=false;
        for(let i=start;i<text.length;i++){
          const ch=text[i];
          if(quoted){if(escape){escape=false;continue;} if(ch==='\\'){escape=true;continue;} if(ch==='"')quoted=false; continue;}
          if(ch==='"'){quoted=true;continue;} if(ch===open)depth++; else if(ch===close){depth--; if(depth===0){try{push(JSON.parse(text.slice(start,i+1)));}catch{} break;}}
        }
      }
    }
    for(const key of ['ytInitialData','__NEXT_DATA__','__sc_hydration__','__DZR_APP_STATE__','__APOLLO_STATE__','__PRELOADED_STATE__','__INITIAL_STATE__','__NUXT__']){try{push(window[key]);}catch{}}
    const bodyText=String(document.body?.innerText||'').replace(/\s+/g,' ').trim().slice(0,20000);
    return {title:String(document.title||''),bodyText,links,json};
  });
}

const PRIMARY_PLAY_SELECTORS={
  spotify:['button[data-testid="control-button-playpause"]','button[data-testid="play-button"]'],
  'apple-music':['button[aria-label*="play" i]','button[data-testid*="play" i]'],
  'youtube-music':['#play-pause-button','tp-yt-paper-icon-button#play-pause-button','ytmusic-play-button-renderer button'],
  soundcloud:['.playControl','button.playControl'],
  deezer:['button[data-testid*="play" i]','button[aria-label*="play" i]'],
  tidal:['button[data-test*="play" i]','button[data-testid*="play" i]','button[aria-label*="play" i]'],
  audiomack:['button[aria-label*="play" i]','button[data-testid*="play" i]'],
  pandora:['button[data-qa*="play" i]','button[aria-label*="play" i]'],
};
const PRIMARY_PAUSE_SELECTORS={
  spotify:['button[data-testid="control-button-playpause"][aria-label*="pause" i]','button[aria-label*="pause" i]'],
  'apple-music':['button[aria-label*="pause" i]','button[data-testid*="pause" i]'],
  'youtube-music':['#play-pause-button[title*="pause" i]','#play-pause-button[aria-label*="pause" i]'],
  soundcloud:['.playControl.playing','button[aria-label*="pause" i]'],
  deezer:['button[data-testid*="pause" i]','button[aria-label*="pause" i]'],
  tidal:['button[data-test*="pause" i]','button[data-testid*="pause" i]','button[aria-label*="pause" i]'],
  audiomack:['button[aria-label*="pause" i]','button[data-testid*="pause" i]'],
  pandora:['button[data-qa*="pause" i]','button[aria-label*="pause" i]'],
};
const PRIMARY_NEXT_SELECTORS={
  spotify:['button[data-testid="control-button-skip-forward"]'],
  'apple-music':['button[aria-label*="next" i]','button[aria-label*="skip forward" i]'],
  'youtube-music':['.next-button','#next-button','tp-yt-paper-icon-button.next-button'],
  soundcloud:['.skipControl__next','button[aria-label*="next" i]'],
  deezer:['button[data-testid*="next" i]','button[aria-label*="next" i]'],
  tidal:['button[data-test*="next" i]','button[data-testid*="next" i]','button[aria-label*="next" i]'],
  audiomack:['button[aria-label*="next" i]','button[data-testid*="next" i]'],
  pandora:['button[data-qa*="skip" i]','button[aria-label*="next" i]','button[aria-label*="skip" i]'],
};
const FAVORITE_TRACK_SELECTORS={
 spotify:['button[data-testid="add-button"]','button[aria-label*="Save to Your Liked Songs" i]','button[aria-label*="Add to Liked Songs" i]'],
 'apple-music':['button[aria-label*="Favorite" i]','button[aria-label*="Love" i]','button[aria-label*="Add to Library" i]'],
 'youtube-music':['button[aria-label*="like" i]:not([aria-label*="dislike" i])','tp-yt-paper-icon-button[aria-label*="like" i]'],
 soundcloud:['button.sc-button-like','.sc-button-like'],deezer:['button[aria-label*="favorite" i]','button[data-testid*="favorite" i]'],
 tidal:['button[aria-label*="favorite" i]','button[data-test*="favorite" i]','button[data-testid*="favorite" i]'],
 audiomack:['button[aria-label*="favorite" i]','button[aria-label*="like" i]'],pandora:['button[aria-label*="thumbs up" i]','button[data-qa*="thumb" i]']};
const FAVORITED_TRACK_SELECTORS={
 spotify:['button[data-testid="remove-button"]','button[aria-label*="Remove from Your Liked Songs" i]'],
 'apple-music':['button[aria-pressed="true"][aria-label*="Favorite" i]','button[aria-label*="Unfavorite" i]','button[aria-label*="Remove from Library" i]'],
 'youtube-music':['button[aria-pressed="true"][aria-label*="like" i]'],soundcloud:['.sc-button-like.sc-button-selected'],
 deezer:['button[aria-pressed="true"][aria-label*="favorite" i]'],tidal:['button[aria-pressed="true"][aria-label*="favorite" i]'],
 audiomack:['button[aria-pressed="true"][aria-label*="like" i]'],pandora:['button[aria-pressed="true"][aria-label*="thumbs up" i]']};
const FOLLOW_ARTIST_SELECTORS={
 spotify:['button[aria-label*="Follow" i]'], 'apple-music':['button[aria-label*="Favorite Artist" i]','button[aria-label*="Follow" i]'],
 'youtube-music':['button[aria-label*="Subscribe" i]'],soundcloud:['button.sc-button-follow','.sc-button-follow'],deezer:['button[aria-label*="follow" i]'],
 tidal:['button[aria-label*="follow" i]'],audiomack:['button[aria-label*="follow" i]'],pandora:['button[aria-label*="follow" i]']};
const FOLLOWED_ARTIST_SELECTORS={
 spotify:['button[aria-label*="Unfollow" i]'], 'apple-music':['button[aria-label*="Unfavorite Artist" i]','button[aria-label*="Unfollow" i]'],
 'youtube-music':['button[aria-label*="Unsubscribe" i]'],soundcloud:['button.sc-button-follow.sc-button-selected','.sc-button-follow.sc-button-selected'],
 deezer:['button[aria-pressed="true"][aria-label*="follow" i]'],tidal:['button[aria-pressed="true"][aria-label*="follow" i]'],
 audiomack:['button[aria-pressed="true"][aria-label*="follow" i]'],pandora:['button[aria-pressed="true"][aria-label*="follow" i]']};
function firstLocator(locator){try{return locator?.first?.()||locator;}catch{return locator;}}
async function locatorItems(locator,{limit=40}={}){
  if(!locator)return [];
  try{
    if(typeof locator.count==='function'&&typeof locator.nth==='function'){
      const count=Math.min(Math.max(0,Number(await locator.count())||0),limit);
      if(count>0)return Array.from({length:count},(_,index)=>locator.nth(index));
    }
  }catch{}
  const first=firstLocator(locator);
  return first?[first]:[];
}
async function itemVisible(item){try{return Boolean(item&&await item.isVisible?.());}catch{return false;}}
async function itemEnabled(item){
  if(!item)return false;
  try{if(typeof item.isEnabled==='function')return Boolean(await item.isEnabled());}catch{return false;}
  try{if(typeof item.isDisabled==='function')return !Boolean(await item.isDisabled());}catch{return false;}
  return true;
}
async function firstVisibleLocator(locator,{requireEnabled=false}={}){
  for(const item of await locatorItems(locator)){
    if(!await itemVisible(item))continue;
    if(requireEnabled&&!await itemEnabled(item))continue;
    return item;
  }
  return null;
}
async function locatorVisible(locator,{requireEnabled=false}={}){return Boolean(await firstVisibleLocator(locator,{requireEnabled}));}
async function clickVisibleLocator(page,locator){const item=await firstVisibleLocator(locator,{requireEnabled:true});if(!item)return false;try{await clickWithInteractionIndicator(page,item,{timeout:4000});return true;}catch{return false;}}
async function firstVisibleSelector(page,selectors=[],options={}){for(const selector of selectors){const item=await firstVisibleLocator(page?.locator?.(selector),options);if(item)return item;}return null;}
function escapeRegex(value=''){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function trackControlPattern(track,mode='play'){
  const title=String(track?.title||'').trim();
  if(!title)return null;
  const verb=mode==='pause'?'pause':'(?:play|resume)';
  const escaped=escapeRegex(title);
  return new RegExp(`(?:${verb}).*${escaped}|${escaped}.*(?:${verb})`,'i');
}
async function markSpotifyTrackControl(page,track,mode='play'){
  const title=String(track?.title||'').trim();
  if(!title||!page?.evaluate||!page?.locator)return null;
  const attr=mode==='pause'?'data-orbitqa-selected-track-pause':'data-orbitqa-selected-track-play';
  let marked=false;
  try{
    marked=Boolean(await page.evaluate(({title,artist,mode,attr})=>{
      const norm=value=>String(value||'').replace(/\s+/g,' ').trim().toLowerCase();
      const wantedTitle=norm(title),wantedArtist=norm(artist);
      for(const old of document.querySelectorAll(`[${attr}]`))old.removeAttribute(attr);
      const nodes=[...document.querySelectorAll('a,span,div,h1,h2,h3,h4,p')].filter(el=>norm(el.textContent)===wantedTitle);
      const matchesButton=button=>{
        const meta=norm([button.getAttribute('aria-label'),button.getAttribute('title'),button.getAttribute('data-testid'),button.getAttribute('data-test'),button.textContent].filter(Boolean).join(' '));
        return mode==='pause'?/\bpause\b/.test(meta):/\b(play|resume)\b/.test(meta);
      };
      for(const start of nodes){
        let node=start;
        for(let depth=0;node&&depth<9;depth++,node=node.parentElement){
          const containerText=norm(node.textContent);
          if(wantedArtist&&depth>1&&!containerText.includes(wantedArtist))continue;
          const buttons=[...node.querySelectorAll('button,[role="button"]')];
          const button=buttons.find(matchesButton);
          if(button){button.setAttribute(attr,'true');return true;}
        }
      }
      return false;
    },{title,artist:String(track?.artist||''),mode,attr}));
  }catch{}
  if(!marked)return null;
  return firstVisibleLocator(page.locator(`[${attr}="true"]`),{requireEnabled:true});
}
async function trackScopedControl(page,id,track,mode='play'){
  const pattern=trackControlPattern(track,mode);
  if(pattern&&page?.getByRole){
    const role=await firstVisibleLocator(page.getByRole('button',{name:pattern}),{requireEnabled:true});
    if(role)return role;
  }
  if(id==='spotify')return markSpotifyTrackControl(page,track,mode);
  return null;
}
async function spotifyNowPlayingMatches(page,track){
  const title=String(track?.title||'').trim();
  const targetUrl=String(track?.url||'').trim();
  const targetId=(targetUrl.match(/\/track\/([A-Za-z0-9]+)/i)||[])[1]||'';
  if((!title&&!targetId)||!page?.evaluate)return false;
  try{return Boolean(await page.evaluate(({title,artist,targetId})=>{
    const norm=value=>String(value||'').replace(/\s+/g,' ').trim().toLowerCase();
    const wantedTitle=norm(title),wantedArtist=norm(artist);
    const idFromHref=href=>{const match=String(href||'').match(/\/track\/([A-Za-z0-9]+)/i);return match?match[1]:'';};
    const nowPlayingRoots=[
      ...document.querySelectorAll('[data-testid="now-playing-widget"],[data-testid*="now-playing" i]'),
      ...document.querySelectorAll('footer')
    ];
    for(const root of nowPlayingRoots){
      if(targetId){
        for(const link of root.querySelectorAll?.('a[href*="/track/"]')||[]){
          if(idFromHref(link.getAttribute('href'))===targetId)return true;
        }
      }
      const text=norm(root.textContent||root.getAttribute?.('aria-label')||root.getAttribute?.('title'));
      if(wantedTitle&&text.includes(wantedTitle)&&(!wantedArtist||text.includes(wantedArtist)))return true;
    }
    const selectors=['[data-testid="context-item-info-title"]','[data-testid="context-item-link"]'];
    for(const selector of selectors){
      for(const el of document.querySelectorAll(selector)){
        if(targetId&&idFromHref(el.getAttribute('href'))===targetId)return true;
        const text=norm(el.textContent||el.getAttribute('aria-label')||el.getAttribute('title'));
        if(wantedTitle&&text.includes(wantedTitle)&&(!wantedArtist||text.includes(wantedArtist)||selector.includes('title')))return true;
      }
    }
    return false;
  },{title,artist:String(track?.artist||''),targetId}));}catch{return false;}
}
async function mediaElementIsPlaying(page){
  try{return Boolean(await page?.evaluate?.(()=>Array.from(document.querySelectorAll('audio,video')).some(media=>!media.paused&&!media.ended)));}catch{return false;}
}
async function mediaSessionIsPlaying(page){
  try{return Boolean(await page?.evaluate?.(()=>typeof navigator!=='undefined'&&navigator.mediaSession?.playbackState==='playing'));}catch{return false;}
}
async function selectedTrackReady(page,id,track){
  const currentKey=canonicalTrackUrlKey(String(page?.url?.()||''));
  const targetKey=canonicalTrackUrlKey(String(track?.url||''));
  if(currentKey&&targetKey&&currentKey===targetKey)return true;
  if(id==='spotify'&&/open\.spotify\.com\/search\//i.test(String(page?.url?.()||''))&&String(track?.title||'').trim()){
    if(await trackScopedControl(page,id,track,'play'))return true;
    if(await spotifyNowPlayingMatches(page,track))return true;
  }
  return false;
}
async function activeTrackMatches(page,id,track){
  if(id==='spotify'){
    // A Spotify page URL can remain on the originally selected track while the player
    // auto-advances to another song. During active playback, only the now-playing
    // identity is authoritative. Never accept page URL or an available Play button
    // as proof that the assigned song is the one currently sounding.
    return spotifyNowPlayingMatches(page,track);
  }
  return selectedTrackReady(page,id,track);
}
async function adjustVolume(page,direction='down'){
  const step=direction==='up'?0.12:-0.12;
  try{
    const changed=await page?.evaluate?.(({step})=>{
      const clamp=value=>Math.max(0,Math.min(1,value));
      const media=[...document.querySelectorAll('audio,video')].find(node=>!node.muted)||document.querySelector('audio,video');
      if(media&&typeof media.volume==='number'){
        const before=media.volume;media.volume=clamp(before+step);return {method:'media',before,after:media.volume};
      }
      const sliders=[...document.querySelectorAll('input[type="range"],[role="slider"]')];
      const slider=sliders.find(node=>/volume/i.test([node.getAttribute('aria-label'),node.getAttribute('title'),node.getAttribute('data-testid'),node.getAttribute('data-test')].filter(Boolean).join(' ')));
      if(!slider)return null;
      if(slider instanceof HTMLInputElement){
        const min=Number(slider.min||0),max=Number(slider.max||100),before=Number(slider.value||0),delta=(max-min)*step;
        slider.value=String(Math.max(min,Math.min(max,before+delta)));
        slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));
        return {method:'slider',before,after:Number(slider.value)};
      }
      return {method:'slider-role'};
    },{step});
    if(changed)return {status:'PASS',reason:`Volume ${direction} applied`,...changed};
  }catch{}
  try{
    const sliders=page?.locator?.('input[type="range"],[role="slider"]');
    for(const item of await locatorItems(sliders,{limit:30})){
      let meta='';try{meta=[await item.getAttribute?.('aria-label'),await item.getAttribute?.('title'),await item.getAttribute?.('data-testid'),await item.getAttribute?.('data-test')].filter(Boolean).join(' ');}catch{}
      if(!/volume/i.test(meta)||!await itemVisible(item))continue;
      try{await item.focus?.();await item.press?.(direction==='up'?'ArrowUp':'ArrowDown');return {status:'PASS',reason:`Volume ${direction} applied through platform slider`};}catch{}
    }
  }catch{}
  return {status:'NOT_APPLICABLE',reason:'No safe volume control was available'};
}
async function verifyNavigationTarget({page,kind,selection}){
  if(!page)return {status:'NOT_APPLICABLE',reason:'No page'};
  if(kind==='playlist'&&String(selection?.sourceKind||'').toLowerCase()==='playlist'&&/^https?:\/\//i.test(String(selection?.sourceInput||''))){
    const ok=await safeQaGoto(page,String(selection.sourceInput));
    return ok?{status:'PASS',reason:'Selected playlist page loaded',url:String(page.url?.()||selection.sourceInput)}:{status:'WARNING',reason:'Selected playlist page could not be loaded'};
  }
  const fragment=kind==='artist'?'/artist/':kind==='album'?'/album/':kind==='playlist'?'/playlist/':'';
  if(!fragment)return {status:'NOT_APPLICABLE',reason:'Unsupported navigation check'};
  let anchors;try{anchors=page.locator(`a[href*="${fragment}"]`);}catch{return {status:'NOT_APPLICABLE',reason:`No ${kind} navigation link was available`};}
  for(const item of await locatorItems(anchors,{limit:80})){
    if(!await itemVisible(item))continue;
    let href='';try{href=String(await item.getAttribute?.('href')||'');}catch{}
    if(!href)continue;
    let absolute=href;try{absolute=new URL(href,String(page.url?.()||'')).toString();}catch{}
    if(!/^https?:\/\//i.test(absolute))continue;
    const ok=await safeQaGoto(page,absolute);
    return ok?{status:'PASS',reason:`${kind[0].toUpperCase()+kind.slice(1)} navigation loaded`,url:String(page.url?.()||absolute)}:{status:'WARNING',reason:`${kind[0].toUpperCase()+kind.slice(1)} navigation could not be loaded`};
  }
  return {status:'NOT_APPLICABLE',reason:`No safe ${kind} navigation link was available from the selected song`};
}

async function playbackIsActive(page,id,track){
  const currentUrl=String(page?.url?.()||'');
  const spotifySearch=id==='spotify'&&/open\.spotify\.com\/search\//i.test(currentUrl)&&String(track?.title||'').trim();
  if(spotifySearch){
    if(await trackScopedControl(page,id,track,'pause'))return true;
    if(await spotifyNowPlayingMatches(page,track)){
      if(await mediaElementIsPlaying(page)||await mediaSessionIsPlaying(page))return true;
      if(await locatorVisible(page?.getByRole?.('button',{name:/\bpause\b/i}),{requireEnabled:true}))return true;
      if(await firstVisibleSelector(page,PRIMARY_PAUSE_SELECTORS[id]||[],{requireEnabled:true}))return true;
    }
    if(await trackScopedControl(page,id,track,'play'))return false;
    return false;
  }
  if(await mediaElementIsPlaying(page))return true;
  if(await mediaSessionIsPlaying(page))return true;
  if(await locatorVisible(page?.getByRole?.('button',{name:/\bpause\b/i}),{requireEnabled:true}))return true;
  return Boolean(await firstVisibleSelector(page,PRIMARY_PAUSE_SELECTORS[id]||[],{requireEnabled:true}));
}
async function waitForPlaybackEvidence(page,id,track,{attempts=10,delayMs=200}={}){
  for(let attempt=0;attempt<Math.max(1,Number(attempts)||1);attempt++){
    if(await playbackIsActive(page,id,track))return true;
    if(attempt<attempts-1){try{await page?.waitForTimeout?.(delayMs);}catch{}}
  }
  return false;
}
async function clickPlatformControl(page,selectors,rolePattern){
  for(const selector of selectors||[]) if(await clickVisibleLocator(page,page?.locator?.(selector))) return true;
  if(rolePattern&&await clickVisibleLocator(page,page?.getByRole?.('button',{name:rolePattern}))) return true;
  return false;
}
async function protectedMediaReadiness(page,id){
  if(!['spotify','tidal'].includes(String(id||'')))return null;
  try{
    return await page?.evaluate?.(async()=>{
      const result={secureContext:Boolean(globalThis.isSecureContext),eme:typeof navigator?.requestMediaKeySystemAccess==='function',widevine:'unknown',error:''};
      if(!result.eme){result.widevine='unavailable';result.error='Encrypted Media Extensions are unavailable';return result;}
      try{
        await navigator.requestMediaKeySystemAccess('com.widevine.alpha',[{
          initDataTypes:['cenc'],
          audioCapabilities:[{contentType:'audio/mp4; codecs="mp4a.40.2"'},{contentType:'audio/webm; codecs="opus"'}],
          distinctiveIdentifier:'optional',persistentState:'optional',sessionTypes:['temporary'],
        }]);
        result.widevine='available';
      }catch(error){result.widevine='unavailable';result.error=String(error?.name||error?.message||error||'Widevine unavailable');}
      return result;
    });
  }catch(error){return {secureContext:false,eme:false,widevine:'unknown',error:String(error?.message||error||'media readiness unavailable')};}
}
async function activatePlayLocator({page,locator,id,label,track}){
  const item=await firstVisibleLocator(locator,{requireEnabled:true});
  if(!item)return {status:'not-visible',attempted:false};
  const attempts=[];
  attempts.push(['mouse click',async()=>{await clickWithInteractionIndicator(page,item,{timeout:4000});}]);
  attempts.push(['touch tap',async()=>{if(typeof item.tap!=='function')throw new Error('tap unavailable');await waitBeforePageInteraction();await item.tap({timeout:4000});}]);
  attempts.push(['keyboard Enter',async()=>{if(typeof item.focus!=='function'||!page?.keyboard?.press)throw new Error('keyboard unavailable');await item.focus();await waitBeforePageInteraction();await page.keyboard.press('Enter');}]);
  attempts.push(['keyboard Space',async()=>{if(typeof item.focus!=='function'||!page?.keyboard?.press)throw new Error('keyboard unavailable');await item.focus();await waitBeforePageInteraction();await page.keyboard.press('Space');}]);
  let attempted=false;
  for(const [method,action] of attempts){
    if(await playbackIsActive(page,id,track))return {status:'PASS',attempted:true,reason:'Playback confirmed active'};
    try{await action();attempted=true;}catch{continue;}
    if(await waitForPlaybackEvidence(page,id,track))return {status:'PASS',attempted:true,reason:`Playback confirmed after ${label} Play control ${method}`};
  }
  return {status:'not-playing',attempted};
}
async function waitForSpotifySelectedPlayControl(page,track,{attempts=80,delayMs=250,stablePolls=2}={}){
  let stable=0;
  let candidate=null;
  for(let attempt=0;attempt<Math.max(1,Number(attempts)||1);attempt++){
    const control=await trackScopedControl(page,'spotify',track,'play');
    if(control){
      stable++;
      candidate=control;
      if(stable>=Math.max(1,Number(stablePolls)||1))return candidate;
    }else{
      stable=0;
      candidate=null;
    }
    if(attempt<attempts-1){try{await page?.waitForTimeout?.(delayMs);}catch{}}
  }
  return null;
}
async function activatePlayback({page,id,label,track}){
  if(await playbackIsActive(page,id,track))return {status:'PASS',reason:'Playback is already active'};
  try{await page?.bringToFront?.();}catch{}
  try{
    const resolver=createBlockingSurfaceResolver({page,log:()=>{}});
    await resolver.resolveLoop(3);
  }catch{}
  const spotifySearch=id==='spotify'&&/open\.spotify\.com\/search\//i.test(String(page?.url?.()||''))&&String(track?.title||'').trim();
  const scoped=spotifySearch
    ? await waitForSpotifySelectedPlayControl(page,track)
    : await trackScopedControl(page,id,track,'play');
  if(scoped){
    const scopedResult=await activatePlayLocator({page,locator:scoped,id,label,track});
    if(scopedResult.status==='PASS')return {status:'PASS',reason:scopedResult.reason};
    if(spotifySearch){
      const media=await protectedMediaReadiness(page,id);
      if(media?.widevine==='unavailable')return {status:'WARNING',reason:`${label} protected-media/DRM playback is unavailable in this browser profile (${media.error||'Widevine unavailable'}). The Play control cannot start audio until protected content is available.`,mediaReadiness:media};
      return {status:'WARNING',reason:`${label} selected-track Play control was ready but playback did not start`,mediaReadiness:media||undefined};
    }
  }else if(spotifySearch){
    const media=await protectedMediaReadiness(page,id);
    return {status:'NOT_APPLICABLE',reason:`${label} selected-track Play control is not ready after waiting for the result card to stabilize`,mediaReadiness:media||undefined};
  }
  const selectors=[...(PRIMARY_PLAY_SELECTORS[id]||[]),
    'button[aria-label="Play" i]','button[aria-label^="Play " i]','[role="button"][aria-label="Play" i]','[role="button"][aria-label^="Play " i]',
    'button[title="Play" i]','button[title*="Play " i]','[role="button"][title="Play" i]','[role="button"][title*="Play " i]',
    'button[data-testid*="play" i]','[role="button"][data-testid*="play" i]','button[data-test*="play" i]','[role="button"][data-test*="play" i]'];
  const unique=[...new Set(selectors)];
  let attempted=false;
  for(const selector of unique){
    if(await playbackIsActive(page,id,track))return {status:'PASS',reason:'Playback confirmed active'};
    const result=await activatePlayLocator({page,locator:page?.locator?.(selector),id,label,track});
    attempted=attempted||result.attempted;
    if(result.status==='PASS')return {status:'PASS',reason:result.reason};
  }
  if(await playbackIsActive(page,id,track))return {status:'PASS',reason:'Playback confirmed active'};
  const rolePlay=page?.getByRole?.('button',{name:/\b(play|resume)\b/i});
  const roleResult=await activatePlayLocator({page,locator:rolePlay,id,label,track});
  attempted=attempted||roleResult.attempted;
  if(roleResult.status==='PASS')return {status:'PASS',reason:roleResult.reason};
  if(await playbackIsActive(page,id,track))return {status:'PASS',reason:'Playback confirmed active'};
  const media=await protectedMediaReadiness(page,id);
  if(media?.widevine==='unavailable'){
    return {status:'WARNING',reason:`${label} protected-media/DRM playback is unavailable in this browser profile (${media.error||'Widevine unavailable'}). The Play control cannot start audio until protected content is available.`,mediaReadiness:media};
  }
  return attempted
    ? {status:'WARNING',reason:`${label} Play control received mouse/touch/keyboard activation but playback did not start`,mediaReadiness:media||undefined}
    : {status:'NOT_APPLICABLE',reason:`${label} Play control is not ready yet`,mediaReadiness:media||undefined};
}


async function safeQaGoto(page,url){try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});return true;}catch{return false;}}
async function clickSavedTrackAnchor(page,targetUrl){
  const targetKey=canonicalTrackUrlKey(targetUrl);
  if(!targetKey||!page?.locator)return false;
  let anchors; try{anchors=page.locator('a[href]');}catch{return false;}
  if(!anchors||typeof anchors.count!=='function'||typeof anchors.nth!=='function')return false;
  let count=0; try{count=Math.min(400,await anchors.count());}catch{return false;}
  const base=String(page.url?.()||'');
  for(let i=0;i<count;i++){
    const anchor=anchors.nth(i);
    let href=''; try{href=String(await anchor.getAttribute?.('href')||'');}catch{}
    if(!href)continue;
    let absolute=href; try{absolute=new URL(href,base).toString();}catch{}
    if(canonicalTrackUrlKey(absolute)!==targetKey)continue;
    try{if(anchor.isVisible&&!(await anchor.isVisible()))continue;}catch{}
    try{await clickWithInteractionIndicator(page,anchor,{timeout:5000});return true;}catch{}
  }
  return false;
}
function matchingSavedTrack(savedTracks=[],candidate={}){
  const key=canonicalTrackUrlKey(candidate?.url||'');
  if(!key)return null;
  return (savedTracks||[]).find(track=>canonicalTrackUrlKey(track?.url||'')===key)||null;
}
async function openQaMusicSelection({id,page,selection={},preferredTrack}){
  if(!page)return {status:'NOT_APPLICABLE',reason:'No browser page'};
  const savedTracks=Array.isArray(selection.tracks)?selection.tracks.filter(Boolean):[];
  const sourceUrl=String(selection.sourceInput||selection.canonicalSourceInput||preferredTrack?.url||savedTracks[0]?.url||'').trim();
  if(!sourceUrl)return {status:'NOT_APPLICABLE',reason:'The selected QA music item has no saved link'};
  if(!await safeQaGoto(page,sourceUrl))return {status:'WARNING',reason:'The selected QA music link could not be opened',sourceUrl};
  const sourceKind=String(selection.sourceKind||'').toLowerCase();
  if(sourceKind==='track'||isTrackLikeUrl(id,sourceUrl)){
    const direct=matchingSavedTrack(savedTracks,{url:sourceUrl})||preferredTrack||savedTracks[0]||{id:sourceUrl,platform:id,title:selection.name||'Saved song',url:sourceUrl};
    return {status:'PASS',track:direct,sourceUrl,method:'direct-song-link'};
  }
  await dismissCatalogConsent(page,id).catch(()=>undefined);
  try{await page.waitForTimeout?.(500);}catch{}
  await warmCatalogPage(page,sourceKind).catch(()=>undefined);
  let snapshot={title:'',links:[],json:[]};
  let discovered=[];
  let available=[];
  for(let attempt=0;attempt<3;attempt++){
    try{snapshot=await snapshotCatalogPage(page);}catch{}
    discovered=extractTracksFromSnapshot(id,snapshot,sourceUrl);
    available=[];
    for(const row of discovered){const saved=matchingSavedTrack(savedTracks,row);if(saved&&!available.some(x=>canonicalTrackUrlKey(x.url)===canonicalTrackUrlKey(saved.url)))available.push(saved);}
    if(available.length||discovered.length)break;
    if(attempt<2){try{await page.waitForTimeout?.(attempt===0?700:1200);}catch{};await warmCatalogPage(page,sourceKind).catch(()=>undefined);}
  }
  const preferredKey=canonicalTrackUrlKey(preferredTrack?.url||'');
  let chosen=(preferredKey?available.find(track=>canonicalTrackUrlKey(track.url)===preferredKey):null)||available[0]||preferredTrack||savedTracks[0]||discovered[0]||null;
  if(!chosen?.url)return {status:'WARNING',reason:'No playable song was found on the selected QA music link',sourceUrl};
  let clicked=false;
  if(available.length)clicked=await clickSavedTrackAnchor(page,chosen.url);
  if(clicked){try{await page.waitForTimeout?.(350);}catch{};return {status:'PASS',track:chosen,sourceUrl,method:'source-page-song-click'};}
  if(!await safeQaGoto(page,chosen.url))return {status:'WARNING',reason:'A saved song was found but could not be opened',sourceUrl,track:chosen};
  return {status:'PASS',track:chosen,sourceUrl,method:available.length?'source-page-song-fallback':'saved-song-fallback'};
}

async function firstVisibleSelector(page,selectors=[]){for(const selector of selectors){try{const item=firstLocator(page.locator(selector));if(item&&await item.isVisible?.())return item;}catch{}}return null;}
async function ensureStreamingAction(page,{activeSelectors=[],actionSelectors=[],doneReason,actionReason}){const active=await firstVisibleSelector(page,activeSelectors);if(active)return {status:'PASS',reason:doneReason,alreadyActive:true};const control=await firstVisibleSelector(page,actionSelectors);if(!control)return {status:'NOT_APPLICABLE',reason:'The platform did not expose this control on the selected song page'};try{await control.scrollIntoViewIfNeeded?.();await clickWithInteractionIndicator(page,control,{timeout:6000});await page.waitForTimeout?.(450);return {status:'PASS',reason:actionReason,alreadyActive:false};}catch(error){return {status:'WARNING',reason:`Control could not be activated: ${String(error?.message||error)}`};}}

function makeAdapter({id,label,hosts=[]}) {
  return {
    id,label,hosts,
    supports:{catalog:true,sessionVerification:true,playbackQa:true},
    buildSearchUrl:(query)=>makeSearchUrl(id,query),
    classifyInput:(input)=>classifyInputForPlatform(id,input),
    normalizeTrack(raw={}) { const url=String(raw.url||raw.href||''); return {id:String(raw.id||url||raw.title||''),platform:id,title:String(raw.title||raw.name||'Untitled track'),artist:raw.artist?String(raw.artist):undefined,album:raw.album?String(raw.album):undefined,url,durationSeconds:Number.isFinite(raw.durationSeconds)?Number(raw.durationSeconds):undefined,artworkUrl:raw.artworkUrl?String(raw.artworkUrl):undefined}; },
    async resolveCatalog({input,page,networkJson=[],fetchJson,fetchText}) {
      const kind=classifyInputForPlatform(id,input);
      let feedTracks=[];
      if(id==='youtube-music' && (kind==='artist'||kind==='playlist') && typeof fetchText==='function'){
        const feed=await tryYouTubeFeedCatalog({platform:id,input,fetchText});
        if(feed?.tracks?.length) feedTracks=feed.tracks;
      }
      if(kind==='track'){
        const directTracks=extractTracksFromSnapshot(id,{title:''},input);
        if(directTracks.length) return {kind,tracks:directTracks};
      }
      if (!page) return {kind,tracks:dedupeTracks(feedTracks)};
      await dismissCatalogConsent(page,id);
      await warmCatalogPage(page,kind);
      await expandCatalogPage(page,id);
      const readSnapshot=async()=>{
        const value=await snapshotCatalogPage(page);
        if(Array.isArray(networkJson)&&networkJson.length) value.json=[...(value.json||[]),...networkJson];
        return value;
      };
      let snapshot=await readSnapshot();
      let tracks=dedupeTracks([...feedTracks,...extractTracksFromSnapshot(id,snapshot,input)]);
      if(!tracks.length && typeof fetchJson==='function') tracks=await fetchPublicCatalog({platform:id,input,fetchJson});
      if(!tracks.length && id==='tidal' && Array.isArray(networkJson)) {
        for(const payload of networkJson) tracks.push(...normalizePublicCatalogResponse('tidal',payload,input));
        tracks=dedupeTracks(tracks);
      }
      if(!tracks.length && id==='youtube-music' && kind==='artist'){
        const fallback=buildYouTubeArtistFallbackUrl(input);
        if(fallback){
          try{
            const current=String(page.url?.()||'');
            if(!current || current!==fallback) await page.goto(fallback,{waitUntil:'domcontentloaded',timeout:30000});
            await dismissCatalogConsent(page,id);
            await warmCatalogPage(page,'artist');
            snapshot=await readSnapshot();
            tracks=extractTracksFromSnapshot(id,snapshot,input);
          }catch{}
        }
        if(!tracks.length && typeof fetchText==='function'){
          const feedUrl=buildYouTubeFeedUrl(input);
          if(feedUrl){
            try{ tracks=parseYouTubeChannelFeed(await fetchText(feedUrl)); }catch{}
          }
        }
      }
      if(!tracks.length){
        for(const delay of [1200,1800]){
          await page.waitForTimeout?.(delay);
          snapshot=await readSnapshot();
          tracks=extractTracksFromSnapshot(id,snapshot,input);
          if(tracks.length) break;
          if(typeof fetchJson==='function'){
            tracks=await fetchPublicCatalog({platform:id,input,fetchJson});
            if(tracks.length) break;
          }
        }
      }
      if(!tracks.length){const blocked=catalogBlockReason(id,snapshot); if(blocked) throw new Error(blocked);}
      return {kind,tracks:dedupeTracks(tracks)};
    },
    async authenticate({page,account}) {
      return authenticatePlatformAccount({id,page,account,verifySession:({page:verifyPage,account:verifyAccount})=>this.verifySession({page:verifyPage,account:verifyAccount})});
    },
    async verifySession({page}) {
      if(getPlatformAuthConfig(id)) return verifyPlatformSession({id,page});
      if (!page) return {status:'NOT_APPLICABLE',reason:'No page'};
      const url=page.url?.()||'';
      if (!url) return {status:'WARNING',reason:'No platform URL'};
      for (const role of ['button','link']) {
        try {
          const candidate=page.getByRole?.(role,{name:/^(log in|login|sign in|signin)$/i});
          const first=candidate?.first?.()||candidate;
          if(first && await first.isVisible?.()) return {status:'WARNING',reason:'A login control is still visible; the authorized session may require attention'};
        } catch { /* conservative diagnostic only */ }
      }
      return {status:'PASS',reason:'Platform page available without an obvious login gate'};
    },
    async openMusicSelection({page,selection,preferredTrack}) { return openQaMusicSelection({id,page,selection,preferredTrack}); },
    async locateTrack({page,track}) { if (!page || !track?.url) return {status:'NOT_APPLICABLE',reason:'No canonical track URL'}; await page.goto(track.url,{waitUntil:'domcontentloaded'}); return {status:'PASS',url:track.url}; },
    async selectedTrackReady({page,track}) { return selectedTrackReady(page,id,track); },
    async activeTrackMatches({page,track}) { return activeTrackMatches(page,id,track); },
    // Read-only, conservative advertising signal. Never click, skip, mute or navigate
    // the player while an advertisement is active.
    async advertisementActive({page}) {
      if(id!=='spotify'||!page?.evaluate)return false;
      try{return Boolean(await page.evaluate(()=>{
        const nodes=[...document.querySelectorAll('[data-testid*="ad-" i],[data-testid*="advert" i],[aria-label*="advertisement" i],[aria-label="Advertisement"],footer')];
        return nodes.some(node=>{
          const text=[node.getAttribute('data-testid'),node.getAttribute('aria-label'),node.textContent].filter(Boolean).join(' ').trim();
          if(!/\b(advertisement|ad break|sponsored message)\b/i.test(text))return false;
          const style=getComputedStyle(node);
          return style.display!=='none'&&style.visibility!=='hidden'&&node.getClientRects().length>0;
        });
      }));}catch{return false;}
    },
    async navigationCheck({page,kind,selection}) { return verifyNavigationTarget({page,kind,selection}); },
    async engagementControls({page}) {
      if(!page)return {status:'NOT_APPLICABLE',reason:'No page'};
      return {
        async favoriteTrack(){return ensureStreamingAction(page,{activeSelectors:FAVORITED_TRACK_SELECTORS[id]||[],actionSelectors:FAVORITE_TRACK_SELECTORS[id]||[],doneReason:'Selected song is already liked/favorited',actionReason:'Selected song liked/favorited'});},
        async followArtist(){return ensureStreamingAction(page,{activeSelectors:FOLLOWED_ARTIST_SELECTORS[id]||[],actionSelectors:FOLLOW_ARTIST_SELECTORS[id]||[],doneReason:'Artist is already followed/favorited',actionReason:'Artist followed/favorited'});},
      };
    },
    async playbackControls({page,track}) {
      if (!page) return {status:'NOT_APPLICABLE',reason:'No page'};
      return {
        status:'PASS',
        async play(){
          return activatePlayback({page,id,label,track});
        },
        async pause(){
          const clicked=await clickPlatformControl(page,PRIMARY_PAUSE_SELECTORS[id]||[],/\bpause\b/i);
          return clicked?{status:'PASS'}:{status:'NOT_APPLICABLE',reason:'No safe pause control found'};
        },
        async isPlaying(){
          const active=await playbackIsActive(page,id,track);
          return active?{status:'PASS',reason:'Selected track playback is active'}:{status:'WARNING',reason:'Selected track playback is not active'};
        },
        async volumeDown(){return adjustVolume(page,'down');},
        async volumeUp(){return adjustVolume(page,'up');},
      };
    }

  };
}
module.exports={makeAdapter,classifyInputGeneric,classifyInputForPlatform,makeSearchUrl,warmCatalogPage,expandCatalogPage,isTrackLikeUrl,extractTracksFromSnapshot,snapshotCatalogPage,catalogBlockReason,dismissCatalogConsent,createCatalogResponseCapture,openQaMusicSelection,clickSavedTrackAnchor};
