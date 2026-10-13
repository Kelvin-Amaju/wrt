function hostMatches(hostname, expected=[]) {
  const host=String(hostname||'').toLowerCase().replace(/^www\./,'');
  return expected.some(value=>host===String(value).toLowerCase()||host.endsWith(`.${String(value).toLowerCase()}`));
}

function parseUrl(input='') { try { return new URL(String(input||'').trim()); } catch { return null; } }


const SHARE_HOSTS=new Set(['link.deezer.com','deezer.page.link','on.soundcloud.com','tidal.link','amk.to','pandora.app.link']);
function serviceForHost(hostname=''){
  const host=String(hostname||'').toLowerCase().replace(/^www\./,'');
  if(hostMatches(host,['deezer.com'])) return 'deezer';
  if(hostMatches(host,['soundcloud.com'])) return 'soundcloud';
  if(hostMatches(host,['tidal.com'])) return 'tidal';
  if(hostMatches(host,['audiomack.com','amk.to'])) return 'audiomack';
  if(hostMatches(host,['pandora.com','pandora.app.link'])) return 'pandora';
  if(hostMatches(host,['music.youtube.com','youtube.com','youtu.be'])) return 'youtube-music';
  return null;
}
function cleanShareTarget(value=''){
  const url=parseUrl(value); if(!url) return String(value||'').trim();
  for(const key of [...url.searchParams.keys()]){
    const low=key.toLowerCase();
    if(low.startsWith('utm_')||['si','feature','ref','referrer','share','shared','context'].includes(low)) url.searchParams.delete(key);
  }
  url.hash='';
  return url.toString().replace(/\?$/,'');
}
async function resolveShareRedirect(input='',{fetchImpl=global.fetch,timeoutMs=12000}={}){
  const original=String(input||'').trim();
  const parsed=parseUrl(original); if(!parsed||typeof fetchImpl!=='function') return original;
  const host=parsed.hostname.toLowerCase();
  if(!SHARE_HOSTS.has(host)) return original;
  const controller=typeof AbortController==='function'?new AbortController():null;
  const timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
  try{
    const response=await fetchImpl(original,{method:'GET',redirect:'follow',headers:{accept:'text/html,application/xhtml+xml','user-agent':'Mozilla/5.0 OrbitQA/0.16.4'},...(controller?{signal:controller.signal}:{})});
    const finalValue=String(response?.url||'').trim();
    const finalUrl=parseUrl(finalValue); if(!finalUrl) return original;
    const originalService=serviceForHost(parsed.hostname); const finalService=serviceForHost(finalUrl.hostname);
    if(!originalService||!finalService||originalService!==finalService) return original;
    if(originalService==='pandora'&&/^\/(restricted|unavailable)(?:\/|$)/i.test(finalUrl.pathname)) return original;
    return cleanShareTarget(finalValue);
  }catch{return original;}
  finally{if(timer)clearTimeout(timer);}
}

function buildPublicCatalogRequest(platform,input='') {
  const url=parseUrl(input); if(!url) return null;
  const path=url.pathname;
  if(platform==='deezer' && hostMatches(url.hostname,['deezer.com'])) {
    const match=path.match(/\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(album|playlist|track)\/(\d+)/i);
    if(!match) return null;
    const kind=match[1].toLowerCase();
    return {platform:'deezer',kind,url:`https://api.deezer.com/${kind}/${match[2]}`};
  }
  if(platform==='audiomack' && hostMatches(url.hostname,['audiomack.com'])) {
    const parts=path.split('/').filter(Boolean);
    if(parts.length>=3 && ['album','song'].includes(parts[1].toLowerCase())) {
      const kind=parts[1].toLowerCase();
      return {platform:'audiomack',kind:kind==='song'?'track':'album',url:`https://api.audiomack.com/v1/music/${kind}/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts.slice(2).join('/'))}`};
    }
  }
  return null;
}

function buildYouTubeArtistFallbackUrl(input='') {
  const url=parseUrl(input); if(!url||!hostMatches(url.hostname,['music.youtube.com','youtube.com'])) return null;
  const parts=url.pathname.split('/').filter(Boolean);
  if(parts[0]?.startsWith('@')) return `https://www.youtube.com/${parts[0]}/videos`;
  if(parts[0]==='channel' && parts[1]) return `https://www.youtube.com/channel/${parts[1]}/videos`;
  return null;
}


function buildYouTubePlaylistFallbackUrl(input='') {
  const url=parseUrl(input); if(!url||!hostMatches(url.hostname,['music.youtube.com','youtube.com'])) return null;
  const listId=String(url.searchParams.get('list')||'').trim();
  if(!listId) return null;
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(listId)}`;
}

function preferredCatalogNavigationUrl(platform,input='') {
  const text=String(input||'').trim();
  if(platform==='youtube-music') return buildYouTubeArtistFallbackUrl(text)||buildYouTubePlaylistFallbackUrl(text)||text;
  return text;
}

function buildYouTubeFeedUrl(input='') {
  const url=parseUrl(input); if(!url||!hostMatches(url.hostname,['music.youtube.com','youtube.com'])) return null;
  const channelMatch=url.pathname.match(/^\/channel\/([^/?#]+)/i);
  if(channelMatch) return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelMatch[1])}`;
  const playlistId=String(url.searchParams.get('list')||'').trim();
  if(playlistId) return `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(playlistId)}`;
  return null;
}

