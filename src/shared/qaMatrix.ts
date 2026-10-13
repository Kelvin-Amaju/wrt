import type { PrivacyRunSettings } from './privacy';
import type { ProxySource } from './proxy';
import type { RealIosCapabilitySelection } from './realIos';
import type { QaStep } from './run';
import { parseUrlPool } from './urlPool';
import { normalizeRunExecutionMode, type RunExecutionMode } from './runCenter';

export type QaExecutionKind = 'desktop' | 'android-emulation' | 'android-avd' | 'ios-emulation' | 'real-ios';
export type QaBrowserRuntime = 'chrome-installed' | 'brave-installed' | 'chromium-playwright' | 'firefox-playwright' | 'webkit-playwright' | 'android-chrome' | 'real-ios-provider';
export type QaMatrixBrowser = 'chrome-installed' | 'brave-installed' | 'chromium' | 'firefox' | 'webkit' | 'chrome-android' | 'safari-ios' | 'chrome-ios';
export type QaOrientation = 'portrait' | 'landscape';

export type BehaviorMode = 'auto' | 'manual';
export type ReadingPace = 'natural' | 'slow' | 'fast';
export type ReferrerMode = 'direct' | 'google-simulated' | 'facebook-simulated' | 'pinterest-simulated' | 'custom-simulated' | 'site-referral';

export interface AutoQaSettings {
  behaviorMode: BehaviorMode;
  readingPace: ReadingPace;
  safeFormActions: boolean;
  observeNewTabs: boolean;
  directAutoType: boolean;
  referrerMode: ReferrerMode;
  customReferrer?: string;
  siteReferralTarget?: string;
}

export function createDefaultAutoQaSettings(): AutoQaSettings {
  return {
    behaviorMode: 'auto',
    readingPace: 'natural',
    safeFormActions: true,
    observeNewTabs: true,
    directAutoType: false,
    referrerMode: 'direct',
  };
}


export interface QaLaunchGroup {
  id: string;
  label?: string;
  executionKind: QaExecutionKind;
  browser: QaMatrixBrowser;
  browserRuntime?: QaBrowserRuntime;
  deviceProfile?: string;
  androidAvdName?: string;
  realIos?: RealIosCapabilitySelection;
  orientation?: QaOrientation;
  locale?: string;
  timezoneId?: string;
  instances: number;
  sessionDurationSeconds: number;
  proxySource: ProxySource;
  allowSlowProxies?: boolean;
}

export interface QaTargetPlan {
  id: string;
  targetUrl: string;
  groups: QaLaunchGroup[];
}

export type QaConcurrencySetting =
  | { mode: 'auto' }
  | { mode: 'manual'; value: number };

export interface QaRunRequestV2 {
  targets: QaTargetPlan[];
  concurrency: QaConcurrencySetting;
  headless: boolean;
  executionMode: RunExecutionMode;
  captureScreenshots: boolean;
  interactionIndicator: boolean;
  autoQa: AutoQaSettings;
  steps: QaStep[];
  privacy: PrivacyRunSettings;
}



export type ProxyMode = 'general' | 'per-device';

export interface QaProxyPolicy {
  source: ProxySource;
  allowSlowProxies: boolean;
  useCookies?: boolean;
}

export interface DesktopMatrixConfig {
  enabled: boolean;
  useCookies: boolean;
  browsers: Array<'chrome-installed' | 'brave-installed' | 'chromium' | 'firefox' | 'webkit'>;
  instancesPerBrowser: number;
  sessionDurationSeconds: number;
  proxy: QaProxyPolicy;
}

export interface AndroidEmulationMatrixConfig {
  enabled: boolean;
  useCookies: boolean;
  browserRuntime?: QaBrowserRuntime;
  profiles: string[];
  instancesPerProfile: number;
  sessionDurationSeconds: number;
  proxy: QaProxyPolicy;
}

