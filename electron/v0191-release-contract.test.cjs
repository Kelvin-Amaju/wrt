const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('v0.19.1 preserves one durable browser profile per streaming account and reopens verified accounts at home',()=>{
  const pkg=JSON.parse(read('package.json'));
  const factory=read('electron/streaming/streaming-browser-factory.cjs');
  const manager=read('electron/streaming/account-verification-manager.cjs');
  const worker=read('electron/streaming/streaming-session-worker.cjs');
  const auth=read('electron/streaming/adapters/_auth.cjs');
  const spotify=read('electron/streaming/adapters/spotify.cjs');
  assert.ok(/^0\.19\.(?:[1-9]\d*)$/.test(pkg.version)||Number(pkg.version.split('.')[1])>19,'current release must preserve v0.19.1 behavior');
  assert.match(factory,/getAccountProfileDir/);
  assert.match(manager,/hasSavedLogin\?\(authConfig\.homeUrl\|\|authConfig\.loginUrl\):authConfig\.loginUrl/);
  assert.match(manager,/freshProfile:false/);
  assert.doesNotMatch(manager,/cleanupManualLoginProfile\?\./);
  assert.match(worker,/usePersistentProfile:true/);
  assert.match(auth,/authenticatedSelectors/);
  assert.match(auth,/transient:true,reason:`\$\{config\.label\} still exposes a login control while the page is settling/);
  assert.match(spotify,/consecutivePasses/);
});

test('v0.19.1 Streaming Hub music selector is clean searchable and readable',()=>{
  const selector=read('src/components/StreamingRunLibraryPanel.tsx');
  const css=read('src/styles.css');
  assert.match(selector,/Find music/);
  assert.match(selector,/Search title, artist or album/);
  assert.match(selector,/stream-run-track-table/);
  assert.match(selector,/Only checked songs are placed in the run allowlist/);
  assert.match(css,/v0\.19\.1 clean Streaming Hub music selection/);
  assert.match(css,/stream-run-library-kind[^}]*font-size:10px/);
});
