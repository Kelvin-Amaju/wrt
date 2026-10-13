function hashSeed(seed='') { let h=2166136261; for(const c of String(seed)){h^=c.charCodeAt(0); h=Math.imul(h,16777619);} return h>>>0; }
function rngFromSeed(seed=''){let x=hashSeed(seed)||1; return ()=>{x^=x<<13; x^=x>>>17; x^=x<<5; return ((x>>>0)%1000000)/1000000;};}
function shuffledCopy(values=[],seed=''){
  const order=[...values]; const rng=rngFromSeed(seed);
  for(let i=order.length-1;i>0;i--){const j=Math.floor(rng()*(i+1)); [order[i],order[j]]=[order[j],order[i]];}
  return order;
}
function createTrackDeck({tracks=[],mode='sequential',seed=''}){const order=mode==='shuffle'?shuffledCopy(tracks,seed):[...tracks]; return {order,index:0,mode:mode==='loop'?'loop':mode==='shuffle'?'shuffle':'sequential'};}
function nextTrack(state){const order=state?.order||[]; if(!order.length) return {track:null,state:{...state,index:0}}; let index=Number(state?.index)||0; if(index>=order.length){if(state?.mode==='loop') index=0; else return {track:null,state:{...state,index}};} const track=order[index]; return {track,state:{...state,index:index+1}};}
function chooseObservationSeconds({minSeconds=60,maxSeconds=110,rng=Math.random}){
  let a=Math.max(1,Math.floor(Number(minSeconds)||60)),b=Math.max(1,Math.floor(Number(maxSeconds)||110));
  if(a>b)[a,b]=[b,a];
  if(a===b)return a;
  const raw=Number(rng());
  const r=Number.isFinite(raw)?Math.min(0.999999999999,Math.max(0,raw)):Math.random();
  return a+Math.floor(r*(b-a+1));
}
function assignInitialTracks({accountIds=[],tracks=[],seed='stream'}={}){
  const ids=(accountIds||[]).map(String);
  if(!ids.length||!tracks.length) return [];
  const pool=shuffledCopy(tracks,`${seed}:initial-tracks`);
  return ids.map((accountId,index)=>({accountId,track:pool[index%pool.length],cycle:Math.floor(index/pool.length)}));
}
function createPersistentTrackDeck({tracks=[],initialTrack=null,seed='',mode='loop'}={}){
  if(!tracks.length) return {order:[],index:0,mode:'loop'};
  const initialId=String(initialTrack?.id??'');
  const first=tracks.find(track=>String(track?.id??'')===initialId)||initialTrack||tracks[0];
  const remaining=tracks.filter(track=>track!==first && String(track?.id??'')!==String(first?.id??''));
  const normalized=mode==='shuffle'?'shuffle':mode==='loop'?'loop':'sequential';
  const orderedRemaining=normalized==='shuffle'?shuffledCopy(remaining,`${seed}:persistent-deck`):remaining;
  const order=[first,...orderedRemaining];
  return {order,index:0,mode:normalized==='loop'?'loop':'sequential'};
}
function normalizedHost(parsed){return String(parsed?.hostname||'').toLowerCase().replace(/^www\./,'');}
function hostIs(host,suffix){return host===suffix||host.endsWith(`.${suffix}`);}
function cleanSegments(pathname=''){return String(pathname||'').split('/').filter(Boolean).map(segment=>decodeURIComponent(segment));}
function stablePlatformTrackKey(parsed){
  const host=normalizedHost(parsed);
  const segments=cleanSegments(parsed.pathname);
  if(hostIs(host,'spotify.com')){
    const index=segments.findIndex(segment=>segment.toLowerCase()==='track');
    if(index>=0&&segments[index+1]) return `spotify:track:${segments[index+1]}`;
  }
  if(hostIs(host,'youtube.com')||host==='youtu.be'){
    const id=host==='youtu.be'?segments[0]:parsed.searchParams.get('v');
    if(id) return `youtube:track:${id}`;
  }
  if(hostIs(host,'deezer.com')){
    const index=segments.findIndex(segment=>segment.toLowerCase()==='track');
    if(index>=0&&segments[index+1]) return `deezer:track:${segments[index+1]}`;
  }
  if(hostIs(host,'tidal.com')){
    const index=segments.findIndex(segment=>segment.toLowerCase()==='track');
    if(index>=0&&segments[index+1]) return `tidal:track:${segments[index+1]}`;
  }
  if(hostIs(host,'soundcloud.com')&&segments.length>=2&&segments[0].toLowerCase()!=='sets'){
    return `soundcloud:track:${segments[0].toLowerCase()}/${segments[1].toLowerCase()}`;
  }
  if(hostIs(host,'audiomack.com')){
    const songIndex=segments.findIndex(segment=>segment.toLowerCase()==='song');
    if(songIndex>0&&segments[songIndex+1]) return `audiomack:track:${segments[songIndex-1].toLowerCase()}/${segments[songIndex+1].toLowerCase()}`;
  }
  if(hostIs(host,'pandora.com')){
    const token=[...segments].reverse().find(segment=>/^TR[\w-]+$/i.test(segment));
    if(token) return `pandora:track:${token.toLowerCase()}`;
  }
  return '';
}
function canonicalTrackUrlKey(value=''){
  let parsed; try{parsed=new URL(String(value||''));}catch{return '';}
  const stable=stablePlatformTrackKey(parsed);
  if(stable) return stable;
  parsed.hash='';
  for(const key of [...parsed.searchParams.keys()]){
    const low=key.toLowerCase();
    if(low.startsWith('utm_')||['si','feature','ref','referrer','share','shared','context'].includes(low)) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();
  const host=normalizedHost(parsed);
  const port=parsed.port?`:${parsed.port}`:'';
  return `${parsed.protocol}//${host}${port}${parsed.pathname.replace(/\/$/,'')}${parsed.search}`;
}
function trackForCurrentUrl(tracks=[],url=''){
  const key=canonicalTrackUrlKey(url); if(!key) return null;
  return (tracks||[]).find(track=>canonicalTrackUrlKey(track?.url)===key)||null;
}
module.exports={createTrackDeck,nextTrack,chooseObservationSeconds,rngFromSeed,assignInitialTracks,createPersistentTrackDeck,trackForCurrentUrl,canonicalTrackUrlKey};
