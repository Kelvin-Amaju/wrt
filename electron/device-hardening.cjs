'use strict';

/**
 * device-hardening.cjs - OrbitQA Desktop
 *
 * Makes a hardened AVD or Android-emulation session report as retail hardware to
 * browser-layer bot / fingerprint gates. Owns the device profiles, the guest
 * build props and the launch args. The JS surface is delegated to
 * stealth-automation-mask.cjs so only one module patches the page.
 */

const stealth = require('./stealth-automation-mask.cjs');

const DEFAULT_REAL_DEVICE_AVD = 'OrbitQA_Pixel_7_Real';
const HARDENING_EVENT = 'device-hardening:diagnostics';

const HARDENING_CHECKS = Object.freeze([
  'automation-flag',
  'runtime-fingerprint',
  'device-identity',
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
    emulator: { ramMb: 4096, heapMb: 512 },
  }),
});

const ANDROID_EMULATION_DEVICES = Object.freeze({
  'pixel 11': { model: 'Pixel 11', androidVersion: '17', webglVendor: 'ARM', webglRenderer: 'Mali-G715', screen: { width: 412, height: 923, dpr: 2.625 } },
  'pixel 11 pro': { model: 'Pixel 11 Pro', androidVersion: '17', webglVendor: 'ARM', webglRenderer: 'Mali-G715', screen: { width: 427, height: 952, dpr: 3 } },
  'pixel 11 pro xl': { model: 'Pixel 11 Pro XL', androidVersion: '17', webglVendor: 'ARM', webglRenderer: 'Mali-G715', screen: { width: 448, height: 997, dpr: 3 } },
  'galaxy s26': { model: 'SM-S942B', androidVersion: '16', webglVendor: 'Qualcomm', webglRenderer: 'Adreno (TM) 840', screen: { width: 360, height: 780, dpr: 3 } },
  'galaxy s26+': { model: 'SM-S947B', androidVersion: '16', webglVendor: 'Qualcomm', webglRenderer: 'Adreno (TM) 840', screen: { width: 384, height: 832, dpr: 3.75 } },
  'galaxy s26 ultra': { model: 'SM-S948B', androidVersion: '16', webglVendor: 'Qualcomm', webglRenderer: 'Adreno (TM) 840', screen: { width: 384, height: 832, dpr: 3.75 } },
  'galaxy s26 fe': { model: 'SM-S741B', androidVersion: '16', webglVendor: 'Qualcomm', webglRenderer: 'Adreno (TM) 730', screen: { width: 360, height: 780, dpr: 3 } },
  'galaxy z flip8': { model: 'SM-F776B', androidVersion: '16', webglVendor: 'Qualcomm', webglRenderer: 'Adreno (TM) 840', screen: { width: 360, height: 840, dpr: 3 } },
  'galaxy z fold8 (open)': { model: 'SM-F971B', androidVersion: '16', webglVendor: 'Qualcomm', webglRenderer: 'Adreno (TM) 840', screen: { width: 816, height: 616, dpr: 3 } },
  'pixel 7': { model: 'Pixel 7', androidVersion: '14', webglVendor: 'ARM', webglRenderer: 'Mali-G710', screen: { width: 412, height: 915, dpr: 2.625 } },
  'pixel 5': { model: 'Pixel 5', androidVersion: '14', webglVendor: 'Qualcomm', webglRenderer: 'Adreno (TM) 620', screen: { width: 393, height: 851, dpr: 2.75 } },
  'galaxy s23': { model: 'SM-S911B', androidVersion: '14', webglVendor: 'Qualcomm', webglRenderer: 'Adreno (TM) 740', screen: { width: 360, height: 780, dpr: 3 } },
});

const UA_DEVICE_RE = /(Linux; Android [\d.]+; )([^;)]+)((?: Build\/[^;)]+)?)(\))/;

function normalise(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findEmulationDevice(input) {
  const key = normalise(input);
  if (!key) return null;
  if (ANDROID_EMULATION_DEVICES[key]) return { key, override: ANDROID_EMULATION_DEVICES[key] };
  for (const name of Object.keys(ANDROID_EMULATION_DEVICES)) {
    if (key.includes(name)) return { key: name, override: ANDROID_EMULATION_DEVICES[name] };
  }
  return null;
}

function buildEmulationProfile(key, override) {
  const base = REAL_DEVICE_PROFILES['pixel-7-panther'];
  return {
    ...base,
    id: `android-emulation:${key.replace(/[^a-z0-9]+/g, '-')}`,
    avdNames: [],
    match: [key],
    emulationOnly: true,
    model: override.model,
    androidVersion: override.androidVersion,
    platformVersion: `${override.androidVersion}.0.0`,
    hardwareConcurrency: override.hardwareConcurrency || base.hardwareConcurrency,
    deviceMemory: override.deviceMemory || base.deviceMemory,
    webglVendor: override.webglVendor,
    webglRenderer: override.webglRenderer,
    screen: override.screen || base.screen,
  };
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
  const emulation = findEmulationDevice(input);
  if (emulation) return buildEmulationProfile(emulation.key, emulation.override);
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
    '--disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--window-size=${p.screen.width},${p.screen.height}`,
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
    `ro.vendor.build.fingerprint=${p.buildFingerprint}`,
    `ro.boot.qemu=0`,
  ];
}

