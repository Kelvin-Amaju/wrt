const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('OrbitQA user-facing device profile copy does not display the Playwright brand', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DeviceProfiles.tsx'), 'utf8');
  assert.doesNotMatch(source, />[^<]*Playwright[^<]*</i);
});

test('device diagnostics do not print Playwright as a user-facing detail', () => {
  const source = fs.readFileSync(path.join(__dirname, 'device-consistency.cjs'), 'utf8');
  assert.doesNotMatch(source, /'[^']*Playwright[^']*'/i);
});
