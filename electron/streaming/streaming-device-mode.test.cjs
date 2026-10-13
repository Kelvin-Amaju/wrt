const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {sanitizeStreamingRunRequest}=require('./streaming-run-preparer.cjs');

const hub=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
const playback=fs.readFileSync('src/components/StreamingPlaybackPanel.tsx','utf8');

test('Streaming Hub exposes Desktop, Android Mobile, and iOS Mobile device choices',()=>{
  assert.match(playback,/Desktop/i);
  assert.match(playback,/Android Mobile/i);
  assert.match(playback,/iOS Mobile/i);
  assert.match(playback,/deviceMode/);
  assert.match(hub,/deviceMode/);
});

test('streaming run sanitizer preserves selected device mode and profile',()=>{
  const out=sanitizeStreamingRunRequest({runKind:'streaming',platform:'spotify',deviceMode:'android',deviceProfile:'Pixel 7',collectionIds:[],trackIds:[],accountIds:[],checks:[],observation:{}});
  assert.equal(out.deviceMode,'android');
  assert.equal(out.deviceProfile,'Pixel 7');
});
test('main process supplies Chromium and current Playwright device descriptors to the streaming browser factory for mobile compatibility',()=>{const main=fs.readFileSync('electron/main.cjs','utf8'); assert.match(main,/\{\s*chromium\s*,\s*webkit\s*,\s*devices\s*\}\s*=\s*require\('playwright'\)/); assert.match(main,/createStreamingBrowserFactory\(\{\s*chromium\s*,\s*webkit\s*,\s*devices/); const policy=fs.readFileSync('electron/streaming/supported-browser-policy.cjs','utf8'); assert.match(policy,/deviceMode==='ios'[\s\S]*engine:'chromium'/);});

const {makeWorkUnits}=require('./streaming-runner.cjs');

test('Streaming Hub exposes Mixed Devices alongside Desktop, Android, and iOS',()=>{
  assert.match(playback,/Mixed Devices/i);
  const out=sanitizeStreamingRunRequest({runKind:'streaming',platform:'spotify',deviceMode:'mixed',collectionIds:[],trackIds:[],accountIds:[],checks:[],observation:{}});
  assert.equal(out.deviceMode,'mixed');
});

test('mixed device mode rotates concrete desktop, Android, and iOS work units',()=>{
  const tracks=[
    {id:'t1',platform:'spotify',title:'One',url:'https://open.spotify.com/track/t1'},
    {id:'t2',platform:'spotify',title:'Two',url:'https://open.spotify.com/track/t2'},
    {id:'t3',platform:'spotify',title:'Three',url:'https://open.spotify.com/track/t3'},
  ];
  const units=makeWorkUnits({accountIds:['a1'],queueMode:'sequential',executionMode:'visible',deviceMode:'mixed'},tracks);
  assert.deepEqual(units.map(unit=>unit.deviceMode),['desktop','android','ios']);
  assert.ok(units.every(unit=>unit.deviceProfile));
});

test('mixed device run sanitizer preserves selected families and per-family profiles',()=>{
  const out=sanitizeStreamingRunRequest({runKind:'streaming',platform:'spotify',deviceMode:'mixed',mixedDeviceModes:['desktop','ios'],mixedDeviceProfiles:{desktop:'Desktop 1280x720',android:'Pixel 7',ios:'iPad Mini'},collectionIds:[],trackIds:[],accountIds:[],checks:[],observation:{}});
  assert.deepEqual(out.mixedDeviceModes,['desktop','ios']);
  assert.equal(out.mixedDeviceProfiles.desktop,'Desktop 1280x720');
  assert.equal(out.mixedDeviceProfiles.ios,'iPad Mini');
});

test('Mixed Devices UI exposes selectable Desktop Android and iOS families instead of a fixed automatic rotation label',()=>{
  assert.match(playback,/mixedDeviceModes/);
  assert.match(playback,/Desktop/);
  assert.match(playback,/Android/);
  assert.match(playback,/iOS/);
  assert.doesNotMatch(playback,/Automatic Desktop \+ Android \+ iOS rotation/);
});

test('main process gives streaming accounts a durable per-account browser-profile root under OrbitQA user data',()=>{
  const main=fs.readFileSync('electron/main.cjs','utf8');
  assert.match(main,/profileBaseDir\s*:\s*path\.join\(app\.getPath\('userData'\),\s*'streaming-browser-profiles'\)/);
});
