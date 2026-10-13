const { analyzeSite } = require('./site-analyzer.cjs');
const { planBehavior } = require('./behavior-planner.cjs');
const { performReadingScroll, performFullPageObservation } = require('./reading-driver.cjs');
const { createNavigationSupervisor } = require('./navigation-supervisor.cjs');
const { createBlockerObserver } = require('./blocker-observer.cjs');
const { isSafeEditableField, isSafeSurveyControl, isSafeAction, isAdLike, isVerificationChallenge, isSensitiveOrConsequential } = require('./safety-policy.cjs');
const { progressiveType } = require('../smart-interaction.cjs');
const { createSessionBudget } = require('./session-budget.cjs');
const { observeAds } = require('./ad-observer.cjs');

function valueForField(field = {}) {
  const type = String(field.type || 'text').toLowerCase();
  const text = `${field.label || ''} ${field.name || ''} ${field.placeholder || ''}`.toLowerCase();
  if (type === 'url' || /\burl\b|link|website/.test(text)) return 'https://example.org/';
  if (type === 'email' || /email|e-mail/.test(text)) return 'qa@example.org';
  if (type === 'search' || /search|query|keyword/.test(text)) return 'OrbitQA search';
  if (/prompt|image|generate|description/.test(text)) return 'A calm blue landscape for operation';
  return 'Sample interaction';
}

function isPointerInterceptionError(error) {
  return /(intercepts pointer events|element .* intercepts|another element would receive the click)/i.test(String(error?.message || error || ''));
}

function candidateIdentity(candidate = {}) { return String(candidate.selectorHint || candidate.href || candidate.text || candidate.label || ''); }
function candidateKey(action) {
  const candidate = action?.candidate || {};
  return `${action?.type || ''}:${candidateIdentity(candidate)}`;
}

async function safeWait(page, lifetime, ms) {
  if (lifetime?.wait) return lifetime.wait(ms);
  if (page?.waitForTimeout) return page.waitForTimeout(ms);
}

