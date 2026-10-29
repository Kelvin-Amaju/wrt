'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { solveRecaptcha, detect, describeResult, normaliseAudioAnswer } = require('./recaptcha-solver.cjs');

function fakePage({
  url = 'https://www.google.com/sorry/index?continue=https%3A%2F%2Fexample.com',
  anchor = false,
  challenge = false,
  token = '',
} = {}) {
  const clicks = [];

  // Playwright locators are synchronous objects; only their methods are async.
  const makeLocator = (name) => ({
    first() { return this; },
    async count() { return 0; },
    async isVisible() { return true; },
    async boundingBox() { return { x: 10, y: 10, width: 40, height: 40 }; },
    async click() { clicks.push(name); },
    async fill() {},
    async getAttribute() { return null; },
  });

  return {
    clicks,
    url: () => url,
    mouse: { async move() {}, async down() {}, async up() {} },
    keyboard: { async type() {}, async press() {} },
    waitForTimeout: async () => {},
    async goto() {},

    locator(selector) {
      const present = (anchor && /anchor/.test(selector))
        || (challenge && /bframe|challenge/.test(selector));
      return {
        async count() { return present ? 1 : 0; },
        first() { return makeLocator(selector); },
      };
    },

    frameLocator(selector) {
      return {
        locator() { return makeLocator(selector); },
      };
    },

    async evaluate(selector) {
      if (token && /g-recaptcha-response/.test(selector)) return token;
      return '';
    },
  };
}

test('reports absent when no recaptcha surface exists', async () => {
  const result = await solveRecaptcha(fakePage());
  assert.equal(result.status, 'absent');
});

test('clicks the anchor checkbox and reports solved once a token appears', async () => {
  const page = fakePage({ anchor: true, token: 'token-123' });
  const result = await solveRecaptcha(page, { waitMs: 2000 });
  assert.equal(result.status, 'solved');
  assert.equal(result.token, 'token-123');
  assert.equal(page.clicks.length, 1);
});

test('reports challenge-unsolved when an image grid is open and audio is off', async () => {
  const page = fakePage({ anchor: true, challenge: true });
  const result = await solveRecaptcha(page, { waitMs: 800 });
  assert.equal(result.status, 'challenge-unsolved');
});

test('detect reads the interstitial and its continue target', async () => {
  const detection = await detect(fakePage({ anchor: true }));
  assert.equal(detection.interstitial, true);
  assert.equal(detection.continueUrl, 'https://example.com');
});

test('normalises a spoken audio answer to digits', () => {
  assert.equal(normaliseAudioAnswer('The answer is 4 7 2 9 1'), '47291');
  assert.equal(normaliseAudioAnswer('  twelve '), 'twelve');
});

test('describeResult never returns an empty label', () => {
  for (const status of ['absent', 'solved', 'solved-after-challenge', 'challenge-unsolved', 'timeout', 'failed']) {
    assert.ok(describeResult({ status, durationMs: 1 }).length > 0);
  }
});