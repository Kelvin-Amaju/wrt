const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('Streaming Hub live log renders assigned proxy and current exit IP',()=>{
  const hub=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
  assert.match(hub,/Assigned proxy/);
  assert.match(hub,/Current exit IP/);
  assert.match(hub,/event\.assignedProxy/);
  assert.match(hub,/event\.currentExitIp/);
});

test('streaming worker refreshes proxy route for each selected song without direct-IP probing',()=>{
  const worker=fs.readFileSync('electron/streaming/streaming-session-worker.cjs','utf8');
  const browser=fs.readFileSync('electron/streaming/streaming-browser-factory.cjs','utf8');
  assert.match(worker,/refreshProxyRoute/);
  assert.match(worker,/proxy-route-song/);
  assert.match(worker,/assignedProxy,currentExitIp,proxyKind/);
  assert.match(browser,/async refreshProxyRoute\(\)/);
  assert.match(browser,/verifyCurrentProxyRoute/);
});
