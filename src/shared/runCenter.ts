import type { PrivacyRouteIntegrityReport } from './privacyRouteIntegrity';
export type RunStatus =
  | 'CREATED'
  | 'STARTING'
  | 'RUNNING'
  | 'PAUSING'
  | 'PAUSED'
  | 'RESUMING'
  | 'STOPPING'
  | 'STOPPED'
  | 'COMPLETED'
  | 'FAILED';

export type RunExecutionMode = 'visible' | 'background';
export type RunKind = 'qa' | 'streaming' | 'social';
export type AutoRerunMode = 'completed-only' | 'all-finished';
export type BulkDeleteRunScope = 'completed' | 'failed' | 'stopped' | 'all-finished';

export type AutoRerunState = {
  enabled: boolean;
  mode: AutoRerunMode;
  maxConcurrent: number;
  running: number;
  queued: number;
  selectedRunIds: string[];
};

export type StuckRunRecoveryState = {
  enabled: boolean;
  timeoutMinutes: number;
  maxAttempts: number;
  watching: number;
  recovering: number;
};

export type RunCounters = {
  requested: number;
  running: number;
  queued: number;
  completed: number;
  failed: number;
  cancelled: number;
  incomplete: number;
};

export type RunSummary = {
  runId: string;
  runKind?: RunKind;
  createdAt: string;
  updatedAt: string;
  status: RunStatus;
  attemptCount?: number;
  lastStartedAt?: string;
  executionMode: RunExecutionMode;
  requestedConcurrency: number | 'auto';
  targetSummary: string;
  deviceFamilies: string[];
  counters: RunCounters;
  resourceMessage?: string;
  autoRerun?: boolean;
  autoRerunSourceRunId?: string;
  autoRerunSelected?: boolean;
  stuckRecoveryAttempts?: number;
  stuckRecoveryExhausted?: boolean;
  lastProgressPercent?: number;
  lastProgressChangedAtMs?: number;
  streamingMeta?: { platform: string; accounts: number; tracks: number; slots: number };
  socialMeta?: { platform: string; accounts: number; targets: number; groups: number };
};

import type { BrowserRuntimeVerification } from './run';

export type RunDetail = RunSummary & {
  config: unknown;
  logs: unknown[];
  latestPrivacy?: unknown;
  latestIdentity?: unknown;
  latestIntegrity?: unknown;
  latestAdSummary?: unknown;
  proxyMix?: { rotating: number; static: number; total: number };
  streamingSummary?: {
    platform?: string;
    slots?: number;
    accounts?: number;
    tracks?: number;
    groups?: number;
    queueMode?: string;
    observation?: { minSeconds: number; maxSeconds: number };
    completed?: number;
    failed?: number;
    requestedPlaybackChecks?: number;
    playbackCompletions?: number;
    playCount?: number;
    playsByAccount?: Record<string, number>;
    validQaPlaybacks?: number;
    invalidQaPlaybacks?: number;
  };
  streamingResults?: Record<string, unknown>;
  socialSummary?: { platform?: string; accounts?: number; targets?: number; groups?: number; completedTasks?: number; passedChecks?: number; warnings?: number; failedChecks?: number };
  socialResults?: unknown[];
  runtimeVerifications?: Record<string, BrowserRuntimeVerification>;
  privacyRouteIntegrityByWork?: Record<string, PrivacyRouteIntegrityReport>;
};

export type RunCheckpoint = {
  nextWorkOrdinal: number;
  terminalWorkIds: string[];
  inFlightWorkIds: string[];
  urlDeckState?: unknown;
};

export type PersistedRunRecord = {
  schemaVersion: 1;
  summary: RunSummary;
  config: unknown;
  checkpoint: RunCheckpoint;
  logs: unknown[];
  results: Record<string, unknown>;
  lastCheckpointAt: string;
};

export type RunCenterEvent = {
  runId: string;
  type: string;
  timestamp: string;
  payload?: unknown;
};

export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === 'COMPLETED' || status === 'FAILED' || status === 'STOPPED';
}

export function normalizeRunExecutionMode(value: unknown): RunExecutionMode {
  return value === 'background' ? 'background' : 'visible';
}

export function normalizeRunKind(value: unknown): RunKind {
  if (value === 'streaming') return 'streaming';
  if (value === 'social') return 'social';
  return 'qa';
}
