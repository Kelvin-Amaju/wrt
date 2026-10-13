const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('QaRunRequestV2 includes executionMode because its normalizer reads and returns it', () => {
  const text = read('src/shared/qaMatrix.ts');
  const match = text.match(/export interface QaRunRequestV2\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, 'QaRunRequestV2 interface not found');
  assert.match(match[1], /executionMode\s*:\s*RunExecutionMode\s*;/);
});

test('RunCenter does not use unknown diagnostic payloads directly as JSX conditions', () => {
  const text = read('src/pages/RunCenter.tsx');
  for (const field of ['latestAdSummary','latestIdentity','latestPrivacy','latestIntegrity']) {
    assert.doesNotMatch(text, new RegExp(`\\{detail\\.${field}\\s*&&`), `${field} must be narrowed to boolean/nullability before JSX`);
  }
});

test('Vite build uses relative asset paths for Electron file loading', () => {
  const text = read('vite.config.ts');
  assert.match(text, /base\s*:\s*['"]\.\/['"]/,
    'Electron loadFile requires Vite base ./ so dist assets resolve under file://');
});

