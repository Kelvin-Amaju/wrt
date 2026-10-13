import { describe, expect, it } from 'vitest';
import { normalizePoolUrl, parseUrlPool } from './urlPool';

describe('URL pool', () => {
  it('normalizes and deduplicates a large multiline pool without a product cap', () => {
    const input = ['example.com', 'https://EXAMPLE.com/', 'https://a.example/p?q=1', '', ...Array.from({ length: 1000 }, (_, i) => `host${i}.example`) ].join('\n');
    const result = parseUrlPool(input);
    expect(result.valid[0]).toBe('https://example.com/');
    expect(result.duplicates).toBe(1);
    expect(result.invalid).toEqual([]);
    expect(result.valid).toHaveLength(1002);
  });

  it('keeps invalid entries visible while preserving valid entries', () => {
    const result = parseUrlPool('good.example\nfile:///tmp/a\nnot a url');
    expect(result.valid).toEqual(['https://good.example/']);
    expect(result.invalid.map((item) => item.input)).toEqual(['file:///tmp/a', 'not a url']);
  });

  it('preserves meaningful path and query data', () => {
    expect(normalizePoolUrl('HTTPS://Example.COM/Case?q=A#frag')).toBe('https://example.com/Case?q=A#frag');
  });
});
