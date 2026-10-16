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

  const def = (obj, prop, value) => {
    try {
      Object.defineProperty(obj, prop, { get: () => value, configurable: true });
    } catch (_) {
      try { obj[prop] = value; } catch (__) {}
    }
  };

  /* gate 1 - automation flag */
  def(n, 'webdriver', false);

  if (!w.chrome) w.chrome = {};
  if (!w.chrome.runtime) {
    w.chrome.runtime = {
      id: undefined,
      connect: () => {},
      sendMessage: () => {},
      onMessage: { addListener: () => {}, removeListener: () => {} }
    };
  }
  if (!w.chrome.app) {
    w.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
    };
  }
  if (!w.chrome.csi) w.chrome.csi = () => ({ onloadT: 0, startE: Date.now(), pageT: 0, tran: 15 });
  if (!w.chrome.loadTimes) {
    w.chrome.loadTimes = () => ({
      requestTime: 0, startLoadTime: 0, commitLoadTime: 0, finishDocumentLoadTime: 0,
      finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0,
      navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true,
      npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2'
    });
  }
  try {
    for (const key of Object.keys(w)) {
      if (/^cdc_[a-zA-Z0-9_]+$/.test(key)) { try { delete w[key]; } catch (_) {} }
    }
  } catch (_) {}

  /* gate 2 - runtime fingerprint */
  def(n, 'hardwareConcurrency', profile.hardwareConcurrency);
  def(n, 'deviceMemory', profile.deviceMemory);
  def(n, 'maxTouchPoints', profile.maxTouchPoints);
  def(n, 'platform', profile.platform);

  const patchGL = (proto) => {
    if (!proto || !proto.getParameter) return;
    const original = proto.getParameter;
    proto.getParameter = function (param) {
      if (param === 37445) return profile.webglVendor;    // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return profile.webglRenderer;  // UNMASKED_RENDERER_WEBGL
      if (param === 7936) return profile.webglVendor;     // VENDOR
      if (param === 7937) return profile.webglRenderer;   // RENDERER
      return original.call(this, param);
    };
  };
  patchGL(w.WebGLRenderingContext && w.WebGLRenderingContext.prototype);
  patchGL(w.WebGL2RenderingContext && w.WebGL2RenderingContext.prototype);

  if (w.Notification && w.Notification.permission === 'denied') {
    def(w.Notification, 'permission', 'default');
  }

  /* gate 3 - device identity */
  let ua = String(n.userAgent || '');
  const versionMatch = /Chrome\/(\d+)/.exec(ua);
  const chromeVersion = versionMatch ? versionMatch[1] : '120';
  const deviceRe = /(Linux; Android [\d.]+; )([^;)]+)((?: Build\/[^;)]+)?)(\))/;
  if (deviceRe.test(ua)) {
    ua = ua.replace(deviceRe, `$1${profile.model}$3$4`);
  } else if (/Android/.test(ua)) {
    ua = `Mozilla/5.0 (Linux; Android ${profile.androidVersion}; ${profile.model}) ` +
      `AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Mobile Safari/537.36`;
  }
  if (ua && ua !== n.userAgent) def(n, 'userAgent', ua);

  const uad = n.userAgentData;
  if (uad) {
    const brands = uad.brands || [];
    const nativeHEV = uad.getHighEntropyValues ? uad.getHighEntropyValues.bind(uad) : null;
    const patched = {
      brands,
      mobile: true,
      platform: 'Android',
      getHighEntropyValues: (hints) => {
        const base = nativeHEV ? nativeHEV(hints) : Promise.resolve({});
        return base.then((values) => Object.assign({}, values, {
          architecture: profile.architecture,
          bitness: profile.bitness,
          model: profile.model,
          platform: 'Android',
          platformVersion: profile.platformVersion,
          uaFullVersion: values.uaFullVersion || `${chromeVersion}.0.0.0`
        }));
      },
      toJSON: () => ({ brands, mobile: true, platform: 'Android' })
    };
    def(n, 'userAgentData', patched);
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