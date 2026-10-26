import { useEffect, useState } from 'react';
export type PageKey =
  | 'dashboard'
  | 'run'
  | 'runs'
  | 'pods'
  | 'warmer'
  | 'streaming'
  | 'streaming-library'
  | 'streaming-accounts'
  | 'social'
  | 'social-accounts'
  | 'proxies'
  | 'cookies'
  | 'proxy-ip-history'
  | 'profiles'
  | 'scripts'
  | 'scheduler'
  | 'reports'
  | 'system'
  | 'settings';

const items: Array<{ key: PageKey; label: string; badge?: string; sub?: boolean }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'run', label: 'Run', badge: 'CORE' },
  { key: 'runs', label: 'Run Center' },
  { key: 'streaming', label: 'Streaming Hub', badge: 'QA' },
  { key: 'streaming-library', label: 'Music Library', sub: true },
  { key: 'streaming-accounts', label: 'Accounts', sub: true },
  { key: 'social', label: 'Social Hub', badge: 'QA' },
  { key: 'social-accounts', label: 'Social Accounts', sub: true },
  { key: 'proxies', label: 'Proxy Manager' },
  { key: 'cookies', label: 'Cookie Manager' },
  { key: 'proxy-ip-history', label: 'Proxy IP History', sub: true },
  { key: 'profiles', label: 'Device Profiles' },
  { key: 'scripts', label: 'Behavior Scripts' },
  { key: 'scheduler', label: 'Scheduler' },
  { key: 'reports', label: 'Reports' },
  { key: 'system', label: 'System Monitor' },
  { key: 'settings', label: 'Settings' },
];

type SidebarProps = { page: PageKey; onChange: (page: PageKey) => void; };

export function Sidebar({ page, onChange }: SidebarProps) {
  const [activeRuns, setActiveRuns] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const runs = await window.orbitqa?.listQaRuns?.();
        if (!cancelled && runs) setActiveRuns(runs.filter((run) => ['CREATED','STARTING','RUNNING','PAUSING','RESUMING','STOPPING'].includes(run.status)).length);
      } catch { /* Run Center may still be starting. */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  return <aside className="sidebar">
    <div className="brand"><div className="brand__mark">OQ</div><div><strong>ORBITQA</strong><span>DESKTOP</span></div></div>
    <p className="sidebar__eyebrow">CONTROL CENTER</p>
    <nav className="sidebar__nav" aria-label="Primary navigation">
      {items.map((item) => <button key={item.key} type="button" className={`${page===item.key?'nav-item nav-item--active':'nav-item'}${item.sub?' nav-item--sub':''}`} onClick={()=>onChange(item.key)}>
        <span className="nav-item__icon" aria-hidden="true"/><span>{item.label}</span>{(item.key==='runs'&&activeRuns>0)?<em>{activeRuns}</em>:item.badge?<em>{item.badge}</em>:null}
      </button>)}
    </nav>
    <div className="sidebar__footer"><div className="local-mode"><span/> Local-first mode</div><small>Authorized QA</small></div>
  </aside>;
}
