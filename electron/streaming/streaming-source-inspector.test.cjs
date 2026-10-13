const test=require('node:test');
const assert=require('node:assert/strict');

function artist(id,name){return {id,name,external_urls:{spotify:`https://open.spotify.com/artist/${id}`},images:[{url:`https://img/${id}.jpg`}]};}

test('playlist returns distinct artists and does not auto-select one', async()=>{
  const {createStreamingSourceInspector}=require('./streaming-source-inspector.cjs');
  const client={
    getPlaylist:async()=>({id:'p1',name:'P'}),
    getPlaylistTracks:async()=>[
      {track:{artists:[artist('a1','One'),artist('a2','Two')]}},
      {track:{artists:[artist('a1','One')]}},
      {track:{artists:[artist('a3','Three')]}}
    ],
  };
  const result=await createStreamingSourceInspector({spotifyClient:client}).inspect({input:'https://open.spotify.com/playlist/p1?si=x'});
  assert.equal(result.kind,'playlist');
  assert.deepEqual(result.candidateArtists.map(a=>a.platformArtistId),['a1','a2','a3']);
  assert.deepEqual(result.candidateArtists.map(a=>a.sourceTrackCount),[2,1,1]);
  assert.equal(result.autoSelectedArtistId,undefined);
});

test('artist URL auto-selects exact artist', async()=>{
  const {createStreamingSourceInspector}=require('./streaming-source-inspector.cjs');
  const result=await createStreamingSourceInspector({spotifyClient:{getArtist:async id=>artist(id,'Exact')}}).inspect({input:'https://open.spotify.com/artist/a1?si=z'});
  assert.equal(result.kind,'artist'); assert.equal(result.autoSelectedArtistId,'a1'); assert.equal(result.candidateArtists[0].artistName,'Exact');
});

test('single-artist album auto-selects and multi-artist album waits for choice', async()=>{
  const {createStreamingSourceInspector}=require('./streaming-source-inspector.cjs');
  let multi=false;
  const inspector=createStreamingSourceInspector({spotifyClient:{getAlbum:async()=>({id:'al',artists:multi?[artist('a1','One'),artist('a2','Two')]:[artist('a1','One')]})}});
  let r=await inspector.inspect({input:'https://open.spotify.com/album/al'}); assert.equal(r.autoSelectedArtistId,'a1');
  multi=true; r=await inspector.inspect({input:'https://open.spotify.com/album/al'}); assert.equal(r.autoSelectedArtistId,undefined); assert.equal(r.candidateArtists.length,2);
});

test('track resolves credited artists and search returns artist candidates only', async()=>{
  const {createStreamingSourceInspector}=require('./streaming-source-inspector.cjs');
  const client={getTrack:async()=>({id:'t',artists:[artist('a1','One'),artist('a2','Two')]}),searchArtists:async()=>[artist('a3','Three')]};
  const inspector=createStreamingSourceInspector({spotifyClient:client});
  const track=await inspector.inspect({input:'https://open.spotify.com/track/t'}); assert.equal(track.autoSelectedArtistId,undefined); assert.equal(track.candidateArtists.length,2);
  const search=await inspector.inspect({input:'Three artist'}); assert.equal(search.kind,'search'); assert.deepEqual(search.candidateArtists.map(a=>a.platformArtistId),['a3']);
});
