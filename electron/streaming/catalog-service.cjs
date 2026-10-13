const {listPlatformAdapters,detectPlatformFromInput}=require('./platform-adapter.cjs');
function createCatalogService({adapters=listPlatformAdapters()}={}){
  const byId=new Map(adapters.map(a=>[a.id,a]));
  return {
    listPlatforms:()=>adapters.map(({id,label,supports})=>({id,label,supports})),
    async resolve({platform,input,page,signal,networkJson,fetchJson,fetchText}){
      const text=String(input||'').trim();
      const detected=detectPlatformFromInput(text);
      if(/^https?:\/\//i.test(text) && !detected) throw new Error('Unsupported music link. Paste a Spotify, YouTube Music, SoundCloud, Deezer, TIDAL, Audiomack, or Pandora link.');
      const platformId=detected||platform;
      const a=byId.get(platformId);
      if(!a) throw new Error(`Unsupported streaming platform: ${platformId||'unknown'}`);
      if(signal?.aborted) throw new Error('Streaming catalog request cancelled');
      const kind=a.classifyInput(input);
      const raw=await a.resolveCatalog({input,page,signal,networkJson,fetchJson,fetchText});
      const seen=new Set(); const tracks=[];
      for(const r of raw?.tracks||[]){
        const t=a.normalizeTrack(r); const key=t.id||t.url;
        if(!key||seen.has(key)) continue;
        seen.add(key); tracks.push(t);
      }
      return {platform:a.id,kind:raw?.kind||kind,input,tracks};
    }
  };
}
module.exports={createCatalogService};
