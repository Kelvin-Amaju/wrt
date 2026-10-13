const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Test Run device matrix exposes real Chrome and compatibility choices truthfully', () => {
  const source = read('src/components/DeviceMatrixEditor.tsx');
  assert.match(source, /Google Chrome — REAL/);
  assert.match(source, /Chromium — Compatibility/);
  assert.match(source, /WebKit — iOS\/Safari Compatibility/);
  assert.match(source, /REAL CHROME APP/);
});

test('Test Runs renders worker runtime verification rather than trusting legacy browser labels', () => {
  const source = read('src/pages/Run.tsx');
  assert.match(source, /runtime-verification/);
  assert.match(source, /runtimeVerification/);
  assert.match(read('src/components/DeviceMatrixEditor.tsx'), /Google Chrome not found/);
});

test('Target plan editor exposes installed Chrome wherever the new defaults use it', () => {
  const source = read('src/components/TargetPlanEditor.tsx');
  assert.match(source, /value: 'chrome-installed', label: 'Google Chrome — REAL \/ Default'/);
  assert.match(source, /value: 'chrome-installed', label: 'Google Chrome — iPhone\/iPad Emulation'/);
});
