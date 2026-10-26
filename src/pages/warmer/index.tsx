import { useEffect, useMemo, useState } from 'react';
import '../../shared/pods';

type Topic = { id: string; label: string; createdAt: string };
type Assignment = { id: string; email: string; purpose: string; podId: string | null; profileId: string | null; createdAt: string };
type Pod = { id: string; name: string; deviceType: string; country: string; count: number };
type Profile = { id: string; podId: string; index: number; status: string };
type WarmerRun = { runId: string; podId: string; profileIds: string[]; status: string; startedAt: string; finishedAt: string | null; searches: number; cookiesSaved: number; error: string | null };

const unwrap = <T,>(result: any): T => {
  if (result?.ok === false) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || 'Request failed');
  return (result?.ok === true && 'value' in result ? result.value : result) as T;
};

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export function Warmer() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [newTopic, setNewTopic] = useState('');
  const [pods, setPods] = useState<Pod[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [runs, setRuns] = useState<WarmerRun[]>([]);
  const [selectedPodId, setSelectedPodId] = useState('');
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [purpose, setPurpose] = useState('');
  const [assignPodId, setAssignPodId] = useState('');
  const [assignProfileId, setAssignProfileId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const podProfiles = useMemo(() => profiles.filter((p) => p.podId === selectedPodId), [profiles, selectedPodId]);

  const refresh = async () => {
    try {
      const [topicRes, podRes, profileRes, assignRes, runRes] = await Promise.all([
        (window as any).orbitqa?.listWarmerTopics?.() ?? Promise.resolve([]),
        (window as any).orbitqa?.listPods?.() ?? Promise.resolve([]),
        (window as any).orbitqa?.listPodProfiles?.() ?? Promise.resolve([]),
        (window as any).orbitqa?.listWarmerAssignments?.() ?? Promise.resolve([]),
        (window as any).orbitqa?.listWarmerRuns?.() ?? Promise.resolve([]),
      ]);
      setTopics(unwrap<Topic[]>(topicRes));
      setPods(unwrap<Pod[]>(podRes));
      setProfiles(unwrap<Profile[]>(profileRes));
      setAssignments(unwrap<Assignment[]>(assignRes));
      setRuns(unwrap<WarmerRun[]>(runRes));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const handler = (event: any) => {
      const payload = event.detail || {};
      setEvents((prev) => [...prev.slice(-200), payload]);
      if (payload?.runId) setActiveRunId(payload.runId);
    };
    window.addEventListener('orbitqa:warmer-event', handler as any);
    return () => window.removeEventListener('orbitqa:warmer-event', handler as any);
  }, []);

  const addTopic = async () => {
    const label = newTopic.trim();
    if (!label) return;
    if (topics.some((t) => t.label.toLowerCase() === label.toLowerCase())) { setNewTopic(''); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await (window as any).orbitqa?.addWarmerTopic?.(label);
      unwrap(res);
      setNewTopic(''); setMessage('Topic added'); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const removeTopic = async (id: string) => { try { unwrap(await (window as any).orbitqa?.removeWarmerTopic?.(id)); await refresh(); } catch (e) { setError(String((e as Error).message || e)); } };
  const addAssignment = async () => {
    if (!isEmail(email)) { setError('Enter a valid email address'); return; }
    if (!purpose.trim()) { setError('Enter a purpose'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const res = await (window as any).orbitqa?.addWarmerAssignment?.({ email: email.trim(), purpose: purpose.trim(), podId: assignPodId || null, profileId: assignProfileId || null });
      unwrap(res);
      setEmail(''); setPurpose(''); setMessage('Assignment added'); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const removeAssignment = async (id: string) => { try { unwrap(await (window as any).orbitqa?.removeWarmerAssignment?.(id)); await refresh(); } catch (e) { setError(String((e as Error).message || e)); } };
  const startRun = async () => {
    if (!selectedPodId) { setError('Select a pod'); return; }
    if (!topics.length) { setError('Add at least one topic'); return; }
    setBusy(true); setError(''); setMessage(''); setEvents([]);
    try {
      const res = await (window as any).orbitqa?.startWarmerRun?.({ podId: selectedPodId, profileIds: selectedProfileIds.length ? selectedProfileIds : undefined, topicIds: topics.map((t) => t.id) });
      const value = unwrap<any>(res);
      setActiveRunId(value?.runId || null);
      setMessage('Warmer run started');
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const stopRun = async () => { if (!activeRunId) return; try { unwrap(await (window as any).orbitqa?.stopWarmerRun?.(activeRunId)); await refresh(); } catch (e) { setError(String((e as Error).message || e)); } };

  return <div className="dashboard-page">
    <section className="hero"><div><span className="section-kicker">WARMER</span><h2>Profile warmer</h2><p>Make pod profiles look established: Google searches, organic visits, cookies and history stored locally per profile.</p></div></section>

    <section className="panel">
      <div className="panel__header"><div><span className="section-kicker">TOPICS</span><h3>Warmup topics</h3></div></div>
      <div className="warmer-topic-form">
        <label className="field"><span>Topic</span><input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="Add topic (e.g. investments, finance)" /></label>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void addTopic()}>Add Topic</button>
      </div>
      <div className="warmer-topic-list">
        {topics.length === 0 ? <div style={{color:'var(--text-secondary)'}}>No topics yet</div> : topics.map((topic) => <span className="warmer-topic-chip" key={topic.id}>{topic.label}<button onClick={() => void removeTopic(topic.id)}>×</button></span>)}
      </div>
    </section>

    <section className="panel">
      <div className="panel__header"><div><span className="section-kicker">RUN</span><h3>Start warmer run</h3></div></div>
      <div className="warmer-run-controls">
        <label className="field"><span>Pod</span><select value={selectedPodId} onChange={(e) => { setSelectedPodId(e.target.value); setSelectedProfileIds([]); }}><option value="">Select pod</option>{pods.map((pod) => <option key={pod.id} value={pod.id}>{pod.name} ({pod.count})</option>)}</select></label>
        <label className="field"><span>Profiles (optional)</span><select multiple value={selectedProfileIds} onChange={(e) => setSelectedProfileIds(Array.from(e.target.selectedOptions).map((o) => o.value))}>{podProfiles.map((profile) => <option key={profile.id} value={profile.id}>{'#'}{profile.index} {profile.status}</option>)}</select><small style={{color:'var(--text-secondary)'}}>Leave empty to warm all profiles in the pod</small></label>
      </div>
      <div className="warmer-run-buttons">
        <button className="primary-button" type="button" disabled={busy} onClick={() => void startRun()}>Start Warmup</button>
        {activeRunId && <button className="secondary-button" type="button" onClick={() => void stopRun()}>Stop</button>}
      </div>
      {events.length > 0 && <div style={{display:'grid',gap:8}}>
        <div style={{display:'flex',justifyContent:'space-between'}}><strong>Live activity</strong><span style={{color:'var(--text-secondary)'}}>{events.length} events</span></div>
        <div className="warmer-run-row">{events.slice(-40).map((ev, idx) => <div key={idx}><span>{ev.profileId || ev.workId}</span><span>{ev.type}</span><small>{ev.message || ''}</small></div>)}</div>
      </div>}
    </section>

    <section className="panel">
      <div className="panel__header"><div><span className="section-kicker">GMAIL / ASSIGNMENTS</span><h3>Account assignments</h3></div></div>
      <div className="warmer-assignment-form">
        <label className="field"><span>Email</span><input placeholder="account@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field"><span>Purpose</span><input placeholder="e.g. YouTube warmup" value={purpose} onChange={(e) => setPurpose(e.target.value)} /></label>
        <label className="field"><span>Pod (optional)</span><select value={assignPodId} onChange={(e) => { setAssignPodId(e.target.value); setAssignProfileId(''); }}><option value="">None</option>{pods.map((pod) => <option key={pod.id} value={pod.id}>{pod.name}</option>)}</select></label>
        <label className="field"><span>Profile (optional)</span><select value={assignProfileId} onChange={(e) => setAssignProfileId(e.target.value)}><option value="">None</option>{profiles.filter((p) => !assignPodId || p.podId === assignPodId).map((profile) => <option key={profile.id} value={profile.id}>{'#'}{profile.index}</option>)}</select></label>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void addAssignment()}>Assign</button>
      </div>
      <div className="warmer-assignment-list">
        {assignments.length === 0 ? <div style={{color:'var(--text-secondary)'}}>No assignments</div> : assignments.map((assignment) => <div key={assignment.id}><div><strong>{assignment.email}</strong><span>{assignment.purpose}</span></div><span>{assignment.podId || assignment.profileId ? 'Linked' : 'Unlinked'}</span><button className="text-button" onClick={() => void removeAssignment(assignment.id)}>Remove</button></div>)}
      </div>
    </section>

    <section className="panel">
      <div className="panel__header"><div><span className="section-kicker">RECENT RUNS</span><h3>Warmer runs</h3></div></div>
      <div className="warmer-history">
        {runs.length === 0 ? <div style={{color:'var(--text-secondary)'}}>No runs yet</div> : runs.slice(0, 20).map((run) => <div className="warmer-history-row" key={run.runId}><div><strong>{run.runId}</strong><span>Pod {run.podId}</span><span>{run.profileIds?.length || 0} profiles</span></div><div><span>{run.status}</span><span>Searches {run.searches}</span><span>Cookies {run.cookiesSaved}</span>{run.error && <span>{run.error}</span>}</div></div>)}
      </div>
    </section>

    {(error || message) && <section className="panel"><p style={{color: error ? '#fca5a5' : 'var(--text-secondary)'}}>{error || message}</p></section>}
  </div>;
}
