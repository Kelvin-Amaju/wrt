const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'Run.tsx'), 'utf8');
const eventSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'run.ts'), 'utf8');

test('renderer exposes Session & Network Integrity as a per-work-unit diagnostic', () => {
  assert.match(eventSource, /'session-integrity'/);
  assert.match(eventSource, /sessionIntegrity\?:\s*SessionIntegrityReport/);
  assert.match(runsSource, /Session &amp; Network Integrity/);
  assert.match(runsSource, /LATEST SESSION INTEGRITY/);
  assert.match(runsSource, /event\.type === 'session-integrity'/);
});
