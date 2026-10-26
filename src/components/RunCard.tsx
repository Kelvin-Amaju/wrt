import { useState } from 'react';
import type { RunSummary } from '../shared/runCenter';

type Props = {
  run: RunSummary;
  onOpen: (runId: string) => void;
  onStop: (runId: string) => void;
  onPause?: (runId: string) => void;
  onResume?: (runId: string) => void;
  onRerun?: (runId: string) => void;
  onDelete?: (runId: string) => void;
};

const ACTIVE = new Set(['CREATED','STARTING','RUNNING','PAUSING','RESUMING','STOPPING']);
const TERMINAL = new Set(['COMPLETED','FAILED','STOPPED']);

export function RunCard({ run, onOpen, onStop, onPause, onResume, onRerun, onDelete }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const canPause = ['STARTING','RUNNING','RESUMING'].includes(run.status);
  const canResume = run.status === 'PAUSED';
  const canStop = ACTIVE.has(run.status) || run.status === 'PAUSED';
  const isTerminal = TERMINAL.has(run.status);
  const terminalCount = run.counters.completed + run.counters.failed + run.counters.cancelled + run.counters.incomplete;
  const progressPct = run.counters.requested > 0 ? Math.min(100, Math.round((terminalCount / run.counters.requested) * 100)) : 0;
  const completedAt = isTerminal ? new Date(run.updatedAt).toLocaleString() : null;
  const isStreaming = run.runKind === 'streaming';
  const isSocial = run.runKind === 'social';
  const isWarmer = run.runKind === 'warmer';
  const visibleDeviceFamilies = isStreaming ? run.deviceFamilies.filter((family) => family !== 'Streaming QA') : run.deviceFamilies;

  return (
    <article className={`run-card ${isTerminal ? 'run-card--history' : ''}`}>
      <div className="run-card__top">
        <div>
          <span className="section-kicker">{run.runId}</span>
          <h3>{run.targetSummary}</h3>
          {isStreaming && <span className="run-kind-badge">Streaming QA</span>}
          {isSocial && <span className="run-kind-badge">Social QA</span>}
          {isWarmer && <span className="run-kind-badge">Profile warmer</span>}
          {run.autoRerunSelected && <span className="run-kind-badge run-kind-badge--auto">AUTO RUN AGAIN</span>}
        </div>
        <span className={`run-status-badge run-status-badge--${run.status.toLowerCase()}`}>{run.status}</span>
      </div>
      <div className="run-card__badges">
        <span>Attempt {Math.max(1, run.attemptCount || 1)}</span>
        <span>{run.executionMode === 'background' ? 'Background' : 'Visible'}</span>
        <span>{run.requestedConcurrency === 'auto' ? (isStreaming ? 'Auto slots' : 'Auto concurrency') : `${run.requestedConcurrency} ${isStreaming ? 'slots' : 'concurrency'}`}</span>
        {visibleDeviceFamilies.map((family) => <span key={family}>{family}</span>)}
        {isStreaming && run.streamingMeta ? <span>{run.streamingMeta.accounts} accounts · {run.streamingMeta.tracks} tracks</span> : null}
        {isSocial && run.socialMeta ? <span>{run.socialMeta.accounts} accounts · {run.socialMeta.targets} targets · {run.socialMeta.groups} groups</span> : null}
      </div>
      <div className="run-card__progress" aria-label={`Run progress ${progressPct}%`}>
        <div className="run-card__progress-meta"><span>Progress</span><strong>{progressPct}%</strong></div>
        <div className="run-card__progress-track"><span style={{ width: `${progressPct}%` }} /></div>
      </div>
      <div className="run-card__metrics">
        {isTerminal ? <>
          <div><small>Completed</small><strong>{run.counters.completed}</strong></div>
          <div><small>Failed</small><strong>{run.counters.failed}</strong></div>
          <div><small>Incomplete</small><strong>{run.counters.incomplete}</strong></div>
          <div><small>Cancelled</small><strong>{run.counters.cancelled}</strong></div>
        </> : <>
          <div><small>Running</small><strong>{run.counters.running}</strong></div>
          <div><small>Queued</small><strong>{run.counters.queued}</strong></div>
          <div><small>Completed</small><strong>{run.counters.completed}</strong></div>
          <div><small>Failed</small><strong>{run.counters.failed}</strong></div>
        </>}
      </div>
      {completedAt && <p className="run-card__history-time">Finished {completedAt}</p>}
      {run.resourceMessage && <p className="run-card__message">{run.resourceMessage}</p>}
      <div className="run-card__actions">
        <button type="button" className="text-button" onClick={() => onOpen(run.runId)}>{isTerminal ? 'View' : 'Open'}</button>
        {canPause && !isSocial && !isWarmer && onPause && <button type="button" className="text-button" onClick={() => onPause(run.runId)}>Pause</button>}
        {canResume && !isSocial && !isWarmer && onResume && <button type="button" className="text-button" onClick={() => onResume(run.runId)}>Resume</button>}
        {canStop && <button type="button" className="danger-button compact-button" onClick={() => onStop(run.runId)}>Stop</button>}
        {isTerminal && onRerun && <button type="button" className="text-button run-again-button" onClick={() => onRerun(run.runId)}>Run Again</button>}
        {isTerminal && onDelete && <button type="button" className="danger-button compact-button" onClick={() => {
          if (!confirmDelete) { setConfirmDelete(true); return; }
          setConfirmDelete(false);
          onDelete(run.runId);
        }}>{confirmDelete ? 'Confirm delete' : 'Delete'}</button>}
      </div>
    </article>
  );
}
