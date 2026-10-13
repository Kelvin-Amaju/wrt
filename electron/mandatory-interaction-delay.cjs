const { randomInt } = require('node:crypto');

const MIN_INTERACTION_DELAY_MS = 2000;
const MAX_INTERACTION_DELAY_MS = 5000;

function randomInteractionDelayMs() {
  return randomInt(MIN_INTERACTION_DELAY_MS, MAX_INTERACTION_DELAY_MS + 1);
}

function abortError() {
  const error = new Error('OrbitQA task stopped during interaction wait');
  error.name = 'AbortError';
  return error;
}

async function waitBeforePageInteraction(options = {}) {
  const signal = options.signal || null;
  if (signal?.aborted) throw abortError();
  const delayMs = randomInteractionDelayMs();

  if (options.lifetime && typeof options.lifetime.wait === 'function') {
    await options.lifetime.wait(delayMs);
    return delayMs;
  }

  if (typeof options.wait === 'function') {
    await options.wait(delayMs, signal);
    return delayMs;
  }

  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    if (!signal?.addEventListener) return;
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return delayMs;
}

module.exports = {
  MIN_INTERACTION_DELAY_MS,
  MAX_INTERACTION_DELAY_MS,
  randomInteractionDelayMs,
  waitBeforePageInteraction,
};
