function text(value) {
  return value == null ? '' : String(value);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildDeviceExpectation(settings = {}, contextOptions = {}) {
  const mode = settings.deviceMode || 'desktop';
  const profile = settings.deviceName || (mode === 'desktop' ? (settings.browser || 'Desktop browser') : mode);
  const family = mode === 'android' || mode === 'android-emulation'
    ? 'android'
    : mode === 'ios-emulation'
      ? (String(settings.deviceName || '').startsWith('iPad') ? 'ipad' : 'iphone')
      : mode === 'real-ios'
        ? 'real-ios'
        : 'desktop';

  return {
    mode,
    profile,
    family,
    browser: settings.browser || '',
    iosBrowser: settings.iosBrowser || '',
    locale: settings.locale || contextOptions.locale || '',
    timezoneId: settings.timezoneId || contextOptions.timezoneId || '',
    viewport: contextOptions.viewport || null,
    screen: contextOptions.screen || null,
    deviceScaleFactor: finiteNumber(contextOptions.deviceScaleFactor),
    hasTouch: typeof contextOptions.hasTouch === 'boolean' ? contextOptions.hasTouch : (family === 'android' || family === 'iphone' || family === 'ipad'),
    userAgent: contextOptions.userAgent || '',
    // True when an AVD device-hardening profile is driving this work unit.
    // Used only to phrase the automation-observability finding accurately.
    hardened: settings.deviceHardened === true || contextOptions.deviceHardened === true,
  };
}

function buildRuntimeFidelity(expected = {}) {
  const mode = expected.mode || 'desktop';
  if (mode === 'android') {
    if (expected.hardened) {
      return {
        level: 'hardened-android-runtime',
        label: 'Hardened Android runtime',
        description: 'Chrome runs inside an ADB-connected Android virtual device that reports retail build identity.',
        limitations: ['Kernel-level emulator props (ro.kernel.qemu, goldfish/ranchu) remain visible to native apps.', 'Play Integrity STRONG is never satisfied on an emulator.'],
      };
    }
    return {
      level: 'native-android-runtime',
      label: 'Native Android runtime',
      description: 'Chrome runs inside an ADB-connected Android virtual device.',
      limitations: ['Automation remains observable when the browser runtime reports it.'],
    };
  }
  if (mode === 'real-ios') {
    return {
      level: 'real-ios-provider',
      label: 'Real iOS provider',
      description: 'Browser runs on a provider-backed iPhone or iPad runtime.',
      limitations: ['Provider capabilities and automation signals are reported as observed.'],
    };
  }
  if (mode === 'android-emulation' || mode === 'ios-emulation') {
    return {
      level: 'compatibility-emulation',
      label: 'Compatibility emulation',
      description: 'Mobile viewport, touch, DPR, and browser identity run inside a host browser runtime.',
      limitations: ['Host platform values can remain visible.', 'Automation observability is reported rather than hidden.'],
    };
  }
  return {
    level: 'desktop-automation',
    label: 'Desktop automation runtime',
    description: 'Desktop browser identity and hardware exposure remain browser-native.',
    limitations: ['Automation observability is reported rather than hidden.'],
  };
}

async function collectRuntimeIdentity(page) {
  if (!page || typeof page.evaluate !== 'function') {
    throw new Error('Device identity diagnostics require a page context');
  }
  const configuredViewport = typeof page.viewportSize === 'function' ? page.viewportSize() : null;
  const runtime = await page.evaluate(() => {
    const stableHash = (input) => {
      let hash = 2166136261;
      const value = String(input || '');
      for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16).padStart(8, '0');
    };
    let canvas = { supported:false, signature:'', error:'' };
    try {
      const el = document.createElement('canvas');
      el.width = 240; el.height = 80;
      const ctx = el.getContext('2d');
      if (ctx) {
        ctx.textBaseline = 'top';
        ctx.font = '16px Arial';
        ctx.fillStyle = '#f60'; ctx.fillRect(10, 10, 60, 24);
        ctx.fillStyle = '#069'; ctx.fillText('OrbitQA native canvas', 14, 14);
        ctx.strokeStyle = 'rgba(90,140,200,0.8)'; ctx.strokeRect(7, 7, 180, 38);
        canvas = { supported:true, signature:stableHash(el.toDataURL()), error:'' };
      }
    } catch (error) { canvas = { supported:false, signature:'', error:String(error?.message || error || '') }; }
    let webgl = { supported:false, version:'', vendor:'', renderer:'', signature:'', extensionsHash:'', error:'' };
    try {
      const el = document.createElement('canvas');
      const gl = el.getContext('webgl2') || el.getContext('webgl') || el.getContext('experimental-webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '') : String(gl.getParameter(gl.VENDOR) || '');
        const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : String(gl.getParameter(gl.RENDERER) || '');
        const version = String(gl.getParameter(gl.VERSION) || '');
        const extensions = (gl.getSupportedExtensions() || []).slice().sort();
        const limits = [
          gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
          gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
          gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS), gl.getParameter(gl.DEPTH_BITS),
          gl.getParameter(gl.STENCIL_BITS), gl.getParameter(gl.RED_BITS), gl.getParameter(gl.GREEN_BITS), gl.getParameter(gl.BLUE_BITS), gl.getParameter(gl.ALPHA_BITS),
        ];
        const extensionsHash = stableHash(extensions.join('|'));
        const signature = stableHash([version, vendor, renderer, extensionsHash, ...limits].join('|'));
        webgl = { supported:true, version, vendor, renderer, signature, extensionsHash, error:'' };
      }
    } catch (error) { webgl = { supported:false, version:'', vendor:'', renderer:'', signature:'', extensionsHash:'', error:String(error?.message || error || '') }; }
    const orientation = screen?.orientation?.type || (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait');
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: { width: window.screen?.width || 0, height: window.screen?.height || 0, availWidth:window.screen?.availWidth || 0, availHeight:window.screen?.availHeight || 0, colorDepth:window.screen?.colorDepth || 0 },
      orientation,
      devicePixelRatio: window.devicePixelRatio,
      locale: navigator.language,
      languages: Array.isArray(navigator.languages) ? [...navigator.languages] : [navigator.language].filter(Boolean),
      timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
      webdriver: typeof navigator.webdriver === 'boolean' ? navigator.webdriver : null,
      hardwareConcurrency: Number.isFinite(navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : null,
      deviceMemory: Number.isFinite(navigator.deviceMemory) ? navigator.deviceMemory : null,
      canvas,
      webgl,
    };
  });
  return { ...runtime, configuredViewport };
}

