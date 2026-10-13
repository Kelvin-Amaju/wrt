function normalizeTitle(value){return String(value||'').trim().toLowerCase().replace(/\s+/g,' ');}
function artistCandidate(a){return {platformArtistId:String(a.id),artistName:String(a.name||'Unknown artist'),artistUrl:String(a.external_urls?.spotify||`https://open.spotify.com/artist/${a.id}`),...(a.images?.[0]?.url?{artworkUrl:String(a.images[0].url)}:{})};}
function trackRecord(track,release){
  const ids=(track.artists||[]).map(a=>String(a.id||'')).filter(Boolean);
  const names=(track.artists||[]).map(a=>String(a.name||'')).filter(Boolean);
  const releaseId=String(release?.id||track.album?.id||'');
  return {
    id:String(track.id),spotifyTrackId:String(track.id),platform:'spotify',title:String(track.name||'Untitled'),artist:names.join(', '),album:String(release?.name||track.album?.name||''),url:String(track.external_urls?.spotify||`https://open.spotify.com/track/${track.id}`),durationSeconds:Math.round((Number(track.duration_ms)||0)/1000),artworkUrl:release?.images?.[0]?.url||track.album?.images?.[0]?.url,
    creditedArtistIds:ids,creditedArtistNames:names,releaseId:releaseId||undefined,releaseName:release?.name||track.album?.name,releaseDate:release?.release_date||track.album?.release_date,isrc:track.external_ids?.isrc,alternateReleaseIds:releaseId?[releaseId]:[],unavailable:false,
  };
}
function deduplicateTracks(rows){
  const output=[]; const byTrack=new Map(); const byIsrc=new Map(); const fallback=[];
  for(const row of rows){
    let existing=byTrack.get(row.spotifyTrackId);
    if(!existing&&row.isrc) existing=byIsrc.get(row.isrc);
    if(!existing){
      const keyTitle=normalizeTitle(row.title); const ids=[...(row.creditedArtistIds||[])].sort().join('|'); const duration=Number(row.durationSeconds)||0;
      existing=fallback.find(x=>x.keyTitle===keyTitle&&x.ids===ids&&Math.abs(x.duration-duration)<=2)?.row;
    }
    if(existing){
      const merged=new Set([...(existing.alternateReleaseIds||[]),...(row.alternateReleaseIds||[])]); existing.alternateReleaseIds=[...merged];
      continue;
    }
    output.push(row); byTrack.set(row.spotifyTrackId,row); if(row.isrc) byIsrc.set(row.isrc,row); fallback.push({keyTitle:normalizeTitle(row.title),ids:[...(row.creditedArtistIds||[])].sort().join('|'),duration:Number(row.durationSeconds)||0,row});
  }
  return output;
}
async function mapConcurrent(items,limit,fn){let cursor=0; const results=new Array(items.length); async function worker(){while(true){const i=cursor++; if(i>=items.length) return; results[i]=await fn(items[i],i);}} await Promise.all(Array.from({length:Math.max(1,Math.min(limit,items.length||1))},worker)); return results;}
function createStreamingArtistService({spotifyClient,savedArtistStore,now=()=>new Date(),catalogConcurrency=4}={}){
  if(!spotifyClient) throw new Error('spotifyClient is required');
  async function fetchCatalog({platformArtistId,previousArtist,signal,onProgress=()=>{}}={}){
    if(!platformArtistId) throw new Error('platformArtistId is required');
    const progress=(stage,message,completed,total)=>onProgress({stage,message,...(completed!==undefined?{completed}:{}),...(total!==undefined?{total}:{})});
    if(signal?.aborted) throw new Error('Streaming catalog request cancelled');
    progress('resolving','Resolving exact Spotify artist');
    const artist=await spotifyClient.getArtist(platformArtistId,{signal});
    let releasePagesFetched=0;
    progress('releases','Fetching all artist releases');
    const rawReleases=await spotifyClient.getArtistReleases(platformArtistId,{signal,onPage:()=>{releasePagesFetched++;}});
    if(rawReleases.length && releasePagesFetched===0) releasePagesFetched=1;
    const releaseMap=new Map(); for(const r of rawReleases||[]) if(r?.id&&!releaseMap.has(r.id)) releaseMap.set(r.id,r); const releases=[...releaseMap.values()];
    const failedReleaseIds=[]; let rawTracksInspected=0; const eligible=[];
    progress('release-tracks','Fetching tracks from every release',0,releases.length);
    await mapConcurrent(releases,catalogConcurrency,async(release,index)=>{
      if(signal?.aborted) throw new Error('Streaming catalog request cancelled');
      try{
        const tracks=await spotifyClient.getReleaseTracks(release.id,{signal}); rawTracksInspected+=tracks.length;
        for(const t of tracks){if((t.artists||[]).some(a=>String(a.id)===String(platformArtistId))) eligible.push(trackRecord(t,release));}
      }catch{failedReleaseIds.push(String(release.id));}
      progress('release-tracks',`Fetched ${index+1} of ${releases.length} releases`,index+1,releases.length);
    });
    progress('filtering','Filtering by exact Spotify artist ID');
    progress('deduplicating','Deduplicating repeated release copies');
    let tracks=deduplicateTracks(eligible);
    if(previousArtist){
      const previousById=new Map((previousArtist.catalogTracks||[]).map(t=>[String(t.spotifyTrackId||t.id),t]));
      const currentIds=new Set(tracks.map(t=>String(t.spotifyTrackId||t.id)));
      tracks=tracks.map(t=>{const id=String(t.spotifyTrackId||t.id); const old=previousById.get(id); return old?{...t,discoveredAt:old.discoveredAt,isNew:false}:{...t,discoveredAt:now().toISOString(),isNew:true};});
      for(const old of previousArtist.catalogTracks||[]){const id=String(old.spotifyTrackId||old.id); if(!currentIds.has(id)) tracks.push({...old,unavailable:true,isNew:false});}
    }
    const status=failedReleaseIds.length?'partial':'complete';
    const completeness={releasePagesFetched,releasesInspected:releases.length,rawTracksInspected,eligibleTracks:eligible.length,deduplicatedTracks:tracks.filter(t=>!t.unavailable).length,failedReleaseIds};
    progress('complete',status==='complete'?'Complete artist catalog fetched':'Artist catalog fetched with partial failures',tracks.length,tracks.length);
    return {status,artist:artistCandidate(artist),tracks,completeness,...(failedReleaseIds.length?{error:`${failedReleaseIds.length} release(s) could not be fetched`}:{})};
  }
  async function refreshSavedArtist({savedArtistId,signal,onProgress}={}){if(!savedArtistStore) throw new Error('savedArtistStore is required'); const previous=savedArtistStore.get(savedArtistId); if(!previous) throw new Error('Saved artist not found'); const result=await fetchCatalog({platformArtistId:previous.platformArtistId,previousArtist:previous,signal,onProgress}); return savedArtistStore.upsertArtist({previous,result,sourceOrigin:null});}
  return {fetchCatalog,refreshSavedArtist};
}
module.exports={createStreamingArtistService,deduplicateTracks};
