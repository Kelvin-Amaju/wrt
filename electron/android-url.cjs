'use strict';

const { AndroidRuntimeError, sleep } = require('./android-runtime.cjs');

const CHROME = 'com.android.chrome';
const CHROME_MAIN = 'com.android.chrome/com.google.android.apps.chrome.Main';
const CHROME_COMMAND_FILE = '/data/local/tmp/chrome-command-line';
const UI_DUMP = '/sdcard/orbitqa-ui.xml';

const CHROME_FLAGS = [
  'chrome',
  '--disable-fre',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-signin-promo',
  '--disable-fre-promo',
  '--disable-component-update',
].join(' ');

const PROMO_TEXTS = [
  'Accept & continue',
  'Accept and continue',
  'Use without an account',
  'No thanks',
  'Not now',
  'Got it',
  'Continue',
];

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function normalizeUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) throw new AndroidRuntimeError('No URL was supplied.');
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return `https://${trimmed}`;
}

function parseNodes(xml) {
  const nodes = [];
  const tagPattern = /<node\b[^>]*>/g;
  let match;
  while ((match = tagPattern.exec(xml)) !== null) {
    const tag = match[0];
    const textMatch = tag.match(/\btext="([^"]*)"/);
    const idMatch = tag.match(/\bresource-id="([^"]*)"/);
    const boundsMatch = tag.match(/\bbounds="\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]"/);
    if (!boundsMatch) continue;
    const [, x1, y1, x2, y2] = boundsMatch;
    nodes.push({
      text: textMatch ? decodeXml(textMatch[1]) : '',
      id: idMatch ? idMatch[1] : '',
      left: Number(x1),
      top: Number(y1),
      right: Number(x2),
      bottom: Number(y2),
    });
  }
  return nodes;
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function dumpUi(adb) {
  await adb(['shell', 'uiautomator', 'dump', UI_DUMP]).catch(() => {});
  const xml = await adb(['shell', 'cat', UI_DUMP]).catch(() => '');
  return xml || '';
}

async function tap(adb, node) {
  const x = Math.round((node.left + node.right) / 2);
  const y = Math.round((node.top + node.bottom) / 2);
  await adb(['shell', 'input', 'tap', String(x), String(y)]).catch(() => {});
}

async function chromeInstalled(adb) {
  const out = await adb(['shell', 'pm', 'list', 'packages', CHROME]).catch(() => '');
  return out.includes(`package:${CHROME}`);
}

async function prepareChrome(adb) {
  if (!(await chromeInstalled(adb))) {
    throw new AndroidRuntimeError(
      'Chrome is not installed on this device. Use a Play Store system image.',
    );
  }

  await adb(['shell', 'am', 'force-stop', CHROME]).catch(() => {});
  await adb(['shell', `echo ${shellQuote(CHROME_FLAGS)} > ${CHROME_COMMAND_FILE}`])
    .catch(() => {});
  await adb(['shell', 'am', 'set-debug-app', '--persistent', CHROME]).catch(() => {});
  await adb(['shell', 'cmd', 'role', 'add-role-holder', 'android.app.role.BROWSER', CHROME])
    .catch(() => {});
}

async function dismissChromePromo(adb) {
  const xml = await dumpUi(adb);
  if (!xml) return false;
  const nodes = parseNodes(xml);
  for (const wanted of PROMO_TEXTS) {
    const node = nodes.find(
      (candidate) => candidate.text.trim().toLowerCase() === wanted.toLowerCase(),
    );
    if (node) {
      await tap(adb, node);
      await sleep(400);
      return true;
    }
  }
  return false;
}

async function assertUrlLoaded(adb, url, timeoutMs) {
  const expected = new URL(url).host.replace(/^www\./i, '').toLowerCase();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const xml = await dumpUi(adb);
    const bar = parseNodes(xml).find((node) => node.id.endsWith('url_bar'));
    if (bar && bar.text.toLowerCase().includes(expected)) return true;

    if (/Welcome to Chrome|Turn on sync|Make Chrome your own/i.test(xml)) {
      await dismissChromePromo(adb);
    }
    await sleep(700);
  }

  throw new AndroidRuntimeError(`Chrome never loaded ${url}.`);
}

async function openUrl(adb, rawUrl, options) {
  const url = normalizeUrl(rawUrl);
  const timeoutMs = options?.timeoutMs ?? 25000;

  await prepareChrome(adb);

  const command =
    `am start -a android.intent.action.VIEW -d ${shellQuote(url)} ` +
    `-n ${CHROME_MAIN} --activity-clear-top --activity-single-top`;

  const output = await adb(['shell', command]);

  if (/Error|Activity not started|unable to resolve/i.test(output)) {
    throw new AndroidRuntimeError(
      `Chrome refused the navigation intent: ${output.trim()}`,
    );
  }

  await assertUrlLoaded(adb, url, timeoutMs);
  return { url, serial: options?.serial || null };
}

module.exports = {
  CHROME,
  CHROME_MAIN,
  assertUrlLoaded,
  chromeInstalled,
  dismissChromePromo,
  dumpUi,
  normalizeUrl,
  openUrl,
  parseNodes,
  prepareChrome,
  shellQuote,
};