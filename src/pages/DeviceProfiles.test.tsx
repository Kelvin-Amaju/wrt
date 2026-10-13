import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceProfiles } from './DeviceProfiles';

const getMobileStatus = vi.fn();
const launchAvd = vi.fn();
const stopAvd = vi.fn();

beforeEach(() => {
  getMobileStatus.mockReset();
  getMobileStatus.mockResolvedValue({
    sdkPath: 'C:\\Users\\tester\\AppData\\Local\\Android\\Sdk',
    adbPath: 'C:\\Users\\tester\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe',
    emulatorPath: 'C:\\Users\\tester\\AppData\\Local\\Android\\Sdk\\emulator\\emulator.exe',
    adbAvailable: true,
    emulatorAvailable: true,
    avds: ['Pixel_9_API_36'],
    devices: [],
    error: null,
  });
  Object.defineProperty(window, 'orbitqa', {
    configurable: true,
    value: { getMobileStatus, listAvds: vi.fn(), launchAvd, stopAvd },
  });
});

describe('DeviceProfiles', () => {
  it('shows desktop, Android, local iOS, and real iOS tabs', () => {
    render(<DeviceProfiles />);
    expect(screen.getByRole('button', { name: 'Desktop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Android Virtual Device' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Local iOS Compatibility' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Real iOS Device' })).toBeInTheDocument();
  });

  it('loads Android status only when the Android tab is selected', async () => {
    render(<DeviceProfiles />);
    expect(getMobileStatus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Android Virtual Device' }));
    await waitFor(() => expect(getMobileStatus).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Pixel_9_API_36')).toBeInTheDocument();
  });

  it('labels Apple profiles as browser emulation', () => {
    render(<DeviceProfiles />);
    fireEvent.click(screen.getByRole('button', { name: 'Local iOS Compatibility' }));
    expect(screen.getByText(/not Apple's real iOS Simulator/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Safari \+ Chrome iOS compatibility/i })).toBeInTheDocument();
    expect(screen.getByText(/CriOS-compatible user-agent identity/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /WebRTC exposure diagnostic/i })).toBeInTheDocument();
    expect(screen.getByText('iPhone 18 Pro')).toBeInTheDocument();
  });
});


it('separates Local iOS Compatibility from Real iOS Device', () => {
  render(<DeviceProfiles />);
  expect(screen.getByRole('button', { name: 'Local iOS Compatibility' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Real iOS Device' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Real iOS Device' }));
  expect(screen.getByText(/provider-backed physical or remote iPhone/i)).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /Configure in Settings/i })).toBeInTheDocument();
});
