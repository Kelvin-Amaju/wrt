const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createCookieStore}=require('./cookie-store.cjs');
const {iterateWorkUnitsV3}=require('./work-unit-scheduler.cjs');

const codec={isEncryptionAvailable:()=>false,encryptString:s=>Buffer.from(String(s)),decryptString:b=>Buffer.from(b).toString('utf8')};

test('Cookie Manager stores non-auth QA cookies and rotates matching cookies without reuse until cycle completes',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-cookie-'));
  const store=createCookieStore({userDataPath:dir,safeStorage:codec});
  store.add({label:'A',name:'qa_variant',value:'A',domain:'example.com'});
  store.add({label:'B',name:'qa_theme',value:'B',domain:'example.com'});
  const a=store.pickForUrl('https://www.example.com/page',()=>0);
  const b=store.pickForUrl('https://www.example.com/page',()=>0);
  assert.ok(a&&b);assert.notEqual(a.id,b.id);
  const c=store.pickForUrl('https://www.example.com/page',()=>0);
  assert.ok(c);assert.ok([a.id,b.id].includes(c.id));
  assert.equal(store.pickForUrl('https://other.test/',()=>0),null);
});

test('Cookie Manager global selection ignores target website while preserving the saved cookie domain',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-cookie-global-'));
  const store=createCookieStore({userDataPath:dir,safeStorage:codec});
  const saved=store.add({label:'History seed',name:'qa_history_seed',value:'one',domain:'example.com'});
  const selected=store.pickAny(()=>0);
  assert.ok(selected);
  assert.equal(selected.id,saved.id);
  assert.equal(selected.cookie.domain,'example.com');
  assert.equal(selected.cookie.name,'qa_history_seed');
});

test('Cookie Manager blocks authentication/session cookie names',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-cookie-'));
  const store=createCookieStore({userDataPath:dir,safeStorage:codec});
  for(const name of ['sessionid','auth_token','JSESSIONID','cf_clearance','wordpress_logged_in_user']){
    assert.throws(()=>store.add({label:'x',name,value:'secret',domain:'example.com'}),/Authentication\/session cookies are not allowed/);
  }
});

test('v3 work units carry Use Cookie from each local device family',()=>{
  const req={version:3,urlPool:['https://example.com'],runSeed:'x',proxyMode:'general',generalProxy:{source:'none',allowSlowProxies:false},devices:{
    desktop:{enabled:true,useCookies:true,browsers:['chrome-installed'],instancesPerBrowser:1,sessionDurationSeconds:60,proxy:{source:'none',allowSlowProxies:false}},
    androidEmulation:{enabled:true,useCookies:true,browserRuntime:'chrome-installed',profiles:['Pixel 11'],instancesPerProfile:1,sessionDurationSeconds:60,proxy:{source:'none',allowSlowProxies:false}},
    iosEmulation:{enabled:true,useCookies:true,browsers:['chrome-installed'],profiles:['iPhone 18 Pro'],instancesPerProfile:1,sessionDurationSeconds:60,orientation:'portrait',locale:'en-US',timezoneId:'UTC',proxy:{source:'none',allowSlowProxies:false}},
    androidAvd:{enabled:false,useCookies:false,avdNames:[],sessionDurationSeconds:60},realIos:{enabled:false,selections:[],sessionDurationSeconds:60}
  }};
  const units=[...iterateWorkUnitsV3(req)];
  assert.equal(units.length,3);assert.ok(units.every(x=>x.useCookies===true));
});

test('v0.21.54 renderer and runtime expose Cookie Manager and pre-navigation injection',()=>{
  const root=path.resolve(__dirname,'..');
  const sidebar=fs.readFileSync(path.join(root,'src/components/Sidebar.tsx'),'utf8');
  const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8');
  const device=fs.readFileSync(path.join(root,'src/components/DeviceMatrixEditor.tsx'),'utf8');
  const runner=fs.readFileSync(path.join(root,'electron/qa-runner.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'electron/preload.cjs'),'utf8');
  const bundle=fs.readFileSync(path.join(root,'dist/assets/index-manual.js'),'utf8');
  assert.match(sidebar,/Cookie Manager/);assert.match(app,/CookieManager/);assert.match(device,/Use Cookie/);
  assert.match(runner,/cookieStore\.pickAny/);assert.match(runner,/addCookies\(\[selectedCookie\.cookie\]\)/);
  assert.match(preload,/listQaCookies/);assert.match(bundle,/Cookie Manager/);assert.match(bundle,/Use Cookie/);
});
