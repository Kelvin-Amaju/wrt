const { isAdLike } = require('./safety-policy.cjs');

const NAVIGATION_RACE_PATTERN = /(execution context was destroyed|cannot find context with specified id|frame was detached|most likely because of a navigation)/i;
const SETTLE_TIMEOUT_PATTERN = /(timeout|timed out|timeout .* exceeded)/i;
function isNavigationRaceError(error) { return NAVIGATION_RACE_PATTERN.test(String(error?.message || error || '')); }
function isBenignSettleError(error) { return isNavigationRaceError(error) || SETTLE_TIMEOUT_PATTERN.test(String(error?.message || error || '')); }

function createNavigationSupervisor({ context, primaryPage, lifetime, log = () => {}, analyzePage = async () => ({}), browseAuxiliaryPage = async () => {}, verifyAuxiliaryPage = async () => ({ ok:true }), afterReturnToPrimary = async () => {}, settings = {} }) {
  const knownPages = new Set(typeof context?.pages === 'function' ? context.pages() : [primaryPage]);
  knownPages.add(primaryPage);

  function settleTimeout(capMs = 10000) {
    const remaining = Number(lifetime?.remainingMs?.());
    return Number.isFinite(remaining) ? Math.max(250, Math.min(capMs, remaining)) : capMs;
  }

  async function waitState(page, state, capMs, strict = false) {
    if (!page?.waitForLoadState) return true;
    lifetime?.throwIfExpired?.();
    try {
      await page.waitForLoadState(state, { timeout:settleTimeout(capMs) });
      lifetime?.throwIfExpired?.();
      return true;
    } catch (error) {
      if (strict && !isBenignSettleError(error)) throw error;
      if (!strict && !isBenignSettleError(error)) throw error;
      if (state === 'networkidle') log('Auxiliary page did not become fully network-idle within the bounded settle window; continuing after load');
      lifetime?.throwIfExpired?.();
      return false;
    }
  }

  async function settle(page) {
    await waitState(page, 'domcontentloaded', 10000, false);
  }

  async function settleCompletely(page) {
    const domContentLoaded = await waitState(page, 'domcontentloaded', 8000, false);
    let usableReady = typeof page?.waitForFunction !== 'function';
    if (typeof page?.waitForFunction === 'function') {
      try {
        await page.waitForFunction(() => {
          /* ORBITQA_AUXILIARY_USABLE_READY */
          const href = String(location.href || '');
          const body = document.body;
          const root = document.documentElement;
          const scrollHeight = Math.max(body?.scrollHeight || 0, root?.scrollHeight || 0);
          const scrollWidth = Math.max(body?.scrollWidth || 0, root?.scrollWidth || 0);
          return href !== '' && href !== 'about:blank' && document.readyState !== 'loading' && Boolean(body) && scrollHeight > 0 && scrollWidth > 0;
        }, null, { timeout:settleTimeout(7000) });
        usableReady = true;
        log('Auxiliary tab reached a usable document state');
      } catch (error) {
        if (!isBenignSettleError(error)) throw error;
        log('Auxiliary tab usable-state check reached its bounded timeout; complete load is not yet confirmed');
      }
    }
    const loadReady = await waitState(page, 'load', 8000, false);
    let readyStateComplete = typeof page?.waitForFunction !== 'function';
    if (typeof page?.waitForFunction === 'function') {
      try {
        await page.waitForFunction(() => document.readyState === 'complete', null, { timeout:settleTimeout(5000) });
        readyStateComplete = true;
      } catch (error) {
        if (!isBenignSettleError(error)) throw error;
        log('Auxiliary page did not report document.readyState=complete; complete load is not yet confirmed');
      }
    }
    await waitState(page, 'networkidle', 3500, false);
    const remaining = Number(lifetime?.remainingMs?.());
    const reserveMs = Math.max(1000, Number(settings.finalVerificationReserveMs) || 5000);
    const available = Number.isFinite(remaining) ? Math.max(0, remaining - reserveMs) : 2500;
    const dwellMs = Math.max(0, Math.min(900, available - 200));
    if (dwellMs > 0) {
      if (lifetime?.wait) await lifetime.wait(dwellMs);
      else if (page?.waitForTimeout) await page.waitForTimeout(dwellMs);
    }
    return { fullyLoaded:Boolean(domContentLoaded && usableReady && loadReady && readyStateComplete), domContentLoaded, usableReady, loadReady, readyStateComplete };
  }

  async function minimumAuxiliaryObservation(page) {
    const remaining = Number(lifetime?.remainingMs?.());
    const reserveMs = Math.max(1000, Number(settings.finalVerificationReserveMs) || 5000);
    const available = Number.isFinite(remaining) ? Math.max(0, remaining - reserveMs) : 3000;
    if (available < 650) {
      log('Auxiliary tab kept passive because the remaining session time is reserved for final integrity verification');
      return { observed:false, scrollable:false, reason:'time-reserve' };
    }

    let metrics = null;
    if (typeof page?.evaluate === 'function') {
      try {
        metrics = await page.evaluate(() => {
          /* ORBITQA_AUXILIARY_SCROLL_METRICS */
          const root = document.documentElement;
          const body = document.body;
          return {
            scrollHeight: Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0),
            viewportHeight: Math.max(1, window.innerHeight || root?.clientHeight || 1),
            scrollY: window.scrollY || root?.scrollTop || body?.scrollTop || 0,
          };
        });
      } catch (error) {
        if (!isNavigationRaceError(error)) throw error;
        await settle(page);
      }
    }

    const preDwell = Math.min(850, Math.max(350, available * 0.2));
    if (lifetime?.wait) await lifetime.wait(preDwell);
    else if (page?.waitForTimeout) await page.waitForTimeout(preDwell);

    const scrollable = Number(metrics?.scrollHeight) > Number(metrics?.viewportHeight) + 12;
    if (scrollable && typeof page?.evaluate === 'function') {
      try {
        await page.evaluate(() => {
          /* ORBITQA_AUXILIARY_MIN_SCROLL */
          const root = document.documentElement;
          const body = document.body;
          const viewport = Math.max(1, window.innerHeight || root?.clientHeight || 1);
          const total = Math.max(root?.scrollHeight || 0, body?.scrollHeight || 0);
          const current = window.scrollY || root?.scrollTop || body?.scrollTop || 0;
          const distance = Math.max(120, Math.min(viewport * 0.55, total - viewport - current));
          if (distance <= 0) return false;
          window.scrollBy({ top:distance, left:0, behavior:'smooth' });
          return true;
        });
        const postDwell = Math.min(900, Math.max(350, available * 0.22));
        if (lifetime?.wait) await lifetime.wait(postDwell);
        else if (page?.waitForTimeout) await page.waitForTimeout(postDwell);
        log('Auxiliary tab received a minimum visible reading scroll and will remain open for the rest of the work-unit session');
      } catch (error) {
        if (!isNavigationRaceError(error)) throw error;
        log('Auxiliary tab navigated during minimum observation; waiting for the replacement document');
        await settleCompletely(page);
      }
    } else {
      log('Auxiliary tab is not vertically scrollable; minimum observation dwell completed and the tab will remain open for the session');
    }
    return { observed:true, scrollable };
  }

  async function runIdempotent(label, fn) {
    try { return await fn(); }
    catch (error) {
      if (!isNavigationRaceError(error)) throw error;
      log(`Page navigated during ${label}; waiting for the new document`);
      await settle(primaryPage);
      try { return await fn(); }
      catch (second) {
        if (isNavigationRaceError(second)) throw new Error(`Repeated navigation churn during ${label}`);
        throw second;
      }
    }
  }

  async function runSideEffect(label, fn) {
    const before = typeof primaryPage?.url === 'function' ? primaryPage.url() : '';
    try {
      const value = await fn();
      const after = typeof primaryPage?.url === 'function' ? primaryPage.url() : before;
      if (after && before && after !== before) {
        log(`Page navigation completed during ${label}; continuing without repeating ${label}`);
        await settleCompletely(primaryPage).catch(() => undefined);
        return { value, navigated:true };
      }
      return { value, navigated:false };
    } catch (error) {
      if (!isNavigationRaceError(error)) throw error;
      log(`Page navigated during ${label}; continuing without repeating ${label}`);
      await settleCompletely(primaryPage);
      return { value:undefined, navigated:true };
    }
  }

  async function observeNewPages() {
    const pages = typeof context?.pages === 'function' ? context.pages() : [];
    const fresh = pages.filter((page) => !knownPages.has(page));
    let ordinary = 0;
    let adLike = 0;
    let observedCount = 0;
    for (const page of fresh) {
      lifetime?.throwIfExpired?.();
      const readiness = await settleCompletely(page);
      if (readiness?.fullyLoaded === false) {
        log('Auxiliary tab left open because complete load could not be confirmed; it will be checked again while the work-unit session remains active');
        continue;
      }
      knownPages.add(page);
      observedCount += 1;
      if (typeof page?.context === 'function' && context && page.context() !== context) {
        throw new Error('Auxiliary tab escaped the primary BrowserContext');
      }
      log('Auxiliary tab confirmed inside the primary BrowserContext and shared proxy/privacy policy');
      await verifyAuxiliaryPage(page, { context, primaryPage });
      await minimumAuxiliaryObservation(page);
      const title = typeof page?.title === 'function' ? await page.title().catch(() => '') : '';
      const url = typeof page?.url === 'function' ? page.url() : '';
      let analysis = {};
      try { analysis = await analyzePage(page); } catch { analysis = {}; }
      const isAd = isAdLike({ text:title, href:url }) || (analysis.adLikeElements?.length > 0 && !analysis.safeActions?.length && !analysis.editableFields?.length);
      if (isAd) {
        adLike += 1;
        log(`Advertisement/promotional tab detected; passive observation only${url ? `: ${url}` : ''}`);
        if (settings.observeNewTabs !== false) await browseAuxiliaryPage(page, { passiveOnly:true, promotional:true });
      } else if (settings.observeNewTabs !== false) {
        ordinary += 1;
        log(`New tab fully settled in the same browser context${title ? `: ${title}` : ''}`);
        await browseAuxiliaryPage(page, { passiveOnly:false, promotional:false });
      }
      if (page !== primaryPage) log('Auxiliary tab retained until the work-unit session timer ends');
    }
    if (typeof primaryPage?.bringToFront === 'function') await primaryPage.bringToFront().catch(() => undefined);
    if (fresh.length > 0) {
      const remaining = Number(lifetime?.remainingMs?.());
      const refocusMs = Number.isFinite(remaining) ? Math.max(0, Math.min(500, remaining - 200)) : 350;
      if (refocusMs > 0) {
        if (lifetime?.wait) await lifetime.wait(refocusMs);
        else if (primaryPage?.waitForTimeout) await primaryPage.waitForTimeout(refocusMs);
      }
      await afterReturnToPrimary();
    }
    return { observed:observedCount, ordinary, adLike };
  }

  async function focusPrimary() {
    if (typeof primaryPage?.bringToFront === 'function') await primaryPage.bringToFront().catch(() => undefined);
  }

  return { runIdempotent, runSideEffect, observeNewPages, settle, settleCompletely, focusPrimary, isNavigationRaceError };
}

module.exports = { createNavigationSupervisor, isNavigationRaceError };
