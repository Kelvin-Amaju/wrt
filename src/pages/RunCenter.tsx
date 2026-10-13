import { useCallback, useEffect, useMemo, useState } from 'react';
import { RunCard } from '../components/RunCard';
import type { AutoRerunMode, AutoRerunState, BulkDeleteRunScope, RunDetail, RunSummary, StuckRunRecoveryState } from '../shared/runCenter';
import type { QaEvent } from '../shared/run';
import type { RunProxyIpSummary } from '../shared/proxyIpHistory';
import type { PrivacyRouteIntegrityCheckStatus } from '../shared/privacyRouteIntegrity';

const ACTIVE = new Set(['CREATED','STARTING','RUNNING','PAUSING','PAUSED','RESUMING','STOPPING']);
const TERMINAL = new Set(['COMPLETED','FAILED','STOPPED']);
const COMPLETED_PAGE_SIZE = 24;
const DEFAULT_AUTO_RERUN: AutoRerunState = { enabled:false, mode:'completed-only', maxConcurrent:1, running:0, queued:0, selectedRunIds:[] };
const DEFAULT_STUCK_RECOVERY: StuckRunRecoveryState = { enabled:false, timeoutMinutes:5, maxAttempts:3, watching:0, recovering:0 };
const STUCK_TIMEOUT_PRESETS = [1,2,5,10,15,30];

type RunCenterProps = {
  initialRunId?: string | null;
  onInitialRunHandled?: () => void;
};

const DELETE_SCOPE_LABELS: Record<BulkDeleteRunScope, string> = {
  completed: 'Delete all Completed',
  failed: 'Delete all Failed',
  stopped: 'Delete all Stopped',
  'all-finished': 'Delete Everything',
};

