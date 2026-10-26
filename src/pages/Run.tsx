import { useEffect, useMemo, useRef, useState } from 'react';
import { UrlPoolEditor } from '../components/UrlPoolEditor';
import { DeviceMatrixEditor } from '../components/DeviceMatrixEditor';
import {
  countMatrixWorkUnitsV3,
  createDefaultAutoQaSettings,
  createDefaultDeviceMatrix,
  createDefaultProxyPolicy,
  normalizeQaRunRequestV3,
  type AutoQaSettings,
  type ProxyMode,
  type QaConcurrencySetting,
  type QaDeviceMatrixConfig,
  type QaProxyPolicy,
  type QaRunRequestV3,
} from '../shared/qaMatrix';
import { createDefaultSteps, createStep, stepTitle, type AdSummary, type QaEvent, type QaStep } from '../shared/run';
import { activityWorkLabel } from '../shared/activityLogLabel';
import {
  createDefaultPrivacySettings,
  validatePrivacySettings,
  type PrivacyDiagnosticReport,
  type PrivacyRunSettings,
} from '../shared/privacy';
import type { MobileStatus } from '../shared/mobileDevices';
import type { DeviceIdentityReport } from '../shared/deviceIdentity';
import type { SessionIntegrityReport } from '../shared/sessionIntegrity';
import type { ProxySummary } from '../shared/proxy';
import type { RealIosProviderPublicConfig, RealIosProviderStatus } from '../shared/realIos';
import type { RunExecutionMode } from '../shared/runCenter';
import type { PrivacyRouteIntegrityReport } from '../shared/privacyRouteIntegrity';

type WorkStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'incomplete';

type WorkState = {
  status: WorkStatus;
  targetUrl: string;
  targetId?: string;
  groupId?: string;
  instanceIndex?: number;
  deviceLabel?: string;
  browserLabel?: string;
  runtimeLabel?: string;
  proxyIp?: string;
  remainingSeconds?: number;
};

type RunMetrics = {
  requested: number;
  running: number;
  queued: number;
  completed: number;
  failed: number;
  cancelled: number;
  incomplete: number;
};

type RunSummary = RunMetrics & {
  total: number;
  durationMs: number;
};

const EMPTY_PROXY_SUMMARY: ProxySummary = {
  total: 0, live: 0, slow: 0, dead: 0, unavailable: 0, checking: 0,
  rotatingLive: 0, rotatingSlow: 0, staticLive: 0, staticSlow: 0,
};

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function workLabel(item: WorkState): string {
  let host = 'Target';
  try { host = new URL(item.targetUrl).hostname; } catch { /* keep fallback */ }
  const device = item.deviceLabel || 'Device';
  const browser = item.runtimeLabel || item.browserLabel || 'Browser';
  const instance = (item.instanceIndex ?? 0) + 1;
  return `${host} · ${device} · ${browser} · #${instance}`;
}

function hasManualProxyV3(proxyMode: ProxyMode, generalProxy: QaProxyPolicy, devices: QaDeviceMatrixConfig): boolean {
  if (proxyMode === 'general') return generalProxy.source === 'manual';
  return [
    devices.desktop.enabled ? devices.desktop.proxy.source : 'none',
    devices.androidEmulation.enabled ? devices.androidEmulation.proxy.source : 'none',
    devices.iosEmulation.enabled ? devices.iosEmulation.proxy.source : 'none',
  ].includes('manual');
}

function hasRealIosV3(devices: QaDeviceMatrixConfig): boolean {
  return devices.realIos.enabled;
}

function poolOptionLabel(kind: 'rotating' | 'static', summary: ProxySummary): string {
  const live = kind === 'rotating' ? summary.rotatingLive : summary.staticLive;
  const slow = kind === 'rotating' ? summary.rotatingSlow : summary.staticSlow;
  const title = kind === 'rotating' ? 'Rotating pool' : 'Static pool';
  return `${title} · ${live} live${slow ? ` · ${slow} slow` : ''}`;
}


function deviceProfileChecks(report: DeviceIdentityReport) {
  return report.profileChecks ?? report.checks.filter((check) => check.classification !== 'host-runtime');
}

function deviceRuntimeFacts(report: DeviceIdentityReport) {
  return report.runtimeFacts ?? report.checks.filter((check) => check.classification === 'host-runtime');
}

function identityStatusLabel(status: string): string {
  return status.replace('-', ' ').toUpperCase();
}

function visibleDiagnosticChecks<T extends { key?: string; label?: string }>(checks: T[]): T[] {
  return checks.filter((check) => !['locale','timezone'].includes(String(check.key || '').toLowerCase()) && !/^(locale|timezone)$/i.test(String(check.label || '').trim()));
}

const MAX_RECENT_TERMINAL_WORK_STATES = 100;

function pruneWorkStates(states: Record<string, WorkState>): Record<string, WorkState> {
  const entries = Object.entries(states);
  const active = entries.filter(([, item]) => item.status === 'running' || item.status === 'queued');
  const terminal = entries.filter(([, item]) => item.status !== 'running' && item.status !== 'queued');
  const recentTerminal = terminal.slice(-MAX_RECENT_TERMINAL_WORK_STATES);
  return Object.fromEntries([...active, ...recentTerminal]);
}

function upsertBoundedWorkState(
  current: Record<string, WorkState>,
  workId: string,
  next: WorkState,
): Record<string, WorkState> {
  const reordered = { ...current };
  delete reordered[workId];
  reordered[workId] = next;
  return pruneWorkStates(reordered);
}

