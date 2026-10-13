const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium, firefox, webkit } = require('playwright');
const { installStrictPrivacyGuard, assertStrictPrivacyGuard, collectStrictPrivacyGuardState } = require('./privacy-probe.cjs');

async function withServer(fn) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>OrbitQA Health</title><main id="ready">ready</main>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

for (const [name, launcher] of Object.entries({ chromium, firefox, webkit })) {
  test(`${name} launches, navigates, executes JavaScript, screenshots, and closes`, async () => {
    await withServer(async (url) => {
      const browser = await launcher.launch({ headless: true });
      try {
        const context = await browser.newContext();
        await context.clearPermissions();
        await installStrictPrivacyGuard(context, true);
        const page = await context.newPage();
        await assertStrictPrivacyGuard(page, true);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const privacyState = await collectStrictPrivacyGuardState(page);
        assert.notEqual(privacyState.webrtc, 'unblocked');
        assert.notEqual(privacyState.camera, 'prompt');
        assert.notEqual(privacyState.microphone, 'prompt');
        assert.notEqual(privacyState.geolocation, 'prompt');
        assert.notEqual(privacyState.notifications, 'prompt');
        assert.equal(await page.locator('#ready').textContent(), 'ready');
        assert.equal(await page.evaluate(() => 6 * 7), 42);
        const screenshot = await page.screenshot();
        assert.equal(Buffer.isBuffer(screenshot), true);
        assert.equal(screenshot.length > 100, true);
        await context.close();
      } finally {
        await browser.close();
      }
    });
  });
}
