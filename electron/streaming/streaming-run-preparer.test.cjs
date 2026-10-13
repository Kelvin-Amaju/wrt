const test=require('node:test');
const assert=require('node:assert/strict');

const track=(id)=>({id,spotifyTrackId:id,platform:'spotify',title:id,url:`https://open.spotify.com/track/${id}`,creditedArtistIds:['a'],creditedArtistNames:['A']});
const artist=(id,selected,tracks,extra={})=>({schemaVersion:2,id,platform:'spotify',platformArtistId:`p-${id}`,artistName:id,artistUrl:`https://open.spotify.com/artist/p-${id}`,sourceOrigins:[],catalogTracks:tracks.map(track),selectedTrackIds:selected,autoRefreshEnabled:false,lastFetchedAt:'2026-09-17T10:00:00.000Z',lastFetchStatus:'complete',createdAt:'x',updatedAt:'x',...extra});

test('all and selected modes use only saved selected tracks and deduplicate canonical ids',async()=>{
  const {createStreamingRunPreparer}=require('./streaming-run-preparer.cjs');
  const rows=[artist('a1',['t1','shared'],['t1','shared','unsaved']),artist('a2',['shared','t2'],['shared','t2'])];
  const store={list:()=>rows,get:id=>rows.find(a=>a.id===id)};
  const preparer=createStreamingRunPreparer({savedArtistStore:store,artistService:{},now:()=>new Date('2026-09-17T11:00:00Z')});
  const all=await preparer.prepare({mode:'all',savedArtistIds:[]}); assert.deepEqual(all.tracks.map(t=>t.spotifyTrackId),['t1','shared','t2']);
  const selected=await preparer.prepare({mode:'selected',savedArtistIds:['a2']}); assert.deepEqual(selected.tracks.map(t=>t.spotifyTrackId),['shared','t2']);
});

test('stale auto-refresh artists refresh before run, fresh artists do not, and new unsaved tracks stay out',async()=>{
  const {createStreamingRunPreparer}=require('./streaming-run-preparer.cjs');
  let rows=[artist('stale',['old'],['old'],{autoRefreshEnabled:true,lastFetchedAt:'2026-09-17T00:00:00.000Z'}),artist('fresh',['fresh'],['fresh'],{autoRefreshEnabled:true,lastFetchedAt:'2026-09-17T10:30:00.000Z'})];
  const refreshed=[];
  const store={list:()=>rows,get:id=>rows.find(a=>a.id===id)};
  const service={refreshSavedArtist:async({savedArtistId})=>{refreshed.push(savedArtistId); const old=rows.find(a=>a.id===savedArtistId); const next={...old,lastFetchedAt:'2026-09-17T11:00:00.000Z',catalogTracks:[...old.catalogTracks,track('new')],selectedTrackIds:[...old.selectedTrackIds]}; rows=rows.map(a=>a.id===savedArtistId?next:a); return next;}};
  const preparer=createStreamingRunPreparer({savedArtistStore:store,artistService:service,now:()=>new Date('2026-09-17T11:00:00Z'),freshnessMs:6*60*60*1000});
  const out=await preparer.prepare({mode:'all',savedArtistIds:[]}); assert.deepEqual(refreshed,['stale']); assert.deepEqual(out.tracks.map(t=>t.spotifyTrackId).sort(),['fresh','old']);
});

test('partial refresh warns but preserves last safe selected cached set',async()=>{
  const {createStreamingRunPreparer}=require('./streaming-run-preparer.cjs');
  const row=artist('a',['t1'],['t1'],{autoRefreshEnabled:true,lastFetchedAt:'2026-09-16T00:00:00.000Z'});
  const store={list:()=>[row],get:()=>row};
  const service={refreshSavedArtist:async()=>{throw new Error('partial refresh failed')}};
  const p=createStreamingRunPreparer({savedArtistStore:store,artistService:service,now:()=>new Date('2026-09-17T11:00:00Z')});
  const out=await p.prepare({mode:'all',savedArtistIds:[]}); assert.deepEqual(out.tracks.map(t=>t.spotifyTrackId),['t1']); assert.equal(out.warnings.length,1);
});

test('streaming run request sanitizer allowlists QA fields and drops OAuth or account-secret material',()=>{
  const {sanitizeStreamingRunRequest}=require('./streaming-run-preparer.cjs');
  const input={runKind:'streaming',platform:'spotify',collectionIds:[],savedArtistIds:['a'],savedArtistSelection:{mode:'selected',artistIds:['a']},trackIds:[],accountIds:['acct'],slots:1,observation:{minSeconds:60,maxSeconds:90},queueMode:'shuffle',playbackSpeed:1,restAfterTracks:0,restMinutes:0,checks:['playback'],executionMode:'visible',captureScreenshots:true,pauseResumeSeconds:2.5,volumeDirection:'increase',requestedWorkUnits:1,concurrency:{mode:'manual',value:1},access_token:'secret-token',refresh_token:'refresh-secret',password:'pw',sessionBlob:'cookie-secret',oauth:{accessToken:'nested-secret'}};
  const output=sanitizeStreamingRunRequest(input);
  assert.equal(output.platform,'spotify');
  assert.deepEqual(output.savedArtistIds,['a']);
  const serialized=JSON.stringify(output);
  for(const secret of ['secret-token','refresh-secret','pw','cookie-secret','nested-secret']) assert.equal(serialized.includes(secret),false);
  assert.equal('access_token' in output,false);
  assert.equal('oauth' in output,false);
  assert.equal(output.pauseResumeSeconds,2.5);
  assert.equal(output.volumeDirection,'increase');
});
