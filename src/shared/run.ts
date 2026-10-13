import {
  IOS_BROWSER_IDENTITIES,
  IOS_ORIENTATIONS,
  findIosProfile,
  type IosBrowserIdentity,
  type IosDiagnostics,
  type IosOrientation,
  type QaDeviceMode,
} from './mobileDevices';
import type { RealIosCapabilitySelection, RealIosDiagnostics } from './realIos';
import type { ProxySource } from './proxy';
import type { DeviceIdentityReport } from './deviceIdentity';
import type { SessionIntegrityReport } from './sessionIntegrity';
import type { PrivacyRouteIntegrityReport } from './privacyRouteIntegrity';
import { createDefaultPrivacySettings, validatePrivacySettings, type PrivacyDiagnosticReport, type PrivacyRunSettings } from './privacy';

export type QaBrowser = 'chromium' | 'firefox' | 'webkit';

export type QaStep =
  | { id: string; type: 'wait'; ms: number }
  | { id: string; type: 'scroll'; direction: 'up' | 'down'; distance: number }
  | { id: string; type: 'click'; selector: string }
  | { id: string; type: 'type'; selector: string; value: string }
  | { id: string; type: 'screenshot'; fullPage: boolean }
  | { id: string; type: 'smart-interaction'; value: string };

export interface QaRunRequest {
  targetUrls?: string[];
  targetUrl?: string;
  sessionDurationSeconds?: number;
  deviceMode?: QaDeviceMode;
  deviceName?: string;
  browser: QaBrowser;
  iosBrowser?: IosBrowserIdentity;
  iosOrientation?: IosOrientation;
  locale?: string;
  timezoneId?: string;
  sessions: number;
  concurrency: number;
  headless: boolean;
  steps: QaStep[];
  realIos?: RealIosCapabilitySelection;
  privacy?: PrivacyRunSettings;
  proxySource?: ProxySource;
  allowSlowProxies?: boolean;
}


export interface QaWorkUnit {
  workId: string;
  targetIndex: number;
  targetUrl: string;
  repetition: number;
  sessionId: number;
}

export type QaValidationResult = { ok: true } | { ok: false; error: string };


export interface AdSummary {
  total: number;
  observed: number;
  byType: {
    banner: number;
    stickyAnchor: number;
    interstitialVignette: number;
    nativeSponsored: number;
    iframeNetwork: number;
    unknownAd: number;
  };
  status: 'pass' | 'none' | 'partial';
}

export type BrowserRuntimeVerification = {
  runtimeKind: 'chrome-installed' | 'chromium-playwright' | 'firefox-playwright' | 'webkit-playwright' | 'android-chrome' | 'real-ios-provider';
  browserFamily: string;
  verificationStatus: 'verified' | 'compatibility' | 'provider' | 'unverified';
  verificationLabel: string;
  deviceMode: string;
  browserVersion?: string;
  executablePath?: string;
  packageName?: string;
  isRealChrome: boolean;
  isPhysicalDevice: boolean;
};