function makeCheck(key, label, status, required, expected, observed, detail = '', classification = '') {
  const inferredClassification = classification || (required && status === 'fail' ? 'blocking' : status === 'warning' ? 'warning' : 'consistent');
  return {
    key,
    label,
    status,
    classification: inferredClassification,
    required,
    expected: text(expected),
    observed: text(observed),
    detail,
  };
}

function viewportStatus(expected, observed, required) {
  if (!expected || !observed) return { status: 'not-applicable', required: false };
  const widthDiff = Math.abs(Number(observed.width) - Number(expected.width));
  const heightDiff = Math.abs(Number(observed.height) - Number(expected.height));
  if (widthDiff <= 2 && heightDiff <= 2) return { status: 'pass', required };
  const gross = widthDiff > Math.max(120, Number(expected.width) * 0.25)
    || heightDiff > Math.max(160, Number(expected.height) * 0.25);
  return { status: required && gross ? 'fail' : 'warning', required: required && gross };
}

function dprStatus(expected, observed, required) {
  if (expected == null || observed == null) return { status: 'not-applicable', required: false };
  const diff = Math.abs(Number(expected) - Number(observed));
  if (diff <= 0.05) return { status: 'pass', required };
  return { status: required && diff >= 0.75 ? 'fail' : 'warning', required: required && diff >= 0.75 };
}

