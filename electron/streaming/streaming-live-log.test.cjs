const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('Streaming Hub exposes a live structured activity log with filters and copy controls',()=>{
  const hub=read('src/pages/StreamingHub.tsx');
  const css=read('src/styles.css');
  assert.match(hub,/LIVE STREAM LOG/);
  assert.match(hub,/onQaEvent/);
  assert.match(hub,/Errors only/i);
  assert.match(hub,/Warnings \+ Errors/i);
  assert.match(hub,/Copy Log/i);
  assert.match(hub,/Clear View/i);
  assert.match(hub,/activityRunId/);
  assert.match(hub,/accountLabel/);
  assert.match(hub,/workerLabel/);
  assert.match(hub,/severity/);
  assert.match(hub,/stage/);
  assert.match(css,/stream-live-log/);
});

test('streaming backend records structured stages and browser diagnostics for troubleshooting',()=>{
  const runner=read('electron/streaming/streaming-runner.cjs');
  const worker=read('electron/streaming/streaming-session-worker.cjs');
  assert.match(runner,/accountLabel/);
  assert.match(runner,/platform/);
  assert.match(worker,/attachStreamingPageDiagnostics/);
  assert.match(worker,/pageerror/);
  assert.match(worker,/requestfailed/);
  assert.match(worker,/browser-console/);
  assert.match(worker,/playback-attempt/);
  assert.match(worker,/playback-confirmed/);
});

test('lightweight live activity retention stays compact in Streaming Hub and Run Center',()=>{
  const hub=read('src/pages/StreamingHub.tsx');
  const center=read('src/pages/RunCenter.tsx');
  const registry=read('electron/run-registry.cjs');
  assert.match(hub,/MAX_LIVE_ACTIVITY=120/);
  assert.match(center,/detail\.logs\.slice\(-200\)/);
  assert.match(registry,/record\.logs\.length > 600/);
  assert.match(registry,/schedulePersist\(record, delayMs = 400\)/);
});
