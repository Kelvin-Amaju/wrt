import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Run } from './Run';
import type { QaEvent } from '../shared/run';

const startQaRun = vi.fn();
const stopQaRun = vi.fn();
const getProxySummary = vi.fn();
const getMobileStatus = vi.fn();
const getRealIosProviderConfig = vi.fn();
const checkRealIosProvider = vi.fn();
let eventListener: ((event: QaEvent) => void) | undefined;

beforeEach(() => {
  eventListener = undefined;
  startQaRun.mockReset().mockResolvedValue({ runId: 'run-v08' });
  stopQaRun.mockReset().mockResolvedValue({ runId: 'run-v08', stopped: true });
  getProxySummary.mockReset().mockResolvedValue({
    total: 3, live: 2, slow: 1, dead: 0, unavailable: 0, testing: 0,
    rotatingLive: 1, rotatingSlow: 1, staticLive: 1, staticSlow: 0,
  });
  getMobileStatus.mockReset().mockResolvedValue({
    sdkPath: 'C:/Android', adbPath: 'adb', emulatorPath: 'emulator', adbAvailable: true,
    emulatorAvailable: true, avds: ['Pixel_7_API_35'], devices: [], error: null,
  });
  getRealIosProviderConfig.mockReset().mockResolvedValue({
    providerName: 'Cloud', remoteUrl: 'https://hub.test/wd/hub', username: 'qa',
    defaultDevice: 'iPhone 15', defaultIosVersion: '17', defaultBrowser: 'safari', credentialsSaved: true,
  });
  checkRealIosProvider.mockReset().mockResolvedValue({
    configured: true, reachable: true, authenticated: true,
    safariSupported: true, chromeSupported: false, message: 'ready',
  });
  Object.defineProperty(window, 'orbitqa', {
    configurable: true,
    value: {
      getAppInfo: vi.fn(), startQaRun, stopQaRun, getProxySummary, getMobileStatus,
      getRealIosProviderConfig, checkRealIosProvider,
      onQaEvent: vi.fn((listener: (event: QaEvent) => void) => { eventListener = listener; return () => undefined; }),
    },
  });
});

