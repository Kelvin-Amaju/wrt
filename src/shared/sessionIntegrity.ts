export type SessionIntegrityCheckStatus = 'pass' | 'warning' | 'fail' | 'not-applicable';

export interface SessionIntegrityCheck {
  key: string;
  label: string;
  status: SessionIntegrityCheckStatus;
  required: boolean;
  observed?: string;
  detail?: string;
}

export interface SessionIntegrityReport {
  overall: 'pass' | 'warning' | 'fail';
  verdict: 'verified' | 'warning' | 'blocked';
  blocked: boolean;
  blockingReasons: string[];
  proxySource: 'none' | 'manual' | 'rotating' | 'static' | 'smart-mix';
  proxyRequired: boolean;
  checks: SessionIntegrityCheck[];
  observed: {
    directIp?: string;
    initialExitIp?: string;
    finalExitIp?: string;
    literalIpCandidates: string[];
    webRtcPolicy?: 'prevented' | 'verified-no-leak' | 'unsupported' | 'exposed' | 'indeterminate';
    locale?: string;
    timezoneId?: string;
  };
  recordedAt: string;
}
