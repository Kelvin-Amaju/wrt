const { isAdLike, isVerificationChallenge, isSensitiveOrConsequential } = require('./safety-policy.cjs');

function createBlockerObserver({ page, resolver, lifetime, indicator, indicatorMode, signal = null, log = () => {} }) {
  let inspectInFlight = null;
  async function wait(ms) {
    if (lifetime?.wait) return lifetime.wait(ms);
    if (page?.waitForTimeout) return page.waitForTimeout(ms);
  }

  async function inspectAndResolveNow() {
    lifetime?.throwIfExpired?.();
    if (!resolver?.inspect) return { detected:false, dismissed:false };
    const snapshot = await resolver.inspect();
    if (!snapshot?.blocked) return { detected:false, dismissed:false };
    const surfaceText = (snapshot.surfaces || []).map((surface) => surface.text || '').join(' ');
    log('Blocking overlay detected');
    const humanVerification = snapshot.humanVerification || isVerificationChallenge({ text:surfaceText });
    if (humanVerification) {
      // A verification challenge must never be solved or activated. It may still
      // be dismissed when the page exposes a separate verified Close/X/Cancel
      // control. resolver controlOnly mode cannot choose the challenge CTA.
      log('CAPTCHA/human verification detected; challenge interaction skipped; checking only for a separate safe Close/X/Cancel control');
    }
    if (!humanVerification && isSensitiveOrConsequential({ text:surfaceText })) {
      log('Protected overlay detected; interaction skipped');
      return { detected:true, dismissed:false, skippedReason:'protected consequential overlay' };
    }

    const promotional = isAdLike({ text:surfaceText });
    if (promotional) log('Advertisement/promotional overlay detected; only a verified Close/X/Cancel control may be used');

    const remaining = Number(lifetime?.remainingMs?.());
    const observeMs = Number.isFinite(remaining) ? Math.max(400, Math.min(1200, remaining - 100)) : 800;
    if (observeMs > 0) await wait(observeMs);
    lifetime?.throwIfExpired?.();
    log('Observed overlay before dismissal');
    const result = await resolver.resolveOnce({
      preservePopup:true,
      controlOnly:promotional || humanVerification,
      beforeDismiss: async ({ locator }) => {
        if (indicator?.move && locator) await indicator.move(page, locator, { mode:indicatorMode }).catch?.(() => undefined);
        const hoverRemaining = Number(lifetime?.remainingMs?.());
        const hoverMs = Number.isFinite(hoverRemaining) ? Math.max(120, Math.min(450, hoverRemaining - 80)) : 300;
        if (hoverMs > 0) await wait(hoverMs);
        if (indicator?.pulse) await indicator.pulse(page, { mode:indicatorMode }).catch?.(() => undefined);
      },
    });
    if (result?.outcome === 'dismissed') {
      const prefix = humanVerification
        ? 'Dismissed verification overlay using separate safe close control'
        : promotional
          ? 'Dismissed promotional overlay using safe close control'
          : 'Dismissed safe close control';
      log(`${prefix}${result.label ? `: ${result.label}` : ''}`);
      return { detected:true, dismissed:true, method:result.method, label:result.label, popup:result.popup, promotional, humanVerification };
    }
    if (result?.outcome === 'human-verification-blocked' || humanVerification) {
      log('CAPTCHA/human verification has no separate safe close control; challenge interaction skipped');
      return { detected:true, dismissed:false, humanVerification:true, skippedReason:'human verification challenge' };
    }
    if (promotional) {
      log('Promotional overlay has no verified close control; advertisement interaction skipped');
      return { detected:true, dismissed:false, skippedReason:'no safe promotional close control', promotional:true };
    }
    return { detected:true, dismissed:false, skippedReason:'no safe dismissal control' };
  }
  async function inspectAndResolve() {
    if (inspectInFlight) return inspectInFlight;
    inspectInFlight = Promise.resolve()
      .then(() => inspectAndResolveNow())
      .finally(() => { inspectInFlight = null; });
    return inspectInFlight;
  }

  function startContinuousMonitor(options = {}) {
    const intervalMs = Math.max(50, Number(options.intervalMs) || 500);
    let stopped = false;
    let timer = null;
    const schedule = () => {
      if (stopped || signal?.aborted) return;
      const remaining = Number(lifetime?.remainingMs?.());
      if (Number.isFinite(remaining) && remaining <= 250) return;
      timer = setTimeout(async () => {
        if (stopped || signal?.aborted) return;
        try {
          await inspectAndResolve();
        } catch (error) {
          const message = String(error?.message || error || '');
          if (!/expired|duration elapsed|duration-elapsed|closed|target page|browser has been closed/i.test(message)) {
            log(`Continuous blocker monitor recovered from a transient inspection error: ${message}`);
          }
        } finally {
          schedule();
        }
      }, intervalMs);
      timer?.unref?.();
    };
    schedule();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  return { inspectAndResolve, startContinuousMonitor };
}
module.exports = { createBlockerObserver };
