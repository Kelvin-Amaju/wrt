const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const hub=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
const importerPath='src/components/SimpleStreamingImporter.tsx';
const albumsPath='src/components/SavedStreamingAlbumsPanel.tsx';

test('Streaming Hub uses the simple link importer for every supported platform',()=>{
  assert.ok(fs.existsSync(importerPath),'SimpleStreamingImporter.tsx should exist');
  assert.match(hub,/SimpleStreamingImporter/);
  assert.match(hub,/resolveStreamingCatalog/);
  assert.doesNotMatch(hub,/SpotifyCatalogConnectionPanel/);
  assert.doesNotMatch(hub,/SavedStreamingArtistsPanel/);
  assert.doesNotMatch(hub,/Complete managed-artist catalog import/i);
});

test('simple importer exposes fetch, select, album name, save, and clear workflow',()=>{
  assert.ok(fs.existsSync(importerPath),'SimpleStreamingImporter.tsx should exist');
  const source=fs.readFileSync(importerPath,'utf8');
  for(const text of ['FETCH SONGS','Select All','Clear Selection','Album name','SAVE ALBUM','Clear Workspace']) assert.match(source,new RegExp(text,'i'));
  assert.match(source,/track\.url/);
});

test('saved albums panel supports open, add songs, rename, select for QA, and delete',()=>{
  assert.ok(fs.existsSync(albumsPath),'SavedStreamingAlbumsPanel.tsx should exist');
  const source=fs.readFileSync(albumsPath,'utf8');
  for(const text of ['OPEN','ADD SONGS','RENAME','Use for QA','DELETE']) assert.match(source,new RegExp(text,'i'));
});

test('link importer automatically detects the pasted service and does not require manual tab switching',()=>{
  const hub=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
  const importer=fs.readFileSync(importerPath,'utf8');
  assert.match(hub,/detectStreamingPlatformFromInput/);
  assert.match(hub,/setPlatform\(/);
  assert.match(importer,/automatically detect|auto-detect/i);
});

test('saved albums library is unified across platforms and shows a platform tag on every card',()=>{
  const hubSource=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
  const albumSource=fs.readFileSync(albumsPath,'utf8');
  assert.match(hubSource,/albums=\{collections\}/);
  assert.doesNotMatch(hubSource,/albums=\{platformAlbums\}/);
  assert.match(albumSource,/platform/i);
  assert.match(albumSource,/platform-tag|stream-platform-tag/i);
});

test('Streaming Hub has a dedicated Music Library menu page for Link Importer and Saved Albums',()=>{
  const app=fs.readFileSync('src/App.tsx','utf8');
  const sidebar=fs.readFileSync('src/components/Sidebar.tsx','utf8');
  assert.match(sidebar,/streaming-library/);
  assert.match(sidebar,/Music Library|Link Importer/i);
  assert.match(app,/streaming-library/);
  assert.match(hub,/view/);
});

test('link importer surfaces automatic duplicate detection before saving another source',()=>{
  const preload=fs.readFileSync('electron/preload.cjs','utf8');
  assert.match(hub,/checkStreamingDuplicate/);
  assert.match(importerPath && fs.readFileSync(importerPath,'utf8'),/already been added|already saved/i);
  assert.match(preload,/checkStreamingDuplicate/);
});

test('Music Library supports manual link saving when catalog fetching is unreliable',()=>{
  const importer=fs.readFileSync(importerPath,'utf8');
  const hubSource=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
  assert.match(importer,/SAVE LINK MANUALLY/);
  assert.match(importer,/Manual link save/i);
  assert.match(importer,/Song/);
  assert.match(importer,/Album/);
  assert.match(importer,/Artist/);
  assert.match(importer,/Playlist/);
  assert.match(hubSource,/saveManualLink/);
  assert.match(hubSource,/inferManualStreamingKind/);
});

test('saved music and saved tracks expose explicit visual verification controls',()=>{
  const importer=fs.readFileSync(importerPath,'utf8');
  const albums=fs.readFileSync(albumsPath,'utf8');
  const hubSource=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
  assert.match(albums,/MARK VERIFIED/);
  assert.match(albums,/RE-VERIFY/);
  assert.match(albums,/VERIFIED/);
  assert.match(importer,/MARK VERIFIED/);
  assert.match(importer,/RE-VERIFY/);
  assert.match(albums,/stream-verification-confirm-card/);
  assert.match(albums,/stream-mixed-device-card--selected/);
  assert.match(importer,/stream-verification-confirm-card/);
  assert.match(importer,/stream-verification-primary/);
  assert.match(hubSource,/startStreamingLinkVerification/);
  assert.match(hubSource,/completeStreamingLinkVerification/);
  assert.match(hubSource,/VERIFICATION VIEW/);
});
