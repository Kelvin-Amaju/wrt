export type PodDeviceType = 'desktop' | 'android' | 'ios';
export type PodCountry = 'US' | 'GB' | 'CA' | 'AU' | 'NG' | 'IN';
export interface PodProfileFingerprint { userAgent: string; platform: string; viewport: { width: number; height: number }; screen: { width: number; height: number; colorDepth: number }; deviceScaleFactor: number; maxTouchPoints: number; hardwareConcurrency: number; deviceMemory: number; locale: string; languages: string[]; timezoneId: string; browserFamily: 'chromium' | 'brave' | 'firefox' | 'webkit'; }
export interface PodProfile { id: string; podId: string; index: number; deviceType: PodDeviceType; country: PodCountry; fingerprint: PodProfileFingerprint; proxyId: string | null; status: 'NEW' | 'WARMING' | 'WARM' | 'FAILED'; createdAt: string; lastWarmedAt: string | null; warmCount: number; }
export interface Pod { id: string; name: string; deviceType: PodDeviceType; country: PodCountry; count: number; createdAt: string; }
export interface WarmerTopic { id: string; label: string; createdAt: string; }
export interface WarmerAssignment { id: string; email: string; purpose: string; podId: string | null; profileId: string | null; createdAt: string; }
export interface WarmerRunSummary { runId: string; podId: string; profileIds: string[]; status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STOPPED'; startedAt: string; finishedAt: string | null; searches: number; cookiesSaved: number; error: string | null; }