describe('TestRuns v0.12 URL pool + device matrix', () => {
  it('renders one Target URL Pool and checkbox device matrix instead of repeated target cards', async () => {
    render(<Run />);
    expect(screen.getByRole('heading', { name: 'URL pool device matrix' })).toBeInTheDocument();
    expect(screen.getByLabelText('Target URL Pool')).toBeInTheDocument();
    expect(screen.getByLabelText('Desktop')).toBeChecked();
    expect(screen.getByLabelText('Google Chrome — REAL')).toBeChecked();
    expect(screen.queryByText(/Add target website/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Proxy mode General')).toBeChecked();
    expect(screen.getByLabelText('Behavior Mode')).toHaveValue('auto');
    await waitFor(() => expect(getProxySummary).toHaveBeenCalled());
  });

  it('submits multiple pooled URLs with multiple selected device families and general proxy policy', async () => {
    render(<Run />);
    fireEvent.change(screen.getByLabelText('Target URL Pool'), { target: { value: 'savevidly.xyz\nexample.com\nsavevidly.xyz' } });
    fireEvent.change(screen.getByLabelText('Desktop instances per browser'), { target: { value: '2' } });
    fireEvent.click(screen.getByLabelText('Android mobile emulation'));
    await waitFor(() => expect(screen.getByLabelText('Pixel 11')).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText('Proxy mode General'));
    fireEvent.change(screen.getByLabelText('General proxy source'), { target: { value: 'rotating' } });
    fireEvent.change(screen.getByLabelText('Concurrency'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start QA test' }));
    await waitFor(() => expect(startQaRun).toHaveBeenCalledTimes(1));
    const request = startQaRun.mock.calls[0][0];
    expect(request.version).toBe(3);
    expect(request.urlPool).toEqual(['https://savevidly.xyz/', 'https://example.com/']);
    expect(request.devices.desktop.instancesPerBrowser).toBe(2);
    expect(request.devices.androidEmulation.enabled).toBe(true);
    expect(request.proxyMode).toBe('general');
    expect(request.generalProxy.source).toBe('rotating');
    expect(request.concurrency).toEqual({ mode: 'manual', value: 3 });
    expect(request.executionMode).toBe('visible');
  });

  it('switches to per-device proxy controls for selected compatible families', async () => {
    render(<Run />);
    fireEvent.click(screen.getByLabelText('Android mobile emulation'));
    fireEvent.click(screen.getByLabelText('Proxy mode Per device'));
    await waitFor(() => expect(screen.getByLabelText('Desktop proxy source')).toBeInTheDocument());
    expect(screen.getByLabelText('Android mobile proxy source')).toBeInTheDocument();
    expect(screen.queryByLabelText('Android AVD proxy source')).not.toBeInTheDocument();
  });

  it('supports visible and background execution modes', () => {
    render(<Run />);
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'background' } });
    expect(screen.getByLabelText('Execution mode')).toHaveValue('background');
    expect(screen.getByLabelText('Show interaction pointer')).not.toBeChecked();
    expect(screen.getByLabelText('Show interaction pointer')).toBeDisabled();
  });

  it('keeps the manual script behind Advanced behavior mode and sends milliseconds', async () => {
    render(<Run />);
    fireEvent.change(screen.getByLabelText('Behavior Mode'), { target: { value: 'manual' } });
    expect(screen.getByLabelText('Wait seconds')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Target URL Pool'), { target: { value: 'example.com' } });
    fireEvent.change(screen.getByLabelText('Wait seconds'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start QA test' }));
    await waitFor(() => expect(startQaRun).toHaveBeenCalledTimes(1));
    expect(startQaRun.mock.calls[0][0].autoQa.behaviorMode).toBe('manual');
    expect(startQaRun.mock.calls[0][0].steps[0]).toMatchObject({ type: 'wait', ms: 1500 });
  });

  it('sends Auto QA reading/referrer settings and validates custom simulated referrers', async () => {
    render(<Run />);
    fireEvent.change(screen.getByLabelText('Target URL Pool'), { target: { value: 'example.com' } });
    fireEvent.change(screen.getByLabelText('Reading Pace'), { target: { value: 'slow' } });
    fireEvent.change(screen.getByLabelText('Referrer QA'), { target: { value: 'custom-simulated' } });
    fireEvent.change(screen.getByLabelText('Custom test referrer'), { target: { value: 'http://unsafe.example/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start QA test' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('https://');
    expect(startQaRun).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Custom test referrer'), { target: { value: 'https://referrer.example/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start QA test' }));
    await waitFor(() => expect(startQaRun).toHaveBeenCalledTimes(1));
    expect(startQaRun.mock.calls[0][0].autoQa).toMatchObject({ behaviorMode: 'auto', readingPace: 'slow', referrerMode: 'custom-simulated', customReferrer: 'https://referrer.example/' });
  });

  it('keeps the editor available so another independent run can be created', async () => {
    startQaRun.mockResolvedValueOnce({ runId: 'run-a' }).mockResolvedValueOnce({ runId: 'run-b' });
    render(<Run />);
    fireEvent.change(screen.getByLabelText('Target URL Pool'), { target: { value: 'example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start QA test' }));
    await waitFor(() => expect(startQaRun).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Target URL Pool')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start QA test' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Target URL Pool'), { target: { value: 'example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start QA test' }));
    await waitFor(() => expect(startQaRun).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toHaveTextContent('Run run-b created');
  });

  it('renders work-unit metadata from v0.8 events', () => {
    render(<Run />);
    act(() => eventListener?.({
      type: 'session-start', runId: 'run-v08', timestamp: new Date().toISOString(),
      workId: 'save-mobile-instance-2', targetId: 'save', groupId: 'mobile', targetUrl: 'https://savevidly.xyz',
      instanceIndex: 1, deviceLabel: 'Pixel 7', browserLabel: 'Chrome Android', status: 'running',
    }));
    expect(screen.getByText(/savevidly\.xyz · Pixel 7 · Chrome Android · #2/i)).toBeInTheDocument();
  });

  it('renders profile consistency separately from local iOS host/runtime facts', () => {
    render(<Run />);
    const profileChecks = [
      { key: 'ua', label: 'iOS compatibility browser identity', status: 'pass' as const, classification: 'consistent' as const, required: true, expected: 'iPhone Safari', observed: 'iPhone Safari', detail: 'Requested browser identity is present.' },
      { key: 'ios-functional-tap', label: 'iOS functional tap', status: 'pass' as const, classification: 'consistent' as const, required: true, expected: 'Tap interaction succeeds', observed: 'pass', detail: 'Active tap verification passed.' },
    ];
    const runtimeFacts = [
      { key: 'webdriver', label: 'Automation observability', status: 'not-applicable' as const, classification: 'host-runtime' as const, required: false, expected: 'Reported truthfully', observed: 'true', detail: 'Host/runtime fact.' },
      { key: 'platform', label: 'Navigator platform', status: 'not-applicable' as const, classification: 'host-runtime' as const, required: false, expected: 'Host/runtime fact', observed: 'Win32', detail: 'Host/runtime fact.' },
    ];
    act(() => eventListener?.({
      type: 'identity-diagnostics', runId: 'run-v10', timestamp: new Date().toISOString(), workId: 'w-ios-1',
      identityDiagnostics: {
        overall: 'pass', profileConsistency: 'pass', blocked: false, blockingReasons: [], mode: 'ios-emulation', profile: 'iPhone 13',
        fidelity: { level: 'compatibility-emulation', label: 'Compatibility emulation', description: 'Mobile compatibility profile on the host runtime.', limitations: ['Host platform remains visible.'] },
        functionalCompatibility: { iosTap: 'pass', mobileInteraction: 'pass' },
        observed: {
          userAgent: 'iPhone Safari', platform: 'Win32', maxTouchPoints: 0,
          viewport: { width: 390, height: 664 }, screen: { width: 390, height: 844 }, devicePixelRatio: 3,
          locale: 'en-US', timezoneId: 'UTC', webdriver: true, hardwareConcurrency: 8, deviceMemory: 8,
        },
        profileChecks,
        runtimeFacts,
        checks: [...profileChecks, ...runtimeFacts],
      },
    }));
    expect(screen.getByText('Device Identity Check')).toBeInTheDocument();
    expect(screen.getByText('iPhone 13')).toBeInTheDocument();
    expect(screen.getByText('Profile Consistency')).toBeInTheDocument();
    expect(screen.getByText('iOS Functional Compatibility')).toBeInTheDocument();
    expect(screen.getByText('Physical iPhone Fidelity')).toBeInTheDocument();
    expect(screen.getByText('Automation observability')).toBeInTheDocument();
    expect(screen.getByText('Compatibility emulation')).toBeInTheDocument();
    expect(screen.getAllByText('HOST INFO')).toHaveLength(2);
    expect(screen.getByText('Local iOS Compatibility is WebKit compatibility testing on Windows; physical-device fidelity is provided only by the Real iOS Provider path.')).toBeInTheDocument();
  });

  it('renders privacy diagnostics without mixing work-unit identity', () => {
    render(<Run />);
    act(() => eventListener?.({
      type: 'privacy-diagnostics', runId: 'run-v08', timestamp: new Date().toISOString(), workId: 'w1',
      privacyDiagnostics: {
        overall: 'pass', blocked: false, blockingReasons: [], webRtcPolicy: 'unsupported', startedAt: new Date().toISOString(), durationMs: 5,
        observed: {
          userAgent: 'UA', platform: 'Win32', maxTouchPoints: 0, viewport: { width: 1280, height: 720 },
          devicePixelRatio: 1, locale: 'en-US', timezoneId: 'UTC', webRtcSupported: false, literalIpCandidates: [],
          permissionStates: { camera: 'denied', microphone: 'denied', geolocation: 'denied', notifications: 'denied' },
        },
        checks: [{ key: 'page-load', label: 'Page load health', status: 'pass', required: true, observed: 'Loaded' }],
      },
    }));
    expect(screen.getByText('Privacy & Network Check')).toBeInTheDocument();
    expect(screen.getByText('Page load health')).toBeInTheDocument();
  });

  it('renders per-work-unit Session & Network Integrity diagnostics', () => {
    render(<Run />);
    act(() => eventListener?.({
      type: 'session-integrity', runId: 'run-v095', timestamp: new Date().toISOString(), workId: 'w1',
      sessionIntegrity: {
        overall: 'pass', verdict: 'verified', blocked: false, blockingReasons: [],
        proxySource: 'static', proxyRequired: true, recordedAt: new Date().toISOString(),
        observed: {
          directIp: '198.51.100.10', initialExitIp: '203.0.113.20', finalExitIp: '203.0.113.20',
          literalIpCandidates: [], locale: 'en-US', timezoneId: 'UTC',
        },
        checks: [
          { key: 'browser-exit-ip', label: 'Browser exit IP', status: 'pass', required: true, observed: '203.0.113.20' },
          { key: 'route-continuity', label: 'Route continuity', status: 'pass', required: true, observed: '203.0.113.20 → 203.0.113.20' },
        ],
      },
    }));
    expect(screen.getByText('Session & Network Integrity')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED')).toBeInTheDocument();
    expect(screen.getByText('Route continuity')).toBeInTheDocument();
  });

});

// Regression coverage appended outside describe intentionally uses the same setup globals.
describe('TestRuns ad summary and diagnostic visibility', () => {
  it('shows aggregate ad counts in LIVE MATRIX latest result', () => {
    render(<Run />);
    act(() => eventListener?.({
      type:'ad-summary', runId:'run-ads', timestamp:new Date().toISOString(), workId:'w1',
      adSummary:{ total:4, observed:4, byType:{ banner:2, stickyAnchor:1, interstitialVignette:1, nativeSponsored:0, iframeNetwork:0, unknownAd:0 }, status:'pass' },
    }));
    expect(screen.getByText('ADS OBSERVED')).toBeInTheDocument();
    expect(screen.getByText('Total seen')).toBeInTheDocument();
    expect(screen.getByText('Observed')).toBeInTheDocument();
    expect(screen.getByText('Banner')).toBeInTheDocument();
    expect(screen.getByText('Sticky / Anchor')).toBeInTheDocument();
    expect(screen.getByText('Interstitial / Vignette')).toBeInTheDocument();
    expect(screen.getByText('PASS')).toBeInTheDocument();
    expect(screen.queryByText('Native / Sponsored')).not.toBeInTheDocument();
  });

  it('shows a compact zero-ad state without empty type rows', () => {
    render(<Run />);
    act(() => eventListener?.({
      type:'ad-summary', runId:'run-zero-ads', timestamp:new Date().toISOString(), workId:'w1',
      adSummary:{ total:0, observed:0, byType:{ banner:0, stickyAnchor:0, interstitialVignette:0, nativeSponsored:0, iframeNetwork:0, unknownAd:0 }, status:'none' },
    }));
    expect(screen.getByText('No visible ads detected')).toBeInTheDocument();
    expect(screen.queryByText('Banner')).not.toBeInTheDocument();
  });

  it('hides Locale and Timezone rows from visible diagnostic panels', () => {
    render(<Run />);
    act(() => eventListener?.({
      type:'privacy-diagnostics', runId:'run-hide', timestamp:new Date().toISOString(), workId:'w1',
      privacyDiagnostics:{ overall:'pass', blocked:false, blockingReasons:[], webRtcPolicy:'unsupported', startedAt:new Date().toISOString(), durationMs:1,
        observed:{ userAgent:'UA', platform:'Win32', maxTouchPoints:0, viewport:{width:1,height:1}, devicePixelRatio:1, locale:'en-US', timezoneId:'UTC', webRtcSupported:false, literalIpCandidates:[], permissionStates:{camera:'denied',microphone:'denied',geolocation:'denied',notifications:'denied'} },
        checks:[
          {key:'locale',label:'Locale',status:'pass',required:true,observed:'en-US'},
          {key:'timezone',label:'Timezone',status:'pass',required:true,observed:'UTC'},
          {key:'page-load',label:'Page load health',status:'pass',required:true,observed:'Loaded'},
        ] },
    }));
    expect(screen.queryByText('Locale')).not.toBeInTheDocument();
    expect(screen.queryByText('Timezone')).not.toBeInTheDocument();
    expect(screen.getByText('Page load health')).toBeInTheDocument();
  });
});



describe('TestRuns real Chrome runtime truth', () => {
  it('shows Chrome unavailable status without removing compatibility selections', async () => {
    (window.orbitqa as typeof window.orbitqa & { getBrowserRuntimeStatus?: () => Promise<{ found:boolean }> }).getBrowserRuntimeStatus = vi.fn().mockResolvedValue({ found:false });
    render(<Run />);
    expect(await screen.findByText('Google Chrome not found')).toBeInTheDocument();
    expect(screen.getByLabelText('Chromium — Compatibility')).toBeInTheDocument();
  });

  it('uses runtime verification truth in active work-unit labels', () => {
    render(<Run />);
    act(() => eventListener?.({
      type:'session-start', runId:'run-v08', timestamp:new Date().toISOString(), workId:'w-real-chrome',
      targetUrl:'https://example.com', instanceIndex:0, deviceLabel:'Pixel 7', browserLabel:'Chrome Android', status:'running',
    } as QaEvent));
    act(() => eventListener?.({
      type:'runtime-verification', runId:'run-v08', timestamp:new Date().toISOString(), workId:'w-real-chrome',
      targetUrl:'https://example.com', instanceIndex:0, deviceLabel:'Pixel 7', browserLabel:'Chrome Android',
      runtimeVerification:{ runtimeKind:'chrome-installed', browserFamily:'Google Chrome', verificationStatus:'verified', verificationLabel:'REAL INSTALLED GOOGLE CHROME', deviceMode:'android-emulation', isRealChrome:true, isPhysicalDevice:false },
    } as QaEvent));
    expect(screen.getByText(/example\.com · Pixel 7 · REAL INSTALLED GOOGLE CHROME · #1/i)).toBeInTheDocument();
  });
});
