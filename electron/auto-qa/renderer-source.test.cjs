const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runsSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'pages', 'Run.tsx'), 'utf8');
const matrixSource = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'shared', 'qaMatrix.ts'), 'utf8');

test('renderer defaults to Auto QA and keeps manual script behind Advanced mode', () => {
  assert.match(runsSource, /Behavior Mode/);
  assert.match(runsSource, /Auto QA/);
  assert.match(runsSource, /Manual Script \(Advanced\)/);
  assert.match(runsSource, /Reading Pace/);
  assert.match(runsSource, /Referrer QA/);
  assert.match(runsSource, /Safe form actions/);
  assert.match(runsSource, /Observe new tabs/);
  assert.match(runsSource, /SIMULATED/);
  assert.match(matrixSource, /behaviorMode:\s*'auto'/);
});

test('renderer sends Auto QA settings in every matrix run request', () => {
  assert.match(runsSource, /autoQa,/);
  assert.match(matrixSource, /autoQa:\s*AutoQaSettings/);
});

test('renderer freezes Auto QA settings while a run is active and labels simulated referrers honestly', () => {
  assert.match(runsSource, /fieldset className="behavior-fieldset" disabled=\{running\}/);
  assert.match(runsSource, /Google Search · SIMULATED QA/);
  assert.match(runsSource, /Site Referral QA/);
  assert.match(runsSource, /Google Search opens Google first/i);
  assert.match(runsSource, /Facebook\/Pinterest\/custom options remain simulated referrer-header QA/i);
});

test('LIVE MATRIX shows ad counts by format while Locale and Timezone diagnostic rows are hidden from the visible result', () => {
  assert.match(runsSource, /ADS OBSERVED/);
  assert.match(runsSource, /Total seen/);
  assert.match(runsSource, /Sticky \/ Anchor/);
  assert.match(runsSource, /Interstitial \/ Vignette/);
  assert.match(runsSource, /No visible ads detected/);
  assert.match(runsSource, /visibleDiagnosticChecks/);
  assert.match(runsSource, /\['locale','timezone'\]/);
});
