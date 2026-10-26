import { useEffect, useState } from 'react';
import { MetricCard } from '../components/MetricCard';

export function Dashboard() {
  const [runs, setRuns] = useState<any[]>([]);
  const [totalProfiles, setTotalProfiles] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const [nextRuns, profiles] = await Promise.all([window.orbitqa?.listQaRuns?.() ?? [], window.orbitqa?.listPodProfiles?.() ?? []]);
        if (!cancelled) { setRuns(nextRuns); setTotalProfiles(profiles.length); }
      } catch { /* Keep the latest successful dashboard metrics. */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  const terminal = runs.filter((run) => ['COMPLETED', 'FAILED', 'STOPPED'].includes(run.status));
  const successRate = terminal.length ? `${Math.round((terminal.filter((run) => run.status === 'COMPLETED').length / terminal.length) * 100)}%` : '—';
  return (
    <div className="dashboard-page">
      <section className="hero">
        <div>
          <span className="section-kicker">OVERVIEW</span>
          <h2>Website QA command center</h2>
          <p>Run controlled cross-browser checks, inspect results, and keep your workload lightweight.</p>
        </div>
        <button className="primary-button" type="button">+ New Run</button>
      </section>

      <section className="metrics-grid" aria-label="QA metrics">
        <MetricCard label="TOTAL RUNS" value={String(runs.length)} hint={runs.length ? 'Saved run history' : 'No saved runs yet'} tone="violet" />
        <MetricCard label="RUNNING" value={String(runs.filter((run) => ['CREATED','STARTING','RUNNING','PAUSING','RESUMING','STOPPING'].includes(run.status)).length)} hint="Active QA work" tone="cyan" />
        <MetricCard label="FINISHED" value={String(terminal.length)} hint="Completed, failed or stopped" tone="green" />
        <MetricCard label="POD PROFILES" value={String(totalProfiles)} hint="Profiles across all pods" tone="violet" />
        <MetricCard label="SUCCESS RATE" value={successRate} hint="Completed / terminal runs" tone="amber" />
      </section>

      <section className="dashboard-grid">
        <article className="panel panel--health">
          <div className="panel__header">
            <div>
              <span className="section-kicker">SYSTEM HEALTH</span>
              <h3>Ready when you are</h3>
            </div>
            <span className="status-pill status-pill--soft"><i /> HEALTHY</span>
          </div>
          <div className="health-list">
            <div><span><i className="health-dot health-dot--green" /> Desktop shell</span><strong>Online</strong></div>
            <div><span><i className="health-dot health-dot--green" /> Local workspace</span><strong>Ready</strong></div>
            <div><span><i className="health-dot health-dot--muted" /> Browser engines</span><strong>Idle</strong></div>
            <div><span><i className="health-dot health-dot--muted" /> Job queue</span><strong>0 waiting</strong></div>
          </div>
        </article>

        <article className="panel">
          <div className="panel__header">
            <div>
              <span className="section-kicker">ENGINE POLICY</span>
              <h3>Lightweight by default</h3>
            </div>
          </div>
          <div className="resource-card">
            <span>Default concurrency</span>
            <strong>3 sessions</strong>
            <div className="resource-bar"><span style={{ width: '38%' }} /></div>
            <small>Extra sessions will queue instead of flooding your PC.</small>
          </div>
        </article>

        <article className="panel panel--wide">
          <div className="panel__header">
            <div>
              <span className="section-kicker">ACTIVITY</span>
              <h3>Recent events</h3>
            </div>
            <button className="text-button" type="button">Clear</button>
          </div>
          <div className="activity-feed">
            <div><time>NOW</time><span className="activity-icon">✓</span><p><strong>OrbitQA initialized</strong><small>Local control panel is ready.</small></p></div>
            <div><time>NOW</time><span className="activity-icon activity-icon--muted">•</span><p><strong>No browser processes running</strong><small>Engines launch only when a run starts.</small></p></div>
            <div><time>NOW</time><span className="activity-icon activity-icon--muted">•</span><p><strong>Local-first workspace</strong><small>No sign-in or cloud connection required.</small></p></div>
          </div>
        </article>
      </section>
    </div>
  );
}
