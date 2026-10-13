const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {buildRuntimePerformanceLaunchPolicy}=require('./qa-runner.cjs');

test('Chromium runtime performance policy disables minimized and occluded throttling',()=>{
  const policy=buildRuntimePerformanceLaunchPolicy({browserEngine:'chromium'});
  assert.equal(policy.applied,true);
  for(const arg of [
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-ipc-flooding-protection',
  ]) assert.ok(policy.args.includes(arg),`missing ${arg}`);
});

test('non-Chromium engines are not given Chromium-only launch flags',()=>{
  assert.deepEqual(buildRuntimePerformanceLaunchPolicy({browserEngine:'webkit'}),{applied:false,args:[]});
  assert.deepEqual(buildRuntimePerformanceLaunchPolicy({browserEngine:'firefox'}),{applied:false,args:[]});
});

test('Electron UI and verification windows opt out of background renderer throttling',()=>{
  const main=fs.readFileSync('electron/main.cjs','utf8');
  const verification=fs.readFileSync('electron/streaming/link-verification-manager.cjs','utf8');
  assert.match(main,/backgroundThrottling:\s*false/);
  assert.match(main,/powerSaveBlocker\.start\('prevent-app-suspension'\)/);
  assert.match(verification,/backgroundThrottling:false/);
});

test('Streaming and manual installed-browser paths carry the shared anti-throttle policy',()=>{
  const factory=fs.readFileSync('electron/streaming/streaming-browser-factory.cjs','utf8');
  assert.match(factory,/buildRuntimePerformanceLaunchPolicy/);
  assert.match(factory,/--disable-background-timer-throttling/);
  assert.match(factory,/mergeLaunchArgs\(launchPolicy\?\.args\|\|\[\],containmentPolicy\?\.args\|\|\[\],performancePolicy\?\.args\|\|\[\],backgroundWindowArgs\)/);
});
