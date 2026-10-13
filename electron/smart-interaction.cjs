const {waitBeforePageInteraction}=require('./mandatory-interaction-delay.cjs');
const { createBlockingSurfaceResolver } = require('./blocking-surface-resolver.cjs');
const { browseScrollSurface } = require('./scroll-surface-driver.cjs');
const INPUT_SELECTOR = 'input, textarea, [contenteditable="true"]';
const ACTION_SELECTOR = 'button, input[type="submit"], input[type="button"], a[role="button"], a[download]';
const OVERLAY_DISMISS_SELECTOR = 'button, input[type="button"], input[type="submit"], a, [role="button"], [aria-label], [title], [data-dismiss], [data-close], [class*="close" i], [id*="close" i]';
const SENSITIVE_FIELD_PATTERN = /(password|passcode|otp|one[- ]?time|verification|card|cvv|cvc|credit|debit|bank|account\s*(number|no\.?|#)|ssn|social\s*security|secret|token|pin)/i;
const DANGEROUS_ACTION_PATTERN = /(delete|remove|purchase|buy|pay|checkout|place\s*order|subscribe|sign\s*in|log\s*in|logout|sign\s*out|accept\s*all|allow\s*all|confirm\s*purchase)/i;
const SAFE_ACTION_TERMS = ['submit', 'search', 'go', 'copy', 'download', 'refresh', 'load more', 'play', 'send', 'apply', 'continue', 'next', 'open', 'view', 'show more', 'learn more'];
const OVERLAY_DISMISS_TERMS = ['close', 'cancel', 'dismiss', 'no thanks', 'no, thanks', 'not now', 'maybe later', '×', 'x'];


async function waitForPage(page, lifetime, ms) {
  if (lifetime && typeof lifetime.wait === 'function') return lifetime.wait(ms);
  return page.waitForTimeout(ms);
}

async function smoothScrollBy(page, distance, options = {}) {
  const total = Number(distance) || 0;
  if (!total) return;
  const chunkSize = Math.max(1, Number(options.chunkSize) || 65);
  const delayMs = Math.max(0, Number(options.delayMs) || 60);
  const direction = total < 0 ? -1 : 1;
  let remaining = Math.abs(total);

  while (remaining > 0) {
    const amount = Math.min(chunkSize, remaining) * direction;
    await page.evaluate((delta) => window.scrollBy(0, delta), amount);
    remaining -= Math.abs(amount);
    if (remaining > 0 && delayMs > 0) await waitForPage(page, options.lifetime, delayMs);
  }
}

async function readScrollMetrics(page) {
  try {
    const metrics = await page.evaluate(() => {
      const root = document.scrollingElement || document.documentElement;
      const scrollY = Number(window.scrollY || root.scrollTop || 0);
      const scrollHeight = Math.max(root.scrollHeight || 0, document.body?.scrollHeight || 0);
      const viewportHeight = Number(window.innerHeight || root.clientHeight || 0);
      return { scrollY, maxScroll: Math.max(0, scrollHeight - viewportHeight) };
    });
    if (!metrics || !Number.isFinite(metrics.scrollY) || !Number.isFinite(metrics.maxScroll)) return null;
    return metrics;
  } catch {
    return null;
  }
}

async function smoothScrollDocument(page, direction, options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  const onStep = typeof options.onStep === 'function' ? options.onStep : null;
  const metrics = await readScrollMetrics(page);
  if (!metrics) {
    const fallback = Math.max(300, Math.min(Number(options.fallbackDistance) || 900, 1800));
    await smoothScrollBy(page, direction === 'up' ? -fallback : fallback, { chunkSize: 55, delayMs: 70 });
    return;
  }

  const rawTargetRatio = Number(options.targetRatio);
  const targetRatio = Number.isFinite(rawTargetRatio)
    ? Math.max(0, Math.min(1, rawTargetRatio))
    : (direction === 'up' ? 0 : 1);
  const target = metrics.maxScroll * targetRatio;
  const chunkSize = Math.max(20, Number(options.chunkSize) || 55);
  const stepPatternPx = Array.isArray(options.stepPatternPx)
    ? options.stepPatternPx.map((value) => Math.max(20, Number(value) || chunkSize)).filter(Number.isFinite)
    : [];
  const delayMs = Math.max(0, Number.isFinite(options.delayMs) ? Number(options.delayMs) : 70);
  const pauseEverySteps = Math.max(0, Number(options.pauseEverySteps) || 0);
  const pauseMs = Math.max(0, Number(options.pauseMs) || 0);
  const logEverySteps = Math.max(1, Number(options.logEverySteps) || 1);
  const maxSteps = Math.max(1, Number(options.maxSteps) || 260);
  let current = metrics.scrollY;
  let lastBucket = -1;

  for (let step = 0; step < maxSteps; step += 1) {
    const remaining = target - current;
    if (Math.abs(remaining) <= 2) break;
    const plannedStep = stepPatternPx.length ? stepPatternPx[step % stepPatternPx.length] : chunkSize;
    const delta = Math.sign(remaining) * Math.min(plannedStep, Math.abs(remaining));
    await page.evaluate((amount) => window.scrollBy(0, amount), delta);
    current += delta;
    const stepsTaken = step + 1;

    const span = Math.max(1, metrics.maxScroll);
    const pagePosition = Math.round((Math.max(0, current) / span) * 100);
    if (stepPatternPx.length) {
      if (stepsTaken % logEverySteps === 0 || Math.abs(target - current) <= 2) {
        log(`Browsing scroll ${direction}: ${Math.max(0, Math.min(100, pagePosition))}%`);
      }
    } else {
      const progress = direction === 'down'
        ? Math.min(100, pagePosition)
        : Math.min(100, Math.round(((span - Math.max(0, current)) / span) * 100));
      const bucket = Math.floor(progress / 20);
      if (bucket > lastBucket && progress > 0) {
        lastBucket = bucket;
        log(`Smooth browsing scroll: ${Math.min(100, bucket * 20)}%`);
      }
    }

    await waitForPage(page, options.lifetime, delayMs);
    if (pauseEverySteps > 0 && pauseMs > 0 && stepsTaken % pauseEverySteps === 0) {
      await waitForPage(page, options.lifetime, pauseMs);
    }
    if (onStep) await onStep();
  }
}

async function readAttrs(locator, names) {
  const result = {};
  for (const name of names) {
    try { result[name] = await locator.getAttribute(name); } catch { result[name] = null; }
  }
  return result;
}

function inputDescriptor(attrs) {
  const bits = [];
  if (attrs.type) bits.push(`type=${attrs.type}`);
  if (attrs.name) bits.push(`name=${attrs.name}`);
  if (attrs.id) bits.push(`id=${attrs.id}`);
  if (attrs['aria-label']) bits.push(`label=${attrs['aria-label']}`);
  if (attrs.placeholder) bits.push(`placeholder=${attrs.placeholder}`);
  return bits.length ? bits.join(', ') : 'editable field';
}

function typingValueFor(attrs, requestedValue) {
  const type = String(attrs.type || '').toLowerCase();
  if (type === 'email') return 'orbitqa@example.com';
  if (type === 'url') return 'https://example.com';
  if (type === 'tel') return '5550100';
  return requestedValue || 'Sample interaction';
}

async function findSafeInput(page) {
  const list = page.locator(INPUT_SELECTOR);
  const count = Math.min(await list.count(), 40);
  for (let index = 0; index < count; index += 1) {
    const candidate = list.nth(index);
    try {
      if (!(await candidate.isVisible()) || !(await candidate.isEnabled())) continue;
      const attrs = await readAttrs(candidate, ['type', 'name', 'id', 'aria-label', 'placeholder', 'autocomplete', 'readonly', 'disabled']);
      const type = String(attrs.type || '').toLowerCase();
      if (['password', 'hidden', 'file', 'checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'color', 'range'].includes(type)) continue;
      if (attrs.readonly !== null || attrs.disabled !== null) continue;
      const identity = Object.values(attrs).filter(Boolean).join(' ');
      if (SENSITIVE_FIELD_PATTERN.test(identity)) continue;
      return { locator: candidate, attrs, descriptor: inputDescriptor(attrs) };
    } catch {
      // Detached or changing DOM candidates are skipped.
    }
  }
  return null;
}

async function actionLabel(locator) {
  const attrs = await readAttrs(locator, ['value', 'aria-label', 'title', 'name']);
  let text = '';
  try { text = String((await locator.textContent()) || '').trim(); } catch { text = ''; }
  return text || String(attrs['aria-label'] || attrs.value || attrs.title || attrs.name || '').trim();
}

function actionScore(label) {
  const normalized = String(label || '').trim().toLowerCase();
  if (!normalized || DANGEROUS_ACTION_PATTERN.test(normalized)) return -1;
  const index = SAFE_ACTION_TERMS.findIndex((term) => normalized === term || normalized.includes(term));
  return index === -1 ? -1 : SAFE_ACTION_TERMS.length - index;
}

const GENERIC_PROMO_ACTION_PATTERN = /^(continue|next|open|view|show more|learn more)$/i;

async function isPromotionalOverlayAction(locator, label) {
  if (!GENERIC_PROMO_ACTION_PATTERN.test(String(label || '').trim())) return false;
  if (typeof locator.evaluate !== 'function') return false;
  try {
    return Boolean(await locator.evaluate((element) => {
      const container = element.closest?.('dialog, [role="dialog"], [aria-modal="true"], [class*="modal" i], [class*="popup" i], [class*="overlay" i]');
      if (!container) return false;
      const text = String(container.innerText || container.textContent || '').slice(0, 2000);
      return /(advertisement|sponsored|recommended extensions?|install now|(^|\s)ad(\s|$|:))/i.test(text);
    }));
  } catch {
    return false;
  }
}

async function findSafeAction(page) {
  const list = page.locator(ACTION_SELECTOR);
  const count = Math.min(await list.count(), 50);
  let best = null;
  for (let index = 0; index < count; index += 1) {
    const candidate = list.nth(index);
    try {
      if (!(await candidate.isVisible()) || !(await candidate.isEnabled())) continue;
      const label = await actionLabel(candidate);
      const score = actionScore(label);
      if (score < 0) continue;
      if (await isPromotionalOverlayAction(candidate, label)) continue;
      if (!best || score > best.score) best = { locator: candidate, label, score };
    } catch {
      // Detached or changing DOM candidates are skipped.
    }
  }
  return best;
}

function interactiveScopes(page) {
  const scopes = [page];
  if (typeof page.frames !== 'function') return scopes;
  try {
    for (const frame of page.frames()) {
      if (frame && frame !== page && !scopes.includes(frame)) scopes.push(frame);
    }
  } catch {
    // Some lightweight lightweight doubles and provider pages do not expose frames.
  }
  return scopes;
}

async function clickDismissCandidate(candidate, page, log, label) {
  try {
    if (!(await candidate.isVisible()) || !(await candidate.isEnabled())) return null;
    await waitBeforePageInteraction();
    await candidate.click({ timeout: 3000 });
    log(`Dismissed blocking overlay: ${label}`);
    await page.waitForTimeout(300);
    return label;
  } catch {
    if (page?.keyboard && typeof page.keyboard.press === 'function') {
      try {
        await page.keyboard.press('Escape');
        log(`Dismissed blocking overlay with Escape fallback after ${label}`);
        await page.waitForTimeout(200);
        return 'Escape';
      } catch {
        // If Escape is unavailable or ineffective, continue looking.
      }
    }
    return null;
  }
}

async function dismissByExactVisibleText(scope, page, log) {
  if (typeof scope.getByText !== 'function') return null;
  const labels = ['Close', 'Cancel', 'Dismiss', 'No thanks', 'No, thanks', 'Not now', 'Maybe later', '×', 'X'];
  for (const label of labels) {
    let list;
    try { list = scope.getByText(label, { exact: true }); } catch { continue; }
    let count = 0;
    try { count = Math.min(await list.count(), 20); } catch { continue; }
    for (let index = 0; index < count; index += 1) {
      const clicked = await clickDismissCandidate(list.nth(index), page, log, label);
      if (clicked) return clicked;
    }
  }
  return null;
}

async function dismissSafeBlockingOverlay(page, log) {
  for (const scope of interactiveScopes(page)) {
    let list;
    try { list = scope.locator(OVERLAY_DISMISS_SELECTOR); } catch { list = null; }
    if (list) {
      let count = 0;
      try { count = Math.min(await list.count(), 60); } catch { count = 0; }
      for (let index = 0; index < count; index += 1) {
        const candidate = list.nth(index);
        try {
          if (!(await candidate.isVisible()) || !(await candidate.isEnabled())) continue;
          const label = await actionLabel(candidate);
          const normalized = String(label || '').trim().toLowerCase();
          if (!normalized) continue;
          const matches = OVERLAY_DISMISS_TERMS.some((term) => normalized === term || (term.length > 1 && normalized.includes(term)));
          if (!matches) continue;
          const clicked = await clickDismissCandidate(candidate, page, log, label);
          if (clicked) return clicked;
        } catch {
          // Keep looking if a candidate disappears while the page settles.
        }
      }
    }

    const textDismissed = await dismissByExactVisibleText(scope, page, log);
    if (textDismissed) return textDismissed;
  }
  return null;
}


async function dismissBlockingOverlays(page, log, maxDismissals = 3) {
  let last = null;
  for (let attempt = 0; attempt < maxDismissals; attempt += 1) {
    const dismissed = await dismissSafeBlockingOverlay(page, log);
    if (!dismissed) break;
    last = dismissed;
  }
  return last;
}

async function resolveBlockingSurfaces(page, log, resolver, maxDismissals = 5, lifetime = null) {
  if (resolver && typeof resolver.resolveLoop === 'function') {
    let result = await resolver.resolveLoop(maxDismissals);
    if (result?.outcome === 'dismissed') return true;
    if (result?.outcome === 'human-verification-blocked') {
      const legacyDismissed = await dismissBlockingOverlays(page, log, 1);
      if (legacyDismissed) return true;
      if (!lifetime) {
        log('Human verification requires manual action');
        const error = new Error('Human verification requires manual action');
        error.name = 'HumanVerificationBlockedError';
        throw error;
      }
      log('Human verification requires manual action; waiting without clicking the challenge');
      while (result?.outcome === 'human-verification-blocked') {
        lifetime.throwIfExpired?.();
        await waitForPage(page, lifetime, 500);
        lifetime.throwIfExpired?.();
        result = await resolver.resolveLoop(1);
        if (result?.outcome === 'dismissed') return true;
      }
      log('Human verification no longer blocks the page; resuming QA');
      return false;
    }
  }
  return Boolean(await dismissBlockingOverlays(page, log, 1));
}

async function waitWithOverlayWatch(page, totalMs, log, options = {}) {
  const intervalMs = Math.max(100, Math.min(Number(options.intervalMs) || 250, 1000));
  const lifetime = options.lifetime || null;
  const resolver = options.resolver || null;
  let remaining = Math.max(0, Number(totalMs) || 0);
  while (remaining > 0) {
    await resolveBlockingSurfaces(page, log, resolver, 5, lifetime);
    const slice = Math.min(intervalMs, remaining);
    await waitForPage(page, lifetime, slice);
    remaining -= slice;
  }
  await resolveBlockingSurfaces(page, log, resolver, 5, lifetime);
}

async function findAssociatedSafeAction(input, page) {
  if (!input?.locator) return findSafeAction(page);
  const ancestorSelectors = [
    'xpath=ancestor::form[1]',
    'xpath=ancestor::section[1]',
    'xpath=ancestor::main[1]',
    'xpath=ancestor::div[1]',
    'xpath=ancestor::div[2]',
    'xpath=ancestor::div[3]',
    'xpath=ancestor::div[4]',
  ];

  for (const selector of ancestorSelectors) {
    try {
      const root = input.locator(selector);
      if (typeof root.count === 'function' && (await root.count()) < 1) continue;
      const action = await findSafeAction(root);
      if (action) return { ...action, associated: true };
    } catch {
      // Keep widening the semantic container when an ancestor is absent.
    }
  }

  return findSafeAction(page);
}

function isPointerInterceptionError(error) {
  return /(intercepts? pointer events|intercepted by|another element.*receive.*pointer)/i.test(String(error?.message || error || ''));
}

async function clickWebsiteAction(page, action, log, options = {}) {
  const resolver = options.resolver || null;
  const lifetime = options.lifetime || null;
  const postActionMs = Math.max(0, Number.isFinite(options.postActionMs) ? Number(options.postActionMs) : 900);
  const interactionMode = options.interactionMode === 'touch' ? 'touch' : 'cursor';
  const beforePages = pagesFromContext(page);
  const clickTimeoutMs = 2500;
  const activate = async () => {
    await waitBeforePageInteraction({lifetime});
    if (interactionMode === 'touch' && typeof action.locator.tap === 'function') {
      await action.locator.tap({ timeout: clickTimeoutMs });
      return 'tap';
    }
    await action.locator.click({ timeout: clickTimeoutMs });
    return 'click';
  };
  await action.locator.scrollIntoViewIfNeeded();
  let activationKind;
  try {
    activationKind = await activate();
  } catch (error) {
    const dismissed = await resolveBlockingSurfaces(page, log, resolver, 5, lifetime);
    if (!dismissed) {
      if (isPointerInterceptionError(error)) {
        log(`Website action remained blocked by a page overlay; safely skipping action: ${action.label}`);
        return false;
      }
      throw error;
    }
    log(`Blocking overlay dismissed; retrying website action: ${action.label}`);
    await waitForPage(page, lifetime, 300);
    await action.locator.scrollIntoViewIfNeeded();
    try {
      activationKind = await activate();
    } catch (retryError) {
      if (isPointerInterceptionError(retryError)) {
        await resolveBlockingSurfaces(page, log, resolver, 5, lifetime);
        log(`Website action remained blocked by a page overlay; safely skipping action: ${action.label}`);
        return false;
      }
      throw retryError;
    }
  }
  log(`${activationKind === 'tap' ? 'Tapped' : 'Clicked'} safe action: ${action.label}`);
  await waitForPage(page, lifetime, postActionMs);
  await closeQaCreatedTabs(page, beforePages, log);
  await resolveBlockingSurfaces(page, log, resolver, 5, lifetime);
  return true;
}

async function progressiveType(locator, value, options = {}) {
  const delayMs = Math.max(0, Math.min(500, Number.isFinite(options.delayMs) ? Number(options.delayMs) : 65));
  await locator.scrollIntoViewIfNeeded();
  await waitBeforePageInteraction({signal:options.signal,lifetime:options.lifetime,wait:options.wait});
  await locator.fill('');
  if (typeof locator.pressSequentially === 'function') {
    await locator.pressSequentially(value, { delay: delayMs });
  } else if (typeof locator.type === 'function') {
    await locator.type(value, { delay: delayMs });
  } else {
    await locator.fill(value);
  }
}

function pagesFromContext(page) {
  try {
    const context = typeof page.context === 'function' ? page.context() : null;
    return context && typeof context.pages === 'function' ? context.pages() : [];
  } catch {
    return [];
  }
}

async function closeQaCreatedTabs(page, beforePages, log) {
  const before = new Set(beforePages || []);
  const after = pagesFromContext(page);
  let closed = 0;
  for (const candidate of after) {
    if (candidate === page || before.has(candidate)) continue;
    try {
      await candidate.close();
      closed += 1;
      log('Closed QA-created tab');
    } catch {
      // A tab that already closed itself needs no further action.
    }
  }
  if (closed > 0 && typeof page.bringToFront === 'function') {
    try { await page.bringToFront(); } catch { /* original page may be navigating */ }
  }
  return closed;
}

async function runSmartInteraction(page, options = {}) {
  const log = typeof options.log === 'function' ? options.log : () => {};
  const requestedValue = String(options.value || 'Sample interaction').slice(0, 500);
  const pacing = options.pacing || null;
  const observeMs = Math.max(500, Math.min(Number(pacing?.observeMs ?? options.observeMs) || 1400, 5000));
  const betweenScrollMs = Math.max(0, Number.isFinite(pacing?.betweenScrollMs) ? Number(pacing.betweenScrollMs) : 900);
  const preActionMs = Math.max(0, Number.isFinite(pacing?.preActionMs) ? Number(pacing.preActionMs) : 0);
  const postActionMs = Math.max(0, Number.isFinite(pacing?.postActionMs) ? Number(pacing.postActionMs) : 900);
  const scrollTimingFor = (direction) => {
    if (!pacing) return undefined;
    const timing = { delayMs: pacing.scrollDelayMs };
    if (Array.isArray(pacing.scrollStepPatternPx) && pacing.scrollStepPatternPx.length) timing.stepPatternPx = pacing.scrollStepPatternPx;
    else if (Number.isFinite(pacing.scrollChunkPx)) timing.stepPx = pacing.scrollChunkPx;
    if (Number.isFinite(pacing.scrollPauseEverySteps)) timing.pauseEverySteps = pacing.scrollPauseEverySteps;
    if (Number.isFinite(pacing.scrollPauseMs)) timing.pauseMs = pacing.scrollPauseMs;
    const targetRatio = direction === 'down' ? pacing.scrollDownTargetRatio : pacing.scrollUpTargetRatio;
    if (Number.isFinite(targetRatio)) timing.targetRatio = targetRatio;
    if (Number.isFinite(pacing.scrollLogEverySteps)) timing.logEverySteps = pacing.scrollLogEverySteps;
    return timing;
  };
  const lifetime = options.lifetime || null;
  const resolver = options.resolver || createBlockingSurfaceResolver({ page, lifetime, log });
  const scrollDriver = options.scrollDriver || browseScrollSurface;
  const indicator = options.indicator || null;
  const indicatorMode = options.indicatorMode || 'cursor';

  await waitWithOverlayWatch(page, observeMs, log, { resolver, lifetime });
  log(`Observed page for ${(observeMs / 1000).toFixed(1)} s`);

  const downSurface = await scrollDriver(page, { direction: 'down', resolver, lifetime, log, timing: scrollTimingFor('down') });
  if (!options.scrollDriver && (!downSurface || Number(downSurface.maxScroll) <= 4)) {
    const overlayWatch = () => resolveBlockingSurfaces(page, log, resolver, 5, lifetime);
    await smoothScrollDocument(page, 'down', {
      log,
      fallbackDistance: options.scrollDistance,
      chunkSize: pacing?.scrollChunkPx,
      stepPatternPx: pacing?.scrollStepPatternPx,
      delayMs: pacing?.scrollDelayMs,
      pauseEverySteps: pacing?.scrollPauseEverySteps,
      pauseMs: pacing?.scrollPauseMs,
      targetRatio: pacing?.scrollDownTargetRatio,
      logEverySteps: pacing?.scrollLogEverySteps,
      onStep: overlayWatch,
      lifetime,
    });
  }
  if (pacing && Number.isFinite(pacing.scrollDownTargetRatio) && pacing.scrollDownTargetRatio < 0.97) {
    log(`Browsed page to about ${Math.round(pacing.scrollDownTargetRatio * 100)}%`);
  } else {
    log('Reached page bottom');
  }
  await waitWithOverlayWatch(page, betweenScrollMs, log, { resolver, lifetime });
  log('Paused to inspect page');
  const upSurface = await scrollDriver(page, { direction: 'up', resolver, lifetime, log, surface: downSurface, timing: scrollTimingFor('up') });
  if (!options.scrollDriver && (!upSurface || Number(upSurface.maxScroll) <= 4)) {
    const overlayWatch = () => resolveBlockingSurfaces(page, log, resolver, 5, lifetime);
    await smoothScrollDocument(page, 'up', {
      log,
      fallbackDistance: options.scrollDistance,
      chunkSize: pacing?.scrollChunkPx,
      stepPatternPx: pacing?.scrollStepPatternPx,
      delayMs: pacing?.scrollDelayMs,
      pauseEverySteps: pacing?.scrollPauseEverySteps,
      pauseMs: pacing?.scrollPauseMs,
      targetRatio: pacing?.scrollUpTargetRatio,
      logEverySteps: pacing?.scrollLogEverySteps,
      onStep: overlayWatch,
      lifetime,
    });
  }
  log('Returned toward page top');

  await resolveBlockingSurfaces(page, log, resolver, 5, lifetime);
  lifetime?.throwIfExpired?.();
  const input = await findSafeInput(page);
  let inputFound = false;
  if (input) {
    inputFound = true;
    const value = typingValueFor(input.attrs, requestedValue);
    log(`Found safe input: ${input.descriptor}`);
    await resolveBlockingSurfaces(page, log, resolver, 5, lifetime);
    lifetime?.throwIfExpired?.();
    if (indicator?.move) await indicator.move(page, input.locator, { mode: indicatorMode });
    await progressiveType(input.locator, value, { delayMs: pacing?.typingDelayMs });
    lifetime?.throwIfExpired?.();
    log('Typed run text progressively');
    await resolveBlockingSurfaces(page, log, resolver, 5, lifetime);
  } else {
    log('No safe input found; checking for a safe action');
  }

  await resolveBlockingSurfaces(page, log, resolver, 5, lifetime);
  const action = input ? await findAssociatedSafeAction(input.locator, page) : await findSafeAction(page);
  let actionClicked = false;
  let actionLabelValue;
  if (action) {
    actionLabelValue = action.label;
    if (action.associated) log(`Selected associated action: ${action.label}`);
    await resolveBlockingSurfaces(page, log, resolver, 5, lifetime);
    lifetime?.throwIfExpired?.();
    if (indicator?.move) await indicator.move(page, action.locator, { mode: indicatorMode });
    if (preActionMs > 0) await waitForPage(page, lifetime, preActionMs);
    if (indicator?.pulse) await indicator.pulse(page, { mode: indicatorMode });
    actionClicked = await clickWebsiteAction(page, action, log, { resolver, lifetime, postActionMs, interactionMode: pacing?.interactionMode || indicatorMode });
  } else {
    log('No safe action found; continuing without clicking');
  }

  return { inputFound, actionClicked, actionLabel: actionLabelValue };
}

module.exports = {
  smoothScrollBy,
  smoothScrollDocument,
  runSmartInteraction,
  findSafeInput,
  findSafeAction,
  findAssociatedSafeAction,
  dismissSafeBlockingOverlay,
  dismissBlockingOverlays,
  waitWithOverlayWatch,
  resolveBlockingSurfaces,
  clickWebsiteAction,
  progressiveType,
  closeQaCreatedTabs,
};
