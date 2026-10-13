function createAbortError() { const e = new Error('Run stopped'); e.name = 'AbortError'; return e; }

function createGlobalRunScheduler({ startupLimit = 32 } = {}) {
  const limit = Math.max(1, Number(startupLimit) || 32);
  const runs = new Map();
  let totalActive = 0;
  let cursor = 0;
  let drainScheduled = false;

  function registerRun(runId, requestedConcurrency = 'auto') {
    const current = runs.get(runId);
    const cap = requestedConcurrency === 'auto' ? Number.POSITIVE_INFINITY : Math.max(1, Number(requestedConcurrency) || 1);
    if (current) current.cap = cap;
    else runs.set(runId, { cap, active: 0, queue: [] });
    scheduleDrain();
  }

  function unregisterRun(runId) {
    const state = runs.get(runId);
    if (!state) return;
    for (const req of state.queue.splice(0)) {
      req.cleanup?.();
      req.reject(createAbortError());
    }
    if (state.active === 0) runs.delete(runId);
    else state.unregistered = true;
  }

  function requestLaunch(runId, signal) {
    if (!runs.has(runId)) registerRun(runId, 'auto');
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(createAbortError());
      const state = runs.get(runId);
      const req = { resolve, reject, signal, cleanup: null };
      if (signal) {
        const onAbort = () => {
          const index = state.queue.indexOf(req);
          if (index >= 0) state.queue.splice(index, 1);
          reject(createAbortError());
          scheduleDrain();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        req.cleanup = () => signal.removeEventListener('abort', onAbort);
      }
      state.queue.push(req);
      scheduleDrain();
    });
  }

  function scheduleDrain() {
    if (drainScheduled) return;
    drainScheduled = true;
    queueMicrotask(() => { drainScheduled = false; drain(); });
  }

  function drain() {
    if (totalActive >= limit || runs.size === 0) return;
    const ids = [...runs.keys()];
    if (cursor >= ids.length) cursor = 0;
    let progress = true;
    while (progress && totalActive < limit && ids.length) {
      progress = false;
      for (let step = 0; step < ids.length && totalActive < limit; step++) {
        const index = (cursor + step) % ids.length;
        const id = ids[index];
        const state = runs.get(id);
        if (!state || state.queue.length === 0 || state.active >= state.cap) continue;
        const req = state.queue.shift();
        if (req.signal?.aborted) { req.cleanup?.(); req.reject(createAbortError()); continue; }
        state.active += 1; totalActive += 1; progress = true; cursor = (index + 1) % ids.length;
        req.cleanup?.();
        let released = false;
        req.resolve(() => {
          if (released) return;
          released = true;
          state.active = Math.max(0, state.active - 1);
          totalActive = Math.max(0, totalActive - 1);
          if (state.unregistered && state.active === 0) runs.delete(id);
          scheduleDrain();
        });
      }
    }
  }

  function snapshot() {
    return { active: totalActive, limit, runs: [...runs.entries()].map(([runId,s]) => ({ runId, active:s.active, queued:s.queue.length, cap:Number.isFinite(s.cap)?s.cap:'auto' })) };
  }

  return { registerRun, unregisterRun, requestLaunch, snapshot };
}

module.exports = { createGlobalRunScheduler };
