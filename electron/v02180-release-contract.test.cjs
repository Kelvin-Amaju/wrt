const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('pod and warmer release contract is wired and version metadata agrees', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.version, /^0\.(?:21\.(?:8\d|9\d)|2[2-9]\.\d+)$/);
  assert.equal(read('version').trim(), pkg.version);
  assert.match(read('electron/preload.cjs'), /listPods/); assert.match(read('electron/preload.cjs'), /startWarmerRun/); assert.match(read('electron/preload.cjs'), /addWarmerAssignment/);
  assert.match(read('electron/main.cjs'), /pod:create/); assert.match(read('electron/main.cjs'), /warmer:startRun/); assert.match(read('electron/main.cjs'), /warmer:listRuns/);
  assert.match(read('src/pages/pods/index.tsx'), /shared\/pods/); assert.match(read('src/pages/warmer/index.tsx'), /shared\/pods/);
  assert.doesNotMatch(read('src/pages/warmer/index.tsx'), /setTimeout\(\(\) => setRunning\(false\)/);
  assert.match(read('src/pages/warmer/index.tsx'), /onClick=\{\(\) => void addAssignment\(\)\}/);
  assert.match(read('src/styles.css'), /--panel-alt:/); assert.match(read('src/styles.css'), /--text-secondary:/);
});
