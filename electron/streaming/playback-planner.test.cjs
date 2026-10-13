const test=require('node:test');
const assert=require('node:assert/strict');
const {
  createTrackDeck,
  nextTrack,
  chooseObservationSeconds,
  assignInitialTracks,
  createPersistentTrackDeck,
  trackForCurrentUrl,
}=require('./playback-planner.cjs');

test('sequential deck advances in order',()=>{let d=createTrackDeck({tracks:['a','b','c'],mode:'sequential',seed:'x'}); let r=nextTrack(d); assert.equal(r.track,'a'); r=nextTrack(r.state); assert.equal(r.track,'b'); r=nextTrack(r.state); assert.equal(r.track,'c'); r=nextTrack(r.state); assert.equal(r.track,null);});
test('loop deck wraps around',()=>{let d=createTrackDeck({tracks:['a','b'],mode:'loop',seed:'x'}); let r=nextTrack(d); r=nextTrack(r.state); r=nextTrack(r.state); assert.equal(r.track,'a');});
test('shuffle is deterministic by seed',()=>{const a=createTrackDeck({tracks:['a','b','c','d'],mode:'shuffle',seed:'same'}).order; const b=createTrackDeck({tracks:['a','b','c','d'],mode:'shuffle',seed:'same'}).order; assert.deepEqual(a,b);});
test('observation duration clamps and chooses within range',()=>{assert.equal(chooseObservationSeconds({minSeconds:110,maxSeconds:60,rng:()=>0}),60); assert.equal(chooseObservationSeconds({minSeconds:60,maxSeconds:110,rng:()=>1}),110);});

test('persistent assignment gives five accounts five unique initial tracks',()=>{
  const tracks=Array.from({length:5},(_,i)=>({id:`t${i+1}`,url:`https://music.example/t${i+1}`}));
  const rows=assignInitialTracks({accountIds:['a1','a2','a3','a4','a5'],tracks,seed:'run'});
  assert.equal(rows.length,5);
  assert.equal(new Set(rows.map(row=>row.track.id)).size,5);
});

test('persistent assignment balances ten accounts across five tracks',()=>{
  const tracks=Array.from({length:5},(_,i)=>({id:`t${i+1}`,url:`https://music.example/t${i+1}`}));
  const rows=assignInitialTracks({accountIds:Array.from({length:10},(_,i)=>`a${i+1}`),tracks,seed:'run'});
  const counts=new Map();
  for(const row of rows) counts.set(row.track.id,(counts.get(row.track.id)||0)+1);
  assert.deepEqual([...counts.values()].sort((a,b)=>a-b),[2,2,2,2,2]);
});

test('persistent deck starts at assigned track and loops without immediate duplicate when alternatives exist',()=>{
  const tracks=[{id:'t1'},{id:'t2'},{id:'t3'}];
  let deck=createPersistentTrackDeck({tracks,initialTrack:tracks[1],seed:'a1'});
  let first=nextTrack(deck); deck=first.state;
  let second=nextTrack(deck);
  assert.equal(first.track.id,'t2');
  assert.notEqual(second.track.id,'t2');
  const seen=new Set([first.track.id,second.track.id]);
  for(let i=0;i<4;i++){const row=nextTrack(second.state);second=row;seen.add(row.track.id);}
  assert.equal(seen.size,3);
});

test('current URL matches only selected canonical track URLs ignoring query/hash',()=>{
  const tracks=[
    {id:'t1',url:'https://open.spotify.com/track/abc?si=old'},
    {id:'t2',url:'https://open.spotify.com/track/def'},
  ];
  assert.equal(trackForCurrentUrl(tracks,'https://open.spotify.com/track/def?context=foo#bar')?.id,'t2');
  assert.equal(trackForCurrentUrl(tracks,'https://open.spotify.com/track/not-selected'),null);
});

test('persistent assignment supports one account and one selected song',()=>{
  const track={id:'only',url:'https://music.example/only'};
  const rows=assignInitialTracks({accountIds:['a1'],tracks:[track],seed:'one'});
  assert.equal(rows.length,1);
  assert.equal(rows[0].accountId,'a1');
  assert.equal(rows[0].track.id,'only');
});

test('persistent assignment keeps unique starts when there are more songs than accounts',()=>{
  const tracks=Array.from({length:8},(_,i)=>({id:`t${i+1}`,url:`https://music.example/t${i+1}`}));
  const rows=assignInitialTracks({accountIds:['a1','a2','a3'],tracks,seed:'more-tracks'});
  assert.equal(rows.length,3);
  assert.equal(new Set(rows.map(row=>row.track.id)).size,3);
});

test('persistent assignment reuses the single selected song for every account',()=>{
  const track={id:'only',url:'https://music.example/only'};
  const rows=assignInitialTracks({accountIds:Array.from({length:10},(_,i)=>`a${i+1}`),tracks:[track],seed:'single'});
  assert.equal(rows.length,10);
  assert.deepEqual([...new Set(rows.map(row=>row.track.id))],['only']);
});

test('observation selection is independently sampled inside the configured range',()=>{
  const low=chooseObservationSeconds({minSeconds:60,maxSeconds:110,rng:()=>0.12});
  const high=chooseObservationSeconds({minSeconds:60,maxSeconds:110,rng:()=>0.88});
  assert.ok(low>=60&&low<=110);
  assert.ok(high>=60&&high<=110);
  assert.notEqual(low,high);
});

test('selected-track URL matching preserves identity across all supported platform URL shapes',()=>{
  const cases=[
    ['spotify','https://open.spotify.com/track/abc123?si=share','https://www.spotify.com/track/abc123?context=queue'],
    ['youtube','https://music.youtube.com/watch?v=YT123&si=share','https://www.youtube.com/watch?v=YT123&feature=share'],
    ['soundcloud','https://soundcloud.com/artist/song?utm_source=clipboard','https://soundcloud.com/artist/song?utm_medium=text'],
    ['deezer','https://www.deezer.com/en/track/123?utm_source=share','https://deezer.com/us/track/123?ref=share'],
    ['tidal','https://tidal.com/browse/track/456?utm_source=share','https://listen.tidal.com/track/456?context=queue'],
    ['audiomack','https://audiomack.com/artist/song/title?utm_source=share','https://www.audiomack.com/artist/song/title?ref=share'],
    ['pandora','https://www.pandora.com/artist/a/album/b/TRABC?utm_source=share','https://pandora.com/artist/a/album/b/TRABC?context=queue'],
  ];
  for(const [id,saved,current] of cases){
    assert.equal(trackForCurrentUrl([{id,url:saved}],current)?.id,id);
    assert.equal(trackForCurrentUrl([{id,url:saved}],current.replace(/(?:abc123|YT123|song|123|456|title|TRABC)/,'different')),null);
  }
});