function buildHardeningUserAgent(profile, baseUa) {
  const p = resolveProfile(profile);
  const ua = String(baseUa || '');
  const versionMatch = /Chrome\/(\d+)/.exec(ua);
  const chromeVersion = versionMatch ? versionMatch[1] : '120';
  if (/Android/.test(ua)) return ua.replace(UA_DEVICE_RE, `$1${p.model}$3$4`);
  return `Mozilla/5.0 (Linux; Android ${p.androidVersion}; ${p.model}) AppleWebKit/537.36 ` +
    `(KHTML, like Gecko) Chrome/${chromeVersion}.0.0.0 Mobile Safari/537.36`;
}

async function installDeviceHardening(target, profile, seed) {
  const p = resolveProfile(profile);
  if (!target || typeof target.addInitScript !== 'function') return false;
  await stealth.installStealthMask(target, {
    engine: 'chromium',
    seed: seed || stealth.stealthSeed(p.id),
    profile: p,
  });
  return true;
}

function prepareHardening(input = {}) {
  const profile = findRealDeviceProfile(input.avdName || input.deviceName || input.model);
  const deviceMode = input.deviceMode || 'desktop';
  const active = Boolean(profile) && (deviceMode === 'android' || deviceMode === 'android-emulation');
  const contextOptions = { ...(input.contextOptions || {}) };

  if (active) {
    contextOptions.args = [...(contextOptions.args || []), ...buildHardeningArgs(profile)];
    contextOptions.userAgent = buildHardeningUserAgent(profile, contextOptions.userAgent);
    contextOptions.hasTouch = true;
    contextOptions.isMobile = true;
    if (contextOptions.deviceScaleFactor == null) contextOptions.deviceScaleFactor = profile.screen.dpr;
    if (!contextOptions.viewport) contextOptions.viewport = { width: profile.screen.width, height: profile.screen.height };
    if (!contextOptions.screen) contextOptions.screen = { width: profile.screen.width, height: profile.screen.height };
  }

  return {
    profile,
    active,
    contextOptions,
    async afterCreate(context, seed) {
      if (!active) return false;
      return installDeviceHardening(context, profile, seed);
    },
  };
}

/* `passed` is always true: the run never stops on a hardening finding. */
async function collectHardeningReport(page, profile) {
  const p = resolveProfile(profile);
  const report = await stealth.collectStealthReport(page);

  let raw = null;
  try {
    raw = await page.evaluate(async () => {
      const n = navigator;
      let uad = null;
      try {
        if (n.userAgentData) {
          const high = await n.userAgentData.getHighEntropyValues(['model', 'platformVersion', 'architecture', 'bitness']);
          uad = {
            model: high.model,
            platformVersion: high.platformVersion,
            platform: n.userAgentData.platform,
            mobile: n.userAgentData.mobile,
          };
        }
      } catch { /* uach unavailable */ }
      let renderer = null;
      try {
        const gl = document.createElement('canvas').getContext('webgl');
        const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
        if (info) renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
      } catch { /* no webgl */ }
      return {
        ua: n.userAgent,
        platform: n.platform,
        maxTouchPoints: n.maxTouchPoints,
        uaDataCtor: n.userAgentData && n.userAgentData.constructor ? n.userAgentData.constructor.name : null,
        uad,
        renderer,
      };
    });
  } catch { raw = null; }

  const checks = [...report.checks];
  if (raw) {
    checks.push({
      id: 'device-identity',
      pass: raw.ua.includes(p.model) &&
        raw.ua.includes(`Android ${p.androidVersion}`) &&
        !/sdk_gphone|generic/i.test(raw.ua) &&
        raw.platform === p.platform &&
        raw.maxTouchPoints === p.maxTouchPoints &&
        raw.renderer === p.webglRenderer &&
        (!raw.uaDataCtor || raw.uaDataCtor === 'NavigatorUAData') &&
        (!raw.uad || (raw.uad.model === p.model && raw.uad.platform === 'Android')),
      fatal: true,
      detail: {
        userAgent: raw.ua,
        platform: raw.platform,
        maxTouchPoints: raw.maxTouchPoints,
        renderer: raw.renderer,
        uaDataCtor: raw.uaDataCtor,
        userAgentData: raw.uad,
      },
    });
  }

  const fatal = checks.filter((c) => c.fatal !== false && !c.pass);
  return {
    profile: p.id,
    passed: true,
    blocked: fatal.length > 0,
    checks,
    failures: fatal.map((c) => `${c.id}=${JSON.stringify(c.detail)}`),
    warnings: checks.filter((c) => c.fatal === false && !c.pass).map((c) => c.id),
  };
}

module.exports = {
  DEFAULT_REAL_DEVICE_AVD,
  HARDENING_EVENT,
  HARDENING_CHECKS,
  REAL_DEVICE_PROFILES,
  ANDROID_EMULATION_DEVICES,
  normalise,
  findEmulationDevice,
  findRealDeviceProfile,
  isHardenedAvd,
  resolveProfile,
  buildHardeningArgs,
  buildHardeningProps,
  buildHardeningUserAgent,
  installDeviceHardening,
  prepareHardening,
  collectHardeningReport,
};