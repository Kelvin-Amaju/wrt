export type RealIosBrowser = 'safari' | 'chrome';

export type RealIosProviderSaveRequest = {
  providerName: string;
  remoteUrl: string;
  username: string;
  accessKey: string;
  defaultDevice: string;
  defaultIosVersion: string;
  defaultBrowser: RealIosBrowser;
};

export type RealIosProviderPublicConfig = Omit<RealIosProviderSaveRequest, 'accessKey'> & {
  credentialsSaved: boolean;
};

export type RealIosProviderStatus = {
  configured: boolean;
  reachable: boolean;
  authenticated: boolean;
  safariSupported: boolean;
  chromeSupported: boolean;
  message: string;
};

export type RealIosCapabilitySelection = {
  device: string;
  iosVersion: string;
  browser: RealIosBrowser;
};

export type RealIosObservedEnvironment = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  devicePixelRatio: number;
  locale: string;
  timezoneId: string;
  webRtcSupported: boolean;
  literalIpCandidates: string[];
};

export type RealIosDiagnostics = { observed: RealIosObservedEnvironment };

export type RealIosRunResult = {
  sessionId: string;
  providerName: string;
  device: string;
  iosVersion: string;
  browser: RealIosBrowser;
  durationMs: number;
  screenshotPath?: string;
  diagnostics: RealIosDiagnostics;
};

export type RealIosValidationResult = { ok: true } | { ok: false; error: string };

export function normalizeProviderUrl(value: string): string {
  const parsed = new URL(value.trim());
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('Provider endpoint must use HTTPS');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function validateProviderSaveRequest(request: RealIosProviderSaveRequest): RealIosValidationResult {
  if (!request.providerName.trim()) return { ok: false, error: 'Enter a provider name' };
  try {
    normalizeProviderUrl(request.remoteUrl);
  } catch {
    return { ok: false, error: 'Enter a valid HTTPS provider endpoint' };
  }
  if (!request.defaultDevice.trim()) return { ok: false, error: 'Enter a default iOS device model' };
  if (!request.defaultIosVersion.trim()) return { ok: false, error: 'Enter a default iOS version' };
  if (!['safari', 'chrome'].includes(request.defaultBrowser)) return { ok: false, error: 'Choose Safari or Chrome iOS' };
  return { ok: true };
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/([?&](?:token|key|secret|password|accessKey)=)[^&\s]*/gi, '$1[REDACTED]')
    .replace(/\b(token|key|secret|password|accessKey)\s*[=:]\s*[^\s&]+/gi, '$1=[REDACTED]');
}
