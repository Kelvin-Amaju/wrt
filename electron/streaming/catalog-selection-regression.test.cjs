const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('simple link import lists fetched songs for manual tick or Select All instead of auto-selecting a fresh fetch',()=>{
  const hub=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
  const workspace=fs.readFileSync('src/components/SimpleStreamingImporter.tsx','utf8');
  assert.match(hub,/if\(!editingAlbumId\)setSelectedTracks\(new Set\(\)\)/);
  assert.match(workspace,/>Select All</);
  assert.match(workspace,/selected\.size} selected/);
  assert.match(workspace,/setSelected\(new Set\(tracks\.map/);
});
