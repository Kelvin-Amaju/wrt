import type { ContentIntelligenceConfig } from './contentIntelligence';
import type { ProxySource } from './proxy';
import type { RunExecutionMode } from './runCenter';

export type StreamingPlatform = 'spotify' | 'apple-music' | 'youtube-music' | 'soundcloud' | 'deezer' | 'tidal' | 'audiomack' | 'pandora';
export type StreamingQueueMode = 'sequential' | 'shuffle' | 'loop';
export type StreamingDeviceFamily = 'desktop' | 'android' | 'ios';
export type StreamingDeviceMode = StreamingDeviceFamily | 'mixed';
export type StreamingBrowserRuntime = 'chrome-installed' | 'brave-installed';
export type StreamingQaCheck = 'playback' | 'favorite-track' | 'follow-artist' | 'pause-resume' | 'next-track' | 'previous-track' | 'queue-transition' | 'volume-control' | 'artist-navigation' | 'album-navigation' | 'playlist-loading' | 'session-verification';
export type StreamingInputKind = 'artist' | 'album' | 'playlist' | 'track' | 'search';
export type StreamingAuthMode = 'session' | 'oauth' | 'credentials';
export type StreamingCatalogFetchStatus = 'complete' | 'partial' | 'failed';
export type StreamingCatalogProgressStage = 'inspecting' | 'resolving' | 'releases' | 'release-tracks' | 'filtering' | 'deduplicating' | 'saving' | 'complete' | 'failed';
export type StreamingQaTrackMode = 'all' | 'count';
export interface StreamingQaGroupNormalConfig {
  observation:{minSeconds:number;maxSeconds:number};
  queueMode:StreamingQueueMode;
  playbackSpeed:number;
  restAfterTracks:number;
  restMinutes:number;
  restAndReplay?:boolean;
  checks:StreamingQaCheck[];
  pauseResumeSeconds:number;
  volumeDirection:'increase'|'decrease';
  executionMode:RunExecutionMode;
  muteAudio:boolean;
  captureScreenshots:boolean;
  browserRuntime?:StreamingBrowserRuntime;
  deviceMode:StreamingDeviceMode;
  deviceProfile?:string;
  mixedDeviceModes?:StreamingDeviceFamily[];
  mixedDeviceProfiles?:Partial<Record<StreamingDeviceFamily,string>>;
}
export interface StreamingQaGroupPlan { groupId: string; accountIds: string[]; trackMode: StreamingQaTrackMode; trackCount?: number; repeatCount?: number; contentIntelligence?: ContentIntelligenceConfig; normalQa?: StreamingQaGroupNormalConfig; }

export interface StreamingLinkVerification {
  status: 'verified';
  verifiedAt: string;
  verifiedUrl: string;
  verifiedDeviceMode: StreamingDeviceFamily;
  verifiedDeviceProfile: string;
}

export interface StreamingTrack {
  id: string;
  platform: StreamingPlatform;
  title: string;
  artist?: string;
  album?: string;
  url: string;
  durationSeconds?: number;
  artworkUrl?: string;
  verification?: StreamingLinkVerification;
}

export interface StreamingCatalogTrack extends StreamingTrack {
  platform: 'spotify';
  spotifyTrackId: string;
  creditedArtistIds: string[];
  creditedArtistNames: string[];
  releaseId?: string;
  releaseName?: string;
  releaseDate?: string;
  isrc?: string;
  alternateReleaseIds?: string[];
  unavailable?: boolean;
  discoveredAt?: string;
  isNew?: boolean;
}

export interface StreamingSourceOrigin {
  kind: StreamingInputKind;
  input: string;
  addedAt: string;
}

export interface SpotifyCatalogConnectionStatus {
  configured: boolean;
  connected: boolean;
  clientId?: string;
  expiresAt?: string;
  accountLabel?: string;
}

export interface StreamingArtistCandidate {
  platformArtistId: string;
  artistName: string;
  artistUrl: string;
  artworkUrl?: string;
  sourceTrackCount?: number;
}

export interface StreamingSourceInspection {
  kind: StreamingInputKind;
  input: string;
  sourceId?: string;
  candidateArtists: StreamingArtistCandidate[];
  autoSelectedArtistId?: string;
}

export interface StreamingCatalogCompleteness {
  releasePagesFetched: number;
  releasesInspected: number;
  rawTracksInspected: number;
  eligibleTracks: number;
  deduplicatedTracks: number;
  failedReleaseIds: string[];
}

export interface StreamingCatalogFetchResult {
  status: StreamingCatalogFetchStatus;
  artist: StreamingArtistCandidate;
  tracks: StreamingCatalogTrack[];
  completeness: StreamingCatalogCompleteness;
  error?: string;
}

export interface StreamingCatalogProgress {
  operationId: string;
  stage: StreamingCatalogProgressStage;
  message: string;
  completed?: number;
  total?: number;
}

