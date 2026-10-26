import { useEffect, useMemo, useState } from 'react';
import type { Pod, PodProfile, WarmerAssignment, WarmerRunSummary, WarmerTopic } from '../../shared/pods';

type Props = { initialPodId?: string | null };
const unwrap = <T,>(value: any): T => { if (value?.ok === false) throw new Error(value.error?.message || value.error || 'Request failed'); return (value?.ok === true && 'value' in value ? value.value : value) as T; };

export function Warmer({ initialPodId }: Props) {
  const [topics, setTopics] = useState<WarmerTopic[]>([]);
  const [pods, setPods] = useState<Pod[]>([]);
  const [profiles, setProfiles] = useState<PodProfile[]>([]);
  const [assignments, setAssignments] = useState<WarmerAssignment[]>([]);
  const [runs, setRuns] = useState<WarmerRunSummary[]>([]);
  const [topicDraft, setTopicDraft] = useState('');
  const [podId, setPodId] = useState(initialPodId || '');
  const [profileIds, setProfileIds] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [purpose, setPurpose] = useState('');
  const [assignmentPodId, setAssignmentPodId] = useState('');
  const [assignmentProfileId, setAssignmentProfileId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const activeRun = runs.find((run) => run.status === 'RUNNING');
  const selectedProfiles = useMemo(() => profiles.filter((profile) => profileIds.includes(profile.id)), [profiles, profileIds]);

  const refresh = async () => {
    try {
      const [topicRows, podRows, assignmentRows, runRows] = await Promise.all([
        window.orbitqa?.listWarmerTopics?.() ?? Promise.resolve([]), window.orbitqa?.listPods?.() ?? Promise.resolve([]),
        window.orbitqa?.listWarmerAssignments?.() ?? Promise.resolve([]), window.orbitqa?.listWarmerRuns?.() ?? Promise.resolve([]),
      ]);
      setTopics(unwrap(topicRows)); setPods(unwrap(podRows)); setAssignments(unwrap(assignmentRows)); setRuns(unwrap(runRows));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    let active = true;
    const load = async () => { try { const rows = await window.orbitqa?.listPodProfiles?.(podId) ?? []; if (!active) return; setProfiles(rows); setProfileIds(rows.map((row) => row.id)); } catch (e) { setError(String((e as Error).message || e)); } };
    if (podId) void load(); else { setProfiles([]); setProfileIds([]); }
    return () => { active = false; };
  }, [podId]);
  useEffect(() => window.orbitqa?.onWarmerEvent?.((event) => {
    setRuns((old) => old.map((run) => run.runId === event.runId ? { ...run, ...(event.status ? { status: event.status } : {}), ...(event.finishedAt ? { finishedAt: event.finishedAt } : {}), ...(event.searches !== undefined ? { searches: event.searches } : {}), ...(event.cookiesSaved !== undefined ? { cookiesSaved: event.cookiesSaved } : {}) } : run));
    if (event.profileId) setProfiles((old) => old.map((profile) => profile.id === event.profileId ? { ...profile, status: event.status === 'SEARCHING' ? 'WARMING' : event.status, ...(event.status === 'WARM' ? { warmCount: profile.warmCount + 1, lastWarmedAt: new Date().toISOString() } : {}) } : profile));
    void refresh();
  }), []);

  const addTopic = async () => { const label = topicDraft.trim(); if (!label || topics.some((topic) => topic.label.toLowerCase() === label.toLowerCase())) return; try { await window.orbitqa?.addWarmerTopic?.(label); setTopicDraft(''); await refresh(); } catch (e) { setError(String((e as Error).message || e)); } };
  const removeTopic = async (id: string) => { try { await window.orbitqa?.removeWarmerTopic?.(id); await refresh(); } catch (e) { setError(String((e as Error).message || e)); } };
  const runWarmup = async () => { if (!podId) { setError('Choose a pod first.'); return; } setBusy(true); setError(''); try { const result: any = await window.orbitqa?.startWarmerRun?.({ podId, profileIds: profileIds.length === profiles.length ? undefined : profileIds, topicIds: topics.map((topic) => topic.id) }); const run = unwrap<any>(result); if (run?.ok === false) throw new Error(run.error); if (run?.run) setRuns((old) => [run.run, ...old.filter((item) => item.runId !== run.run.runId)]); await refresh(); } catch (e) { setError(String((e as Error).message || e)); } finally { setBusy(false); } };
  const stopRun = async () => { if (!activeRun) return; try { await window.orbitqa?.stopWarmerRun?.(activeRun.runId); await refresh(); } catch (e) { setError(String((e as Error).message || e)); } };
  const addAssignment = async () => { if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email address.'); return; } try { await window.orbitqa?.addWarmerAssignment?.({ email: email.trim(), purpose, podId: assignmentPodId || null, profileId: assignmentProfileId || null }); setEmail(''); setPurpose(''); setError(''); await refresh(); } catch (e) { setError(String((e as Error).message || e)); } };
  const removeAssignment = async (id: string) => { try { await window.orbitqa?.removeWarmerAssignment?.(id); await refresh(); } catch (e) { setError(String((e as Error).message || e)); } };

  return <div className="dashboard-page">
    <section className="hero"><div><span className="section-kicker">WARMER</span><h2>Profile warmer</h2><p>Run controlled browser QA journeys and keep search state scoped to each local profile.</p></div></section>
    {error && <p className="pod-error" role="alert">{error}</p>}
    <section className="panel"><div className="panel__header"><div><span className="section-kicker">TOPICS</span><h3>Search topics to warm profiles</h3></div></div><div className="warmer-section">
      <div className="warmer-topic-form"><input value={topicDraft} onChange={(e) => setTopicDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addTopic()} placeholder="Add topic (e.g. investments, finance)" /><button className="secondary-button" onClick={() => void addTopic()}>Add Topic</button></div>
      <div className="warmer-topic-list">{topics.map((topic) => <span className="warmer-topic-chip" key={topic.id}>{topic.label}<button aria-label={`Remove ${topic.label}`} onClick={() => void removeTopic(topic.id)}>×</button></span>)}{!topics.length && <span className="pod-empty">No topics yet. Add one to choose search phrases.</span>}</div>
    </div></section>
    <section className="panel"><div className="panel__header"><div><span className="section-kicker">RUN WARMER</span><h3>Execute warming</h3></div></div><div className="warmer-section">
      <div className="warmer-run-controls"><label className="field"><span>Pod</span><select value={podId} onChange={(e) => setPodId(e.target.value)}><option value="">Choose a pod</option>{pods.map((pod) => <option key={pod.id} value={pod.id}>{pod.name} · {pod.count} profiles</option>)}</select></label><label className="field"><span>Profiles (defaults to all)</span><select multiple value={profileIds} onChange={(e) => setProfileIds(Array.from(e.target.selectedOptions, (option) => option.value))}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>Profile {profile.index} · {profile.status}</option>)}</select></label><div className="warmer-run-buttons"><button className="primary-button" onClick={() => void runWarmup()} disabled={busy || Boolean(activeRun) || !podId}>{busy ? 'Starting…' : 'Run warmer'}</button>{activeRun && <button className="secondary-button" onClick={() => void stopRun()}>Stop run</button>}</div></div>
      <div className="warmer-run-row">{selectedProfiles.map((profile) => <div key={profile.id}><strong>Profile {profile.index}</strong><span>{profile.status}</span><small>{profile.warmCount} warm runs</small></div>)}</div>
      {runs.length > 0 && <div className="warmer-history"><h4>Recent warmer runs</h4>{runs.slice(0, 8).map((run) => <div className="warmer-history-row" key={run.runId}><strong>{run.status}</strong><span>{run.profileIds.length} profiles</span><span>{run.searches} searches</span><span>{run.cookiesSaved} cookies</span><time>{new Date(run.startedAt).toLocaleString()}</time></div>)}</div>}
    </div></section>
    <section className="panel"><div className="panel__header"><div><span className="section-kicker">GMAIL / ACCOUNT ASSIGNMENT</span><h3>Assign Gmail accounts</h3></div></div><div className="warmer-section">
      <div className="warmer-assignment-form"><label className="field"><span>Gmail account</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="account@gmail.com" /></label><label className="field"><span>Purpose</span><input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. YouTube warmup" /></label><label className="field"><span>Pod (optional)</span><select value={assignmentPodId} onChange={(e) => { setAssignmentPodId(e.target.value); setAssignmentProfileId(''); }}><option value="">Unassigned</option>{pods.map((pod) => <option key={pod.id} value={pod.id}>{pod.name}</option>)}</select></label><label className="field"><span>Profile (optional)</span><select value={assignmentProfileId} onChange={(e) => setAssignmentProfileId(e.target.value)}><option value="">Any profile</option>{profiles.filter((profile) => !assignmentPodId || profile.podId === assignmentPodId).map((profile) => <option key={profile.id} value={profile.id}>Profile {profile.index}</option>)}</select></label><button className="secondary-button" onClick={() => void addAssignment()}>Assign</button></div>
      <div className="warmer-assignment-list">{assignments.map((assignment) => <div key={assignment.id}><strong>{assignment.email}</strong><span>{assignment.purpose || 'No purpose'}</span><button className="text-button" onClick={() => void removeAssignment(assignment.id)}>Remove</button></div>)}{!loading && assignments.length === 0 && <p className="pod-empty">No account assignments yet.</p>}</div>
    </div></section>
  </div>;
}
