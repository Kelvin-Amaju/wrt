function createRunResourceTracker({ cleanupTimeoutMs = 1500, forceTimeoutMs = 1500 } = {}) {
  const byRun = new Map();
  let nextId = 1;

  function withTimeout(promise, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ timedOut:true });
      }, Math.max(1, Number(timeoutMs) || 1));
      timer.unref?.();
      Promise.resolve(promise).then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut:false, value });
      }, (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ timedOut:false, error });
      });
    });
  }

  function register(runId, resource) {
    const id = String(runId || '');
    if (!id || !resource || typeof resource.close !== 'function') return () => {};
    const entry = {
      id: nextId++,
      label: String(resource.label || 'resource'),
      close: resource.close,
      forceClose: typeof resource.forceClose === 'function' ? resource.forceClose : null,
    };
    if (!byRun.has(id)) byRun.set(id, new Map());
    byRun.get(id).set(entry.id, entry);
    return () => {
      const bucket = byRun.get(id);
      if (!bucket) return;
      bucket.delete(entry.id);
      if (bucket.size === 0) byRun.delete(id);
    };
  }

  function count(runId) {
    return byRun.get(String(runId || ''))?.size || 0;
  }

  async function forceCleanup(runId) {
    const id = String(runId || '');
    const bucket = byRun.get(id);
    if (!bucket || bucket.size === 0) return { runId:id, requested:0, closed:0, forced:0, timedOut:0, errors:0 };
    const entries = [...bucket.values()];
    byRun.delete(id);
    const summary = { runId:id, requested:entries.length, closed:0, forced:0, timedOut:0, errors:0 };

    await Promise.all(entries.map(async (entry) => {
      const graceful = await withTimeout(Promise.resolve().then(() => entry.close()), cleanupTimeoutMs);
      if (!graceful.timedOut && !graceful.error) {
        summary.closed += 1;
        return;
      }
      if (graceful.error) summary.errors += 1;
      if (graceful.timedOut) summary.timedOut += 1;
      if (!entry.forceClose) return;
      const forced = await withTimeout(Promise.resolve().then(() => entry.forceClose()), forceTimeoutMs);
      if (!forced.timedOut && !forced.error) summary.forced += 1;
      else {
        if (forced.timedOut) summary.timedOut += 1;
        if (forced.error) summary.errors += 1;
      }
    }));

    return summary;
  }

  return { register, count, forceCleanup };
}

module.exports = { createRunResourceTracker };
