const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Device Profiles distinguishes compatibility emulation from native mobile runtimes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'DeviceProfiles.tsx'), 'utf8');
  assert.match(source, /Native Android runtime/i);
  assert.match(source, /ADB recovery/i);
  assert.match(source, /Compatibility emulation/i);
  assert.match(source, /Real iOS provider/i);
});
