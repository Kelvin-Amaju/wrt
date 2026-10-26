import { useEffect, useMemo, useState } from 'react';
import { Sidebar, type PageKey } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { Dashboard } from './pages/Dashboard';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { Run } from './pages/Run';
import { RunCenter } from './pages/RunCenter';
import { Pods } from './pages/pods';
import { Warmer } from './pages/warmer';
import { StreamingHub } from './pages/StreamingHub';
import { SocialHub } from './pages/SocialHub';
import { DeviceProfiles } from './pages/DeviceProfiles';
import { Settings } from './pages/Settings';
import { ProxyManager } from './pages/ProxyManager';
import { ProxyIpHistory } from './pages/ProxyIpHistory';
import { CookieManager } from './pages/CookieManager';
import { Scheduler } from './pages/Scheduler';
import { Pods } from './pages/pods';
import { Warmer } from './pages/warmer';
import './styles.css';

const pageMeta: Record<PageKey, { title: string; eyebrow: string; description: string }> = {
  dashboard: { title: 'Dashboard', eyebrow: 'OVERVIEW', description: '' },
  run: { title: 'Run', eyebrow: 'QA ENGINE', description: 'Create controlled browser runs and queue sessions safely.' },
  runs: { title: 'Run Center', eyebrow: 'MULTI-RUN', description: 'Monitor, pause, resume, and stop independent QA runs.' },
  pods: { title: 'Pods', eyebrow: 'YOUTUBE', description: 'Create pods for instant YouTube without Gmail.' },
  warmer: { title: 'Warmer', eyebrow: 'WARMUP', description: 'Warm profiles with topics, Google searches, cookies and history.' },
  streaming: { title: 'Streaming Hub', eyebrow: 'STREAMING QA', description: 'Authorized playback, queue, catalog and account-session QA.' },
  'streaming-library': { title: 'Music Library', eyebrow: 'STREAMING QA', description: 'Import links and manage saved music from every supported platform in one place.' },
  'streaming-accounts': { title: 'Accounts', eyebrow: 'STREAMING QA', description: 'Manage authorized streaming logins, cookies, status checks, and network policy.' },
  social: { title: 'Social Hub', eyebrow: 'SOCIAL QA', description: 'Authorized social account, content, media, comments, creator and interaction-control QA.' },
  'social-accounts': { title: 'Social Accounts', eyebrow: 'SOCIAL QA', description: 'Manage isolated authorized social sessions and network policy.' },
  proxies: { title: 'Proxy Manager', eyebrow: 'NETWORK', description: 'Organize and validate optional proxies for authorized QA environments.' },
  cookies: { title: 'Cookie Manager', eyebrow: 'QA STATE', description: 'Manage non-authentication cookies for authorized browser QA.' },
  'proxy-ip-history': { title: 'Proxy IP History', eyebrow: 'NETWORK HISTORY', description: 'Review proxy exit IP reuse by Run, proxy, and country.' },
  profiles: { title: 'Device Profiles', eyebrow: 'COMPATIBILITY', description: 'Create desktop, mobile, viewport, locale, and browser presets.' },
  scripts: { title: 'Behavior Scripts', eyebrow: 'AUTOMATION', description: 'Build reusable visual QA flows with an advanced text mode.' },
  scheduler: { title: 'Scheduler', eyebrow: 'AUTOMATION', description: 'Schedule saved QA jobs while OrbitQA is running.' },
  reports: { title: 'Reports', eyebrow: 'RESULTS', description: 'Review timings, screenshots, assertions, errors, and run summaries.' },
  system: { title: 'System Monitor', eyebrow: 'RESOURCES', description: 'Track queue depth and browser resource use without unnecessary background processes.' },
  settings: { title: 'Settings', eyebrow: 'PREFERENCES', description: 'Control local paths, defaults, browser visibility, and app behavior.' },
};

export default function App() {
  const [page, setPage] = useState<PageKey>('dashboard');
  const [requestedRunId, setRequestedRunId] = useState<string | null>(null);
  const [requestedPodId, setRequestedPodId] = useState<string | null>(null);
  useEffect(() => {
    const navigate = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: PageKey; podId?: string }>).detail;
      if (detail?.page) setPage(detail.page);
      setRequestedPodId(detail?.podId || null);
    };
    window.addEventListener('orbitqa:navigate', navigate);
    return () => window.removeEventListener('orbitqa:navigate', navigate);
  }, []);
  const meta = useMemo(() => pageMeta[page], [page]);

  return <div className="app-shell">
    <Sidebar page={page} onChange={setPage} />
    <div className="workspace">
      <Topbar title={meta.title} />
      <main className="content">
        {page === 'dashboard' ? <Dashboard />
          : page === 'run' ? <Run podId={requestedPodId} />
          : page === 'runs' ? <RunCenter initialRunId={requestedRunId} onInitialRunHandled={() => setRequestedRunId(null)} />
          : page === 'pods' ? <Pods />
          : page === 'warmer' ? <Warmer />
          : page === 'streaming' || page === 'streaming-library' || page === 'streaming-accounts' ? <StreamingHub view={page==='streaming-library'?'library':page==='streaming-accounts'?'accounts':'qa'} />
          : page === 'social' || page === 'social-accounts' ? <SocialHub view={page==='social-accounts'?'accounts':'qa'} />
          : page === 'proxies' ? <ProxyManager />
          : page === 'cookies' ? <CookieManager />
          : page === 'proxy-ip-history' ? <ProxyIpHistory onOpenRun={(runId) => { setRequestedRunId(runId); setPage('runs'); }} />
          : page === 'profiles' ? <DeviceProfiles />
          : page === 'scheduler' ? <Scheduler />
          : page === 'settings' ? <Settings />
          : <PlaceholderPage eyebrow={meta.eyebrow} title={meta.title} description={meta.description} />}
      </main>
    </div>
  </div>;
}
