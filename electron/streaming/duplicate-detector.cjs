const {detectPlatformFromInput}=require('./platform-adapter.cjs');

const TRACKING_PARAMS=new Set(['si','feature','ref','referrer','share','shared','context','fbclid','gclid']);
function cleanPath(pathname=''){return String(pathname||'/').replace(/\/{2,}/g,'/').replace(/\/$/,'')||'/';}
function cleanSearch(url){
  for(const key of [...url.searchParams.keys()]){
    const low=key.toLowerCase();
    if(low.startsWith('utm_')||TRACKING_PARAMS.has(low)) url.searchParams.delete(key);
  }
}
function canonicalStreamingSourceKey(input=''){
  const raw=String(input||'').trim();
  let url; try{url=new URL(raw);}catch{return raw.toLowerCase();}
  cleanSearch(url); url.hash='';
  const platform=detectPlatformFromInput(url.toString())||'unknown';
  const host=url.hostname.toLowerCase().replace(/^www\./,'');
  let path=cleanPath(url.pathname);

  if(platform==='youtube-music'){
    if(host==='youtu.be'){
      const id=path.split('/').filter(Boolean)[0];
      if(id) return `youtube-music:track:${id}`;
    }
    const videoId=url.searchParams.get('v');
    if(videoId) return `youtube-music:track:${videoId}`;
    const listId=url.searchParams.get('list');
    if(listId) return `youtube-music:playlist:${listId}`;
    const handle=path.match(/^\/@([^/]+)/i)?.[1];
    if(handle) return `youtube-music:artist:@${handle.toLowerCase()}`;
    const channel=path.match(/^\/channel\/([^/]+)/i)?.[1];
    if(channel) return `youtube-music:artist:${channel}`;
  }
  if(platform==='spotify'){
    const match=path.match(/\/(track|album|playlist|artist)\/([^/?#]+)/i);
    if(match) return `spotify:${match[1].toLowerCase()}:${match[2]}`;
  }
  if(platform==='deezer'){
    const match=path.match(/\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|playlist|artist)\/(\d+)/i);
    if(match) return `deezer:${match[1].toLowerCase()}:${match[2]}`;
  }
  if(platform==='tidal'){
    const match=path.match(/\/(?:browse\/)?(track|album|playlist|artist)\/([^/?#]+)/i);
    if(match) return `tidal:${match[1].toLowerCase()}:${match[2]}`;
  }
  if(platform==='pandora'){
    const token=path.split('/').filter(Boolean).at(-1)||'';
    if(/^TR[a-z0-9]+$/i.test(token)) return `pandora:track:${token.toUpperCase()}`;
    if(/^AL[a-z0-9]+$/i.test(token)) return `pandora:album:${token.toUpperCase()}`;
    if(/^PL[a-z0-9]+$/i.test(token)) return `pandora:playlist:${token.toUpperCase()}`;
  }
  if(platform==='audiomack'){
    const parts=path.split('/').filter(Boolean);
    const idx=parts.findIndex(part=>['song','album','playlist'].includes(part.toLowerCase()));
    if(idx>0&&parts[idx+1]) return `audiomack:${parts[idx].toLowerCase()}:${parts.slice(0,idx+2).join('/').toLowerCase()}`;
  }
  if(platform==='soundcloud'){
    const parts=path.split('/').filter(Boolean);
    if(parts.length>=3&&parts[1].toLowerCase()==='sets') return `soundcloud:playlist:${parts[0].toLowerCase()}:${parts.slice(2).join('/').toLowerCase()}`;
    if(parts.length===2) return `soundcloud:track:${parts.join('/').toLowerCase()}`;
    if(parts.length===1) return `soundcloud:artist:${parts[0].toLowerCase()}`;
  }

  url.hostname=host;
  url.pathname=path;
  const sorted=[...url.searchParams.entries()].sort(([a,av],[b,bv])=>a.localeCompare(b)||av.localeCompare(bv));
  url.search='';
  for(const [key,value] of sorted) url.searchParams.append(key,value);
  return `${platform}:${url.toString().replace(/\?$/,'')}`;
}

function humanKind(kind=''){
  if(kind==='track') return 'song';
  if(kind==='playlist') return 'playlist';
  if(kind==='album') return 'album';
  if(kind==='artist') return 'artist';
  return 'music link';
}
function sourceKeysForCollection(collection={}){
  const keys=new Set();
  for(const value of [collection.canonicalSourceInput,collection.sourceInput]){
    const key=canonicalStreamingSourceKey(value||'');
    if(key) keys.add(key);
  }
  return keys;
}
function findStreamingDuplicate({input='',collections=[],ignoreCollectionId=''}={}){
  const inputKey=canonicalStreamingSourceKey(input);
  if(!inputKey) return null;
  const inputLooksTrack=/:track:/.test(inputKey);
  for(const collection of collections||[]){
    if(!collection||String(collection.id)===String(ignoreCollectionId||'')) continue;
    const sourceKeys=sourceKeysForCollection(collection);
    if(sourceKeys.has(inputKey)){
      const kind=collection.sourceKind|| (inputLooksTrack?'track':'search');
      const label=humanKind(kind);
      return {duplicate:true,kind,platform:collection.platform,collectionId:String(collection.id),collectionName:String(collection.name||'Saved album'),message:`This ${label} has already been added as “${collection.name||'Saved album'}”.`};
    }
    if(inputLooksTrack){
      for(const track of collection.tracks||[]){
        if(canonicalStreamingSourceKey(track?.url||'')===inputKey){
          return {duplicate:true,kind:'track',platform:collection.platform,collectionId:String(collection.id),collectionName:String(collection.name||'Saved album'),message:`This song has already been added in “${collection.name||'Saved album'}”.`};
        }
      }
    }
  }
  return null;
}

module.exports={canonicalStreamingSourceKey,findStreamingDuplicate};
