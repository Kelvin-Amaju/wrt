function createDeferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function createRunLifecycle() {
  let phase = 'idle';
  let active = null;
  let idleDeferred = null;

  function getState() {
    return { phase, runId: active?.runId || null };
  }

  function getActive() {
    return active;
  }

  function begin(run) {
    if (!run?.runId) throw new Error('Run lifecycle requires a runId');
    if (active || phase !== 'idle') throw new Error('A QA run is already active. Stop it or wait for it to finish before starting another one.');
    idleDeferred = createDeferred();
    active = run;
    phase = 'running';
    return getState();
  }

  function markStopping(runId) {
    if (!active || active.runId !== runId) return getState();
    phase = 'stopping';
    return getState();
  }

  function finish(runId) {
    if (!active || active.runId !== runId) return getState();
    active = null;
    phase = 'idle';
    const deferred = idleDeferred;
    idleDeferred = null;
    deferred?.resolve();
    return getState();
  }

  async function waitForIdle() {
    if (phase === 'idle') return getState();
    const pending = idleDeferred?.promise;
    if (pending) await pending;
    return getState();
  }

  async function waitForStartSlot() {
    if (phase === 'stopping') await waitForIdle();
    if (phase !== 'idle' || active) {
      throw new Error('A QA run is already active. Stop it or wait for it to finish before starting another one.');
    }
    return getState();
  }

  return { getState, getActive, begin, markStopping, finish, waitForIdle, waitForStartSlot };
}

module.exports = { createRunLifecycle };
