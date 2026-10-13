const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createProfileLockManager}=require('./profile-lock-manager.cjs');

test('profile lock rejects simultaneous use and releases cleanly',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'oq-profile-lock-'));
  const manager=createProfileLockManager({releaseDelayMs:0});
  const release=manager.acquire(root,{runId:'r1'});
  assert.equal(manager.isLocked(root),true);
  assert.throws(()=>manager.acquire(root,{runId:'r2'}),/already being used/i);
  await release();
  assert.equal(manager.isLocked(root),false);
  const release2=manager.acquire(root,{runId:'r2'});
  await release2();
  fs.rmSync(root,{recursive:true,force:true});
});

test('repair backs up an idle profile instead of deleting it',()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'oq-profile-repair-'));
  const profile=path.join(parent,'spotify','acct');
  fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(profile,'marker.txt'),'keep');
  const manager=createProfileLockManager({releaseDelayMs:0});
  const result=manager.repair(profile);
  assert.equal(result.repaired,true);
  assert.ok(result.backupDir);
  assert.equal(fs.existsSync(path.join(result.backupDir,'marker.txt')),true);
  assert.equal(fs.existsSync(profile),true);
  fs.rmSync(parent,{recursive:true,force:true});
  fs.rmSync(result.backupDir.split(`${path.sep}spotify${path.sep}`)[0],{recursive:true,force:true});
});

test('stale Chromium singleton lock files are removed only when the profile is idle',()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'oq-profile-stale-'));
  const profile=path.join(parent,'spotify','acct');fs.mkdirSync(profile,{recursive:true});
  const lock=path.join(profile,'SingletonLock');fs.writeFileSync(lock,'stale');
  const old=new Date(Date.now()-120000);fs.utimesSync(lock,old,old);
  const manager=createProfileLockManager({staleAfterMs:30000,releaseDelayMs:0});
  const result=manager.cleanStaleLockFiles(profile);
  assert.equal(result.cleaned,1);assert.equal(fs.existsSync(lock),false);
  fs.rmSync(parent,{recursive:true,force:true});
});
