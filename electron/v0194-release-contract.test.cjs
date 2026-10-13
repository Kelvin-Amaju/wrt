const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const pkg=JSON.parse(read('package.json'));
const mobile=read('src/shared/mobileDevices.ts');
const panel=read('src/components/StreamingPlaybackPanel.tsx');
const factory=read('electron/streaming/streaming-browser-factory.cjs');
const runner=read('electron/qa-runner.cjs');

test('v0.19.4 release lineage remains present',()=>assert.equal(fs.existsSync(path.join(root,'V0.19.4-LATEST-DEVICE-PROFILES.md')),true));

test('current 2026 Pixel profiles expose verified browser viewport references',()=>{
  for(const [name,width,height,dpr] of [
    ['Pixel 11',412,923,2.625],
    ['Pixel 11 Pro',427,952,3],
    ['Pixel 11 Pro XL',448,997,3],
  ]){
    assert.match(mobile,new RegExp(`name: '${name}'.*width: ${width}, height: ${height}.*deviceScaleFactor: ${String(dpr).replace('.','\\.')}`));
    assert.match(factory,new RegExp(`'${name}'.*width:${width},height:${height}.*deviceScaleFactor:${String(dpr).replace('.','\\.')}`));
  }
});

test('current 2026 Samsung profiles expose verified display ratios and logical screen sizes',()=>{
  for(const [name,width,height,dpr] of [
    ['Galaxy S26',360,780,3],
    ['Galaxy S26+',384,832,3.75],
    ['Galaxy S26 Ultra',384,832,3.75],
    ['Galaxy S26 FE',360,780,3],
    ['Galaxy Z Flip8',360,840,3],
    ['Galaxy Z Fold8 (Open)',816,616,3],
  ]){
    assert.ok(mobile.includes(`name: '${name}', viewport: { width: ${width}, height: ${height} }, deviceScaleFactor: ${dpr}`), `${name} shared profile mismatch`);
  }
  assert.match(panel,/Galaxy S26 FE/);
  assert.match(panel,/Galaxy Z Flip8/);
  assert.match(panel,/Galaxy Z Fold8 \(Open\)/);
});

test('current 2026 iPhone profiles expose verified display sizes',()=>{
  for(const [name,width,height,dpr] of [
    ['iPhone 18 Pro',402,874,3],
    ['iPhone 18 Pro Max',440,956,3],
    ['iPhone Duo \\(Closed\\)',466,678,3],
    ['iPhone Duo \\(Open\\)',890,626,3],
  ]){
    assert.match(mobile,new RegExp(`name: '${name}'.*width: ${width}, height: ${height}.*deviceScaleFactor: ${dpr}`));
  }
});

test('iPad references are corrected to current logical display sizes',()=>{
  assert.match(mobile,/iPad Pro 11'.*width: 834, height: 1210.*deviceScaleFactor: 2/);
  assert.match(mobile,/iPad Mini'.*width: 744, height: 1133.*deviceScaleFactor: 2/);
});

test('browser contexts apply both viewport and screen dimensions for selected streaming device',()=>{
  assert.match(factory,/viewport:profile\.viewport/);
  assert.match(factory,/screen:profile\.screen\|\|profile\.viewport/);
  assert.match(factory,/deviceScaleFactor:profile\.deviceScaleFactor/);
});

test('general QA runtime uses verified current profiles before Playwright legacy descriptors',()=>{
  assert.match(runner,/IOS_EMULATION_CONTEXTS\[deviceName\] \|\| playwright\?\.devices\?\.\[deviceName\]/);
  assert.match(runner,/const verified = ANDROID_EMULATION_CONTEXTS\[settings\.deviceName\]/);
  assert.match(runner,/const profile = verified \|\| maintained/);
});

test('current-generation profiles remain available after later compatibility releases',()=>{
  assert.match(panel,/Pixel 11/);
  assert.match(panel,/Galaxy S26 Ultra/);
  assert.match(panel,/iPhone 18 Pro/);
  assert.match(factory,/Pixel 11/);
  assert.match(factory,/iPhone 18 Pro/);
});
