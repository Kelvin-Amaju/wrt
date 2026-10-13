const test=require('node:test'); const assert=require('node:assert/strict'); const {createCatalogService}=require('./catalog-service.cjs');
test('catalog service normalizes and deduplicates track ids',async()=>{const adapter={id:'spotify',label:'Spotify',classifyInput:()=> 'artist',normalizeTrack:r=>({...r,platform:'spotify'}),resolveCatalog:async()=>({tracks:[{id:'1',title:'A',url:'u1'},{id:'1',title:'A2',url:'u1'},{id:'2',title:'B',url:'u2'}]})}; const svc=createCatalogService({adapters:[adapter]}); const out=await svc.resolve({platform:'spotify',input:'x'}); assert.equal(out.tracks.length,2); assert.equal(out.kind,'artist');});

test('catalog service auto-routes a pasted URL to its detected platform instead of trusting the selected tab',async()=>{
  const calls=[];
  const make=(id)=>({id,label:id,supports:{},classifyInput:()=> 'playlist',normalizeTrack:r=>({...r,platform:id}),resolveCatalog:async({input})=>{calls.push(id);return {kind:'playlist',tracks:[{id:`${id}-1`,title:`${id} song`,url:input}]};}});
  const svc=createCatalogService({adapters:[make('spotify'),make('youtube-music'),make('soundcloud'),make('deezer'),make('tidal'),make('audiomack'),make('pandora')]});
  const out=await svc.resolve({platform:'spotify',input:'https://www.deezer.com/en/album/12345'});
  assert.deepEqual(calls,['deezer']);
  assert.equal(out.platform,'deezer');
  assert.equal(out.tracks[0].platform,'deezer');
});

test('catalog service rejects unsupported web links instead of sending them to whichever tab is selected',async()=>{
  const adapter={id:'spotify',label:'Spotify',supports:{},classifyInput:()=> 'search',normalizeTrack:r=>r,resolveCatalog:async()=>({tracks:[]})};
  const svc=createCatalogService({adapters:[adapter]});
  await assert.rejects(()=>svc.resolve({platform:'spotify',input:'https://example.com/not-a-music-service'}),/supported.*music link|unsupported.*link/i);
});
