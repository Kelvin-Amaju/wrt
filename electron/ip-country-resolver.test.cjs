const test = require('node:test');
const assert = require('node:assert/strict');

test('country resolver caches each unique IP and does not repeat lookup', async () => {
  const { createIpCountryResolver } = require('./ip-country-resolver.cjs');
  let calls = 0;
  const resolver = createIpCountryResolver({ lookup:async (ip) => { calls += 1; return ip === '8.8.8.8' ? 'US' : 'Unknown'; }, concurrency:1 });
  assert.equal(await resolver.resolve('8.8.8.8'), 'US');
  assert.equal(await resolver.resolve('8.8.8.8'), 'US');
  assert.equal(calls, 1);
});

test('country resolver serializes lookups at concurrency one and failures become Unknown', async () => {
  const { createIpCountryResolver } = require('./ip-country-resolver.cjs');
  let active = 0;
  let maxActive = 0;
  const resolver = createIpCountryResolver({ lookup:async (ip) => {
    active += 1; maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (ip === '1.1.1.1') throw new Error('lookup failed');
    return 'GB';
  }, concurrency:1 });
  const values = await Promise.all([resolver.resolve('1.1.1.1'), resolver.resolve('8.8.4.4')]);
  assert.deepEqual(values, ['Unknown','GB']);
  assert.equal(maxActive, 1);
  assert.equal(await resolver.resolve('1.1.1.1'), 'Unknown');
});
