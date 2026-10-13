const test = require('node:test');
const assert = require('node:assert/strict');
const { createProxyHealthTester, classifyProxyHealth } = require('./proxy-health.cjs');

const fakeBrowserResolver = () => ({ browserFamily:'chrome', label:'Google Chrome', executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe' });

function fakeChromium(response, calls, { throwMessage = '' } = {}) {
  return {
    async launch(options) {
      calls.push({ type: 'launch', options });
      if (throwMessage) throw new Error(throwMessage);
      return {
        async newPage() {
          return {
            async goto(url, options) {
              calls.push({ type: 'goto', url, options });
            },
            async textContent(selector) {
              calls.push({ type: 'text', selector });
              return response;
            },
          };
        },
        async close() {
          calls.push({ type: 'close' });
        },
      };
    },
  };
}

function runtimeProxy(overrides = {}) {
  return {
    id: 'p1', protocol: 'http', hostname: 'proxy.test', port: 8080,
    username: '', password: '', failureCount: 0, ...overrides,
  };
}

test('classifies a browser-verified proxy route as live and records the proxy exit IP', async () => {
  const calls = [];
  let tick = 1000;
  const tester = createProxyHealthTester({
    chromium: fakeChromium('{"ip":"95.70.38.166"}', calls),
    routeCheckUrl: 'https://check.test/ip',
    browserResolver: fakeBrowserResolver,
    now: () => tick += 50,
  });
  const result = await tester.checkProxy(runtimeProxy(), '2c0f:2280:36:918:cd48:dd8d:bcf6:9128');

  assert.equal(result.health, 'live');
  assert.equal(result.observedIp, '95.70.38.166');
  assert.equal(result.failureCount, 0);
  assert.equal(result.latencyMs, 50);
  const launch = calls.find((call) => call.type === 'launch');
  assert.equal(launch.options.headless, true);
  assert.equal(launch.options.executablePath, 'C:/Program Files/Google/Chrome/Application/chrome.exe');
  assert.deepEqual(launch.options.proxy, {
    server: 'http://proxy.test:8080',
    username: undefined,
    password: undefined,
  });
  assert.ok(launch.options.args.includes('--disable-quic'));
  assert.ok(launch.options.args.includes('--disable-background-networking'));
  assert.ok(launch.options.args.includes('--no-pings'));
});



test('measures proxy latency after Chromium startup instead of including browser launch time', async () => {
  const calls = [];
  let tick = 1000;
  const chromium = {
    async launch(options) {
      calls.push({ type: 'launch', options });
      tick += 3000;
      return {
        async newPage() {
          return {
            async goto(url, options) {
              calls.push({ type: 'goto', url, options });
              tick += 500;
            },
            async textContent(selector) {
              calls.push({ type: 'text', selector });
              return '{"ip":"95.70.38.166"}';
            },
          };
        },
        async close() {
          calls.push({ type: 'close' });
        },
      };
    },
  };
  const tester = createProxyHealthTester({
    chromium,
    routeCheckUrl: 'https://check.test/ip',
    browserResolver: fakeBrowserResolver,
    now: () => tick,
  });

  const result = await tester.checkProxy(runtimeProxy(), '2c0f:2280:36:918:cd48:dd8d:bcf6:9128');

  assert.equal(result.latencyMs, 500);
  assert.equal(result.health, 'live');
});
test('fails a browser proxy whose observed route equals the direct route', async () => {
  const calls = [];
  const tester = createProxyHealthTester({ chromium: fakeChromium('{"ip":"198.51.100.10"}', calls), routeCheckUrl: 'https://check.test/ip', browserResolver: fakeBrowserResolver });
  const result = await tester.checkProxy(runtimeProxy(), '198.51.100.10');
  assert.equal(result.health, 'dead');
  assert.match(result.error, /direct route/i);
});

test('marks third consecutive failure unavailable and schedules 15 minutes', () => {
  const result = classifyProxyHealth({ ok: false, failureCount: 2, checkedAtMs: 1000 });
  assert.equal(result.health, 'unavailable');
  assert.equal(result.failureCount, 3);
  assert.equal(Date.parse(result.nextCheckAt) - 1000, 15 * 60 * 1000);
});

test('uses slow and retry thresholds exactly', () => {
  const slow = classifyProxyHealth({ ok: true, latencyMs: 2001, failureCount: 4, checkedAtMs: 1000 });
  assert.equal(slow.health, 'slow');
  assert.equal(slow.failureCount, 0);
  assert.equal(Date.parse(slow.nextCheckAt) - 1000, 5 * 60 * 1000);

  const first = classifyProxyHealth({ ok: false, failureCount: 0, checkedAtMs: 1000 });
  assert.equal(first.health, 'dead');
  assert.equal(Date.parse(first.nextCheckAt) - 1000, 2 * 60 * 1000);

  const second = classifyProxyHealth({ ok: false, failureCount: 1, checkedAtMs: 1000 });
  assert.equal(second.health, 'dead');
  assert.equal(Date.parse(second.nextCheckAt) - 1000, 5 * 60 * 1000);

  const fourth = classifyProxyHealth({ ok: false, failureCount: 3, checkedAtMs: 1000 });
  assert.equal(fourth.health, 'unavailable');
  assert.equal(Date.parse(fourth.nextCheckAt) - 1000, 30 * 60 * 1000);
});

test('invalid browser route payload is a failure and credential text is redacted', async () => {
  const invalidCalls = [];
  const tester = createProxyHealthTester({ chromium: fakeChromium('<html>bad</html>', invalidCalls), routeCheckUrl: 'https://check.test/ip', browserResolver: fakeBrowserResolver });
  const invalid = await tester.checkProxy(runtimeProxy(), '198.51.100.10');
  assert.equal(invalid.health, 'dead');
  assert.match(invalid.error, /invalid IP/i);

  const secretCalls = [];
  const secretTester = createProxyHealthTester({
    chromium: fakeChromium('', secretCalls, { throwMessage: 'alice secret failed' }),
    routeCheckUrl: 'https://check.test/ip',
  });
  const secret = await secretTester.checkProxy(runtimeProxy({ username: 'alice', password: 'secret' }), '198.51.100.10');
  assert.equal(secret.error.includes('alice'), false);
  assert.equal(secret.error.includes('secret'), false);
});


test('proxy health uses installed Chrome or Edge instead of Playwright downloaded browser', async () => {
  const calls = [];
  const tester = createProxyHealthTester({
    chromium: fakeChromium('{\"ip\":\"203.0.113.44\"}', calls),
    routeCheckUrl: 'https://check.test/ip',
    browserResolver: () => ({ browserFamily:'edge', label:'Microsoft Edge', executablePath:'C:/Program Files/Microsoft/Edge/Application/msedge.exe' }),
  });
  const result = await tester.checkProxy(runtimeProxy(), '198.51.100.10');
  assert.equal(result.health, 'live');
  const launch = calls.find((call) => call.type === 'launch');
  assert.equal(launch.options.executablePath, 'C:/Program Files/Microsoft/Edge/Application/msedge.exe');
});

test('proxy health returns a clear error when no installed Chrome or Edge is available', async () => {
  const calls = [];
  const tester = createProxyHealthTester({
    chromium: fakeChromium('{\"ip\":\"203.0.113.44\"}', calls),
    routeCheckUrl: 'https://check.test/ip',
    browserResolver: () => null,
  });
  const result = await tester.checkProxy(runtimeProxy(), '198.51.100.10');
  assert.equal(result.health, 'dead');
  assert.match(result.error, /Chrome or Microsoft Edge/i);
  assert.equal(calls.some((call) => call.type === 'launch'), false);
});
