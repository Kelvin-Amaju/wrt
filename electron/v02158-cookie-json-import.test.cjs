const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createCookieStore}=require('./cookie-store.cjs');

test('v0.21.58 Cookie Manager imports pasted JSON and prunes expired cookies',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbitqa-cookie-json-'));
  const safeStorage={isEncryptionAvailable:()=>false};
  const store=createCookieStore({userDataPath:dir,safeStorage});
  const result=store.importJson(JSON.stringify([
    {name:'qa_variant',value:'A',domain:'example.com',path:'/',secure:true,sameSite:'lax',expirationDate:Math.floor(Date.now()/1000)+3600},
    {name:'old_cookie',value:'old',domain:'example.org',path:'/',expires:Math.floor(Date.now()/1000)-60},
  ]));
  assert.equal(result.imported,1);
  assert.equal(result.skipped,1);
  const rows=store.list();
  assert.equal(rows.length,1);
  assert.equal(rows[0].name,'qa_variant');
  assert.equal(rows[0].status,'active');
});

test('v0.21.58 Cookie Manager accepts object with cookies array',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbitqa-cookie-json-'));
  const store=createCookieStore({userDataPath:dir,safeStorage:{isEncryptionAvailable:()=>false}});
  const result=store.importJson(JSON.stringify({cookies:[{name:'qa_history',value:'1',domain:'.example.net',path:'/'}]}));
  assert.equal(result.imported,1);
  assert.equal(store.list()[0].domain,'example.net');
});
