const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

test('workspace is constrained to the desktop window', () => {
  assert.match(css, /\.workspace\s*\{[^}]*height:\s*100vh;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
});

test('main content owns vertical scrolling', () => {
  assert.match(css, /\.content\s*\{[^}]*flex:\s*1\s+1\s+auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*overflow-x:\s*hidden;/s);
});

test('Run Center inline control CSS is well formed', () => {
  assert.doesNotMatch(css, /width:\s*100\.run-center-inline-control/);
  assert.match(css, /\.run-center-inline-control\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,1fr\)\s+auto;[^}]*\}/s);
  assert.match(css, /\.run-center-inline-control input\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*36px;[^}]*\}/s);
});


test('Proxy IP History recording control stays scoped and responsive', () => {
  assert.match(css, /\.proxy-ip-history-recording\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,1fr\)\s+auto;[^}]*\}/s);
  assert.match(css, /\.proxy-ip-history-recording-actions button\s*\{[^}]*font-size:\s*12px;[^}]*min-height:\s*34px;[^}]*\}/s);
  assert.match(css, /@media\(max-width:640px\)\{[^}]*\.proxy-ip-history-recording\{grid-template-columns:1fr\}/s);
  const recordingCss = css.slice(css.indexOf('.proxy-ip-history-recording{'));
  assert.doesNotMatch(recordingCss, /(^|[},])\s*button\s*\{/m);
});

test('v0.18.9 privacy route status surfaces stay scoped and readable', () => {
  assert.match(css, /\.privacy-route-token\{[^}]*font-size:10px/);
  assert.match(css, /\.run-privacy-route-check\{[^}]*font-size:11px/);
  assert.match(css, /\.run-privacy-route-check--not-verified/);
  const privacyCss = css.slice(css.indexOf('/* v0.18.9 additive Privacy & Route Integrity status surfaces */'));
  assert.equal((privacyCss.match(/\{/g) || []).length, (privacyCss.match(/\}/g) || []).length);
});
