const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createCookieStore}=require('./cookie-store.cjs');

function makeStore(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbitqa-cookie-expiry-'));
  const safeStorage={isEncryptionAvailable:()=>false};
  return {dir,store:createCookieStore({userDataPath:dir,safeStorage})};
}

test('Cookie Manager exposes active/disabled health for saved non-expired cookies',()=>{
  const {store}=makeStore();
  const future=Math.floor(Date.now()/1000)+3600;
  const active=store.add({label:'Active QA',name:'qa_variant',value:'A',domain:'example.com',expires:future,enabled:true});
  const disabled=store.add({label:'Disabled QA',name:'qa_pref',value:'B',domain:'other.test',enabled:false});
  assert.equal(active.status,'active');
  assert.equal(disabled.status,'disabled');
  const rows=store.list();
  assert.equal(rows.find(r=>r.id===active.id).status,'active');
  assert.equal(rows.find(r=>r.id===disabled.id).status,'disabled');
});

test('expired cookies are auto-removed from disk and never returned or selected',()=>{
  const {dir,store}=makeStore();
  const future=Math.floor(Date.now()/1000)+3600;
  const expired=store.add({label:'Soon expired',name:'qa_old',value:'old',domain:'expired.test',expires:future,enabled:true});
  const live=store.add({label:'Live',name:'qa_live',value:'live',domain:'live.test',expires:future,enabled:true});
  const file=path.join(dir,'qa-cookies.json');
  const rows=JSON.parse(fs.readFileSync(file,'utf8'));
  const row=rows.find(r=>r.id===expired.id);
  row.expires=Math.floor(Date.now()/1000)-10;
  fs.writeFileSync(file,JSON.stringify(rows,null,2));

  const listed=store.list();
  assert.deepEqual(listed.map(r=>r.id),[live.id]);
  const persisted=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(persisted.some(r=>r.id===expired.id),false);
  assert.equal(store.pickAny(()=>0).id,live.id);
});

test('an already-expired cookie is purged automatically on the next maintenance read',()=>{
  const {dir,store}=makeStore();
  const added=store.add({label:'Expired',name:'qa_old',value:'x',domain:'example.com',expires:Math.floor(Date.now()/1000)-1});
  assert.ok(added);
  assert.equal(store.list().some(r=>r.id===added.id),false);
  const persisted=JSON.parse(fs.readFileSync(path.join(dir,'qa-cookies.json'),'utf8'));
  assert.equal(persisted.some(r=>r.id===added.id),false);
});

test('Cookie Manager UI shows status and expiry controls',()=>{
  const root=path.join(__dirname,'..');
  const source=fs.readFileSync(path.join(root,'src/pages/CookieManager.tsx'),'utf8');
  assert.match(source,/Cookie JSON/);
  assert.match(source,/IMPORT JSON COOKIES/);
  assert.match(source,/ACTIVE/);
  assert.match(source,/EXPIRED/);
  assert.match(source,/Expired cookies are removed automatically/);
});
