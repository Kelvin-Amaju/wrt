'use strict';

// Spotify inserts a reCAPTCHA gate between the identifier step and the password step, either as a
// full-page redirect to challenge.spotify.com or as an embedded enterprise reCAPTCHA frame.
// The credential flow must clear that gate before it can wait for the password field, otherwise
// the wait times out and the account is escalated to manual verification for no good reason.
//
// The solver is injected so this module stays independent of how reCAPTCHA is solved. Detection
// only: the password field and the submit button remain the adapter's responsibility.

const PASSWORD_SELECTORS = [
  'input[type="password"]',
  '#password',
  'input[name="password"]',
  'input[autocomplete="current-password"]',
];

const CHALLENGE_SELECTORS = [
  'iframe[src*="recaptcha/enterprise/anchor"]',
  'iframe[src*="recaptcha/api2/anchor"]',
  'iframe[title*="reCAPTCHA" i]',
  '#captcha-container',
  '[data-testid="captcha"]',
  '[data-testid="challenge-container"]',
];

const POLL_MS = 500;
const CHALLENGE_URL = /challenge\.spotify\.com/i;
const LOGIN_URL = /accounts\.spotify\.com/i;

function abortError() {
  const error = new Error('Spotify login cancelled');
  error.name = 'AbortError';
  return error;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener?.('abort', () => { clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}

function safeUrl(page) {
  try { return String(page?.url?.() || ''); } catch { return ''; }
}

async function passwordFieldVisible(page) {
  for (const selector of PASSWORD_SELECTORS) {
    try {
      if (await page.locator(selector).first().isVisible()) return true;
    } catch { /* selector not present yet */ }
  }
  return false;
}

// Returns 'page' for a full-page challenge redirect, 'frame' for an embedded challenge, '' for none.
async function challengeVisible(page) {
  if (CHALLENGE_URL.test(safeUrl(page))) return 'page';
  for (const selector of CHALLENGE_SELECTORS) {
    try {
      if (await page.locator(selector).first().isVisible()) return 'frame';
    } catch { /* selector not present */ }
  }
  return '';
}

async function waitForChallengeToClear(page, { signal, timeoutMs = 20000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw abortError();
    if (!CHALLENGE_URL.test(safeUrl(page)) && !(await challengeVisible(page))) return true;
    await sleep(POLL_MS, signal);
  }
  return false;
}

// Resolves the gate once. Returns 'solved', 'unsolved' or 'unavailable'.
async function solveSpotifyChallenge({ page, signal, solveRecaptcha, log, workId, attempt = 1 } = {}) {
  if (typeof solveRecaptcha !== 'function') return 'unavailable';
  try {
    log?.(`Spotify login challenge detected; solving before the password step (attempt ${attempt})`, {
      workId, type: 'spotify-login-challenge', severity: 'warning', stage: 'authentication',
      action: 'solve-login-challenge', currentUrl: safeUrl(page), attempt,
    });
  } catch { /* logging is best effort */ }

  let result = null;
  try {
    result = await solveRecaptcha({ page, signal, log, workId, platform: 'spotify', context: 'spotify-credential-login' });
  } catch (error) {
    try {
      log?.(`Spotify login challenge solver failed: ${error instanceof Error ? error.message : String(error)}`, {
        workId, type: 'spotify-login-challenge', severity: 'warning', stage: 'authentication',
        action: 'solve-login-challenge-failed', currentUrl: safeUrl(page), attempt,
        reason: error instanceof Error ? error.message : String(error),
      });
    } catch { /* ignore */ }
    return 'unsolved';
  }

  const solved = Boolean(result && (result.solved === true || result.status === 'solved' || result.status === 'PASS'));
  const cleared = solved || await waitForChallengeToClear(page, { signal });
  try {
    log?.(cleared
      ? 'Spotify login challenge cleared; continuing to the password step'
      : `Spotify login challenge did not clear after attempt ${attempt}`,
    {
      workId, type: 'spotify-login-challenge', severity: cleared ? 'success' : 'warning', stage: 'authentication',
      action: cleared ? 'login-challenge-cleared' : 'login-challenge-stuck', currentUrl: safeUrl(page), attempt,
    });
  } catch { /* ignore */ }
  return cleared ? 'solved' : 'unsolved';
}

// Waits for the password step, clearing a challenge gate if Spotify interposes one.
// Call this after the identifier is submitted and before the password field is filled.
async function awaitSpotifyPasswordField({ page, signal, solveRecaptcha, log, workId, timeoutMs = 60000, maxChallengeAttempts = 2 } = {}) {
  if (!page) throw new Error('A page is required to await the Spotify password step');
  const deadline = Date.now() + Math.max(5000, Number(timeoutMs) || 60000);
  let challengeAttempts = 0;
  let challenged = false;
  let lastReason = '';

  while (Date.now() < deadline) {
    if (signal?.aborted) throw abortError();

    if (await passwordFieldVisible(page)) {
      return { status: 'ready', challenged, challengeAttempts, reason: challenged ? 'Password step reached after clearing a login challenge' : 'Password step reached' };
    }

    const gate = await challengeVisible(page);
    if (gate && challengeAttempts < maxChallengeAttempts) {
      challenged = true;
      challengeAttempts += 1;
      const outcome = await solveSpotifyChallenge({ page, signal, solveRecaptcha, log, workId, attempt: challengeAttempts });
      if (outcome === 'unavailable') {
        return { status: 'challenge-detected', challenged: true, challengeAttempts, reason: 'Spotify requires a login challenge and no solver is available' };
      }
      if (outcome === 'solved') continue;
      lastReason = `Spotify login challenge was not cleared on attempt ${challengeAttempts}`;
      await sleep(POLL_MS, signal);
      continue;
    }

    if (gate && challengeAttempts >= maxChallengeAttempts) {
      return { status: 'challenge-unresolved', challenged: true, challengeAttempts, reason: lastReason || 'Spotify login challenge did not clear' };
    }

    // A full-page challenge that has already redirected back may still be rendering the form.
    if (!LOGIN_URL.test(safeUrl(page)) && !CHALLENGE_URL.test(safeUrl(page))) {
      lastReason = `Unexpected page during the Spotify password step: ${safeUrl(page) || 'unknown'}`;
    }

    await sleep(POLL_MS, signal);
  }

  return {
    status: 'timeout',
    challenged,
    challengeAttempts,
    reason: lastReason || `Spotify password field did not appear within ${Math.round((Number(timeoutMs) || 60000) / 1000)}s`,
  };
}

module.exports = { awaitSpotifyPasswordField, solveSpotifyChallenge, passwordFieldVisible, challengeVisible };