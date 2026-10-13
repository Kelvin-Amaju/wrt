const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {resolveInstalledBrave}=require('./chrome-runtime-resolver.cjs');
const {verifyBrowserRuntime}=require('./browser-runtime-verifier.cjs');
const {browserCandidates,resolveAutomationBrowserPolicy}=require('./streaming/supported-browser-policy.cjs');

test('resolves Brave from standard Windows locations',()=>{
  const env={PROGRAMFILES:'C:\\Program Files',LOCALAPPDATA:'C:\\Users\\u\\AppData\\Local'};
  const expected='C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
  const result=resolveInstalledBrave({env,existsSync:p=>p===expected});
  assert.equal(result.found,true); assert.equal(result.executablePath,expected); assert.equal(result.browserFamily,'brave');
});

test('verifies installed Brave separately from Chrome',()=>{
  const result=verifyBrowserRuntime({runtimeKind:'brave-installed',deviceMode:'desktop',browserVersion:'153.0',executablePath:'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'});
  assert.equal(result.browserFamily,'Brave'); assert.equal(result.verificationLabel,'REAL INSTALLED BRAVE'); assert.equal(result.verificationStatus,'verified');
});

test('streaming policy honors explicit Brave choice',()=>{
  const system={browserFamily:'brave',label:'Brave',executablePath:'C:/Brave/brave.exe'};
  const result=resolveAutomationBrowserPolicy({deviceMode:'android',browserRuntime:'brave-installed',systemBrowser:system});
  assert.equal(result.browserFamily,'brave'); assert.match(result.browserLabel,/Brave/); assert.equal(result.executablePath,'C:/Brave/brave.exe');
});

test('UI/source exposes Brave in Test Run, Streaming and Social',()=>{
  const files=['src/components/DeviceMatrixEditor.tsx','src/components/StreamingPlaybackPanel.tsx','src/components/StreamingGroupPlanPanel.tsx','src/components/SocialGroupPlanPanel.tsx','src/pages/SocialHub.tsx'];
  for(const f of files) assert.match(fs.readFileSync(f,'utf8'),/brave-installed/,f);
});

test('Social and Streaming runtime propagate selected browser to worker factory',()=>{
  assert.match(fs.readFileSync('electron/social/social-runner.cjs','utf8'),/browserRuntime:group\.browserRuntime/);
  assert.match(fs.readFileSync('electron/streaming/streaming-runner.cjs','utf8'),/browserRuntime:request\.browserRuntime/);
  assert.match(fs.readFileSync('electron/streaming/streaming-browser-factory.cjs','utf8'),/workUnit\?\.browserRuntime/);
});
