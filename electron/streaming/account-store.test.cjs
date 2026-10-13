const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path');
const {createStreamingAccountStore}=require('./account-store.cjs');
test('account store exposes no raw password or session secret',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-acct-')); const s=createStreamingAccountStore({baseDir:dir}); const pub=s.save({platform:'spotify',label:'Primary',username:'qa@example.com',password:'super-secret',sessionSecret:'sp_dc=abc',proxySource:'static'}); const text=JSON.stringify(pub); assert.equal(text.includes('super-secret'),false); assert.equal(text.includes('sp_dc'),false); assert.equal(pub.hasPassword,true); assert.equal(pub.hasSessionSecret,true); const listed=JSON.stringify(s.list()); assert.equal(listed.includes('super-secret'),false); assert.equal(listed.includes('sp_dc'),false);});

test('account store preserves explicit authentication mode while keeping secret material private',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-acct-mode-'));
  const s=createStreamingAccountStore({baseDir:dir});
  const pub=s.save({platform:'spotify',label:'Session QA',authMode:'session',sessionSecret:'[{"name":"sp_dc","value":"x","domain":".spotify.com"}]',proxySource:'smart-mix'});
  assert.equal(pub.authMode,'session');
  assert.equal(pub.proxySource,'smart-mix');
  assert.equal('sessionSecret' in pub,false);
  assert.equal(s.getInternal(pub.id).authMode,'session');
});

test('updating verification metadata preserves stored account secrets',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-acct-verify-'));
  const s=createStreamingAccountStore({baseDir:dir});
  const first=s.save({platform:'spotify',label:'Verify me',authMode:'session',sessionSecret:'[{"name":"sp_dc","value":"secret","domain":".spotify.com"}]',proxySource:'none'});
  const updated=s.save({id:first.id,status:'ready',lastVerifiedAt:'2026-09-17T00:00:00.000Z'});
  assert.equal(updated.status,'ready');
  assert.equal(updated.hasSessionSecret,true);
  assert.match(s.getInternal(first.id).sessionSecret,/secret/);
});

test('editing label and proxy preserves encrypted password and cookies while status metadata stays public-safe',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-acct-edit-'));
  const s=createStreamingAccountStore({baseDir:dir});
  const first=s.save({platform:'tidal',label:'TIDAL QA',username:'qa@example.com',password:'secret-pass',sessionSecret:'[{"name":"session","value":"secret-cookie","domain":".tidal.com"}]',proxySource:'none'});
  const edited=s.save({id:first.id,label:'TIDAL Primary',proxySource:'smart-mix',status:'needs-verification',lastVerifiedAt:'2026-09-18T10:00:00.000Z',lastVerificationReason:'Verification code required'});
  assert.equal(edited.label,'TIDAL Primary');
  assert.equal(edited.proxySource,'smart-mix');
  assert.equal(edited.status,'needs-verification');
  assert.equal(edited.lastVerificationReason,'Verification code required');
  const internal=s.getInternal(first.id);
  assert.equal(internal.password,'secret-pass');
  assert.match(internal.sessionSecret,/secret-cookie/);
  assert.equal(JSON.stringify(edited).includes('secret-pass'),false);
  assert.equal(JSON.stringify(edited).includes('secret-cookie'),false);
});

test('account store persists public verification browser device and proxy metadata without exposing secrets',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-acct-meta-'));
  const s=createStreamingAccountStore({baseDir:dir});
  const first=s.save({platform:'youtube-music',label:'YT QA',username:'qa@example.com',password:'secret',proxySource:'none'});
  const updated=s.save({id:first.id,status:'ready',lastVerifiedAt:'2026-09-18T14:00:00.000Z',lastVerificationReason:'Confirmed',lastVerificationBrowser:'Google Chrome',lastVerificationDeviceMode:'android',lastVerificationDeviceProfile:'Pixel 7',lastVerificationProxySource:'rotating'});
  assert.equal(updated.lastVerificationBrowser,'Google Chrome');
  assert.equal(updated.lastVerificationDeviceMode,'android');
  assert.equal(updated.lastVerificationDeviceProfile,'Pixel 7');
  assert.equal(updated.lastVerificationProxySource,'rotating');
  assert.equal(JSON.stringify(updated).includes('secret'),false);
});

