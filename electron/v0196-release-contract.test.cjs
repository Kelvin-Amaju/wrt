const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const pkg=JSON.parse(read('package.json'));
const runner=read('electron/qa-runner.cjs');
const matrix=read('src/shared/qaMatrix.ts');
const testRuns=read('src/pages/Run.tsx');

test('v0.19.6 browser-runtime consistency contract remains present in later releases',()=>{
  const parts=String(pkg.version||'0.0.0').split('.').map(Number);
  assert.ok(parts[0] > 0 || parts[1] > 19 || (parts[1] === 19 && parts[2] >= 6));
});

test('browser runtime consistency is optional and defaults off',()=>{
  assert.match(matrix,/browserRuntimeConsistency:\s*false/);
  assert.match(matrix,/browserRuntimeConsistency = input\.browserRuntimeConsistency === true/);
  assert.match(testRuns,/aria-label="Browser runtime consistency"/);
  assert.match(testRuns,/useState\(false\)/);
});

test('secure Chromium sandbox is requested only when optional consistency mode is enabled',()=>{
  assert.match(runner,/browserEngine === 'chromium' && settings\.browserRuntimeConsistency === true\) launchOptions\.chromiumSandbox = true/);
  assert.match(runner,/runtime consistency ON · Chromium sandbox ON/);
});

test('legacy missing Android runtime keeps old fallback when mode is off and prefers installed Chrome when on',()=>{
  assert.match(runner,/input\.browserRuntimeConsistency === true \? 'chrome-installed' : 'chromium-playwright'/);
  assert.match(matrix,/normalizeBrowserRuntime\(androidRaw\.browserRuntime, 'chromium-playwright'/);
  assert.match(matrix,/browserRuntimeConsistency[\s\S]{0,220}devices\.androidEmulation\.browserRuntime = 'chrome-installed'/);
});

test('Android compatibility UA major follows actual Chromium runtime only in optional mode',()=>{
  const {alignAndroidUserAgentWithRuntime}=require('./qa-runner.cjs');
  const ua='Mozilla/5.0 (Linux; Android 17; Pixel 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36';
  assert.match(alignAndroidUserAgentWithRuntime(ua,'Google Chrome 154.0.8037.58'),/Chrome\/154\.0\.0\.0/);
  assert.match(runner,/settings\.browserRuntimeConsistency === true && browserEngine === 'chromium' && settings\.deviceMode === 'android-emulation'/);
});

test('release does not add webdriver or hardware fingerprint masking',()=>{
  assert.doesNotMatch(runner,/Object\.defineProperty\([^\n]{0,80}webdriver/i);
  assert.doesNotMatch(runner,/hardwareConcurrency[^\n]{0,80}defineProperty/i);
  assert.doesNotMatch(runner,/deviceMemory[^\n]{0,80}defineProperty/i);
});
