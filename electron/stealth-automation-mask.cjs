'use strict';

/*
 * stealth-automation-mask.cjs - OrbitQA Desktop
 *
 * Closes the automation surfaces pixelscan.net/bot-check and iphey.com read.
 * Self-deriving: reads the live userAgent, screen and GPU, then masks only what
 * is wrong. No host wiring, no per-call profile required.
 *
 * Deterministic: every random value is seeded from the identity, so reloading
 * the same profile yields the same canvas, audio and GPU values.
 */

const STEALTH_VERSION = 6;
const MARK = '__orbitqaStealth';

/* Injected into the page. Must stay self-contained (it is serialised). */
function stealthInit() {
  const w = typeof window !== 'undefined' ? window : globalThis;
  if (!w || !w.navigator) return;
  const n = w.navigator;
  const navProto = Object.getPrototypeOf(n);
  const ua = String(n.userAgent || '');

  const hash = (value) => {
    const text = String(value);
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  const seed = hash(`${ua}|${w.innerWidth}x${w.innerHeight}|${w.devicePixelRatio}`);

  /* mulberry32 - stable sequence for a given seed */
  const seeded = (salt) => {
    let state = hash(`${seed}|${salt}`);
    return () => {
      state |= 0;
      state = (state + 0x6D2B79F5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* ---- native-looking toString ---- */
  const nativeToString = Function.prototype.toString;
  const nativeSource = new WeakMap();
  const markNative = (fn, name, kind) => {
    try {
      nativeSource.set(fn, `function ${kind === 'get' ? 'get ' : ''}${name}() { [native code] }`);
    } catch { /* best effort */ }
    return fn;
  };
  const patchedToString = function toString() {
    const source = nativeSource.get(this);
    return source || nativeToString.call(this);
  };
  markNative(patchedToString, 'toString');
  try { Function.prototype.toString = patchedToString; } catch { /* keep native */ }

  const defineGetter = (target, prop, value, enumerable) => {
    if (!target) return false;
    const getter = markNative(function () { return value; }, prop, 'get');
    try {
      Object.defineProperty(target, prop, {
        get: getter,
        configurable: true,
        enumerable: enumerable !== false,
      });
      return true;
    } catch {
      try {
        Object.defineProperty(n, prop, { get: getter, configurable: true });
        return true;
      } catch { return false; }
    }
  };

  const patchMethod = (target, prop, factory) => {
    if (!target || typeof target[prop] !== 'function') return false;
    const original = target[prop];
    try {
      Object.defineProperty(target, prop, {
        configurable: true,
        writable: true,
        value: markNative(factory(original), prop),
      });
      return true;
    } catch { return false; }
  };

  /* ---- gate 1: automation flags ---- */
  defineGetter(navProto, 'webdriver', false);

  const sweepCdc = () => {
    try {
      for (const key of Object.keys(w)) {
        if (/^cdc_[a-zA-Z0-9_]+$/.test(key)) { try { delete w[key]; } catch { /* locked */ } }
      }
    } catch { /* nothing to sweep */ }
  };
  sweepCdc();

  if (!w.chrome) w.chrome = {};
  if (!w.chrome.runtime) {
    w.chrome.runtime = {
      id: undefined,
      connect: markNative(function connect() {}, 'connect'),
      sendMessage: markNative(function sendMessage() {}, 'sendMessage'),
      onMessage: {
        addListener: markNative(function addListener() {}, 'addListener'),
        removeListener: markNative(function removeListener() {}, 'removeListener'),
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
    w.chrome.csi = markNative(function csi() {
      return { onloadT: 0, startE: Date.now(), pageT: 0, tran: 15 };
    }, 'csi');
  }
  if (!w.chrome.loadTimes) {
    w.chrome.loadTimes = markNative(function loadTimes() {
      return {
        requestTime: 0, startLoadTime: 0, commitLoadTime: 0, finishDocumentLoadTime: 0,
        finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0,
        navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true,
        npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2',
      };
    }, 'loadTimes');
  }

  /* ---- plugins / mimeTypes: the empty list is a headless tell ---- */
  const MIME_TYPES = [
    ['application/pdf', 'pdf'],
    ['text/pdf', 'pdf'],
  ];
  const PLUGINS = [
    ['PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'],
    ['Chrome PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'],
    ['Chromium PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'],
    ['Microsoft Edge PDF Viewer', 'internal-pdf-viewer', 'Portable Document Format'],
    ['WebKit built-in PDF', 'internal-pdf-viewer', 'Portable Document Format'],
  ];

  const mimeEntries = MIME_TYPES.map(([type, suffixes]) => {
    const entry = {
      type,
      suffixes,
      description: 'Portable Document Format',
      enabledPlugin: null,
    };
    entry.item = markNative(function item() { return entry; }, 'item');
    entry.namedItem = markNative(function namedItem() { return entry; }, 'namedItem');
    return entry;
  });

  const pluginEntries = PLUGINS.map(([name, filename, description]) => {
    const entry = {
      name,
      filename,
      description,
      length: mimeEntries.length,
    };
    mimeEntries.forEach((mime, index) => { entry[index] = mime; });
    entry.item = markNative(function item(index) { return mimeEntries[index] || null; }, 'item');
    entry.namedItem = markNative(function namedItem(key) {
      return mimeEntries.find((mime) => mime.type === key) || null;
    }, 'namedItem');
    mimeEntries.forEach((mime) => { mime.enabledPlugin = entry; });
    return entry;
  });

  const arrayLike = (entries) => {
    const list = { length: entries.length };
    entries.forEach((entry, index) => { list[index] = entry; });
    list.item = markNative(function item(index) { return entries[index] || null; }, 'item');
    list.namedItem = markNative(function namedItem(key) {
      return entries.find((entry) => (entry.name || entry.type) === key) || null;
    }, 'namedItem');
    list.refresh = markNative(function refresh() {}, 'refresh');
    return list;
  };

  const plugins = arrayLike(pluginEntries);
  const mimeTypes = arrayLike(mimeEntries);
  defineGetter(navProto, 'plugins', plugins);
  defineGetter(navProto, 'mimeTypes', mimeTypes);
  defineGetter(navProto, 'pdfViewerEnabled', true);

  /* ---- language coherence ---- */
  const primary = n.language || (n.languages && n.languages[0]) || 'en-US';
  if (!n.languages || !n.languages.length) defineGetter(navProto, 'languages', [primary]);
  if (!n.vendor) defineGetter(navProto, 'vendor', 'Google Inc.');

  /* ---- runtime plausibility ---- */
  if (!Number.isInteger(n.hardwareConcurrency) || n.hardwareConcurrency < 2) {
    defineGetter(navProto, 'hardwareConcurrency', 8);
  }
  if (n.deviceMemory === undefined) defineGetter(navProto, 'deviceMemory', 8);
  if (n.maxTouchPoints === undefined) defineGetter(navProto, 'maxTouchPoints', 0);
  if (!w.outerWidth) defineGetter(w, 'outerWidth', w.innerWidth, false);
  if (!w.outerHeight) defineGetter(w, 'outerHeight', w.innerHeight, false);

  /* ---- WebGL: read the real renderer, replace only a known-bad one ---- */
  let realVendor = '';
  let realRenderer = '';
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl');
    const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (info) {
      realVendor = String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL) || '');
      realRenderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '');
    }
  } catch { /* no webgl */ }

  const software = /swiftshader|software|llvmpipe|microsoft basic|mesa offscreen/i.test(realRenderer);
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);

  let vendor = realVendor;
  let renderer = realRenderer;
  if (isAndroid) {
    vendor = 'ARM';
    renderer = 'Mali-G715';
  } else if (isIOS) {
    vendor = 'Apple Inc.';
    renderer = 'Apple GPU';
  } else if (software || !realRenderer) {
    if (/Windows/i.test(ua)) {
      vendor = 'Google Inc. (NVIDIA)';
      renderer = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
    } else if (/Mac OS X|Macintosh/i.test(ua)) {
      vendor = 'Google Inc. (Apple)';
      renderer = 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)';
    } else {
      vendor = 'Google Inc. (Intel)';
      renderer = 'ANGLE (Intel, Mesa Intel(R) UHD Graphics 620, OpenGL 4.6)';
    }
  }

  const patchGetParameter = (proto) => {
    patchMethod(proto, 'getParameter', (original) => function getParameter(param) {
      if (param === 37445 || param === 7936) return vendor;
      if (param === 37446 || param === 7937) return renderer;
      return original.call(this, param);
    });
  };
  patchGetParameter(w.WebGLRenderingContext && w.WebGLRenderingContext.prototype);
  patchGetParameter(w.WebGL2RenderingContext && w.WebGL2RenderingContext.prototype);

  /* ---- canvas: stable, idempotent ±1 pixel jitter ---- */
  const jitterCanvas = (canvas) => {
    if (!canvas || canvas[MARK]) return;
    try {
      canvas[MARK] = true;
      const width = canvas.width;
      const height = canvas.height;
      if (!width || !height) return;
      const context = canvas.getContext('2d');
      if (!context) return;
      const random = seeded(`canvas|${width}x${height}`);
      for (let i = 0; i < 3; i += 1) {
        const x = Math.floor(random() * width);
        const y = Math.floor(random() * height);
        const pixel = context.getImageData(x, y, 1, 1);
        pixel.data[0] = (pixel.data[0] + 1) % 256;
        context.putImageData(pixel, x, y);
      }
    } catch { /* tainted or no 2d */ }
  };

  const canvasProto = w.HTMLCanvasElement && w.HTMLCanvasElement.prototype;
  if (canvasProto) {
    patchMethod(canvasProto, 'toDataURL', (original) => function toDataURL(...args) {
      jitterCanvas(this);
      return original.apply(this, args);
    });
    patchMethod(canvasProto, 'toBlob', (original) => function toBlob(...args) {
      jitterCanvas(this);
      return original.apply(this, args);
    });
    const context2d = w.CanvasRenderingContext2D && w.CanvasRenderingContext2D.prototype;
    if (context2d) {
      patchMethod(context2d, 'getImageData', (original) => function getImageData(...args) {
        jitterCanvas(this.canvas);
        return original.apply(this, args);
      });
    }
  }

  /* ---- audio fingerprint jitter ---- */
  const analyserProto = w.AnalyserNode && w.AnalyserNode.prototype;
  if (analyserProto) {
    patchMethod(analyserProto, 'getFloatFrequencyData', (original) => function getFloatFrequencyData(array) {
      const result = original.call(this, array);
      try {
        const random = seeded(`audio|${array.length}`);
        for (let i = 0; i < array.length; i += 1) array[i] += (random() - 0.5) * 1e-7;
      } catch { /* typed array */ }
      return result;
    });
  }
  const bufferProto = w.AudioBuffer && w.AudioBuffer.prototype;
  if (bufferProto) {
    patchMethod(bufferProto, 'getChannelData', (original) => function getChannelData(...args) {
      const data = original.apply(this, args);
      try {
        if (data && data.length && !data[MARK]) {
          data[MARK] = true;
          data[0] += 1e-7;
        }
      } catch { /* readonly */ }
      return data;
    });
  }

  /* ---- driver artifact: 'denied' reads as 'default' ---- */
  if (w.Notification && w.Notification.permission === 'denied') {
    try {
      Object.defineProperty(w.Notification, 'permission', {
        get: markNative(function () { return 'default'; }, 'permission', 'get'),
        configurable: true,
      });
    } catch { /* keep denied */ }
  }
  if (w.Permissions && w.Permissions.prototype && w.Permissions.prototype.query) {
    patchMethod(w.Permissions.prototype, 'query', (original) => function query(descriptor) {
      return Promise.resolve(original.call(this, descriptor)).then((status) => {
        if (descriptor && descriptor.name === 'notifications' && status && status.state === 'denied') {
          try {
            Object.defineProperty(status, 'state', {
              get: markNative(function () { return 'default'; }, 'state', 'get'),
              configurable: true,
            });
          } catch { /* readonly */ }
        }
        return status;
      });
    });
  }

  /* ---- publish a marker so the probe can verify the mask ran ---- */
  try {
    Object.defineProperty(globalThis, MARK, {
      configurable: true,
      value: {
        version: STEALTH_VERSION,
        rendererMasked: software || isAndroid || isIOS || !realRenderer,
        plugins: pluginEntries.length,
        cdcSwept: true,
      },
    });
  } catch { /* marker is best effort */ }

  for (const delay of [0, 50, 200, 1000, 3000]) {
    try { setTimeout(sweepCdc, delay); } catch { /* no timers */ }
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    for (const eventName of ['readystatechange', 'DOMContentLoaded', 'load']) {
      try { document.addEventListener(eventName, sweepCdc, true); } catch { /* no document */ }
    }
  }
}

