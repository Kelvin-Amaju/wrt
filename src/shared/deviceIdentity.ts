export type DeviceIdentityStatus = 'pass' | 'warning' | 'fail' | 'not-applicable';
export type DeviceIdentityClassification = 'consistent' | 'expected-limitation' | 'host-runtime' | 'warning' | 'blocking';
export type DeviceRuntimeFidelityLevel = 'desktop-automation' | 'compatibility-emulation' | 'native-android-runtime' | 'real-ios-provider';

export interface DeviceRuntimeFidelity {
  level: DeviceRuntimeFidelityLevel;
  label: string;
  description: string;
  limitations: string[];
}

export interface DeviceIdentityCheck {
  key: string;
  label: string;
  status: DeviceIdentityStatus;
  classification?: DeviceIdentityClassification;
  required: boolean;
  expected: string;
  observed: string;
  detail?: string;
}

export interface DeviceIdentityObserved {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  viewport: { width: number; height: number };
  screen: { width: number; height: number; availWidth?: number; availHeight?: number; colorDepth?: number };
  orientation?: string;
  devicePixelRatio: number;
  locale: string;
  languages?: string[];
  timezoneId: string;
  webdriver: boolean | null;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  canvas?: { supported: boolean; signature: string; error?: string };
  webgl?: { supported: boolean; version?: string; vendor?: string; renderer?: string; signature: string; extensionsHash?: string; error?: string };
}

export interface DeviceIdentityReport {
  overall: 'pass' | 'warning' | 'fail';
  blocked: boolean;
  blockingReasons: string[];
  fidelity?: DeviceRuntimeFidelity;
  mode: string;
  profile: string;
  profileConsistency?: 'pass' | 'warning' | 'fail';
  profileChecks?: DeviceIdentityCheck[];
  runtimeFacts?: DeviceIdentityCheck[];
  functionalCompatibility?: {
    iosTap: 'pass' | 'fail' | 'not-applicable';
    mobileInteraction: 'pass' | 'fail' | 'not-applicable';
  };
  workerGeo?: {
    countryCode?: string;
    country?: string;
    region?: string;
    city?: string;
    timezoneId?: string;
    locale?: string;
    languageHeader?: string;
    latitude?: number | null;
    longitude?: number | null;
    hasCoordinates?: boolean;
  } | null;
  contextValidation?: { status: 'pass' | 'warning' | 'fail'; ok: boolean; issues: string[]; warnings: string[] } | null;
  graphicsStability?: {
    overall: 'pass' | 'warning';
    canvas: { key: string; status: 'pass' | 'warning' | 'not-applicable'; stable: boolean | null; before: string; after: string };
    webgl: { key: string; status: 'pass' | 'warning' | 'not-applicable'; stable: boolean | null; before: string; after: string };
  };
  checks: DeviceIdentityCheck[];
  observed: DeviceIdentityObserved;
}
