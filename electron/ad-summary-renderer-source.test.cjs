const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'src/pages/Run.tsx'), 'utf8');

test('Live Matrix uses a structured ad observation card instead of one inline sentence', () => {
  assert.match(source, /ADS OBSERVED/);
  assert.match(source, /No visible ads detected/);
  assert.match(source, /ad-summary-row/);
  assert.doesNotMatch(source, /<strong>Ads seen:/);
});
