import type { AndroidFleetRequest, MobileStatus } from './mobileDevices';

/*
 * Typed view of window.orbitqa for the Android surface.
 *
 * The global declaration in src/vite-env.d.ts is maintained by hand and lags the
 * preload bridge, so this module narrows window.orbitqa to exactly the Android
 * methods the Device Profiles page needs. When the global declaration catches up,
 * the cast here stays valid and simply becomes redundant.
 */

export type AndroidSetupState = {
  running: boolean;
  phase: string;
  log: string;
  error: string | null;
};

export type AvdLaunchResult = {
  serial: string;
  state: string;
  alreadyRunning: boolean;
  name: string;
  port: number;
};

export type AvdFleetResult = {
  baseName: string;
  count: number;
  devices: AvdLaunchResult[];
};

export type AndroidBridge = {
  getMobileStatus: () => Promise<MobileStatus>;
  startAndroidSetup: () => Promise<AndroidSetupState>;
  getAndroidSetupState: () => Promise<AndroidSetupState>;
  listAvds: () => Promise<string[]>;
  launchAvd: (name: string, options?: { reuse?: boolean }) => Promise<AvdLaunchResult>;
  stopAvd: (serial: string) => Promise<boolean>;
  launchAvdFleet: (request: AndroidFleetRequest) => Promise<AvdFleetResult>;
  stopAllAvds: () => Promise<string[]>;
  listRunningAvds: () => Promise<MobileStatus['running']>;
  getAvdMaxParallel: () => Promise<number>;
};

export function androidBridge(): AndroidBridge | null {
  const host = window as unknown as { orbitqa?: unknown };
  if (!host.orbitqa) return null;
  return host.orbitqa as AndroidBridge;
}