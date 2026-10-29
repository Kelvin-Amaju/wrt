'use strict';

/*
 * recaptcha-solver.cjs - OrbitQA Desktop
 *
 * Handles the reCAPTCHA v2 checkbox interstitial (google.com/sorry, and any
 * v2 anchor frame) without a paid solving service.
 *
 * Strategy, in order:
 *   1. detect the anchor frame / g-recaptcha container
 *   2. click the checkbox with a human-ish pointer path
 *   3. watch for the token, the aria-checked flag, or a navigation off the
 *      interstitial - any of which means solved
 *   4. if an image challenge appears, switch to the audio challenge and
 *      transcribe it when an STT key is configured; otherwise leave the page
 *      for the operator and report challenge-unsolved
 *
 * Never throws. Every entry point returns a structured result so the caller can
 * log and continue instead of losing the work unit.
 */

const ANCHOR_FRAME_SELECTORS = [
  'iframe[src*="recaptcha/api2/anchor"]',
  'iframe[src*="recaptcha/enterprise/anchor"]',
  'iframe[title="reCAPTCHA"]',
];

const CHALLENGE_FRAME_SELECTORS = [
  'iframe[src*="recaptcha/api2/bframe"]',
  'iframe[src*="recaptcha/enterprise/bframe"]',
  'iframe[title="recaptcha challenge expires in two minutes"]',
  'iframe[title*="challenge"]',
];

const CHECKBOX_SELECTORS = [
  '#recaptcha-anchor',
  '.recaptcha-checkbox-border',
  'span.recaptcha-checkbox',
  '[role="checkbox"]',
];

const TOKEN_SELECTORS = [
  'textarea#g-recaptcha-response',
  'textarea[name="g-recaptcha-response"]',
  '#g-recaptcha-response',
];

const INTERSTITIAL_URL_PATTERN = /\/sorry\/index|\/sorry\/|recaptcha/i;
const CONTINUE_PARAM_PATTERN = /[?&]continue=([^&]+)/;

const AUDIO_BUTTON_SELECTORS = [
  '#recaptcha-audio-button',
  'button#recaptcha-audio-button',
];

const AUDIO_LINK_SELECTORS = [
  '.rc-audiochallenge-tdownload-link',
  'a[href*="/reCaptcha/"]',
  'a[href$=".mp3"]',
];

const AUDIO_INPUT_SELECTORS = [
  '#audio-response',
  'input#audio-response',
];

const AUDIO_VERIFY_SELECTORS = [
  '#recaptcha-verify-button',
  'button#recaptcha-verify-button',
];

const TRANSCRIBE_ENDPOINTS = {
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions', model: 'whisper-1' },
  groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo' },
};

