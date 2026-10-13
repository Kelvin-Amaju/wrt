const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {normalizeChromeProfileShutdownState,CRASH_RESTORE_SUPPRESSION_ARGS}=require('./chrome-profile-state.cjs');

test('normalizes Chromium persistent profile crash markers without removing other preferences',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'orbitqa-profile-state-'));
  const dir=path.join(root,'Default');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'Preferences');
  fs.writeFileSync(file,JSON.stringify({profile:{exit_type:'Crashed',exited_cleanly:false,name:'Person 1'},signin:{allowed:true}}));
  const result=normalizeChromeProfileShutdownState(root);
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(saved.profile.exit_type,'Normal');
  assert.equal(saved.profile.exited_cleanly,true);
  assert.equal(saved.profile.name,'Person 1');
  assert.equal(saved.signin.allowed,true);
  assert.equal(result.touched.length,1);
  fs.rmSync(root,{recursive:true,force:true});
});

test('crash restore suppression args cover current and legacy Chromium bubble switches',()=>{
  assert.ok(CRASH_RESTORE_SUPPRESSION_ARGS.includes('--hide-crash-restore-bubble'));
  assert.ok(CRASH_RESTORE_SUPPRESSION_ARGS.includes('--disable-session-crashed-bubble'));
});
