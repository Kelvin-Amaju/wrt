const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const marker = '/* v0.21.70 app-wide responsive containment and narrow-window hardening */';
const releaseCss = css.slice(css.indexOf(marker));

test('v0.21.70 global containment layer exists and keeps first-party layouts shrinkable', () => {
  assert.ok(css.includes(marker));
  assert.match(releaseCss, /\[class\*="grid"\],\[class\*="layout"\],\[class\*="workspace"\]/);
  assert.match(releaseCss, /min-width:0;\s*max-width:100%;/);
  assert.match(releaseCss, /:where\(input,select,textarea,button\)\{\s*max-width:100%;/s);
});

test('streaming account dynamic content cannot force card overflow', () => {
  assert.match(releaseCss, /\.stream-account-card\{overflow:hidden;\}/);
  assert.match(releaseCss, /\.stream-account-health\{\s*grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\);\s*overflow:hidden;/s);
  assert.match(releaseCss, /\.stream-account-health>\.account-proxy-picker\{\s*grid-column:1\/-1;/s);
  assert.match(releaseCss, /\.stream-account-card__actions\{\s*grid-template-columns:repeat\(auto-fit,minmax\(112px,1fr\)\)/s);
});

test('social accounts and action groups wrap inside their cards', () => {
  assert.match(releaseCss, /\.social-account-card\{overflow:hidden;\}/);
  assert.match(releaseCss, /\.social-actions button\{flex:1 1 112px;\}/);
  assert.match(releaseCss, /\.social-account-sticky\{display:grid;gap:7px;\}/);
});

test('responsive breakpoints collapse rigid workspaces before they overflow', () => {
  assert.match(releaseCss, /@media\(max-width:1280px\)/);
  assert.match(releaseCss, /\.streaming-accounts-page-layout,[\s\S]*\.scheduler-grid\{\s*grid-template-columns:1fr;/);
  assert.match(releaseCss, /@media\(max-width:760px\)/);
  assert.match(releaseCss, /\.stream-account-health\{grid-template-columns:1fr;\}/);
});

test('tables retain internal scrolling instead of widening the app', () => {
  assert.match(releaseCss, /\.proxy-ip-history-table-wrap\{max-width:100%;overflow-x:auto;overflow-y:hidden;\}/);
});