function buildYouTubeChannelFeedUrl(input='') {
  const feedUrl=buildYouTubeFeedUrl(input);
  return feedUrl&&feedUrl.includes('channel_id=')?feedUrl:null;
}
function decodeXml(value='') {
  return String(value||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
}
function parseYouTubeChannelFeed(xml='') {
  const text=String(xml||''); const rows=[];
  for(const match of text.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)){
    const entry=match[0];
    const id=(entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i)||[])[1];
    if(!id) continue;
    const title=decodeXml((entry.match(/<title>([\s\S]*?)<\/title>/i)||[])[1]||'YouTube Music track').trim();
    const artist=decodeXml((entry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i)||[])[1]||'').trim();
    rows.push({id,title,...(artist?{artist}:{}),url:`https://music.youtube.com/watch?v=${encodeURIComponent(id)}`});
  }
  return dedupe(rows);
}

async function tryYouTubeFeedCatalog({platform,input,fetchText}={}) {
  if(platform!=='youtube-music'||typeof fetchText!=='function') return null;
  const feedUrl=buildYouTubeFeedUrl(input);
  if(!feedUrl) return null;
  try{
    const tracks=parseYouTubeChannelFeed(await fetchText(feedUrl));
    if(!tracks.length) return null;
    return {kind:feedUrl.includes('playlist_id=')?'playlist':'artist',tracks,feedUrl};
  }catch{return null;}
}

function normalizeDirectTrackUrl(_platform,input='') { return String(input||'').trim(); }

function artistName(value) {
  if(!value) return undefined;
  if(typeof value==='string') return value;
  if(Array.isArray(value)) return value.map(artistName).filter(Boolean).join(', ')||undefined;
  if(typeof value==='object') return value.name||value.title||undefined;
  return undefined;
}

function dedupe(rows=[]) {
  const seen=new Set(); const out=[];
  for(const row of rows) {
    if(!row?.url) continue;
    const url=String(row.url); if(seen.has(url)) continue; seen.add(url);
    out.push({id:String(row.id||url),title:String(row.title||'Untitled track'),...(row.artist?{artist:String(row.artist)}:{}),url});
  }
  return out;
}

function collectObjects(root,maxDepth=16) {
  const out=[]; const seen=new Set();
  function walk(value,depth){
    if(value==null||depth>maxDepth||typeof value!=='object'||seen.has(value)) return;
    seen.add(value); out.push(value);
    if(Array.isArray(value)) { for(const item of value) walk(item,depth+1); return; }
    for(const child of Object.values(value)) walk(child,depth+1);
  }
  walk(root,0); return out;
}

function normalizePublicCatalogResponse(platform,payload,sourceInput='') {
  const rows=[];
  const objects=collectObjects(payload);
  if(platform==='deezer') {
    for(const obj of objects) {
      if(!obj||typeof obj!=='object'||Array.isArray(obj)) continue;
      const id=obj.id;
      const title=obj.title||obj.title_short;
      const directTrackLink=typeof obj.link==='string'&&/deezer\.com\/.*track\//i.test(obj.link);
      const looksTrack=String(obj.type||'').toLowerCase()==='track'||directTrackLink||Boolean(obj.duration)||Boolean(obj.rank)||Boolean(obj.preview)||obj.readable!==undefined||Boolean(obj.artist&&!obj.tracks&&!obj.nb_tracks);
      if(!id||!title||!looksTrack) continue;
      const url=directTrackLink?obj.link:`https://www.deezer.com/track/${id}`;
      rows.push({id,title,artist:artistName(obj.artist),url});
    }
  } else if(platform==='tidal') {
    for(const obj of objects) {
      if(!obj||typeof obj!=='object'||Array.isArray(obj)) continue;
      const type=String(obj.type||obj.__typename||'').toLowerCase();
      const attrs=obj.attributes&&typeof obj.attributes==='object'?obj.attributes:{};
      const id=obj.id||attrs.id;
      const title=attrs.title||obj.title||obj.name;
      if(!id||!title||!(type==='track'||type==='tracks'||type.includes('track'))) continue;
      rows.push({id,title,artist:artistName(attrs.artists||obj.artists||obj.artist),url:`https://tidal.com/track/${id}`});
    }
  } else if(platform==='audiomack') {
    for(const obj of objects) {
      if(!obj||typeof obj!=='object'||Array.isArray(obj)) continue;
      const title=obj.title||obj.name;
      const direct=obj.url||obj.permalink_url||obj.permalinkUrl||obj.share_url||obj.shareUrl;
      let url=typeof direct==='string'&&/audiomack\.com\/[^/]+\/song\//i.test(direct)?direct:null;
      if(!url && obj.url_slug && obj.uploader_url_slug) url=`https://audiomack.com/${obj.uploader_url_slug}/song/${obj.url_slug}`;
      if(!title||!url) continue;
      rows.push({id:obj.id||url,title,artist:obj.artist_name||obj.artistName||artistName(obj.artist),url});
    }
  }
  if(platform==='pandora' && /\/TR[A-Za-z0-9]+\/?(?:$|[?#])/i.test(sourceInput)) rows.push({id:sourceInput,title:'Pandora track',url:sourceInput});
  return dedupe(rows);
}

async function fetchPublicCatalog({platform,input,fetchJson}={}) {
  if(typeof fetchJson!=='function') return [];
  const request=buildPublicCatalogRequest(platform,input);
  if(!request) return [];
  try {
    const payload=await fetchJson(request.url);
    return normalizePublicCatalogResponse(platform,payload,input);
  } catch { return []; }
}

module.exports={buildPublicCatalogRequest,buildYouTubeArtistFallbackUrl,buildYouTubePlaylistFallbackUrl,preferredCatalogNavigationUrl,buildYouTubeFeedUrl,buildYouTubeChannelFeedUrl,parseYouTubeChannelFeed,tryYouTubeFeedCatalog,normalizePublicCatalogResponse,normalizeDirectTrackUrl,fetchPublicCatalog,resolveShareRedirect};