function wait(page, lifetime, ms) {
  if (lifetime && typeof lifetime.wait === 'function') return lifetime.wait(ms);
  if (page && typeof page.waitForTimeout === 'function') return page.waitForTimeout(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function remainingMs(lifetime) {
  const value = Number(lifetime?.remainingMs?.());
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function clampToBudget(lifetime, wantedMs, reserveMs = 800) {
  const left = remainingMs(lifetime) - reserveMs;
  if (!Number.isFinite(left)) return wantedMs;
  return Math.max(0, Math.min(wantedMs, left));
}

function firstFrameLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.frameLocator(selector);
    return { locator, selector };
  }
  return null;
}

async function anyVisible(scope, selectors) {
  for (const selector of selectors) {
    try {
      const locator = scope.locator(selector).first();
      if (await locator.isVisible({ timeout: 400 }).catch(() => false)) return { locator, selector };
    } catch {
      // Detached frame or selector unsupported on this scope.
    }
  }
  return null;
}

async function framePresent(page, selectors) {
  for (const selector of selectors) {
    try {
      const count = await page.locator(selector).count();
      if (count > 0) return selector;
    } catch {
      // Ignore and try the next selector.
    }
  }
  return null;
}

async function readToken(page) {
  for (const selector of TOKEN_SELECTORS) {
    try {
      const value = await page.evaluate((sel) => {
        const element = document.querySelector(sel);
        return element && typeof element.value === 'string' ? element.value.trim() : '';
      }, selector);
      if (value) return value;
    } catch {
      // Page may be mid-navigation.
    }
  }
  return '';
}

async function readChecked(anchorFrame) {
  for (const selector of CHECKBOX_SELECTORS) {
    try {
      const value = await anchorFrame.locator(selector).first().getAttribute('aria-checked', { timeout: 500 });
      if (value != null) return value === 'true';
    } catch {
      // Try the next selector.
    }
  }
  return null;
}

function decodeContinue(href) {
  const match = CONTINUE_PARAM_PATTERN.exec(String(href || ''));
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

async function detect(page) {
  const url = typeof page?.url === 'function' ? page.url() : '';
  const anchorSelector = await framePresent(page, ANCHOR_FRAME_SELECTORS);
  let container = null;
  try {
    container = await page.locator('.g-recaptcha[data-sitekey], [data-sitekey]').first()
      .getAttribute('data-sitekey', { timeout: 400 });
  } catch {
    container = null;
  }
  const challengeSelector = await framePresent(page, CHALLENGE_FRAME_SELECTORS);
  const present = Boolean(anchorSelector || challengeSelector || container);
  return {
    present,
    interstitial: INTERSTITIAL_URL_PATTERN.test(url),
    continueUrl: decodeContinue(url),
    sitekey: container || '',
    anchorSelector: anchorSelector || '',
    challengeSelector: challengeSelector || '',
    url,
  };
}

/*
 * A human click: hover in from an offset, settle, then press. Google scores the
 * pointer path, so a teleporting click() is measurably worse than a short move.
 */
async function humanClick(page, locator, lifetime) {
  const box = await locator.boundingBox({ timeout: 2500 }).catch(() => null);
  if (box) {
    const targetX = box.x + box.width * (0.42 + Math.random() * 0.16);
    const targetY = box.y + box.height * (0.42 + Math.random() * 0.16);
    try {
      await page.mouse.move(targetX - 46 - Math.random() * 40, targetY - 24 - Math.random() * 26, { steps: 7 });
      await wait(page, lifetime, 90 + Math.floor(Math.random() * 130));
      await page.mouse.move(targetX, targetY, { steps: 11 });
      await wait(page, lifetime, 60 + Math.floor(Math.random() * 90));
      await page.mouse.down();
      await wait(page, lifetime, 45 + Math.floor(Math.random() * 70));
      await page.mouse.up();
      return 'pointer';
    } catch {
      // Fall through to locator click.
    }
  }
  try {
    await locator.click({ timeout: 2500 });
    return 'click';
  } catch {
    await locator.click({ timeout: 2500, force: true });
    return 'force';
  }
}

async function clickCheckbox(page, lifetime, log) {
  const anchorSelector = await framePresent(page, ANCHOR_FRAME_SELECTORS);
  if (!anchorSelector) return { clicked: false, reason: 'no-anchor-frame' };

  const anchorFrame = page.frameLocator(anchorSelector);
  const target = await anyVisible(anchorFrame, CHECKBOX_SELECTORS);
  if (!target) return { clicked: false, reason: 'no-checkbox' };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const method = await humanClick(page, target.locator, lifetime);
      log(`reCAPTCHA checkbox activated (${method}, attempt ${attempt})`);
      return { clicked: true, method };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`reCAPTCHA checkbox click failed on attempt ${attempt}: ${message}`);
      await wait(page, lifetime, 400 + attempt * 250);
    }
  }
  return { clicked: false, reason: 'click-failed' };
}

async function waitForOutcome(page, lifetime, startedUrl, timeoutMs) {
  const deadline = Date.now() + Math.max(500, timeoutMs);
  const anchorSelector = await framePresent(page, ANCHOR_FRAME_SELECTORS);

  while (Date.now() < deadline) {
    if (remainingMs(lifetime) < 400) return { outcome: 'timeout' };

    if (await framePresent(page, CHALLENGE_FRAME_SELECTORS)) {
      return { outcome: 'challenge' };
    }

    const token = await readToken(page);
    if (token) return { outcome: 'solved', token };

    if (anchorSelector) {
      const checked = await readChecked(page.frameLocator(anchorSelector));
      if (checked === true) {
        // Checked but no token yet; Google may still be issuing one.
        const settle = Math.min(1200, Math.max(250, deadline - Date.now()));
        await wait(page, lifetime, settle);
        const lateToken = await readToken(page);
        if (lateToken) return { outcome: 'solved', token: lateToken };
        return { outcome: 'solved' };
      }
    }

    const url = typeof page?.url === 'function' ? page.url() : '';
    if (url && startedUrl && url !== startedUrl && !INTERSTITIAL_URL_PATTERN.test(url)) {
      return { outcome: 'navigated', url };
    }

    await wait(page, lifetime, 250);
  }

  return { outcome: 'timeout' };
}

