export interface ProxyIpHistoryRecordingState {
  recordingEnabled: boolean;
}

export type ProxyIpRepeatFilter = 'repeated-in-run' | 'historically-repeated' | 'new-only';

export interface BrowserRuntimeStatus {
  found: boolean;
  executablePath?: string;
  source?: 'program-files' | 'program-files-x86' | 'local-app-data';
  chromeFound?: boolean;
  chromeExecutablePath?: string;
  braveFound?: boolean;
  braveExecutablePath?: string;
}

export interface ProxyIpHistoryQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  countryCode?: string;
  proxyIdentity?: string;
  runId?: string;
  repeatFilter?: ProxyIpRepeatFilter;
}

export interface ProxyIpHistoryRow {
  proxyIdentity: string;
  proxySource: string;
  observedIp: string;
  countryCode: string;
  firstSeenAt: string;
  lastSeenAt: string;
  totalSeenCount: number;
  runsSeenCount: number;
  lastRunId?: string;
  seenInRunCount?: number;
  phasesSeen?: string[];
  repeatedInRun: boolean;
  historicallyRepeated: boolean;
  maxSeenInRunCount?: number;
  runId?: string;
}

export interface ProxyIpHistoryPage {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: {
    uniqueIps: number;
    repeatedIps: number;
    countries: number;
    totalObservations: number;
  };
  rows: ProxyIpHistoryRow[];
}

export interface RunProxyIpSummary {
  runId: string;
  rows: ProxyIpHistoryRow[];
  uniqueIps: number;
  repeatedIpCount: number;
  observationCount: number;
  countries: number;
}
