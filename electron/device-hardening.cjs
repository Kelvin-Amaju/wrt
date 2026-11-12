'use strict';

/*
 * desktop-hardening.cjs - OrbitQA Desktop
 *
 * Desktop counterpart to device-hardening.cjs. device-hardening assumes an
 * Android identity (Android UA fallback, Linux armv8l platform, retail build
 * props). This module applies the same three gates to a host desktop browser
 * without rewriting the identity into a phone.
 *
 * Deterministic: only overrides what the caller pins, so real Chrome values
 * survive where the caller is silent. Chromium only - WebKit/Gecko have no
 * window.chrome and must not be given one.
 */

const HARDENING_EVENT = 'desktop-hardening:diagnostics';

const HARDENING_CHECKS = Object.freeze([
  'automation-flag',
  'runtime-fingerprint',
  'device-identity',
]);

/* Injected into the page. Must stay self-contained (it is serialised). */
function desktopHardeningInit(profile) {
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
      onMessage: {
        addListener: stub('addListener', function () {}),
        removeListener: stub('removeListener', function () {}),
      },
    };
  }
  if (!w.chrome.app) {
    w.chrome.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    };
  }
  if (!w.chrome.csi) {
    w.chrome.csi = stub('csi', function () {
      return { onloadT: 0, startE: Date.now(), pageT: 0, tran: 15 };
    });
  }
  if (!w.chrome.loadTimes) {
    w.chrome.loadTimes = stub('loadTimes', function () {
      return {
        requestTime: 0, startLoadTime: 0, commitLoadTime: 0, finishDocumentLoadTime: 0,
        finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0,
        navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true,
        npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2',
      };
    });
  }
  try {
    for (const key of Object.keys(w)) {
      if (/^cdc_[a-zA-Z0-9_]+$/.test(key)) { try { delete w[key]; } catch (_) {} }
    }
  } catch (_) {}

  /* ---- gate 2: runtime fingerprint, only where the caller pins a value ---- */
  if (profile) {
    if (profile.hardwareConcurrency) defineGetter(navProto, 'hardwareConcurrency', profile.hardwareConcurrency);
    if (profile.deviceMemory) defineGetter(navProto, 'deviceMemory', profile.deviceMemory);
    if (profile.maxTouchPoints !== undefined) defineGetter(navProto, 'maxTouchPoints', profile.maxTouchPoints);
    if (profile.platform) defineGetter(navProto, 'platform', profile.platform);
    if (profile.language) defineGetter(navProto, 'language', profile.language);
    if (profile.languages) defineGetter(navProto, 'languages', profile.languages);

    if (profile.webglVendor || profile.webglRenderer) {
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
    }
  }

  /* ---- driver artifact: 'denied' reads as 'default' on a real desktop ---- */
  if (w.Notification && w.Notification.permission === 'denied') {
    try {
      Object.defineProperty(w.Notification, 'permission', {
        get: markNative(function () { return 'default'; }, 'permission', 'get'),
        configurable: true,
      });
    } catch (_) {}
  }
  if (w.Permissions && w.Permissions.prototype && w.Permissions.prototype.query) {
    const originalQuery = w.Permissions.prototype.query;
    w.Permissions.prototype.query = markNative(function query(descriptor) {
      return Promise.resolve(originalQuery.call(this, descriptor)).then((status) => {
        if (descriptor && descriptor.name === 'notifications' && status && status.state === 'denied') {
          try {
            Object.defineProperty(status, 'state', {
              get: markNative(function () { return 'default'; }, 'state', 'get'),
              configurable: true,
            });
          } catch (_) {}
        }
        return status;
      });
    }, 'query');
  }
}

function buildDesktopLaunchArgs(extra = []) {
  return [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=Translate,BackForwardCache,AcceptCHFrame,MediaRouter,OptimizationHints',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    ...extra,
  ];
}

/* Removes the "Chrome is being controlled by automated test software" bar. */
const IGNORE_DEFAULT_ARGS = ['--enable-automation'];

async function installDesktopHardening(context, profile) {
  if (!context || typeof context.addInitScript !== 'function') return false;
  await context.addInitScript(desktopHardeningInit, profile || null);
  return true;
}

/**
 * Planner mirroring device-hardening.prepareHardening().
 *
 * Returns hardened contextOptions plus an afterCreate hook. `active` is false for
 * non-Chromium engines, so callers can merge unconditionally.
 */
function prepareDesktopHardening(input = {}) {
  const browserEngine = input.browserEngine || 'chromium';
  const active = browserEngine === 'chromium' && input.enabled !== false;
  const contextOptions = { ...(input.contextOptions || {}) };

  if (active) {
    // Playwright only honours `args` on launch(), so this list is a convenience;
    // qa-runner merges buildDesktopLaunchArgs() into launchOptions.args explicitly.
    contextOptions.args = [...(contextOptions.args || []), ...buildDesktopLaunchArgs()];
    // Desktop keeps the real Chrome UA and platform. Only pin locale/timezone when
    // supplied and not already set by the worker-context policy.
    if (input.locale && !contextOptions.locale) contextOptions.locale = input.locale;
    if (input.timezoneId && !contextOptions.timezoneId) contextOptions.timezoneId = input.timezoneId;
  }

  return {
    active,
    contextOptions,
    async afterCreate(context) {
      if (!active) return false;
      return installDesktopHardening(context, input.profile || null);
    },
  };
}

async function collectDesktopHardeningReport(page) {
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
      language: n.language,
      languages: (n.languages || []).join(','),
      webglVendor: null,
      webglRenderer: null,
      getParameterNative: true,
    };
    try {
      out.getParameterNative = /native code/.test(
        Function.prototype.toString.call(WebGLRenderingContext.prototype.getParameter),
      );
    } catch (_) {}
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

  const checks = [
    {
      id: 'automation-flag',
      pass: raw.webdriver === false && raw.chromeRuntime && raw.chromeApp && raw.cdcKeys.length === 0,
      detail: { webdriver: raw.webdriver, chromeRuntime: raw.chromeRuntime, chromeApp: raw.chromeApp, cdcKeys: raw.cdcKeys },
    },
    {
      id: 'runtime-fingerprint',
      pass: Number.isInteger(raw.hardwareConcurrency) && raw.hardwareConcurrency > 0 &&
        Number.isInteger(raw.deviceMemory) && raw.maxTouchPoints !== undefined &&
        raw.getParameterNative === true,
      detail: {
        hardwareConcurrency: raw.hardwareConcurrency,
        deviceMemory: raw.deviceMemory,
        maxTouchPoints: raw.maxTouchPoints,
        platform: raw.platform,
        webglVendor: raw.webglVendor,
        webglRenderer: raw.webglRenderer,
      },
    },
    {
      id: 'device-identity',
      pass: !/HeadlessChrome/i.test(raw.ua) && raw.getParameterNative === true &&
        !/SwiftShader/i.test(String(raw.webglRenderer || '')),
      detail: { userAgent: raw.ua, language: raw.language, languages: raw.languages, webglRenderer: raw.webglRenderer },
    },
  ];

  return { passed: checks.every((c) => c.pass), checks };
}

module.exports = {
  HARDENING_EVENT,
  HARDENING_CHECKS,
  IGNORE_DEFAULT_ARGS,
  buildDesktopLaunchArgs,
  collectDesktopHardeningReport,
  desktopHardeningInit,
  installDesktopHardening,
  prepareDesktopHardening,
};