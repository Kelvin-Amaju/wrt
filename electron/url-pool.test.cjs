const test = require('node:test');
const assert = require('node:assert/strict');

const { createUrlDeck, normalizePoolUrl, parseUrlPoolText } = require('./url-pool.cjs');

test('normalizes and deduplicates a large multiline URL pool without a product cap', () => {
  const input = ['example.com', 'https://EXAMPLE.com/', 'https://a.example/p?q=1', '', ...Array.from({ length: 1000 }, (_, i) => `host${i}.example`) ].join('\n');
  const result = parseUrlPoolText(input);
  assert.equal(result.valid[0], 'https://example.com/');
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.invalid, []);
  assert.equal(result.valid.length, 1002);
});

test('keeps invalid entries visible while preserving valid entries', () => {
  const result = parseUrlPoolText('good.example\nfile:///tmp/a\nnot a url');
  assert.deepEqual(result.valid, ['https://good.example/']);
  assert.deepEqual(result.invalid.map((item) => item.input), ['file:///tmp/a', 'not a url']);
});

test('normalization preserves meaningful path and query data', () => {
  assert.equal(normalizePoolUrl('HTTPS://Example.COM/Case?q=A#frag'), 'https://example.com/Case?q=A#frag');
});

test('fixed seed covers every URL before reuse and is reproducible', () => {
  const urls = ['https://a.example/', 'https://b.example/', 'https://c.example/'];
  const first = createUrlDeck(urls, 'run-42');
  const second = createUrlDeck(urls, 'run-42');
  const seq1 = Array.from({ length: 6 }, () => first.next());
  const seq2 = Array.from({ length: 6 }, () => second.next());
  assert.deepEqual(seq1, seq2);
  assert.equal(new Set(seq1.slice(0, 3)).size, 3);
  assert.equal(new Set(seq1.slice(3, 6)).size, 3);
});
