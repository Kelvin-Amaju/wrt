export type QaDeviceMode = 'desktop' | 'android' | 'android-emulation' | 'ios-emulation' | 'real-ios';
export type IosBrowserIdentity = 'safari-ios' | 'chrome-ios';
export type IosOrientation = 'portrait' | 'landscape';
export type DiagnosticStatus = 'pass' | 'warning';

export type AndroidDeviceState = { serial: string; state: string };
export type MobileStatus = {
  sdkPath: string | null;
  adbPath: string | null;
  emulatorPath: string | null;
  adbAvailable: boolean;
  emulatorAvailable: boolean;
  avds: string[];
  devices: AndroidDeviceState[];
  error: string | null;
};

export type IosDeviceProfile = {
  name: string;
  family: 'iPhone' | 'iPad';
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  hasTouch: true;
  orientation: 'portrait';
};

export type IosObservedEnvironment = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  devicePixelRatio: number;
  locale: string;
  timezoneId: string;
  webRtcSupported: boolean;
  literalIpCandidateCount: number;
};

export type IosDiagnosticCheck = {
  key: string;
  label: string;
  status: DiagnosticStatus;
  expected: string;
  observed: string;
  detail: string;
};

export type IosDiagnostics = {
  overall: DiagnosticStatus;
  checks: IosDiagnosticCheck[];
  observed: IosObservedEnvironment;
};


export type AndroidEmulationProfile = {
  name: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: true;
  hasTouch: true;
  userAgent: string;
};

export const ANDROID_EMULATION_PROFILES: AndroidEmulationProfile[] = [
  { name: 'Pixel 11', viewport: { width: 412, height: 923 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 17; Pixel 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' },
  { name: 'Pixel 11 Pro', viewport: { width: 427, height: 952 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 17; Pixel 11 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' },
  { name: 'Pixel 11 Pro XL', viewport: { width: 448, height: 997 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 17; Pixel 11 Pro XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' },
  { name: 'Galaxy S26', viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S942B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' },
  { name: 'Galaxy S26+', viewport: { width: 384, height: 832 }, deviceScaleFactor: 3.75, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S947B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' },
  { name: 'Galaxy S26 Ultra', viewport: { width: 384, height: 832 }, deviceScaleFactor: 3.75, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S948B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' },
  { name: 'Galaxy S26 FE', viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S741B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' },
  { name: 'Galaxy Z Flip8', viewport: { width: 360, height: 840 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-F776B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' },
  { name: 'Galaxy Z Fold8 (Open)', viewport: { width: 816, height: 616 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-F971B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' },
  { name: 'Pixel 7', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' },
  { name: 'Pixel 5', viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' },
  { name: 'Galaxy S23', viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36' },
];

export function findAndroidEmulationProfile(name?: string): AndroidEmulationProfile | undefined {
  if (!name) return undefined;
  return ANDROID_EMULATION_PROFILES.find((profile) => profile.name === name);
}

/**
 * AVD names that are launched with retail device hardening enabled.
 * Matching AVDs get -gpu host, retail ro.* build props, and browser-layer
 * fingerprint hardening for the automation flag, runtime fingerprint and
 * device identity gates. Must stay in sync with electron/device-hardening.cjs.
 */
export const REAL_DEVICE_AVDS: string[] = ['OrbitQA_Pixel_7_Real'];

function normalizeAvdName(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when an AVD name is a hardened retail-device profile. */
export function isHardenedAvd(name: string): boolean {
  const key = normalizeAvdName(name);
  if (!key) return false;
  return REAL_DEVICE_AVDS.some((avd) => {
    const candidate = normalizeAvdName(avd);
    return candidate === key || key.includes('pixel 7') || key.includes('panther');
  });
}

export const IOS_BROWSER_IDENTITIES: IosBrowserIdentity[] = ['safari-ios', 'chrome-ios'];
export const IOS_ORIENTATIONS: IosOrientation[] = ['portrait', 'landscape'];

// Current device profiles use verified 2026 CSS viewport references; runtime fallbacks mirror these values.
export const IOS_DEVICE_PROFILES: IosDeviceProfile[] = [
  { name: 'iPhone 18 Pro', family: 'iPhone', viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, hasTouch: true, orientation: 'portrait' },
  { name: 'iPhone 18 Pro Max', family: 'iPhone', viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, hasTouch: true, orientation: 'portrait' },
  { name: 'iPhone Duo (Closed)', family: 'iPhone', viewport: { width: 466, height: 678 }, deviceScaleFactor: 3, hasTouch: true, orientation: 'portrait' },
  { name: 'iPhone Duo (Open)', family: 'iPhone', viewport: { width: 890, height: 626 }, deviceScaleFactor: 3, hasTouch: true, orientation: 'portrait' },
  { name: 'iPhone 13', family: 'iPhone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, orientation: 'portrait' },
  { name: 'iPhone 13 Pro', family: 'iPhone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, orientation: 'portrait' },
  { name: 'iPhone 13 Pro Max', family: 'iPhone', viewport: { width: 428, height: 926 }, deviceScaleFactor: 3, hasTouch: true, orientation: 'portrait' },
  { name: 'iPhone 13 Mini', family: 'iPhone', viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, hasTouch: true, orientation: 'portrait' },
  { name: 'iPad Pro 11', family: 'iPad', viewport: { width: 834, height: 1210 }, deviceScaleFactor: 2, hasTouch: true, orientation: 'portrait' },
  { name: 'iPad Mini', family: 'iPad', viewport: { width: 744, height: 1133 }, deviceScaleFactor: 2, hasTouch: true, orientation: 'portrait' },
];

export function findIosProfile(name?: string): IosDeviceProfile | undefined {
  if (!name) return undefined;
  return IOS_DEVICE_PROFILES.find((profile) => profile.name === name);
}

export function iosBrowserLabel(identity: IosBrowserIdentity): string {
  return identity === 'chrome-ios' ? 'Chrome iOS Compatibility' : 'Safari iOS';
}

export function orientedViewport(profile: IosDeviceProfile, orientation: IosOrientation): { width: number; height: number } {
  if (orientation === 'portrait') return profile.viewport;
  return { width: profile.viewport.height, height: profile.viewport.width };
}