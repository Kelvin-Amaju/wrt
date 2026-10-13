const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const pkg=JSON.parse(read('package.json'));
const factory=read('electron/streaming/streaming-browser-factory.cjs');
const auth=read('electron/streaming/adapters/_auth.cjs');
const worker=read('electron/streaming/streaming-session-worker.cjs');
const runner=read('electron/streaming/streaming-runner.cjs');
const preparer=read('electron/streaming/streaming-run-preparer.cjs');
const hub=read('src/pages/StreamingHub.tsx');
const runCenter=read('src/pages/RunCenter.tsx');

test('current release preserves the v0.19.3 reliability lineage',()=>assert.match(pkg.version,/^(?:0\.19\.(?:3|[4-9]|[1-9]\d+)|0\.(?:2[0-9]|[3-9]\d)\.\d+|[1-9]\d*\.\d+\.\d+)$/));

test('verified account profile is reused across desktop Android and iOS compatibility streaming',()=>{
  assert.match(factory,/shouldUsePersistentProfile=Boolean\(usePersistentProfile&&profileDir/);
  assert.doesNotMatch(factory,/usePersistentProfile&&deviceMode==='desktop'/);
  assert.match(factory,/viewport:profile\.viewport/);
  assert.match(factory,/isMobile:profile\.isMobile/);
  assert.match(factory,/hasTouch:profile\.hasTouch/);
  assert.doesNotMatch(factory,/contextOptions\.userAgent=buildAndroidChromeUserAgent/);
});

test('account proxy source remains attached to persistent device streaming and is fail closed',()=>{
  assert.match(factory,/proxyPoolService\.allocate\(proxySource/);
  assert.match(factory,/persistentOptions\.proxy=/);
  assert.match(factory,/Proxy route matched a known direct route; direct fallback is blocked/);
});

test('temporary streaming service error pages get bounded reload recovery without credential automation',()=>{
  assert.match(auth,/safeReload/);
  assert.match(auth,/retry<2/);
  assert.match(worker,/reloadTransientStreamingPage/);
  assert.match(worker,/transientReloads<2/);
  assert.match(worker,/savedSessionAccount/);
});

test('completed selected-song duration is recorded as internal play count in Streaming Hub and Run Center',()=>{
  assert.match(runner,/playCount:validQaPlaybacks/);
  assert.match(runner,/playsByAccount/);
  assert.match(runner,/COMPLETED PLAY/);
  assert.match(hub,/completed plays \(QA\)/);
  assert.match(runCenter,/Completed plays \(QA\)/);
});

test('pause and volume configuration survives IPC sanitization',()=>{
  assert.match(preparer,/pauseResumeSeconds:Math\.max\(0\.5,Math\.min\(3/);
  assert.match(preparer,/volumeDirection:request\.volumeDirection==='increase'/);
});
