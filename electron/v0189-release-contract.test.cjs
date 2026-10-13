const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
function atLeast(actual,minimum){
  const a=String(actual).split('.').map(Number),b=String(minimum).split('.').map(Number);
  for(let i=0;i<3;i++){if((a[i]||0)>(b[i]||0))return true;if((a[i]||0)<(b[i]||0))return false;}
  return true;
}

test('v0.18.9 package and notes include privacy history control and transparent route integrity', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(atLeast(pkg.version, '0.18.9'),`expected package version >= 0.18.9, got ${pkg.version}`);
  for (const required of [
    'electron/privacy-route-integrity.test.cjs',
    'electron/privacy-route-integrity-renderer-source.test.cjs',
    'electron/privacy-safety-contract.test.cjs',
    'electron/v0189-release-contract.test.cjs',
  ]) assert.match(pkg.scripts.test, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const note = read('V0.18.9-PRIVACY-HISTORY-CONTROL.md');
  assert.match(note, /Proxy IP History ACTIVE\/INACTIVE/i);
  assert.match(note, /Privacy & Route Integrity/i);
  assert.match(note, /navigator\.webdriver/i);
  assert.match(note, /no stealth|does not conceal/i);
});
