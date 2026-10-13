const SCROLL_ATTR = 'data-orbitqa-scroll-surface';

function chooseScrollSurface(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const usable = list.filter((item) => Number(item.maxScroll) > 4);
  if (!usable.length) return list[0] || { kind:'window', token:null, currentScroll:0, maxScroll:0, area:0, centerHit:false };
  return usable.slice().sort((a, b) => {
    const score = (item) => (item.centerHit ? 1_000_000_000 : 0) + Math.min(Number(item.area) || 0, 100_000_000) * 10 + Math.min(Number(item.maxScroll) || 0, 1_000_000);
    return score(b) - score(a);
  })[0];
}

async function domBridge(page, payload) {
  return page.evaluate(({ command, token, delta }) => {
    const attr = 'data-orbitqa-scroll-surface';
    const indicatorSelector = '[data-orbitqa-indicator]';
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && rect.width > 4 && rect.height > 4;
    };
    const findByToken = (value) => value ? document.querySelector(`[${attr}="${CSS.escape(value)}"]`) : null;
    if (command === 'discover') {
      const root = document.scrollingElement || document.documentElement;
      const candidates = [];
      const viewportArea = Math.max(1, innerWidth * innerHeight);
      candidates.push({ kind:'window', token:null, currentScroll:Number(scrollY || root.scrollTop || 0), maxScroll:Math.max(0, Number(root.scrollHeight || 0) - Number(innerHeight || root.clientHeight || 0)), area:viewportArea, centerHit:true });
      const center = document.elementFromPoint(Math.max(1, innerWidth / 2), Math.max(1, innerHeight / 2));
      let serial = 0;
      for (const element of document.querySelectorAll('body *')) {
        if (!(element instanceof HTMLElement)) continue;
        if (element.matches(indicatorSelector) || element.closest(indicatorSelector)) continue;
        if (!visible(element)) continue;
        const style = getComputedStyle(element);
        if (!/(auto|scroll|overlay)/.test(style.overflowY || '')) continue;
        const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
        if (maxScroll <= 4) continue;
        const rect = element.getBoundingClientRect();
        const clippedWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
        const clippedHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
        const area = clippedWidth * clippedHeight;
        if (area < viewportArea * 0.08) continue;
        let surfaceToken = element.getAttribute(attr);
        if (!surfaceToken) {
          serial += 1;
          surfaceToken = `surface-${serial}`;
          element.setAttribute(attr, surfaceToken);
        }
        candidates.push({ kind:'element', token:surfaceToken, currentScroll:Number(element.scrollTop || 0), maxScroll, area, centerHit:Boolean(center && (element === center || element.contains(center))) });
      }
      return candidates;
    }
    if (command === 'metrics') {
      if (!token) {
        const root = document.scrollingElement || document.documentElement;
        return { currentScroll:Number(scrollY || root.scrollTop || 0), maxScroll:Math.max(0, root.scrollHeight - (innerHeight || root.clientHeight || 0)) };
      }
      const element = findByToken(token);
      if (!element) return null;
      return { currentScroll:Number(element.scrollTop || 0), maxScroll:Math.max(0, element.scrollHeight - element.clientHeight) };
    }
    if (command === 'rect') {
      if (!token) return { x:0, y:0, width:Number(innerWidth || 0), height:Number(innerHeight || 0) };
      const element = findByToken(token);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { x:rect.x, y:rect.y, width:rect.width, height:rect.height };
    }
    if (command === 'scroll') {
      if (!token) {
        window.scrollBy(0, Number(delta) || 0);
        const root = document.scrollingElement || document.documentElement;
        return Number(scrollY || root.scrollTop || 0);
      }
      const element = findByToken(token);
      if (!element) return null;
      element.scrollBy(0, Number(delta) || 0);
      return Number(element.scrollTop || 0);
    }
    return null;
  }, payload);
}


async function scrollWithWheel(page, surface, delta) {
  if (!page?.mouse || typeof page.mouse.wheel !== 'function') return false;
  try {
    const rect = await domBridge(page, { command:'rect', token:surface.token || null });
    if (rect && typeof page.mouse.move === 'function') {
      const x = Math.max(1, Number(rect.x || 0) + Math.max(2, Number(rect.width || 0) / 2));
      const y = Math.max(1, Number(rect.y || 0) + Math.max(2, Number(rect.height || 0) / 2));
      await page.mouse.move(x, y);
    }
    await page.mouse.wheel(0, delta);
    return true;
  } catch {
    return false;
  }
}

