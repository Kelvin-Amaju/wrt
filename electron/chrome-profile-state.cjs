const fs=require('node:fs');
const path=require('node:path');

const CLEAN_EXIT_TYPE='Normal';

function preferenceCandidates(profileDir){
  const root=String(profileDir||'').trim();
  if(!root)return [];
  return [
    path.join(root,'Default','Preferences'),
    path.join(root,'Preferences'),
  ];
}

function normalizePreferencesObject(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {changed:false,value};
  const next={...value};
  const profile=(next.profile&&typeof next.profile==='object'&&!Array.isArray(next.profile))?{...next.profile}:{};
  const changed=profile.exit_type!==CLEAN_EXIT_TYPE||profile.exited_cleanly!==true;
  profile.exit_type=CLEAN_EXIT_TYPE;
  profile.exited_cleanly=true;
  next.profile=profile;
  return {changed,value:next};
}

function normalizeChromeProfileShutdownState(profileDir,{fsImpl=fs}={}){
  const touched=[];
  for(const file of preferenceCandidates(profileDir)){
    try{
      if(!fsImpl.existsSync(file))continue;
      const raw=fsImpl.readFileSync(file,'utf8');
      const parsed=JSON.parse(raw);
      const normalized=normalizePreferencesObject(parsed);
      if(!normalized.changed)continue;
      const tmp=`${file}.orbitqa-clean-${process.pid}-${Date.now()}`;
      fsImpl.writeFileSync(tmp,JSON.stringify(normalized.value));
      try{fsImpl.renameSync(tmp,file);}catch(error){try{fsImpl.rmSync?.(tmp,{force:true});}catch{};throw error;}
      touched.push(file);
    }catch{}
  }
  return {profileDir:String(profileDir||''),touched};
}

const CRASH_RESTORE_SUPPRESSION_ARGS=[
  '--hide-crash-restore-bubble',
  '--disable-session-crashed-bubble',
];

module.exports={CLEAN_EXIT_TYPE,CRASH_RESTORE_SUPPRESSION_ARGS,preferenceCandidates,normalizePreferencesObject,normalizeChromeProfileShutdownState};
