'use strict';

/*
 * stealth-automation-mask.cjs - OrbitQA Desktop
 *
 * Single owner of the JS fingerprint surface. Chromium and WebKit only.
 * Every random value is seeded from a per-profile seed supplied by the host, so a
 * profile stays stable across reloads and differs across profiles.
 *
 * Nothing else in the tree may patch Function.prototype.toString or navigator.
 */

const crypto = require('node:crypto');

const STEALTH_VERSION = 7;
const INSTALL_KEY = '__orbitqaStealthVersion';
const CONTEXT_KEY = '__orbitqaStealthContext';

function stealthSeed(...parts) {
  return crypto
    .createHash('sha256')
    .update(parts.filter(Boolean).map(String).join('|'))
    .digest('hex')
    .slice(0, 16);
}

/* Injected into the page. Must stay self-contained (it is serialised). */
function stealthInit(options) {
  const w = typeof window !== 'undefined' ? window : globalThis;
  if (!w || !w.navigator) return;

  const installed = w[INSTALL_KEY];
  if (typeof installed === 'number' && installed >= 7) return;

  const config = options && typeof options === 'object' ? options : {};
  const profile = config.profile && typeof config.profile === 'object' ? config.profile : null;
  const seed = String(config.seed || '');
  const n = w.navigator;
  const navProto = Object.getPrototypeOf(n);
  const engine = config.engine
    || (/Chrome\//.test(String(n.userAgent || '')) ? 'chromium' : 'webkit');

  if (profile && profile.userAgent) {
    try {
      Object.defineProperty(navProto, 'userAgent', {
        configurable: true,
        get: () => String(profile.userAgent),
      });
    } catch { /* keep native */ }
  }

  const ua = String(n.userAgent || '');
  const isAndroid = /Android/.test(ua);
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const isMobile = isAndroid || isIOS;
  const uaMajor = (ua.match(/Chrome\/(\d+)/) || [])[1] || '';
  const androidVersion = (ua.match(/Android ([\d.]+)/) || [])[1] || '';
  const uaPlatform = isAndroid
    ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
      : /Macintosh|Mac OS X/.test(ua) ? 'macOS'
        : 'Linux';

  const hash = (value) => {
    const text = String(value);
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  const seeded = (salt) => {
    let state = hash(`${seed}|${salt}`) || 1;
    return () => {
      state |= 0;
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

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
    try {
      Object.defineProperty(target, prop, {
        configurable: true,
        writable: true,
        value: markNative(factory(target[prop]), prop),
      });
      return true;
    } catch { return false; }
  };

  /* automation flags */
  if (n.webdriver !== false) defineGetter(navProto, 'webdriver', false);

  const sweep = () => {
    try {
      for (const key of Object.keys(w)) {
        if (/^cdc_[a-zA-Z0-9_]+$/.test(key)) { try { delete w[key]; } catch { /* locked */ } }
      }
    } catch { /* nothing to sweep */ }
  };
  sweep();

  if (engine === 'chromium' || w.chrome) {
    if (!w.chrome) w.chrome = {};
    const stub = (name, impl) => markNative(impl, name);
    if (!w.chrome.runtime) {
      const port = () => ({
        name: '',
        disconnect: stub('disconnect', function () {}),
        postMessage: stub('postMessage', function () {}),
        onDisconnect: {
          addListener: stub('addListener', function () {}),
          removeListener: stub('removeListener', function () {}),
        },
        onMessage: {
          addListener: stub('addListener', function () {}),
          removeListener: stub('removeListener', function () {}),
        },
      });
      w.chrome.runtime = {
        id: undefined,
        connect: stub('connect', function connect() { return port(); }),
        sendMessage: stub('sendMessage', function sendMessage() {}),
        onMessage: {
          addListener: stub('addListener', function () {}),
          removeListener: stub('removeListener', function () {}),
        },
      };
    }
    if (!w.chrome.app) {
      w.chrome.app = {
        isInstalled: false,
        getDetails: stub('getDetails', function () { return null; }),
        getIsInstalled: stub('getIsInstalled', function () { return false; }),
        runningState: stub('runningState', function () { return 'cannot_run'; }),
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      };
    }
    const timing = (w.performance && w.performance.timing) || null;
    const navStart = timing && timing.navigationStart ? timing.navigationStart : Date.now();
    const loaded = timing && timing.loadEventEnd ? timing.loadEventEnd : Date.now();
    if (!w.chrome.csi) {
      w.chrome.csi = stub('csi', function csi() {
        return { onloadT: loaded, startE: navStart, pageT: Math.max(0, loaded - navStart), tran: 15 };
      });
    }
    if (!w.chrome.loadTimes) {
      w.chrome.loadTimes = stub('loadTimes', function loadTimes() {
        const seconds = (value) => (value ? value / 1000 : navStart / 1000);
        return {
          requestTime: seconds(timing && timing.requestStart),
          startLoadTime: seconds(timing && timing.navigationStart),
          commitLoadTime: seconds(timing && timing.responseStart),
          finishDocumentLoadTime: seconds(timing && timing.domContentLoadedEventEnd),
          finishLoadTime: seconds(timing && timing.loadEventEnd),
          firstPaintTime: seconds(timing && timing.responseEnd),
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2',
        };
      });
    }
  }

  const MIME_TYPES = [['application/pdf', 'pdf'], ['text/pdf', 'pdf']];
  const PLUGIN_NAMES = [
    'PDF Viewer',
    'Chrome PDF Viewer',
    'Chromium PDF Viewer',
    'Microsoft Edge PDF Viewer',
    'WebKit built-in PDF',
  ];
  const PluginProto = w.Plugin && w.Plugin.prototype;
  const PluginArrayProto = w.PluginArray && w.PluginArray.prototype;
  const MimeTypeProto = w.MimeType && w.MimeType.prototype;
  const MimeTypeArrayProto = w.MimeTypeArray && w.MimeTypeArray.prototype;

  const shape = (object, proto, tag) => {
    if (proto) { try { Object.setPrototypeOf(object, proto); } catch { /* keep plain */ } }
    try { Object.defineProperty(object, Symbol.toStringTag, { configurable: true, value: tag }); } catch { /* keep plain */ }
    return object;
  };

  const mimeEntries = MIME_TYPES.map(([type, suffixes]) => {
    const entry = { type, suffixes, description: 'Portable Document Format', enabledPlugin: null };
    entry.item = markNative(function item() { return entry; }, 'item');
    entry.namedItem = markNative(function namedItem() { return entry; }, 'namedItem');
    return shape(entry, MimeTypeProto, 'MimeType');
  });

  const pluginEntries = PLUGIN_NAMES.map((name) => {
    const entry = {
      name,
      filename: 'internal-pdf-viewer',
      description: 'Portable Document Format',
      length: mimeEntries.length,
    };
    mimeEntries.forEach((mime, index) => { entry[index] = mime; });
    entry.item = markNative(function item(index) { return mimeEntries[index] || null; }, 'item');
    entry.namedItem = markNative(function namedItem(key) {
      return mimeEntries.find((mime) => mime.type === key) || null;
    }, 'namedItem');
    return shape(entry, PluginProto, 'Plugin');
  });

  mimeEntries.forEach((mime) => { mime.enabledPlugin = pluginEntries[0]; });

  const arrayLike = (entries, proto, tag, keyOf) => {
    const list = { length: entries.length };
    entries.forEach((entry, index) => { list[index] = entry; });
    list.item = markNative(function item(index) { return entries[index] || null; }, 'item');
    list.namedItem = markNative(function namedItem(key) {
      return entries.find((entry) => keyOf(entry) === key) || null;
    }, 'namedItem');
    list.refresh = markNative(function refresh() {}, 'refresh');
    return shape(list, proto, tag);
  };

  const plugins = arrayLike(pluginEntries, PluginArrayProto, 'PluginArray', (e) => e.name);
  const mimeTypes = arrayLike(mimeEntries, MimeTypeArrayProto, 'MimeTypeArray', (e) => e.type);
  defineGetter(navProto, 'plugins', plugins);
  defineGetter(navProto, 'mimeTypes', mimeTypes);
  defineGetter(navProto, 'pdfViewerEnabled', true);

  const primary = n.language || (n.languages && n.languages[0]) || 'en-US';
  if (!n.languages || !n.languages.length) defineGetter(navProto, 'languages', [primary]);
  if (!n.vendor) defineGetter(navProto, 'vendor', engine === 'webkit' ? 'Apple Computer, Inc.' : 'Google Inc.');

  if (profile) {
    if (profile.platform) defineGetter(navProto, 'platform', profile.platform);
    else if (isAndroid) defineGetter(navProto, 'platform', 'Linux armv8l');
    if (profile.hardwareConcurrency) defineGetter(navProto, 'hardwareConcurrency', profile.hardwareConcurrency);
    if (profile.deviceMemory) defineGetter(navProto, 'deviceMemory', profile.deviceMemory);
    if (profile.maxTouchPoints !== undefined) defineGetter(navProto, 'maxTouchPoints', profile.maxTouchPoints);
    else if (isAndroid && Number(n.maxTouchPoints) < 5) defineGetter(navProto, 'maxTouchPoints', 5);
  } else if (isAndroid) {
    defineGetter(navProto, 'platform', 'Linux armv8l');
    if (Number(n.maxTouchPoints) < 5) defineGetter(navProto, 'maxTouchPoints', 5);
  }
  if (!Number.isInteger(n.hardwareConcurrency) || n.hardwareConcurrency < 2) defineGetter(navProto, 'hardwareConcurrency', 8);
  if (n.deviceMemory === undefined) defineGetter(navProto, 'deviceMemory', 8);
  if (n.maxTouchPoints === undefined) defineGetter(navProto, 'maxTouchPoints', 0);

  const ScreenProto = w.Screen && w.Screen.prototype;
  const fitScreen = (prop, floor) => {
    const descriptor = ScreenProto && Object.getOwnPropertyDescriptor(ScreenProto, prop);
    const native = descriptor && descriptor.get;
    if (!native) return;
    try {
      Object.defineProperty(ScreenProto, prop, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: markNative(function () {
          const real = Number(native.call(this)) || 0;
          return real > floor ? real : floor;
        }, prop, 'get'),
      });
    } catch { /* keep native */ }
  };
  if (ScreenProto && w.innerWidth && w.innerHeight) {
    fitScreen('width', w.innerWidth + 340);
    fitScreen('availWidth', w.innerWidth + 340);
    fitScreen('height', w.innerHeight + 260);
    fitScreen('availHeight', w.innerHeight + 260);
  }
  if (!w.outerWidth) defineGetter(w, 'outerWidth', w.innerWidth, false);
  if (!w.outerHeight) defineGetter(w, 'outerHeight', w.innerHeight, false);

  const brands = uaMajor
    ? [
        { brand: 'Google Chrome', version: uaMajor },
        { brand: 'Chromium', version: uaMajor },
        { brand: 'Not_A Brand', version: '24' },
      ]
    : [];
  const model = isAndroid
    ? ((ua.match(/Android [\d.]+; ([^;)]+)/) || [])[1] || '').replace(/ Build\/.*/, '')
    : '';
  const fullVersion = uaMajor ? `${uaMajor}.0.0.0` : '';
  const hevPatch = (values, hints) => {
    const out = Object.assign({}, values || {});
    const asked = Array.isArray(hints) ? hints : [];
    const wants = (key) => asked.indexOf(key) !== -1;
    if (uaMajor && (wants('uaFullVersion') || out.uaFullVersion)) out.uaFullVersion = fullVersion;
    if (uaMajor && (wants('fullVersionList') || out.fullVersionList)) out.fullVersionList = brands;
    if (wants('platformVersion') || out.platformVersion) {
      out.platformVersion = isAndroid ? `${androidVersion || '14'}.0.0` : (out.platformVersion || '');
    }
    if (wants('architecture') || out.architecture) out.architecture = isMobile ? 'arm' : (out.architecture || 'x86');
    if (wants('bitness') || out.bitness) out.bitness = '64';
    if (wants('model') || out.model) out.model = model;
    if (wants('wow64') || out.wow64 !== undefined) out.wow64 = false;
    if (wants('formFactors') || out.formFactors) out.formFactors = isMobile ? ['Mobile'] : ['Desktop'];
    out.brands = brands;
    out.mobile = isMobile;
    out.platform = uaPlatform;
    return out;
  };

  const UADProto = w.NavigatorUAData && w.NavigatorUAData.prototype;
  if (UADProto) {
    defineGetter(UADProto, 'brands', brands);
    defineGetter(UADProto, 'mobile', isMobile);
    defineGetter(UADProto, 'platform', uaPlatform);
    patchMethod(UADProto, 'getHighEntropyValues', (original) => function getHighEntropyValues(hints) {
      return Promise.resolve(original.call(this, hints)).then((values) => hevPatch(values, hints));
    });
    patchMethod(UADProto, 'toJSON', () => function toJSON() {
      return { brands, mobile: isMobile, platform: uaPlatform };
    });
  } else if (n.userAgentData) {
    const real = n.userAgentData;
    defineGetter(navProto, 'userAgentData', {
      brands,
      mobile: isMobile,
      platform: uaPlatform,
      getHighEntropyValues: markNative(function getHighEntropyValues(hints) {
        const base = typeof real.getHighEntropyValues === 'function'
          ? real.getHighEntropyValues(hints)
          : Promise.resolve({});
        return Promise.resolve(base).then((values) => hevPatch(values, hints));
      }, 'getHighEntropyValues'),
      toJSON: markNative(function toJSON() {
        return { brands, mobile: isMobile, platform: uaPlatform };
      }, 'toJSON'),
    });
  }

  let realVendor = '';
  let realRenderer = '';
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
    const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
    if (info) {
      realVendor = String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL) || '');
      realRenderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '');
    }
  } catch { /* no webgl */ }

  const software = /swiftshader|software|llvmpipe|microsoft basic|mesa offscreen/i.test(realRenderer);
  let vendor = realVendor;
  let renderer = realRenderer;
  if (profile && (profile.webglVendor || profile.webglRenderer)) {
    vendor = profile.webglVendor || vendor;
    renderer = profile.webglRenderer || renderer;
  } else if (isAndroid) {
    vendor = 'ARM';
    renderer = 'Mali-G715';
  } else if (isIOS) {
    vendor = 'Apple Inc.';
    renderer = 'Apple GPU';
  } else if (software || !realRenderer) {
    if (/Windows/.test(ua)) {
      vendor = 'Google Inc. (NVIDIA)';
      renderer = 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
    } else if (/Macintosh|Mac OS X/.test(ua)) {
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

  const jittered = new WeakSet();
  const jitterCanvas = (canvas) => {
    if (!canvas || jittered.has(canvas)) return;
    const width = canvas.width;
    const height = canvas.height;
    if (!width || !height) return;
    let context = null;
    try { context = canvas.getContext('2d'); } catch { context = null; }
    if (!context) return;
    jittered.add(canvas);
    try {
      const random = seeded(`canvas|${width}x${height}`);
      for (let i = 0; i < 6; i += 1) {
        const x = Math.floor(random() * width);
        const y = Math.floor(random() * height);
        const pixel = context.getImageData(x, y, 1, 1);
        const channel = Math.floor(random() * 3);
        pixel.data[channel] = (pixel.data[channel] + (random() < 0.5 ? 1 : 255)) % 256;
        context.putImageData(pixel, x, y);
      }
    } catch { /* tainted */ }
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
  }
  const context2d = w.CanvasRenderingContext2D && w.CanvasRenderingContext2D.prototype;
  if (context2d) {
    patchMethod(context2d, 'getImageData', (original) => function getImageData(...args) {
      if (this.canvas) jitterCanvas(this.canvas);
      return original.apply(this, args);
    });
  }

  const touchedBuffers = new WeakSet();
  const bufferProto = w.AudioBuffer && w.AudioBuffer.prototype;
  if (bufferProto) {
    patchMethod(bufferProto, 'getChannelData', (original) => function getChannelData(...args) {
      const data = original.apply(this, args);
      try {
        if (data && data.length && !touchedBuffers.has(data)) {
          touchedBuffers.add(data);
          const random = seeded(`audio|${data.length}`);
          for (let i = 0; i < 8; i += 1) {
            const index = Math.floor(random() * data.length);
            data[index] += (random() - 0.5) * 6e-6;
          }
        }
      } catch { /* readonly */ }
      return data;
    });
  }
  const analyserProto = w.AnalyserNode && w.AnalyserNode.prototype;
  if (analyserProto) {
    patchMethod(analyserProto, 'getFloatFrequencyData', (original) => function getFloatFrequencyData(array) {
      const result = original.call(this, array);
      try {
        const random = seeded(`analyser|${array.length}`);
        for (let i = 0; i < array.length; i += 1) array[i] += (random() - 0.5) * 1e-4;
      } catch { /* typed array */ }
      return result;
    });
  }

  if (w.Notification) {
    try {
      Object.defineProperty(w.Notification, 'permission', {
        configurable: true,
        get: markNative(function () { return 'denied'; }, 'permission', 'get'),
      });
    } catch { /* keep native */ }
    patchMethod(w.Notification, 'requestPermission', () => function requestPermission() {
      return Promise.resolve('denied');
    });
  }
  if (w.Permissions && w.Permissions.prototype) {
    const PROMPTABLE = ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read', 'midi'];
    patchMethod(w.Permissions.prototype, 'query', (original) => function query(descriptor) {
      return Promise.resolve(original.call(this, descriptor))
        .then((status) => {
          try {
            if (descriptor && PROMPTABLE.indexOf(descriptor.name) !== -1) {
              Object.defineProperty(status, 'state', {
                configurable: true,
                get: markNative(function () { return 'denied'; }, 'state', 'get'),
              });
            }
          } catch { /* readonly status */ }
          return status;
        })
        .catch(() => original.call(this, descriptor));
    });
  }

  try {
    Object.defineProperty(w, INSTALL_KEY, { configurable: true, value: 7 });
  } catch { /* best effort */ }

  for (const delay of [0, 50, 250, 1000, 3000]) {
    try { setTimeout(sweep, delay); } catch { /* no timers */ }
  }
  if (typeof document !== 'undefined' && document.addEventListener) {
    for (const eventName of ['readystatechange', 'DOMContentLoaded', 'load']) {
      try { document.addEventListener(eventName, sweep, true); } catch { /* no document */ }
    }
  }
}

async function installStealthMask(context, options = {}) {
  if (!context || typeof context.addInitScript !== 'function') return false;
  if (context[CONTEXT_KEY]) return true;
  try { context[CONTEXT_KEY] = true; } catch { /* best effort */ }
  await context.addInitScript(stealthInit, {
    seed: options.seed || stealthSeed('default'),
    profile: options.profile || null,
    engine: options.engine || 'chromium',
  });
  return true;
}

/*
 * Never rejects. A missing WebGL or a failed evaluate degrades to a failed check.
 */
async function collectStealthReport(page) {
  let raw;
  try {
    raw = await page.evaluate(() => {
      const n = navigator;
      const marker = globalThis.__orbitqaStealthVersion || null;
      const nativeOf = (fn) => {
        try { return /native code/.test(Function.prototype.toString.call(fn)); } catch { return false; }
      };
      let renderer = null;
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
        if (info) renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
      } catch { /* no webgl */ }
      let getParameterNative = null;
      try {
        const proto = window.WebGLRenderingContext && WebGLRenderingContext.prototype;
        getParameterNative = proto && proto.getParameter ? nativeOf(proto.getParameter) : null;
      } catch { getParameterNative = null; }
      const uad = n.userAgentData || null;
      return {
        marker,
        webdriver: n.webdriver,
        cdcCount: Object.keys(window).filter((k) => /^cdc_/.test(k)).length,
        chromeRuntime: !!(window.chrome && window.chrome.runtime),
        chromeApp: !!(window.chrome && window.chrome.app),
        pluginCount: (n.plugins || []).length,
        pluginPrototype: !window.PluginArray || n.plugins instanceof window.PluginArray,
        mimePrototype: !window.MimeTypeArray || n.mimeTypes instanceof window.MimeTypeArray,
        enabledPlugin: !n.mimeTypes || !n.mimeTypes.length || n.mimeTypes[0].enabledPlugin === n.plugins[0],
        languageCount: (n.languages || []).length,
        getParameterNative,
        renderer,
        brands: uad ? uad.brands : null,
        mobile: uad ? uad.mobile : null,
        ua: n.userAgent,
      };
    });
  } catch (error) {
    return {
      passed: false,
      checks: [{ id: 'probe', pass: false, fatal: true, detail: String(error?.message || error) }],
      failures: [`probe=${String(error?.message || error)}`],
      warnings: [],
    };
  }

  const check = (id, pass, detail, fatal) => ({ id, pass, fatal: fatal !== false, detail });
  const hasChromeUa = /Chrome\/\d+/.test(String(raw.ua || ''));
  const hasGoogleBrand = Array.isArray(raw.brands)
    ? raw.brands.some((b) => b && b.brand === 'Google Chrome')
    : false;

  const checks = [
    check('marker', raw.marker === 7, raw.marker),
    check('webdriver', raw.webdriver === false, raw.webdriver),
    check('cdc-globals', raw.cdcCount === 0, raw.cdcCount),
    check('chrome-object', raw.chromeRuntime && raw.chromeApp, {
      runtime: raw.chromeRuntime,
      app: raw.chromeApp,
    }),
    check('plugins', raw.pluginCount >= 5, raw.pluginCount),
    check('plugins-prototype', raw.pluginPrototype, null, false),
    check('mimetypes-prototype', raw.mimePrototype, null, false),
    check('enabled-plugin', raw.enabledPlugin, null, false),
    check('languages', raw.languageCount > 0, raw.languageCount),
    check('toString-native', raw.getParameterNative !== false, raw.getParameterNative, false),
    check(
      'renderer',
      !raw.renderer || !/swiftshader|llvmpipe|basic render/i.test(String(raw.renderer)),
      raw.renderer,
      false,
    ),
    check('uach-ua-match', !hasChromeUa || !raw.brands || hasGoogleBrand, raw.brands),
    check(
      'uach-mobile',
      !/Android|iPhone|iPad/.test(String(raw.ua || '')) || raw.mobile === true,
      raw.mobile,
      false,
    ),
    check('no-headless-ua', !/HeadlessChrome/i.test(String(raw.ua || '')), raw.ua),
  ];

  const fatal = checks.filter((c) => c.fatal && !c.pass);
  return {
    passed: fatal.length === 0,
    checks,
    failures: fatal.map((c) => `${c.id}=${JSON.stringify(c.detail)}`),
    warnings: checks.filter((c) => !c.fatal && !c.pass).map((c) => c.id),
  };
}

async function assertStealthMask(page) {
  const report = await collectStealthReport(page);
  if (report.passed) return report;
  throw new Error(`Automation mask incomplete: ${report.failures.join(', ')}`);
}

module.exports = {
  STEALTH_VERSION,
  stealthSeed,
  stealthInit,
  installStealthMask,
  collectStealthReport,
  assertStealthMask,
};