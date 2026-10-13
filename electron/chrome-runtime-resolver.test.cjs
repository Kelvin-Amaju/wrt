const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveInstalledChrome } = require('./chrome-runtime-resolver.cjs');

test('finds installed Chrome in LocalAppData when machine-wide locations are absent', () => {
  const existing = new Set(['C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe']);
  const result = resolveInstalledChrome({
    env: { PROGRAMFILES:'C:\\Program Files', 'PROGRAMFILES(X86)':'C:\\Program Files (x86)', LOCALAPPDATA:'C:\\Users\\u\\AppData\\Local' },
    existsSync: (value) => existing.has(value),
  });
  assert.equal(result.found, true);
  assert.equal(result.source, 'local-app-data');
  assert.equal(result.executablePath, 'C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe');
});

test('prefers Program Files before x86 and LocalAppData', () => {
  const env = { PROGRAMFILES:'C:\\Program Files', 'PROGRAMFILES(X86)':'C:\\Program Files (x86)', LOCALAPPDATA:'C:\\Users\\u\\AppData\\Local' };
  const result = resolveInstalledChrome({ env, existsSync: () => true });
  assert.equal(result.source, 'program-files');
  assert.equal(result.executablePath, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
});

test('returns not found and never substitutes Edge or Chromium', () => {
  const seen = [];
  const result = resolveInstalledChrome({
    env: { PROGRAMFILES:'C:\\Program Files', 'PROGRAMFILES(X86)':'C:\\Program Files (x86)', LOCALAPPDATA:'C:\\Users\\u\\AppData\\Local' },
    existsSync: (value) => { seen.push(value); return value.includes('Microsoft\\Edge') || value.includes('Chromium'); },
  });
  assert.equal(result.found, false);
  assert.equal(result.executablePath, undefined);
  assert.equal(seen.length, 3);
  assert.equal(seen.every((value) => value.includes('Google\\Chrome\\Application\\chrome.exe')), true);
});