function assessDeviceConsistency(expected, observed = {}, functional = {}) {
  const checks = [];
  const mobileAndroid = expected.family === 'android';
  const localIos = expected.family === 'iphone' || expected.family === 'ipad';
  const desktop = expected.family === 'desktop';
  const hardened = expected.hardened === true;
  const ua = text(observed.userAgent);
  const platform = text(observed.platform);

  if (mobileAndroid) {
    checks.push(makeCheck(
      'user-agent',
      'Android browser identity',
      /Android/i.test(ua) ? 'pass' : 'fail',
      true,
      'Android mobile browser identity',
      ua || 'Unavailable',
      hardened
        ? 'Critical Android identity check. Device hardening rewrites the device token to retail hardware while preserving the live Chrome version.'
        : 'Critical Android identity check. OrbitQA does not hide automation markers or forge unrelated hardware APIs.',
    ));
  } else if (localIos) {
    const wantsChrome = expected.iosBrowser === 'chrome-ios';
    const familyToken = expected.family === 'ipad' ? /iPad/i : /iPhone/i;
    const browserToken = wantsChrome ? /CriOS\//i : /Safari\//i;
    const matches = familyToken.test(ua) && browserToken.test(ua);
    checks.push(makeCheck(
      'user-agent',
      'iOS compatibility browser identity',
      matches ? 'pass' : 'fail',
      true,
      wantsChrome ? 'iPhone/iPad + CriOS token' : 'iPhone/iPad + Safari token',
      ua || 'Unavailable',
      'Local iOS Compatibility verifies the browser identity it requested; it does not claim to be physical iPhone hardware.',
    ));
  } else {
    const mobileOnly = /(Android|iPhone|iPad|Mobile)/i.test(ua);
    checks.push(makeCheck(
      'user-agent',
      'Desktop browser identity',
      mobileOnly ? 'warning' : 'pass',
      false,
      'Browser-native desktop identity',
      ua || 'Unavailable',
      'Desktop identity is browser-native; OrbitQA does not fabricate a hardware fingerprint.',
    ));
  }

  if (mobileAndroid) {
    checks.push(makeCheck(
      'platform',
      'Android platform consistency',
      /(Linux|Android)/i.test(platform) ? 'pass' : 'warning',
      false,
      'Linux/Android-like platform',
      platform || 'Unavailable',
      hardened
        ? 'Platform is patched to the retail Linux/ARM token by device hardening.'
        : 'Platform is observed and reported; OrbitQA does not patch navigator.platform.',
      !/(Linux|Android)/i.test(platform) && expected.mode === 'android-emulation' ? 'expected-limitation' : '',
    ));
  } else if (localIos) {
    const token = expected.family === 'ipad' ? 'iPad' : 'iPhone';
    checks.push(makeCheck(
      'platform',
      'Navigator platform',
      new RegExp(token, 'i').test(platform) ? 'pass' : 'warning',
      false,
      token,
      platform || 'Unavailable',
      'Local iOS Compatibility can expose host-platform limitations; this is reported as a compatibility warning instead of spoofed.',
      !new RegExp(token, 'i').test(platform) ? 'expected-limitation' : '',
    ));
  } else {
    checks.push(makeCheck('platform', 'Navigator platform', 'pass', false, 'Browser-native', platform || 'Unavailable', 'Observed desktop platform.'));
  }

  if (mobileAndroid) {
    const touchPass = Number(observed.maxTouchPoints) > 0;
    checks.push(makeCheck(
      'touch',
      'Touch capability',
      touchPass ? 'pass' : 'fail',
      true,
      'Touch enabled',
      `${Number(observed.maxTouchPoints) || 0} touch point(s)`,
      'Android mobile QA requires a touch-capable context.',
    ));
  } else if (localIos) {
    const touchPass = Number(observed.maxTouchPoints) > 0;
    checks.push(makeCheck(
      'touch',
      'Touch capability',
      touchPass ? 'pass' : 'warning',
      false,
      'Touch enabled',
      `${Number(observed.maxTouchPoints) || 0} touch point(s)`,
      touchPass
        ? 'Local iOS Compatibility reports the touch capability exposed by the host WebKit runtime.'
        : 'Local iOS Compatibility can expose host WebKit touch limitations; this is reported as a compatibility warning instead of blocking the work unit.',
      touchPass ? '' : 'expected-limitation',
    ));
  } else {
    checks.push(makeCheck('touch', 'Touch capability', 'pass', false, 'Browser-native', `${Number(observed.maxTouchPoints) || 0} touch point(s)`, 'Desktop touch hardware is not forced either way.'));
  }

  const browserViewport = mobileAndroid && observed.configuredViewport ? observed.configuredViewport : observed.viewport;
  const viewportAssessment = viewportStatus(expected.viewport, browserViewport, mobileAndroid);
  checks.push(makeCheck(
    'viewport',
    'Viewport consistency',
    viewportAssessment.status,
    viewportAssessment.required,
    expected.viewport ? `${expected.viewport.width}×${expected.viewport.height}` : 'Browser-native',
    browserViewport ? `${browserViewport.width}×${browserViewport.height}` : 'Unavailable',
    mobileAndroid && observed.configuredViewport
      ? 'Browser-context viewport configured by OrbitQA. A website without a mobile viewport meta tag may expose a different page layout viewport without changing the selected device profile.'
      : localIos ? 'Local iOS viewport compatibility check.' : 'CSS viewport exposed to the page.',
  ));

  if (mobileAndroid && observed.configuredViewport && observed.viewport) {
    const layoutDiffers = Math.abs(Number(observed.viewport.width) - Number(observed.configuredViewport.width)) > 2
      || Math.abs(Number(observed.viewport.height) - Number(observed.configuredViewport.height)) > 2;
    if (layoutDiffers) {
      checks.push(makeCheck(
        'page-layout-viewport',
        'Page layout viewport',
        'warning',
        false,
        `${observed.configuredViewport.width}×${observed.configuredViewport.height} browser viewport`,
        `${observed.viewport.width}×${observed.viewport.height} page layout`,
        'The target page changed its mobile layout viewport (commonly because its viewport meta tag is absent or different). This is site behavior, not a device-profile mismatch, so it does not block the work unit.',
        'site-layout',
      ));
    }
  }

  const screenAssessment = viewportStatus(expected.screen, observed.screen, false);
  checks.push(makeCheck(
    'screen',
    'Screen geometry',
    screenAssessment.status,
    false,
    expected.screen ? `${expected.screen.width}×${expected.screen.height}` : 'Browser/runtime native',
    observed.screen ? `${observed.screen.width}×${observed.screen.height}` : 'Unavailable',
    'Screen dimensions exposed to the page are observed for consistency and are never fabricated.',
  ));

  const dprAssessment = dprStatus(expected.deviceScaleFactor, observed.devicePixelRatio, mobileAndroid);
  checks.push(makeCheck(
    'dpr',
    'Device pixel ratio',
    dprAssessment.status,
    dprAssessment.required,
    expected.deviceScaleFactor == null ? 'Browser-native' : expected.deviceScaleFactor,
    observed.devicePixelRatio == null ? 'Unavailable' : observed.devicePixelRatio,
    'Display scale exposed to the page.',
  ));

  const localeExpected = expected.locale || '';
  checks.push(makeCheck(
    'locale',
    'Locale consistency',
    !localeExpected || observed.locale === localeExpected ? 'pass' : 'warning',
    false,
    localeExpected || 'Browser-native',
    observed.locale || 'Unavailable',
    'Navigator language consistency check.',
  ));

  const timezoneExpected = expected.timezoneId || '';
  checks.push(makeCheck(
    'timezone',
    'Timezone consistency',
    !timezoneExpected || observed.timezoneId === timezoneExpected ? 'pass' : 'warning',
    false,
    timezoneExpected || 'Browser-native',
    observed.timezoneId || 'Unavailable',
    'Intl timezone consistency check.',
  ));

  const hardwareObserved = [];
  if (observed.hardwareConcurrency != null) hardwareObserved.push(`${observed.hardwareConcurrency} logical processors`);
  if (observed.deviceMemory != null) hardwareObserved.push(`${observed.deviceMemory} GiB memory`);
  checks.push(makeCheck(
    'hardware',
    'Runtime hardware exposure',
    hardwareObserved.length > 0 ? 'pass' : 'not-applicable',
    false,
    hardened ? 'Retail hardware profile' : 'Browser/runtime native',
    hardwareObserved.length > 0 ? hardwareObserved.join(' · ') : 'Unavailable',
    hardened
      ? 'Device hardening pins CPU/memory to the retail profile instead of exposing host values.'
      : 'Observed only. OrbitQA does not invent CPU, memory, GPU, sensor, or other hardware values.',
  ));

  const canvasSupported = observed.canvas?.supported === true;
  checks.push(makeCheck(
    'canvas-native',
    'Canvas native stability baseline',
    canvasSupported && observed.canvas?.signature ? 'pass' : 'not-applicable',
    false,
    'Browser-native and stable within the worker environment',
    canvasSupported ? `native signature ${observed.canvas.signature}` : 'Unavailable',
    'OrbitQA measures the native Canvas result for stability diagnostics. It does not add random Canvas noise or forge a device GPU.',
  ));

  const webglSupported = observed.webgl?.supported === true;
  checks.push(makeCheck(
    'webgl-native',
    'WebGL native stability baseline',
    webglSupported && observed.webgl?.signature ? 'pass' : 'not-applicable',
    false,
    hardened ? 'Retail GPU vendor and renderer' : 'Browser/GPU native and stable within the worker environment',
    webglSupported ? `${observed.webgl.vendor || 'vendor unavailable'} · ${observed.webgl.renderer || 'renderer unavailable'} · ${observed.webgl.signature}` : 'Unavailable',
    hardened
      ? 'Device hardening rewrites only the WebGL vendor/renderer strings. Extensions, limits and the canvas result stay runtime-native and byte-stable.'
      : 'OrbitQA reports the browser/GPU-native WebGL environment and does not independently spoof vendor, renderer, extensions, or GPU limits.',
  ));

  const webdriver = observed.webdriver;
  checks.push(makeCheck(
    'webdriver',
    'Automation observability',
    webdriver === true ? 'warning' : webdriver === false ? 'pass' : 'not-applicable',
    false,
    hardened ? 'Hidden by device hardening' : 'Reported truthfully',
    webdriver == null ? 'Unavailable' : String(webdriver),
    hardened
      ? 'Device hardening launches Chromium with --disable-blink-features=AutomationControlled, so navigator.webdriver reports false. ChromeDriver cdc_* globals are deleted and window.chrome.* stubs are restored.'
      : 'Diagnostic only. OrbitQA reports navigator.webdriver and does not modify or hide it.',
    webdriver === true ? 'expected-limitation' : '',
  ));

  if (localIos) {
    checks.push(makeCheck(
      'ios-functional-tap',
      'iOS functional tap',
      functional.iosTap === true ? 'pass' : functional.iosTap === false ? 'warning' : 'not-applicable',
      false,
      'Tap interaction succeeds',
      functional.iosTap === true ? 'Functional' : functional.iosTap === false ? 'Failed' : 'Not measured',
      functional.iosTap === false
        ? 'Local iOS Compatibility could not complete the active tap probe in the host WebKit runtime. This is reported as a compatibility limitation and does not block the work unit.'
        : 'Active functional verification uses the same browser tap path as mobile QA without changing site controls.',
      functional.iosTap === false ? 'expected-limitation' : '',
    ));
  }

  const runtimeKeys = new Set(['platform', 'hardware', 'webdriver', 'page-layout-viewport', 'canvas-native', 'webgl-native']);
  if (localIos || desktop) runtimeKeys.add('touch');
  const profileChecks = [];
  const runtimeFacts = [];
  for (const check of checks) {
    if (runtimeKeys.has(check.key)) {
      const siteLayout = check.key === 'page-layout-viewport';
      runtimeFacts.push({
        ...check,
        status: 'not-applicable',
        required: false,
        classification: siteLayout ? 'site-layout' : 'host-runtime',
        expected: siteLayout ? check.expected : 'Host/runtime information',
      });
    } else {
      profileChecks.push(check);
    }
  }

  const blocking = profileChecks.filter((check) => check.required && check.status === 'fail');
  const blocked = blocking.length > 0;
  const actionableFailure = profileChecks.some((check) => check.status === 'fail');
  const actionableWarning = profileChecks.some((check) => check.status === 'warning');
  const profileConsistency = blocked || actionableFailure
    ? 'fail'
    : actionableWarning
      ? 'warning'
      : 'pass';

  return {
    overall: profileConsistency,
    profileConsistency,
    blocked,
    fidelity: buildRuntimeFidelity(expected),
    blockingReasons: blocking.map((check) => check.label),
    mode: expected.mode,
    profile: expected.profile,
    hardened,
    profileChecks,
    runtimeFacts,
    functionalCompatibility: {
      iosTap: localIos ? (functional.iosTap === true ? 'pass' : functional.iosTap === false ? 'fail' : 'not-applicable') : 'not-applicable',
      mobileInteraction: mobileAndroid ? (Number(observed.maxTouchPoints) > 0 ? 'pass' : 'fail') : localIos ? (functional.iosTap === true ? 'pass' : functional.iosTap === false ? 'fail' : 'not-applicable') : 'not-applicable',
    },
    checks: [...profileChecks, ...runtimeFacts],
    observed,
  };
}

