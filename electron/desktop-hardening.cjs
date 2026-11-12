'use strict';

/*
 * desktop-hardening.cjs - OrbitQA Desktop
 *
 * Desktop counterpart to device-hardening.cjs. Keeps the host Chrome identity and
 * only clears the automation surfaces. The JS surface is delegated to
 * stealth-automation-mask.cjs so exactly one module patches the page.
 *
 * Chromium only - WebKit/Gecko have no window.chrome and must not be given one.
 */

const stealth = require('./stealth-automation-mask.cjs');

const HARDENING_EVENT = 'desktop-hardening:diagnostics';

const HARDENING_CHECKS = Object.freeze([
  'automation-flag',
  'runtime-fingerprint',
  'device-identity',
]);

function buildDesktopLaunchArgs(extra = []) {
  return [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=Translate,BackForwardCache,MediaRouter,OptimizationHints',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    ...extra,
  ];
}

/* Removes the "Chrome is being controlled by automated test software" bar. */
const IGNORE_DEFAULT_ARGS = ['--enable-automation'];

async function installDesktopHardening(context, profile, seed) {
  if (!context || typeof context.addInitScript !== 'function') return false;
  await stealth.installStealthMask(context, {
    engine: 'chromium',
    seed: seed || stealth.stealthSeed('desktop', profile?.platform || ''),
    profile: profile || null,
  });
  return true;
}

function prepareDesktopHardening(input = {}) {
  const browserEngine = input.browserEngine || 'chromium';
  const active = browserEngine === 'chromium' && input.enabled !== false;
  const contextOptions = { ...(input.contextOptions || {}) };

  if (active) {
    contextOptions.args = [...(contextOptions.args || []), ...buildDesktopLaunchArgs()];
    // Playwright only applies `screen` when `viewport` is set.
    if (!contextOptions.viewport) {
      contextOptions.viewport = { width: 1280, height: 720 };
    }
    const viewport = contextOptions.viewport;
    if (!contextOptions.screen) {
      contextOptions.screen = {
        width: Math.max(viewport.width + 340, 1920),
        height: Math.max(viewport.height + 260, 1080),
      };
    }
    if (contextOptions.deviceScaleFactor == null) contextOptions.deviceScaleFactor = 1;
    if (input.locale && !contextOptions.locale) contextOptions.locale = input.locale;
    if (input.timezoneId && !contextOptions.timezoneId) contextOptions.timezoneId = input.timezoneId;
  }

  return {
    active,
    contextOptions,
    async afterCreate(context, seed) {
      if (!active) return false;
      return installDesktopHardening(context, input.profile || null, seed);
    },
  };
}

/*
 * `passed` is always true: the run never stops on a hardening finding. Read
 * `blocked` if you want to know whether something decisive is wrong, and
 * `failures` for the exact list.
 */
async function collectDesktopHardeningReport(page) {
  const report = await stealth.collectStealthReport(page);

  let geometry = null;
  try {
    geometry = await page.evaluate(() => ({
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      innerWidth: window.innerWidth,
      outerWidth: window.outerWidth,
      devicePixelRatio: window.devicePixelRatio,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      maxTouchPoints: navigator.maxTouchPoints,
    }));
  } catch { geometry = null; }

  const checks = [...report.checks];
  if (geometry) {
    checks.push({
      id: 'screen-larger-than-window',
      pass: geometry.screenWidth > geometry.innerWidth && geometry.screenWidth >= geometry.outerWidth,
      fatal: false,
      detail: geometry,
    });
    checks.push({
      id: 'runtime-plausible',
      pass: Number(geometry.hardwareConcurrency) >= 2 && geometry.deviceMemory !== undefined,
      fatal: false,
      detail: {
        hardwareConcurrency: geometry.hardwareConcurrency,
        deviceMemory: geometry.deviceMemory,
      },
    });
  }

  const fatal = checks.filter((c) => c.fatal !== false && !c.pass);
  return {
    passed: true,
    blocked: fatal.length > 0,
    checks,
    failures: fatal.map((c) => `${c.id}=${JSON.stringify(c.detail)}`),
    warnings: checks.filter((c) => c.fatal === false && !c.pass).map((c) => c.id),
  };
}

module.exports = {
  HARDENING_EVENT,
  HARDENING_CHECKS,
  IGNORE_DEFAULT_ARGS,
  buildDesktopLaunchArgs,
  collectDesktopHardeningReport,
  installDesktopHardening,
  prepareDesktopHardening,
};