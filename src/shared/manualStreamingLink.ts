import type { StreamingInputKind } from './streaming';

export function inferManualStreamingKind(input:string):StreamingInputKind {
  let url:URL;
  try{url=new URL(String(input||'').trim());}catch{return 'search';}
  const host=url.hostname.toLowerCase().replace(/^www\./,'');
  const path=url.pathname.replace(/\/+$/,'')||'/';

  if(host==='youtu.be') return 'track';
  if(host==='music.youtube.com'||host==='youtube.com'||host.endsWith('.youtube.com')){
    if(url.searchParams.get('v')) return 'track';
    if(url.searchParams.get('list')) return 'playlist';
    if(/^\/(channel\/|@)/i.test(path)) return 'artist';
    return 'search';
  }


  if(host==='music.apple.com'||host.endsWith('.music.apple.com')){
    if(/\/album\//i.test(path)&&url.searchParams.get('i')) return 'track';
    if(/\/album\//i.test(path)) return 'album';
    if(/\/playlist\//i.test(path)) return 'playlist';
    if(/\/artist\//i.test(path)) return 'artist';
    return 'search';
  }

  if(host==='open.spotify.com'||host.endsWith('.spotify.com')){
    const match=path.match(/\/(track|album|playlist|artist)\//i);
    return (match?.[1]?.toLowerCase() as StreamingInputKind)||'search';
  }

  if(host==='soundcloud.com'||host.endsWith('.soundcloud.com')){
    const parts=path.split('/').filter(Boolean);
    if(parts[1]?.toLowerCase()==='sets') return 'playlist';
    if(parts.length>=2) return 'track';
    if(parts.length===1) return 'artist';
    return 'search';
  }

  if(host==='deezer.com'||host.endsWith('.deezer.com')){
    const match=path.match(/\/(track|album|playlist|artist)\//i);
    return (match?.[1]?.toLowerCase() as StreamingInputKind)||'search';
  }

  if(host==='tidal.com'||host.endsWith('.tidal.com')){
    const match=path.match(/\/(?:browse\/)?(track|album|playlist|artist)\//i);
    return (match?.[1]?.toLowerCase() as StreamingInputKind)||'search';
  }

  if(host==='audiomack.com'||host.endsWith('.audiomack.com')){
    const match=path.match(/\/(song|album|playlist)\//i);
    if(match?.[1]?.toLowerCase()==='song') return 'track';
    if(match?.[1]) return match[1].toLowerCase() as StreamingInputKind;
    const parts=path.split('/').filter(Boolean);
    return parts.length===1?'artist':'search';
  }

  if(host==='pandora.com'||host.endsWith('.pandora.com')){
    const token=path.split('/').filter(Boolean).at(-1)||'';
    if(/^TR[a-z0-9]+$/i.test(token)) return 'track';
    if(/^AL[a-z0-9]+$/i.test(token)) return 'album';
    if(/^PL[a-z0-9]+$/i.test(token)) return 'playlist';
    if(/\/artist\//i.test(path)) return 'artist';
    return 'search';
  }

  return 'search';
}
