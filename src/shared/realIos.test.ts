import { describe, expect, it } from 'vitest';
import { normalizeProviderUrl, validateProviderSaveRequest, redactSensitiveText } from './realIos';

describe('real iOS provider domain', () => {
  it('accepts HTTPS and localhost development endpoints only', () => {
    expect(normalizeProviderUrl('https://hub.example.test/wd/hub')).toBe('https://hub.example.test/wd/hub');
    expect(normalizeProviderUrl('http://127.0.0.1:4444/wd/hub')).toBe('http://127.0.0.1:4444/wd/hub');
    expect(normalizeProviderUrl('http://localhost:4723/wd/hub')).toBe('http://localhost:4723/wd/hub');
    expect(() => normalizeProviderUrl('http://example.test/wd/hub')).toThrow(/HTTPS/);
  });

  it('requires a provider name, endpoint, device, iOS version and browser', () => {
    expect(validateProviderSaveRequest({
      providerName: '', remoteUrl: 'https://hub.example.test', username: '', accessKey: '',
      defaultDevice: 'iPhone 15', defaultIosVersion: '17', defaultBrowser: 'safari',
    })).toEqual({ ok: false, error: 'Enter a provider name' });

    expect(validateProviderSaveRequest({
      providerName: 'Cloud', remoteUrl: 'http://example.test', username: '', accessKey: '',
      defaultDevice: 'iPhone 15', defaultIosVersion: '17', defaultBrowser: 'safari',
    })).toEqual({ ok: false, error: 'Enter a valid HTTPS provider endpoint' });

    expect(validateProviderSaveRequest({
      providerName: 'Cloud', remoteUrl: 'https://hub.example.test', username: '', accessKey: '',
      defaultDevice: '', defaultIosVersion: '17', defaultBrowser: 'safari',
    })).toEqual({ ok: false, error: 'Enter a default iOS device model' });
  });

  it('redacts secrets from logs and URLs', () => {
    const redacted = redactSensitiveText('https://x.test?a=1&token=abc accessKey=xyz password=pw secret:qwe key=foo');
    expect(redacted).not.toMatch(/abc|xyz|pw|qwe|foo/);
    expect(redacted).toMatch(/REDACTED/);
  });
});
