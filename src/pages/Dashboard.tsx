import { useEffect, useMemo, useState } from 'react';
import { MetricCard } from '../components/MetricCard';
import type { RunSummary } from '../shared/runCenter';

type Pod = { id: string; name: string; count: number; profiles?: any[] };
type WarmerRun = { runId: string; status: string; startedAt: string; finishedAt: string | null; profileIds: string[] };
type StreamingAccount = { id: string; label: string; platform: string; verified: boolean };

const unwrap = <T,>(result: any): T => {
  if (result?.ok === false) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || 'Request failed');
  return (result?.ok === true && 'value' in result ? result.value : result) as T;
};

function formatTime(ts: string | null | undefined) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

export function Dashboard() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [pods, setPods] = useState<Pod[]>([]);
  const [warmerRuns, setWarmerRuns] = useState<WarmerRun[]>([]);
  const [streamingAccounts, setStreamingAccounts] = useState<StreamingAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const [runRes, podRes, warmerRes, streamRes] = await Promise.all([
          (window as any).orbitqa?.listQaRuns?.() ?? Promise.resolve([]),
          (window as any).orbitqa?.listPods?.() ?? Promise.resolve([]),
          (window as any).orbitqa?.listWarmerRuns?.() ?? Promise.resolve([]),
          (window as any).orbitqa?.listStreamingAccounts?.() ?? Promise.resolve([]),
        ]);
        if (!mounted) return;
        setRuns(unwrap<RunSummary[]>(runRes) || []);
        setPods(unwrap<Pod[]>(podRes) || []);
        setWarmerRuns(unwrap<WarmerRun[]>(warmerRes) || []);
        setStreamingAccounts(unwrap<StreamingAccount[]>(streamRes) || []);
      } catch {
        // ignore
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    const id = setInterval(load, 15000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const totalRuns = runs.length;
  const running = runs.filter((r) => ['CREATED','STARTING','RUNNING','PAUSING','PAUSED','RESUMING','STOPPING'].includes(String(r.status))).length;
  const completed = runs.filter((r) => r.status === 'COMPLETED').length;
  const failed = runs.filter((r) => r.status === 'FAILED').length;
  const successRate = totalRuns > 0 ? Math.round(((completed) / totalRuns) * 100) : null;

  const totalProfiles = useMemo(() => pods.reduce((sum, p) => sum + (Number(p.count) || 0), 0), [pods]);
  const warmerActive = useMemo(() => warmerRuns.filter((r) => r.status === 'RUNNING').length, [warmerRuns]);
  const verifiedAccounts = useMemo(() => streamingAccounts.filter((a) => a.verified).length, [streamingAccounts]);

  const recent = useMemo(() => {
    const items: Array<{ time: string; icon: string; title: string; sub: string }> = [];
    const latestRun = [...runs].sort((a,b) => String(b.updatedAt||b.createdAt).localeCompare(String(a.updatedAt||a.createdAt)))[0];
    if (latestRun) {
      items.push({ time: formatTime(latestRun.updatedAt || latestRun.createdAt), icon: '✓', title: `Run ${latestRun.runId.slice(0,8)} · ${latestRun.runKind || 'qa'} · ${latestRun.status}`, sub: latestRun.targetSummary || '' });
    }
    const latestWarmer = [...warmerRuns].sort((a,b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
    if (latestWarmer) {
      items.push({ time: formatTime(latestWarmer.startedAt), icon: '•', title: `Warmer run · ${latestWarmer.profileIds?.length || 0} profiles · ${latestWarmer.status}`, sub: latestWarmer.finishedAt ? `Finished ${formatTime(latestWarmer.finishedAt)}` : 'In progress' });
    }
    if (pods.length) items.push({ time: 'NOW', icon: '•', title: `Pods: ${pods.length} pod${pods.length===1?'':'s'} · ${totalProfiles} profile${totalProfiles===1?'':'s'}`, sub: 'Stored locally under userData' });
    if (streamingAccounts.length) items.push({ time: 'NOW', icon: '•', title: `Streaming accounts: ${streamingAccounts.length} · ${verifiedAccounts} verified`, sub: 'Saved accounts, local sessions' });
    if (items.length === 0) {
      items.push({ time: 'NOW', icon: '✓', title: 'OrbitQA initialized', sub: 'Local-first. No sign-in or cloud connection required.' });
    }
    return items.slice(0, 6);
  }, [runs, warmerRuns, pods, streamingAccounts, totalProfiles, verifiedAccounts]);

  return (
    <div className="dashboard-page">
      <section className="hero">
        <div>
          <span className="section-kicker">OVERVIEW</span>
          <h2>Pods · Warmer · Streaming</h2>
          <p>Local-first QA. Pods create profiles, Warmer exercises them, Streaming runs authorized playback/navigation QA.</p>
        </div>
      </section>

      <section className="metrics-grid" aria-label="QA metrics">
        <MetricCard label="TOTAL RUNS" value={loading ? '—' : String(totalRuns)} hint={totalRuns ? 'All runs in Run Center' : 'No saved runs yet'} tone="violet" />
        <MetricCard label="RUNNING" value={loading ? '—' : String(running)} hint={running ? 'Active now' : 'Queue is idle'} tone="cyan" />
        <MetricCard label="COMPLETED" value={loading ? '—' : String(completed)} hint={failed ? `${failed} failed` : 'Across all lanes'} tone="green" />
        <MetricCard label="SUCCESS RATE" value={loading ? '—' : (successRate === null ? '—' : `${successRate}%`)} hint={totalRuns ? `${completed} completed / ${totalRuns} total` : 'Calculated after runs'} tone="amber" />
      </section>

      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel__header">
            <div>
              <span className="section-kicker">LOCAL STATE</span>
              <h3>Pods · Warmer · Streaming</h3>
            </div>
            <span className="status-pill status-pill--soft"><i /> LOCAL</span>
          </div>
          <div className="health-list">
            <div><span><i className="health-dot health-dot--green" /> Pods</span><strong>{loading ? '—' : `${pods.length} pods · ${totalProfiles} profiles`}</strong></div>
            <div><span><i className="health-dot health-dot--green" /> Warmer</span><strong>{loading ? '—' : `${warmerRuns.length} runs · ${warmerActive} active`}</strong></div>
            <div><span><i className="health-dot health-dot--green" /> Streaming</span><strong>{loading ? '—' : `${streamingAccounts.length} accounts · ${verifiedAccounts} verified`}</strong></div>
            <div><span><i className="health-dot health-dot--muted" /> Storage</span><strong>userData (local)</strong></div>
          </div>
        </article>

        <article className="panel">
          <div className="panel__header">
            <div>
              <span className="section-kicker">RUN CENTER</span>
              <h3>Lanes</h3>
            </div>
          </div>
          <div className="resource-card">
            <span>By lane</span>
            <strong>{loading ? '—' : `QA ${runs.filter(r=>r.runKind!=='streaming'&&r.runKind!=='warmer').length} · Streaming ${runs.filter(r=>r.runKind==='streaming').length} · Warmer ${warmerRuns.length}`}</strong>
            <small>All runs monitored in Run Center. Streaming/Warmer appear in their lanes.</small>
          </div>
        </article>

        <article className="panel panel--wide">
          <div className="panel__header">
            <div>
              <span className="section-kicker">ACTIVITY</span>
              <h3>Recent activity (local)</h3>
            </div>
          </div>
          <div className="activity-feed">
            {recent.map((item, idx) => (
              <div key={idx}>
                <time>{item.time}</time>
                <span className={`activity-icon ${item.icon === '•' ? 'activity-icon--muted' : ''}`}>{item.icon}</span>
                <p><strong>{item.title}</strong><small>{item.sub}</small></p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
