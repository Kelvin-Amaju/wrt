const { randomUUID } = require('node:crypto');

const TERMINAL = new Set(['STOPPED', 'COMPLETED', 'FAILED']);
const ACTIVE = new Set(['CREATED', 'STARTING', 'RUNNING', 'PAUSING', 'RESUMING', 'STOPPING']);
const AUTO_RERUN_MODES = new Set(['completed-only', 'all-finished']);
const BULK_DELETE_SCOPES = new Set(['completed', 'failed', 'stopped', 'all-finished']);

function now() { return new Date().toISOString(); }
function blankCounters(requested = 0) {
  return { requested, running: 0, queued: requested, completed: 0, failed: 0, cancelled: 0, incomplete: 0 };
}
function progressPercent(record) {
  const counters = record?.summary?.counters || {};
  const requested = Math.max(0, Number(counters.requested) || 0);
  if (!requested) return 0;
  const terminal = (Number(counters.completed) || 0) + (Number(counters.failed) || 0) + (Number(counters.cancelled) || 0) + (Number(counters.incomplete) || 0);
  return Math.min(100, Math.max(0, Math.round((terminal / requested) * 100)));
}
function estimateRequested(config) {
  if (Number.isFinite(config?.requestedWorkUnits)) return Math.max(0, Number(config.requestedWorkUnits));
  if (config?.runKind === 'streaming') return Math.max(0, (config?.accountIds?.length || 0) * (config?.trackIds?.length || 0));
  const d = config?.devices;
  if (!d) return 0;
  let total = 0;
  if (d.desktop?.enabled) total += (d.desktop.browsers?.length || 0) * (Number(d.desktop.instancesPerBrowser) || 0);
  if (d.androidEmulation?.enabled) total += (d.androidEmulation.profiles?.length || 0) * (Number(d.androidEmulation.instancesPerProfile) || 0);
  if (d.iosEmulation?.enabled) total += (d.iosEmulation.browsers?.length || 0) * (d.iosEmulation.profiles?.length || 0) * (Number(d.iosEmulation.instancesPerProfile) || 0);
  if (d.androidAvd?.enabled) total += d.androidAvd.avdNames?.length || 0;
  if (d.realIos?.enabled) total += d.realIos.selections?.length || 0;
  return total;
}
function deviceFamilies(config) {
  if (config?.runKind === 'streaming') return ['Streaming QA'];
  const d = config?.devices || {};
  const out = [];
  if (d.desktop?.enabled) out.push('Desktop');
  if (d.androidEmulation?.enabled) out.push('Android');
  if (d.iosEmulation?.enabled) out.push('iPhone/iPad');
  if (d.androidAvd?.enabled) out.push('Android AVD');
  if (d.realIos?.enabled) out.push('Real iOS');
  return out;
}
function concurrencyOf(config) {
  if (config?.runKind === 'streaming') return Math.max(1, Number(config?.slots) || 1);
  return config?.concurrency?.mode === 'auto' ? 'auto' : Math.max(1, Number(config?.concurrency?.value) || 1);
}
function targetSummary(config) {
  if (config?.runKind === 'streaming') return `${String(config?.platform || 'Streaming')} · ${(config?.trackIds?.length || 0)} track${(config?.trackIds?.length || 0) === 1 ? '' : 's'}`;
  const urls = Array.isArray(config?.urlPool) ? config.urlPool : [];
  if (urls.length === 1) {
    try { return new URL(urls[0]).hostname; } catch { return String(urls[0]); }
  }
  return `${urls.length || 0} target URL${urls.length === 1 ? '' : 's'}`;
}
function toDetail(record) {
  return { ...record.summary, config: record.config, logs: record.logs || [], ...(record.results || {}) };
}
function compactTerminalRecord(record) {
  record.logs = Array.isArray(record.logs) ? record.logs.slice(-300) : [];
  record.checkpoint = {
    nextWorkOrdinal: Math.max(Number(record.checkpoint?.nextWorkOrdinal) || 0, Number(record.summary?.counters?.requested) || 0),
    terminalWorkIds: [],
    inFlightWorkIds: [],
  };
  return record;
}

