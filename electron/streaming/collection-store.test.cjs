const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path');
const {createCollectionStore}=require('./collection-store.cjs');
test('collection store persists reloads and deletes atomically',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-col-')); const s=createCollectionStore({baseDir:dir}); const saved=s.save({name:'QA Tracks',platform:'spotify',sourceInput:'artist',sourceKind:'artist',tracks:[{id:'t1',platform:'spotify',title:'A',url:'https://x'}]}); assert.ok(saved.id); assert.equal(s.list().length,1); const s2=createCollectionStore({baseDir:dir}); assert.equal(s2.get(saved.id).name,'QA Tracks'); s2.delete(saved.id); assert.equal(s2.list().length,0);});
test('malformed collection file does not crash listing',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-col-')); const root=path.join(dir,'streaming-collections'); fs.mkdirSync(root,{recursive:true}); fs.writeFileSync(path.join(root,'bad.json'),'{'); const s=createCollectionStore({baseDir:dir}); assert.deepEqual(s.list(),[]);});

test('legacy conversion leaves source file byte-for-byte intact on failure and success',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-col-convert-'));
  const s=createCollectionStore({baseDir:dir});
  const saved=s.save({name:'Legacy',platform:'spotify',sourceInput:'artist',sourceKind:'artist',tracks:[{id:'t1',platform:'spotify',title:'A',url:'https://open.spotify.com/track/t1'}]});
  const file=path.join(dir,'streaming-collections',`${saved.id}.json`); const before=fs.readFileSync(file);
  const failed=s.convertLegacy(saved.id,{artistResult:{artist:{platformArtistId:'a1'},tracks:[]},savedArtistStore:{upsertArtist(){throw new Error('must not save')}}});
  assert.equal(failed.converted,false); assert.deepEqual(fs.readFileSync(file),before);
  let savedInput=null;
  const result={status:'complete',artist:{platformArtistId:'a1',artistName:'Artist',artistUrl:'https://open.spotify.com/artist/a1'},tracks:[{id:'t1',spotifyTrackId:'t1',platform:'spotify',title:'A',url:'https://open.spotify.com/track/t1',creditedArtistIds:['a1'],creditedArtistNames:['Artist']}],completeness:{}};
  const ok=s.convertLegacy(saved.id,{artistResult:result,savedArtistStore:{upsertArtist(input){savedInput=input; return {id:'managed-1',artistName:'Artist'};}}});
  assert.equal(ok.converted,true); assert.equal(ok.artist.id,'managed-1'); assert.deepEqual(savedInput.selectedTrackIds,['t1']); assert.deepEqual(fs.readFileSync(file),before);
});

test('collection store treats missing verification metadata as unverified and can mark a collection verified',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-col-verify-'));
  const s=createCollectionStore({baseDir:dir});
  const saved=s.save({name:'Manual album',platform:'youtube-music',sourceInput:'https://music.youtube.com/playlist?list=abc',sourceKind:'playlist',tracks:[]});
  assert.equal(s.get(saved.id).verification,undefined);
  const verified=s.markVerified(saved.id,{url:saved.sourceInput,deviceMode:'desktop',deviceProfile:'Desktop 1280x720',verifiedAt:'2026-09-18T10:00:00.000Z'});
  assert.equal(verified.verification.status,'verified');
  assert.equal(verified.verification.verifiedUrl,saved.sourceInput);
  assert.equal(verified.verification.verifiedDeviceMode,'desktop');
});

test('collection store can mark one saved track verified without changing other tracks',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-track-verify-'));
  const s=createCollectionStore({baseDir:dir});
  const saved=s.save({name:'Songs',platform:'youtube-music',sourceInput:'manual',sourceKind:'playlist',tracks:[
    {id:'a',platform:'youtube-music',title:'A',url:'https://music.youtube.com/watch?v=a'},
    {id:'b',platform:'youtube-music',title:'B',url:'https://music.youtube.com/watch?v=b'},
  ]});
  const verified=s.markVerified(saved.id,{trackId:'b',url:'https://music.youtube.com/watch?v=b',deviceMode:'android',deviceProfile:'Pixel 7',verifiedAt:'2026-09-18T10:01:00.000Z'});
  assert.equal(verified.tracks[0].verification,undefined);
  assert.equal(verified.tracks[1].verification.status,'verified');
  assert.equal(verified.tracks[1].verification.verifiedDeviceProfile,'Pixel 7');
});
