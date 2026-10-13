const test=require('node:test');
const assert=require('node:assert/strict');
const {canonicalStreamingSourceKey,findStreamingDuplicate}=require('./duplicate-detector.cjs');

const saved=[
  {id:'yt-album',name:'YT Saved',platform:'youtube-music',sourceInput:'https://music.youtube.com/watch?v=k_Y18DRr_nA',canonicalSourceInput:'https://music.youtube.com/watch?v=k_Y18DRr_nA',sourceKind:'track',tracks:[{id:'k_Y18DRr_nA',platform:'youtube-music',title:'Song',url:'https://music.youtube.com/watch?v=k_Y18DRr_nA'}]},
  {id:'tidal-album',name:'TIDAL Album',platform:'tidal',sourceInput:'https://tidal.com/album/308700727',sourceKind:'album',tracks:[{id:'78362249',platform:'tidal',title:'Track',url:'https://tidal.com/track/78362249'}]},
];

test('canonical source keys ignore share/tracking parameters for the same YouTube Music song',()=>{
  assert.equal(
    canonicalStreamingSourceKey('https://music.youtube.com/watch?v=k_Y18DRr_nA&si=EF2nL_FtmKciZxvr'),
    canonicalStreamingSourceKey('https://music.youtube.com/watch?v=k_Y18DRr_nA')
  );
});

test('detects a saved song before it is imported again',()=>{
  const result=findStreamingDuplicate({input:'https://music.youtube.com/watch?v=k_Y18DRr_nA&si=anotherShare',collections:saved});
  assert.equal(result?.duplicate,true);
  assert.equal(result?.kind,'track');
  assert.equal(result?.collectionId,'yt-album');
  assert.match(result?.message||'',/song.*already/i);
});

test('detects a previously saved album source',()=>{
  const result=findStreamingDuplicate({input:'https://tidal.com/browse/album/308700727?utm_source=share',collections:saved});
  assert.equal(result?.duplicate,true);
  assert.equal(result?.kind,'album');
  assert.equal(result?.collectionId,'tidal-album');
  assert.match(result?.message||'',/album.*already/i);
});

test('detects the original saved share link even when the collection also has a canonical resolved source',()=>{
  const collections=[{
    id:'dz',name:'Deezer Saved',platform:'deezer',
    sourceInput:'https://link.deezer.com/s/34qBFbdREYM0STSckr3SU',
    canonicalSourceInput:'https://www.deezer.com/album/1037333712',
    sourceKind:'album',tracks:[],
  }];
  const result=findStreamingDuplicate({input:'https://link.deezer.com/s/34qBFbdREYM0STSckr3SU',collections});
  assert.equal(result?.duplicate,true);
  assert.equal(result?.kind,'album');
});
