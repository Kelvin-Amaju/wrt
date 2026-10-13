const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const pkg=JSON.parse(read('package.json'));
const mobile=read('src/shared/mobileDevices.ts');
const panel=read('src/components/StreamingPlaybackPanel.tsx');
const runner=read('electron/qa-runner.cjs');
const consistency=read('electron/device-consistency.cjs');
const privacy=read('electron/privacy-probe.cjs');
const testRuns=read('src/pages/Run.tsx');

test('v0.19.5 release lineage remains present',()=>assert.ok(fs.existsSync(path.join(root,'V0.19.5-DEVICE-PROFILE-CONSISTENCY-FIX.md'))));

test('latest and previous Android profiles are all visible',()=>{
  for(const name of ['Pixel 11','Pixel 11 Pro','Pixel 11 Pro XL','Galaxy S26','Galaxy S26+','Galaxy S26 Ultra','Galaxy S26 FE','Galaxy Z Flip8','Galaxy Z Fold8 (Open)','Pixel 7','Pixel 5','Galaxy S23']){
    assert.ok(mobile.includes(`name: '${name}'`),`${name} missing from shared device selector`);
    assert.ok(panel.includes(`'${name}'`),`${name} missing from Streaming Hub selector`);
  }
});

test('latest and previous iPhone profiles are all visible',()=>{
  for(const name of ['iPhone 18 Pro','iPhone 18 Pro Max','iPhone Duo (Closed)','iPhone Duo (Open)','iPhone 13','iPhone 13 Pro','iPhone 13 Pro Max','iPhone 13 Mini','iPad Pro 11','iPad Mini']){
    assert.ok(mobile.includes(`name: '${name}'`),`${name} missing from shared device selector`);
    assert.ok(panel.includes(`'${name}'`),`${name} missing from Streaming Hub selector`);
  }
});

test('general QA accepts previous iPhones through the maintained Playwright registry and keeps previous Android fallbacks',()=>{
  assert.match(runner,/IOS_EMULATION_CONTEXTS\[deviceName\] \|\| playwright\?\.devices\?\.\[deviceName\]/);
  for(const name of ['Pixel 7','Pixel 5','Galaxy S23']) assert.ok(runner.includes(`'${name}'`),`${name} Android runtime fallback missing`);
  for(const name of ['iPhone 13','iPhone 13 Pro','iPhone 13 Pro Max','iPhone 13 Mini']) assert.ok(mobile.includes(`name: '${name}'`),`${name} previous selector missing`);
});

test('device consistency uses configured browser viewport and treats target page layout differences as site behavior',()=>{
  assert.match(consistency,/configuredViewport/);
  assert.match(consistency,/page-layout-viewport/);
  assert.match(consistency,/site behavior/i);
});

test('privacy viewport diagnostics prefer configured browser viewport when available',()=>{
  assert.match(privacy,/page\.viewportSize/);
  assert.match(privacy,/runtime\.layoutViewport = runtime\.viewport/);
  assert.match(privacy,/runtime\.viewport = configuredViewport/);
});

test('work-unit privacy status is visually separated from the overall work status',()=>{
  assert.match(testRuns,/aria-hidden=\"true\">·<\/span><strong>\{item\.status\}<\/strong>/);
});
