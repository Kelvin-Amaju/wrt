const { clickWithInteractionIndicator } = require('../interaction-indicator.cjs');
const { resolveSimulatedReferrer } = require('./referrer-simulation.cjs');
const { navigateDirectRandomized } = require('./direct-navigation.cjs');

const UNSAFE_TEXT = /(?:sponsored|advertis|logout|log out|sign out|delete|remove account|unsubscribe|purchase|buy now|checkout|payment|download|install|allow notifications?)/i;
const UNSAFE_HOST_OR_PATH = /(?:doubleclick|googlesyndication|adservice|\/ads?(?:\/|$)|affiliate\/click|logout|signout|delete-account)/i;

function normalizeHttpUrl(value, base) {
  try {
    const url = new URL(String(value || '').trim(), base || undefined);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

function comparableUrl(value, base) {
  const url = normalizeHttpUrl(value, base);
  if (!url) return '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  return url.toString().replace(/\/$/, '');
}

async function candidateSnapshot(locator) {
  try {
    return await locator.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const anchor = el.matches?.('a[href],area[href]') ? el : (el.closest?.('a[href]') || el.querySelector?.('a[href]'));
      const href = anchor?.href || el.getAttribute?.('data-href') || '';
      return {
        href,
        text: String(el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 240),
        aria: String(el.getAttribute?.('aria-label') || '').trim().slice(0, 160),
        title: String(el.getAttribute?.('title') || '').trim().slice(0, 160),
        download: Boolean(anchor?.hasAttribute?.('download')),
        visible: rect.width > 2 && rect.height > 2 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || '1') > 0.05,
      };
    });
  } catch { return null; }
}

function scoreCandidate(meta, currentUrl, requestedTarget) {
  if (!meta?.visible || meta.download) return -Infinity;
  const label = `${meta.text || ''} ${meta.aria || ''} ${meta.title || ''}`.trim();
  if (UNSAFE_TEXT.test(label)) return -Infinity;
  const href = normalizeHttpUrl(meta.href, currentUrl);
  if (!href) return -Infinity;
  const current = normalizeHttpUrl(currentUrl);
  if (!current) return -Infinity;
  if (comparableUrl(href) === comparableUrl(current)) return -Infinity;
  if (UNSAFE_HOST_OR_PATH.test(`${href.hostname}${href.pathname}`)) return -Infinity;

  const requested = String(requestedTarget || '').trim();
  if (requested) {
    const requestedUrl = normalizeHttpUrl(requested, currentUrl);
    if (requestedUrl) {
      if (comparableUrl(href) !== comparableUrl(requestedUrl)) return -Infinity;
      return 1000;
    }
    const needle = requested.toLowerCase();
    const haystack = `${label} ${href.toString()}`.toLowerCase();
    if (!haystack.includes(needle)) return -Infinity;
    return 900;
  }

  let score = 10;
  if (href.hostname !== current.hostname) score += 100;
  if (label.length > 0 && label.length < 100) score += 10;
  if (/continue|visit|open|read|learn|website|more|next|go to/i.test(label)) score += 12;
  return score;
}

async function chooseReferralTarget(page, requestedTarget) {
  const selector = 'a[href], area[href], button, [role="button"]';
  const collection = page.locator(selector);
  const count = Math.min(150, await collection.count());
  const currentUrl = page.url();
  const scored = [];
  for (let index = 0; index < count; index += 1) {
    const locator = collection.nth(index);
    const meta = await candidateSnapshot(locator);
    const score = scoreCandidate(meta, currentUrl, requestedTarget);
    if (Number.isFinite(score)) scored.push({ locator, meta, score, index });
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0] || null;
}

async function waitForReferralDestination(page, context, beforePages, beforeUrl, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const pages = typeof context?.pages === 'function' ? context.pages() : [];
    const newPage = pages.find((candidate) => !beforePages.has(candidate));
    if (newPage) {
      await newPage.waitForLoadState?.('domcontentloaded', { timeout: Math.max(500, timeoutMs - (Date.now() - started)) }).catch(() => undefined);
      return newPage;
    }
    const current = page.url();
    if (current && comparableUrl(current) !== comparableUrl(beforeUrl)) {
      await page.waitForLoadState?.('domcontentloaded', { timeout: Math.max(500, timeoutMs - (Date.now() - started)) }).catch(() => undefined);
      return page;
    }
    await page.waitForTimeout?.(120).catch(() => undefined);
  }
  throw new Error('Site Referral QA clicked the referral control but no destination navigation was observed');
}


