const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildConsistentWorkerContext,resolveProxyGeo,validateWorkerContext}=require('./worker-context-policy.cjs');
const {compareGraphicsStability}=require('./device-consistency.cjs');

const read=(p)=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('proxy geo retains city region coordinates timezone and country locale coherently',()=>{
  const allocation={countryCode:'NG',country:'Nigeria',region:'Rivers',city:'Port Harcourt',latitude:4.8156,longitude:7.0498,timezoneId:'Africa/Lagos'};
  const geo=resolveProxyGeo(allocation);
  assert.equal(geo.countryCode,'NG');
  assert.equal(geo.city,'Port Harcourt');
  assert.equal(geo.region,'Rivers');
  assert.equal(geo.timezoneId,'Africa/Lagos');
  assert.equal(geo.locale,'en-NG');
  assert.match(geo.languageHeader,/en-NG/);
  assert.equal(geo.hasCoordinates,true);
});

test('worker context applies one coherent mobile geometry plus proxy timezone locale and language',()=>{
  const profile={viewport:{width:412,height:923},screen:{width:412,height:923},deviceScaleFactor:2.625,isMobile:true,hasTouch:true,deviceName:'Pixel 11',androidVersion:'17'};
  const allocation={geoVerified:true,countryCode:'NG',city:'Lagos',region:'Lagos',timezoneId:'Africa/Lagos',latitude:6.45,longitude:3.39};
  const out=buildConsistentWorkerContext({profile,deviceMode:'android-emulation',browserEngine:'chromium',browserVersion:'153.0.0.0',allocation,base:{permissions:[]}});
  assert.deepEqual(out.options.viewport,profile.viewport);
  assert.deepEqual(out.options.screen,profile.screen);
  assert.equal(out.options.deviceScaleFactor,2.625);
  assert.equal(out.options.isMobile,true);
  assert.equal(out.options.hasTouch,true);
  assert.equal(out.options.timezoneId,'Africa/Lagos');
  assert.equal(out.options.locale,'en-NG');
  assert.match(out.options.extraHTTPHeaders['Accept-Language'],/en-NG/);
  assert.match(out.options.userAgent,/Android/);
  const validity=validateWorkerContext({profile,deviceMode:'android-emulation',contextOptions:out.options,allocation});
  assert.equal(validity.ok,true);
});

test('desktop without proxy keeps locale and timezone browser-native',()=>{
  const out=buildConsistentWorkerContext({profile:{},deviceMode:'desktop',browserEngine:'chromium',base:{permissions:[]}});
  assert.equal(Object.hasOwn(out.options,'locale'),false);
  assert.equal(Object.hasOwn(out.options,'timezoneId'),false);
});

test('Canvas and WebGL stability compares native signatures without spoofing values',()=>{
  const baseline={canvas:{supported:true,signature:'a1'},webgl:{supported:true,signature:'b1'}};
  const same=compareGraphicsStability(baseline,{canvas:{supported:true,signature:'a1'},webgl:{supported:true,signature:'b1'}});
  assert.equal(same.overall,'pass');
  assert.equal(same.canvas.stable,true);
  const changed=compareGraphicsStability(baseline,{canvas:{supported:true,signature:'a2'},webgl:{supported:true,signature:'b1'}});
  assert.equal(changed.overall,'warning');
  assert.equal(changed.canvas.stable,false);
});

test('release keeps Canvas/WebGL browser-native and adds no random fingerprint noise',()=>{
  const consistency=read('electron/device-consistency.cjs');
  assert.match(consistency,/does not add random Canvas noise/);
  assert.match(consistency,/does not independently spoof vendor, renderer, extensions, or GPU limits/);
  assert.doesNotMatch(consistency,/override.*getParameter|prototype\.toDataURL\s*=|WEBGL_debug_renderer_info.*return/i);
});

test('proxy metadata pipeline persists city region coordinates and returns them in allocations',()=>{
  const health=read('electron/proxy-health.cjs');
  const store=read('electron/proxy-store.cjs');
  const pool=read('electron/proxy-pool-service.cjs');
  assert.match(health,/country_code,region,city,latitude,longitude,timezone/);
  for(const token of ['region','city','latitude','longitude']) assert.match(store,new RegExp(token));
  assert.match(pool,/city: current\.city/);
  assert.match(pool,/latitude: Number\.isFinite/);
});

test('persistent profile isolation remains account-scoped and locked',()=>{
  const factory=read('electron/streaming/streaming-browser-factory.cjs');
  assert.match(factory,/safeProfileSegment\(account\.platform/);
  assert.match(factory,/safeProfileSegment\(account\.id\|\|account\.label/);
  assert.match(factory,/profileLocks\.acquire/);
});