export interface SavedStreamingArtist {
  schemaVersion: 2;
  id: string;
  platform: 'spotify';
  platformArtistId: string;
  artistName: string;
  artistUrl: string;
  artworkUrl?: string;
  sourceOrigins: StreamingSourceOrigin[];
  catalogTracks: StreamingCatalogTrack[];
  selectedTrackIds: string[];
  autoRefreshEnabled: boolean;
  lastFetchedAt?: string;
  lastFetchStatus: 'never' | StreamingCatalogFetchStatus;
  lastFetchError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedArtistRunSelection {
  mode: 'all' | 'selected';
  artistIds: string[];
}

export interface StreamingCollection {
  id: string;
  name: string;
  platform: StreamingPlatform;
  sourceInput: string;
  canonicalSourceInput?: string;
  sourceKind: StreamingInputKind;
  tracks: StreamingTrack[];
  createdAt: string;
  updatedAt: string;
  verification?: StreamingLinkVerification;
}

export interface StreamingAccountPublic {
  id: string;
  platform: StreamingPlatform;
  label: string;
  username?: string;
  authMode?: StreamingAuthMode;
  proxySource: ProxySource;
  proxyId?: string;
  staticProxyId?: string;
  staticProxyMode?: 'auto' | 'manual';
  defaultBrowserRuntime?: StreamingBrowserRuntime;
  qaGroup?: string;
  hasPassword?: boolean;
  hasSessionSecret?: boolean;
  status?: 'unverified' | 'ready' | 'needs-verification' | 'warning' | 'failed';
  lastVerifiedAt?: string;
  lastVerificationReason?: string;
  lastVerificationBrowser?: string;
  lastVerificationDeviceMode?: StreamingDeviceFamily;
  lastVerificationDeviceProfile?: string;
  lastVerificationProxySource?: ProxySource;
}

export interface StreamingAccountVerificationSession {
  sessionId: string;
  accountId: string;
  platform: StreamingPlatform;
  status: 'pending';
  reason: string;
  browserLabel: string;
  proxySource: ProxySource;
  deviceMode: StreamingDeviceFamily;
  deviceProfile: string;
  openedAt: string;
}

export interface StreamingRunConfig {
  runKind: 'streaming';
  platform: StreamingPlatform;
  browserRuntime?: StreamingBrowserRuntime;
  deviceMode: StreamingDeviceMode;
  deviceProfile?: string;
  mixedDeviceModes?: StreamingDeviceFamily[];
  mixedDeviceProfiles?: Partial<Record<StreamingDeviceFamily,string>>;
  collectionIds: string[];
  savedArtistIds?: string[];
  savedArtistSelection?: SavedArtistRunSelection;
  trackIds: string[];
  inlineTracks?: StreamingTrack[];
  accountIds: string[];
  groupPlans?: StreamingQaGroupPlan[];
  slots: number;
  observation: { minSeconds: number; maxSeconds: number };
  queueMode: StreamingQueueMode;
  playbackSpeed: number;
  restAfterTracks: number;
  restMinutes: number;
  restAndReplay?: boolean;
  checks: StreamingQaCheck[];
  pauseResumeSeconds?: number;
  volumeDirection?: 'increase' | 'decrease';
  executionMode: RunExecutionMode;
  muteAudio?: boolean;
  contentIntelligence?: ContentIntelligenceConfig;
  captureScreenshots: boolean;
  requestedWorkUnits?: number;
  concurrency?: { mode: 'manual'; value: number };
}

export function mergeSelectedStreamingCatalogTracks(artists: SavedStreamingArtist[], artistIds?: string[]): StreamingCatalogTrack[] {
  const allow = artistIds?.length ? new Set(artistIds) : null;
  const map = new Map<string, StreamingCatalogTrack>();
  for (const artist of artists) {
    if (allow && !allow.has(artist.id)) continue;
    const selected = new Set(artist.selectedTrackIds);
    for (const track of artist.catalogTracks) {
      if (!selected.has(track.spotifyTrackId) && !selected.has(track.id)) continue;
      const key = track.spotifyTrackId || track.id || track.url;
      if (!map.has(key)) map.set(key, track);
    }
  }
  return [...map.values()];
}

export function normalizeStreamingQueueMode(value: unknown): StreamingQueueMode {
  return value === 'shuffle' || value === 'loop' ? value : 'sequential';
}

export function normalizeObservationRange(value: { minSeconds?: unknown; maxSeconds?: unknown } | null | undefined) {
  const a = Math.max(1, Math.min(3600, Number(value?.minSeconds) || 60));
  const b = Math.max(1, Math.min(3600, Number(value?.maxSeconds) || 110));
  return { minSeconds: Math.min(a, b), maxSeconds: Math.max(a, b) };
}

export function normalizeStreamingPlatform(value: unknown): StreamingPlatform {
  const allowed: StreamingPlatform[] = ['spotify','apple-music','youtube-music','soundcloud','deezer','tidal','audiomack','pandora'];
  return allowed.includes(value as StreamingPlatform) ? value as StreamingPlatform : 'spotify';
}
