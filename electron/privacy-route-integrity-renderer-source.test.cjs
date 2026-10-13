const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const testRuns = fs.readFileSync(path.join(root, 'src/pages/Run.tsx'), 'utf8');
const runCenter = fs.readFileSync(path.join(root, 'src/pages/RunCenter.tsx'), 'utf8');

 test('Test Runs consumes privacy-route-integrity events and renders one bounded live token per work unit', () => {
  assert.match(testRuns, /privacy-route-integrity/);
  assert.match(testRuns, /privacyRouteByWork/);
  assert.match(testRuns, /PRIVACY PASS/);
  assert.match(testRuns, /PRIVACY FAIL/);
  assert.match(testRuns, /NOT VERIFIED/);
});

test('Run Center renders persisted Privacy & Route Integrity truth without inventing claims', () => {
  assert.match(runCenter, /Privacy &(?:amp;)? Route Integrity/);
  for (const token of ['PASS','FAIL','NOT VERIFIED','UNSUPPORTED','BLOCKED','INFO']) assert.match(runCenter, new RegExp(token));
  assert.match(runCenter, /DNS Route Integrity/);
  assert.match(runCenter, /Automation Environment/);
  assert.doesNotMatch(runCenter, /DNS[^\n]{0,40}PASS/i);
  assert.doesNotMatch(runCenter, /navigator\.webdriver\s*=/);
});
