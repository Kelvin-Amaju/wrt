const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('v0.20.2 main process imports every Social Hub startup service before use',()=>{
  const s=fs.readFileSync('electron/main.cjs','utf8');
  const required=[
    ['listSocialPlatforms','./social/platforms.cjs'],
    ['createSocialAccountStore','./social/account-store.cjs'],
    ['createSocialTargetStore','./social/target-store.cjs'],
    ['createSocialRunStore','./social/run-store.cjs'],
    ['createSocialAccountVerificationManager','./social/account-verification-manager.cjs'],
    ['createSocialRunner','./social/social-runner.cjs'],
    ['createSocialGroupStore','./social/group-store.cjs'],
  ];
  for(const [name,modulePath] of required) assert.ok(s.includes(`const { ${name} } = require('${modulePath}');`),`missing startup import: ${name}`);
});

test('v0.20.2 surfaces startup failures instead of silently closing',()=>{
  const s=fs.readFileSync('electron/main.cjs','utf8');
  assert.match(s,/dialog\.showErrorBox\('OrbitQA could not start'/);
  assert.match(s,/app\.whenReady\(\)\.then\(async \(\) => \{/);
  assert.match(s,/\}\)\.catch\(\(error\) => \{/);
});