export type QaEvent = {
  type: 'run-start' | 'run-complete' | 'run-error' | 'run-cancelled' | 'run-status' | 'session-start' | 'session-complete' | 'session-error' | 'session-cancelled' | 'session-incomplete' | 'log' | 'step' | 'ios-diagnostics' | 'privacy-diagnostics' | 'identity-diagnostics' | 'session-integrity' | 'run-metrics' | 'ad-summary' | 'proxy-selection' | 'runtime-verification' | 'privacy-route-integrity' | 'streaming-summary';
  runId: string;
  timestamp: string;
  message?: string;
  sessionId?: number;
  status?: 'running' | 'completed' | 'failed' | 'cancelled' | 'incomplete';
  runStatus?: import('./runCenter').RunStatus;
  workId?: string;
  targetUrl?: string;
  repetition?: number;
  targetId?: string;
  groupId?: string;
  instanceIndex?: number;
  deviceLabel?: string;
  browserLabel?: string;
  proxyIp?: string;
  selectedProxyKind?: 'rotating' | 'static';
  assignedProxy?: string;
  currentExitIp?: string;
  proxyKind?: string;
  severity?: 'debug' | 'info' | 'success' | 'warning' | 'error';
  stage?: string;
  activityType?: string;
  action?: string;
  accountId?: string;
  accountLabel?: string;
  workerIndex?: number;
  workerLabel?: string;
  platform?: string;
  trackId?: string;
  trackTitle?: string;
  selectionId?: string;
  selectionName?: string;
  currentUrl?: string;
  sourceUrl?: string;
  reason?: string;
  attempt?: number;
  remainingSeconds?: number;
  observationSeconds?: number;
  stepId?: string;
  screenshotPath?: string;
  diagnostics?: IosDiagnostics | RealIosDiagnostics;
  privacyDiagnostics?: PrivacyDiagnosticReport;
  identityDiagnostics?: DeviceIdentityReport;
  sessionIntegrity?: SessionIntegrityReport;
  adSummary?: AdSummary;
  runtimeVerification?: BrowserRuntimeVerification;
  privacyRouteIntegrity?: PrivacyRouteIntegrityReport;
  integrityPath?: string;
  metrics?: { requested: number; running: number; queued: number; completed: number; failed: number; cancelled: number; incomplete: number };
  summary?: {
    total: number;
    requested?: number;
    running?: number;
    queued?: number;
    completed: number;
    failed: number;
    cancelled?: number;
    incomplete?: number;
    durationMs: number;
  };
};

function makeStepId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createStep(type: QaStep['type']): QaStep {
  switch (type) {
    case 'wait':
      return { id: makeStepId('wait'), type: 'wait', ms: 1000 };
    case 'scroll':
      return { id: makeStepId('scroll'), type: 'scroll', direction: 'down', distance: 700 };
    case 'click':
      return { id: makeStepId('click'), type: 'click', selector: 'button' };
    case 'type':
      return { id: makeStepId('type'), type: 'type', selector: 'input', value: '' };
    case 'screenshot':
      return { id: makeStepId('shot'), type: 'screenshot', fullPage: true };
    case 'smart-interaction':
      return { id: makeStepId('smart'), type: 'smart-interaction', value: 'Sample interaction' };
  }
}

export function createDefaultSteps(): QaStep[] {
  return [createStep('wait'), createStep('scroll'), createStep('screenshot')];
}

export function normalizeTargetUrl(input: string): string {
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

export function normalizeTargetUrls(input: string | string[]): string[] {
  const lines = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
  const seen = new Set<string>();
  const normalized: string[] = [];

  lines.forEach((line, index) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    let target: string;
    try {
      target = normalizeTargetUrl(trimmed);
    } catch (error) {
      if (error instanceof Error && error.message === 'Target URL must start with http:// or https://') {
        throw error;
      }
      throw new Error(`Invalid target URL on line ${index + 1}`);
    }
    const key = new URL(target).toString();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push(target);
    if (normalized.length > 20) throw new Error('A run can contain up to 20 target URLs');
  });

  if (normalized.length === 0) throw new Error('Enter at least one valid target URL');
  return normalized;
}