export interface IosCompatibilityMatrixConfig {
  enabled: boolean;
  useCookies: boolean;
  browsers: Array<'chrome-installed' | 'brave-installed' | 'safari-ios' | 'chrome-ios'>;
  profiles: string[];
  instancesPerProfile: number;
  sessionDurationSeconds: number;
  orientation: QaOrientation;
  locale: string;
  timezoneId: string;
  proxy: QaProxyPolicy;
}

export interface AndroidAvdMatrixConfig {
  enabled: boolean;
  useCookies: boolean;
  browserRuntime?: 'android-chrome';
  avdNames: string[];
  sessionDurationSeconds: number;
}

export interface RealIosMatrixSelection extends RealIosCapabilitySelection {
  browser: 'safari' | 'chrome';
}

export interface RealIosMatrixConfig {
  enabled: boolean;
  browserRuntime?: 'real-ios-provider';
  selections: RealIosMatrixSelection[];
  sessionDurationSeconds: number;
}

export interface QaDeviceMatrixConfig {
  desktop: DesktopMatrixConfig;
  androidEmulation: AndroidEmulationMatrixConfig;
  iosEmulation: IosCompatibilityMatrixConfig;
  androidAvd: AndroidAvdMatrixConfig;
  realIos: RealIosMatrixConfig;
}

export interface QaRunRequestV3 {
  version: 3;
  urlPoolText: string;
  urlPool: string[];
  invalidUrlCount: number;
  duplicateUrlCount: number;
  runSeed: string;
  devices: QaDeviceMatrixConfig;
  proxyMode: ProxyMode;
  generalProxy: QaProxyPolicy;
  concurrency: QaConcurrencySetting;
  headless: boolean;
  executionMode: RunExecutionMode;
  captureScreenshots: boolean;
  interactionIndicator: boolean;
  browserRuntimeConsistency: boolean;
  autoQa: AutoQaSettings;
  steps: QaStep[];
  privacy: PrivacyRunSettings;
}

export interface QaWorkUnitDescriptor {
  workId: string;
  targetId: string;
  targetIndex: number;
  targetUrl: string;
  groupId: string;
  groupIndex: number;
  instanceIndex: number;
  executionKind: QaExecutionKind;
  browser: QaMatrixBrowser;
  browserRuntime: QaBrowserRuntime;
  deviceProfile?: string;
  androidAvdName?: string;
  realIos?: RealIosCapabilitySelection;
  orientation?: QaOrientation;
  locale?: string;
  timezoneId?: string;
  sessionDurationSeconds: number;
  proxySource: ProxySource;
  allowSlowProxies: boolean;
  useCookies?: boolean;
}

export type QaMatrixValidationResult = { ok: true } | { ok: false; error: string };

const DESKTOP_BROWSERS = new Set<QaMatrixBrowser>(['chrome-installed', 'brave-installed', 'chromium', 'firefox', 'webkit']);
const PROXY_SOURCES = new Set<ProxySource>(['none', 'manual', 'rotating', 'static', 'smart-mix']);
const IOS_PROFILES = new Set(['iPhone 18 Pro', 'iPhone 18 Pro Max', 'iPhone Duo (Closed)', 'iPhone Duo (Open)', 'iPad Pro 11', 'iPad Mini', 'iPhone 13', 'iPhone 13 Pro', 'iPhone 13 Pro Max', 'iPhone 13 Mini']);
const ANDROID_EMULATION_PROFILES = new Set(['Pixel 11', 'Pixel 11 Pro', 'Pixel 11 Pro XL', 'Galaxy S26', 'Galaxy S26+', 'Galaxy S26 Ultra', 'Galaxy S26 FE', 'Galaxy Z Flip8', 'Galaxy Z Fold8 (Open)', 'Pixel 7', 'Pixel 5', 'Galaxy S23']);

let idCounter = 0;
function makeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export function normalizeMatrixTargetUrl(input: string): string {
  const trimmed = String(input || '').trim();
  if (!trimmed) throw new Error('Enter a valid target URL');
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('Enter a valid target URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Target URL must start with http:// or https://');
  }
  return candidate;
}

