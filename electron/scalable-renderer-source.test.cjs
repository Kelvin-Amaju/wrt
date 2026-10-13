const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'Run.tsx'), 'utf8');
const editorSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'TargetPlanEditor.tsx'), 'utf8');
const legacySource = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'run.ts'), 'utf8');

test('renderer removes the per-group instance maximum and does not materialize queued work states', () => {
  assert.doesNotMatch(editorSource, /max="20"/);
  assert.doesNotMatch(runsSource, /function buildQueuedStates/);
  assert.doesNotMatch(runsSource, /setWorkStates\(buildQueuedStates/);
});

test('renderer exposes Auto and manual concurrency plus aggregate run metrics', () => {
  assert.match(runsSource, /Auto/);
  assert.match(runsSource, /Manual/);
  assert.match(runsSource, /run-metrics/);
  assert.match(runsSource, /Requested/);
  assert.match(runsSource, /Queued/);
  assert.match(runsSource, /Manual mode honors the concurrency number you enter/);
});


test('legacy request validation has no arbitrary session or concurrency caps', () => {
  assert.doesNotMatch(legacySource, /Sessions must be between 1 and 20/);
  assert.doesNotMatch(legacySource, /Concurrency must be between 1 and 5/);
  assert.doesNotMatch(legacySource, /Concurrency cannot be higher than total work units/);
});


test('renderer bounds terminal work-unit rows while preserving aggregate metrics', () => {
  assert.match(runsSource, /MAX_RECENT_TERMINAL_WORK_STATES\s*=\s*100/);
  assert.match(runsSource, /function upsertBoundedWorkState/);
  assert.match(runsSource, /slice\(-MAX_RECENT_TERMINAL_WORK_STATES\)/);
  assert.match(runsSource, /pruneWorkStates/);
});
