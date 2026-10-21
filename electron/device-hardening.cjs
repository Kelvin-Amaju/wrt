'use strict';

/**
 * device-hardening.cjs - OrbitQA Desktop
 *
 * Makes a hardened AVD report as retail hardware to browser-layer bot /
 * fingerprint gates. Three gates:
 *   1. automation-flag      navigator.webdriver, window.chrome.*, cdc_* globals
 *   2. runtime-fingerprint  WebGL vendor+renderer, hardwareConcurrency,
 *                           deviceMemory, maxTouchPoints, platform
 *   3. device-identity      UA device token, UA-CH model/platformVersion,
 *                           retail build props
 *
 * Deterministic: values come from the profile, never randomised per load.
 */

const DEFAULT_REAL_DEVICE_AVD = 'OrbitQA_Pixel_7_Real';
const HARDENING_EVENT = 'device-hardening:diagnostics';

const HARDENING_CHECKS = Object.freeze([
  'automation-flag',
  'runtime-fingerprint',
  'device-identity'
]);

const REAL_DEVICE_PROFILES = Object.freeze({
  'pixel-7-panther': Object.freeze({
    id: 'pixel-7-panther',
    avdNames: [DEFAULT_REAL_DEVICE_AVD, 'OrbitQA_Pixel7', 'Pixel_7_API_34', 'Pixel_7_API_35'],
    match: ['pixel 7', 'pixel7', 'panther'],
    model: 'Pixel 7',
    brand: 'google',
    manufacturer: 'Google',
    device: 'panther',
    product: 'panther',
    androidVersion: '14',
    platformVersion: '14.0.0',
    platform: 'Linux armv8l',
    architecture: 'arm',
    bitness: '64',
    buildFingerprint: 'google/panther/panther:14/UQ1A.240205.004/11269751:user/release-keys',
    buildTags: 'release-keys',
    buildType: 'user',
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 5,
    webglVendor: 'ARM',
    webglRenderer: 'Mali-G710',
    gpu: 'host',
    screen: { width: 412, height: 915, dpr: 2.625 },
    emulator: { ramMb: 4096, heapMb: 512 }
  })
});

const UA_DEVICE_RE = /(Linux; Android [\d.]+; )([^;)]+)((?: Build\/[^;)]+)?)(\))/;