function compareGraphicsStability(baseline = {}, current = {}) {
  const compare = (key) => {
    const before = baseline?.[key];
    const after = current?.[key];
    if (!before?.supported || !after?.supported || !before?.signature || !after?.signature) {
      return { key, status:'not-applicable', stable:null, before:before?.signature || '', after:after?.signature || '' };
    }
    const stable = before.signature === after.signature;
    return { key, status:stable ? 'pass' : 'warning', stable, before:before.signature, after:after.signature };
  };
  const canvas = compare('canvas');
  const webgl = compare('webgl');
  return { overall:[canvas,webgl].some((item) => item.status === 'warning') ? 'warning' : 'pass', canvas, webgl };
}

async function verifyFunctionalTap(page) {
  if (!page || typeof page.evaluate !== 'function' || typeof page.locator !== 'function') return null;
  const probeId = `orbitqa-tap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.evaluate((id) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('data-orbitqa-tap-probe', id);
    button.style.cssText = 'position:fixed;left:1px;top:1px;width:4px;height:4px;opacity:0.001;z-index:2147483647;padding:0;border:0;';
    button.addEventListener('click', () => button.setAttribute('data-orbitqa-activated', '1'));
    document.documentElement.appendChild(button);
  }, probeId);
  try {
    const locator = page.locator(`[data-orbitqa-tap-probe="${probeId}"]`);
    if (!locator || typeof locator.tap !== 'function') return null;
    await locator.tap({ timeout: 3000 });
    return await page.evaluate((id) => {
      const button = document.querySelector(`[data-orbitqa-tap-probe="${id}"]`);
      return button?.getAttribute('data-orbitqa-activated') === '1';
    }, probeId);
  } catch {
    return false;
  } finally {
    await page.evaluate((id) => document.querySelector(`[data-orbitqa-tap-probe="${id}"]`)?.remove(), probeId).catch(() => undefined);
  }
}

module.exports = {
  buildDeviceExpectation,
  buildRuntimeFidelity,
  collectRuntimeIdentity,
  assessDeviceConsistency,
  compareGraphicsStability,
  verifyFunctionalTap,
};