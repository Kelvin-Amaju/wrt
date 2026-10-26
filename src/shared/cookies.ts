export type QaCookieSameSite = 'Lax' | 'Strict' | 'None';

export interface QaCookieRecord {
  id: string;
  label: string;
  name: string;
  valueMasked: string;
  domain: string;
  path: string;
  secure: boolean;
  sameSite: QaCookieSameSite;
  expires?: number;
  enabled: boolean;
  scope?: string | null;
  status?: 'active' | 'disabled' | 'expired';
  createdAt: string;
  lastUsedAt?: string;
}

export interface QaCookieDraft {
  label: string;
  name: string;
  value: string;
  domain: string;
  path?: string;
  secure?: boolean;
  sameSite?: QaCookieSameSite;
  expires?: number;
  enabled?: boolean;
  scope?: string | null;
}