function normaliseAudioAnswer(text) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return '';
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.length >= 3) return digits;
  return raw.replace(/[^a-z0-9]/g, '');
}

async function transcribeAudio(buffer, options = {}) {
  const provider = String(options.provider || 'openai').toLowerCase();
  const endpoint = TRANSCRIBE_ENDPOINTS[provider] || TRANSCRIBE_ENDPOINTS.openai;
  const apiKey = options.apiKey;
  if (!apiKey) return { ok: false, reason: 'no-api-key' };

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/mpeg' }), 'challenge.mp3');
  form.append('model', options.model || endpoint.model);
  form.append('response_format', 'json');

  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return { ok: false, reason: `stt-${response.status}`, detail: detail.slice(0, 300) };
  }
  const payload = await response.json().catch(() => ({}));
  const text = normaliseAudioAnswer(payload.text);
  if (!text) return { ok: false, reason: 'empty-transcript' };
  return { ok: true, text };
}

async function solveAudioChallenge(page, lifetime, log, options) {
  const challengeSelector = await framePresent(page, CHALLENGE_FRAME_SELECTORS);
  if (!challengeSelector) return { solved: false, reason: 'no-challenge-frame' };

  const challengeFrame = page.frameLocator(challengeSelector);
  const audioButton = await anyVisible(challengeFrame, AUDIO_BUTTON_SELECTORS);
  if (!audioButton) return { solved: false, reason: 'no-audio-button' };

  try {
    await audioButton.locator.click({ timeout: 2500 });
  } catch {
    await audioButton.locator.click({ timeout: 2500, force: true }).catch(() => undefined);
  }
  log('reCAPTCHA switched to the audio challenge');
  await wait(page, lifetime, 900);

  let audioUrl = '';
  for (const selector of AUDIO_LINK_SELECTORS) {
    try {
      const href = await challengeFrame.locator(selector).first().getAttribute('href', { timeout: 1200 });
      if (href) { audioUrl = href; break; }
    } catch {
      // Try the next selector.
    }
  }
  if (!audioUrl) return { solved: false, reason: 'no-audio-source' };

  let buffer = null;
  try {
    const response = await fetch(audioUrl, { redirect: 'follow' });
    if (!response.ok) return { solved: false, reason: `audio-${response.status}` };
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return { solved: false, reason: `audio-download: ${error.message}` };
  }
  if (!buffer || buffer.length < 800) return { solved: false, reason: 'audio-too-small' };

  const transcription = await transcribeAudio(buffer, options).catch((error) => ({ ok: false, reason: error.message }));
  if (!transcription.ok) {
    log(`reCAPTCHA audio challenge needs a manual answer (${transcription.reason})`);
    return { solved: false, reason: transcription.reason };
  }
  log(`reCAPTCHA audio transcript: "${transcription.text}"`);

  const input = await anyVisible(challengeFrame, AUDIO_INPUT_SELECTORS);
  if (!input) return { solved: false, reason: 'no-answer-input' };
  try {
    await input.locator.fill(transcription.text, { timeout: 2500 });
  } catch {
    await input.locator.click({ timeout: 2000 }).catch(() => undefined);
    await page.keyboard.type(transcription.text, { delay: 40 });
  }
  await wait(page, lifetime, 150);

  const verify = await anyVisible(challengeFrame, AUDIO_VERIFY_SELECTORS);
  if (verify) {
    await verify.locator.click({ timeout: 2500 }).catch(() => undefined);
  } else {
    await page.keyboard.press('Enter').catch(() => undefined);
  }
  log('reCAPTCHA audio answer submitted');
  await wait(page, lifetime, 1200);

  const token = await readToken(page);
  if (token) return { solved: true, token };
  if (await framePresent(page, CHALLENGE_FRAME_SELECTORS)) {
    return { solved: false, reason: 'audio-rejected' };
  }
  return { solved: true };
}

/**
 * Main entry point.
 *
 * @returns {Promise<{status:string, detail?:string, token?:string, attempts:number, durationMs:number, kind:string}>}
 *   status: absent | solved | solved-after-challenge | challenge-unsolved | timeout | failed
 */
