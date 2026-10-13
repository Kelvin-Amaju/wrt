const test = require('node:test');
const assert = require('node:assert/strict');
let policy = {};
try { policy = require('./safety-policy.cjs'); } catch {}

test('Auto QA safety policy rejects ads, verification, sensitive fields, and consequential actions', () => {
  assert.equal(typeof policy.isAdLike, 'function');
  assert.equal(policy.isAdLike({ text:'Sponsored', href:'https://ads.example/' }), true);
  assert.equal(policy.isVerificationChallenge({ text:'Verify you are human CAPTCHA' }), true);
  assert.equal(policy.isSafeEditableField({ type:'password', label:'Password' }), false);
  assert.equal(policy.isSafeEditableField({ type:'url', label:'Video URL' }), true);
  assert.equal(policy.isSafeAction({ text:'Buy now', role:'button' }), false);
  assert.equal(policy.isSafeAction({ text:'Generate', role:'button' }), true);
});

test('survey controls are allowed only for neutral non-sensitive choices', () => {
  assert.equal(typeof policy.isSafeSurveyControl, 'function');
  assert.equal(policy.isSafeSurveyControl({ type:'radio', label:'Overall satisfaction', text:'Satisfied' }), true);
  assert.equal(policy.isSafeSurveyControl({ type:'checkbox', label:'I consent to marketing emails' }), false);
  assert.equal(policy.isSafeSurveyControl({ type:'select-one', label:'Bank account type' }), false);
});
