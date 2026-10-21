import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceProfiles } from './DeviceProfiles';

const getMobileStatus = vi.fn();
const launchAvd = vi.fn();
const stopAvd = vi.fn();
const startAndroidSetup = vi.fn();
const getAndroidSetupState = vi.fn();

beforeEach(() => {
  getMobileStatus.mockReset();
  startAndroidSetup.mockReset().mockResolvedValue({ running: true, phase: 'installing', log: 'Downloading Java...', error: null });
  getAndroidSetupState.mockReset().mockResolvedValue({ running: false, phase: 'idle', log: '', error: null });
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
    value: { getMobileStatus, listAvds: vi.fn(), launchAvd, stopAvd, startAndroidSetup, getAndroidSetupState },
  });
});

describe('DeviceProfiles', () => {
  it('requires license consent before starting setup and displays progress', async () => {
    render(<DeviceProfiles />);
    fireEvent.click(screen.getByRole('button', { name: 'Android Virtual Device' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh Devices' })).toBeEnabled());
    const button = screen.getByRole('button', { name: 'Set up Android Emulator' });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /I accept the Android SDK/ }));
    fireEvent.click(button);
    await waitFor(() => expect(startAndroidSetup).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('log')).toHaveTextContent('Downloading Java...');
    expect(screen.getByRole('button', { name: 'Setting up Android...' })).toBeDisabled();
  });
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