export function Run({ podId }: { podId?: string | null } = {}) {
  const [urlPoolText, setUrlPoolText] = useState('');
  const [devices, setDevices] = useState<QaDeviceMatrixConfig>(() => createDefaultDeviceMatrix());
  const [proxyMode, setProxyMode] = useState<ProxyMode>('general');
  const [generalProxy, setGeneralProxy] = useState<QaProxyPolicy>(() => createDefaultProxyPolicy());
  const [concurrency, setConcurrency] = useState<QaConcurrencySetting>({ mode: 'manual', value: 1 });
  const [executionMode, setExecutionMode] = useState<RunExecutionMode>('visible');
  const headless = false;
  const [interactionIndicator, setInteractionIndicator] = useState(true);
  const [captureScreenshots, setCaptureScreenshots] = useState(true);
  const [browserRuntimeConsistency, setBrowserRuntimeConsistency] = useState(false);
  const [autoQa, setAutoQa] = useState<AutoQaSettings>(() => createDefaultAutoQaSettings());
  const [steps, setSteps] = useState<QaStep[]>(() => createDefaultSteps());
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(createDefaultSteps(), null, 2));
  const [jsonError, setJsonError] = useState('');
  const [privacySettings, setPrivacySettings] = useState<PrivacyRunSettings>(() => createDefaultPrivacySettings());
  const [proxySummary, setProxySummary] = useState<ProxySummary>(EMPTY_PROXY_SUMMARY);
  const [mobileStatus, setMobileStatus] = useState<MobileStatus | null>(null);
  const [realIosConfig, setRealIosConfig] = useState<RealIosProviderPublicConfig | null>(null);
  const [realIosStatus, setRealIosStatus] = useState<RealIosProviderStatus | null>(null);
  const [chromeRuntimeFound, setChromeRuntimeFound] = useState<boolean | null>(null);
  const [braveRuntimeFound, setBraveRuntimeFound] = useState<boolean | null>(null);
  const [privacyDiagnostics, setPrivacyDiagnostics] = useState<PrivacyDiagnosticReport | null>(null);
  const [identityDiagnostics, setIdentityDiagnostics] = useState<DeviceIdentityReport | null>(null);
  const [sessionIntegrity, setSessionIntegrity] = useState<SessionIntegrityReport | null>(null);
  const [latestAdSummary, setLatestAdSummary] = useState<AdSummary | null>(null);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [logs, setLogs] = useState<QaEvent[]>([]);
  const [workStates, setWorkStates] = useState<Record<string, WorkState>>({});
  const [privacyRouteByWork, setPrivacyRouteByWork] = useState<Record<string, PrivacyRouteIntegrityReport>>({});
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [runMetrics, setRunMetrics] = useState<RunMetrics | null>(null);
  const [formError, setFormError] = useState('');
  const [createdMessage, setCreatedMessage] = useState('');
  const displayRunRef = useRef<string | null>(null);

  const totalWorkUnits = useMemo(() => countMatrixWorkUnitsV3(devices), [devices]);
  const manualProxyNeeded = useMemo(() => hasManualProxyV3(proxyMode, generalProxy, devices), [proxyMode, generalProxy, devices]);



  async function refreshProxySummary() {
    if (!window.orbitqa?.getProxySummary) return;
    try {
      const next = await window.orbitqa.getProxySummary();
      if (next) setProxySummary(next);
    } catch {
      // Proxy Manager can still be starting; backend allocation remains fail-closed.
    }
  }

  useEffect(() => {
    let cancelled = false;
    void refreshProxySummary();
    void window.orbitqa?.getMobileStatus?.().then((status) => { if (!cancelled) setMobileStatus(status); }).catch(() => undefined);
    const runtimeApi = window.orbitqa as (typeof window.orbitqa & { getBrowserRuntimeStatus?: () => Promise<{ found:boolean }> });
    void runtimeApi?.getBrowserRuntimeStatus?.().then((status:any) => { if (!cancelled) { setChromeRuntimeFound(status?.chromeFound === true || (status?.chromeFound == null && status?.found === true)); setBraveRuntimeFound(status?.braveFound === true); } }).catch(() => { if (!cancelled) { setChromeRuntimeFound(null); setBraveRuntimeFound(null); } });
    void window.orbitqa?.getRealIosProviderConfig?.().then(async (config) => {
      if (cancelled) return;
      setRealIosConfig(config ?? null);
      if (!config || !window.orbitqa?.checkRealIosProvider) return;
      try {
        const status = await window.orbitqa.checkRealIosProvider();
        if (!cancelled) setRealIosStatus(status);
      } catch {
        if (!cancelled) setRealIosStatus(null);
      }
    }).catch(() => undefined);
    const timer = window.setInterval(() => void refreshProxySummary(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const unsubscribe = window.orbitqa?.onQaEvent?.((event) => {
      if (displayRunRef.current && event.runId !== displayRunRef.current) return;
      if (event.type !== 'run-metrics') setLogs((current) => [...current, event].slice(-240));

      const nextStatus: Partial<Record<QaEvent['type'], WorkStatus>> = {
        'session-start': 'running',
        'session-complete': 'completed',
        'session-error': 'failed',
        'session-cancelled': 'cancelled',
        'session-incomplete': 'incomplete',
      };
      const status = nextStatus[event.type];
      if (status && event.workId) {
        setWorkStates((current) => {
          const previous = current[event.workId!];
          return upsertBoundedWorkState(current, event.workId!, {
            status,
            targetUrl: event.targetUrl || previous?.targetUrl || '',
            targetId: event.targetId || previous?.targetId,
            groupId: event.groupId || previous?.groupId,
            instanceIndex: event.instanceIndex ?? previous?.instanceIndex,
            deviceLabel: event.deviceLabel || previous?.deviceLabel,
            browserLabel: event.browserLabel || previous?.browserLabel,
            proxyIp: event.proxyIp || previous?.proxyIp,
            remainingSeconds: event.remainingSeconds ?? previous?.remainingSeconds,
          });
        });
      }

      if (event.type === 'privacy-route-integrity' && event.workId && event.privacyRouteIntegrity) {
        setPrivacyRouteByWork((current) => ({ ...current, [event.workId!]: event.privacyRouteIntegrity! }));
      }

      if (event.type === 'runtime-verification' && event.workId && event.runtimeVerification) {
        setWorkStates((current) => {
          const previous = current[event.workId!];
          if (!previous) return current;
          return upsertBoundedWorkState(current, event.workId!, { ...previous, runtimeLabel:event.runtimeVerification!.verificationLabel });
        });
      }

      if (event.type === 'privacy-diagnostics' && event.privacyDiagnostics) setPrivacyDiagnostics(event.privacyDiagnostics);
      if (event.type === 'identity-diagnostics' && event.identityDiagnostics) setIdentityDiagnostics(event.identityDiagnostics);
      if (event.type === 'session-integrity' && event.sessionIntegrity) setSessionIntegrity(event.sessionIntegrity);
      if (event.type === 'ad-summary' && event.adSummary) setLatestAdSummary(event.adSummary);
      if (event.type === 'run-metrics' && event.metrics) setRunMetrics(event.metrics);
      if (event.type === 'run-complete' && event.summary) {
        setSummary(event.summary as RunSummary);
        setRunMetrics({ requested: event.summary.requested ?? event.summary.total, running: event.summary.running ?? 0, queued: event.summary.queued ?? 0, completed: event.summary.completed, failed: event.summary.failed, cancelled: event.summary.cancelled ?? 0, incomplete: event.summary.incomplete ?? 0 });
        setRunning(false);
        setStopping(false);
        setRunId(null);
        void refreshProxySummary();
      }
      if (event.type === 'run-error') {
        setFormError(event.message || 'The QA run failed');
        setRunning(false);
        setStopping(false);
        setRunId(null);
      }
      if (event.type === 'run-cancelled') {
        setRunning(false);
        setStopping(false);
        setRunId(null);
        setRunMetrics((current) => current ? { ...current, running: 0, queued: 0 } : current);
        setWorkStates((current) => pruneWorkStates(Object.fromEntries(Object.entries(current).map(([key, item]) => [key, {
          ...item,
          status: ['completed', 'failed', 'incomplete'].includes(item.status) ? item.status : 'cancelled',
        }]))));
      }
    });
    return () => unsubscribe?.();
  }, []);

  function syncSteps(next: QaStep[]) {
    setSteps(next);
    if (mode === 'visual') setJsonDraft(JSON.stringify(next, null, 2));
  }

  function addStep(type: QaStep['type']) {
    syncSteps([...steps, createStep(type)]);
  }

  function removeStep(id: string) {
    syncSteps(steps.filter((step) => step.id !== id));
  }

  function updateStep(id: string, patch: Record<string, unknown>) {
    syncSteps(steps.map((step) => step.id === id ? ({ ...step, ...patch } as QaStep) : step));
  }

  function updateJson(value: string) {
    setJsonDraft(value);
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Script must be a JSON array of steps');
      setSteps(parsed as QaStep[]);
      setJsonError('');
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : 'Invalid JSON');
    }
  }

  async function startRun() {
    setFormError('');
    setSummary(null);
    setRunMetrics(null);
    setPrivacyDiagnostics(null);
    setIdentityDiagnostics(null);
    setSessionIntegrity(null);
    setLatestAdSummary(null);
    if (autoQa.behaviorMode === 'manual' && jsonError) {
      setFormError('Fix the Advanced JSON script before starting the run');
      return;
    }

    const manualNeeded = hasManualProxyV3(proxyMode, generalProxy, devices);
    const privacy: PrivacyRunSettings = {
      ...privacySettings,
      proxy: manualNeeded
        ? { ...privacySettings.proxy, enabled: true }
        : { ...privacySettings.proxy, enabled: false, server: '', username: '', password: '', requireVerifiedRoute: false },
    };
    if (manualNeeded) {
      const privacyValidation = validatePrivacySettings(privacy, 'desktop');
      if (!privacyValidation.ok && 'error' in privacyValidation) {
        setFormError(privacyValidation.error);
        return;
      }
    }
    if (autoQa.behaviorMode === 'manual' && hasRealIosV3(devices) && steps.some((step) => step.type === 'smart-interaction')) {
      setFormError('Smart QA Interaction is not available for Real iOS Device work units yet');
      return;
    }

    let request: QaRunRequestV3;
    try {
      request = normalizeQaRunRequestV3({
        version: 3,
        urlPoolText,
        runSeed: `run-${Date.now().toString(36)}`,
        devices,
        proxyMode,
        generalProxy,
        concurrency,
        headless,
        executionMode,
        captureScreenshots,
        browserRuntimeConsistency,
        interactionIndicator: !headless && interactionIndicator,
        autoQa,
        steps,
        privacy,
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Invalid URL pool or device matrix');
      return;
    }

    const createRun = window.orbitqa?.createQaRun ?? window.orbitqa?.startQaRun;
    if (!createRun) {
      setFormError('Desktop QA bridge is unavailable. Run this page inside OrbitQA Desktop.');
      return;
    }

    setUrlPoolText(request.urlPool.join('\n'));
    setDevices(request.devices);
    setProxyMode(request.proxyMode);
    setGeneralProxy(request.generalProxy);
    setAutoQa(request.autoQa);
    setRunMetrics({ requested: totalWorkUnits, running: 0, queued: totalWorkUnits, completed: 0, failed: 0, cancelled: 0, incomplete: 0 });
    setWorkStates({});
    setPrivacyRouteByWork({});
    setLogs([]);
    setStopping(false);
    setCreatedMessage('');
    try {
      const result = await createRun(request);
      displayRunRef.current = result.runId;
      setRunId(result.runId);
      setCreatedMessage(`Run ${result.runId} created. It is now managed independently in Run Center.`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    }
  }

  async function stopRun() {
    if (!runId || !window.orbitqa?.stopQaRun || stopping) return;
    setStopping(true);
    setFormError('');
    try {
      await window.orbitqa.stopQaRun(runId);
      setRunning(false);
      setRunId(null);
      setRunMetrics((current) => current ? { ...current, running: 0, queued: 0 } : current);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : String(error));
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="run-page">
      {podId && <div className="panel pod-run-handoff" role="status">Pod {podId} was passed from Pods. Configure the matching device family before starting this QA run.</div>}
      <section className="hero run-hero">
        <div>
          <span className="section-kicker">QA ENGINE · V0.12 URL POOL</span>
          <h2>URL pool device matrix</h2>
          <p>Paste a large URL pool once, select the device families you want, and let OrbitQA assign URLs from a shuffled deck to independent work units.</p>
        </div>
        <div className="engine-badges" aria-label="Installed browser engines"><span>Chromium</span><span>Firefox</span><span>WebKit</span></div>
      </section>

      <section className="run-workspace-grid">
        <div className="run-config-stack">
          <article className="panel run-panel">
            <div className="panel__header">
              <div><span className="section-kicker">TARGET URL POOL</span><h3>One pool for all selected devices</h3></div>
              <span className="status-pill status-pill--soft"><i /> {totalWorkUnits} WORK UNITS</span>
            </div>
            <UrlPoolEditor value={urlPoolText} onChange={setUrlPoolText} disabled={running} />
          </article>

          <article className="panel run-panel">
            <div className="panel__header"><div><span className="section-kicker">DEVICE MATRIX</span><h3>Select device families, browsers &amp; profiles</h3></div></div>
            <DeviceMatrixEditor
              value={devices}
              onChange={setDevices}
              androidAvds={mobileStatus?.avds || []}
              proxySummary={proxySummary}
              realIosConfig={realIosConfig}
              realIosStatus={realIosStatus}
              chromeRuntimeFound={chromeRuntimeFound}
              braveRuntimeFound={braveRuntimeFound}
              disabled={running}
            />
          </article>

          <article className="panel run-panel">
            <div className="panel__header"><div><span className="section-kicker">PROXY MODE</span><h3>One source for all compatible devices or per-device routing</h3></div></div>
            <div className="proxy-mode-picker" role="radiogroup" aria-label="Proxy mode">
              <label className="check-row"><input aria-label="Proxy mode General" type="radio" name="proxy-mode" value="general" checked={proxyMode === 'general'} onChange={() => setProxyMode('general')} disabled={running} /><span><strong>General</strong><small>Apply one proxy source to every compatible work unit.</small></span></label>
              <label className="check-row"><input aria-label="Proxy mode Per device" type="radio" name="proxy-mode" value="per-device" checked={proxyMode === 'per-device'} onChange={() => setProxyMode('per-device')} disabled={running} /><span><strong>Per device</strong><small>Choose a separate source for each selected compatible device family.</small></span></label>
            </div>
            {proxyMode === 'general' ? (
              <div className="form-grid matrix-run-settings proxy-mode-fields">
                <label className="field"><span>Proxy source</span><select aria-label="General proxy source" value={generalProxy.source} onChange={(event) => setGeneralProxy({ source: event.target.value as QaProxyPolicy['source'], allowSlowProxies: ['rotating', 'static', 'smart-mix'].includes(event.target.value) })} disabled={running}><option value="none">No proxy</option><option value="manual">Manual proxy</option><option value="rotating" disabled={(proxySummary.rotatingLive + proxySummary.rotatingSlow) === 0}>{poolOptionLabel('rotating', proxySummary)}</option><option value="static" disabled={(proxySummary.staticLive + proxySummary.staticSlow) === 0}>{poolOptionLabel('static', proxySummary)}</option><option value="smart-mix" disabled={(proxySummary.rotatingLive + proxySummary.rotatingSlow + proxySummary.staticLive + proxySummary.staticSlow) === 0}>Smart Mix · Rotating + Static</option></select></label>
                {(devices.androidAvd.enabled || devices.realIos.enabled) && <p className="editor-message field--full">Android AVD and Real iOS Provider do not support OrbitQA proxy routing; those work units remain direct and are shown as unavailable.</p>}
              </div>
            ) : (
              <div className="per-device-proxy-grid">
                {devices.desktop.enabled && <label className="field"><span>Desktop proxy source</span><select aria-label="Desktop proxy source" value={devices.desktop.proxy.source} onChange={(event) => setDevices((current) => ({ ...current, desktop: { ...current.desktop, proxy: { source: event.target.value as QaProxyPolicy['source'], allowSlowProxies: ['rotating', 'static', 'smart-mix'].includes(event.target.value) } } }))} disabled={running}><option value="none">No proxy</option><option value="manual">Manual proxy</option><option value="rotating" disabled={(proxySummary.rotatingLive + proxySummary.rotatingSlow) === 0}>{poolOptionLabel('rotating', proxySummary)}</option><option value="static" disabled={(proxySummary.staticLive + proxySummary.staticSlow) === 0}>{poolOptionLabel('static', proxySummary)}</option><option value="smart-mix" disabled={(proxySummary.rotatingLive + proxySummary.rotatingSlow + proxySummary.staticLive + proxySummary.staticSlow) === 0}>Smart Mix · Rotating + Static</option></select></label>}
                {devices.androidEmulation.enabled && <label className="field"><span>Android mobile proxy source</span><select aria-label="Android mobile proxy source" value={devices.androidEmulation.proxy.source} onChange={(event) => setDevices((current) => ({ ...current, androidEmulation: { ...current.androidEmulation, proxy: { source: event.target.value as QaProxyPolicy['source'], allowSlowProxies: ['rotating', 'static', 'smart-mix'].includes(event.target.value) } } }))} disabled={running}><option value="none">No proxy</option><option value="manual">Manual proxy</option><option value="rotating" disabled={(proxySummary.rotatingLive + proxySummary.rotatingSlow) === 0}>{poolOptionLabel('rotating', proxySummary)}</option><option value="static" disabled={(proxySummary.staticLive + proxySummary.staticSlow) === 0}>{poolOptionLabel('static', proxySummary)}</option><option value="smart-mix" disabled={(proxySummary.rotatingLive + proxySummary.rotatingSlow + proxySummary.staticLive + proxySummary.staticSlow) === 0}>Smart Mix · Rotating + Static</option></select></label>}
                {devices.iosEmulation.enabled && <label className="field"><span>Local iOS proxy source</span><select aria-label="Local iOS proxy source" value={devices.iosEmulation.proxy.source} onChange={(event) => setDevices((current) => ({ ...current, iosEmulation: { ...current.iosEmulation, proxy: { source: event.target.value as QaProxyPolicy['source'], allowSlowProxies: ['rotating', 'static', 'smart-mix'].includes(event.target.value) } } }))} disabled={running}><option value="none">No proxy</option><option value="manual">Manual proxy</option><option value="rotating" disabled={(proxySummary.rotatingLive + proxySummary.rotatingSlow) === 0}>{poolOptionLabel('rotating', proxySummary)}</option><option value="static" disabled={(proxySummary.staticLive + proxySummary.staticSlow) === 0}>{poolOptionLabel('static', proxySummary)}</option><option value="smart-mix" disabled={(proxySummary.rotatingLive + proxySummary.rotatingSlow + proxySummary.staticLive + proxySummary.staticSlow) === 0}>Smart Mix · Rotating + Static</option></select></label>}
                {(devices.androidAvd.enabled || devices.realIos.enabled) && <p className="editor-message">Proxy source: Not available for Android AVD / Real iOS Provider.</p>}
              </div>
            )}
          </article>

          <article className="panel run-panel">
            <div className="panel__header"><div><span className="section-kicker">RUN-WIDE SETTINGS</span><h3>Concurrency, privacy &amp; operator view</h3></div></div>
            <div className="form-grid matrix-run-settings">
              <label className="field">
                <span>Concurrency mode</span>
                <select aria-label="Concurrency mode" value={concurrency.mode} onChange={(event) => setConcurrency(event.target.value === 'auto' ? { mode: 'auto' } : { mode: 'manual', value: concurrency.mode === 'manual' ? concurrency.value : 1 })} disabled={running}>
                  <option value="auto">Auto</option>
                  <option value="manual">Manual</option>
                </select>
                <small>Auto sizes the active worker count from current CPU and memory capacity.</small>
              </label>
              {concurrency.mode === 'manual' && (
                <label className="field">
                  <span>Manual concurrency</span>
                  <input aria-label="Concurrency" type="number" min="1" value={concurrency.value} onChange={(event) => setConcurrency({ mode: 'manual', value: Number(event.target.value) })} disabled={running} />
                  <small>Manual mode honors the concurrency number you enter. Browser startups are ramped in parallel to reduce launch spikes while active work fills the requested slots.</small>
                </label>
              )}

              <label className="field">
                <span>Execution mode</span>
                <select aria-label="Execution mode" value={executionMode} onChange={(event) => { const next = event.target.value as RunExecutionMode; setExecutionMode(next); if (next === 'background') setInteractionIndicator(false); }} disabled={running}>
                  <option value="visible">Visible Desktop Activity</option>
                  <option value="background">Background Activity</option>
                </select>
                <small>Visible opens browser windows. Background runs the same QA engine without showing browser windows.</small>
              </label>

              <label className="toggle-row">
                <input
                  aria-label="Show interaction pointer"
                  type="checkbox"
                  checked={!headless && interactionIndicator}
                  onChange={(event) => setInteractionIndicator(event.target.checked)}
                  disabled={running || headless}
                />
                <span><strong>Show interaction pointer</strong><small>Desktop cursor / mobile touch marker. Visual only; it never intercepts page input.</small></span>
              </label>

              <label className="toggle-row">
                <input
                  aria-label="Capture screenshots"
                  type="checkbox"
                  checked={captureScreenshots}
                  onChange={(event) => setCaptureScreenshots(event.target.checked)}
                  disabled={running}
                />
                <span><strong>Capture screenshots</strong><small>Save QA evidence screenshots for this run. Disable to reduce disk use and screenshot overhead.</small></span>
              </label>

              <label className="toggle-row">
                <input
                  aria-label="Browser runtime consistency"
                  type="checkbox"
                  checked={browserRuntimeConsistency}
                  onChange={(event) => setBrowserRuntimeConsistency(event.target.checked)}
                  disabled={running}
                />
                <span><strong>Browser runtime consistency</strong><small>Optional. Uses secure Chromium sandboxing and aligns Android Chrome version metadata with the browser that actually launched. It does not hide automation signals or rewrite browser APIs.</small></span>
              </label>

              <label className="toggle-row">
                <input aria-label="Strict Privacy Mode" type="checkbox" checked={privacySettings.strictMode} onChange={(event) => setPrivacySettings((current) => ({ ...current, strictMode: event.target.checked }))} disabled={running} />
                <span><strong>Strict Privacy Mode</strong><small>Fail closed on required privacy/network checks.</small></span>
              </label>
            </div>

            {manualProxyNeeded && (
              <div className="manual-proxy-box">
                <div className="mobile-mode-note proxy-pool-note"><strong>Manual proxy credentials</strong><span>Only work units whose group selects Manual proxy use these run-wide credentials. Credentials are not copied into target cards.</span></div>
                <div className="form-grid">
                  <label className="field field--full"><span>Proxy server</span><input aria-label="Proxy server" value={privacySettings.proxy.server} onChange={(event) => setPrivacySettings((current) => ({ ...current, proxy: { ...current.proxy, server: event.target.value } }))} placeholder="http://proxy.example:8080" disabled={running} /></label>
                  <label className="field"><span>Proxy username</span><input aria-label="Proxy username" value={privacySettings.proxy.username} onChange={(event) => setPrivacySettings((current) => ({ ...current, proxy: { ...current.proxy, username: event.target.value } }))} autoComplete="off" disabled={running} /></label>
                  <label className="field"><span>Proxy password</span><input aria-label="Proxy password" type="password" value={privacySettings.proxy.password} onChange={(event) => setPrivacySettings((current) => ({ ...current, proxy: { ...current.proxy, password: event.target.value } }))} autoComplete="new-password" disabled={running} /></label>
                  <label className="toggle-row"><input aria-label="Require verified proxy route" type="checkbox" checked={privacySettings.proxy.requireVerifiedRoute} onChange={(event) => setPrivacySettings((current) => ({ ...current, proxy: { ...current.proxy, requireVerifiedRoute: event.target.checked } }))} disabled={running} /><span><strong>Require verified route</strong><small>Block manual-proxy work if its observed route cannot be verified.</small></span></label>
                </div>
              </div>
            )}
          </article>

          <article className="panel run-panel auto-qa-panel">
            <div className="panel__header">
              <div><span className="section-kicker">BEHAVIOR MODE</span><h3>Adaptive QA behavior</h3></div>
              <span className={`status-pill ${autoQa.behaviorMode === 'auto' ? 'status-pill--soft' : ''}`}><i /> {autoQa.behaviorMode === 'auto' ? 'AUTO QA' : 'MANUAL'}</span>
            </div>

            <fieldset className="behavior-fieldset" disabled={running}>
              <div className="form-grid auto-qa-settings">
                <label className="field">
                  <span>Behavior Mode</span>
                  <select aria-label="Behavior Mode" value={autoQa.behaviorMode} onChange={(event) => setAutoQa((current) => ({ ...current, behaviorMode: event.target.value === 'manual' ? 'manual' : 'auto' }))}>
                    <option value="auto">Auto QA</option>
                    <option value="manual">Manual Script (Advanced)</option>
                  </select>
                  <small>Auto QA inspects each page before choosing safe, site-appropriate actions.</small>
                </label>

                {autoQa.behaviorMode === 'auto' && (
                  <>
                    <label className="field">
                      <span>Reading Pace</span>
                      <select aria-label="Reading Pace" value={autoQa.readingPace} onChange={(event) => setAutoQa((current) => ({ ...current, readingPace: event.target.value as AutoQaSettings['readingPace'] }))}>
                        <option value="natural">Natural</option>
                        <option value="slow">Slow</option>
                        <option value="fast">Fast QA</option>
                      </select>
                      <small>Natural uses gentle reading scrolls and short observation pauses.</small>
                    </label>

                    <label className="field">
                      <span>Referrer QA</span>
                      <select aria-label="Referrer QA" value={autoQa.referrerMode} onChange={(event) => setAutoQa((current) => ({ ...current, referrerMode: event.target.value as AutoQaSettings['referrerMode'] }))}>
                        <option value="direct">Direct</option>
                        <option value="google-simulated">Google Search · SIMULATED QA</option>
                        <option value="facebook-simulated">Simulated Facebook · SIMULATED</option>
                        <option value="pinterest-simulated">Simulated Pinterest · SIMULATED</option>
                        <option value="custom-simulated">Custom referrer · SIMULATED</option>
                        <option value="site-referral">Site Referral QA</option>
                      </select>
                      <small>Direct can either navigate normally every time or, when Auto Type is enabled, randomly switch between normal Direct and slow human-paced typing inside that exact worker browser/profile. Google Search opens Google first, searches the exact Target URL, scrolls the results until it finds that target, and clicks through before the task begins.</small>
                    </label>

                    {autoQa.referrerMode === 'direct' && (
                      <label className="field">
                        <span>Direct Auto Type</span>
                        <select aria-label="Direct Auto Type" value={autoQa.directAutoType ? 'yes' : 'no'} onChange={(event) => setAutoQa((current) => ({ ...current, directAutoType: event.target.value === 'yes' }))}>
                          <option value="no">No · always visit target directly</option>
                          <option value="yes">Yes · randomly use Direct or real address-bar typing</option>
                        </select>
                        <small>Typed entry uses the real address bar of the exact worker browser window. OrbitQA verifies that worker window before every character and falls back to normal Direct navigation if focus is unsafe.</small>
                      </label>
                    )}

                    {autoQa.referrerMode === 'custom-simulated' && (
                      <label className="field field--full">
                        <span>Custom referrer</span>
                        <input aria-label="Custom referrer" type="url" placeholder="https://referrer.example/" value={autoQa.customReferrer || ''} onChange={(event) => setAutoQa((current) => ({ ...current, customReferrer: event.target.value }))} />
                        <small>HTTPS only. The value is clearly treated as simulated QA input.</small>
                      </label>
                    )}

                    {autoQa.referrerMode === 'site-referral' && (
                      <label className="field field--full">
                        <span>Referral target (optional)</span>
                        <input aria-label="Referral target" type="text" placeholder="Exact destination URL or visible link/button text" value={autoQa.siteReferralTarget || ''} onChange={(event) => setAutoQa((current) => ({ ...current, siteReferralTarget: event.target.value }))} />
                        <small>The main Target URL is treated as the referral page. If this is blank, OrbitQA selects a safe outbound linked control. The active session timer starts only after the destination page is reached.</small>
                      </label>
                    )}

                    <label className="toggle-row">
                      <input aria-label="Safe form actions" type="checkbox" checked={autoQa.safeFormActions} onChange={(event) => setAutoQa((current) => ({ ...current, safeFormActions: event.target.checked }))} />
                      <span><strong>Safe form actions</strong><small>Allows ordinary QA text/search/tool fields while blocking credentials, payments, account changes, and destructive actions.</small></span>
                    </label>

                    <label className="toggle-row">
                      <input aria-label="Observe new tabs" type="checkbox" checked={autoQa.observeNewTabs} onChange={(event) => setAutoQa((current) => ({ ...current, observeNewTabs: event.target.checked }))} />
                      <span><strong>Observe new tabs</strong><small>Safe auxiliary pages can settle briefly before OrbitQA returns to the primary target. Ad-like tabs are logged and not interacted with.</small></span>
                    </label>
                  </>
                )}
              </div>

              {autoQa.behaviorMode === 'auto' ? (
                <div className="auto-qa-safety-note">
                  <strong>Automatic page-aware QA</strong>
                  <span>OrbitQA classifies the page, browses at the selected pace, uses visible pointer/touch feedback, handles safe blockers, and chooses only low-risk interactions. Ads, sponsored controls, CAPTCHA/human verification, payment/account actions, and other consequential controls are detected and skipped.</span>
                </div>
              ) : (
                <div className="manual-script-advanced">
                  <div className="panel__header panel__header--tabs manual-script-header">
                    <div><span className="section-kicker">MANUAL SCRIPT · ADVANCED</span><h3>Reusable actions for every work unit</h3></div>
                    <div className="segmented-control" aria-label="Script editor mode">
                      <button type="button" className={mode === 'visual' ? 'active' : ''} onClick={() => { setMode('visual'); setJsonError(''); }}>Visual</button>
                      <button type="button" className={mode === 'json' ? 'active' : ''} onClick={() => { setMode('json'); setJsonDraft(JSON.stringify(steps, null, 2)); setJsonError(''); }}>Advanced JSON</button>
                    </div>
                  </div>

                  {mode === 'visual' ? (
                    <>
                      <div className="step-list">
                        {steps.map((step, index) => (
                          <div className="step-card" key={step.id}>
                            <div className="step-card__index">{index + 1}</div>
                            <div className="step-card__body">
                              <strong>{stepTitle(step)}</strong>
                              {step.type === 'wait' && <label><span>Seconds</span><input aria-label="Wait seconds" type="number" min="0" max="30" step="0.1" value={Number((step.ms / 1000).toFixed(3))} onChange={(event) => updateStep(step.id, { ms: Math.round(Number(event.target.value) * 1000) })} /></label>}
                              {step.type === 'scroll' && <div className="step-inline-fields"><label><span>Direction</span><select value={step.direction} onChange={(event) => updateStep(step.id, { direction: event.target.value })}><option value="down">Down</option><option value="up">Up</option></select></label><label><span>Pixels</span><input type="number" min="0" max="10000" value={step.distance} onChange={(event) => updateStep(step.id, { distance: Number(event.target.value) })} /></label></div>}
                              {step.type === 'click' && <label><span>Selector</span><input type="text" value={step.selector} onChange={(event) => updateStep(step.id, { selector: event.target.value })} /></label>}
                              {step.type === 'type' && <div className="step-inline-fields"><label><span>Selector</span><input type="text" value={step.selector} onChange={(event) => updateStep(step.id, { selector: event.target.value })} /></label><label><span>Text</span><input type="text" value={step.value} onChange={(event) => updateStep(step.id, { value: event.target.value })} /></label></div>}
                              {step.type === 'screenshot' && <label className="check-row"><input type="checkbox" checked={step.fullPage} onChange={(event) => updateStep(step.id, { fullPage: event.target.checked })} /><span>Capture full page</span></label>}
                              {step.type === 'smart-interaction' && <div className="smart-interaction-fields"><p className="step-help">Discovers the real scroll surface, repeatedly resolves safe blockers, browses down and back up, then types/clicks a safe contextual website action when available.</p><label><span>Interaction text</span><input aria-label="Smart interaction text" value={step.value} maxLength={500} onChange={(event) => updateStep(step.id, { value: event.target.value })} /></label></div>}
                            </div>
                            <button className="step-remove" type="button" aria-label={`Remove ${stepTitle(step)} step`} onClick={() => removeStep(step.id)}>×</button>
                          </div>
                        ))}
                      </div>
                      <div className="step-toolbar">
                        <button type="button" onClick={() => addStep('wait')} aria-label="Add wait step">+ Wait</button>
                        <button type="button" onClick={() => addStep('scroll')} aria-label="Add scroll step">+ Scroll</button>
                        <button type="button" onClick={() => addStep('click')} aria-label="Add click step">+ Click</button>
                        <button type="button" onClick={() => addStep('type')} aria-label="Add type step">+ Type</button>
                        <button type="button" onClick={() => addStep('screenshot')} aria-label="Add screenshot step">+ Screenshot</button>
                        <button type="button" onClick={() => addStep('smart-interaction')} aria-label="Add smart interaction step">+ Smart Interaction</button>
                      </div>
                    </>
                  ) : (
                    <div className="json-editor-wrap"><textarea aria-label="Advanced JSON run script" value={jsonDraft} onChange={(event) => updateJson(event.target.value)} spellCheck={false} /><p className={jsonError ? 'editor-message editor-message--error' : 'editor-message'}>{jsonError || 'The last valid JSON array is used by the runner.'}</p></div>
                  )}
                </div>
              )}
            </fieldset>

            {createdMessage && <div className="editor-message run-created-message" role="status">{createdMessage}</div>}
            {formError && <div className="run-error" role="alert">{formError}</div>}
            {running ? (
              <button className="danger-button start-run-button stop-run-button" type="button" aria-label="Stop run" onClick={stopRun} disabled={stopping || !runId}>{stopping ? 'STOPPING RUN…' : 'STOP RUN'}</button>
            ) : (
              <button className="primary-button start-run-button" type="button" aria-label="Start run" onClick={startRun}>START RUN</button>
            )}
          </article>
        </div>

        <aside className="run-console-stack">
          <article className="panel run-overview-panel">
            <div className="panel__header"><div><span className="section-kicker">LATEST CREATED RUN</span><h3>{runId ? 'Managed in Run Center' : 'Waiting for a run'}</h3></div><span className={runId ? 'run-state run-state--running' : 'run-state'}>{runId ? 'RUN CENTER' : 'READY'}</span></div>
            <div className="run-stat-grid">
              <div><span>Requested</span><strong>{runMetrics?.requested ?? summary?.requested ?? totalWorkUnits}</strong></div>
              <div><span>Running</span><strong>{runMetrics?.running ?? 0}</strong></div>
              <div><span>Queued</span><strong>{runMetrics?.queued ?? (running ? totalWorkUnits : 0)}</strong></div>
              <div><span>Completed</span><strong>{runMetrics?.completed ?? summary?.completed ?? 0}</strong></div>
              <div><span>Failed</span><strong>{runMetrics?.failed ?? summary?.failed ?? 0}</strong></div>
              <div><span>Cancelled</span><strong>{runMetrics?.cancelled ?? summary?.cancelled ?? 0}</strong></div>
              <div><span>Incomplete</span><strong>{runMetrics?.incomplete ?? summary?.incomplete ?? 0}</strong></div>
            </div>
            {latestAdSummary && <div className="ad-summary-card" aria-label="Ad observation summary">
              <div className="ad-summary-header"><span>ADS OBSERVED</span><strong>{latestAdSummary.status === 'pass' ? 'PASS' : latestAdSummary.status === 'partial' ? 'PARTIAL' : 'NONE'}</strong></div>
              {latestAdSummary.total === 0 ? <p className="ad-summary-empty">No visible ads detected</p> : <>
                <div className="ad-summary-row"><span>Total seen</span><strong>{latestAdSummary.total}</strong></div>
                <div className="ad-summary-row"><span>Observed</span><strong>{latestAdSummary.observed}</strong></div>
                {latestAdSummary.byType.banner > 0 && <div className="ad-summary-row"><span>Banner</span><strong>{latestAdSummary.byType.banner}</strong></div>}
                {latestAdSummary.byType.stickyAnchor > 0 && <div className="ad-summary-row"><span>Sticky / Anchor</span><strong>{latestAdSummary.byType.stickyAnchor}</strong></div>}
                {latestAdSummary.byType.interstitialVignette > 0 && <div className="ad-summary-row"><span>Interstitial / Vignette</span><strong>{latestAdSummary.byType.interstitialVignette}</strong></div>}
                {latestAdSummary.byType.nativeSponsored > 0 && <div className="ad-summary-row"><span>Native / Sponsored</span><strong>{latestAdSummary.byType.nativeSponsored}</strong></div>}
                {latestAdSummary.byType.iframeNetwork > 0 && <div className="ad-summary-row"><span>Iframe / Network</span><strong>{latestAdSummary.byType.iframeNetwork}</strong></div>}
                {latestAdSummary.byType.unknownAd > 0 && <div className="ad-summary-row"><span>Unknown format</span><strong>{latestAdSummary.byType.unknownAd}</strong></div>}
              </>}
            </div>}
            <div className="run-meta"><span>Run ID</span><code>{runId || 'Not started'}</code>{summary && <><span>Duration</span><code>{(summary.durationMs / 1000).toFixed(1)} s</code></>}</div>
          </article>

          <article className="panel session-panel">
            <div className="panel__header"><div><span className="section-kicker">WORK UNITS</span><h3>Independent queue</h3></div></div>
            <div className="session-list matrix-session-list">
              {Object.keys(workStates).length === 0 ? <div className="empty-state">No active or recently observed work units.</div> : Object.entries(workStates).map(([id, item]) => (
                <div key={id} className="matrix-session-row">
                  <span><i className={`session-dot session-dot--${item.status}`} />{workLabel(item)}</span>
                  <div className="matrix-session-meta">{privacyRouteByWork[id] && <small className={`privacy-route-token privacy-route-token--${privacyRouteByWork[id].overallStatus}`}>{privacyRouteByWork[id].overallStatus === 'pass' ? 'PRIVACY PASS' : privacyRouteByWork[id].overallStatus === 'fail' ? 'PRIVACY FAIL' : 'NOT VERIFIED'}</small>}{item.proxyIp && <small>{item.proxyIp}</small>}{item.remainingSeconds !== undefined && <small>{item.remainingSeconds}s</small>}<span aria-hidden="true">·</span><strong>{item.status}</strong></div>
                </div>
              ))}
            </div>
          </article>

          {identityDiagnostics && (
            <article className="panel privacy-panel identity-panel">
              <div className="panel__header"><div><span className="section-kicker">LATEST DEVICE CONSISTENCY</span><h3>Device Identity Check</h3></div><span className={`privacy-overall privacy-overall--${identityDiagnostics.profileConsistency ?? identityDiagnostics.overall}`}>{(identityDiagnostics.profileConsistency ?? identityDiagnostics.overall).toUpperCase()}</span></div>
              <div className="identity-meta"><span>Mode <strong>{identityDiagnostics.mode}</strong></span><span>Profile <strong>{identityDiagnostics.profile}</strong></span>{identityDiagnostics.workerGeo?.countryCode && <span>Proxy geo <strong>{[identityDiagnostics.workerGeo.city, identityDiagnostics.workerGeo.region, identityDiagnostics.workerGeo.countryCode].filter(Boolean).join(', ')}</strong></span>}{identityDiagnostics.workerGeo?.timezoneId && <span>Timezone <strong>{identityDiagnostics.workerGeo.timezoneId}</strong></span>}{identityDiagnostics.workerGeo?.locale && <span>Locale <strong>{identityDiagnostics.workerGeo.locale}</strong></span>}</div>
              {identityDiagnostics.fidelity && <div className={`identity-fidelity identity-fidelity--${identityDiagnostics.fidelity.level}`}><div><span>Runtime fidelity</span><strong>{identityDiagnostics.fidelity.label}</strong></div><p>{identityDiagnostics.fidelity.description}</p>{identityDiagnostics.fidelity.limitations.length > 0 && <small>{identityDiagnostics.fidelity.limitations.join(' · ')}</small>}</div>}
              {identityDiagnostics.blocked && <div className="privacy-blocked"><strong>Device profile consistency blocked this work unit</strong><span>{identityDiagnostics.blockingReasons.join(', ')}</span></div>}
              <div className="identity-context-note"><strong>Profile Consistency</strong> checks the device/browser properties OrbitQA can truthfully configure and verify.</div>
              <div className="privacy-check-list">{visibleDiagnosticChecks(deviceProfileChecks(identityDiagnostics)).map((check) => <div className="privacy-check-row" key={check.key}><span>{check.label}</span><strong className={`privacy-status privacy-status--${check.status}`}>{identityStatusLabel(check.status)}</strong><small>{check.observed || check.detail || ''}{check.detail && check.observed ? ` · ${check.detail}` : ''}</small></div>)}</div>
              {identityDiagnostics.mode === 'ios-emulation' && <><div className="identity-context-note"><strong>Functional Compatibility</strong> verifies that the local WebKit context can perform the mobile interaction OrbitQA actually uses.</div><div className="privacy-check-list"><div className="privacy-check-row"><span>iOS Functional Compatibility</span><strong className={`privacy-status privacy-status--${identityDiagnostics.functionalCompatibility?.iosTap ?? 'not-applicable'}`}>{identityStatusLabel(identityDiagnostics.functionalCompatibility?.iosTap ?? 'not-applicable')}</strong><small>Active tap verification in the same work-unit browser context.</small></div><div className="privacy-check-row"><span>Physical iPhone Fidelity</span><strong className="privacy-status privacy-status--not-applicable">NOT APPLICABLE</strong><small>Local iOS Compatibility is WebKit compatibility checking on Windows; physical-device fidelity is provided only by the Real iOS Provider path.</small></div></div></>}
              {identityDiagnostics.graphicsStability && <><div className="identity-context-note"><strong>Canvas / WebGL Stability</strong> measures the browser-native graphics environment for consistency. OrbitQA does not add random fingerprint noise.</div><div className="privacy-check-list"><div className="privacy-check-row"><span>Canvas stability</span><strong className={`privacy-status privacy-status--${identityDiagnostics.graphicsStability.canvas.status}`}>{identityStatusLabel(identityDiagnostics.graphicsStability.canvas.status)}</strong><small>{identityDiagnostics.graphicsStability.canvas.stable === null ? 'Not available' : identityDiagnostics.graphicsStability.canvas.stable ? 'Native Canvas signature remained stable' : 'Canvas signature changed during this worker session'}</small></div><div className="privacy-check-row"><span>WebGL stability</span><strong className={`privacy-status privacy-status--${identityDiagnostics.graphicsStability.webgl.status}`}>{identityStatusLabel(identityDiagnostics.graphicsStability.webgl.status)}</strong><small>{identityDiagnostics.graphicsStability.webgl.stable === null ? 'Not available' : identityDiagnostics.graphicsStability.webgl.stable ? 'Native WebGL signature remained stable' : 'WebGL signature changed during this worker session'}</small></div></div></>}
              {deviceRuntimeFacts(identityDiagnostics).length > 0 && <><div className="identity-context-note"><strong>Host / Runtime Information</strong> is reported for transparency and does not count as a device-profile failure.</div><div className="privacy-check-list">{visibleDiagnosticChecks(deviceRuntimeFacts(identityDiagnostics)).map((check) => <div className="privacy-check-row" key={`runtime-${check.key}`}><span>{check.label}</span><strong className="privacy-status privacy-status--not-applicable">HOST INFO</strong><small>{check.observed || check.detail || ''}{check.detail && check.observed ? ` · ${check.detail}` : ''}</small></div>)}</div></>}
            </article>
          )}

          {sessionIntegrity && (
            <article className="panel privacy-panel integrity-panel">
              <div className="panel__header"><div><span className="section-kicker">LATEST SESSION INTEGRITY</span><h3>Session &amp; Network Integrity</h3></div><span className={`privacy-overall privacy-overall--${sessionIntegrity.overall}`}>{sessionIntegrity.verdict.toUpperCase()}</span></div>
              {sessionIntegrity.blocked && <div className="privacy-blocked"><strong>Session &amp; Network Integrity blocked this work unit</strong><span>{sessionIntegrity.blockingReasons.join(', ')}</span></div>}
              <div className="identity-meta"><span>Proxy <strong>{sessionIntegrity.proxySource}</strong></span><span>Initial exit <strong>{sessionIntegrity.observed.initialExitIp || 'n/a'}</strong></span><span>Final exit <strong>{sessionIntegrity.observed.finalExitIp || 'n/a'}</strong></span></div>
              <div className="privacy-check-list">{visibleDiagnosticChecks(sessionIntegrity.checks).map((check) => <div className="privacy-check-row" key={check.key}><span>{check.label}</span><strong className={`privacy-status privacy-status--${check.status}`}>{check.status.replace('-', ' ').toUpperCase()}</strong><small>{check.observed || check.detail || ''}{check.detail && check.observed ? ` · ${check.detail}` : ''}</small></div>)}</div>
            </article>
          )}

          {privacyDiagnostics && (
            <article className="panel privacy-panel">
              <div className="panel__header"><div><span className="section-kicker">LATEST PRIVACY BASELINE</span><h3>Privacy &amp; Network Check</h3></div><span className={`privacy-overall privacy-overall--${privacyDiagnostics.overall}`}>{privacyDiagnostics.overall.toUpperCase()}</span></div>
              {privacyDiagnostics.blocked && <div className="privacy-blocked"><strong>Strict Privacy Mode blocked this work unit</strong><span>{privacyDiagnostics.blockingReasons.join(', ')}</span></div>}
              <div className="privacy-check-list">{visibleDiagnosticChecks(privacyDiagnostics.checks).map((check) => <div className="privacy-check-row" key={check.key}><span>{check.label}</span><strong className={`privacy-status privacy-status--${check.status}`}>{check.status.replace('-', ' ').toUpperCase()}</strong><small>{check.observed || check.detail || ''}</small></div>)}</div>
            </article>
          )}

          <article className="panel live-log-panel">
            <div className="panel__header"><div><span className="section-kicker">ACTIVITY LOG</span><h3>Per-work-unit engine output</h3></div><button className="text-button" type="button" onClick={() => setLogs([])}>Clear</button></div>
            <div className="live-log" aria-live="polite">
              {logs.length === 0 ? <div className="empty-state">Run events will appear here.</div> : logs.map((event, index) => (
                <div className="log-line" key={`${event.timestamp}-${index}`}><time>{formatTime(event.timestamp)}</time><span title={event.workId || 'Run-level event'}>{activityWorkLabel(event)}</span><p>{event.message || event.type}</p></div>
              ))}
            </div>
          </article>
        </aside>
      </section>
    </div>
  );
}
