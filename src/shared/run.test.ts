import { describe, expect, it } from 'vitest';
import { createDefaultSteps, createStep, normalizeTargetUrl, normalizeTargetUrls, validateQaRunRequest, type QaRunRequest } from './run';

function validRequest(): QaRunRequest {
  return {
    targetUrls: ['https://example.com'],
    sessionDurationSeconds: 60,
    browser: 'chromium',
    sessions: 3,
    concurrency: 3,
    headless: true,
    steps: createDefaultSteps(),
  };
}

describe('test run domain', () => {
  it('creates lightweight default steps', () => {
    const steps = createDefaultSteps();
    expect(steps.map((step) => step.type)).toEqual(['wait', 'scroll', 'screenshot']);
  });

  it('creates a selector-free smart interaction step', () => {
    const step = createStep('smart-interaction');
    expect(step.type).toBe('smart-interaction');
    if (step.type === 'smart-interaction') {
      expect(step.value).toBe('OrbitQA QA test');
    }
  });


  it('normalizes bare domains to https before validation', () => {
    expect(normalizeTargetUrl('example.com/path')).toBe('https://example.com/path');
    expect(validateQaRunRequest({ ...validRequest(), targetUrls: ['example.com'] })).toEqual({ ok: true });
  });


  it('normalizes target lists, removes blanks and duplicates, and reports invalid line numbers', () => {
    expect(normalizeTargetUrls([' savevidly.xyz ', '', 'https://example.org', 'savevidly.xyz'])).toEqual([
      'https://savevidly.xyz',
      'https://example.org',
    ]);
    expect(() => normalizeTargetUrls(['good.example', 'http://[bad'])).toThrow(/line 2/i);
    expect(() => normalizeTargetUrls(Array.from({ length: 21 }, (_, index) => `site${index}.example`))).toThrow(/20/i);
  });

  it('validates shared browser session duration', () => {
    expect(validateQaRunRequest({ ...validRequest(), sessionDurationSeconds: 5 })).toEqual({ ok: true });
    expect(validateQaRunRequest({ ...validRequest(), sessionDurationSeconds: 600 })).toEqual({ ok: true });
    expect(validateQaRunRequest({ ...validRequest(), sessionDurationSeconds: 4 })).toEqual({ ok: false, error: 'Browser session duration must be between 5 and 600 seconds' });
    expect(validateQaRunRequest({ ...validRequest(), sessionDurationSeconds: 601 })).toEqual({ ok: false, error: 'Browser session duration must be between 5 and 600 seconds' });
  });

  it('accepts a valid request', () => {
    expect(validateQaRunRequest(validRequest())).toEqual({ ok: true });
  });

  it('rejects non-http target URLs', () => {
    const request = { ...validRequest(), targetUrls: ['file:///C:/Windows/System32'] };
    expect(validateQaRunRequest(request)).toEqual({
      ok: false,
      error: 'Target URL must start with http:// or https://',
    });
  });

  it('accepts large positive session and concurrency requests without arbitrary caps', () => {
    expect(validateQaRunRequest({ ...validRequest(), sessions: 5000, concurrency: 250 })).toEqual({ ok: true });
  });

  it('rejects non-positive session and concurrency values', () => {
    expect(validateQaRunRequest({ ...validRequest(), sessions: 0 })).toEqual({ ok: false, error: 'Sessions must be a positive integer' });
    expect(validateQaRunRequest({ ...validRequest(), concurrency: 0 })).toEqual({ ok: false, error: 'Concurrency must be a positive integer' });
  });
});

it('requires an Android AVD name and enforces one lightweight session', () => {
  const missingDevice: QaRunRequest = {
    ...validRequest(),
    deviceMode: 'android',
    deviceName: '',
    browser: 'chromium',
    sessions: 1,
    concurrency: 1,
  };
  expect(validateQaRunRequest(missingDevice)).toEqual({ ok: false, error: 'Choose an Android virtual device' });

  const tooMany: QaRunRequest = { ...missingDevice, deviceName: 'Pixel_9_API_36', sessions: 2 };
  expect(validateQaRunRequest(tooMany)).toEqual({ ok: false, error: 'Android virtual device runs are limited to 1 session' });
});

it('requires WebKit and a supported profile for iOS Browser QA', () => {
  const wrongBrowser: QaRunRequest = {
    ...validRequest(),
    deviceMode: 'ios-emulation',
    deviceName: 'iPhone 13',
    browser: 'chromium',
  };
  expect(validateQaRunRequest(wrongBrowser)).toEqual({ ok: false, error: 'Local iOS Compatibility uses WebKit' });

  const unknownProfile: QaRunRequest = { ...wrongBrowser, browser: 'webkit', deviceName: 'Unknown Phone' };
  expect(validateQaRunRequest(unknownProfile)).toEqual({ ok: false, error: 'Choose a supported iPhone/iPad profile' });
});

it('limits real iOS runs to one remote device', () => {
  const request: QaRunRequest = {
    targetUrls: ['https://example.com'],
    sessionDurationSeconds: 60,
    deviceMode: 'real-ios',
    browser: 'webkit',
    sessions: 2,
    concurrency: 1,
    headless: false,
    steps: [],
    realIos: { device: 'iPhone 15', iosVersion: '17', browser: 'safari' },
  };
  expect(validateQaRunRequest(request)).toEqual({
    ok: false,
    error: 'Real iOS Device runs use exactly 1 session and concurrency 1',
  });
});

it('accepts strict privacy defaults and rejects invalid proxy settings', () => {
  const base = validRequest();
  expect(validateQaRunRequest(base)).toEqual({ ok: true });

  expect(validateQaRunRequest({
    ...base,
    privacy: {
      strictMode: true,
      proxy: {
        enabled: true,
        server: 'ftp://proxy.test:21',
        username: '',
        password: '',
        requireVerifiedRoute: true,
        routeCheckUrl: 'https://api64.ipify.org?format=json',
      },
    },
  })).toEqual({ ok: false, error: 'Proxy server must use http://, https://, or socks5://' });
});

it('accepts rotating/static pools on desktop without renderer proxy secrets', () => {
  const base = validRequest();
  expect(validateQaRunRequest({ ...base, proxySource: 'rotating' })).toEqual({ ok: true });
  expect(validateQaRunRequest({ ...base, proxySource: 'static' })).toEqual({ ok: true });
});

it('rejects proxy pools for Android and Real iOS', () => {
  const android: QaRunRequest = {
    ...validRequest(),
    deviceMode: 'android',
    deviceName: 'Pixel_9_API_36',
    sessions: 1,
    concurrency: 1,
    proxySource: 'rotating',
  };
  expect(validateQaRunRequest(android)).toEqual({
    ok: false,
    error: 'Proxy pools are not available for Android AVD runs in v0.6',
  });

  const realIos: QaRunRequest = {
    ...validRequest(),
    deviceMode: 'real-ios',
    browser: 'webkit',
    sessions: 1,
    concurrency: 1,
    realIos: { device: 'iPhone 15', iosVersion: '17', browser: 'safari' },
    proxySource: 'static',
  };
  expect(validateQaRunRequest(realIos)).toEqual({
    ok: false,
    error: 'Proxy pools are not available for Real iOS Device runs in v0.6',
  });
});
