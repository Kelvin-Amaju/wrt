import { describe, expect, it } from 'vitest';
import { formatMaskedProxyEndpoint, isPoolProxySource } from './proxy';

describe('proxy shared helpers', () => {
  it('masks endpoint display without exposing credentials', () => {
    expect(formatMaskedProxyEndpoint({
      protocol: 'socks5', hostname: 'proxy.example', port: 1080, username: 'alice', hasPassword: true,
    })).toBe('socks5://alice:***@proxy.example:1080');
  });

  it('recognizes pool sources only', () => {
    expect(isPoolProxySource('rotating')).toBe(true);
    expect(isPoolProxySource('static')).toBe(true);
    expect(isPoolProxySource('smart-mix')).toBe(true);
    expect(isPoolProxySource('manual')).toBe(false);
    expect(isPoolProxySource('none')).toBe(false);
  });
});