export function validateQaRunRequest(request: QaRunRequest): QaValidationResult {
  let targetUrls: string[];
  try {
    const rawTargets = Array.isArray(request.targetUrls) && request.targetUrls.length > 0
      ? request.targetUrls
      : request.targetUrl
        ? [request.targetUrl]
        : [];
    targetUrls = normalizeTargetUrls(rawTargets);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Enter at least one valid target URL' };
  }

  const sessionDurationSeconds = request.sessionDurationSeconds ?? 60;
  if (!Number.isFinite(sessionDurationSeconds) || sessionDurationSeconds < 5 || sessionDurationSeconds > 600) {
    return { ok: false, error: 'Browser session duration must be between 5 and 600 seconds' };
  }

  if (!['chromium', 'firefox', 'webkit'].includes(request.browser)) {
    return { ok: false, error: 'Choose a supported browser' };
  }

  const deviceMode = request.deviceMode ?? 'desktop';
  if (!['desktop', 'android', 'ios-emulation', 'real-ios'].includes(deviceMode)) {
    return { ok: false, error: 'Choose a supported target device' };
  }

  const privacySettings = request.privacy ?? createDefaultPrivacySettings();
  const proxySource = request.proxySource ?? (privacySettings.proxy.enabled ? 'manual' : 'none');
  if (!['none', 'manual', 'rotating', 'static', 'smart-mix'].includes(proxySource)) {
    return { ok: false, error: 'Choose a supported proxy source' };
  }
  if (['rotating', 'static', 'smart-mix'].includes(proxySource) && deviceMode === 'android') {
    return { ok: false, error: 'Proxy pools are not available for Android AVD runs in v0.6' };
  }
  if (['rotating', 'static', 'smart-mix'].includes(proxySource) && deviceMode === 'real-ios') {
    return { ok: false, error: 'Proxy pools are not available for Real iOS Device runs in v0.6' };
  }
  if (proxySource === 'manual' && !privacySettings.proxy.enabled) {
    return { ok: false, error: 'Manual proxy source requires proxy settings' };
  }

  const privacyValidation = validatePrivacySettings(privacySettings, deviceMode as QaDeviceMode);
  if (!privacyValidation.ok) return privacyValidation;

  if (deviceMode === 'android') {
    if (targetUrls.length !== 1) {
      return { ok: false, error: 'Android virtual device runs support exactly 1 target website' };
    }
    if (!request.deviceName?.trim()) {
      return { ok: false, error: 'Choose an Android virtual device' };
    }
    if (request.sessions !== 1) {
      return { ok: false, error: 'Android virtual device runs are limited to 1 session' };
    }
    if (request.concurrency !== 1) {
      return { ok: false, error: 'Android virtual device runs use concurrency 1' };
    }
  }

  if (deviceMode === 'ios-emulation') {
    if (request.browser !== 'webkit') {
      return { ok: false, error: 'Local iOS Compatibility uses WebKit' };
    }
    if (!findIosProfile(request.deviceName)) {
      return { ok: false, error: 'Choose a supported iPhone/iPad profile' };
    }
    if (!IOS_BROWSER_IDENTITIES.includes(request.iosBrowser ?? 'safari-ios')) {
      return { ok: false, error: 'Choose a supported iOS browser identity' };
    }
    if (!IOS_ORIENTATIONS.includes(request.iosOrientation ?? 'portrait')) {
      return { ok: false, error: 'Choose a supported iOS orientation' };
    }
    if (!request.locale?.trim()) {
      return { ok: false, error: 'Choose an iOS locale' };
    }
    if (!request.timezoneId?.trim()) {
      return { ok: false, error: 'Choose an iOS timezone' };
    }
  }


  if (deviceMode === 'real-ios') {
    if (targetUrls.length !== 1) {
      return { ok: false, error: 'Real iOS Device runs support exactly 1 target website' };
    }
    if (request.sessions !== 1 || request.concurrency !== 1) {
      return { ok: false, error: 'Real iOS Device runs use exactly 1 session and concurrency 1' };
    }
    if (!request.realIos?.device.trim()) return { ok: false, error: 'Choose a real iOS device model' };
    if (!request.realIos?.iosVersion.trim()) return { ok: false, error: 'Choose a real iOS version' };
    if (!['safari', 'chrome'].includes(request.realIos?.browser ?? '')) {
      return { ok: false, error: 'Choose Safari or Chrome iOS' };
    }
    if (request.steps.some((step) => step.type === 'smart-interaction')) {
      return { ok: false, error: 'Smart QA Interaction is not available for Real iOS Device runs yet' };
    }
  }

  if (!Number.isInteger(request.sessions) || request.sessions < 1) {
    return { ok: false, error: 'Sessions must be a positive integer' };
  }

  if (!Number.isInteger(request.concurrency) || request.concurrency < 1) {
    return { ok: false, error: 'Concurrency must be a positive integer' };
  }

  if (!Array.isArray(request.steps) || request.steps.length > 50) {
    return { ok: false, error: 'A run can contain up to 50 steps' };
  }

  return { ok: true };
}

export function stepTitle(step: QaStep): string {
  switch (step.type) {
    case 'wait': return 'Wait';
    case 'scroll': return 'Scroll page';
    case 'click': return 'Click element';
    case 'type': return 'Type into field';
    case 'screenshot': return 'Take screenshot';
    case 'smart-interaction': return 'Smart QA interaction';
  }
}
