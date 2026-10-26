export type AndroidDeviceState = 'device' | 'offline' | 'unauthorized' | 'booted' | 'unknown';

export interface AndroidAttachedDevice {
  serial: string;
  state: string;
  model: string;
  managed: boolean;
}

export interface AndroidRunningDevice {
  serial: string;
  avdName: string;
  port: number;
  booted: boolean;
  startedAt: number;
}

export interface MobileStatus {
  sdkPath: string | null;
  adbPath: string | null;
  emulatorPath: string | null;
  adbAvailable: boolean;
  emulatorAvailable: boolean;
  avds: string[];
  devices: AndroidAttachedDevice[];
  error: string | null;
}

export interface AndroidBridge {
  getMobileStatus: () => Promise<MobileStatus>;
  listAvds: () => Promise<string[]>;
  launchAvd: (name: string) => Promise<AndroidRunningDevice>;
  stopAvd: (serial: string) => Promise<{ stopped: boolean; serial: string }>;
  createAndroidDevice: (options?: { avdName?: string }) => Promise<AndroidRunningDevice>;
  listRunningAndroidDevices: () => Promise<AndroidRunningDevice[]>;
  stopAllAndroidDevices: () => Promise<string[]>;
  openAndroidUrl: (serial: string, url: string) => Promise<{ url: string; serial: string }>;
  getAndroidDeviceStatus: (serial: string) => Promise<AndroidRunningDevice>;
  isAndroidChromeReady: (serial: string) => Promise<boolean>;
  getAndroidMaxDevices: () => Promise<number>;
}

export const EMPTY_MOBILE_STATUS: MobileStatus = {
  sdkPath: null,
  adbPath: null,
  emulatorPath: null,
  adbAvailable: false,
  emulatorAvailable: false,
  avds: [],
  devices: [],
  error: null,
};

export function unwrap<T>(result: { ok: boolean; value?: T; error?: string }): T {
  if (!result || result.ok !== true) {
    throw new Error(result?.error || 'Android command failed.');
  }
  return result.value as T;
}

export function formatUptime(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}