const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
function atLeast(actual,minimum){
  const a=String(actual).split('.').map(Number),b=String(minimum).split('.').map(Number);
  for(let i=0;i<3;i++){if((a[i]||0)>(b[i]||0))return true;if((a[i]||0)<(b[i]||0))return false;}
  return true;
}

test('v0.18.8 package and release notes describe real Chrome and lightweight Proxy IP History', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(atLeast(pkg.version, '0.18.9'),`expected package version >= 0.18.9, got ${pkg.version}`);
  const notes = read('V0.18.8-REAL-CHROME-PROXY-IP-HISTORY.md');
  assert.match(notes, /real installed Google Chrome/i);
  assert.match(notes, /compatibility engines/i);
  assert.match(notes, /runtime verification/i);
  assert.match(notes, /Proxy IP History/i);
  assert.match(notes, /repeated.*in.*run/i);
  assert.match(notes, /lifetime/i);
  assert.match(notes, /country/i);
  assert.match(notes, /no continuous IP polling/i);
  const readme = read('README.md');
  assert.match(readme, /v0\.18\.8/i);
  for (const file of [
    'electron/chrome-runtime-resolver.test.cjs',
    'electron/browser-runtime-verifier.test.cjs',
    'electron/qa-matrix-runtime-source.test.cjs',
    'electron/proxy-ip-history-store.test.cjs',
    'electron/ip-country-resolver.test.cjs',
    'electron/proxy-ip-history-ipc-contract.test.cjs',
    'electron/proxy-ip-history-renderer-source.test.cjs',
    'electron/real-chrome-ui-source.test.cjs',
    'electron/v0188-release-contract.test.cjs',
  ]) assert.match(pkg.scripts.test, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
