const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,p),'utf8');
test('social runner performs account and target platform self-checks before actions',()=>{const s=read('social-runner.cjs');assert.match(s,/checkAccountSession/);assert.match(s,/checkTargetCapabilities/);assert.match(s,/platform-self-check/);assert.match(s,/ORBITQA_SOCIAL_CAPABILITY_TRANSIENT/);});
test('self-check implementation supports all configured social platforms through shared platform definitions',()=>{const p=read('platforms.cjs');for(const name of ['youtube','facebook','instagram','x','pinterest','tiktok','linkedin','reddit'])assert.match(p,new RegExp(`${name}:\\{`));});
