const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

function result(name='Artist',ids=['t1']){return {status:'complete',artist:{platformArtistId:'a1',artistName:name,artistUrl:'https://open.spotify.com/artist/a1'},tracks:ids.map(id=>({id,spotifyTrackId:id,platform:'spotify',title:id,url:`https://open.spotify.com/track/${id}`,creditedArtistIds:['a1'],creditedArtistNames:[name],isNew:id==='t2'})),completeness:{releasePagesFetched:1,releasesInspected:1,rawTracksInspected:ids.length,eligibleTracks:ids.length,deduplicatedTracks:ids.length,failedReleaseIds:[]}};}

test('upserts by exact platform artist id, uses metadata name, and merges origins',()=>{
  const {createSavedArtistStore}=require('./saved-artist-store.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbitqa-saved-artist-'));
  const store=createSavedArtistStore({baseDir:dir,now:()=>new Date('2026-09-17T00:00:00Z')});
  const first=store.upsertArtist({result:result('Real Name',['t1']),selectedTrackIds:['t1'],sourceOrigin:{kind:'artist',input:'artist-url'}});
  const second=store.upsertArtist({result:result('Real Name',['t1','t2']),selectedTrackIds:['t1'],sourceOrigin:{kind:'album',input:'album-url'}});
  assert.equal(first.id,second.id);
  assert.equal(second.artistName,'Real Name');
  assert.deepEqual(second.sourceOrigins.map(x=>x.kind),['artist','album']);
  assert.equal(store.list().length,1);
});

test('selection survives refresh and new tracks are not auto-selected',()=>{
  const {createSavedArtistStore}=require('./saved-artist-store.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbitqa-saved-artist-selection-'));
  const store=createSavedArtistStore({baseDir:dir});
  const first=store.upsertArtist({result:result('Artist',['t1']),selectedTrackIds:['t1'],sourceOrigin:{kind:'artist',input:'x'}});
  const refreshed=store.upsertArtist({result:result('Artist',['t1','t2']),sourceOrigin:null});
  assert.deepEqual(refreshed.selectedTrackIds,['t1']);
  assert.equal(refreshed.catalogTracks.find(t=>t.spotifyTrackId==='t2').isNew,true);
  const changed=store.saveSelection(first.id,['t2']);
  assert.deepEqual(changed.selectedTrackIds,['t2']);
  assert.equal(changed.catalogTracks.find(t=>t.spotifyTrackId==='t2').isNew,false);
});

test('auto refresh persists and deleting one artist does not affect another',()=>{
  const {createSavedArtistStore}=require('./saved-artist-store.cjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbitqa-saved-artist-delete-'));
  const store=createSavedArtistStore({baseDir:dir});
  const a=store.upsertArtist({result:result(),selectedTrackIds:['t1']});
  const bResult=result('Other',['x']); bResult.artist={platformArtistId:'a2',artistName:'Other',artistUrl:'https://open.spotify.com/artist/a2'}; bResult.tracks[0].creditedArtistIds=['a2'];
  const b=store.upsertArtist({result:bResult,selectedTrackIds:['x']});
  assert.equal(store.setAutoRefresh(a.id,false).autoRefreshEnabled,false);
  store.delete(a.id); assert.equal(store.get(a.id),null); assert.equal(store.get(b.id).artistName,'Other');
  assert.equal(fs.readdirSync(path.join(dir,'streaming-artists')).some(n=>n.endsWith('.tmp')),false);
});
