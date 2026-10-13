const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');

test('v0.21.53 Referrer QA exposes transparent Google simulation and Site Referral UI', () => {
  const source = fs.readFileSync(path.join(root, 'src/pages/Run.tsx'), 'utf8');
  const bundle = fs.readFileSync(path.join(root, 'dist/assets/index-manual.js'), 'utf8');
  for (const text of [source, bundle]) {
    assert.match(text, /Google Search/);
    assert.match(text, /SIMULATED QA/);
    assert.match(text, /Site Referral QA/);
    assert.match(text, /Referral target/);
  }
});

test('v0.21.53 runs referral navigation before active session timer starts', () => {
  const runner = fs.readFileSync(path.join(__dirname, 'qa-runner.cjs'), 'utf8');
  const navIndex = runner.lastIndexOf('navigateWithReferrerQa({');
  const timerIndex = runner.indexOf('lifetime.beginActiveSession?.(baseDurationMs)', navIndex);
  assert.ok(navIndex >= 0);
  assert.ok(timerIndex > navIndex);
});

test('v0.21.53 site referral uses the visible interaction driver and safety filters', () => {
  const source = fs.readFileSync(path.join(__dirname, 'auto-qa/referrer-navigation.cjs'), 'utf8');
  assert.match(source, /clickWithInteractionIndicator/);
  assert.match(source, /UNSAFE_TEXT/);
  assert.match(source, /sponsored/);
  assert.match(source, /download/);
  assert.match(source, /http:/);
  assert.match(source, /https:/);
});