export function createDefaultLaunchGroup(executionKind: QaExecutionKind = 'desktop'): QaLaunchGroup {
  const common = {
    id: makeId('group'),
    instances: 1,
    sessionDurationSeconds: 60,
    proxySource: 'none' as ProxySource,
    allowSlowProxies: false,
  };
  switch (executionKind) {
    case 'android-emulation':
      return { ...common, executionKind, browser: 'chrome-android', browserRuntime: 'chrome-installed', deviceProfile: 'Pixel 11' };
    case 'android-avd':
      return { ...common, executionKind, browser: 'chrome-android', browserRuntime: 'android-chrome', androidAvdName: '' };
    case 'ios-emulation':
      return { ...common, executionKind, browser: 'chrome-installed', browserRuntime: 'chrome-installed', deviceProfile: 'iPhone 18 Pro', orientation: 'portrait', locale: 'en-US', timezoneId: 'UTC' };
    case 'real-ios':
      return { ...common, executionKind, browser: 'safari-ios', browserRuntime: 'real-ios-provider', realIos: { device: '', iosVersion: '', browser: 'safari' } };
    default:
      return { ...common, executionKind: 'desktop', browser: 'chrome-installed', browserRuntime: 'chrome-installed' };
  }
}

export function createDefaultTargetPlan(targetUrl = ''): QaTargetPlan {
  return { id: makeId('target'), targetUrl, groups: [createDefaultLaunchGroup('desktop')] };
}



export function createDefaultProxyPolicy(): QaProxyPolicy {
  return { source: 'none', allowSlowProxies: false };
}

export function createDefaultDeviceMatrix(): QaDeviceMatrixConfig {
  return {
    desktop: {
      enabled: true,
      useCookies: false,
      browsers: ['chrome-installed'],
      instancesPerBrowser: 1,
      sessionDurationSeconds: 60,
      proxy: createDefaultProxyPolicy(),
    },
    androidEmulation: {
      enabled: false,
      useCookies: false,
      browserRuntime: 'chrome-installed',
      profiles: ['Pixel 11'],
      instancesPerProfile: 1,
      sessionDurationSeconds: 60,
      proxy: createDefaultProxyPolicy(),
    },
    iosEmulation: {
      enabled: false,
      useCookies: false,
      browsers: ['chrome-installed'],
      profiles: ['iPhone 18 Pro'],
      instancesPerProfile: 1,
      sessionDurationSeconds: 60,
      orientation: 'portrait',
      locale: 'en-US',
      timezoneId: 'UTC',
      proxy: createDefaultProxyPolicy(),
    },
    androidAvd: {
      enabled: false,
      useCookies: false,
      browserRuntime: 'android-chrome',
      avdNames: [],
      sessionDurationSeconds: 60,
    },
    realIos: {
      enabled: false,
      browserRuntime: 'real-ios-provider',
      selections: [],
      sessionDurationSeconds: 60,
    },
  };
}

export function createDefaultQaRunV3(): Omit<QaRunRequestV3, 'urlPool' | 'invalidUrlCount' | 'duplicateUrlCount'> {
  return {
    version: 3,
    urlPoolText: '',
    runSeed: '',
    devices: createDefaultDeviceMatrix(),
    proxyMode: 'general',
    generalProxy: createDefaultProxyPolicy(),
    concurrency: { mode: 'manual', value: 1 },
    headless: false,
    executionMode: 'visible',
    captureScreenshots: true,
    interactionIndicator: true,
    browserRuntimeConsistency: false,
    autoQa: createDefaultAutoQaSettings(),
    steps: [],
    privacy: undefined as unknown as PrivacyRunSettings,
  };
}

function normalizePositiveInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${label} must be a positive integer`);
  return number;
}

function normalizeDuration(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 5 || number > 600) throw new Error(`${label} must be between 5 and 600 seconds`);
  return number;
}

function normalizeProxyPolicy(value: Partial<QaProxyPolicy> | undefined, label: string): QaProxyPolicy {
  const source = String(value?.source || 'none') as ProxySource;
  if (!PROXY_SOURCES.has(source)) throw new Error(`${label}: choose a supported proxy source`);
  return { source, allowSlowProxies: ['rotating', 'static', 'smart-mix'].includes(source) };
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function normalizeBrowserRuntime(value: unknown, fallback: QaBrowserRuntime, allowed: QaBrowserRuntime[]): QaBrowserRuntime {
  const runtime = String(value || '') as QaBrowserRuntime;
  return allowed.includes(runtime) ? runtime : fallback;
}

export function browserRuntimeForMatrixBrowser(browser: QaMatrixBrowser, executionKind: QaExecutionKind): QaBrowserRuntime {
  if (executionKind === 'android-avd') return 'android-chrome';
  if (executionKind === 'real-ios') return 'real-ios-provider';
  if (browser === 'chrome-installed') return 'chrome-installed';
  if (browser === 'brave-installed') return 'brave-installed';
  if (browser === 'firefox') return 'firefox-playwright';
  if (browser === 'webkit' || browser === 'safari-ios' || browser === 'chrome-ios') return 'webkit-playwright';
  return 'chromium-playwright';
}

function normalizeDeviceMatrix(raw: Partial<QaDeviceMatrixConfig> | undefined): QaDeviceMatrixConfig {
  const defaults = createDefaultDeviceMatrix();
  const desktopRaw = raw?.desktop || defaults.desktop;
  const desktopBrowsers = uniqueStrings(desktopRaw.browsers).filter((browser): browser is 'chrome-installed' | 'brave-installed' | 'chromium' | 'firefox' | 'webkit' => ['chrome-installed', 'brave-installed', 'chromium', 'firefox', 'webkit'].includes(browser));
  const androidRaw = raw?.androidEmulation || defaults.androidEmulation;
  const androidRuntime = raw?.androidEmulation
    ? normalizeBrowserRuntime(androidRaw.browserRuntime, 'chromium-playwright', ['chrome-installed', 'brave-installed', 'chromium-playwright'])
    : 'chrome-installed';
  const androidProfiles = uniqueStrings(androidRaw.profiles).filter((profile) => ANDROID_EMULATION_PROFILES.has(profile));
  const iosRaw = raw?.iosEmulation || defaults.iosEmulation;
  const iosBrowsers = uniqueStrings(iosRaw.browsers).filter((browser): browser is 'chrome-installed' | 'brave-installed' | 'safari-ios' | 'chrome-ios' => ['chrome-installed', 'brave-installed', 'safari-ios', 'chrome-ios'].includes(browser));
  const iosProfiles = uniqueStrings(iosRaw.profiles).filter((profile) => IOS_PROFILES.has(profile));
  const avdRaw = raw?.androidAvd || defaults.androidAvd;
  const realRaw = raw?.realIos || defaults.realIos;

  const devices: QaDeviceMatrixConfig = {
    desktop: {
      enabled: desktopRaw.enabled === true,
      useCookies: desktopRaw.useCookies === true,
      browsers: desktopBrowsers,
      instancesPerBrowser: normalizePositiveInteger(desktopRaw.instancesPerBrowser ?? 1, 'Desktop instances'),
      sessionDurationSeconds: normalizeDuration(desktopRaw.sessionDurationSeconds ?? 60, 'Desktop session duration'),
      proxy: normalizeProxyPolicy(desktopRaw.proxy, 'Desktop proxy'),
    },
    androidEmulation: {
      enabled: androidRaw.enabled === true,
      useCookies: androidRaw.useCookies === true,
      browserRuntime: androidRuntime,
      profiles: androidProfiles,
      instancesPerProfile: normalizePositiveInteger(androidRaw.instancesPerProfile ?? 1, 'Android mobile instances'),
      sessionDurationSeconds: normalizeDuration(androidRaw.sessionDurationSeconds ?? 60, 'Android mobile session duration'),
      proxy: normalizeProxyPolicy(androidRaw.proxy, 'Android mobile proxy'),
    },
    iosEmulation: {
      enabled: iosRaw.enabled === true,
      useCookies: iosRaw.useCookies === true,
      browsers: iosBrowsers,
      profiles: iosProfiles,
      instancesPerProfile: normalizePositiveInteger(iosRaw.instancesPerProfile ?? 1, 'Local iOS instances'),
      sessionDurationSeconds: normalizeDuration(iosRaw.sessionDurationSeconds ?? 60, 'Local iOS session duration'),
      orientation: iosRaw.orientation === 'landscape' ? 'landscape' : 'portrait',
      locale: String(iosRaw.locale || 'en-US').trim() || 'en-US',
      timezoneId: String(iosRaw.timezoneId || 'UTC').trim() || 'UTC',
      proxy: normalizeProxyPolicy(iosRaw.proxy, 'Local iOS proxy'),
    },
    androidAvd: {
      enabled: avdRaw.enabled === true,
      useCookies: avdRaw.useCookies === true,
      browserRuntime: 'android-chrome',
      avdNames: uniqueStrings(avdRaw.avdNames),
      sessionDurationSeconds: normalizeDuration(avdRaw.sessionDurationSeconds ?? 60, 'Android AVD session duration'),
    },
    realIos: {
      enabled: realRaw.enabled === true,
      browserRuntime: 'real-ios-provider',
      selections: Array.isArray(realRaw.selections)
        ? realRaw.selections.map((selection) => ({
            device: String(selection?.device || '').trim(),
            iosVersion: String(selection?.iosVersion || '').trim(),
            browser: (selection?.browser === 'chrome' ? 'chrome' : 'safari') as 'chrome' | 'safari',
          })).filter((selection) => selection.device && selection.iosVersion)
        : [],
      sessionDurationSeconds: normalizeDuration(realRaw.sessionDurationSeconds ?? 60, 'Real iOS session duration'),
    },
  };

  if (devices.desktop.enabled && devices.desktop.browsers.length === 0) throw new Error('Desktop: select at least one browser');
  if (devices.androidEmulation.enabled && devices.androidEmulation.profiles.length === 0) throw new Error('Android mobile emulation: select at least one mobile profile');
  if (devices.iosEmulation.enabled && (devices.iosEmulation.browsers.length === 0 || devices.iosEmulation.profiles.length === 0)) throw new Error('Local iPhone/iPad Compatibility: select at least one browser and profile');
  if (devices.androidAvd.enabled && devices.androidAvd.avdNames.length === 0) throw new Error('Android AVD: select at least one AVD');
  if (devices.realIos.enabled && devices.realIos.selections.length === 0) throw new Error('Real iOS Provider: select at least one provider device');
  if (![devices.desktop.enabled, devices.androidEmulation.enabled, devices.iosEmulation.enabled, devices.androidAvd.enabled, devices.realIos.enabled].some(Boolean)) {
    throw new Error('Select at least one device family');
  }
  return devices;
}

export function countMatrixWorkUnitsV3(devices: QaDeviceMatrixConfig): number {
  let total = 0;
  if (devices.desktop.enabled) total += devices.desktop.browsers.length * devices.desktop.instancesPerBrowser;
  if (devices.androidEmulation.enabled) total += devices.androidEmulation.profiles.length * devices.androidEmulation.instancesPerProfile;
  if (devices.iosEmulation.enabled) total += devices.iosEmulation.browsers.length * devices.iosEmulation.profiles.length * devices.iosEmulation.instancesPerProfile;
  if (devices.androidAvd.enabled) total += devices.androidAvd.avdNames.length;
  if (devices.realIos.enabled) total += devices.realIos.selections.length;
  return total;
}

function normalizedId(value: unknown, fallback: string): string {
  const id = String(value || '').trim();
  return id || fallback;
}

function normalizeGroup(raw: Partial<QaLaunchGroup>, targetIndex: number, groupIndex: number): QaLaunchGroup {
  const executionKind = String(raw.executionKind || 'desktop') as QaExecutionKind;
  if (!['desktop', 'android-emulation', 'android-avd', 'ios-emulation', 'real-ios'].includes(executionKind)) {
    throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: choose a supported device type`);
  }
  const browser = String(raw.browser || '') as QaMatrixBrowser;
  const instances = Number(raw.instances);
  const sessionDurationSeconds = Number(raw.sessionDurationSeconds);
  const proxySource = String(raw.proxySource || 'none') as ProxySource;
  if (!Number.isInteger(instances) || instances < 1) {
    throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: instances must be a positive integer`);
  }
  if (!Number.isFinite(sessionDurationSeconds) || sessionDurationSeconds < 5 || sessionDurationSeconds > 600) {
    throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: session duration must be between 5 and 600 seconds`);
  }
  if (!PROXY_SOURCES.has(proxySource)) {
    throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: choose a supported proxy source`);
  }

  if (executionKind === 'desktop' && !DESKTOP_BROWSERS.has(browser)) {
    throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: choose Google Chrome, Brave, Chromium, Firefox, or WebKit for Desktop`);
  }
  if (executionKind === 'android-emulation') {
    if (browser !== 'chrome-android') throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: Android mobile emulation uses Chrome Android`);
    if (!ANDROID_EMULATION_PROFILES.has(String(raw.deviceProfile || ''))) throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: choose a supported Android mobile profile`);
  }
  if (executionKind === 'android-avd') {
    if (browser !== 'chrome-android') throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: Android AVD uses Chrome Android`);
    if (!String(raw.androidAvdName || '').trim()) throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: choose an Android AVD`);
    if (proxySource !== 'none') throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: proxy routing is not available for Android AVD`);
  }
  if (executionKind === 'ios-emulation') {
    if (!['chrome-installed', 'brave-installed', 'safari-ios', 'chrome-ios'].includes(browser)) throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: choose Google Chrome emulation, Brave emulation, Safari iOS, or Chrome iOS compatibility`);
    if (!IOS_PROFILES.has(String(raw.deviceProfile || ''))) throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: choose an iPhone/iPad profile`);
  }
  if (executionKind === 'real-ios') {
    if (proxySource !== 'none') throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: proxy routing is not available for Real iOS`);
    if (!['safari-ios', 'chrome-ios'].includes(browser)) throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: choose Safari iOS or Chrome iOS for Real iOS`);
    if (!raw.realIos?.device?.trim()) throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: choose a real iOS device model`);
    if (!raw.realIos?.iosVersion?.trim()) throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: choose a real iOS version`);
    if (!['safari', 'chrome'].includes(raw.realIos?.browser || '')) throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: choose Safari or Chrome iOS`);
    const expectedProviderBrowser = browser === 'chrome-ios' ? 'chrome' : 'safari';
    if (raw.realIos?.browser !== expectedProviderBrowser) throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: browser selection does not match the Real iOS provider browser`);
  }

  const browserRuntime = executionKind === 'android-emulation'
    ? normalizeBrowserRuntime(raw.browserRuntime, 'chromium-playwright', ['chrome-installed', 'brave-installed', 'chromium-playwright'])
    : browserRuntimeForMatrixBrowser(browser, executionKind);

  return {
    id: normalizedId(raw.id, `group-${groupIndex + 1}`),
    label: raw.label ? String(raw.label) : undefined,
    executionKind,
    browser,
    browserRuntime,
    deviceProfile: raw.deviceProfile ? String(raw.deviceProfile) : undefined,
    androidAvdName: raw.androidAvdName ? String(raw.androidAvdName) : undefined,
    realIos: raw.realIos,
    orientation: raw.orientation === 'landscape' ? 'landscape' : raw.orientation === 'portrait' ? 'portrait' : undefined,
    locale: raw.locale ? String(raw.locale).trim() : undefined,
    timezoneId: raw.timezoneId ? String(raw.timezoneId).trim() : undefined,
    instances,
    sessionDurationSeconds,
    proxySource,
    allowSlowProxies: raw.allowSlowProxies === true,
  };
}

function normalizeAutoQaSettings(value: Partial<AutoQaSettings> | undefined, steps: QaStep[]): AutoQaSettings {
  const explicitMode: BehaviorMode | null = value?.behaviorMode === 'manual' ? 'manual' : value?.behaviorMode === 'auto' ? 'auto' : null;
  const behaviorMode: BehaviorMode = explicitMode ?? (steps.length > 0 ? 'manual' : 'auto');
  const readingPace: ReadingPace = value?.readingPace === 'slow' || value?.readingPace === 'fast' ? value.readingPace : 'natural';
  const allowedReferrers: ReferrerMode[] = ['direct', 'google-simulated', 'facebook-simulated', 'pinterest-simulated', 'custom-simulated', 'site-referral'];
  const referrerMode: ReferrerMode = allowedReferrers.includes(value?.referrerMode as ReferrerMode) ? value!.referrerMode as ReferrerMode : 'direct';
  let customReferrer: string | undefined;
  if (referrerMode === 'custom-simulated') {
    const candidate = String(value?.customReferrer || '').trim();
    let parsed: URL;
    try { parsed = new URL(candidate); } catch { throw new Error('Custom simulated referrer must be a valid https:// URL'); }
    if (parsed.protocol !== 'https:') throw new Error('Custom simulated referrer must use https://');
    customReferrer = parsed.toString();
  }
  const siteReferralTarget = referrerMode === 'site-referral' ? String(value?.siteReferralTarget || '').trim().slice(0, 2048) || undefined : undefined;
  return {
    behaviorMode,
    readingPace,
    safeFormActions: value?.safeFormActions !== false,
    observeNewTabs: value?.observeNewTabs !== false,
    directAutoType: referrerMode === 'direct' ? value?.directAutoType === true : false,
    referrerMode,
    customReferrer,
    ...(siteReferralTarget ? { siteReferralTarget } : {}),
  };
}

function normalizeConcurrency(value: QaConcurrencySetting | number | undefined): QaConcurrencySetting {
  if (value && typeof value === 'object') {
    if (value.mode === 'auto') return { mode: 'auto' };
    if (value.mode === 'manual') {
      const number = Number(value.value);
      if (!Number.isInteger(number) || number < 1) throw new Error('Manual concurrency must be a positive integer');
      return { mode: 'manual', value: number };
    }
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error('Manual concurrency must be a positive integer');
  return { mode: 'manual', value: number };
}

export function normalizeQaRunRequestV2(input: Omit<Partial<QaRunRequestV2>, 'targets' | 'concurrency'> & { targets?: Array<Partial<QaTargetPlan>>; concurrency?: QaConcurrencySetting | number }): QaRunRequestV2 {
  if (!input || !Array.isArray(input.targets) || input.targets.length === 0) throw new Error('Add at least one target website');
  if (input.targets.length > 20) throw new Error('A run can contain up to 20 target plans');
  const targetIds = new Set<string>();
  const groupIds = new Set<string>();
  const targets = input.targets.map((rawTarget, targetIndex) => {
    let targetUrl: string;
    try { targetUrl = normalizeMatrixTargetUrl(String(rawTarget.targetUrl || '')); }
    catch (error) {
      if (error instanceof Error && error.message === 'Target URL must start with http:// or https://') throw error;
      throw new Error(`Target ${targetIndex + 1}: invalid target URL`);
    }
    const targetId = normalizedId(rawTarget.id, `target-${targetIndex + 1}`);
    if (targetIds.has(targetId)) throw new Error(`Target ${targetIndex + 1}: duplicate target id`);
    targetIds.add(targetId);
    const rawGroups = Array.isArray(rawTarget.groups) ? rawTarget.groups : [];
    if (rawGroups.length === 0) throw new Error(`Target ${targetIndex + 1}: add at least one device group`);
    if (rawGroups.length > 12) throw new Error(`Target ${targetIndex + 1}: up to 12 device groups are supported`);
    const groups = rawGroups.map((group, groupIndex) => {
      const normalized = normalizeGroup(group, targetIndex, groupIndex);
      const globalGroupKey = `${targetId}:${normalized.id}`;
      if (groupIds.has(globalGroupKey)) throw new Error(`Target ${targetIndex + 1}, group ${groupIndex + 1}: duplicate group id`);
      groupIds.add(globalGroupKey);
      return normalized;
    });
    return { id: targetId, targetUrl, groups };
  });
  const concurrency = normalizeConcurrency(input.concurrency);
  const steps = Array.isArray(input.steps) ? input.steps : [];
  if (steps.length > 50) throw new Error('A run can contain up to 50 steps');
  const autoQa = normalizeAutoQaSettings(input.autoQa, steps);
  const headless = input.headless === true;
  return {
    targets,
    concurrency,
    headless,
    executionMode: normalizeRunExecutionMode(input.executionMode),
    captureScreenshots: input.captureScreenshots !== false,
    interactionIndicator: headless ? false : input.interactionIndicator !== false,
    autoQa,
    steps,
    privacy: input.privacy as PrivacyRunSettings,
  };
}



export function normalizeQaRunRequestV3(input: Partial<QaRunRequestV3> & { urlPoolText?: string; urlPool?: string[] }): QaRunRequestV3 {
  if (!input || typeof input !== 'object') throw new Error('Invalid QA run request');
  const rawText = typeof input.urlPoolText === 'string' ? input.urlPoolText : Array.isArray(input.urlPool) ? input.urlPool.join('\n') : '';
  const parsed = parseUrlPool(rawText);
  if (parsed.valid.length === 0) throw new Error('Add at least one valid Target URL');
  const browserRuntimeConsistency = input.browserRuntimeConsistency === true;
  const devices = normalizeDeviceMatrix(input.devices);
  if (browserRuntimeConsistency && input.devices?.androidEmulation && !input.devices.androidEmulation.browserRuntime) devices.androidEmulation.browserRuntime = 'chrome-installed';
  const proxyMode: ProxyMode = input.proxyMode === 'per-device' ? 'per-device' : 'general';
  const generalProxy = normalizeProxyPolicy(input.generalProxy, 'General proxy');
  const concurrency = normalizeConcurrency(input.concurrency);
  const steps = Array.isArray(input.steps) ? input.steps : [];
  if (steps.length > 50) throw new Error('A run can contain up to 50 steps');
  const autoQa = normalizeAutoQaSettings(input.autoQa, steps);
  const executionMode = normalizeRunExecutionMode(input.executionMode);
  const headless = executionMode === 'background' ? false : input.headless === true;
  return {
    version: 3,
    urlPoolText: rawText,
    urlPool: parsed.valid,
    invalidUrlCount: parsed.invalid.length,
    duplicateUrlCount: parsed.duplicates,
    runSeed: String(input.runSeed || '').trim(),
    devices,
    proxyMode,
    generalProxy,
    concurrency,
    headless,
    executionMode,
    captureScreenshots: input.captureScreenshots !== false,
    interactionIndicator: headless ? false : input.interactionIndicator !== false,
    browserRuntimeConsistency,
    autoQa,
    steps,
    privacy: input.privacy as PrivacyRunSettings,
  };
}

export function validateQaRunRequestV2(input: Omit<Partial<QaRunRequestV2>, 'concurrency'> & { concurrency?: QaConcurrencySetting | number }): QaMatrixValidationResult {
  try {
    normalizeQaRunRequestV2(input);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid QA matrix request' };
  }
}

export function countMatrixWorkUnits(targets: QaTargetPlan[]): number {
  return targets.reduce((total, target) => total + target.groups.reduce((sum, group) => sum + group.instances, 0), 0);
}
