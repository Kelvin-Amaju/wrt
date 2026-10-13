const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
const deviceConsistencySource = read('electron/device-consistency.cjs');
const privacyProbeSource = read('electron/privacy-probe.cjs');
const qaRunnerSource = read('electron/qa-runner.cjs');
const relevant = [deviceConsistencySource, privacyProbeSource, qaRunnerSource].join('\n');

test('automation environment stays observable and is not concealed', () => {
  assert.match(deviceConsistencySource, /navigator\.webdriver/);
  assert.match(deviceConsistencySource, /does not modify or hide it/i);
  assert.doesNotMatch(relevant, /Object\.defineProperty\s*\(\s*navigator\s*,\s*['"]webdriver['"]/);
  assert.doesNotMatch(relevant, /delete\s+navigator\.webdriver/);
});

test('privacy protection does not disable WebRTC or add fingerprint spoofing', () => {
  assert.doesNotMatch(relevant, /RTCPeerConnection\s*=\s*undefined/);
  assert.doesNotMatch(relevant, /canvas.*spoof|webgl.*spoof|audiocontext.*spoof/i);
  assert.doesNotMatch(relevant, /plugins.*spoof|fonts.*spoof|hardwareConcurrency.*spoof/i);
});
