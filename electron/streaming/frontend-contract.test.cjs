const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('StreamingHub tests verify the old clickable platform tab row is gone', () => {
  const source = read('src/pages/StreamingHub.test.tsx');
  assert.match(source, /queryByRole\('tab'\).*not\.toBeInTheDocument/);
  assert.doesNotMatch(source, /getByRole\('tab',\{name:new RegExp\(name,'i'\)\}\)/);
});

test('streaming run cards do not repeat the generic Streaming QA device-family badge', () => {
  const source = read('src/components/RunCard.tsx');
  assert.match(source, /const visibleDeviceFamilies\s*=\s*isStreaming\s*\?\s*run\.deviceFamilies\.filter/);
  assert.match(source, /visibleDeviceFamilies\.map/);
});

test('simple link importer is the primary catalog workflow for every platform',()=>{
  const hub=read('src/pages/StreamingHub.tsx');
  assert.match(hub,/SimpleStreamingImporter/);
  assert.match(hub,/SavedStreamingAlbumsPanel/);
  assert.match(hub,/resolveStreamingCatalog/);
  assert.match(hub,/saveStreamingCollection/);
  assert.doesNotMatch(hub,/SpotifyCatalogConnectionPanel|SavedStreamingArtistsPanel/);
  const workspace=read('src/components/SimpleStreamingImporter.tsx');
  assert.match(workspace,/FETCH SONGS/);
  assert.match(workspace,/Album name/);
  assert.match(workspace,/SAVE ALBUM/);
  assert.match(workspace,/Select All/);
  assert.match(workspace,/Clear Selection/);
  assert.match(workspace,/Clear Workspace/);
  assert.match(workspace,/track\.url/);
});

test('saved album cards expose use open add rename and delete controls',()=>{
  const source=read('src/components/SavedStreamingAlbumsPanel.tsx');
  for(const label of ['Use for QA','OPEN','ADD SONGS','RENAME','DELETE']) assert.match(source,new RegExp(label,'i'));
});

test('Spotify Catalog legacy component remains available but is not required by the simple importer',()=>{
  const source=read('src/components/SpotifyCatalogConnectionPanel.tsx');
  assert.match(source,/http:\/\/127\.0\.0\.1\/callback/);
  assert.match(source,/dynamic|temporary port/i);
  const hub=read('src/pages/StreamingHub.tsx');
  assert.doesNotMatch(hub,/SpotifyCatalogConnectionPanel/);
});

test('Music Library manual save and two-step verification are wired through the renderer',()=>{
  const hub=read('src/pages/StreamingHub.tsx');
  const importer=read('src/components/SimpleStreamingImporter.tsx');
  const saved=read('src/components/SavedStreamingAlbumsPanel.tsx');
  assert.match(importer,/SAVE LINK MANUALLY/);
  assert.match(hub,/saveManualLink/);
  assert.match(hub,/startStreamingLinkVerification/);
  assert.match(hub,/completeStreamingLinkVerification/);
  assert.match(saved,/MARK VERIFIED/);
  assert.match(saved,/VERIFIED/);
});
