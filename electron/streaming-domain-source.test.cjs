const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('streaming shared domain and run kind are wired', () => {
  const streaming = fs.readFileSync('src/shared/streaming.ts','utf8');
  const runCenter = fs.readFileSync('src/shared/runCenter.ts','utf8');
  assert.match(streaming, /StreamingPlatform/);
  assert.match(streaming, /normalizeStreamingQueueMode/);
  assert.match(streaming, /normalizeObservationRange/);
  assert.match(runCenter, /runKind/);
  assert.match(runCenter, /normalizeRunKind/);
});