async function findGoogleTargetResult(page, targetUrl) {
  const wanted = normalizeHttpUrl(targetUrl);
  if (!wanted || typeof page?.locator !== 'function') return null;
  const anchors = page.locator('a[href]');
  const count = Math.min(240, await anchors.count());
  for (let index = 0; index < count; index += 1) {
    const locator = anchors.nth(index);
    const meta = await candidateSnapshot(locator);
    if (!meta?.visible || meta.download) continue;
    const label = `${meta.text || ''} ${meta.aria || ''} ${meta.title || ''}`.trim();
    if (UNSAFE_TEXT.test(label) || /\b(sponsored|ad)\b/i.test(label)) continue;
    const href = normalizeHttpUrl(meta.href, 'https://www.google.com/');
    if (!href) continue;
    if (href.hostname === 'www.google.com' || href.hostname.endsWith('.google.com')) continue;
    if (comparableUrl(href) === comparableUrl(wanted)) return { locator, meta, index };
    if (href.hostname.toLowerCase() === wanted.hostname.toLowerCase() && href.pathname.replace(/\/$/,'') === wanted.pathname.replace(/\/$/,'')) {
      return { locator, meta, index };
    }
  }
  return null;
}

async function navigateThroughGoogleSearch({ page, targetUrl, timeoutMs, interactionMode, log }) {
  const requested = normalizeHttpUrl(targetUrl);
  if (!requested) throw new Error('Google Search Referrer QA requires a valid http(s) target URL');
  log('Referrer QA: Google Search · opening Google first');
  await page.goto('https://www.google.com/', { waitUntil:'domcontentloaded', timeout:timeoutMs });
  await page.waitForTimeout?.(350).catch(() => undefined);

  const search = page.locator?.('textarea[name="q"], input[name="q"], [role="combobox"][name="q"]').first();
  if (!search) throw new Error('Google Search Referrer QA could not access the Google search field');
  try {
    await search.waitFor?.({ state:'visible', timeout:Math.min(10000, timeoutMs) });
  } catch {
    throw new Error('Google Search Referrer QA could not find an interactive Google search field; CAPTCHA/consent/manual attention may be required');
  }
  await search.fill?.(requested.toString());
  if (typeof search.press === 'function') await search.press('Enter');
  else throw new Error('Google Search Referrer QA could not submit the Google search query');
  await page.waitForLoadState?.('domcontentloaded', { timeout:timeoutMs }).catch(() => undefined);
  log(`Referrer QA: Google searched for target URL · ${requested.toString()}`);

  let selected = null;
  for (let round = 0; round < 10; round += 1) {
    selected = await findGoogleTargetResult(page, requested.toString());
    if (selected) break;
    const moved = await page.evaluate?.(() => {
      const root = document.documentElement;
      const body = document.body;
      const before = window.scrollY || root?.scrollTop || body?.scrollTop || 0;
      const viewport = Math.max(300, window.innerHeight || root?.clientHeight || 800);
      const total = Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0);
      const next = Math.min(Math.max(0, total - viewport), before + Math.max(420, Math.floor(viewport * 0.78)));
      window.scrollTo({ top:next, left:0, behavior:'smooth' });
      return next > before + 5;
    }).catch(() => false);
    if (!moved) break;
    await page.waitForTimeout?.(500).catch(() => undefined);
  }
  if (!selected) throw new Error(`Google Search Referrer QA could not find the target link in the loaded Google results: ${requested.toString()}`);

  const context = typeof page.context === 'function' ? page.context() : null;
  const beforePages = new Set(typeof context?.pages === 'function' ? context.pages() : [page]);
  const googleResultsUrl = page.url();
  log('Referrer QA: target result found on Google · clicking the result');
  await clickWithInteractionIndicator(page, selected.locator, { mode:interactionMode, timeout:Math.min(10000, timeoutMs), steps:12, delay:85 });
  const destinationPage = await waitForReferralDestination(page, context, beforePages, googleResultsUrl, timeoutMs);
  const finalUrl = destinationPage.url();
  const reached = normalizeHttpUrl(finalUrl);
  if (!reached || reached.hostname.toLowerCase() !== requested.hostname.toLowerCase()) {
    throw new Error(`Google Search Referrer QA reached an unexpected destination instead of ${requested.hostname}`);
  }
  log(`Referrer QA: Google click-through reached target · ${finalUrl}`);
  return { page:destinationPage, finalUrl, mode:'google-simulated', referralUrl:googleResultsUrl };
}

