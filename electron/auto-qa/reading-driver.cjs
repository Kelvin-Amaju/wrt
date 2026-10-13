const { smoothScrollBy } = require('../smart-interaction.cjs');
const { rngFromSeed } = require('./behavior-planner.cjs');

function between(min, max, rng) { return Math.round(min + ((max - min) * rng())); }

function createReadingProfile(readingPace = 'natural', seed = 'orbitqa') {
  const rng = rngFromSeed(`${seed}:${readingPace}`);
  const naturalPause = between(1400, 2400, rng);
  const distancePx = between(260, 520, rng);
  if (readingPace === 'slow') return { pauseMs:naturalPause + between(700, 1200, rng), distancePx:Math.max(220, distancePx - 60), chunkSize:50, chunkDelayMs:95 };
  if (readingPace === 'fast') return { pauseMs:Math.max(550, naturalPause - between(700, 1000, rng)), distancePx:Math.min(680, distancePx + 120), chunkSize:95, chunkDelayMs:45 };
  return { pauseMs:naturalPause, distancePx, chunkSize:65, chunkDelayMs:72 };
}


function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function createTraversalBudget({ readingPace='natural', remainingMs=60000, scrollDistancePx=0, finalReserveMs=5000, actionReserveMs:requestedActionReserveMs } = {}) {
  const remaining = Math.max(0, Number(remainingMs) || 0);
  const distance = Math.max(0, Number(scrollDistancePx) || 0);
  const finalReserve = Math.min(remaining, Math.max(1000, Number(finalReserveMs) || 5000));
  const availableAfterFinal = Math.max(0, remaining - finalReserve);
  const actionReserveMs = Number.isFinite(Number(requestedActionReserveMs))
    ? Math.min(Math.max(0, Number(requestedActionReserveMs)), availableAfterFinal)
    : Math.min(
      Math.max(4500, Math.round(remaining * 0.08)),
      Math.min(10000, availableAfterFinal),
    );
  const observationBudgetMs = Math.max(0, remaining - finalReserve - actionReserveMs);
  const returnBudgetMs = Math.min(observationBudgetMs, clamp(Math.round(observationBudgetMs * 0.18), 900, 7000));
  const downBudgetMs = Math.max(0, observationBudgetMs - returnBudgetMs);
  const base = createReadingProfile(readingPace, `adaptive:${Math.round(remaining / 1000)}:${Math.round(distance / 500)}`);
  const roomy = clamp((remaining - 15000) / 105000, 0, 1);
  const paceMultiplier = readingPace === 'slow' ? 1.25 : readingPace === 'fast' ? 0.7 : 1;
  const desiredPauseMs = clamp((550 + (1850 * roomy)) * paceMultiplier, 300, 3200);
  const chunkSize = Math.round(clamp(120 - (45 * roomy), 70, 120));
  const chunkDelayMs = Math.round(clamp(24 + (34 * roomy), 20, 70));
  const targetDistance = Math.max(220, base.distancePx * (1.65 - (0.7 * roomy)));
  const desiredSteps = Math.max(1, Math.ceil(Math.max(1, distance) / targetDistance));

  let stepCount = desiredSteps;
  let downDistance = Math.max(1, Math.ceil(Math.max(1, distance) / stepCount));
  let movementOverheadMs = Math.max(0, Math.ceil(downDistance / chunkSize) - 1) * chunkDelayMs;
  const boundaryPauseMs = Math.min(900, desiredPauseMs);
  const estimate = (steps, stepDistance, pauseMs) => {
    const movement = Math.max(0, Math.ceil(stepDistance / chunkSize) - 1) * chunkDelayMs;
    return (steps * (movement + pauseMs)) + Math.min(900, pauseMs);
  };

  while (stepCount > 1) {
    downDistance = Math.max(1, Math.ceil(Math.max(1, distance) / stepCount));
    if (estimate(stepCount, downDistance, desiredPauseMs) <= downBudgetMs) break;
    stepCount -= 1;
  }
  downDistance = Math.max(1, Math.ceil(Math.max(1, distance) / stepCount));
  movementOverheadMs = Math.max(0, Math.ceil(downDistance / chunkSize) - 1) * chunkDelayMs;
  const pauseCapacity = stepCount > 0
    ? Math.floor(Math.max(0, downBudgetMs - movementOverheadMs * stepCount - Math.min(900, desiredPauseMs)) / stepCount)
    : 0;
  const downPauseMs = Math.round(clamp(Math.min(desiredPauseMs, pauseCapacity || desiredPauseMs), 120, 3200));

  const down = {
    ...base,
    pauseMs:downPauseMs,
    distancePx:Math.max(220, downDistance + 2),
    chunkSize,
    chunkDelayMs,
  };

  const upDistance = Math.max(down.distancePx + 160, Math.round(down.distancePx * 2.4));
  const up = {
    pauseMs:Math.round(clamp(down.pauseMs * 0.12, 70, 260)),
    distancePx:Math.round(clamp(upDistance, 700, 3200)),
    chunkSize:Math.round(clamp(chunkSize * 1.7, 110, 190)),
    chunkDelayMs:Math.round(clamp(chunkDelayMs * 0.4, 10, 36)),
  };

  return {
    finalReserveMs:finalReserve,
    actionReserveMs,
    observationBudgetMs,
    returnBudgetMs,
    downBudgetMs,
    downReserveMs:finalReserve + actionReserveMs + returnBudgetMs,
    upReserveMs:finalReserve + actionReserveMs,
    down,
    up,
  };
}

