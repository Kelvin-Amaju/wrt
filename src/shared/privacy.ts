import type { QaDeviceMode } from './mobileDevices';

export const DEFAULT_ROUTE_CHECK_URL = 'https://api64.ipify.org?format=json';

export type PrivacyCheckStatus = 'pass' | 'warning' | 'fail' | 'not-applicable';
export type WebRtcPrivacyPolicy = 'prevented' | 'verified-no-leak' | 'unsupported' | 'exposed' | 'indeterminate';

export type PrivacyCheckKey =
  | 'browser-launch'
  | 'page-load'
  | 'proxy-route'
  | 'direct-fallback'
  | 'interaction-route'
  | 'webrtc'
  | 'camera'
  | 'microphone'
  | 'geolocation'
  | 'notifications'
  | 'user-agent'
  | 'platform'
  | 'touch'
  | 'viewport'
  | 'dpr'
  | 'locale'
  | 'timezone';

export interface PrivacyCheck {
  key: PrivacyCheckKey;
  label: string;
  status: PrivacyCheckStatus;
  required: boolean;
  expected?: string;
  observed?: string;
  detail?: string;
}

export interface PrivacyObservedEnvironment {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  viewport: { width: number; height: number };
  devicePixelRatio: number;
  locale: string;
  timezoneId: string;
  webRtcSupported: boolean;
  webRtcBlocked?: boolean;
  webRtcVerificationError?: string;
  webRtcPolicy?: WebRtcPrivacyPolicy;
  literalIpCandidates: string[];
  permissionStates: {
    camera: string;
    microphone: string;
    geolocation: string;
    notifications: string;
  };
  directIp?: string;
  proxiedIp?: string;
  finalProxiedIp?: string;
}

export interface PrivacyDiagnosticReport {
  overall: 'pass' | 'warning' | 'fail';
  blocked: boolean;
  blockingReasons: string[];
  checks: PrivacyCheck[];
  webRtcPolicy: WebRtcPrivacyPolicy;
  observed: PrivacyObservedEnvironment;
  startedAt: string;
  durationMs: number;
}

export interface ProxyRunSettings {
  enabled: boolean;
  server: string;
  username: string;
  password: string;
  requireVerifiedRoute: boolean;
  routeCheckUrl: string;
  // Human-verification handling for this route.
  recaptchaAudio: boolean;
  sttApiKey: string;
}

export interface PrivacyRunSettings {
  strictMode: boolean;
  proxy: ProxyRunSettings;
}

export function createDefaultPrivacySettings(): PrivacyRunSettings {
  return {
    strictMode: true,
    proxy: {
      enabled: false,
      server: '',
      username: '',
      password: '',
      requireVerifiedRoute: false,
      routeCheckUrl: DEFAULT_ROUTE_CHECK_URL,
      recaptchaAudio: false,
      sttApiKey: '',
    },
  };
}

export function validatePrivacySettings(
  settings: PrivacyRunSettings,
  deviceMode: QaDeviceMode,
): { ok: true } | { ok: false; error: string } {
  let routeUrl: URL;
  try {
    routeUrl = new URL(settings.proxy.routeCheckUrl);
  } catch {
    return { ok: false, error: 'Enter a valid proxy route-check URL' };
  }
  if (routeUrl.protocol !== 'https:') {
    return { ok: false, error: 'Proxy route-check URL must use https://' };
  }

  // Audio challenge solving needs a transcription key, and it applies whether or
  // not a proxy is configured, so it is checked before the proxy early return.
  const recaptchaAudio = Boolean(settings.proxy.recaptchaAudio);
  const sttApiKey = String(settings.proxy.sttApiKey || '').trim();
  if (recaptchaAudio && !sttApiKey) {
    return { ok: false, error: 'Audio challenge solving needs a speech-to-text API key' };
  }

  if (!settings.proxy.enabled) return { ok: true };
  if (deviceMode === 'android') {
    return { ok: false, error: 'Custom proxy privacy gating is not available for Android AVD runs in v0.5' };
  }
  let proxyUrl: URL;
  try {
    proxyUrl = new URL(settings.proxy.server);
  } catch {
    return { ok: false, error: 'Proxy server must use http://, https://, or socks5://' };
  }
  if (!['http:', 'https:', 'socks5:'].includes(proxyUrl.protocol)) {
    return { ok: false, error: 'Proxy server must use http://, https://, or socks5://' };
  }
  return { ok: true };
}