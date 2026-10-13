function abortError(){const err=new Error('Spotify catalog request cancelled'); err.name='AbortError'; return err;}
function createSpotifyCatalogClient({auth,fetchImpl=global.fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxRetries=3}={}){
  if(!auth?.getValidAccessToken) throw new Error('Spotify catalog auth is required');
  if(typeof fetchImpl!=='function') throw new Error('fetch implementation is required');
  const absolute=value=>/^https?:\/\//i.test(String(value||''))?String(value):`https://api.spotify.com/v1${String(value||'').startsWith('/')?'':'/'}${String(value||'')}`;
  async function requestJson(pathOrUrl,{signal}={}){
    if(signal?.aborted) throw abortError();
    const url=absolute(pathOrUrl);
    for(let attempt=0;;attempt++){
      if(signal?.aborted) throw abortError();
      const token=await auth.getValidAccessToken();
      let response;
      try{response=await fetchImpl(url,{method:'GET',headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal});}
      catch(err){if(signal?.aborted||err?.name==='AbortError') throw abortError(); if(attempt>=maxRetries) throw new Error('Spotify catalog request failed (network)'); await sleep(250*Math.pow(2,attempt)); continue;}
      if(response?.ok) return await response.json();
      const status=Number(response?.status)||0;
      const transient=status===429||status>=500;
      if(!transient||attempt>=maxRetries) throw new Error(`Spotify catalog request failed (${status||'network'})`);
      let waitMs=250*Math.pow(2,attempt);
      if(status===429){const value=response?.headers?.get?.('retry-after'); const seconds=Number(value); if(Number.isFinite(seconds)&&seconds>=0) waitMs=Math.max(0,seconds*1000);}
      await sleep(waitMs);
    }
  }
  async function paginate(pathOrUrl,{signal,onPage}={}){
    if(signal?.aborted) throw abortError();
    let next=pathOrUrl; const items=[]; let pageIndex=0;
    while(next){
      if(signal?.aborted) throw abortError();
      const page=await requestJson(next,{signal}); pageIndex++;
      const pageItems=Array.isArray(page?.items)?page.items:[]; items.push(...pageItems);
      if(onPage) await onPage({page,pageIndex,items:pageItems,total:items.length});
      next=page?.next||null;
    }
    return items;
  }
  const enc=encodeURIComponent;
  return {
    requestJson,paginate,
    getArtist:(id,o)=>requestJson(`/artists/${enc(id)}`,o),
    getAlbum:(id,o)=>requestJson(`/albums/${enc(id)}`,o),
    getTrack:(id,o)=>requestJson(`/tracks/${enc(id)}`,o),
    getPlaylist:(id,o)=>requestJson(`/playlists/${enc(id)}`,o),
    getPlaylistTracks:(id,o={})=>paginate(`/playlists/${enc(id)}/tracks?limit=100`,o),
    searchArtists:(query,o)=>requestJson(`/search?type=artist&limit=20&q=${enc(query)}`,o).then(r=>r?.artists?.items||[]),
    getArtistReleases:(id,o={})=>paginate(`/artists/${enc(id)}/albums?include_groups=album%2Csingle%2Cappears_on%2Ccompilation&limit=50`,o),
    getReleaseTracks:(id,o={})=>paginate(`/albums/${enc(id)}/tracks?limit=50`,o),
  };
}
module.exports={createSpotifyCatalogClient};
