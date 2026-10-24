import { useEffect, useState } from 'react';
import { MetricCard } from '../components/MetricCard';
import type { RunSummary } from '../shared/runCenter';

export function Dashboard() {
  const [totalRuns, setTotalRuns] = useState(0);
  const [running, setRunning] = useState(0);
  const [completed, setCompleted] = useState(0);
  const [successRate, setSuccessRate] = useState('—');
  const [totalProxies, setTotalProxies] = useState(0);
  const [totalCookies, setTotalCookies] = useState(0);
  const [totalStreamingAccounts, setTotalStreamingAccounts] = useState(0);
  const [totalSocialAccounts, setTotalSocialAccounts] = useState(0);
  const [totalProfiles, setTotalProfiles] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [runs, proxies, cookies, streamingAccounts, socialAccounts] = await Promise.all([
          window.orbitqa?.listQaRuns?.() ?? Promise.resolve([] as RunSummary[]),
          window.orbitqa?.listProxies?.() ?? Promise.resolve([]),
          window.orbitqa?.listQaCookies?.() ?? Promise.resolve([]),
          window.orbitqa?.listStreamingAccounts?.() ?? Promise.resolve([]),
          window.orbitqa?.listSocialAccounts?.() ?? Promise.resolve([]),
        ]);
        if (cancelled) return;
        const runsArr = Array.isArray(runs) ? runs : [];
        setTotalRuns(runsArr.length);
        const runningCount = runsArr.filter((r: any) => r?.status === 'RUNNING' || r?.status === 'QUEUED' || r?.status === 'PAUSED').length;
        setRunning(runningCount);
        const completedArr = runsArr.filter((r: any) => r?.status === 'COMPLETED' || r?.status === 'FAILED' || r?.status === 'STOPPED');
        setCompleted(completedArr.length);
        if (completedArr.length > 0) {
          const passed = completedArr.filter((r: any) => r?.status === 'COMPLETED').length;
          setSuccessRate(`${Math.round((passed / completedArr.length) * 100)}%`);
        } else {
          setSuccessRate('—');
        }
        setTotalProxies(Array.isArray(proxies) ? proxies.length : 0);
        setTotalCookies(Array.isArray(cookies) ? cookies.length : 0);
        setTotalStreamingAccounts(Array.isArray(streamingAccounts) ? streamingAccounts.length : 0);
        setTotalSocialAccounts(Array.isArray(socialAccounts) ? socialAccounts.length : 0);
      } catch {
        if (!cancelled) {
          setTotalRuns(0);
          setRunning(0);
          setCompleted(0);
          setSuccessRate('—');
          setTotalProxies(0);
          setTotalCookies(0);
          setTotalStreamingAccounts(0);
          setTotalSocialAccounts(0);
        }
      }
    };
    void load();
    const interval = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

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
        <MetricCard label="TOTAL RUNS" value={String(totalRuns)} hint={totalRuns === 0 ? "No saved runs yet" : `${totalRuns} saved run${totalRuns === 1 ? '' : 's'}`} tone="violet" />
        <MetricCard label="RUNNING" value={String(running)} hint={running === 0 ? "Queue is idle" : `${running} in progress`} tone="cyan" />
        <MetricCard label="COMPLETED" value={String(completed)} hint={completed === 0 ? "Ready for first run" : `${completed} finished`} tone="green" />
        <MetricCard label="SUCCESS RATE" value={successRate} hint={completed === 0 ? "Calculated after runs" : "Completed runs"} tone="amber" />
      </section>

      <section className="metrics-grid" aria-label="Inventory totals">
        <MetricCard label="PROXIES" value={String(totalProxies)} hint={totalProxies === 0 ? "No proxies configured" : `${totalProxies} configured`} tone="violet" />
        <MetricCard label="COOKIES" value={String(totalCookies)} hint={totalCookies === 0 ? "No cookies stored" : `${totalCookies} stored`} tone="cyan" />
        <MetricCard label="STREAMING ACCOUNTS" value={String(totalStreamingAccounts)} hint={totalStreamingAccounts === 0 ? "No streaming accounts" : `${totalStreamingAccounts} saved`} tone="green" />
        <MetricCard label="SOCIAL ACCOUNTS" value={String(totalSocialAccounts)} hint={totalSocialAccounts === 0 ? "No social accounts" : `${totalSocialAccounts} saved`} tone="amber" />
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
