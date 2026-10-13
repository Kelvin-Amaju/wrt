const test=require('node:test');
const assert=require('node:assert/strict');

const artist=(id,name)=>({id,name,external_urls:{spotify:`https://open.spotify.com/artist/${id}`},images:[{url:`img-${id}`}]});
function track(id,title,ids,duration=180000,isrc,extra={}){return {id,name:title,duration_ms:duration,artists:ids.map(([i,n])=>artist(i,n)),external_urls:{spotify:`https://open.spotify.com/track/${id}`},external_ids:isrc?{isrc}:undefined,...extra};}

test('fetches all releases, keeps exact credited artist, rejects same-name wrong id, and reports progress', async()=>{
  const {createStreamingArtistService}=require('./streaming-artist-service.cjs');
  const progress=[];
  const releases=[{id:'r1',name:'Album 1',release_date:'2024',images:[{url:'cover1'}]},{id:'r2',name:'Album 2',release_date:'2025',images:[{url:'cover2'}]}];
  const client={
    getArtist:async()=>artist('a1','Exact Artist'),
    getArtistReleases:async(_id,{onPage}={})=>{onPage?.({pageIndex:1,items:[releases[0]]}); onPage?.({pageIndex:2,items:[releases[1]]}); return releases;},
    getReleaseTracks:async id=>id==='r1'?[track('t1','One',[['a1','Exact Artist']]),track('wrong','Wrong',[['a9','Exact Artist']])]:[track('t2','Feature',[['x','Other'],['a1','Exact Artist']])],
  };
  const result=await createStreamingArtistService({spotifyClient:client,now:()=>new Date('2026-09-17T00:00:00Z')}).fetchCatalog({platformArtistId:'a1',onProgress:p=>progress.push(p)});
  assert.equal(result.status,'complete');
  assert.deepEqual(result.tracks.map(t=>t.spotifyTrackId),['t1','t2']);
  assert.equal(result.completeness.releasePagesFetched,2);
  assert.equal(result.completeness.releasesInspected,2);
  assert.equal(result.completeness.rawTracksInspected,3);
  assert.ok(progress.some(p=>p.stage==='releases'));
  assert.ok(progress.some(p=>p.stage==='filtering'));
  assert.equal(result.tracks[0].releaseName,'Album 1');
});

test('deduplicates same recording by ISRC but keeps remix/live variants', async()=>{
  const {createStreamingArtistService}=require('./streaming-artist-service.cjs');
  const client={getArtist:async()=>artist('a','A'),getArtistReleases:async()=>[{id:'single',name:'Single'},{id:'album',name:'Album'},{id:'live',name:'Live'}],getReleaseTracks:async id=>{
    if(id==='single') return [track('s1','Song',[['a','A']],180000,'ISRC1')];
    if(id==='album') return [track('a1','Song',[['a','A']],181000,'ISRC1')];
    return [track('l1','Song - Live',[['a','A']],220000,'ISRC2')];
  }};
  const result=await createStreamingArtistService({spotifyClient:client}).fetchCatalog({platformArtistId:'a'});
  assert.equal(result.tracks.length,2);
  const song=result.tracks.find(t=>t.title==='Song');
  assert.deepEqual(song.alternateReleaseIds.sort(),['album','single'].sort());
  assert.ok(result.tracks.some(t=>/Live/.test(t.title)));
});

test('release failure yields partial and preserves historical missing tracks as unavailable on refresh', async()=>{
  const {createStreamingArtistService}=require('./streaming-artist-service.cjs');
  const old={id:'old',spotifyTrackId:'old',platform:'spotify',title:'Old',url:'https://open.spotify.com/track/old',creditedArtistIds:['a'],creditedArtistNames:['A']};
  const previousArtist={catalogTracks:[old],selectedTrackIds:['old']};
  const client={getArtist:async()=>artist('a','A'),getArtistReleases:async()=>[{id:'good',name:'Good'},{id:'bad',name:'Bad'}],getReleaseTracks:async id=>{if(id==='bad') throw new Error('boom'); return [track('new','New',[['a','A']])];}};
  const result=await createStreamingArtistService({spotifyClient:client,now:()=>new Date('2026-09-17T00:00:00Z')}).fetchCatalog({platformArtistId:'a',previousArtist});
  assert.equal(result.status,'partial');
  assert.deepEqual(result.completeness.failedReleaseIds,['bad']);
  assert.equal(result.tracks.find(t=>t.spotifyTrackId==='old').unavailable,true);
  assert.equal(result.tracks.find(t=>t.spotifyTrackId==='new').isNew,true);
});
