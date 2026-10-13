const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'qaMatrix.ts'), 'utf8');

test('qa matrix declares installed Chrome runtime and new defaults', () => {
  assert.match(source, /export type QaBrowserRuntime[\s\S]*'chrome-installed'/);
  assert.match(source, /desktop:[\s\S]*browsers:\s*\['chrome-installed'\]/);
  assert.match(source, /androidEmulation:[\s\S]*browserRuntime:\s*'chrome-installed'/);
  assert.match(source, /iosEmulation:[\s\S]*browsers:\s*\['chrome-installed'\]/);
});

test('qa matrix preserves explicit legacy Android emulation as Playwright Chromium', () => {
  assert.match(source, /androidRaw\.browserRuntime[\s\S]*chromium-playwright/);
});
