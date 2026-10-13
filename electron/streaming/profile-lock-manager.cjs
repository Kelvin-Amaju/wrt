const fs = require('node:fs');
const path = require('node:path');

const CHROMIUM_LOCK_NAMES = ['SingletonLock','SingletonCookie','SingletonSocket','lockfile'];

function delay(ms){ return new Promise(resolve=>setTimeout(resolve, Math.max(0, Number(ms)||0))); }
function profileKey(value){ return path.resolve(String(value||'')).toLowerCase(); }

function createProfileLockManager({ staleAfterMs=30_000, releaseDelayMs=450 }={}) {
  const active = new Map();

  function describe(profileDir){ return active.get(profileKey(profileDir)) || null; }
  function isLocked(profileDir){ return active.has(profileKey(profileDir)); }
  function acquire(profileDir, owner={}) {
    const key=profileKey(profileDir);
    const existing=active.get(key);
    if(existing){
      const error=new Error('Streaming profile is already being used by another browser session. Wait for that session to close, then try again.');
      error.code='ORBITQA_PROFILE_LOCKED'; error.profileDir=profileDir; error.owner=existing; throw error;
    }
    const token={key,profileDir:String(profileDir),owner:{...owner},acquiredAt:Date.now(),released:false};
    active.set(key,token);
    return async()=>{
      if(token.released)return;
      token.released=true;
      if(active.get(key)===token)active.delete(key);
      await delay(releaseDelayMs);
    };
  }

  function lockFiles(profileDir){
    return CHROMIUM_LOCK_NAMES.map(name=>path.join(String(profileDir||''),name)).filter(file=>{try{return fs.existsSync(file);}catch{return false;}});
  }

  function cleanStaleLockFiles(profileDir,{now=Date.now(),allowOwnedActive=false}={}){
    if(isLocked(profileDir)&&!allowOwnedActive)return {cleaned:0,kept:lockFiles(profileDir),reason:'profile-active'};
    let cleaned=0; const kept=[];
    for(const file of lockFiles(profileDir)){
      try{
        const stat=fs.lstatSync(file);
        const age=Math.max(0,now-Number(stat.mtimeMs||0));
        if(age<staleAfterMs){kept.push(file);continue;}
        fs.rmSync(file,{force:true,recursive:false}); cleaned++;
      }catch{kept.push(file);}
    }
    return {cleaned,kept};
  }

  function repair(profileDir){
    const dir=String(profileDir||'').trim();
    if(!dir)throw new Error('Profile path is unavailable');
    if(isLocked(dir)){
      const error=new Error('This account profile is currently in use. Stop its running task before repairing it.');
      error.code='ORBITQA_PROFILE_LOCKED'; throw error;
    }
    if(!fs.existsSync(dir)){fs.mkdirSync(dir,{recursive:true});return {repaired:true,backupDir:'',createdFresh:true};}
    const suffix=new Date().toISOString().replace(/[:.]/g,'-');
    const backup=`${dir}.repair-backup-${suffix}`;
    fs.renameSync(dir,backup);
    fs.mkdirSync(dir,{recursive:true});
    return {repaired:true,backupDir:backup,createdFresh:true};
  }

  return { acquire, isLocked, describe, lockFiles, cleanStaleLockFiles, repair };
}

module.exports={createProfileLockManager,CHROMIUM_LOCK_NAMES};