async function wait(page, lifetime, ms) {
  if (lifetime?.wait) return lifetime.wait(ms);
  if (page?.waitForTimeout) return page.waitForTimeout(ms);
}

async function readScrollState(page) {
  if (!page?.evaluate) return null;
  try {
    const state = await page.evaluate(() => {
      const root = document.scrollingElement || document.documentElement;
      const scrollY = Number(window.scrollY || root.scrollTop || 0);
      const scrollHeight = Math.max(Number(root.scrollHeight || 0), Number(document.body?.scrollHeight || 0));
      const viewportHeight = Math.max(1, Number(window.innerHeight || root.clientHeight || 1));
      return { scrollY, scrollHeight, viewportHeight, maxScroll:Math.max(0, scrollHeight - viewportHeight) };
    });
    if (!state || !Number.isFinite(state.scrollY) || !Number.isFinite(state.maxScroll)) return null;
    return state;
  } catch {
    return null;
  }
}

function enoughTime(lifetime, reserveMs, minimumMs = 250) {
  const remaining = Number(lifetime?.remainingMs?.());
  return !Number.isFinite(remaining) || remaining > reserveMs + minimumMs;
}

async function readablePause(page, lifetime, ms, reserveMs) {
  const remaining = Number(lifetime?.remainingMs?.());
  if (Number.isFinite(remaining)) {
    const allowed = Math.max(0, remaining - reserveMs);
    if (allowed <= 0) return false;
    ms = Math.min(ms, allowed);
  }
  if (ms > 0) await wait(page, lifetime, ms);
  return true;
}

async function performReadingScroll(page, { readingPace='natural', seed='orbitqa', direction='down', lifetime, log=()=>{} } = {}) {
  lifetime?.throwIfExpired?.();
  const profile = createReadingProfile(readingPace, seed);
  const delta = direction === 'up' ? -profile.distancePx : profile.distancePx;
  await smoothScrollBy(page, delta, { lifetime, chunkSize:profile.chunkSize, delayMs:profile.chunkDelayMs });
  log(`Reading scroll ${direction}: ${Math.abs(delta)} px`);
  lifetime?.throwIfExpired?.();
  await wait(page, lifetime, profile.pauseMs);
  lifetime?.throwIfExpired?.();
  return profile;
}

