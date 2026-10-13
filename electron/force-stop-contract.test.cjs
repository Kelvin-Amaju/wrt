const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Electron main wires the per-run resource tracker into QA execution and hard-stop cleanup', () => {
  const source = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
  assert.match(source, /createRunResourceTracker/);
  assert.match(source, /runResourceTracker/);
  assert.match(source, /forceStopRunResources/);
  assert.match(source, /runResourceTracker\.forceCleanup/);
});

test('QA runner tracks matrix and Android browser resources for force cleanup', () => {
  const source = fs.readFileSync(path.join(__dirname, 'qa-runner.cjs'), 'utf8');
  assert.match(source, /matrix-browser:/);
  assert.match(source, /matrix-context:/);
  assert.match(source, /android-avd-context:/);
  assert.match(source, /android-device/);
});
