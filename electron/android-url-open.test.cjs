const test = require('node:test');
const assert = require('node:assert/strict');
const url = require('./android-url.cjs');

function recorder(responses) {
  const calls = [];
  const adb = async (args) => {
    calls.push(args.join(' '));
    for (const [pattern, value] of responses) {
      if (new RegExp(pattern).test(args.join(' '))) return value;
    }
    return '';
  };
  return { adb, calls };
}

const INSTALLED = [[/pm list packages/, 'package:com.android.chrome']];

test('shellQuote survives query strings, apostrophes and spaces', () => {
  assert.equal(url.shellQuote('https://a.com/x?y=1&z=2'), `'https://a.com/x?y=1&z=2'`);
  assert.equal(url.shellQuote("https://a.com/o'brien"), `'https://a.com/o'\\''brien'`);
  assert.equal(url.shellQuote('https://a.com/a b'), `'https://a.com/a b'`);
});

test('normalizeUrl adds a scheme only when one is missing', () => {
  assert.equal(url.normalizeUrl('example.com'), 'https://example.com');
  assert.equal(url.normalizeUrl('http://example.com'), 'http://example.com');
  assert.throws(() => url.normalizeUrl('   '));
});

test('prepareChrome writes flags and force-stops before launching', async () => {
  const { adb, calls } = recorder(INSTALLED);
  await url.prepareChrome(adb);
  const forceStop = calls.findIndex((c) => c.includes('force-stop'));
  const writeFlags = calls.findIndex((c) => c.includes('chrome-command-line'));
  const debugApp = calls.findIndex((c) => c.includes('set-debug-app'));
  assert.ok(forceStop >= 0 && writeFlags > forceStop && debugApp > writeFlags);
  assert.match(calls[writeFlags], /--disable-fre/);
  assert.match(calls[writeFlags], /--no-first-run/);
});

test('prepareChrome throws when Chrome is absent', async () => {
  const { adb } = recorder([[/pm list packages/, 'package:com.other']]);
  await assert.rejects(() => url.prepareChrome(adb), /Chrome is not installed/);
});

test('openUrl uses an explicit component and a quoted URL', async () => {
  const { adb, calls } = recorder([
    ...INSTALLED,
    [/url_bar/, 'text="https://a.com/x?y=1&amp;z=2"'],
    [/am start/, 'Starting: Intent'],
  ]);
  await url.openUrl(adb, 'https://a.com/x?y=1&z=2');
  const start = calls.find((c) => c.includes('am start'));
  assert.ok(start.includes(`-d 'https://a.com/x?y=1&z=2'`));
  assert.ok(start.includes('-n com.android.chrome/com.google.android.apps.chrome.Main'));
  assert.ok(start.includes('--activity-clear-top'));
});

test('openUrl rejects when the intent fails to resolve', async () => {
  const { adb } = recorder([
    ...INSTALLED,
    [/am start/, 'Error: Activity not started, unable to resolve Intent'],
  ]);
  await assert.rejects(() => url.openUrl(adb, 'https://a.com'), /refused the navigation intent/);
});

test('assertUrlLoaded throws when the omnibox never matches', async () => {
  const { adb } = recorder([[/url_bar/, 'text="about:blank"']]);
  await assert.rejects(() => url.assertUrlLoaded(adb, 'https://a.com', 1200), /never loaded/);
});

test('promo buttons are tapped from a dump', async () => {
  const xml = '<node text="Accept &amp; continue" bounds="[10,20][110,80]" />';
  const { adb, calls } = recorder([[/uiautomator dump/, ''], [/cat /, xml]]);
  assert.equal(await url.dismissChromePromo(adb), true);
  assert.ok(calls.some((c) => c.includes('input tap 60 50')));
});