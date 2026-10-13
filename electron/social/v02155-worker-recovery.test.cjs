const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {_test}=require('./social-runner.cjs');

test('social transient target failures are recoverable but security challenges are manual attention',()=>{
  const e=new Error('Saved Instagram account session could not be confirmed after automatic recovery: temporary timeout');e.code='ORBITQA_SOCIAL_SESSION_TRANSIENT';
  assert.equal(_test.recoverableSocialWorkerError(e),true);
  assert.equal(_test.recoverableSocialWorkerError(new Error('page frozen; try again')),true);
  assert.equal(_test.recoverableSocialWorkerError(new Error('CAPTCHA / MFA verification code required')),false);
  assert.equal(_test.manualAttentionSocialError(new Error('requires manual security verification')),true);
});

test('social recovery keeps the same account profile identity and rotates static preferred proxy',()=>{
  const account={id:'a1',platform:'youtube',proxySource:'static',staticProxyId:'p1',sessionSecret:'saved'};
  const retry=_test.socialRecoveryAccount(account,1);assert.equal(retry.id,'a1');assert.equal(retry.sessionSecret,'saved');assert.equal(retry.staticProxyId,'');assert.equal(account.staticProxyId,'p1');
});

test('social worker source requeues only the failed target and exposes RECOVERING/manual states',()=>{
  const src=fs.readFileSync(require.resolve('./social-runner.cjs'),'utf8');
  assert.match(src,/queue\.splice\(workerTaskIndex,0,\{\.\.\.item,recoveryAttempt:recoveryAttempt\+1\}\)/);
  assert.match(src,/status:'RECOVERING'/);
  assert.match(src,/MANUAL_ATTENTION_REQUIRED/);
  assert.match(src,/Promise\.all\(\[\.\.\.accountQueues\.entries\(\)\]/);
});