async function discoverScrollSurface(page) {
  let candidates = [];
  try { candidates = await domBridge(page, { command:'discover' }); } catch { candidates = []; }
  return chooseScrollSurface(candidates);
}

async function wait(page, lifetime, ms) {
  if (ms <= 0) return;
  if (lifetime?.wait) return lifetime.wait(ms);
  if (page?.waitForTimeout) return page.waitForTimeout(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function browseScrollSurface(page, options = {}) {
  const direction = options.direction === 'up' ? 'up' : 'down';
  const resolver = options.resolver;
  const lifetime = options.lifetime;
  const log = typeof options.log === 'function' ? options.log : () => {};
  const timing = options.timing || {};
  const stepPx = Math.max(40, Number(timing.stepPx) || 90);
  const stepPatternPx = Array.isArray(timing.stepPatternPx)
    ? timing.stepPatternPx.map((value) => Math.max(40, Number(value) || stepPx)).filter(Number.isFinite)
    : [];
  const delayMs = Math.max(0, Number.isFinite(timing.delayMs) ? Number(timing.delayMs) : 180);
  const pauseEverySteps = Math.max(0, Number(timing.pauseEverySteps) || 0);
  const pauseMs = Math.max(0, Number(timing.pauseMs) || 0);
  const logEverySteps = Math.max(1, Number(timing.logEverySteps) || 1);
  const blockerEvery = Math.max(1, Number(timing.blockerEvery) || 3);
  const maxSteps = Math.max(1, Number(timing.maxSteps) || 240);
  const rawTargetRatio = Number(timing.targetRatio);
  const targetRatio = Number.isFinite(rawTargetRatio)
    ? Math.max(0, Math.min(1, rawTargetRatio))
    : (direction === 'down' ? 1 : 0);
  const surface = options.surface || await discoverScrollSurface(page);
  let metrics = await domBridge(page, { command:'metrics', token:surface.token || null }).catch(() => null);
  if (!metrics || metrics.maxScroll <= 4) return surface;
  let stepsTaken = 0;
  for (let step = 0; step < maxSteps; step += 1) {
    lifetime?.throwIfExpired?.();
    const current = Number(metrics.currentScroll) || 0;
    const span = Math.max(1, Number(metrics.maxScroll) || 1);
    const target = span * targetRatio;
    const remaining = target - current;
    if (Math.abs(remaining) <= 2) break;
    const plannedStep = stepPatternPx.length ? stepPatternPx[step % stepPatternPx.length] : stepPx;
    const delta = Math.sign(remaining) * Math.min(plannedStep, Math.abs(remaining));
    const usedWheel = await scrollWithWheel(page, surface, delta);
    if (!usedWheel) await domBridge(page, { command:'scroll', token:surface.token || null, delta });
    stepsTaken = step + 1;
    if (stepsTaken % blockerEvery === 0 && resolver?.resolveLoop) await resolver.resolveLoop(3);
    await wait(page, lifetime, delayMs);
    if (pauseEverySteps > 0 && pauseMs > 0 && stepsTaken % pauseEverySteps === 0) {
      await wait(page, lifetime, pauseMs);
    }
    metrics = await domBridge(page, { command:'metrics', token:surface.token || null }).catch(() => null);
    if (!metrics) break;
    if (stepsTaken % logEverySteps === 0 || Math.abs(target - Number(metrics.currentScroll || 0)) <= 2) {
      const pagePosition = Math.round((Math.max(0, Number(metrics.currentScroll) || 0) / Math.max(1, Number(metrics.maxScroll) || 1)) * 100);
      log(`Browsing scroll ${direction}: ${Math.max(0, Math.min(100, pagePosition))}%`);
    }
  }
  if (resolver?.resolveLoop) await resolver.resolveLoop(3);
  return { ...surface, currentScroll: Number(metrics?.currentScroll) || Number(surface.currentScroll) || 0, observedMaxScroll: Number(metrics?.maxScroll) || Number(surface.maxScroll) || 0, targetRatio, stepsTaken };
}

module.exports = { SCROLL_ATTR, chooseScrollSurface, discoverScrollSurface, browseScrollSurface };