async function installStealthMask(context) {
  if (!context || typeof context.addInitScript !== 'function') return false;
  await context.addInitScript(stealthInit);
  return true;
}

async function collectStealthReport(page) {
  return page.evaluate(() => {
    const n = navigator;
    const marker = globalThis.__orbitqaStealth || null;
    const nativeToString = (fn) => {
      try { return /native code/.test(Function.prototype.toString.call(fn)); } catch { return false; }
    };
    let renderer = null;
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl');
      const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
      if (info) renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    } catch { /* no webgl */ }

    const checks = [
      { id: 'webdriver', pass: n.webdriver === false, detail: n.webdriver },
      { id: 'cdc-globals', pass: Object.keys(window).filter((k) => /^cdc_/.test(k)).length === 0, detail: Object.keys(window).filter((k) => /^cdc_/.test(k)) },
      { id: 'chrome-object', pass: !!(window.chrome && window.chrome.runtime && window.chrome.app), detail: !!(window.chrome && window.chrome.runtime) },
      { id: 'plugins', pass: (n.plugins || []).length > 0, detail: (n.plugins || []).length },
      { id: 'languages', pass: (n.languages || []).length > 0, detail: (n.languages || []).join(',') },
      { id: 'toString-native', pass: nativeToString(WebGLRenderingContext.prototype.getParameter), detail: nativeToString(WebGLRenderingContext.prototype.getParameter) },
      { id: 'renderer', pass: !!renderer && !/swiftshader|llvmpipe|basic render/i.test(String(renderer)), detail: renderer },
      { id: 'marker', pass: !!marker, detail: marker ? marker.version : null },
    ];
    return { passed: checks.every((check) => check.pass), checks };
  });
}

async function assertStealthMask(page) {
  const report = await collectStealthReport(page);
  if (report.passed) return report;
  const failures = report.checks.filter((check) => !check.pass).map((check) => check.id);
  throw new Error(`Automation mask incomplete: ${failures.join(', ')} ${JSON.stringify(report.checks)}`);
}

module.exports = {
  STEALTH_VERSION,
  MARK,
  stealthInit,
  installStealthMask,
  collectStealthReport,
  assertStealthMask,
};