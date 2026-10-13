const test = require('node:test');
const assert = require('node:assert/strict');
const { createDirectIpProvider } = require('./direct-ip-provider.cjs');

function fakeRequester(responses, calls) {
  let index = 0;
  return async (url, options) => {
    calls.push({ url, options });
    const next = responses[index++];
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next();
    return next;
  };
}

test('reads the direct route without launching Chromium and accepts IPv6', async () => {
  const calls = [];
  const provider = createDirectIpProvider({
    endpoints: ['https://check.test/ip'],
    timeoutMs: 5000,
    cacheTtlMs: 60_000,
    now: () => 1000,
    requestText: fakeRequester(['{"ip":"2c0f:2280:36:918:cd48:dd8d:bcf6:9128"}'], calls),
  });

  assert.equal(await provider(), '2c0f:2280:36:918:cd48:dd8d:bcf6:9128');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://check.test/ip');
  assert.equal(calls[0].options.timeoutMs, 5000);
});

test('caches a successful direct route and refreshes it after the TTL', async () => {
  const calls = [];
  let tick = 1000;
  const provider = createDirectIpProvider({
    endpoints: ['https://check.test/ip'],
    timeoutMs: 5000,
    cacheTtlMs: 5000,
    now: () => tick,
    requestText: fakeRequester(['{"ip":"198.51.100.10"}', '{"ip":"198.51.100.11"}'], calls),
  });

  assert.equal(await provider(), '198.51.100.10');
  tick = 3000;
  assert.equal(await provider(), '198.51.100.10');
  assert.equal(calls.length, 1);

  tick = 7001;
  assert.equal(await provider(), '198.51.100.11');
  assert.equal(calls.length, 2);
});

test('tries lightweight fallback endpoints before declaring the diagnostic unavailable', async () => {
  const calls = [];
  const provider = createDirectIpProvider({
    endpoints: ['https://one.test/ip', 'https://two.test/ip'],
    timeoutMs: 5000,
    cacheTtlMs: 60_000,
    now: () => 1000,
    requestText: fakeRequester([new Error('first endpoint failed'), '203.0.113.9\n'], calls),
  });

  assert.equal(await provider(), '203.0.113.9');
  assert.deepEqual(calls.map((call) => call.url), ['https://one.test/ip', 'https://two.test/ip']);
});

test('coalesces concurrent direct-route checks so only one request is made', async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const provider = createDirectIpProvider({
    endpoints: ['https://check.test/ip'],
    now: () => 1000,
    requestText: async (url, options) => {
      calls.push({ url, options });
      await gate;
      return '{"ip":"198.51.100.10"}';
    },
  });

  const first = provider();
  const second = provider();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), ['198.51.100.10', '198.51.100.10']);
});

test('rejects only after all configured direct route endpoints fail', async () => {
  const calls = [];
  const provider = createDirectIpProvider({
    endpoints: ['https://one.test/ip', 'https://two.test/ip'],
    requestText: fakeRequester([new Error('offline one'), new Error('offline two')], calls),
  });
  await assert.rejects(provider(), /Direct route diagnostic unavailable after trying all configured IP endpoints/);
  assert.equal(calls.length, 2);
});