async function traverseBoundary(page, direction, {
  readingPace='natural', seed='orbitqa', lifetime, log=()=>{}, onCheckpoint,
  reserveMs=5000, maxSteps=80, profileOverride=null,
} = {}) {
  const profile = profileOverride || createReadingProfile(readingPace, `${seed}:${direction}`);
  let stableBoundaryChecks = 0;
  let lastScrollHeight = null;

  for (let step = 0; step < maxSteps; step += 1) {
    lifetime?.throwIfExpired?.();
    const state = await readScrollState(page);
    if (!state) return { reached:false, reason:'metrics-unavailable', steps:step };

    const atBoundary = direction === 'down'
      ? state.scrollY >= state.maxScroll - 3
      : state.scrollY <= 3;

    if (atBoundary) {
      const sameHeight = lastScrollHeight === null || Math.abs(state.scrollHeight - lastScrollHeight) <= 2;
      stableBoundaryChecks = sameHeight ? stableBoundaryChecks + 1 : 1;
      lastScrollHeight = state.scrollHeight;
      if (stableBoundaryChecks >= (direction === 'down' ? 2 : 1)) {
        return { reached:true, reason:'boundary', steps:step };
      }
      await readablePause(page, lifetime, Math.min(profile.pauseMs, 900), reserveMs);
      if (onCheckpoint) await onCheckpoint({ direction, step, state, atBoundary:true });
      continue;
    }

    if (!enoughTime(lifetime, reserveMs, 350)) return { reached:false, reason:'time-reserve', steps:step };
    stableBoundaryChecks = 0;
    lastScrollHeight = state.scrollHeight;
    const remainingDistance = direction === 'down' ? state.maxScroll - state.scrollY : state.scrollY;
    const delta = Math.min(profile.distancePx, Math.max(1, remainingDistance)) * (direction === 'down' ? 1 : -1);
    await smoothScrollBy(page, delta, { lifetime, chunkSize:profile.chunkSize, delayMs:profile.chunkDelayMs });
    const after = await readScrollState(page) || state;
    const denominator = Math.max(1, after.maxScroll);
    const position = Math.max(0, Math.min(100, Math.round((after.scrollY / denominator) * 100)));
    log(`Reading pass ${direction}: ${position}%`);
    if (onCheckpoint) await onCheckpoint({ direction, step, state:after, atBoundary:false });
    lifetime?.throwIfExpired?.();
    if (!await readablePause(page, lifetime, profile.pauseMs, reserveMs)) return { reached:false, reason:'time-reserve', steps:step + 1 };
  }

  return { reached:false, reason:'step-cap', steps:maxSteps };
}

async function performFullPageObservation(page, {
  readingPace='natural', seed='orbitqa', lifetime, log=()=>{}, onCheckpoint,
  reserveMs=5000, actionReserveMs, maxStepsPerDirection=80,
} = {}) {
  lifetime?.throwIfExpired?.();
  const initial = await readScrollState(page);
  if (!initial) return { reachedBottom:false, reachedTop:false, completedRoundTrip:false, reason:'metrics-unavailable' };

  if (initial.scrollY > 3) {
    log('Returning gently to the top before full-page observation');
    const topFirst = await traverseBoundary(page, 'up', {
      readingPace, seed:`${seed}:initial-top`, lifetime, log, onCheckpoint,
      reserveMs, maxSteps:maxStepsPerDirection,
    });
    if (!topFirst.reached) return { reachedBottom:false, reachedTop:false, completedRoundTrip:false, reason:topFirst.reason };
  }

  const budget = createTraversalBudget({
    readingPace,
    remainingMs:Number(lifetime?.remainingMs?.() ?? 60000),
    scrollDistancePx:initial.maxScroll,
    finalReserveMs:reserveMs,
    actionReserveMs,
  });
  log(`Full-page observation: reading from top toward the bottom · adaptive budget ${Math.round(budget.observationBudgetMs / 1000)}s`);
  const down = await traverseBoundary(page, 'down', {
    readingPace, seed:`${seed}:down`, lifetime, log, onCheckpoint,
    reserveMs:budget.downReserveMs, maxSteps:maxStepsPerDirection, profileOverride:budget.down,
  });
  if (!down.reached) {
    const stateAfterDown = await readScrollState(page);
    if (stateAfterDown && stateAfterDown.scrollY > 3 && enoughTime(lifetime, budget.upReserveMs, 120)) {
      log('Reading budget reached before stable bottom; returning toward the top now to preserve the primary site action');
      const recoveryUp = await traverseBoundary(page, 'up', {
        readingPace, seed:`${seed}:budget-return`, lifetime, log, onCheckpoint,
        reserveMs:budget.upReserveMs, maxSteps:maxStepsPerDirection, profileOverride:budget.up,
      });
      return { reachedBottom:false, reachedTop:recoveryUp.reached, completedRoundTrip:false, reason:down.reason, budget };
    }
    return { reachedBottom:false, reachedTop:Boolean(stateAfterDown && stateAfterDown.scrollY <= 3), completedRoundTrip:false, reason:down.reason, budget };
  }

  log('Reached a stable page bottom; returning toward the top at a faster review pace');
  const up = await traverseBoundary(page, 'up', {
    readingPace, seed:`${seed}:up`, lifetime, log, onCheckpoint,
    reserveMs:budget.upReserveMs, maxSteps:maxStepsPerDirection, profileOverride:budget.up,
  });
  const completedRoundTrip = down.reached && up.reached;
  if (completedRoundTrip) log('Full-page observation complete: top → bottom → top');
  return { reachedBottom:down.reached, reachedTop:up.reached, completedRoundTrip, reason:completedRoundTrip ? 'complete' : up.reason, budget };
}

module.exports = { createReadingProfile, createTraversalBudget, readScrollState, performReadingScroll, performFullPageObservation };
