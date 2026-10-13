const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRealIosProvider } = require('./real-ios-provider.cjs');

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

test('creates and deletes a Safari iOS WebDriver session', async () => {
  const requests = [];
  await withServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null, auth: req.headers.authorization });
    if (req.method === 'POST' && req.url === '/session') {
      return json(res, 200, { value: { sessionId: 'abc', capabilities: { browserName: 'safari' } } });
    }
    if (req.method === 'DELETE' && req.url === '/session/abc') return json(res, 200, { value: null });
    return json(res, 404, { value: { error: 'unknown command', message: 'not found' } });
  }, async (remoteUrl) => {
    const provider = createRealIosProvider({ fetchImpl: fetch, timeoutMs: 1000 });
    const config = { remoteUrl, username: '', accessKey: '' };
    const created = await provider.createSession(config, { device: 'iPhone 15', iosVersion: '17', browser: 'safari' });
    assert.equal(created.sessionId, 'abc');
    assert.equal(requests[0].body.capabilities.alwaysMatch.platformName, 'iOS');
    assert.equal(requests[0].body.capabilities.alwaysMatch.browserName, 'safari');
    assert.equal(requests[0].body.capabilities.alwaysMatch['appium:deviceName'], 'iPhone 15');
    await provider.deleteSession(config, 'abc');
    assert.equal(requests.at(-1).method, 'DELETE');
  });
});

test('sends Basic authentication when credentials are configured', async () => {
  let auth;
  await withServer((req, res) => {
    auth = req.headers.authorization;
    json(res, 200, { value: { ready: true, safariSupported: true, chromeSupported: false } });
  }, async (remoteUrl) => {
    const provider = createRealIosProvider({ fetchImpl: fetch, timeoutMs: 1000 });
    await provider.testConnection({ remoteUrl, username: 'qa', accessKey: 'sekret' });
    assert.equal(auth, `Basic ${Buffer.from('qa:sekret').toString('base64')}`);
  });
});

test('normalizes provider status browser capability flags', async () => {
  await withServer((_req, res) => {
    json(res, 200, { value: { ready: true, authenticated: true, safariSupported: true, chromeSupported: false, message: 'ready' } });
  }, async (remoteUrl) => {
    const provider = createRealIosProvider({ fetchImpl: fetch, timeoutMs: 1000 });
    const status = await provider.testConnection({ remoteUrl, username: '', accessKey: '' });
    assert.deepEqual(status, {
      reachable: true,
      authenticated: true,
      safariSupported: true,
      chromeSupported: false,
      message: 'ready',
    });
  });
});

test('maps request aborts to a provider timeout error', async () => {
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  const provider = createRealIosProvider({ fetchImpl, timeoutMs: 10 });
  await assert.rejects(
    provider.testConnection({ remoteUrl: 'https://provider.example', username: '', accessKey: '' }),
    /Provider unreachable or timed out/,
  );
});

test('executes async browser diagnostics through W3C execute/async', async () => {
  let seenPath = '';
  await withServer(async (req, res) => {
    seenPath = req.url;
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    assert.equal(body.script, 'return-later');
    json(res, 200, { value: { platform: 'iPhone', literalIpCandidates: ['10.0.0.2'] } });
  }, async (remoteUrl) => {
    const provider = createRealIosProvider({ fetchImpl: fetch, timeoutMs: 1000 });
    const value = await provider.executeAsyncScript({ remoteUrl, username: '', accessKey: '' }, 'abc', 'return-later', []);
    assert.equal(seenPath, '/session/abc/execute/async');
    assert.deepEqual(value.literalIpCandidates, ['10.0.0.2']);
  });
});

test('translates navigation, element actions, scroll and screenshot to W3C commands', async () => {
  const requests = [];
  await withServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, url: req.url, body: raw ? JSON.parse(raw) : null });
    if (req.url === '/session/abc/element') return json(res, 200, { value: { 'element-6066-11e4-a52e-4f735466cecf': 'el-1' } });
    if (req.url === '/session/abc/screenshot') return json(res, 200, { value: Buffer.from('shot').toString('base64') });
    return json(res, 200, { value: null });
  }, async (remoteUrl) => {
    const provider = createRealIosProvider({ fetchImpl: fetch, timeoutMs: 1000 });
    const config = { remoteUrl, username: '', accessKey: '' };
    await provider.navigate(config, 'abc', 'https://example.com');
    await provider.click(config, 'abc', '#go');
    await provider.type(config, 'abc', '#email', 'qa@example.com');
    await provider.scroll(config, 'abc', 'down', 500);
    const screenshot = await provider.screenshot(config, 'abc');
    assert.equal(Buffer.from(screenshot, 'base64').toString(), 'shot');
    assert.equal(requests.some((r) => r.url === '/session/abc/url' && r.body.url === 'https://example.com'), true);
    assert.equal(requests.some((r) => r.url === '/session/abc/element/el-1/click'), true);
    assert.equal(requests.some((r) => r.url === '/session/abc/element/el-1/value' && r.body.text === 'qa@example.com'), true);
    assert.equal(requests.some((r) => r.url === '/session/abc/execute/sync' && r.body.args[0] === 500), true);
  });
});

test('treats a healthy generic Appium server as Safari-capable but not Chrome-capable', async () => {
  await withServer((_req, res) => {
    json(res, 200, { value: { ready: true, message: 'Appium ready' } });
  }, async (remoteUrl) => {
    const provider = createRealIosProvider({ fetchImpl: fetch, timeoutMs: 1000 });
    const status = await provider.testConnection({ remoteUrl, username: '', accessKey: '' });
    assert.equal(status.safariSupported, true);
    assert.equal(status.chromeSupported, false);
  });
});
