const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {resolveInstalledBrave}=require('./chrome-runtime-resolver.cjs');
const {verifyBrowserRuntime}=require('./browser-runtime-verifier.cjs');

test('production renderer exposes Brave across Test Run Streaming Social and account settings',()=>{
  const bundle=fs.readFileSync('dist/assets/index-manual.js','utf8');
  assert.match(bundle,/Desktop.*Brave|Brave.*REAL/s);
  assert.match(bundle,/Android Brave/);
  assert.match(bundle,/iPhone\/iPad Brave/);
  assert.match(bundle,/value: normal\.browserRuntime \|\| 'chrome-installed'/);
  assert.match(bundle,/value: group\.browserRuntime \|\| 'chrome-installed'/);
  assert.match(bundle,/value: browserRuntime/);
  assert.match(bundle,/defaultBrowserRuntime/);
});

test('production backend resolves and verifies installed Brave',()=>{
  const env={PROGRAMFILES:'C:\\Program Files',LOCALAPPDATA:'C:\\Users\\u\\AppData\\Local'};
  const expected='C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
  const result=resolveInstalledBrave({env,existsSync:p=>p===expected});
  assert.equal(result.found,true);
  const verified=verifyBrowserRuntime({runtimeKind:'brave-installed',deviceMode:'desktop',browserVersion:'153.0',executablePath:expected});
  assert.equal(verified.browserFamily,'Brave');
});

test('production runtime routes Brave through shared worker factories',()=>{
  const qa=fs.readFileSync('electron/qa-runner.cjs','utf8');
  const streaming=fs.readFileSync('electron/streaming/streaming-browser-factory.cjs','utf8');
  const social=fs.readFileSync('electron/social/social-runner.cjs','utf8');
  assert.match(qa,/brave-installed/);
  assert.match(streaming,/browserRuntime/);
  assert.match(social,/browserRuntime/);
});
