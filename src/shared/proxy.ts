export type ProxyKind = 'rotating' | 'static';
export type ProxyProtocol = 'http' | 'https' | 'socks5';
export type ProxyHealth = 'pending' | 'checking' | 'live' | 'slow' | 'dead' | 'unavailable';
export type ProxySource = 'none' | 'manual' | ProxyKind | 'smart-mix';

export interface ProxyPublicRecord {
  id: string;
  kind: ProxyKind;
  protocol: ProxyProtocol;
  hostname: string;
  port: number;
  username?: string;
  hasPassword: boolean;
  enabled: boolean;
  health: ProxyHealth;
  latencyMs?: number;
  observedIp?: string;
  expectedStaticIp?: string;
  pendingStaticIp?: string;
  staticIpChangePending?: boolean;
  countryCode?: string;
  failureCount: number;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
  source?: string;
  provider?: string;
}

export interface ProxySummary {
  total: number;
  live: number;
  slow: number;
  dead: number;
  unavailable: number;
  checking: number;
  rotatingLive: number;
  rotatingSlow: number;
  staticLive: number;
  staticSlow: number;
}

export interface ProxyImportResult {
  accepted: ProxyPublicRecord[];
  duplicates: Array<{ line: string; existingId: string; passwordChanged: boolean }>;
  invalid: Array<{ line: string; error: string }>;
}

export interface ProxyActivityEntry {
  id: string;
  proxyId?: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
}

export type PoolProxySource = ProxyKind | 'smart-mix';

export function isPoolProxySource(source: ProxySource): source is PoolProxySource {
  return source === 'rotating' || source === 'static' || source === 'smart-mix';
}


export function formatMaskedProxyEndpoint(
  proxy: Pick<ProxyPublicRecord, 'protocol' | 'hostname' | 'port' | 'username' | 'hasPassword'>,
): string {
  const auth = proxy.username ? `${proxy.username}${proxy.hasPassword ? ':***' : ''}@` : '';
  return `${proxy.protocol}://${auth}${proxy.hostname}:${proxy.port}`;
}
