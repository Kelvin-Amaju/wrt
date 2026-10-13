import { describe, expect, it } from 'vitest';
import { countMatrixWorkUnits, countMatrixWorkUnitsV3, createDefaultAutoQaSettings, createDefaultLaunchGroup, createDefaultQaRunV3, createDefaultTargetPlan, normalizeMatrixTargetUrl, normalizeQaRunRequestV2, normalizeQaRunRequestV3, validateQaRunRequestV2 } from './qaMatrix';
import { createDefaultPrivacySettings } from './privacy';

describe('QA matrix domain', () => {
  it('normalizes one link with independent desktop and mobile groups', () => {
    const request = normalizeQaRunRequestV2({
      targets: [{ id: 'target-1', targetUrl: 'savevidly.xyz', groups: [
        { ...createDefaultLaunchGroup('desktop'), id: 'desktop', instances: 5, proxySource: 'rotating' },
        { ...createDefaultLaunchGroup('android-emulation'), id: 'mobile', instances: 6, sessionDurationSeconds: 50, proxySource: 'rotating' },
        { ...createDefaultLaunchGroup('ios-emulation'), id: 'iphone', instances: 3, sessionDurationSeconds: 40, proxySource: 'rotating' },
      ] }],
      concurrency: 3,
      headless: false,
      steps: [],
      privacy: createDefaultPrivacySettings(),
    });
    expect(request.targets[0].targetUrl).toBe('https://savevidly.xyz');
    expect(request.targets[0].groups.map((group) => group.instances)).toEqual([5, 6, 3]);
    expect(request.interactionIndicator).toBe(true);
  });

  it('keeps each target group configuration independent', () => {
    const base = createDefaultPrivacySettings();
    const request = normalizeQaRunRequestV2({
      targets: [
        { id: 'a', targetUrl: 'a.example', groups: [{ ...createDefaultLaunchGroup('desktop'), id: 'a1', browser: 'firefox', sessionDurationSeconds: 20, proxySource: 'rotating' }] },
        { id: 'b', targetUrl: 'b.example', groups: [{ ...createDefaultLaunchGroup('ios-emulation'), id: 'b1', browser: 'safari-ios', sessionDurationSeconds: 55, proxySource: 'static' }] },
      ],
      concurrency: 2, headless: false, steps: [], privacy: base,
    });
    expect(request.targets[0].groups[0].sessionDurationSeconds).toBe(20);
    expect(request.targets[1].groups[0].sessionDurationSeconds).toBe(55);
    expect(request.targets[0].groups[0].proxySource).toBe('rotating');
    expect(request.targets[1].groups[0].proxySource).toBe('static');
  });

  it('preserves the established unsupported-protocol error', () => {
    expect(() => normalizeMatrixTargetUrl('file:///tmp/a')).toThrow('Target URL must start with http:// or https://');
  });

  it('accepts large work-unit counts while still rejecting unsupported combinations', () => {
    const target = createDefaultTargetPlan('example.com');
    target.groups = [{ ...createDefaultLaunchGroup('desktop'), id: 'g1', instances: 50000 }];
    expect(validateQaRunRequestV2({ targets: [target], concurrency: 17, headless: false, steps: [], privacy: createDefaultPrivacySettings(), interactionIndicator: true })).toEqual({ ok: true });
    expect(countMatrixWorkUnits([target])).toBe(50000);
    const android = createDefaultTargetPlan('example.com');
    android.groups = [{ ...createDefaultLaunchGroup('android-emulation'), browser: 'firefox' as never }];
    expect(validateQaRunRequestV2({ targets: [android], concurrency: 1, headless: false, steps: [], privacy: createDefaultPrivacySettings() })).toEqual({ ok: false, error: 'Target 1, group 1: Android mobile emulation uses Chrome Android' });
  });


  it('normalizes legacy numeric and new auto/manual concurrency settings without an upper product cap', () => {
    const base = { targets: [createDefaultTargetPlan('example.com')], headless: false, steps: [], privacy: createDefaultPrivacySettings() };
    expect(normalizeQaRunRequestV2({ ...base, concurrency: 17 }).concurrency).toEqual({ mode: 'manual', value: 17 });
    expect(normalizeQaRunRequestV2({ ...base, concurrency: { mode: 'auto' } }).concurrency).toEqual({ mode: 'auto' });
    expect(normalizeQaRunRequestV2({ ...base, concurrency: { mode: 'manual', value: 250 } }).concurrency).toEqual({ mode: 'manual', value: 250 });
  });


  it('defaults empty-script runs to Auto QA and validates custom simulated referrers', () => {
    const base = { targets: [createDefaultTargetPlan('example.com')], concurrency: 1, headless: false, steps: [], privacy: createDefaultPrivacySettings() };
    expect(normalizeQaRunRequestV2(base).autoQa).toEqual(createDefaultAutoQaSettings());
    expect(() => normalizeQaRunRequestV2({ ...base, autoQa: { ...createDefaultAutoQaSettings(), referrerMode: 'custom-simulated', customReferrer: 'http://referrer.example/' } })).toThrow('https://');
    expect(normalizeQaRunRequestV2({ ...base, autoQa: { ...createDefaultAutoQaSettings(), referrerMode: 'google-simulated' } }).autoQa.referrerMode).toBe('google-simulated');
  });


  it('normalizes one URL pool with multiple device families and general proxy inheritance', () => {
    const base = createDefaultQaRunV3();
    const request = normalizeQaRunRequestV3({
      ...base,
      urlPoolText: 'a.example\nb.example',
      proxyMode: 'general',
      generalProxy: { source: 'rotating', allowSlowProxies: true },
      devices: {
        ...base.devices,
        desktop: { ...base.devices.desktop, enabled: true, browsers: ['chromium', 'firefox'], instancesPerBrowser: 2, sessionDurationSeconds: 60 },
        androidEmulation: { ...base.devices.androidEmulation, enabled: true, profiles: ['Pixel 7'], instancesPerProfile: 3, sessionDurationSeconds: 90 },
      },
      concurrency: { mode: 'auto' },
      privacy: createDefaultPrivacySettings(),
    });
    expect(request.urlPool).toEqual(['https://a.example/', 'https://b.example/']);
    expect(countMatrixWorkUnitsV3(request.devices)).toBe(7);
    expect(request.generalProxy.source).toBe('rotating');
  });

  it('supports large v3 matrices, per-device proxy policy, and multiple compatibility profiles without product caps', () => {
    const base = createDefaultQaRunV3();
    const request = normalizeQaRunRequestV3({
      ...base,
      urlPoolText: 'example.com',
      proxyMode: 'per-device',
      devices: {
        ...base.devices,
        desktop: { ...base.devices.desktop, enabled: true, browsers: ['chromium', 'webkit'], instancesPerBrowser: 25000, proxy: { source: 'static', allowSlowProxies: false } },
        iosEmulation: { ...base.devices.iosEmulation, enabled: true, browsers: ['safari-ios', 'chrome-ios'], profiles: ['iPhone 13', 'iPad Mini'], instancesPerProfile: 2, sessionDurationSeconds: 75, proxy: { source: 'rotating', allowSlowProxies: true } },
      },
      concurrency: { mode: 'manual', value: 250 },
      privacy: createDefaultPrivacySettings(),
    });
    expect(countMatrixWorkUnitsV3(request.devices)).toBe(50008);
    expect(request.devices.desktop.proxy.source).toBe('static');
    expect(request.devices.iosEmulation.proxy.source).toBe('rotating');
    expect(request.concurrency).toEqual({ mode: 'manual', value: 250 });
  });

  it('disables interaction indicator in headless mode', () => {
    const request = normalizeQaRunRequestV2({ targets: [createDefaultTargetPlan('example.com')], concurrency: 1, headless: true, interactionIndicator: true, steps: [], privacy: createDefaultPrivacySettings() });
    expect(request.interactionIndicator).toBe(false);
  });
  it('defaults new desktop, Android emulation, and iPhone/iPad Chrome emulation to installed Chrome', () => {
    const request = createDefaultQaRunV3();
    expect(request.devices.desktop.browsers).toContain('chrome-installed' as never);
    expect(request.devices.androidEmulation.browserRuntime).toBe('chrome-installed');
    expect(request.devices.iosEmulation.browsers).toContain('chrome-installed' as never);
  });

  it('keeps existing runtime behavior by default and makes browser consistency an explicit option', () => {
    const base = createDefaultQaRunV3();
    const common = {
      ...base,
      urlPoolText: 'example.com',
      devices: {
        ...base.devices,
        desktop: { ...base.devices.desktop, browsers: ['chromium'] as typeof base.devices.desktop.browsers },
        androidEmulation: { ...base.devices.androidEmulation, browserRuntime: undefined as never },
        iosEmulation: { ...base.devices.iosEmulation, enabled: true, browsers: ['safari-ios'] as typeof base.devices.iosEmulation.browsers },
      },
      privacy: createDefaultPrivacySettings(),
    };
    const legacy = normalizeQaRunRequestV3(common);
    const hardened = normalizeQaRunRequestV3({ ...common, browserRuntimeConsistency: true });
    expect(legacy.browserRuntimeConsistency).toBe(false);
    expect(legacy.devices.androidEmulation.browserRuntime).toBe('chromium-playwright');
    expect(hardened.browserRuntimeConsistency).toBe(true);
    expect(hardened.devices.androidEmulation.browserRuntime).toBe('chrome-installed');
    expect(hardened.devices.desktop.browsers).toContain('chromium');
    expect(hardened.devices.iosEmulation.browsers).toContain('safari-ios');
  });

  it('keeps Android AVD and Real iOS on their real runtime families', () => {
    const base = createDefaultQaRunV3();
    const normalized = normalizeQaRunRequestV3({
      ...base,
      urlPoolText: 'example.com',
      devices: {
        ...base.devices,
        androidAvd: { ...base.devices.androidAvd, enabled: true, avdNames: ['Pixel_7_API_35'] },
        realIos: { ...base.devices.realIos, enabled: true, selections: [{ device: 'iPhone 15', iosVersion: '17', browser: 'safari' }] },
      },
      privacy: createDefaultPrivacySettings(),
    });
    expect(normalized.devices.androidAvd.browserRuntime).toBe('android-chrome');
    expect(normalized.devices.realIos.browserRuntime).toBe('real-ios-provider');
  });

});