function timeLabel(value: string) {
  try { return new Date(value).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' }); }
  catch { return value; }
}

function runLogSeverity(event: { severity?: string; type?: string; message?: string }) {
  if (event.severity) return event.severity;
  if (['run-error','session-error'].includes(event.type || '')) return 'error';
  if (/error|failed|failure|crash|unable|blocked/i.test(event.message || '')) return 'error';
  if (/retry|warning|attention|recovery|not started|outside/i.test(event.message || '')) return 'warning';
  if (/confirmed|ready|completed|opened/i.test(event.message || '')) return 'success';
  return 'info';
}


function privacyRouteStatusLabel(status: PrivacyRouteIntegrityCheckStatus | 'pass' | 'fail' | 'not-verified'): string {
  const labels: Record<PrivacyRouteIntegrityCheckStatus, string> = {
    pass: 'PASS', fail: 'FAIL', blocked: 'BLOCKED', unsupported: 'UNSUPPORTED', 'not-verified': 'NOT VERIFIED', info: 'INFO',
  };
  return labels[status];
}

type RunLaneKind = 'run' | 'streaming' | 'social';
const RUN_LANES: Array<{kind:RunLaneKind;title:string;subtitle:string}> = [
  {kind:'run',title:'RUN',subtitle:'Browser and device QA'},
  {kind:'streaming',title:'STREAMING HUB',subtitle:'Music streaming QA'},
  {kind:'social',title:'SOCIAL HUB',subtitle:'Social content QA'},
];
function runLaneKind(run:RunSummary):RunLaneKind { return run.runKind==='streaming'?'streaming':run.runKind==='social'?'social':'run'; }

export function RunCenter({ initialRunId = null, onInitialRunHandled }: RunCenterProps = {}) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [proxyIpSummary, setProxyIpSummary] = useState<RunProxyIpSummary | null>(null);
  const [error, setError] = useState('');
  const [completedLimit, setCompletedLimit] = useState(COMPLETED_PAGE_SIZE);
  const [autoRerun, setAutoRerun] = useState<AutoRerunState>(DEFAULT_AUTO_RERUN);
  const [stuckRecovery, setStuckRecovery] = useState<StuckRunRecoveryState>(DEFAULT_STUCK_RECOVERY);
  const [customStuckTimeout, setCustomStuckTimeout] = useState('5');
  const [customStuckTimeoutOpen, setCustomStuckTimeoutOpen] = useState(false);
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const [pendingBulkDelete, setPendingBulkDelete] = useState<BulkDeleteRunScope | null>(null);
  const [activeLane, setActiveLane] = useState<RunLaneKind>('run');

  const refresh = useCallback(async () => {
    if (!window.orbitqa?.listQaRuns) return;
    try {
      const [next, nextAutoRerun, nextStuckRecovery] = await Promise.all([
        window.orbitqa.listQaRuns(),
        window.orbitqa.getAutoRerunState?.(activeLane) ?? Promise.resolve(DEFAULT_AUTO_RERUN),
        window.orbitqa.getStuckRunRecoveryState?.(activeLane) ?? Promise.resolve(DEFAULT_STUCK_RECOVERY),
      ]);
      setRuns(next);
      setAutoRerun(nextAutoRerun);
      setStuckRecovery(nextStuckRecovery);
      if (!STUCK_TIMEOUT_PRESETS.includes(nextStuckRecovery.timeoutMinutes)) setCustomStuckTimeout(String(nextStuckRecovery.timeoutMinutes));
      if (selectedId && window.orbitqa.getQaRun) {
        const nextDetail = await window.orbitqa.getQaRun(selectedId);
        setDetail(nextDetail);
        if (!nextDetail) { setSelectedId(null); setProxyIpSummary(null); }
      }
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }, [selectedId, activeLane]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    const unsubscribe = window.orbitqa?.onQaEvent?.((_event: QaEvent) => void refresh());
    return () => { window.clearInterval(timer); unsubscribe?.(); };
  }, [refresh]);

  const closeDetail = useCallback(() => { setSelectedId(null); setDetail(null); setProxyIpSummary(null); }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeDetail(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDetail]);

  async function openRun(runId: string) {
    setSelectedId(runId);
    setError('');
    try {
      const [nextDetail, nextProxySummary] = await Promise.all([
        window.orbitqa?.getQaRun?.(runId) ?? Promise.resolve(null),
        window.orbitqa?.getRunProxyIpSummary?.(runId) ?? Promise.resolve(null),
      ]);
      setDetail(nextDetail);
      setProxyIpSummary(nextProxySummary);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  useEffect(() => {
    if (!initialRunId) return;
    void openRun(initialRunId).finally(() => onInitialRunHandled?.());
  }, [initialRunId]);
  function acknowledgeRunAction(runId:string,status:string){
    setRuns(current=>current.map(run=>run.runId===runId?{...run,status:status as RunSummary['status'],updatedAt:new Date().toISOString()}:run));
    setDetail(current=>current?.runId===runId?{...current,status:status as RunDetail['status'],updatedAt:new Date().toISOString()}:current);
  }
  async function stopRun(runId: string) { setError(''); acknowledgeRunAction(runId,'STOPPING'); try { await window.orbitqa?.stopQaRun?.(runId); void refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); void refresh(); } }
  async function pauseRun(runId: string) { setError(''); acknowledgeRunAction(runId,'PAUSING'); try { await window.orbitqa?.pauseQaRun?.(runId); void refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); void refresh(); } }
  async function resumeRun(runId: string) { setError(''); acknowledgeRunAction(runId,'RESUMING'); try { await window.orbitqa?.resumeQaRun?.(runId); void refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); void refresh(); } }
  async function rerunRun(runId: string) {
    setError('');
    try {
      acknowledgeRunAction(runId,'STARTING');
      const result = await window.orbitqa?.rerunQaRun?.(runId);
      if (!result?.rerun) throw new Error(result?.reason || 'Unable to run this history item again');
      void refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); void refresh(); }
  }
  async function deleteRun(runId: string) {
    setError('');
    try {
      const result = await window.orbitqa?.deleteQaRun?.(runId);
      if (!result?.deleted) throw new Error(result?.reason || 'Unable to delete this run');
      if (selectedId === runId) closeDetail();
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function stopAll() {
    setError('');
    try { await window.orbitqa?.stopAllQaRuns?.(activeLane); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function updateAutoRerun(patch: { enabled?: boolean; mode?: AutoRerunMode; maxConcurrent?: number; selectedRunIds?: string[] }) {
    setError('');
    try {
      const next = await window.orbitqa?.configureAutoRerun?.(patch, activeLane);
      if (!next) throw new Error('Automatic Run Again is unavailable');
      setAutoRerun(next);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function updateStuckRunRecovery(patch: { enabled?: boolean; timeoutMinutes?: number; maxAttempts?: number }) {
    setError('');
    try {
      const next = await window.orbitqa?.configureStuckRunRecovery?.(patch, activeLane);
      if (!next) throw new Error('Stuck Run Auto-Recovery is unavailable');
      setStuckRecovery(next);
      if (!STUCK_TIMEOUT_PRESETS.includes(next.timeoutMinutes)) setCustomStuckTimeout(String(next.timeoutMinutes));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function applyCustomStuckTimeout() {
    const parsed = Number(customStuckTimeout);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 120) { setError('Custom stuck timeout must be between 1 and 120 minutes'); return; }
    await updateStuckRunRecovery({ timeoutMinutes:parsed });
    setCustomStuckTimeoutOpen(false);
  }

  function historyCount(scope: BulkDeleteRunScope) {
    const laneRuns = completedRuns.filter((run) => runLaneKind(run) === activeLane);
    if (scope === 'all-finished') return laneRuns.length;
    const status = scope === 'completed' ? 'COMPLETED' : scope === 'failed' ? 'FAILED' : 'STOPPED';
    return laneRuns.filter((run) => run.status === status).length;
  }

  async function confirmBulkDelete() {
    if (!pendingBulkDelete) return;
    setError('');
    try {
      const result = await window.orbitqa?.bulkDeleteQaRuns?.(pendingBulkDelete, activeLane);
      if (!result) throw new Error('Bulk delete is unavailable');
      if (selectedId && result.runIds.includes(selectedId)) closeDetail();
      setPendingBulkDelete(null);
      setDeleteMenuOpen(false);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  const activeRuns = useMemo(() => runs.filter((run) => ACTIVE.has(run.status)), [runs]);
  const completedRuns = useMemo(() => runs.filter((run) => TERMINAL.has(run.status)), [runs]);
  const autoRerunSelectableRuns = useMemo(() => {
    const selected = new Set(autoRerun.selectedRunIds);
    return runs.filter((run) => runLaneKind(run) === activeLane && (TERMINAL.has(run.status) || selected.has(run.runId)));
  }, [runs, autoRerun.selectedRunIds, activeLane]);

  async function toggleAutoRerunSelection(runId: string, checked: boolean) {
    const selected = new Set(autoRerun.selectedRunIds);
    if (checked) selected.add(runId); else selected.delete(runId);
    await updateAutoRerun({ selectedRunIds:[...selected] });
  }
  const activeByLane = useMemo(() => Object.fromEntries(RUN_LANES.map(lane=>[lane.kind,activeRuns.filter(run=>runLaneKind(run)===lane.kind)])) as Record<RunLaneKind,RunSummary[]>, [activeRuns]);
  const completedByLane = useMemo(() => Object.fromEntries(RUN_LANES.map(lane=>[lane.kind,completedRuns.filter(run=>runLaneKind(run)===lane.kind).slice(0,completedLimit)])) as Record<RunLaneKind,RunSummary[]>, [completedRuns,completedLimit]);
  const activeCount = activeByLane[activeLane].length;
  const completedCount = completedRuns.filter((run) => runLaneKind(run) === activeLane).length;
  const laneLabel = RUN_LANES.find((lane) => lane.kind === activeLane)?.title || 'RUNS';

  const workRows = useMemo(() => {
    const map = new Map<string, { workId: string; status: string; label: string; targetUrl?: string }>();
    for (const raw of detail?.logs || []) {
      const event = raw as { workId?: string; type?: string; status?: string; deviceLabel?: string; browserLabel?: string; targetUrl?: string };
      if (!event.workId) continue;
      const status = event.status || (event.type === 'session-start' ? 'running' : map.get(event.workId)?.status || 'observed');
      map.set(event.workId, { workId:event.workId, status, label:[event.deviceLabel,event.browserLabel].filter(Boolean).join(' · ') || event.workId, targetUrl:event.targetUrl });
    }
    return [...map.values()];
  }, [detail]);

  const proxyMix = detail?.proxyMix || { rotating:0, static:0, total:0 };
  const runtimeRows = useMemo(() => Object.entries(detail?.runtimeVerifications || {}), [detail?.runtimeVerifications]);
  const privacyRouteRows = useMemo(() => Object.entries(detail?.privacyRouteIntegrityByWork || {}), [detail?.privacyRouteIntegrityByWork]);
  const streamingResultMetrics = useMemo(() => {
    const rows = Object.values(detail?.streamingResults || {}) as Array<{ checks?: Record<string,{status?:string}>; screenshots?: string[]; integrity?: { blocked?: boolean; overall?: string } }>;
    let checksPassed=0, checksNotApplicable=0, screenshots=0, networkVerified=0;
    for (const row of rows) {
      for (const check of Object.values(row?.checks || {})) {
        if (check?.status === 'PASS') checksPassed++;
        else if (check?.status === 'NOT_APPLICABLE') checksNotApplicable++;
      }
      screenshots += Array.isArray(row?.screenshots) ? row.screenshots.length : 0;
      if (row?.integrity && row.integrity.blocked !== true && row.integrity.overall !== 'fail') networkVerified++;
    }
    return { sessions:rows.length, checksPassed, checksNotApplicable, screenshots, networkVerified };
  }, [detail?.streamingResults]);

  const cardProps = { onOpen:openRun, onStop:stopRun, onPause:pauseRun, onResume:resumeRun, onRerun:rerunRun, onDelete:deleteRun };

  return (
    <div className="run-center-page">
      <section className="hero run-center-hero">
        <div><span className="section-kicker">MULTI-RUN CONTROL</span><h2>Run Center</h2><p>Active work stays focused while finished runs move into lightweight history.</p></div>
        <div className="run-center-hero__stats"><strong>{activeCount}</strong><span>active / paused</span></div>
      </section>
      <nav className="run-center-kind-tabs" aria-label="Run Center sections">
        {RUN_LANES.map((lane) => {
          const activeCountForLane = activeByLane[lane.kind].length;
          const finishedCountForLane = completedRuns.filter((run) => runLaneKind(run) === lane.kind).length;
          return <button key={lane.kind} type="button" className={`run-center-kind-tab run-center-kind-tab--${lane.kind}${activeLane === lane.kind ? ' is-active' : ''}`} aria-pressed={activeLane === lane.kind} onClick={() => { setActiveLane(lane.kind); setDeleteMenuOpen(false); setPendingBulkDelete(null); closeDetail(); }}>
            <span><strong>{lane.title}</strong><small>{lane.subtitle}</small></span>
            <b>{activeCountForLane}<small> active</small></b>
            <b>{finishedCountForLane}<small> history</small></b>
          </button>;
        })}
      </nav>
      {error && <div role="alert" className="form-error">{error}</div>}
      <section className="run-center-toolbar panel">
        <div className="run-center-toolbar__counts"><span><strong>{activeCount}</strong> active</span><span><strong>{completedCount}</strong> history</span><small>{laneLabel}</small></div>
        <div className="run-center-toolbar__actions">
          <div className="run-center-delete-wrap">
            <button type="button" className="text-button" aria-expanded={deleteMenuOpen} onClick={() => { setDeleteMenuOpen((value) => !value); setPendingBulkDelete(null); }}>Delete Runs</button>
            {deleteMenuOpen && <div className="run-center-delete-menu" role="menu">
              {(Object.keys(DELETE_SCOPE_LABELS) as BulkDeleteRunScope[]).map((scope) => <button type="button" role="menuitem" key={scope} onClick={() => { setPendingBulkDelete(scope); setDeleteMenuOpen(false); }}>{DELETE_SCOPE_LABELS[scope]} <span>{historyCount(scope)}</span></button>)}
            </div>}
          </div>
          <button type="button" className="danger-button compact-button" disabled={activeCount===0} onClick={stopAll}>{`Stop All ${laneLabel}`}</button>
        </div>
      </section>
      {pendingBulkDelete && <section className={`panel run-center-delete-confirm ${pendingBulkDelete === 'all-finished' ? 'run-center-delete-confirm--strong' : ''}`}>
        <div><strong>{DELETE_SCOPE_LABELS[pendingBulkDelete]}?</strong><span>This removes {historyCount(pendingBulkDelete)} finished {laneLabel.toLowerCase()} record{historyCount(pendingBulkDelete) === 1 ? '' : 's'} only. Other Run Center tabs are not affected.</span></div>
        <div><button type="button" className="text-button" onClick={() => setPendingBulkDelete(null)}>Cancel</button><button type="button" className="danger-button" onClick={confirmBulkDelete}>CONFIRM {DELETE_SCOPE_LABELS[pendingBulkDelete].toUpperCase()}</button></div>
      </section>}
      <section className="panel run-center-automation">
        <div className="run-center-automation__header">
          <div><span className="section-kicker">AUTOMATION</span><h3>Automatic Run Again</h3><p>Choose the exact finished {laneLabel.toLowerCase()} tasks that should repeat. Each tab owns its own automation queue and never starts tasks from another tab.</p></div>
          <label className="run-center-auto-switch"><input aria-label="Automatic Run Again" type="checkbox" checked={autoRerun.enabled} onChange={(event) => void updateAutoRerun({ enabled:event.target.checked })} /><span>{autoRerun.enabled ? 'ON' : 'OFF'}</span></label>
        </div>
        {autoRerun.enabled ? <>
          <div className="run-center-automation__controls">
            <label><span>Auto-rerun mode</span><select aria-label="Auto-rerun mode" value={autoRerun.mode} onChange={(event) => void updateAutoRerun({ mode:event.target.value as AutoRerunMode })}><option value="completed-only">Completed only</option><option value="all-finished">All finished runs</option></select></label>
            <label><span>Max simultaneous reruns</span><select aria-label="Max simultaneous reruns" value={autoRerun.maxConcurrent} onChange={(event) => void updateAutoRerun({ maxConcurrent:Number(event.target.value) })}>{Array.from({length:10},(_,index)=>index+1).map((value)=><option key={value} value={value}>{value}</option>)}</select></label>
            <div className="run-center-automation__status"><span className="status-dot status-dot--ready" /> <strong>Auto Rerun: ON</strong><small>{autoRerun.running}/{autoRerun.maxConcurrent} running · {autoRerun.queued} queued · {autoRerun.selectedRunIds.length} selected</small></div>
          </div>
          <div className="run-center-auto-select">
            <div className="run-center-auto-select__heading"><div><strong>Select runs for Automatic Run Again</strong><small>Checked tasks stay enrolled across attempts. Uncheck a running task to let its current attempt finish without starting another cycle.</small></div></div>
            {autoRerunSelectableRuns.length === 0 ? <div className="empty-state">No finished runs are available to select yet.</div> : <div className="run-center-auto-select__list">
              {autoRerunSelectableRuns.map((run) => <label className="run-center-auto-select__row" key={run.runId}>
                <input aria-label={`Automatic rerun ${run.targetSummary}`} type="checkbox" checked={autoRerun.selectedRunIds.includes(run.runId)} onChange={(event) => void toggleAutoRerunSelection(run.runId, event.target.checked)} />
                <span><strong>{run.targetSummary}</strong><small>{run.status} · Attempt {Math.max(1, run.attemptCount || 1)} · {run.runId}</small></span>
              </label>)}
            </div>}
          </div>
          <p className="run-center-automation__note">Completed only repeats a selected task only after a successful completion. All finished runs repeats selected tasks after Completed, Failed, or Stopped. Turning the master OFF clears the waiting queue but does not kill attempts already running.</p>
        </> : <p className="run-center-automation__note">Turn this on to choose which finished tasks should keep running again automatically.</p>}
      </section>
      <section className="panel run-center-automation run-center-recovery">
        <div className="run-center-automation__header">
          <div><span className="section-kicker">RECOVERY</span><h3>Stuck Run Auto-Recovery</h3><p>Automatically rescue stuck {laneLabel.toLowerCase()} work without touching runs in the other tabs.</p></div>
          <label className="run-center-auto-switch"><input aria-label="Stuck Run Auto-Recovery" type="checkbox" checked={stuckRecovery.enabled} onChange={(event) => void updateStuckRunRecovery({ enabled:event.target.checked })} /><span>{stuckRecovery.enabled ? 'ON' : 'OFF'}</span></label>
        </div>
        {stuckRecovery.enabled ? <>
          <div className="run-center-automation__controls">
            <label><span>Stuck timeout</span><select aria-label="Stuck timeout" value={STUCK_TIMEOUT_PRESETS.includes(stuckRecovery.timeoutMinutes) && !customStuckTimeoutOpen ? String(stuckRecovery.timeoutMinutes) : 'custom'} onChange={(event) => {
              if (event.target.value === 'custom') { setCustomStuckTimeoutOpen(true); setCustomStuckTimeout(String(stuckRecovery.timeoutMinutes)); return; }
              setCustomStuckTimeoutOpen(false); void updateStuckRunRecovery({ timeoutMinutes:Number(event.target.value) });
            }}>{STUCK_TIMEOUT_PRESETS.map((value)=><option key={value} value={value}>{value} minute{value === 1 ? '' : 's'}</option>)}<option value="custom">Custom…</option></select></label>
            {(customStuckTimeoutOpen || !STUCK_TIMEOUT_PRESETS.includes(stuckRecovery.timeoutMinutes)) && <label><span>Custom minutes</span><div className="run-center-inline-control"><input aria-label="Custom stuck timeout minutes" type="number" min={1} max={120} value={customStuckTimeout} onChange={(event)=>setCustomStuckTimeout(event.target.value)} /><button type="button" className="text-button" onClick={() => void applyCustomStuckTimeout()}>Apply</button></div></label>}
            <label><span>Maximum recovery attempts</span><select aria-label="Maximum recovery attempts" value={stuckRecovery.maxAttempts} onChange={(event) => void updateStuckRunRecovery({ maxAttempts:Number(event.target.value) })}>{Array.from({length:10},(_,index)=>index+1).map((value)=><option key={value} value={value}>{value}</option>)}</select></label>
            <div className="run-center-automation__status"><span className="status-dot status-dot--ready" /> <strong>Recovery: ON</strong><small>{stuckRecovery.watching} watching · {stuckRecovery.recovering} recovering</small></div>
          </div>
          <p className="run-center-automation__note">OrbitQA watches only the active tab. The recovery clock resets whenever that run reports progress. After the stuck timeout it stops that run and restarts the same logical task. Other tabs are never touched.</p>
        </> : <p className="run-center-automation__note">Turn this on to automatically recover stuck work in the selected tab after your chosen timeout.</p>}
      </section>
      <section className="run-center-layout">
        <div className="run-center-stacks">
          <section className="run-center-group">
            <div className="run-center-group__header"><div><span className="section-kicker">LIVE WORK</span><h3>{laneLabel}</h3></div><span>{activeCount}</span></div>
            <div className="run-kind-view">
              <div className={`run-kind-view__heading run-kind-view__heading--${activeLane}`}><strong>{RUN_LANES.find((lane) => lane.kind === activeLane)?.title}</strong><small>{RUN_LANES.find((lane) => lane.kind === activeLane)?.subtitle}</small></div>
              <div className="run-card-grid">{activeByLane[activeLane].length?activeByLane[activeLane].map(run=><RunCard key={run.runId} run={run} {...cardProps}/>):<div className="empty-state run-kind-empty">No active {RUN_LANES.find((lane) => lane.kind === activeLane)?.title.toLowerCase()}.</div>}</div>
            </div>
          </section>
          <section className="run-center-group run-center-group--history">
            <div className="run-center-group__header"><div><span className="section-kicker">HISTORY</span><h3>{laneLabel} History</h3></div><span>{completedCount}</span></div>
            <div className="run-kind-view">
              <div className={`run-kind-view__heading run-kind-view__heading--${activeLane}`}><strong>{RUN_LANES.find((lane) => lane.kind === activeLane)?.title}</strong><small>{RUN_LANES.find((lane) => lane.kind === activeLane)?.subtitle}</small></div>
              <div className="run-card-grid run-card-grid--history">{completedByLane[activeLane].length?completedByLane[activeLane].map(run=><RunCard key={run.runId} run={run} {...cardProps}/>):<div className="empty-state run-kind-empty">No finished {RUN_LANES.find((lane) => lane.kind === activeLane)?.title.toLowerCase()} yet.</div>}</div>
            </div>
            {completedByLane[activeLane].length < completedRuns.filter((run) => runLaneKind(run) === activeLane).length && <button type="button" className="text-button run-history-more" onClick={() => setCompletedLimit((value) => value + COMPLETED_PAGE_SIZE)}>Load more</button>}
          </section>
        </div>
        {detail && <aside className="panel run-detail-panel">
          <div className="run-detail-header">
            <div><span className="section-kicker">RUN DETAIL</span><h3>{detail.targetSummary}</h3></div>
            <div className="run-detail-header__actions"><span className={`run-status-badge run-status-badge--${detail.status.toLowerCase()}`}>{detail.status}</span><button type="button" className="run-detail-close" aria-label="Close detail" title="Close detail (Escape)" onClick={closeDetail}>×</button></div>
          </div>
          <div className="run-detail-meta"><span>Run ID <code>{detail.runId}</code></span><span>Attempt <strong>{Math.max(1, detail.attemptCount || 1)}</strong></span><span>Mode <strong>{detail.executionMode === 'background' ? 'Background' : 'Visible'}</strong></span><span>Created <strong>{timeLabel(detail.createdAt)}</strong></span></div>
          <div className="run-detail-metrics">
            <div><span>Requested</span><strong>{detail.counters.requested}</strong></div><div><span>Running</span><strong>{detail.counters.running}</strong></div><div><span>Queued</span><strong>{detail.counters.queued}</strong></div><div><span>Completed</span><strong>{detail.counters.completed}</strong></div><div><span>Failed</span><strong>{detail.counters.failed}</strong></div><div><span>Incomplete</span><strong>{detail.counters.incomplete}</strong></div>
          </div>
          <section className="run-detail-section"><h4>Work Units</h4>{workRows.length === 0 ? <div className="empty-state">No work-unit events yet.</div> : <div className="run-work-list">{workRows.slice(-80).map((work) => <div className="run-work-row" key={work.workId}><span>{work.label}</span><small>{work.targetUrl || work.workId}</small><strong>{work.status}</strong></div>)}</div>}</section>
          {runtimeRows.length > 0 && <section className="run-detail-section"><h4>Browser Runtime Verification</h4><div className="run-runtime-list">{runtimeRows.map(([workId, runtime]) => <div className="run-runtime-row" key={workId}><div><strong>{runtime.browserFamily}</strong><span>{runtime.verificationLabel}</span></div><div><span>{runtime.browserVersion || 'Version unavailable'}</span>{runtime.executablePath ? <code>{runtime.executablePath}</code> : null}</div></div>)}</div></section>}
          {privacyRouteRows.length > 0 && <section className="run-detail-section"><h4>Privacy &amp; Route Integrity</h4><small className="run-privacy-route-note">DNS Route Integrity and Automation Environment are displayed exactly as reported by the work unit.</small><div className="run-privacy-route-list">{privacyRouteRows.map(([workId, report]) => <article className={`run-privacy-route-card run-privacy-route-card--${report.overallStatus}`} key={workId}><header><div><strong>{workId}</strong><span>{report.runtimeLabel || 'Runtime unavailable'} · {report.phase}</span></div><strong className={`privacy-route-token privacy-route-token--${report.overallStatus}`}>{privacyRouteStatusLabel(report.overallStatus)}</strong></header><div>{report.checks.map((check) => <div className="run-privacy-route-check" key={check.key}><span>{check.label}</span><strong className={`run-privacy-route-check--${check.status}`}>{privacyRouteStatusLabel(check.status)}</strong><small>{[check.observed, check.detail].filter(Boolean).join(' · ') || 'No additional detail'}</small></div>)}</div></article>)}</div></section>}
          {proxyIpSummary && <section className="run-detail-section run-proxy-ip-summary"><h4>Proxy / IP Summary</h4><div className="run-detail-metrics"><div><span>Proxy observations</span><strong>{proxyIpSummary.observationCount}</strong></div><div><span>Unique IPs</span><strong>{proxyIpSummary.uniqueIps}</strong></div><div><span>Repeated observations</span><strong>{proxyIpSummary.repeatedIpCount}</strong></div><div><span>Countries</span><strong>{proxyIpSummary.countries}</strong></div></div>{proxyIpSummary.rows.length > 0 ? <div className="run-proxy-ip-list">{proxyIpSummary.rows.slice(0,80).map((row) => <div className="run-proxy-ip-row" key={`${row.proxyIdentity}-${row.observedIp}`}><div><strong>{row.observedIp}</strong><span>{row.countryCode || 'Unknown'} · {row.proxyIdentity}</span></div><div><strong>{row.seenInRunCount ?? 0}×</strong><span>Seen {row.seenInRunCount ?? 0}× in this run</span></div></div>)}</div> : <div className="empty-state">No proxy exit IP observations were recorded for this run.</div>}</section>}
          {(detail.runKind === 'social' || detail.socialSummary) && <section className="run-detail-section streaming-run-summary"><h4>Social QA Summary</h4><div className="run-detail-metrics">
            <div><span>Platform</span><strong>{detail.socialSummary?.platform || 'Social'}</strong></div>
            <div><span>Accounts</span><strong>{detail.socialSummary?.accounts ?? '—'}</strong></div>
            <div><span>Targets</span><strong>{detail.socialSummary?.targets ?? '—'}</strong></div>
            <div><span>Groups</span><strong>{detail.socialSummary?.groups ?? '—'}</strong></div>
            <div><span>Completed tasks</span><strong>{detail.socialSummary?.completedTasks ?? 0}</strong></div>
            <div><span>Checks passed</span><strong>{detail.socialSummary?.passedChecks ?? 0}</strong></div>
            <div><span>Warnings</span><strong>{detail.socialSummary?.warnings ?? 0}</strong></div>
            <div><span>Failed checks</span><strong>{detail.socialSummary?.failedChecks ?? 0}</strong></div>
          </div></section>}
          {(detail.runKind === 'streaming' || detail.streamingSummary) && <section className="run-detail-section streaming-run-summary"><h4>Streaming QA Summary</h4><div className="run-detail-metrics">
            <div><span>Platform</span><strong>{detail.streamingSummary?.platform || 'Streaming'}</strong></div>
            <div><span>Slots</span><strong>{detail.streamingSummary?.slots ?? detail.requestedConcurrency}</strong></div>
            <div><span>Accounts</span><strong>{detail.streamingSummary?.accounts ?? '—'}</strong></div>
            <div><span>Tracks</span><strong>{detail.streamingSummary?.tracks ?? '—'}</strong></div>
            <div><span>Groups</span><strong>{detail.streamingSummary?.groups ?? '—'}</strong></div>
            <div><span>Completed plays (QA)</span><strong>{detail.streamingSummary?.playCount ?? detail.streamingSummary?.validQaPlaybacks ?? detail.streamingSummary?.playbackCompletions ?? 0}{detail.streamingSummary?.requestedPlaybackChecks != null ? ` / ${detail.streamingSummary.requestedPlaybackChecks}` : ''}</strong></div>
            <div><span>Invalid / short playbacks</span><strong>{detail.streamingSummary?.invalidQaPlaybacks ?? 0}</strong></div>
            <div><span>Queue mode</span><strong>{detail.streamingSummary?.queueMode || '—'}</strong></div>
            <div><span>Observation</span><strong>{detail.streamingSummary?.observation ? `${detail.streamingSummary.observation.minSeconds}–${detail.streamingSummary.observation.maxSeconds}s` : '—'}</strong></div>
            <div><span>Checks passed</span><strong>{streamingResultMetrics.checksPassed}</strong></div>
            <div><span>Not applicable</span><strong>{streamingResultMetrics.checksNotApplicable}</strong></div>
            <div><span>Screenshots</span><strong>{streamingResultMetrics.screenshots}</strong></div>
            <div><span>Network verified</span><strong>{streamingResultMetrics.networkVerified}/{streamingResultMetrics.sessions || 0}</strong></div>
          </div></section>}
          <section className="run-detail-section"><h4>Configuration</h4><pre>{JSON.stringify(detail.config, null, 2)}</pre></section>
          {proxyMix.total > 0 && <section className="run-detail-section"><h4>Proxy Mix</h4><div className="run-detail-metrics"><div><span>Rotating sessions</span><strong>{proxyMix.rotating}</strong></div><div><span>Static sessions</span><strong>{proxyMix.static}</strong></div><div><span>Total mixed</span><strong>{proxyMix.total}</strong></div></div></section>}
          {detail.latestAdSummary != null && <section className="run-detail-section"><h4>Ad Summary</h4><pre>{JSON.stringify(detail.latestAdSummary, null, 2)}</pre></section>}
          {detail.latestIdentity != null && <section className="run-detail-section"><h4>Device Identity</h4><pre>{JSON.stringify(detail.latestIdentity, null, 2)}</pre></section>}
          {detail.latestPrivacy != null && <section className="run-detail-section"><h4>Privacy &amp; Network</h4><pre>{JSON.stringify(detail.latestPrivacy, null, 2)}</pre></section>}
          {detail.latestIntegrity != null && <section className="run-detail-section"><h4>Session Integrity</h4><pre>{JSON.stringify(detail.latestIntegrity, null, 2)}</pre></section>}
          <section className="run-detail-section"><h4>Activity Log</h4><div className="live-log run-center-log">{detail.logs.length === 0 ? <div className="empty-state">No events yet.</div> : detail.logs.slice(-200).map((event: unknown, index) => { const item = event as { timestamp?: string; message?: string; type?: string; workId?: string; severity?: string; stage?: string; accountLabel?: string; accountId?: string; platform?: string; trackTitle?: string; currentUrl?: string; action?: string }; const severity=runLogSeverity(item); const context=[item.platform,item.accountLabel||item.accountId||item.workId,item.stage].filter(Boolean).join(' · '); const extra=[item.trackTitle,item.action,item.currentUrl].filter(Boolean).join(' · '); return <div className={`log-line run-center-log-line run-center-log-line--${severity}`} key={`${item.timestamp}-${index}`}><time>{item.timestamp ? timeLabel(item.timestamp) : ''}</time><span>{severity.toUpperCase()}</span><p><strong>{context||'RUN'}</strong>{' — '}{item.message || item.type}{extra?<small>{extra}</small>:null}</p></div>; })}</div></section>
        </aside>}
      </section>
    </div>
  );
}