async function solveRecaptcha(page, options = {}) {
  const startedAt = Date.now();
  const log = typeof options.log === 'function' ? options.log : () => {};
  const lifetime = options.lifetime || null;
  const detection = await detect(page).catch(() => ({ present: false }));

  if (!detection.present) {
    return { status: 'absent', attempts: 0, durationMs: Date.now() - startedAt, kind: 'none' };
  }

  const kind = detection.challengeSelector ? 'challenge-open' : detection.sitekey ? 'v2-sitekey' : 'v2-interstitial';
  log(`reCAPTCHA detected (${kind}${detection.interstitial ? ', google interstitial' : ''})`);

  // The interstitial sometimes self-resolves after the JS risk check.
  if (detection.interstitial) {
    const settleMs = clampToBudget(lifetime, 1800);
    if (settleMs > 0) await wait(page, lifetime, settleMs);
    const afterSettle = await detect(page).catch(() => ({ present: true, challengeSelector: '' }));
    if (!afterSettle.present) {
      log('reCAPTCHA interstitial cleared without interaction');
      return { status: 'solved', attempts: 0, durationMs: Date.now() - startedAt, kind };
    }
    if (afterSettle.continueUrl && typeof page.goto === 'function') {
      const currentUrl = typeof page.url === 'function' ? page.url() : '';
      if (currentUrl && currentUrl !== afterSettle.continueUrl && !INTERSTITIAL_URL_PATTERN.test(currentUrl)) {
        return { status: 'solved', attempts: 0, durationMs: Date.now() - startedAt, kind };
      }
    }
  }

  let attempts = 0;
  if (!detection.challengeSelector) {
    const click = await clickCheckbox(page, lifetime, log);
    attempts = 1;
    if (!click.clicked) {
      return { status: 'failed', detail: click.reason, attempts, durationMs: Date.now() - startedAt, kind };
    }
  }

  const waitMs = clampToBudget(lifetime, Number(options.waitMs) || 12000, 1500);
  const outcome = await waitForOutcome(page, lifetime, detection.url, waitMs);

  if (outcome.outcome === 'solved' || outcome.outcome === 'navigated') {
    log('reCAPTCHA cleared');
    return { status: 'solved', token: outcome.token, attempts, durationMs: Date.now() - startedAt, kind };
  }

  if (outcome.outcome === 'challenge') {
    log('reCAPTCHA issued an image challenge');
    if (options.audio === true && options.apiKey) {
      const audio = await solveAudioChallenge(page, lifetime, log, options);
      if (audio.solved) {
        log('reCAPTCHA cleared through the audio challenge');
        return { status: 'solved-after-challenge', token: audio.token, attempts: attempts + 1, durationMs: Date.now() - startedAt, kind };
      }
      return { status: 'challenge-unsolved', detail: audio.reason, attempts: attempts + 1, durationMs: Date.now() - startedAt, kind };
    }
    return { status: 'challenge-unsolved', detail: 'image grid', attempts, durationMs: Date.now() - startedAt, kind };
  }

  if (outcome.outcome === 'timeout') {
    return { status: 'timeout', detail: `${waitMs}ms without a token`, attempts, durationMs: Date.now() - startedAt, kind };
  }

  return { status: 'failed', detail: 'unknown outcome', attempts, durationMs: Date.now() - startedAt, kind };
}

function describeResult(result) {
  if (!result) return 'reCAPTCHA: no result';
  switch (result.status) {
    case 'absent': return 'reCAPTCHA: not present';
    case 'solved': return `reCAPTCHA: cleared in ${result.durationMs}ms`;
    case 'solved-after-challenge': return `reCAPTCHA: cleared via audio challenge in ${result.durationMs}ms`;
    case 'challenge-unsolved': return `reCAPTCHA: image challenge left for review (${result.detail || 'unsolved'})`;
    case 'timeout': return `reCAPTCHA: no token within ${result.durationMs}ms`;
    default: return `reCAPTCHA: failed (${result.detail || 'unknown'})`;
  }
}

module.exports = {
  solveRecaptcha,
  detect,
  describeResult,
  transcribeAudio,
  normaliseAudioAnswer,
  INTERSTITIAL_URL_PATTERN,
};