async function navigateWithReferrerQa({ page, targetUrl, autoQa = {}, executionMode = 'visible', timeoutMs = 30000, interactionMode = 'cursor', log = () => {}, random = Math.random, nativeDirectNavigate }) {
  const mode = autoQa.referrerMode || 'direct';
  if (mode === 'direct') {
    return navigateDirectRandomized({ page, targetUrl, executionMode, timeoutMs, log, random, autoType:autoQa.directAutoType === true, ...(nativeDirectNavigate ? { nativeNavigateImpl:nativeDirectNavigate } : {}) });
  }
  if (mode === 'google-simulated') {
    return navigateThroughGoogleSearch({ page, targetUrl, timeoutMs, interactionMode, log });
  }
  if (mode !== 'site-referral') {
    const referrer = resolveSimulatedReferrer(autoQa || {});
    const options = { waitUntil:'domcontentloaded', timeout:timeoutMs };
    if (referrer.value) options.referer = referrer.value;
    if (referrer.simulated) log(`Referrer QA: ${referrer.label}`);
    await page.goto(targetUrl, options);
    return { page, finalUrl:typeof page.url === 'function' ? page.url() : targetUrl, mode, referralUrl:null };
  }

  log('Referrer QA: Site Referral · opening referral page first');
  await page.goto(targetUrl, { waitUntil:'domcontentloaded', timeout:timeoutMs });
  await page.waitForTimeout?.(Math.min(900, Math.max(250, Math.floor(timeoutMs / 20)))).catch(() => undefined);
  const referralUrl = page.url();
  const requestedTarget = String(autoQa.siteReferralTarget || '').trim();
  const selected = await chooseReferralTarget(page, requestedTarget);
  if (!selected) {
    throw new Error(requestedTarget
      ? `Site Referral QA could not find the requested referral target: ${requestedTarget}`
      : 'Site Referral QA could not find a safe outbound referral link or linked button');
  }

  const context = typeof page.context === 'function' ? page.context() : null;
  const beforePages = new Set(typeof context?.pages === 'function' ? context.pages() : [page]);
  const destinationHint = selected.meta?.href || selected.meta?.text || 'referral target';
  log(`Site Referral QA: clicking ${requestedTarget ? 'requested' : 'safe outbound'} referral target · ${String(destinationHint).slice(0, 180)}`);
  await clickWithInteractionIndicator(page, selected.locator, { mode:interactionMode, timeout:Math.min(10000, timeoutMs), steps:12, delay:85 });
  const destinationPage = await waitForReferralDestination(page, context, beforePages, referralUrl, timeoutMs);
  const finalUrl = destinationPage.url();
  if (!normalizeHttpUrl(finalUrl)) throw new Error('Site Referral QA destination is not an http(s) page');
  if (comparableUrl(finalUrl) === comparableUrl(referralUrl)) throw new Error('Site Referral QA did not leave the referral page');
  if (requestedTarget) {
    const requestedUrl = normalizeHttpUrl(requestedTarget, referralUrl);
    if (requestedUrl && comparableUrl(finalUrl) !== comparableUrl(requestedUrl)) {
      throw new Error(`Site Referral QA reached an unexpected destination instead of the requested referral target`);
    }
  }
  log(`Site Referral QA: destination reached · ${finalUrl}`);
  return { page:destinationPage, finalUrl, mode, referralUrl };
}

module.exports = {
  normalizeHttpUrl,
  comparableUrl,
  scoreCandidate,
  chooseReferralTarget,
  findGoogleTargetResult,
  navigateThroughGoogleSearch,
  navigateWithReferrerQa,
};
