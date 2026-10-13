const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createSocialAccountStore}=require('./account-store.cjs');
test('social account secrets are not returned from public list',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-social-account-'));const codec={encode:v=>`enc:${v}`,decode:v=>String(v).slice(4)};const store=createSocialAccountStore({baseDir:dir,secretCodec:codec});const saved=store.save({platform:'youtube',label:'A',sessionSecret:'secret',proxySource:'static'});assert.equal(saved.hasSessionSecret,true);assert.equal(saved.sessionSecret,undefined);const internal=store.getInternal(saved.id);assert.equal(internal.sessionSecret,'secret');assert.equal(internal.proxySource,'static');fs.rmSync(dir,{recursive:true,force:true});});

test('social account keeps one pinned static proxy until proxy mode is manually changed',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-social-static-affinity-'));const codec={encode:v=>`enc:${v}`,decode:v=>String(v).slice(4)};const store=createSocialAccountStore({baseDir:dir,secretCodec:codec});const a=store.save({platform:'youtube',label:'A',proxySource:'static',staticProxyId:'proxy-1'});assert.equal(a.staticProxyId,'proxy-1');assert.equal(store.save({id:a.id,label:'Renamed'}).staticProxyId,'proxy-1');assert.equal(store.save({id:a.id,proxySource:'smart-mix'}).staticProxyId,undefined);fs.rmSync(dir,{recursive:true,force:true});});

test('social account securely stores optional password for automatic recovery without exposing it publicly',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-social-password-'));const codec={encode:v=>`enc:${v}`,decode:v=>String(v).slice(4)};const store=createSocialAccountStore({baseDir:dir,secretCodec:codec});
  const saved=store.save({platform:'youtube',label:'A',username:'qa@example.com',password:'secret',proxySource:'none'});
  assert.equal(saved.hasPassword,true);assert.equal(saved.password,undefined);
  const internal=store.getInternal(saved.id);assert.equal(internal.password,'secret');
  const kept=store.save({id:saved.id,label:'Renamed'});assert.equal(kept.hasPassword,true);assert.equal(store.getInternal(saved.id).password,'secret');
  fs.rmSync(dir,{recursive:true,force:true});
});

test('social account persists manual sticky proxy mode and can return to auto',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-social-manual-stick-'));const codec={encode:v=>`enc:${v}`,decode:v=>String(v).slice(4)};const store=createSocialAccountStore({baseDir:dir,secretCodec:codec});const a=store.save({platform:'youtube',label:'A',proxySource:'static',staticProxyMode:'manual',staticProxyId:'proxy-shared'});assert.equal(a.staticProxyMode,'manual');assert.equal(a.staticProxyId,'proxy-shared');const b=store.save({id:a.id,staticProxyMode:'auto',staticProxyId:''});assert.equal(b.staticProxyMode,'auto');assert.equal(b.staticProxyId,undefined);fs.rmSync(dir,{recursive:true,force:true});});
