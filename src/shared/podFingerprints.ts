import type { PodCountry, PodDeviceType, PodProfileFingerprint } from './pods';
import { ANDROID_EMULATION_PROFILES, IOS_DEVICE_PROFILES } from './mobileDevices';

const regions: Record<PodCountry, [string, string]> = { US: ['en-US', 'America/New_York'], GB: ['en-GB', 'Europe/London'], CA: ['en-CA', 'America/Toronto'], AU: ['en-AU', 'Australia/Sydney'], NG: ['en-NG', 'Africa/Lagos'], IN: ['en-IN', 'Asia/Kolkata'] };

export function podFingerprint(device: PodDeviceType, country: PodCountry, index: number): PodProfileFingerprint {
  const [locale, timezoneId] = regions[country];
  const browserFamily = device === 'ios' ? 'webkit' : 'chromium';
  const android = device === 'android' ? ANDROID_EMULATION_PROFILES[index % ANDROID_EMULATION_PROFILES.length] : undefined;
  const ios = device === 'ios' ? IOS_DEVICE_PROFILES[index % IOS_DEVICE_PROFILES.length] : undefined;
  const width = ios?.viewport.width ?? android?.viewport.width ?? 1365;
  const height = ios?.viewport.height ?? android?.viewport.height ?? 768;
  const userAgent = device === 'ios'
    ? `Mozilla/5.0 (${ios?.family || 'iPhone'}; CPU ${ios?.family || 'iPhone'} OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1`
    : device === 'android'
      ? android!.userAgent
      : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  return { userAgent, platform: device === 'ios' ? 'iPhone' : device === 'android' ? 'Linux armv8l' : 'Win32', viewport: { width, height }, screen: { width, height, colorDepth: 24 }, deviceScaleFactor: ios?.deviceScaleFactor ?? android?.deviceScaleFactor ?? 1, maxTouchPoints: device === 'desktop' ? 0 : 5, hardwareConcurrency: device === 'desktop' ? 12 : 8, deviceMemory: device === 'desktop' ? 16 : 8, locale, languages: [locale, locale.split('-')[0]], timezoneId, browserFamily };
}
