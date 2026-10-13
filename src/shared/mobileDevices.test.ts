import { describe, expect, it } from 'vitest';
import {
  IOS_BROWSER_IDENTITIES,
  IOS_DEVICE_PROFILES,
  IOS_ORIENTATIONS,
  findIosProfile,
  iosBrowserLabel,
} from './mobileDevices';

describe('mobile device catalog', () => {
  it('contains phone and tablet QA profiles', () => {
    expect(IOS_DEVICE_PROFILES.some((profile) => profile.family === 'iPhone')).toBe(true);
    expect(IOS_DEVICE_PROFILES.some((profile) => profile.family === 'iPad')).toBe(true);
  });

  it('exposes Safari and Chrome iOS compatibility identities', () => {
    expect(IOS_BROWSER_IDENTITIES).toEqual(['safari-ios', 'chrome-ios']);
    expect(iosBrowserLabel('safari-ios')).toMatch(/Safari iOS/i);
    expect(iosBrowserLabel('chrome-ios')).toMatch(/Chrome iOS Compatibility/i);
  });

  it('supports portrait and landscape orientation', () => {
    expect(IOS_ORIENTATIONS).toEqual(['portrait', 'landscape']);
  });

  it('resolves only known profiles', () => {
    expect(findIosProfile('iPhone 18 Pro')?.family).toBe('iPhone');
    expect(findIosProfile('Unknown Phone')).toBeUndefined();
  });
});
