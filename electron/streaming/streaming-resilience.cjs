'use strict';

/*
 * streaming-resilience.cjs - OrbitQA Desktop
 *
 * Classifies a failed song visit so the session can move on instead of ending.
 *
 * Three verdicts:
 *   skip    - the song is the problem (unavailable, DRM, never became ready,
 *             never started). Advance to the next selected song.
 *   recover - the session is the problem (stalled browser, transient service
 *             error). Let the runner retry the account with its preserved profile.
 *   fatal   - retrying will not help (stopped, auth required, closed browser).
 *
 * A consecutive-skip breaker keeps a genuinely broken account from grinding
 * through every song before it fails.
 */

const FATAL_CODES = new Set(['ORBITQA_STREAMING_AUTH_REQUIRED']);
const RECOVER_CODES = new Set(['ORBITQA_STREAMING_PROBE_STALLED']);
const SKIP_CODES = new Set([
  'ORBITQA_STREAMING_PLAYBACK_START_FAILED',
  'ORBITQA_STREAMING_MEDIA_UNAVAILABLE',
]);

const FATAL_PATTERNS = [
  /browser (?:was )?closed manually/i,
  /requires captcha|mfa|multi[- ]factor|two[- ]factor|manual verification/i,
  /saved (?:account|session).{0,30}(?:not active|expired)/i,
];

const RECOVER_PATTERNS = [
  /did not respond within/i,
  /became unresponsive/i,
  /temporarily unavailable|temporary (?:page|network|error)/i,
];

const SKIP_PATTERNS = [
  /playback did not start/i,
  /protected media is unavailable|DRM|Widevine/i,
  /browser is not on the selected/i,
  /outside the selected OrbitQA music list/i,
  /could not be opened|could not resolve|could not provide a playable/i,
  /did not become ready|still loading/i,
  /no playable selected song remains/i,
  /not found|unavailable|removed|does not exist/i,
];

function classifyVisitFailure(error) {
  if (!error) return 'fatal';
  if (error.name === 'AbortError') return 'fatal';
  const code = String(error.code || '');
  if (FATAL_CODES.has(code)) return 'fatal';
  if (RECOVER_CODES.has(code)) return 'recover';
  if (SKIP_CODES.has(code)) return 'skip';
  const text = String(error.message || error);
  if (FATAL_PATTERNS.some((pattern) => pattern.test(text))) return 'fatal';
  if (RECOVER_PATTERNS.some((pattern) => pattern.test(text))) return 'recover';
  if (SKIP_PATTERNS.some((pattern) => pattern.test(text))) return 'skip';
  // Unknown failures are treated as song-level: the breaker surfaces anything
  // systemic within a handful of songs, and a single dud never ends the account.
  return 'skip';
}

/**
 * Bounded attempt accounting.
 *
 * Attempts are capped at the visit limit plus a small spare allowance, so
 * skipping cannot turn into an unbounded walk through the pool.
 */
function createVisitBudget({ visitLimit, maxConsecutiveFailures = 5, spareAttempts = 8 } = {}) {
  const target = Math.max(1, Math.floor(Number(visitLimit) || 1));
  const spare = Math.max(0, Math.min(Math.floor(Number(spareAttempts) || 0), 25));
  const ceiling = target + spare;
  const limit = Math.max(1, Math.floor(Number(maxConsecutiveFailures) || 1));
  const state = { attempts: 0, skipped: 0, consecutiveFailures: 0 };

  return {
    canContinue(visits) {
      return Number(visits) < target && state.attempts < ceiling;
    },
    beginVisit() {
      state.attempts += 1;
    },
    recordSuccess() {
      state.consecutiveFailures = 0;
    },
    recordSkip(reason) {
      state.skipped += 1;
      state.consecutiveFailures += 1;
      return {
        reason: String(reason || ''),
        consecutiveFailures: state.consecutiveFailures,
        exhausted: state.consecutiveFailures >= limit,
      };
    },
    stats() {
      return { target, ceiling, ...state };
    },
  };
}

function skipReasonForLog(error, attempt, limit) {
  const reason = String(error?.message || error || 'unknown failure');
  return `Selected song skipped (${attempt}/${limit} consecutive): ${reason}`;
}

module.exports = { classifyVisitFailure, createVisitBudget, skipReasonForLog };