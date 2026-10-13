function createSessionExpiredError() {
  const error = new Error('Browser session duration elapsed');
  error.name = 'SessionExpiredError';
  return error;
}

function createSessionAbortError() {
  const error = new Error('QA run stopped by user');
  error.name = 'AbortError';
  return error;
}

function createSessionLifetimeController({
  context,
  durationMs,
  signal,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  if (!context || typeof context.close !== 'function') throw new Error('Session lifetime requires a browser context');
  let normalizedDuration = Math.max(0, Number(durationMs) || 0);
  let startedAt = now();
  let deadlineAt = startedAt + normalizedDuration;
  let expired = false;
  let reason = null;
  let closePromise = null;
  let deadlineTimer = null;
  let abortListener = null;
  let closedResolve;
  const closedSignal = new Promise((resolve) => { closedResolve = resolve; });

  const cleanupTriggers = () => {
    if (deadlineTimer !== null) {
      clearTimer(deadlineTimer);
      deadlineTimer = null;
    }
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
      abortListener = null;
    }
  };

  const close = (nextReason) => {
    if (closePromise) return closePromise;
    reason = reason || nextReason || 'completed';
    expired = reason === 'duration-elapsed';
    cleanupTriggers();
    closePromise = Promise.resolve()
      .then(() => context.close())
      .catch(() => undefined)
      .then(() => {
        closedResolve(reason);
        return reason;
      });
    return closePromise;
  };

  const armDeadline = (delayMs) => {
    if (deadlineTimer !== null) clearTimer(deadlineTimer);
    deadlineTimer = setTimer(() => {
      deadlineTimer = null;
      void close('duration-elapsed');
    }, Math.max(0, Number(delayMs) || 0));
  };

  armDeadline(normalizedDuration);

  if (signal) {
    abortListener = () => { void close('user-stop'); };
    if (signal.aborted) abortListener();
    else signal.addEventListener('abort', abortListener, { once: true });
  }

  const throwForReason = (closedReason) => {
    if (closedReason === 'duration-elapsed') throw createSessionExpiredError();
    if (closedReason === 'user-stop') throw createSessionAbortError();
    throw new Error(`Browser session closed: ${closedReason || 'unknown'}`);
  };

  return {
    get startedAt() { return startedAt; },
    get deadlineAt() { return deadlineAt; },
    get durationMs() { return normalizedDuration; },
    get expired() { return expired; },
    get reason() { return reason; },
    remainingMs() { return Math.max(0, deadlineAt - now()); },
    beginActiveSession(nextDurationMs) {
      if (reason || closePromise) return false;
      normalizedDuration = Math.max(0, Number(nextDurationMs) || 0);
      startedAt = now();
      deadlineAt = startedAt + normalizedDuration;
      armDeadline(normalizedDuration);
      return true;
    },
    throwIfExpired() {
      if (expired || reason === 'duration-elapsed' || now() >= deadlineAt) throw createSessionExpiredError();
      if (reason === 'user-stop' || signal?.aborted) throw createSessionAbortError();
    },
    async wait(ms) {
      this.throwIfExpired();
      const remaining = this.remainingMs();
      if (remaining <= 0) throw createSessionExpiredError();
      const delayMs = Math.min(Math.max(0, Number(ms) || 0), remaining);
      let delayTimer = null;
      const delay = new Promise((resolve) => {
        delayTimer = setTimer(resolve, delayMs);
      });
      const result = await Promise.race([
        delay.then(() => ({ kind: 'delay' })),
        closedSignal.then((closedReason) => ({ kind: 'closed', closedReason })),
      ]);
      if (delayTimer !== null) clearTimer(delayTimer);
      if (result.kind === 'closed') throwForReason(result.closedReason);
      this.throwIfExpired();
    },
    async waitUntilClosed() {
      return closedSignal;
    },
    markCompleted() {
      return reason;
    },
    close,
  };
}

module.exports = {
  createSessionLifetimeController,
  createSessionExpiredError,
};
