'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyVisitFailure, createVisitBudget } = require('./streaming-resilience.cjs');

function coded(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

test('song-level failures are skippable', () => {
  assert.equal(classifyVisitFailure(coded('ORBITQA_STREAMING_PLAYBACK_START_FAILED')), 'skip');
  assert.equal(classifyVisitFailure(coded('ORBITQA_STREAMING_MEDIA_UNAVAILABLE')), 'skip');
  assert.equal(classifyVisitFailure(new Error('Playback blocked: browser is not on the selected OrbitQA song')), 'skip');
  assert.equal(classifyVisitFailure(new Error('Spotify could not resolve the exact track from search: Song')), 'skip');
  assert.equal(classifyVisitFailure(new Error('No playable selected song remains in this QA pool: 404')), 'skip');
});

test('session-level failures ask the runner to recover', () => {
  assert.equal(classifyVisitFailure(coded('ORBITQA_STREAMING_PROBE_STALLED')), 'recover');
  assert.equal(classifyVisitFailure(new Error('Playback status did not respond within 9000ms')), 'recover');
  assert.equal(classifyVisitFailure(new Error('Service temporarily unavailable')), 'recover');
});

test('auth, abort and manual close are fatal', () => {
  assert.equal(classifyVisitFailure(coded('ORBITQA_STREAMING_AUTH_REQUIRED')), 'fatal');
  const aborted = new Error('stopped');
  aborted.name = 'AbortError';
  assert.equal(classifyVisitFailure(aborted), 'fatal');
  assert.equal(classifyVisitFailure(new Error('Spotify requires CAPTCHA/MFA/manual verification')), 'fatal');
});

test('unknown failures default to skip so one dud never ends the account', () => {
  assert.equal(classifyVisitFailure(new Error('something unexpected')), 'skip');
  assert.equal(classifyVisitFailure(null), 'fatal');
});

test('the budget caps attempts at the target plus the spare allowance', () => {
  const budget = createVisitBudget({ visitLimit: 3, spareAttempts: 2 });
  assert.equal(budget.canContinue(0), true);
  for (let index = 0; index < 5; index += 1) budget.beginVisit();
  assert.equal(budget.canContinue(0), false);
  assert.equal(budget.stats().ceiling, 5);
});

test('the budget stops counting skips against the visit target', () => {
  const budget = createVisitBudget({ visitLimit: 2 });
  budget.beginVisit();
  budget.recordSkip('bad song');
  assert.equal(budget.canContinue(0), true);
});

test('the breaker trips after the configured consecutive skips and resets on success', () => {
  const budget = createVisitBudget({ visitLimit: 10, maxConsecutiveFailures: 3 });
  budget.beginVisit();
  budget.recordSkip('a');
  budget.beginVisit();
  budget.recordSkip('b');
  assert.equal(budget.recordSkip('c').exhausted, true);

  budget.recordSuccess();
  assert.equal(budget.stats().consecutiveFailures, 0);
  assert.equal(budget.recordSkip('d').exhausted, false);
});