test('changing stored password invalidates stale verified status and verification metadata',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-acct-password-reset-'));
  const s=createStreamingAccountStore({baseDir:dir});
  const first=s.save({platform:'deezer',label:'Deezer QA',username:'qa@example.com',password:'old-secret',proxySource:'none'});
  s.save({id:first.id,status:'ready',lastVerifiedAt:'2026-09-18T10:00:00.000Z',lastVerificationReason:'Confirmed',lastVerificationBrowser:'Google Chrome'});
  const changed=s.save({id:first.id,password:'new-secret'});
  assert.equal(changed.status,'unverified');
  assert.equal(changed.lastVerifiedAt,undefined);
  assert.equal(changed.lastVerificationReason,'');
  assert.equal(changed.lastVerificationBrowser,'');
  assert.equal(s.getInternal(first.id).password,'new-secret');
});

test('changing imported session invalidates stale verified status while label and proxy edits preserve it',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-acct-session-reset-'));
  const s=createStreamingAccountStore({baseDir:dir});
  const first=s.save({platform:'spotify',label:'Spotify QA',username:'qa@example.com',password:'secret',sessionSecret:'[{"name":"sp_dc","value":"old","domain":".spotify.com"}]',proxySource:'none'});
  const verified=s.save({id:first.id,status:'ready',lastVerifiedAt:'2026-09-18T10:00:00.000Z',lastVerificationReason:'Confirmed'});
  const harmless=s.save({id:first.id,label:'Spotify Main',proxySource:'rotating'});
  assert.equal(harmless.status,'ready');
  assert.equal(harmless.lastVerifiedAt,verified.lastVerifiedAt);
  const changed=s.save({id:first.id,sessionSecret:'[{"name":"sp_dc","value":"new","domain":".spotify.com"}]'});
  assert.equal(changed.status,'unverified');
  assert.equal(changed.lastVerifiedAt,undefined);
  assert.equal(changed.lastVerificationReason,'');
  assert.match(s.getInternal(first.id).sessionSecret,/"new"/);
});

test('account store persists QA group without exposing or changing stored credentials',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-acct-group-'));
  const store=createStreamingAccountStore({baseDir:dir});
  const saved=store.save({platform:'spotify',label:'Grouped QA',username:'qa@example.com',password:'secret',qaGroup:'Group 3'});
  assert.equal(saved.qaGroup,'Group 3');
  const internal=store.getInternal(saved.id);
  assert.equal(internal.qaGroup,'Group 3');
  assert.equal(internal.password,'secret');
  assert.equal('password' in saved,false);
});

test('streaming account keeps one pinned static proxy until proxy mode is manually changed',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-stream-static-affinity-'));const codec={encode:v=>`enc:${v}`,decode:v=>String(v).slice(4)};const store=createStreamingAccountStore({baseDir:dir,secretCodec:codec});const a=store.save({platform:'spotify',label:'A',proxySource:'static',staticProxyId:'proxy-1'});assert.equal(a.staticProxyId,'proxy-1');assert.equal(store.save({id:a.id,label:'Renamed'}).staticProxyId,'proxy-1');assert.equal(store.save({id:a.id,proxySource:'rotating'}).staticProxyId,undefined);fs.rmSync(dir,{recursive:true,force:true});});

test('streaming account persists manual sticky proxy mode and can return to auto',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-stream-manual-stick-'));const codec={encode:v=>`enc:${v}`,decode:v=>String(v).slice(4)};const store=createStreamingAccountStore({baseDir:dir,secretCodec:codec});const a=store.save({platform:'spotify',label:'A',proxySource:'static',staticProxyMode:'manual',staticProxyId:'proxy-shared'});assert.equal(a.staticProxyMode,'manual');assert.equal(a.staticProxyId,'proxy-shared');const b=store.save({id:a.id,staticProxyMode:'auto',staticProxyId:''});assert.equal(b.staticProxyMode,'auto');assert.equal(b.staticProxyId,undefined);fs.rmSync(dir,{recursive:true,force:true});});
