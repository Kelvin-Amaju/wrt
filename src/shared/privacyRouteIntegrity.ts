export type PrivacyRouteIntegrityCheckStatus = 'pass' | 'fail' | 'blocked' | 'unsupported' | 'not-verified' | 'info';
export type PrivacyRouteIntegrityPhase = 'pre-navigation' | 'pre-behavior' | 'post-behavior';

export interface PrivacyRouteIntegrityCheck {
  key: string;
  label: string;
  status: PrivacyRouteIntegrityCheckStatus;
  expected?: string;
  observed?: string;
  detail?: string;
}

export interface PrivacyRouteIntegrityReport {
  overallStatus: 'pass' | 'fail' | 'not-verified';
  strictMode: boolean;
  proxyRequired: boolean;
  checks: PrivacyRouteIntegrityCheck[];
  runtimeLabel?: string;
  observedAt: string;
  phase: PrivacyRouteIntegrityPhase;
}
