import { useEffect, useMemo, useState } from 'react';
import type { Pod, PodCountry, PodProfile } from '../../shared/pods';
import { podFingerprint } from '../../shared/podFingerprints';

type ProxyRow = { id: string; label?: string; hostname?: string; port?: number; kind?: string };
const unwrap = <T,>(result: any): T => { if (result?.ok === false) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message || 'Request failed'); return (result?.ok === true && 'value' in result ? result.value : result) as T; };

export function Pods() {
  const [podName, setPodName] = useState('');
  const [deviceType, setDeviceType] = useState<'desktop' | 'android' | 'ios'>('desktop');
  const [count, setCount] = useState(20);
  const [country, setCountry] = useState<PodCountry>('US');
  const [pods, setPods] = useState<Pod[]>([]);
  const [profiles, setProfiles] = useState<PodProfile[]>([]);
  const [proxies, setProxies] = useState<ProxyRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const profileCount = useMemo(() => profiles.length, [profiles]);

  const refresh = async () => {
    try {
      const [podResult, profileResult, proxyResult] = await Promise.all([
        window.orbitqa?.listPods?.() ?? Promise.resolve([]),
        window.orbitqa?.listPodProfiles?.() ?? Promise.resolve([]),
        window.orbitqa?.listProxies?.() ?? Promise.resolve([]),
      ]);
      setPods(unwrap<Pod[]>(podResult)); setProfiles(unwrap<PodProfile[]>(profileResult)); setProxies(unwrap<ProxyRow[]>(proxyResult));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);

  const createPod = async () => {
    const safeCount = Math.max(1, Math.min(100, Math.floor(Number(count) || 1)));
    setCount(safeCount); setBusy(true); setError('');
    try {
      const result: any = await window.orbitqa?.createPod?.({ name: podName, deviceType, count: safeCount, country, fingerprints: Array.from({ length: safeCount }, (_, index) => podFingerprint(deviceType, country, index)) });
      const value = unwrap<any>(result);
      if (value?.ok === false) throw new Error(value.error?.message || 'Could not create pod');
      setPodName(''); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const deletePod = async (pod: Pod) => { if (!window.confirm(`Delete ${pod.name} and its profiles?`)) return; try { unwrap(await window.orbitqa?.deletePod?.(pod.id)); await refresh(); } catch (e) { setError(String((e as Error).message || e)); } };
  const deleteProfile = async (profile: PodProfile) => { if (!window.confirm(`Delete profile ${profile.index}?`)) return; try { unwrap(await window.orbitqa?.deletePodProfile?.(profile.id)); await refresh(); } catch (e) { setError(String((e as Error).message || e)); } };
  const assignProxy = async (profileId: string, proxyId: string) => { try { unwrap(await window.orbitqa?.assignPodProfileProxy?.(profileId, proxyId || null)); await refresh(); } catch (e) { setError(String((e as Error).message || e)); } };
  const goTo = (page: 'warmer' | 'run', podId: string) => window.dispatchEvent(new CustomEvent('orbitqa:navigate', { detail: { page, podId } }));

  return <div className="dashboard-page">
    <section className="hero"><div><span className="section-kicker">PODS</span><h2>Instant YouTube pods (without Gmail)</h2><p>Create persistent browser profiles with a stable device fingerprint for authorized QA.</p></div></section>
    <section className="panel pod-form-panel"><div className="panel__header"><div><span className="section-kicker">CREATE POD</span><h3>New pod configuration</h3></div></div>
      <div className="pod-form-grid">
        <label className="field"><span>Pod name</span><input value={podName} onChange={(e) => setPodName(e.target.value)} placeholder="e.g. YouTube-Pod-1" /></label>
        <label className="field"><span>Device type</span><select value={deviceType} onChange={(e) => setDeviceType(e.target.value as typeof deviceType)}><option value="desktop">Desktop</option><option value="android">Android</option><option value="ios">iOS</option></select></label>
        <label className="field"><span>Profiles</span><input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Math.floor(Number(e.target.value) || 1))))} /></label>
        <label className="field"><span>Country</span><select value={country} onChange={(e) => setCountry(e.target.value as PodCountry)}>{['US','GB','CA','AU','NG','IN'].map((code) => <option key={code}>{code}</option>)}</select></label>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void createPod()}>{busy ? 'Creating…' : 'Create Pod'}</button>
      </div>{error && <p className="pod-error" role="alert">{error}</p>}
    </section>
    <section className="panel"><div className="panel__header"><div><span className="section-kicker">POD LIST</span><h3>Created pods</h3></div><span className="pod-total">{profileCount} profiles</span></div>
      {loading ? <div className="pod-empty">Loading pods…</div> : pods.length === 0 ? <div className="pod-empty">No pods yet. Create one to generate persistent profiles.</div> : <div className="pod-grid">{pods.map((pod) => {
        const rows = profiles.filter((profile) => profile.podId === pod.id);
        return <article className="pod-card" key={pod.id}>
          <header><button className="pod-expand" onClick={() => setExpanded(expanded === pod.id ? null : pod.id)} aria-expanded={expanded === pod.id}><strong>{pod.name}</strong><span>{pod.deviceType} · {rows.length} profiles · {pod.country}</span></button><div className="pod-actions"><button className="secondary-button" onClick={() => goTo('warmer', pod.id)}>Warm this pod</button><button className="secondary-button" onClick={() => goTo('run', pod.id)}>Run with this pod</button><button className="text-button" onClick={() => void deletePod(pod)}>Delete</button></div></header>
          {expanded === pod.id && <div className="pod-profile-table-wrap"><table className="pod-profile-table"><thead><tr><th>Index</th><th>Browser / UA</th><th>Viewport</th><th>Timezone</th><th>Proxy</th><th>Status</th><th>Warm count</th><th /></tr></thead><tbody>{rows.map((profile) => <tr key={profile.id}><td>{profile.index}</td><td>{profile.fingerprint.browserFamily}<small>{profile.fingerprint.userAgent.slice(0, 52)}…</small></td><td>{profile.fingerprint.viewport.width} × {profile.fingerprint.viewport.height}</td><td>{profile.fingerprint.timezoneId}</td><td><select aria-label={`Proxy for profile ${profile.index}`} value={profile.proxyId || ''} onChange={(e) => void assignProxy(profile.id, e.target.value)}><option value="">Direct</option>{proxies.map((proxy) => <option key={proxy.id} value={proxy.id}>{proxy.label || `${proxy.hostname}:${proxy.port}`}</option>)}</select></td><td><span className={`status-pill status-pill--${profile.status.toLowerCase()}`}><i />{profile.status}</span></td><td>{profile.warmCount}</td><td><button className="text-button" onClick={() => void deleteProfile(profile)}>Delete</button></td></tr>)}</tbody></table></div>}
        </article>;
      })}</div>}
    </section>
  </div>;
}
