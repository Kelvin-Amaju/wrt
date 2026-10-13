const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..','..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('Streaming Hub exposes LIVE STREAM QA LOG Recent activity and allocated timer text',()=>{
  const hub=read('src/pages/StreamingHub.tsx');
  assert.match(hub,/LIVE STREAM QA LOG/);
  assert.match(hub,/<h3>Recent activity<\/h3>/);
  assert.match(hub,/Allocated timer/);
  assert.match(hub,/event\.observationSeconds/);
});

test('main runtime no longer hard-caps browser sessions at eight and keeps a bounded configurable safety ceiling',()=>{
  const main=read('electron/main.cjs');
  assert.doesNotMatch(main,/createGlobalRunScheduler\(\{ startupLimit: 8 \}\)/);
  assert.match(main,/ORBITQA_BROWSER_SESSION_LIMIT/);
  assert.match(main,/\|\|32/);
});
