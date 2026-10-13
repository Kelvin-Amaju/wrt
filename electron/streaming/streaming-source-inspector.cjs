function candidateFromArtist(artist, sourceTrackCount){
  if(!artist?.id) return null;
  return {
    platformArtistId:String(artist.id),
    artistName:String(artist.name||'Unknown artist'),
    artistUrl:String(artist.external_urls?.spotify||`https://open.spotify.com/artist/${artist.id}`),
    ...(artist.images?.[0]?.url?{artworkUrl:String(artist.images[0].url)}:{}),
    ...(sourceTrackCount!==undefined?{sourceTrackCount}:{}),
  };
}
function classifyInput(input){
  const text=String(input||'').trim();
  try{
    const url=new URL(text);
    if(url.hostname==='open.spotify.com'||url.hostname==='www.open.spotify.com'){
      const parts=url.pathname.split('/').filter(Boolean);
      const kind=parts[0]; const id=parts[1];
      if(['artist','album','track','playlist'].includes(kind)&&id) return {kind,id,input:text};
    }
  }catch{}
  return {kind:'search',id:null,input:text};
}
function uniqueArtists(artists){const map=new Map(); for(const a of artists||[]){if(!a?.id||map.has(a.id)) continue; map.set(a.id,a);} return [...map.values()];}
function createStreamingSourceInspector({spotifyClient}={}){
  if(!spotifyClient) throw new Error('spotifyClient is required');
  async function inspect({input,signal}={}){
    if(signal?.aborted) throw new Error('Streaming catalog request cancelled');
    const info=classifyInput(input);
    if(!info.input) throw new Error('Enter a Spotify artist, album, track, playlist URL or artist search query');
    if(info.kind==='artist'){
      const artist=await spotifyClient.getArtist(info.id,{signal}); const c=candidateFromArtist(artist);
      return {kind:'artist',input:info.input,sourceId:info.id,candidateArtists:c?[c]:[],autoSelectedArtistId:c?.platformArtistId};
    }
    if(info.kind==='album'){
      const album=await spotifyClient.getAlbum(info.id,{signal}); const candidates=uniqueArtists(album?.artists).map(a=>candidateFromArtist(a)).filter(Boolean);
      return {kind:'album',input:info.input,sourceId:info.id,candidateArtists:candidates,...(candidates.length===1?{autoSelectedArtistId:candidates[0].platformArtistId}:{})};
    }
    if(info.kind==='track'){
      const track=await spotifyClient.getTrack(info.id,{signal}); const candidates=uniqueArtists(track?.artists).map(a=>candidateFromArtist(a)).filter(Boolean);
      return {kind:'track',input:info.input,sourceId:info.id,candidateArtists:candidates,...(candidates.length===1?{autoSelectedArtistId:candidates[0].platformArtistId}:{})};
    }
    if(info.kind==='playlist'){
      await spotifyClient.getPlaylist(info.id,{signal});
      const rows=await spotifyClient.getPlaylistTracks(info.id,{signal});
      const map=new Map();
      for(const row of rows){
        const track=row?.track||row; if(!track) continue;
        for(const a of track.artists||[]){
          if(!a?.id) continue;
          const existing=map.get(a.id)||{artist:a,count:0}; existing.count+=1; if(!existing.artist?.images?.length&&a.images?.length) existing.artist=a; map.set(a.id,existing);
        }
      }
      const candidates=[...map.values()].map(({artist,count})=>candidateFromArtist(artist,count)).filter(Boolean);
      return {kind:'playlist',input:info.input,sourceId:info.id,candidateArtists:candidates};
    }
    const artists=await spotifyClient.searchArtists(info.input,{signal});
    const candidates=uniqueArtists(artists).map(a=>candidateFromArtist(a)).filter(Boolean);
    return {kind:'search',input:info.input,candidateArtists:candidates,...(candidates.length===1?{autoSelectedArtistId:candidates[0].platformArtistId}:{})};
  }
  return {inspect,classifyInput};
}
module.exports={createStreamingSourceInspector,classifyInput,candidateFromArtist};