function normalise(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findRealDeviceProfile(input) {
  if (input && typeof input === 'object' && input.model) return input;
  const key = normalise(input);
  if (!key) return null;
  for (const profile of Object.values(REAL_DEVICE_PROFILES)) {
    if (profile.avdNames.some((name) => normalise(name) === key)) return profile;
    if (normalise(profile.model) === key) return profile;
    if (profile.match.some((token) => key === token || key.includes(token))) return profile;
  }
  return null;
}

function isHardenedAvd(name) {
  return Boolean(findRealDeviceProfile(name));
}

function resolveProfile(input) {
  return findRealDeviceProfile(input) || REAL_DEVICE_PROFILES['pixel-7-panther'];
}

function buildHardeningArgs(profile) {
  const p = resolveProfile(profile);
  return [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--window-size=${p.screen.width},${p.screen.height}`
  ];
}

function buildHardeningProps(profile) {
  const p = resolveProfile(profile);
  return [
    `ro.product.model=${p.model}`,
    `ro.product.brand=${p.brand}`,
    `ro.product.manufacturer=${p.manufacturer}`,
    `ro.product.device=${p.device}`,
    `ro.product.name=${p.product}`,
    `ro.build.product=${p.product}`,
    `ro.build.tags=${p.buildTags}`,
    `ro.build.type=${p.buildType}`,
    `ro.build.fingerprint=${p.buildFingerprint}`,
    `ro.system.build.fingerprint=${p.buildFingerprint}`,
    `ro.vendor.build.fingerprint=${p.buildFingerprint}`
  ];
}

function buildHardeningUserAgent(profile, baseUa) {
  const p = resolveProfile(profile);
  const ua = String(baseUa || '');
  const versionMatch = /Chrome\/(\d+)/.exec(ua);
  const chromeVersion = versionMatch ? versionMatch[1] : '120';
  if (/Android/.test(ua)) {
    return ua.replace(UA_DEVICE_RE, `$1${p.model}$3$4`);
  }
  return `Mozilla/5.0 (Linux; Android ${p.androidVersion}; ${p.model}) AppleWebKit/537.36 ` +
    `(KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Mobile Safari/537.36`;
}

/* Injected into the page. Must stay self-contained (it is serialised). */
function hardeningInit(profile) {
  const w = typeof window !== 'undefined' ? window : globalThis;
  if (!w || !w.navigator) return;
  const n = w.navigator;
  const navProto = Object.getPrototypeOf(n);

  /* ---- keep Function.prototype.toString looking native ---- */
  const nativeToString = Function.prototype.toString;
  const nativeSource = new WeakMap();
  const markNative = (fn, name, kind) => {
    try { nativeSource.set(fn, 'function ' + (kind === 'get' ? 'get ' : '') + name + '() { [native code] }'); } catch (_) {}
    return fn;
  };
  const patchedToString = function toString() {
    const source = nativeSource.get(this);
    return source || nativeToString.call(this);
  };
  markNative(patchedToString, 'toString');
  try { Function.prototype.toString = patchedToString; } catch (_) {}

  const defineGetter = (target, prop, value) => {
    if (!target) return false;
    const getter = markNative(function () { return value; }, prop, 'get');
    try {
      const existing = Object.getOwnPropertyDescriptor(target, prop);
      Object.defineProperty(target, prop, {
        get: getter,
        configurable: true,
        enumerable: existing ? existing.enumerable : true,
      });
      return true;
    } catch (_) {
      try { Object.defineProperty(n, prop, { get: getter, configurable: true }); return true; } catch (__) { return false; }
    }
  };

  /* ---- gate 1: automation flag ---- */
  defineGetter(navProto, 'webdriver', false);

  if (!w.chrome) w.chrome = {};
  const stub = (name, impl) => markNative(impl, name);
  if (!w.chrome.runtime) {
    w.chrome.runtime = {
      id: undefined,
      connect: stub('connect', function () {}),
      sendMessage: stub('sendMessage', function () {}),
      onMessage: { addListener: stub('addListener', function () {}), removeListener: stub('removeListener', function () {}) }
    };
  }
  if (!w.chrome.app) {
    w.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
    };
  }
  if (!w.chrome.csi) w.chrome.csi = stub('csi', function () { return { onloadT: 0, startE: Date.now(), pageT: 0, tran: 15 }; });
  if (!w.chrome.loadTimes) {
    w.chrome.loadTimes = stub('loadTimes', function () {
      return {
        requestTime: 0, startLoadTime: 0, commitLoadTime: 0, finishDocumentLoadTime: 0,
        finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0,
        navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true,
        npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2'
      };
    });
  }
  try {
    for (const key of Object.keys(w)) {
      if (/^cdc_[a-zA-Z0-9_]+$/.test(key)) { try { delete w[key]; } catch (_) {} }
    }
  } catch (_) {}

  /* ---- gate 2: runtime fingerprint ---- */
  defineGetter(navProto, 'hardwareConcurrency', profile.hardwareConcurrency);
  defineGetter(navProto, 'deviceMemory', profile.deviceMemory);
  defineGetter(navProto, 'maxTouchPoints', profile.maxTouchPoints);
  defineGetter(navProto, 'platform', profile.platform);

  const patchGetParameter = (proto) => {
    if (!proto || !proto.getParameter) return;
    const original = proto.getParameter;
    proto.getParameter = markNative(function getParameter(param) {
      if (param === 37445) return profile.webglVendor;    // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return profile.webglRenderer;  // UNMASKED_RENDERER_WEBGL
      if (param === 7936) return profile.webglVendor;     // VENDOR
      if (param === 7937) return profile.webglRenderer;   // RENDERER
      return original.call(this, param);
    }, 'getParameter');
  };
  patchGetParameter(w.WebGLRenderingContext && w.WebGLRenderingContext.prototype);
  patchGetParameter(w.WebGL2RenderingContext && w.WebGL2RenderingContext.prototype);

  try {
    if (!w.outerWidth) Object.defineProperty(w, 'outerWidth', { get: markNative(function () { return w.innerWidth; }, 'outerWidth', 'get'), configurable: true });
    if (!w.outerHeight) Object.defineProperty(w, 'outerHeight', { get: markNative(function () { return w.innerHeight; }, 'outerHeight', 'get'), configurable: true });
  } catch (_) {}

  /* ---- permissions: 'denied' is a Playwright artifact, real handsets say 'default' ---- */
  if (w.Notification && w.Notification.permission === 'denied') {
    try {
      Object.defineProperty(w.Notification, 'permission', { get: markNative(function () { return 'default'; }, 'permission', 'get'), configurable: true });
    } catch (_) {}
  }
  if (w.Permissions && w.Permissions.prototype && w.Permissions.prototype.query) {
    const originalQuery = w.Permissions.prototype.query;
    w.Permissions.prototype.query = markNative(function query(descriptor) {
      return Promise.resolve(originalQuery.call(this, descriptor)).then((status) => {
        if (descriptor && descriptor.name === 'notifications' && status && status.state === 'denied') {
          try { Object.defineProperty(status, 'state', { get: markNative(function () { return 'default'; }, 'state', 'get'), configurable: true }); } catch (_) {}
        }
        return status;
      });
    }, 'query');
  }

  /* ---- gate 3: device identity ---- */
  let ua = String(n.userAgent || '');
  const versionMatch = /Chrome\/(\d+)/.exec(ua);
  const chromeVersion = versionMatch ? versionMatch[1] : '120';
  const deviceRe = /(Linux; Android [\d.]+; )([^;)]+)((?: Build\/[^;)]+)?)(\))/;
  if (deviceRe.test(ua)) {
    ua = ua.replace(deviceRe, '$1' + profile.model + '$3$4');
  } else if (/Android/.test(ua)) {
    ua = 'Mozilla/5.0 (Linux; Android ' + profile.androidVersion + '; ' + profile.model + ') ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chromeVersion + '.0.0.0 Mobile Safari/537.36';
  }
  if (ua) defineGetter(navProto, 'userAgent', ua);

  /* UA-CH: patch the real NavigatorUAData prototype instead of swapping the object out,
     so constructor.name / instanceof / toString all stay genuine. */
  const UAD = w.NavigatorUAData;
  if (UAD && UAD.prototype && typeof UAD.prototype.getHighEntropyValues === 'function') {
    const originalHev = UAD.prototype.getHighEntropyValues;
    UAD.prototype.getHighEntropyValues = markNative(function getHighEntropyValues(hints) {
      return Promise.resolve(originalHev.call(this, hints)).then((values) => {
        const out = Object.assign({}, values);
        out.architecture = profile.architecture;
        out.bitness = profile.bitness;
        out.model = profile.model;
        out.platform = 'Android';
        out.platformVersion = profile.platformVersion;
        if (!out.uaFullVersion) out.uaFullVersion = chromeVersion + '.0.0.0';
        return out;
      });
    }, 'getHighEntropyValues');
  } else if (n.userAgentData) {
    // Fallback only for engines without NavigatorUAData.
    const brands = n.userAgentData.brands || [];
    const nativeHev = n.userAgentData.getHighEntropyValues ? n.userAgentData.getHighEntropyValues.bind(n.userAgentData) : null;
    const replacement = {
      brands,
      mobile: true,
      platform: 'Android',
      getHighEntropyValues: markNative(function (hints) {
        const base = nativeHev ? nativeHev(hints) : Promise.resolve({});
        return Promise.resolve(base).then((values) => Object.assign({}, values, {
          architecture: profile.architecture,
          bitness: profile.bitness,
          model: profile.model,
          platform: 'Android',
          platformVersion: profile.platformVersion,
          uaFullVersion: values.uaFullVersion || (chromeVersion + '.0.0.0')
        }));
      }, 'getHighEntropyValues'),
      toJSON: markNative(function () { return { brands, mobile: true, platform: 'Android' }; }, 'toJSON')
    };
    defineGetter(navProto, 'userAgentData', replacement);
  }
}

function hardeningInitSource(profile) {
  const p = resolveProfile(profile);
  return `(${hardeningInit.toString()})(${JSON.stringify(p)});`;
}

async function installDeviceHardening(target, profile) {
  const p = resolveProfile(profile);
  if (!target || typeof target.addInitScript !== 'function') return false;
  await target.addInitScript(hardeningInit, p);
  return true;
}

/**
 * One-shot helper for browser factories.
 * Returns hardened contextOptions plus an afterCreate hook.
 * Only fills viewport/deviceScaleFactor when the caller has not set them.
 */
function prepareHardening(input = {}) {
  const profile = findRealDeviceProfile(input.avdName || input.deviceName || input.model);
  const deviceMode = input.deviceMode || 'desktop';
  const active = !!profile && (deviceMode === 'android' || deviceMode === 'android-emulation');
  const contextOptions = { ...(input.contextOptions || {}) };

  if (active) {
    contextOptions.args = [...(contextOptions.args || []), ...buildHardeningArgs(profile)];
    contextOptions.userAgent = buildHardeningUserAgent(profile, contextOptions.userAgent);
    contextOptions.hasTouch = true;
    contextOptions.isMobile = true;
    if (contextOptions.deviceScaleFactor == null) contextOptions.deviceScaleFactor = profile.screen.dpr;
    if (!contextOptions.viewport) contextOptions.viewport = { width: profile.screen.width, height: profile.screen.height };
  }

  return {
    profile,
    active,
    contextOptions,
    async afterCreate(context) {
      if (!active) return false;
      return installDeviceHardening(context, profile);
    }
  };
}

async function collectHardeningReport(page, profile) {
  const p = resolveProfile(profile);

  const raw = await page.evaluate(() => {
    const n = navigator;
    const out = {
      webdriver: n.webdriver,
      chromeRuntime: !!(window.chrome && window.chrome.runtime),
      chromeApp: !!(window.chrome && window.chrome.app),
      cdcKeys: Object.keys(window).filter((k) => /^cdc_/.test(k)),
      ua: n.userAgent,
      platform: n.platform,
      hardwareConcurrency: n.hardwareConcurrency,
      deviceMemory: n.deviceMemory,
      maxTouchPoints: n.maxTouchPoints,
      webglVendor: null,
      webglRenderer: null
    };
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          out.webglVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL);
          out.webglRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
        }
      }
    } catch (_) {}
    return out;
  });

  let uad = null;
  try {
    uad = await page.evaluate(async () => {
      if (!navigator.userAgentData) return null;
      const high = await navigator.userAgentData.getHighEntropyValues(
        ['model', 'platformVersion', 'architecture', 'bitness']
      );
      return {
        model: high.model,
        platformVersion: high.platformVersion,
        platform: navigator.userAgentData.platform,
        mobile: navigator.userAgentData.mobile
      };
    });
  } catch (_) {}

  const checks = [
    {
      id: 'automation-flag',
      pass: raw.webdriver === false && raw.chromeRuntime && raw.chromeApp && raw.cdcKeys.length === 0,
      detail: {
        webdriver: raw.webdriver,
        chromeRuntime: raw.chromeRuntime,
        chromeApp: raw.chromeApp,
        cdcKeys: raw.cdcKeys
      }
    },
    {
      id: 'runtime-fingerprint',
      pass: raw.hardwareConcurrency === p.hardwareConcurrency &&
        raw.deviceMemory === p.deviceMemory &&
        raw.maxTouchPoints === p.maxTouchPoints &&
        raw.platform === p.platform &&
        raw.webglVendor === p.webglVendor &&
        raw.webglRenderer === p.webglRenderer,
      detail: {
        hardwareConcurrency: raw.hardwareConcurrency,
        deviceMemory: raw.deviceMemory,
        maxTouchPoints: raw.maxTouchPoints,
        platform: raw.platform,
        webglVendor: raw.webglVendor,
        webglRenderer: raw.webglRenderer
      }
    },
    {
      id: 'device-identity',
      pass: raw.ua.includes(p.model) &&
        raw.ua.includes(`Android ${p.androidVersion}`) &&
        !/sdk_gphone|generic/i.test(raw.ua) &&
        !!uad && uad.model === p.model && uad.platform === 'Android' &&
        uad.platformVersion === p.platformVersion,
      detail: { userAgent: raw.ua, userAgentData: uad }
    }
  ];

  return {
    profile: p.id,
    passed: checks.every((c) => c.pass),
    checks
  };
}

module.exports = {
  DEFAULT_REAL_DEVICE_AVD,
  HARDENING_EVENT,
  HARDENING_CHECKS,
  REAL_DEVICE_PROFILES,
  normalise,
  findRealDeviceProfile,
  isHardenedAvd,
  resolveProfile,
  buildHardeningArgs,
  buildHardeningProps,
  buildHardeningUserAgent,
  hardeningInit,
  hardeningInitSource,
  installDeviceHardening,
  prepareHardening,
  collectHardeningReport
};