async function runAutoQa({
  page,
  context,
  workUnit = {},
  settings = {},
  lifetime,
  log = () => {},
  interactionIndicator = null,
  indicatorMode = 'desktop',
  resolver = null,
  pacing = null,
  signal = null,
  deps = {},
}) {
  const analyze = deps.analyzeSite || analyzeSite;
  const planner = deps.planBehavior || planBehavior;
  const readScroll = deps.performReadingScroll || performReadingScroll;
  const fullObserve = deps.performFullPageObservation || performFullPageObservation;
  const makeBlockerObserver = deps.createBlockerObserver || createBlockerObserver;
  const initialRemainingMs = Number(lifetime?.remainingMs?.());
  const sessionBudget = createSessionBudget(Number.isFinite(initialRemainingMs) ? initialRemainingMs : 60000);
  const effectiveReadingPace = sessionBudget.pace;
  const reserveMs = Math.max(sessionBudget.finalIntegrityMs, Number(settings.finalVerificationReserveMs) || 0);
  const actionReserveMs = sessionBudget.primaryActionMs + sessionBudget.followUpMs + sessionBudget.adObservationMs;
  if (Number.isFinite(initialRemainingMs)) {
    log(`Timer budget: ${Math.max(0, Math.round(initialRemainingMs / 1000))}s available · ${Math.max(0, Math.round(sessionBudget.primaryActionMs / 1000))}s primary action · ${Math.max(0, Math.round(sessionBudget.adObservationMs / 1000))}s ad observation · ${Math.max(0, Math.round(sessionBudget.followUpMs / 1000))}s follow-up · ${Math.max(0, Math.round(reserveMs / 1000))}s reserved for final integrity`);
  } else {
    log(`Timer budget: adaptive session time · ${Math.max(0, Math.round(reserveMs / 1000))}s reserved for final integrity`);
  }
  const report = {
    detectedKinds: [],
    attempted: 0,
    completed: 0,
    skipped: 0,
    navigationCount: 0,
    newTabObservations: 0,
    blockerObservations: 0,
    fullPageObservations: 0,
    adsDetected: 0,
    adsObserved: 0,
    adSummary: { total:0, observed:0, byType:{ banner:0, stickyAnchor:0, interstitialVignette:0, nativeSponsored:0, iframeNetwork:0, unknownAd:0 }, status:'none' },
    terminalReason: 'complete',
  };
  const performed = new Set();
  let auxiliaryCount = 0;
  let blockerObserver = null;

  const checkStop = () => {
    if (signal?.aborted) {
      report.terminalReason = 'stopped';
      return true;
    }
    lifetime?.throwIfExpired?.();
    return false;
  };

  const browseAuxiliaryPage = async (auxPage, meta = {}) => {
    lifetime?.throwIfExpired?.();
    log(meta.promotional ? 'Observed promotional auxiliary tab after complete bounded load settling; passive reading only' : 'Observed new tab after complete bounded load settling');
    const observation = await fullObserve(auxPage, {
      readingPace:effectiveReadingPace,
      seed:`${workUnit.workId || 'work'}:aux:${auxiliaryCount++}`,
      lifetime,
      reserveMs,
      actionReserveMs:0,
      log,
    });
    if (observation?.completedRoundTrip) {
      report.fullPageObservations += 1;
      log('Finished gentle auxiliary-tab reading pass; auxiliary tab remains open until the work-unit session timer ends');
    } else {
      log('Auxiliary-tab reading stopped to preserve final verification time');
    }
  };

  const supervisor = createNavigationSupervisor({
    context,
    primaryPage:page,
    lifetime,
    log,
    analyzePage:analyze,
    browseAuxiliaryPage,
    verifyAuxiliaryPage: deps.verifyAuxiliaryPage || (async () => ({ ok:true })),
    afterReturnToPrimary: async () => {
      log('Re-checking primary page blockers after returning from auxiliary tab');
      if (!blockerObserver?.inspectAndResolve) return;
      const blockerResult = await blockerObserver.inspectAndResolve();
      if (blockerResult?.detected) report.blockerObservations += 1;
    },
    settings,
  });
  blockerObserver = makeBlockerObserver({ page, resolver, lifetime, indicator:interactionIndicator, indicatorMode, signal, log });
  blockerObserver?.startContinuousMonitor?.({ intervalMs:500 });
  log('Continuous blocker monitoring active during Auto QA activity');

  const inspectBlocker = async () => {
    if (!blockerObserver?.inspectAndResolve) return { detected:false, dismissed:false };
    const blockerResult = await blockerObserver.inspectAndResolve();
    if (blockerResult?.detected) report.blockerObservations += 1;
    if (blockerResult?.dismissed && blockerResult?.promotional) {
      report.adsDetected += 1;
      report.adsObserved += 1;
      report.adSummary.total += 1;
      report.adSummary.observed += 1;
      report.adSummary.byType.interstitialVignette += 1;
      report.adSummary.status = 'pass';
      log('Promotional overlay recorded as observed ad type Interstitial/Vignette');
    }
    if (blockerResult?.dismissed) {
      const tabs = await supervisor.observeNewPages();
      report.newTabObservations += tabs.observed || 0;
    }
    return blockerResult || { detected:false, dismissed:false };
  };

  const observationCheckpoint = async () => {
    if (checkStop()) return;
    await inspectBlocker();
  };

  const observePrimaryRoundTrip = async (seed) => {
    const observation = await supervisor.runIdempotent('full-page observation', () => fullObserve(page, {
      readingPace:effectiveReadingPace,
      seed,
      lifetime,
      reserveMs,
      actionReserveMs,
      log,
      onCheckpoint:observationCheckpoint,
    }));
    if (observation?.completedRoundTrip) report.fullPageObservations += 1;
    return observation;
  };

  const continuePassiveReading = async (seedBase) => {
    for (let round = 0; round < 6; round += 1) {
      if (checkStop()) return;
      const remaining = Number(lifetime?.remainingMs?.());
      if (Number.isFinite(remaining) && remaining <= reserveMs + 900) return;
      const observation = await observePrimaryRoundTrip(`${seedBase}:passive:${round}`);
      if (!observation?.completedRoundTrip) return;
      await inspectBlocker();
    }
  };

  const locate = (candidate) => {
    if (!candidate?.selectorHint || typeof page?.locator !== 'function') return null;
    return page.locator(candidate.selectorHint).first();
  };


  const interactionState = async () => {
    const url = typeof page?.url === 'function' ? page.url() : '';
    const pageCount = typeof context?.pages === 'function' ? context.pages().length : 1;
    let signature = '';
    if (typeof page?.evaluate === 'function') {
      try {
        signature = await page.evaluate(() => {
          const body = document.body;
          const root = document.documentElement;
          const visibleDialogs = Array.from(document.querySelectorAll('[role="dialog"],dialog,[aria-modal="true"]')).filter((el) => {
            const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
            return r.width > 2 && r.height > 2 && st.display !== 'none' && st.visibility !== 'hidden';
          }).length;
          return JSON.stringify({
            title:document.title,
            text:String(body?.innerText || '').replace(/\s+/g,' ').slice(0,6000),
            htmlLength:String(body?.innerHTML || '').length,
            scrollHeight:Math.max(body?.scrollHeight || 0, root?.scrollHeight || 0),
            dialogs:visibleDialogs,
            active:String(document.activeElement?.getAttribute?.('data-orbitqa-token') || document.activeElement?.id || document.activeElement?.tagName || ''),
          });
        });
      } catch { signature = ''; }
    }
    return { url, pageCount, signature };
  };

  const interactionResponded = (before, after) => {
    if (!before?.signature && !after?.signature) return true;
    return Boolean(
      (before?.url && after?.url && before.url !== after.url) ||
      Number(after?.pageCount || 0) > Number(before?.pageCount || 0) ||
      (before?.signature && after?.signature && before.signature !== after.signature)
    );
  };

  const alternateSafeActions = async (triedKeys) => {
    let fresh;
    try { fresh = await supervisor.runIdempotent('fallback action analysis', () => analyze(page)); }
    catch { return []; }
    const preferred = Array.isArray(fresh?.preferredSafeActions) ? fresh.preferredSafeActions : [];
    const safe = Array.isArray(fresh?.safeActions) ? fresh.safeActions : [];
    const combined = [...preferred, ...safe];
    const seen = new Set();
    return combined.filter((candidate) => {
      if (!candidate || isAdLike(candidate) || isVerificationChallenge(candidate) || isSensitiveOrConsequential(candidate) || !isSafeAction(candidate)) return false;
      const id = candidateIdentity(candidate);
      if (!id || triedKeys.has(id) || seen.has(id)) return false;
      if (Array.from(performed).some((entry) => String(entry).endsWith(`:${id}`))) return false;
      seen.add(id);
      return true;
    });
  };

  const clickSafeCandidateWithFallback = async (primaryCandidate, actionType) => {
    const triedKeys = new Set();
    const queue = [primaryCandidate];
    const maxAttempts = 5;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (!queue.length) queue.push(...await alternateSafeActions(triedKeys));
      const candidate = queue.shift();
      if (!candidate) break;
      const id = candidateIdentity(candidate);
      const key = candidateKey({ type:actionType || 'activate', candidate });
      if (id) triedKeys.add(id);
      const target = locate(candidate);
      if (!target) continue;
      if (attempt > 0) log(`Previous safe control did not respond; trying another safe interactive control (${attempt + 1}/${maxAttempts})${candidate.text ? `: ${candidate.text}` : ''}`);
      try {
        if (target.scrollIntoViewIfNeeded) await target.scrollIntoViewIfNeeded();
        if (interactionIndicator?.move) await interactionIndicator.move(page, target, { mode:indicatorMode });
        if (interactionIndicator?.pulse) await interactionIndicator.pulse(page, { mode:indicatorMode });
        const before = await interactionState();
        try {
          await target.click({ timeout:Math.min(10000, Math.max(250, Number(lifetime?.remainingMs?.() || 10000))) });
        } catch (error) {
          if (isPointerInterceptionError(error)) {
            const blockerResult = await inspectBlocker();
            if (blockerResult?.dismissed) {
              log('Blocking overlay blocked safe action; dismissed it and retrying once');
              if (target.scrollIntoViewIfNeeded) await target.scrollIntoViewIfNeeded();
              await target.click({ timeout:Math.min(10000, Math.max(250, Number(lifetime?.remainingMs?.() || 10000))) });
            } else {
              log('Safe control remained blocked; searching for another interactive control');
              if (key) performed.add(key);
              continue;
            }
          } else if (/(not visible|not enabled|not editable|not stable|detached|timeout|timed out|outside of the viewport|receives pointer|intercepts pointer)/i.test(String(error?.message || error || ''))) {
            log('Safe control was not clickable/interactive; searching for another interactive control');
            if (key) performed.add(key);
            continue;
          } else throw error;
        }
        await safeWait(page, lifetime, 900);
        const after = await interactionState();
        if (interactionResponded(before, after)) {
          if (key) performed.add(key);
          return { orbitQaSkipped:false, responsive:true, candidate };
        }
        log('Safe control accepted the click but produced no observable response; searching for another interactive control');
        if (key) performed.add(key);
      } catch (error) {
        if (/(execution context was destroyed|frame was detached|most likely because of a navigation)/i.test(String(error?.message || error || ''))) throw error;
        log(`Safe control attempt failed without navigation; trying another control · ${String(error?.message || error).slice(0,160)}`);
        if (key) performed.add(key);
      }
    }
    log('No responsive safe interactive control was found after bounded fallback attempts');
    return { orbitQaSkipped:true, responsive:false };
  };

  for (let cycle = 0; cycle < 8; cycle += 1) {
    if (checkStop()) return report;
    const remainingMs = Number(lifetime?.remainingMs?.() ?? 60000);
    if (Number.isFinite(remainingMs) && remainingMs <= reserveMs + 700) {
      report.terminalReason = 'time-reserve-reached';
      break;
    }

    await inspectBlocker();
    if (checkStop()) return report;

    const observation = await observePrimaryRoundTrip(`${workUnit.workId || 'work'}:${cycle}:full`);
    if (!observation?.completedRoundTrip) {
      const actionSafePartial = observation?.reason === 'time-reserve' && observation?.reachedTop === true;
      if (!actionSafePartial) {
        report.terminalReason = observation?.reason === 'time-reserve' ? 'time-reserve-reached' : 'observation-incomplete';
        break;
      }
      log('Reading budget reached after returning to the top; continuing with the reserved primary site action');
    }

    await inspectBlocker();
    if (checkStop()) return report;

    const analysis = await supervisor.runIdempotent('page analysis', () => analyze(page));
    if (!analysis) {
      report.terminalReason = 'analysis-unavailable';
      return report;
    }
    if (!report.detectedKinds.includes(analysis.kind)) report.detectedKinds.push(analysis.kind);
    const kindLabel = String(analysis.kind || 'unknown').replace('-', ' / ').replace(/\b\w/g, (c) => c.toUpperCase());
    log(`Site type detected after full-page observation: ${kindLabel}`);
    const pageKey = `ads:${typeof page?.url === 'function' ? page.url() : cycle}`;
    if (!performed.has(pageKey)) {
      const adReport = await observeAds({
        page,
        ads:analysis.adLikeElements || [],
        indicator:interactionIndicator,
        mode:indicatorMode,
        lifetime,
        budgetMs:sessionBudget.adObservationMs,
        log,
      });
      report.adsDetected += adReport.detected || 0;
      report.adsObserved += adReport.observed || 0;
      report.adSummary.total += adReport.detected || 0;
      report.adSummary.observed += adReport.observed || 0;
      for (const key of Object.keys(report.adSummary.byType)) {
        report.adSummary.byType[key] += Number(adReport.byType?.[key] || 0);
      }
      report.adSummary.status = report.adSummary.total === 0 ? 'none' : report.adSummary.observed >= report.adSummary.total ? 'pass' : 'partial';
      performed.add(pageKey);
    }
    if ((analysis.riskFlags || []).includes('verification-challenge')) log('CAPTCHA/human verification detected; interaction skipped');

    const plan = planner({ analysis, remainingMs:Number(lifetime?.remainingMs?.() ?? remainingMs), settings, seed:`${workUnit.workId || 'work'}:${cycle}`, deviceMode:workUnit.executionKind || 'desktop' });
    let navigated = false;
    let sideEffectCompleted = false;

    for (const action of plan) {
      if (checkStop()) return report;
      const actionRemaining = Number(lifetime?.remainingMs?.());
      if (Number.isFinite(actionRemaining) && actionRemaining <= reserveMs + 500) {
        report.terminalReason = 'time-reserve-reached';
        break;
      }
      report.attempted += 1;
      const key = candidateKey(action);
      if (key && performed.has(key) && ['fill-field','choose-survey-control','activate','open-link','return-home'].includes(action.type)) {
        report.skipped += 1;
        continue;
      }
      switch (action.type) {
        case 'observe': {
          const duration = Math.max(0, Math.min(2200, Number(action.durationMs) || 0));
          if (duration > 0) await safeWait(page, lifetime, duration);
          log('Post-classification observation complete');
          report.completed += 1;
          break;
        }
        case 'read-scroll':
          await supervisor.runIdempotent('reading scroll', () => readScroll(page, {
            readingPace:effectiveReadingPace,
            seed:action.seed || `${workUnit.workId || 'work'}:${cycle}:read`,
            direction:action.direction || 'down',
            lifetime,
            log,
          }));
          report.completed += 1;
          break;
        case 'fill-field': {
          if (settings.safeFormActions === false || !isSafeEditableField(action.candidate)) {
            report.skipped += 1;
            log('Unsafe or unsupported field skipped');
            break;
          }
          const target = locate(action.candidate);
          if (!target) { report.skipped += 1; break; }
          performed.add(key);
          const result = await supervisor.runSideEffect('safe form typing', async () => {
            if (interactionIndicator?.move) await interactionIndicator.move(page, target, { mode:indicatorMode });
            const value = valueForField(action.candidate);
            await progressiveType(target, value, { delayMs:pacing?.typingDelayMs ?? 75 });
            log(`Filled safe QA field${action.candidate.label ? `: ${action.candidate.label}` : ''}`);
          });
          sideEffectCompleted = true;
          navigated = navigated || result.navigated;
          report.completed += 1;
          break;
        }
        case 'choose-survey-control': {
          if (settings.safeFormActions === false || !isSafeSurveyControl(action.candidate)) {
            report.skipped += 1;
            log('Unsafe or unsupported survey control skipped');
            break;
          }
          const target = locate(action.candidate);
          if (!target) { report.skipped += 1; break; }
          performed.add(key);
          const result = await supervisor.runSideEffect('neutral survey control', async () => {
            if (target.scrollIntoViewIfNeeded) await target.scrollIntoViewIfNeeded();
            if (interactionIndicator?.move) await interactionIndicator.move(page, target, { mode:indicatorMode });
            if (interactionIndicator?.pulse) await interactionIndicator.pulse(page, { mode:indicatorMode });
            const type = String(action.candidate.type || '').toLowerCase();
            if (type === 'radio' || type === 'checkbox') {
              if (typeof target.check === 'function') await target.check({ timeout:Math.min(10000, Math.max(250, Number(lifetime?.remainingMs?.() || 10000))) });
              else await target.click({ timeout:Math.min(10000, Math.max(250, Number(lifetime?.remainingMs?.() || 10000))) });
            } else if (type === 'select-one' || type === 'select-multiple') {
              const index = Number.isInteger(action.candidate.preferredOptionIndex) ? action.candidate.preferredOptionIndex : 1;
              await target.selectOption({ index });
            }
            log(`Selected neutral survey control${action.candidate.label ? `: ${action.candidate.label}` : ''}`);
          });
          sideEffectCompleted = true;
          navigated = navigated || result.navigated;
          report.completed += 1;
          break;
        }
        case 'activate':
        case 'open-link':
        case 'return-home': {
          const candidate = action.candidate;
          if (!candidate || isAdLike(candidate) || isVerificationChallenge(candidate) || isSensitiveOrConsequential(candidate) || !isSafeAction(candidate)) {
            report.skipped += 1;
            log('Unsafe, promotional, or protected action skipped');
            break;
          }
          let preActionBlocker = await inspectBlocker();
          if (preActionBlocker?.detected && !preActionBlocker?.dismissed) {
            let cleared = false;
            for (let retry = 0; retry < 3; retry += 1) {
              const retryRemaining = Number(lifetime?.remainingMs?.());
              if (Number.isFinite(retryRemaining) && retryRemaining <= reserveMs + 700) break;
              log(`Blocking overlay still covers the required site action; retrying required safe action dismissal (${retry + 1}/3)`);
              await safeWait(page, lifetime, Math.min(650, Math.max(120, Number.isFinite(retryRemaining) ? retryRemaining - reserveMs - 100 : 350)));
              preActionBlocker = await inspectBlocker();
              if (!preActionBlocker?.detected || preActionBlocker?.dismissed) { cleared = true; break; }
            }
            if (!cleared && preActionBlocker?.detected && !preActionBlocker?.dismissed) {
              report.skipped += 1;
              log('Safe action skipped because a blocking overlay remains and could not be safely dismissed');
              break;
            }
          }
          const label = action.type === 'activate' ? 'safe action' : action.type === 'return-home' ? 'home navigation' : 'internal link navigation';
          const result = await supervisor.runSideEffect(label, async () => {
            const outcome = await clickSafeCandidateWithFallback(candidate, action.type);
            if (!outcome?.orbitQaSkipped) {
              const used = outcome.candidate || candidate;
              log(action.type === 'activate'
                ? `Activated safe action${used?.text ? `: ${used.text}` : ''}`
                : action.type === 'return-home'
                  ? 'Responsive home navigation activated'
                  : `Opened responsive safe internal link${used?.text ? `: ${used.text}` : ''}`);
            }
            return outcome;
          });
          if (result?.value?.orbitQaSkipped) {
            report.skipped += 1;
            break;
          }
          sideEffectCompleted = true;
          navigated = navigated || result.navigated;
          report.completed += 1;
          const tabs = await supervisor.observeNewPages();
          report.newTabObservations += tabs.observed || 0;
          if ((tabs.observed || 0) > 0) navigated = true;
          break;
        }
        case 'no-safe-action':
          log('No safe action available; continuing observation without fabricated engagement');
          report.completed += 1;
          break;
        case 'browse-only':
          log('Unknown/unsupported interaction pattern; continuing safe reading');
          report.completed += 1;
          break;
        default:
          report.skipped += 1;
          log(`Unsupported Auto QA action skipped: ${action.type || 'unknown'}`);
      }
      if (navigated) break;
    }

    if (checkStop()) return report;
    if (navigated) {
      report.navigationCount += 1;
      await supervisor.settleCompletely(page).catch(() => undefined);
      continue;
    }

    report.terminalReason = sideEffectCompleted ? 'safe-action-complete' : 'browse-observation-complete';
    await continuePassiveReading(`${workUnit.workId || 'work'}:${cycle}`);
    break;
  }

  log('AUTO QA completed');
  return report;
}

module.exports = { runAutoQa, valueForField };
