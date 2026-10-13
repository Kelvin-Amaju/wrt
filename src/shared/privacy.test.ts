import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROUTE_CHECK_URL,
  createDefaultPrivacySettings,
  validatePrivacySettings,
} from './privacy';

describe('privacy settings', () => {
  it('defaults strict privacy on with no proxy', () => {
    expect(createDefaultPrivacySettings()).toEqual({
      strictMode: true,
      proxy: {
        enabled: false,
        server: '',
        username: '',
        password: '',
        requireVerifiedRoute: false,
        routeCheckUrl: DEFAULT_ROUTE_CHECK_URL,
      },
    });
  });

  it('requires a supported proxy URL when proxy mode is enabled', () => {
    const settings = createDefaultPrivacySettings();
    settings.proxy.enabled = true;
    settings.proxy.server = 'not-a-proxy-url';
    expect(validatePrivacySettings(settings, 'desktop')).toEqual({
      ok: false,
      error: 'Proxy server must use http://, https://, or socks5://',
    });
  });

  it('requires HTTPS for the route-check endpoint', () => {
    const settings = createDefaultPrivacySettings();
    settings.proxy.routeCheckUrl = 'http://example.com/ip';
    expect(validatePrivacySettings(settings, 'desktop')).toEqual({
      ok: false,
      error: 'Proxy route-check URL must use https://',
    });
  });

  it('rejects custom proxy mode for Android v0.5 instead of silently ignoring it', () => {
    const settings = createDefaultPrivacySettings();
    settings.proxy.enabled = true;
    settings.proxy.server = 'http://127.0.0.1:8080';
    expect(validatePrivacySettings(settings, 'android')).toEqual({
      ok: false,
      error: 'Custom proxy privacy gating is not available for Android AVD runs in v0.5',
    });
  });
});
