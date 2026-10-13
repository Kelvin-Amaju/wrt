const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Test Runs renders device identity diagnostics and keeps iOS compatibility limitations explicit', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'Run.tsx'), 'utf8');
  const eventTypes = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'run.ts'), 'utf8');

  assert.match(eventTypes, /'identity-diagnostics'/);
  assert.match(eventTypes, /identityDiagnostics\?: DeviceIdentityReport/);
  assert.match(source, /Device Identity Check/);
  assert.match(source, /LATEST DEVICE CONSISTENCY/);
  assert.match(source, /setIdentityDiagnostics\(event\.identityDiagnostics\)/);
  assert.match(source, /Runtime fidelity/);
  assert.match(source, /Profile Consistency/);
  assert.match(source, /Functional Compatibility/);
  assert.match(source, /Host \/ Runtime Information/);
  assert.match(source, /Physical iPhone Fidelity/);
  assert.match(source, /HOST INFO/);
});
