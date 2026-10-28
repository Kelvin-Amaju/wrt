#!/usr/bin/env node
'use strict';

/*
 * tools/check-desktop-hardening.cjs
 *
 * Verifies that desktop hardening actually changes the observable surface.
 *
 *   node tools/check-desktop-hardening.cjs
 *   node tools/check-desktop-hardening.cjs --compare
 *   node tools/check-desktop-hardening.cjs --target https://pixelscan.net --compare
 *   node tools/check-desktop-hardening.cjs --headless
 *
 * Exits non-zero when a hardened gate fails, so it is CI-usable.
 */

const { chromium } = require('playwright');
const desktopHardening = require('../electron/desktop-hardening.cjs');
const { resolveInstalledChrome } = require('../electron/chrome-runtime-resolver.cjs');

const DEFAULT_TARGET = 'https://bot.sannysoft.com';

const COMPARE_KEYS = [
  'webdriver',
  'cdcKeys',
  'chromeRuntime',
  'chromeApp',
  'chromeCsi',
  'notificationPermission',
  'permissionQuery',
  'getParameterSource',
  'hardwareConcurrency',
  'deviceMemory',
  'maxTouchPoints',
  'platform',
];

function parseArgs(argv) {
  const options = { target: DEFAULT_TARGET, compare: false, headed: true };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--compare') options.compare = true;
    else if (arg === '--headless') options.headed = false;
    else if (arg === '--target') options.target = argv[index + 1] || DEFAULT_TARGET;
  }
  return options;
}

function resolveExecutablePath() {
  try {
    const resolved = resolveInstalledChrome();
    if (resolved?.found && resolved.executablePath) return resolved.executablePath;
  } catch {
    /* fall through to bundled chromium */
  }
  return undefined;
}

async function observe(page) {
  return page.evaluate(async () => {
    const n = navigator;
    const out = {
      webdriver: n.webdriver,
      cdcKeys: Object.keys(window).filter((key) => /^cdc_/.test(key)),
      chromeRuntime: !!(window.chrome && window.chrome.runtime),
      chromeApp: !!(window.chrome && window.chrome.app),
      chromeCsi: typeof (window.chrome && window.chrome.csi),
      userAgent: n.userAgent,
      platform: n.platform,
      hardwareConcurrency: n.hardwareConcurrency,
      deviceMemory: n.deviceMemory,
      maxTouchPoints: n.maxTouchPoints,
      language: n.language,
      languages: (n.languages || []).join(','),
      notificationPermission:
        typeof Notification !== 'undefined' ? Notification.permission : 'n/a',
      permissionQuery: 'n/a',
      webglVendor: null,
      webglRenderer: null,
      getParameterSource: '',
      uaChModel: null,
      uaChPlatform: null,
      uaChArchitecture: null,
      outerEqualsInner: window.outerWidth === window.innerWidth,
    };

    try {
      out.getParameterSource = Function.prototype.toString.call(
        WebGLRenderingContext.prototype.getParameter,
      );
    } catch {
      /* ignore */
    }

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
    } catch {
      /* ignore */
    }

    try {
      if (n.userAgentData && typeof n.userAgentData.getHighEntropyValues === 'function') {
        const high = await n.userAgentData.getHighEntropyValues([
          'model',
          'platform',
          'platformVersion',
          'architecture',
          'bitness',
        ]);
        out.uaChModel = high.model || null;
        out.uaChPlatform = high.platform || null;
        out.uaChArchitecture = high.architecture || null;
      }
    } catch {
      /* ignore */
    }

    try {
      if (n.permissions && typeof n.permissions.query === 'function') {
        const status = await n.permissions.query({ name: 'notifications' });
        out.permissionQuery = status.state;
      }
    } catch {
      /* ignore */
    }

    return out;
  });
}

async function runOnce({ hardened, options }) {
  const executablePath = resolveExecutablePath();
  const launchOptions = { headless: !options.headed };
  if (executablePath) launchOptions.executablePath = executablePath;
  if (hardened) {
    launchOptions.args = desktopHardening.buildDesktopLaunchArgs();
    launchOptions.ignoreDefaultArgs = [...desktopHardening.IGNORE_DEFAULT_ARGS];
  }

  const browser = await chromium.launch(launchOptions);
  try {
    const context = await browser.newContext();
    if (hardened) await desktopHardening.installDesktopHardening(context);
    const page = await context.newPage();
    await page.goto(options.target, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500);
    const observed = await observe(page);
    const report = await desktopHardening.collectDesktopHardeningReport(page);
    return { observed, report };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function printReport(label, observed, report) {
  console.log('');
  console.log(`── ${label} ──`);
  for (const check of report.checks) {
    console.log(`${check.pass ? '  ok  ' : ' FAIL '} ${check.id}`);
    for (const [key, value] of Object.entries(check.detail)) {
      console.log(`          ${key}: ${JSON.stringify(value)}`);
    }
  }
  console.log('  observed:');
  for (const key of [
    'userAgent',
    'platform',
    'hardwareConcurrency',
    'deviceMemory',
    'maxTouchPoints',
    'language',
    'languages',
    'webglVendor',
    'webglRenderer',
    'uaChModel',
    'uaChPlatform',
    'uaChArchitecture',
  ]) {
    console.log(`          ${key}: ${JSON.stringify(observed[key])}`);
  }
}

function printDiff(baseline, hardened) {
  console.log('');
  console.log('── difference (baseline → hardened) ──');
  let changed = 0;
  for (const key of COMPARE_KEYS) {
    const before = JSON.stringify(baseline[key]);
    const after = JSON.stringify(hardened[key]);
    if (before === after) continue;
    changed += 1;
    console.log(`  CHANGED  ${key}`);
    console.log(`           before: ${before}`);
    console.log(`           after:  ${after}`);
  }
  if (changed === 0) {
    console.log('  nothing changed — hardening had no observable effect');
  } else {
    console.log(`  ${changed} observable field(s) changed`);
  }
  return changed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`target: ${options.target}`);
  console.log(`mode:   ${options.headed ? 'headed' : 'headless'}${options.compare ? ' · compare' : ''}`);

  const hardenedRun = await runOnce({ hardened: true, options });
  printReport('hardened', hardenedRun.observed, hardenedRun.report);

  let diffCount = 0;
  if (options.compare) {
    const baselineRun = await runOnce({ hardened: false, options });
    printReport('baseline (no hardening)', baselineRun.observed, baselineRun.report);
    diffCount = printDiff(baselineRun.observed, hardenedRun.observed);
  }

  const failed = hardenedRun.report.checks.filter((check) => !check.pass);
  console.log('');
  if (failed.length === 0) {
    console.log('RESULT: all three gates passed.');
  } else {
    console.log(`RESULT: ${failed.length} gate(s) failed: ${failed.map((c) => c.id).join(', ')}`);
  }
  if (options.compare && diffCount === 0) {
    console.log('WARNING: hardening produced no observable change.');
  }

  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});