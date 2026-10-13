const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createCookieStore}=require('./cookie-store.cjs');

const codec={isEncryptionAvailable:()=>false,encryptString:s=>Buffer.from(String(s)),decryptString:b=>Buffer.from(b).toString('utf8')};

test('Use Cookie can select an enabled cookie unrelated to the target website',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-v02156-'));
  const store=createCookieStore({userDataPath:dir,safeStorage:codec});
  store.add({label:'Unrelated QA seed',name:'qa_history',value:'seed',domain:'history.example'});
  const picked=store.pickAny(()=>0);
  assert.ok(picked);
  assert.equal(picked.cookie.domain,'history.example');
  assert.equal(store.pickForUrl('https://spotify.com/',()=>0),null);
});

test('global cookie rotation excludes disabled and expired rows',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-v02156-'));
  const store=createCookieStore({userDataPath:dir,safeStorage:codec});
  const enabled=store.add({label:'Enabled',name:'qa_enabled',value:'1',domain:'one.example'});
  const disabled=store.add({label:'Disabled',name:'qa_disabled',value:'2',domain:'two.example'});
  store.setEnabled([disabled.id],false);
  store.add({label:'Expired',name:'qa_expired',value:'3',domain:'three.example',expires:1});
  const picked=store.pickAny(()=>0);
  assert.equal(picked.id,enabled.id);
});

test('qa runner uses global Cookie Manager selection on both local injection paths',()=>{
  const source=fs.readFileSync(path.join(__dirname,'qa-runner.cjs'),'utf8');
  const matches=source.match(/cookieStore\.pickAny\(\)/g)||[];
  assert.equal(matches.length,2);
  assert.doesNotMatch(source,/no eligible cookie matched this target domain/);
});