function createRunRegistry({ runStore, executeRun, executeStreamingRun = null, globalRunScheduler = null, screenshotsRootProvider = null, dependencies = {}, stuckRecoveryClock = null, forceStopAfterMs = 5000, forceCleanupAfterMs = 3000 }) {
  if (!runStore) throw new Error('runStore is required');
  if (typeof executeRun !== 'function') throw new Error('executeRun is required');
  const records = new Map();
  const runtimes = new Map();
  const listeners = new Set();
  const persistTimers = new Map();
  const autoRerun = {
    enabled: false,
    mode: 'completed-only',
    maxConcurrent: 1,
    queue: [],
    queued: new Set(),
    selected: new Set(),
    active: new Set(),
    pumping: false,
  };
  const recoveryClock = stuckRecoveryClock || {
    nowMs: () => Date.now(),
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: (timer) => clearInterval(timer),
  };
  const stuckRunRecovery = {
    enabled: false,
    timeoutMinutes: 5,
    maxAttempts: 3,
    recovering: new Set(),
    checking: false,
  };

  const hardStopDeadlineMs = Math.max(10, Number(forceStopAfterMs) || 5000);
  const forceCleanupDeadlineMs = Math.max(10, Number(forceCleanupAfterMs) || 3000);

  function settleWithin(promise, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(false);
      }, Math.max(1, Number(timeoutMs) || 1));
      timer.unref?.();
      Promise.resolve(promise).then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      }, () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  async function forceDetachRuntime(runId, runtime, record) {
    if (runtimes.get(runId) !== runtime) return false;
    runtime.detached = true;
    const cleanup = dependencies?.forceStopRunResources;
    if (typeof cleanup === 'function') {
      await settleWithin(Promise.resolve().then(() => cleanup(runId)), forceCleanupDeadlineMs);
    }
    if (runtimes.get(runId) === runtime) runtimes.delete(runId);
    globalRunScheduler?.unregisterRun?.(runId);
    record.summary.status = 'STOPPED';
    record.summary.counters.running = 0;
    record.summary.counters.queued = 0;
    record.summary.resourceMessage = `Force-stopped after ${Math.ceil(hardStopDeadlineMs / 1000)}s cleanup deadline`;
    persist(record);
    publish({ type:'run-status', runId, timestamp:now(), runStatus:'STOPPED' });
    updateEvent(record, {
      type:'run-force-stopped',
      severity:'warning',
      stage:'recovery',
      action:'force-stop-complete',
      message:record.summary.resourceMessage,
    });
    return true;
  }

  for (const record of runStore.loadRecoverable()) {
    record.summary.runKind = record.summary.runKind === 'streaming' || record.config?.runKind === 'streaming' ? 'streaming' : 'qa';
    record.summary.attemptCount = Math.max(1, Number(record.summary.attemptCount) || 1);
    record.summary.stuckRecoveryAttempts = Math.max(0, Number(record.summary.stuckRecoveryAttempts) || 0);
    if (!Number.isFinite(record.summary.lastProgressPercent)) record.summary.lastProgressPercent = progressPercent(record);
    if (!Number.isFinite(record.summary.lastProgressChangedAtMs)) record.summary.lastProgressChangedAtMs = recoveryClock.nowMs();
    records.set(record.summary.runId, record);
  }

  function publish(event) {
    if (!event?.runId) throw new Error('Run Center events require runId');
    for (const listener of listeners) {
      try { listener(event); } catch { /* listener isolation */ }
    }
  }

  function autoRerunEligible(record) {
    if (!record || !TERMINAL.has(record.summary.status)) return false;
    if (record.summary.stuckRecoveryExhausted === true) return false;
    if (!autoRerun.selected.has(record.summary.runId)) return false;
    if (autoRerun.mode === 'completed-only') return record.summary.status === 'COMPLETED';
    return true;
  }

  function getAutoRerunState() {
    return {
      enabled: autoRerun.enabled,
      mode: autoRerun.mode,
      maxConcurrent: autoRerun.maxConcurrent,
      running: autoRerun.active.size,
      queued: autoRerun.queue.length,
      selectedRunIds: [...autoRerun.selected],
    };
  }

  function removeFromAutoRerunQueue(runId) {
    const id = String(runId || '');
    if (!id) return;
    if (autoRerun.queued.has(id)) {
      autoRerun.queue = autoRerun.queue.filter((queuedId) => queuedId !== id);
      autoRerun.queued.delete(id);
    }
  }

  function enqueueAutoRerun(record) {
    if (!autoRerun.enabled || !autoRerunEligible(record)) return false;
    const runId = record.summary.runId;
    if (autoRerun.queued.has(runId) || autoRerun.active.has(runId)) return false;
    autoRerun.queue.push(runId);
    autoRerun.queued.add(runId);
    return true;
  }

  function seedAutoRerunQueue() {
    for (const runId of autoRerun.selected) enqueueAutoRerun(records.get(runId));
  }

  async function pumpAutoRerunQueue() {
    if (autoRerun.pumping || !autoRerun.enabled) return;
    autoRerun.pumping = true;
    try {
      const availableSlots = Math.max(0, autoRerun.maxConcurrent - autoRerun.active.size);
      const batchSize = Math.min(availableSlots, autoRerun.queue.length);
      for (let index = 0; autoRerun.enabled && index < batchSize; index += 1) {
        const runId = autoRerun.queue.shift();
        autoRerun.queued.delete(runId);
        const record = records.get(runId);
        if (!record || !autoRerunEligible(record)) continue;
        autoRerun.active.add(runId);
        const result = await rerunRun(runId, { automatic:true });
        if (!result.rerun) autoRerun.active.delete(runId);
      }
    } finally {
      autoRerun.pumping = false;
    }
  }

  function scheduleAutoRerunPump() {
    setTimeout(() => { pumpAutoRerunQueue().catch(() => {}); }, 0);
  }

  function handleTerminalForAutoRerun(record) {
    if (!record?.summary?.runId) return;
    if (stuckRunRecovery.recovering.has(record.summary.runId) || record.summary.stuckRecoveryExhausted === true) return;
    autoRerun.active.delete(record.summary.runId);
    if (autoRerun.enabled) enqueueAutoRerun(record);
    scheduleAutoRerunPump();
  }

  function configureAutoRerun(patch = {}) {
    if (patch.mode != null) {
      const mode = String(patch.mode);
      if (!AUTO_RERUN_MODES.has(mode)) throw new Error('Unsupported automatic rerun mode');
      autoRerun.mode = mode;
    }
    if (patch.maxConcurrent != null) {
      const parsed = Math.floor(Number(patch.maxConcurrent));
      if (!Number.isFinite(parsed)) throw new Error('Max simultaneous reruns must be a number');
      autoRerun.maxConcurrent = Math.min(10, Math.max(1, parsed));
    }
    if (patch.selectedRunIds != null) {
      if (!Array.isArray(patch.selectedRunIds)) throw new Error('Selected automatic rerun tasks must be an array');
      autoRerun.selected = new Set(patch.selectedRunIds.map((id) => String(id || '')).filter((id) => id && records.has(id)));
    }
    if (patch.enabled != null) autoRerun.enabled = patch.enabled === true;

    autoRerun.queue = autoRerun.queue.filter((runId) => autoRerun.selected.has(runId) && autoRerunEligible(records.get(runId)));
    autoRerun.queued = new Set(autoRerun.queue);

    if (!autoRerun.enabled) {
      autoRerun.queue = [];
      autoRerun.queued.clear();
      return getAutoRerunState();
    }

    seedAutoRerunQueue();
    scheduleAutoRerunPump();
    return getAutoRerunState();
  }

  function persist(record) {
    const timer = persistTimers.get(record.summary.runId);
    if (timer) { clearTimeout(timer); persistTimers.delete(record.summary.runId); }
    record.summary.updatedAt = now();
    record.lastCheckpointAt = record.summary.updatedAt;
    records.set(record.summary.runId, record);
    runStore.save(record);
    return record;
  }

  function schedulePersist(record, delayMs = 400) {
    records.set(record.summary.runId, record);
    if (persistTimers.has(record.summary.runId)) return;
    const timer = setTimeout(() => {
      persistTimers.delete(record.summary.runId);
      persist(record);
    }, delayMs);
    timer.unref?.();
    persistTimers.set(record.summary.runId, timer);
  }

  function updateEvent(record, event) {
    const owned = { ...event, runId: record.summary.runId, timestamp: event.timestamp || now() };
    record.logs = record.logs || [];
    record.logs.push(owned);
    if (record.logs.length > 600) record.logs.splice(0, record.logs.length - 600);
    if (owned.metrics) { record.summary.counters = { ...record.summary.counters, ...owned.metrics }; noteProgress(record); }
    if (owned.privacyDiagnostics) record.results.latestPrivacy = owned.privacyDiagnostics;
    if (owned.identityDiagnostics) record.results.latestIdentity = owned.identityDiagnostics;
    if (owned.sessionIntegrity) record.results.latestIntegrity = owned.sessionIntegrity;
    if (owned.adSummary) record.results.latestAdSummary = owned.adSummary;
    if (owned.streamingSummary) record.results.streamingSummary = owned.streamingSummary;
    if (owned.runtimeVerification && owned.workId) {
      record.results.runtimeVerifications = record.results.runtimeVerifications || {};
      record.results.runtimeVerifications[owned.workId] = owned.runtimeVerification;
    }
    if (owned.privacyRouteIntegrity && owned.workId) {
      record.results.privacyRouteIntegrityByWork = record.results.privacyRouteIntegrityByWork || {};
      record.results.privacyRouteIntegrityByWork[owned.workId] = owned.privacyRouteIntegrity;
    }
    if (owned.streamingResult && owned.workId) { record.results.streamingResults = record.results.streamingResults || {}; record.results.streamingResults[owned.workId] = owned.streamingResult; }
    if (owned.type === 'proxy-selection' && ['rotating','static'].includes(owned.selectedProxyKind)) {
      const current = record.results.proxyMix || { rotating:0, static:0, total:0 };
      const next = {
        rotating: Number(current.rotating) || 0,
        static: Number(current.static) || 0,
        total: Number(current.total) || 0,
      };
      next[owned.selectedProxyKind] += 1;
      next.total += 1;
      record.results.proxyMix = next;
    }
    if (owned.workId) {
      const cp = record.checkpoint;
      if (owned.type === 'session-start') {
        if (!cp.inFlightWorkIds.includes(owned.workId)) cp.inFlightWorkIds.push(owned.workId);
      }
      if (['session-complete','session-error','session-cancelled','session-incomplete'].includes(owned.type)) {
        const pausing = runtimes.get(record.summary.runId)?.intent === 'pause';
        if (!(owned.type === 'session-cancelled' && pausing)) {
          cp.inFlightWorkIds = cp.inFlightWorkIds.filter((id) => id !== owned.workId);
        }
        if (!cp.terminalWorkIds.includes(owned.workId) && owned.type !== 'session-cancelled') cp.terminalWorkIds.push(owned.workId);
      }
    }
    const checkpointCritical = ['session-complete','session-error','session-incomplete'].includes(owned.type);
    if (checkpointCritical) persist(record); else schedulePersist(record);
    publish(owned);
  }

  function noteProgress(record, { reset = false } = {}) {
    const next = progressPercent(record);
    const previous = Number(record.summary.lastProgressPercent);
    if (reset || !Number.isFinite(previous) || previous !== next) {
      record.summary.lastProgressPercent = next;
      record.summary.lastProgressChangedAtMs = recoveryClock.nowMs();
    }
    return next;
  }

  function stuckRecoveryCandidate(record) {
    if (!record || record.summary.runKind !== 'qa') return false;
    if (!['RUNNING','STOPPING'].includes(record.summary.status)) return false;
    if (stuckRunRecovery.recovering.has(record.summary.runId)) return false;
    const progress = progressPercent(record);
    return progress >= 90 && progress <= 99;
  }

  function getStuckRunRecoveryState() {
    let watching = 0;
    for (const record of records.values()) if (stuckRecoveryCandidate(record)) watching += 1;
    return {
      enabled: stuckRunRecovery.enabled,
      timeoutMinutes: stuckRunRecovery.timeoutMinutes,
      maxAttempts: stuckRunRecovery.maxAttempts,
      watching,
      recovering: stuckRunRecovery.recovering.size,
    };
  }

  function configureStuckRunRecovery(patch = {}) {
    const wasEnabled = stuckRunRecovery.enabled;
    if (patch.timeoutMinutes != null) {
      const parsed = Number(patch.timeoutMinutes);
      if (!Number.isFinite(parsed)) throw new Error('Stuck timeout must be a number');
      stuckRunRecovery.timeoutMinutes = Math.min(120, Math.max(1, parsed));
    }
    if (patch.maxAttempts != null) {
      const parsed = Math.floor(Number(patch.maxAttempts));
      if (!Number.isFinite(parsed)) throw new Error('Maximum recovery attempts must be a number');
      stuckRunRecovery.maxAttempts = Math.min(10, Math.max(1, parsed));
    }
    if (patch.enabled != null) stuckRunRecovery.enabled = patch.enabled === true;
    if (stuckRunRecovery.enabled && !wasEnabled) {
      const baseline = recoveryClock.nowMs();
      for (const record of records.values()) {
        if (record.summary.runKind !== 'qa' || !['RUNNING','STOPPING'].includes(record.summary.status)) continue;
        record.summary.lastProgressPercent = progressPercent(record);
        record.summary.lastProgressChangedAtMs = baseline;
        schedulePersist(record, 0);
      }
    }
    return getStuckRunRecoveryState();
  }

  async function recoverStuckRun(record, progress, staleMs) {
    const runId = record.summary.runId;
    if (stuckRunRecovery.recovering.has(runId)) return 'ignored';
    stuckRunRecovery.recovering.add(runId);
    const staleMinutes = Math.max(1, Math.floor(staleMs / 60000));
    try {
      updateEvent(record, {
        type:'stuck-run-detected',
        severity:'warning',
        stage:'recovery',
        action:'stuck-detected',
        message:`STUCK RUN DETECTED · ${progress}% unchanged for ${staleMinutes}m`,
      });

      const usedAttempts = Math.max(0, Number(record.summary.stuckRecoveryAttempts) || 0);
      if (usedAttempts >= stuckRunRecovery.maxAttempts) {
        await stopRun(runId);
        const latest = records.get(runId);
        if (!latest) return 'ignored';
        latest.summary.status = 'FAILED';
        latest.summary.stuckRecoveryExhausted = true;
        latest.summary.resourceMessage = `Stuck run recovery limit reached after ${usedAttempts} automatic recovery attempt${usedAttempts === 1 ? '' : 's'}`;
        latest.summary.counters.running = 0;
        latest.summary.counters.queued = 0;
        removeFromAutoRerunQueue(runId);
        autoRerun.active.delete(runId);
        persist(latest);
        publish({ type:'run-status', runId, timestamp:now(), runStatus:'FAILED' });
        updateEvent(latest, {
          type:'stuck-run-recovery-exhausted',
          severity:'error',
          stage:'recovery',
          action:'recovery-exhausted',
          message:latest.summary.resourceMessage,
        });
        return 'exhausted';
      }

      updateEvent(record, {
        type:'stuck-run-force-stop',
        severity:'warning',
        stage:'recovery',
        action:'force-stop',
        message:'FORCE RECOVERY · closing old run resources before restart',
      });
      const stopResult = await stopRun(runId);
      const stopped = records.get(runId);
      if (!stopped || stopped.summary.status !== 'STOPPED') return 'ignored';
      stopped.summary.stuckRecoveryAttempts = usedAttempts + 1;
      delete stopped.summary.stuckRecoveryExhausted;
      persist(stopped);
      const rerun = await rerunRun(runId, { recovery:true });
      if (!rerun.rerun) return 'ignored';
      const restarted = records.get(runId);
      if (restarted) updateEvent(restarted, {
        type:'stuck-run-recovery-started',
        severity:'warning',
        stage:'recovery',
        action:'restart',
        message:`RECOVERY COMPLETE · starting Attempt ${Math.max(1, restarted.summary.attemptCount || 1)} · recovery ${usedAttempts + 1}/${stuckRunRecovery.maxAttempts}${stopResult?.forced ? ' · hard stop used' : ''}`,
      });
      return 'recovered';
    } finally {
      stuckRunRecovery.recovering.delete(runId);
    }
  }

  async function checkStuckRunsNow() {
    if (!stuckRunRecovery.enabled || stuckRunRecovery.checking) return { checked:0, recovered:0, exhausted:0 };
    stuckRunRecovery.checking = true;
    let checked = 0, recovered = 0, exhausted = 0;
    try {
      const thresholdMs = stuckRunRecovery.timeoutMinutes * 60_000;
      const currentMs = recoveryClock.nowMs();
      for (const record of [...records.values()]) {
        if (record.summary.runKind !== 'qa') continue;
        if (!['RUNNING','STOPPING'].includes(record.summary.status)) continue;
        if (stuckRunRecovery.recovering.has(record.summary.runId)) continue;
        const progress = progressPercent(record);
        const previous = Number(record.summary.lastProgressPercent);
        if (!Number.isFinite(previous) || previous !== progress) {
          noteProgress(record, { reset:true });
          continue;
        }
        if (progress < 90 || progress > 99) continue;
        const changedAt = Number(record.summary.lastProgressChangedAtMs);
        if (!Number.isFinite(changedAt)) { noteProgress(record, { reset:true }); continue; }
        const staleMs = Math.max(0, currentMs - changedAt);
        if (staleMs < thresholdMs) continue;
        checked += 1;
        const outcome = await recoverStuckRun(record, progress, staleMs);
        if (outcome === 'recovered') recovered += 1;
        if (outcome === 'exhausted') exhausted += 1;
      }
      return { checked, recovered, exhausted };
    } finally {
      stuckRunRecovery.checking = false;
    }
  }

  async function launch(record, { resuming = false } = {}) {
    const runId = record.summary.runId;
    if (runtimes.has(runId)) return runtimes.get(runId).done;
    const controller = new AbortController();
    const runtime = { controller, intent: null, done: null, detached:false };
    runtimes.set(runId, runtime);
    record.summary.status = resuming ? 'RESUMING' : 'STARTING';
    if (resuming) record.checkpoint.inFlightWorkIds = [];
    noteProgress(record, { reset:true });
    persist(record);
    publish({ type: 'run-status', runId, timestamp: now(), runStatus: record.summary.status });

    const done = Promise.resolve().then(async () => {
      if (runtimes.get(runId) !== runtime || runtime.detached) return;
      record.summary.status = 'RUNNING';
      persist(record);
      publish({ type: 'run-status', runId, timestamp: now(), runStatus: 'RUNNING' });
      const emit = (event) => { if (runtimes.get(runId) !== runtime || runtime.detached) return; updateEvent(record, event || {}); };
      const screenshotsRoot = screenshotsRootProvider ? screenshotsRootProvider(runId) : undefined;
      const executor = record.summary.runKind === 'streaming' ? executeStreamingRun : executeRun;
      if (typeof executor !== 'function') throw new Error(`${record.summary.runKind} run executor is unavailable`);
      await executor({ runId, request: record.config, screenshotsRoot, emit, signal: controller.signal, globalRunScheduler, checkpoint: record.checkpoint, ...dependencies });
      if (runtimes.get(runId) !== runtime || runtime.detached) return;
      if (runtime.intent === 'pause') {
        record.summary.status = 'PAUSED';
        record.summary.counters.running = 0;
        record.summary.counters.cancelled = 0;
        record.summary.counters.queued = Math.max(0, record.summary.counters.requested - record.summary.counters.completed - record.summary.counters.failed);
      } else if (runtime.intent === 'stop') {
        record.summary.status = 'STOPPED';
        record.summary.counters.running = 0;
        record.summary.counters.queued = 0;
      } else {
        record.summary.status = 'COMPLETED';
        record.summary.counters.running = 0;
        record.summary.counters.queued = 0;
      }
      if (TERMINAL.has(record.summary.status) && !stuckRunRecovery.recovering.has(runId)) {
        record.summary.stuckRecoveryAttempts = 0;
        delete record.summary.stuckRecoveryExhausted;
      }
      if (TERMINAL.has(record.summary.status)) compactTerminalRecord(record);
      persist(record);
      publish({ type: 'run-status', runId, timestamp: now(), runStatus: record.summary.status });
      if (TERMINAL.has(record.summary.status)) handleTerminalForAutoRerun(record);
    }).catch((error) => {
      if (runtimes.get(runId) !== runtime || runtime.detached) return;
      if (runtime.intent === 'pause') {
        record.summary.status = 'PAUSED';
        record.summary.resourceMessage = 'Paused safely';
      } else if (runtime.intent === 'stop' || controller.signal.aborted) {
        record.summary.status = 'STOPPED';
      } else {
        record.summary.status = 'FAILED';
        record.summary.resourceMessage = error instanceof Error ? error.message : String(error);
        publish({ type: 'run-error', runId, timestamp: now(), message: record.summary.resourceMessage });
      }
      record.summary.counters.running = 0;
      if (record.summary.status === 'STOPPED') record.summary.counters.queued = 0;
      if (TERMINAL.has(record.summary.status) && !stuckRunRecovery.recovering.has(runId)) {
        record.summary.stuckRecoveryAttempts = 0;
        delete record.summary.stuckRecoveryExhausted;
      }
      if (TERMINAL.has(record.summary.status)) compactTerminalRecord(record);
      persist(record);
      if (TERMINAL.has(record.summary.status)) handleTerminalForAutoRerun(record);
    }).finally(() => {
      if (runtimes.get(runId) !== runtime) return;
      const pendingPersist = persistTimers.get(runId);
      if (pendingPersist) { clearTimeout(pendingPersist); persistTimers.delete(runId); }
      runtimes.delete(runId);
      globalRunScheduler?.unregisterRun?.(runId);
    });
    runtime.done = done;
    globalRunScheduler?.registerRun?.(runId, concurrencyOf(record.config));
    return done;
  }

  async function createRun(config, metadata = {}) {
    const runId = `RUN-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const timestamp = now();
    const requested = estimateRequested(config);
    const record = {
      schemaVersion: 1,
      summary: {
        runId,
        runKind: config?.runKind === 'streaming' ? 'streaming' : 'qa',
        createdAt: timestamp,
        updatedAt: timestamp,
        status: 'CREATED',
        attemptCount: 1,
        lastStartedAt: timestamp,
        stuckRecoveryAttempts: 0,
        lastProgressPercent: 0,
        lastProgressChangedAtMs: recoveryClock.nowMs(),
        executionMode: config?.executionMode === 'background' ? 'background' : 'visible',
        requestedConcurrency: concurrencyOf(config),
        targetSummary: targetSummary(config),
        deviceFamilies: deviceFamilies(config),
        counters: blankCounters(requested),
        ...(config?.runKind === 'streaming' ? { streamingMeta:{ platform:String(config?.platform || 'Streaming'), accounts:config?.accountIds?.length || 0, tracks:config?.trackIds?.length || 0, slots:Math.max(1,Number(config?.slots)||1) } } : {}),
      },
      config: { ...config, executionMode: config?.executionMode === 'background' ? 'background' : 'visible' },
      checkpoint: { nextWorkOrdinal: 0, terminalWorkIds: [], inFlightWorkIds: [] },
      logs: [],
      results: {},
      lastCheckpointAt: timestamp,
    };
    persist(record);
    launch(record).catch(() => {});
    return { runId };
  }

  function listRuns() {
    return [...records.values()]
      .map((record) => ({ ...record.summary, autoRerunSelected:autoRerun.selected.has(record.summary.runId) }))
      .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  function getRun(runId) {
    const record = records.get(String(runId));
    return record ? { ...toDetail(record), autoRerunSelected:autoRerun.selected.has(record.summary.runId) } : null;
  }

  async function stopRun(runId) {
    const id = String(runId || '');
    const record = records.get(id);
    if (!record) return { runId: id, stopped: false };
    if (TERMINAL.has(record.summary.status)) return { runId: id, stopped: false, status: record.summary.status };
    record.summary.status = 'STOPPING'; persist(record); publish({ type:'run-status', runId:id, timestamp:now(), runStatus:'STOPPING' });
    const runtime = runtimes.get(id);
    let forced = false;
    if (runtime) {
      runtime.intent = 'stop';
      runtime.controller.abort('stop');
      const stoppedNormally = await settleWithin(runtime.done, hardStopDeadlineMs);
      if (!stoppedNormally && runtimes.get(id) === runtime) forced = await forceDetachRuntime(id, runtime, record);
    } else {
      record.summary.status = 'STOPPED'; record.summary.counters.running = 0; record.summary.counters.queued = 0; persist(record);
    }
    return { runId:id, stopped:true, status:records.get(id).summary.status, ...(forced ? { forced:true } : {}) };
  }

  async function pauseRun(runId) {
    const id = String(runId || '');
    const record = records.get(id);
    if (!record || TERMINAL.has(record.summary.status) || record.summary.status === 'PAUSED') return { runId:id, paused:false };
    record.summary.status = 'PAUSING'; persist(record); publish({ type:'run-status', runId:id, timestamp:now(), runStatus:'PAUSING' });
    const runtime = runtimes.get(id);
    if (runtime) { runtime.intent = 'pause'; runtime.controller.abort('pause'); await runtime.done; }
    else { record.summary.status = 'PAUSED'; persist(record); }
    return { runId:id, paused:true, status:record.summary.status };
  }

  async function resumeRun(runId) {
    const id = String(runId || '');
    const record = records.get(id);
    if (!record || record.summary.status !== 'PAUSED') return { runId:id, resumed:false };
    launch(record, { resuming:true }).catch(() => {});
    return { runId:id, resumed:true };
  }

  async function rerunRun(runId, { automatic = false, recovery = false } = {}) {
    const id = String(runId || '');
    const record = records.get(id);
    if (!record || !TERMINAL.has(record.summary.status) || runtimes.has(id)) return { runId:id, rerun:false, reason:record ? 'run-is-active' : 'not-found' };
    removeFromAutoRerunQueue(id);
    const timestamp = now();
    record.summary.status = 'CREATED';
    record.summary.attemptCount = Math.max(1, Number(record.summary.attemptCount) || 1) + 1;
    record.summary.lastStartedAt = timestamp;
    record.summary.counters = blankCounters(estimateRequested(record.config));
    record.summary.lastProgressPercent = 0;
    record.summary.lastProgressChangedAtMs = recoveryClock.nowMs();
    if (!recovery) {
      record.summary.stuckRecoveryAttempts = 0;
      delete record.summary.stuckRecoveryExhausted;
    }
    if (automatic) record.summary.autoRerun = true;
    else delete record.summary.autoRerun;
    delete record.summary.autoRerunSourceRunId;
    delete record.summary.resourceMessage;
    record.checkpoint = { nextWorkOrdinal: 0, terminalWorkIds: [], inFlightWorkIds: [] };
    record.logs = [];
    record.results = {};
    record.lastCheckpointAt = timestamp;
    persist(record);
    launch(record).catch(() => {});
    return { runId:id, rerun:true, sourceRunId:id };
  }

  async function deleteRun(runId) {
    const id = String(runId || '');
    const record = records.get(id);
    if (!record) return { runId:id, deleted:false, reason:'not-found' };
    if (!TERMINAL.has(record.summary.status) || runtimes.has(id)) return { runId:id, deleted:false, reason:'run-is-active' };
    const timer = persistTimers.get(id);
    if (timer) { clearTimeout(timer); persistTimers.delete(id); }
    removeFromAutoRerunQueue(id);
    autoRerun.selected.delete(id);
    autoRerun.active.delete(id);
    records.delete(id);
    runStore.remove(id);
    publish({ type:'run-deleted', runId:id, timestamp:now() });
    return { runId:id, deleted:true };
  }

  async function bulkDeleteRuns(scope) {
    const normalized = String(scope || '');
    if (!BULK_DELETE_SCOPES.has(normalized)) throw new Error('Unsupported bulk delete scope');
    const allowed = normalized === 'all-finished'
      ? TERMINAL
      : new Set([normalized === 'completed' ? 'COMPLETED' : normalized === 'failed' ? 'FAILED' : 'STOPPED']);
    const ids = [...records.values()]
      .filter((record) => allowed.has(record.summary.status) && !runtimes.has(record.summary.runId))
      .map((record) => record.summary.runId);
    const deletedIds = [];
    for (const id of ids) {
      const result = await deleteRun(id);
      if (result.deleted) deletedIds.push(id);
    }
    return { scope:normalized, deleted:deletedIds.length, runIds:deletedIds };
  }

  async function stopAllRuns() {
    const ids = [...records.values()].filter((r) => !TERMINAL.has(r.summary.status)).map((r) => r.summary.runId);
    await Promise.all(ids.map((id) => stopRun(id)));
    return { stopped: ids.length, runIds: ids };
  }

  async function pauseAllForShutdown() {
    const ids = [...records.values()].filter((r) => ACTIVE.has(r.summary.status)).map((r) => r.summary.runId);
    await Promise.all(ids.map((id) => pauseRun(id)));
    return { paused: ids.length, runIds: ids };
  }

  async function resumePersistedRuns() {
    const ids = [...records.values()].filter((r) => r.summary.status === 'PAUSED').map((r) => r.summary.runId);
    ids.forEach((id) => resumeRun(id));
    return { resumed: ids.length, runIds: ids };
  }

  function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }

  const stuckRecoveryTimer = recoveryClock.setInterval(() => { checkStuckRunsNow().catch(() => {}); }, 5_000);
  stuckRecoveryTimer?.unref?.();

  return { createRun, listRuns, getRun, stopRun, pauseRun, resumeRun, rerunRun, deleteRun, bulkDeleteRuns, getAutoRerunState, configureAutoRerun, getStuckRunRecoveryState, configureStuckRunRecovery, checkStuckRunsNow, stopAllRuns, pauseAllForShutdown, resumePersistedRuns, subscribe };
}

module.exports = { createRunRegistry, TERMINAL };
