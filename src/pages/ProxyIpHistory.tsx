import { useEffect, useMemo, useState } from 'react';
import type { ProxyIpHistoryPage, ProxyIpHistoryQuery, ProxyIpHistoryRecordingState, ProxyIpHistoryRow, ProxyIpRepeatFilter } from '../shared/proxyIpHistory';

const PAGE_SIZE = 100;
const EMPTY_PAGE: ProxyIpHistoryPage = {
  page:1,
  pageSize:PAGE_SIZE,
  total:0,
  totalPages:1,
  summary:{ uniqueIps:0, repeatedIps:0, countries:0, totalObservations:0 },
  rows:[],
};

type Props = { onOpenRun?: (runId: string) => void };

function dateTime(value: string) {
  try { return new Date(value).toLocaleString(); } catch { return value || '—'; }
}

function rowRunId(row: ProxyIpHistoryRow) {
  return row.runId || row.lastRunId || '';
}

export function ProxyIpHistory({ onOpenRun }: Props) {
  const [result, setResult] = useState<ProxyIpHistoryPage>(EMPTY_PAGE);
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [proxyIdentity, setProxyIdentity] = useState('');
  const [runId, setRunId] = useState('');
  const [repeatFilter, setRepeatFilter] = useState<ProxyIpRepeatFilter | ''>('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recordingState, setRecordingState] = useState<ProxyIpHistoryRecordingState | null>(null);
  const [recordingBusy, setRecordingBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadRecordingState = async () => {
      if (!window.orbitqa?.getProxyIpHistoryRecordingState) return;
      try {
        const confirmed = await window.orbitqa.getProxyIpHistoryRecordingState();
        if (!cancelled) setRecordingState(confirmed);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void loadRecordingState();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const query = useMemo<ProxyIpHistoryQuery>(() => ({
    page,
    pageSize:100,
    ...(search ? { search } : {}),
    ...(countryCode.trim() ? { countryCode:countryCode.trim() } : {}),
    ...(proxyIdentity.trim() ? { proxyIdentity:proxyIdentity.trim() } : {}),
    ...(runId.trim() ? { runId:runId.trim() } : {}),
    ...(repeatFilter ? { repeatFilter } : {}),
  }), [page, search, countryCode, proxyIdentity, runId, repeatFilter]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!window.orbitqa?.listProxyIpHistory) {
        if (!cancelled) { setError('Proxy IP History is unavailable. Run this page inside OrbitQA Desktop.'); setLoading(false); }
        return;
      }
      setLoading(true);
      try {
        const next = await window.orbitqa.listProxyIpHistory(query);
        if (!cancelled) { setResult(next); setError(''); }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [query, refreshKey]);

  async function changeRecording(enabled: boolean) {
    if (!window.orbitqa?.setProxyIpHistoryRecordingState || recordingBusy) return;
    setRecordingBusy(true);
    setError('');
    try {
      const confirmed = await window.orbitqa.setProxyIpHistoryRecordingState(enabled);
      setRecordingState(confirmed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRecordingBusy(false);
    }
  }

  function resetToFirstPage() { setPage(1); }

  async function clearHistory() {
    if (!window.orbitqa?.clearProxyIpHistory) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await window.orbitqa.clearProxyIpHistory();
      setConfirmClear(false);
      setPage(1);
      setNotice('Proxy/IP History cleared. Proxy configurations and Run Center history were not changed.');
      setRefreshKey((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function exportCsv() {
    if (!window.orbitqa?.exportProxyIpHistoryCsv) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const csv = await window.orbitqa.exportProxyIpHistoryCsv(query);
      const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
      if (typeof URL.createObjectURL === 'function') {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `orbitqa-proxy-ip-history-${new Date().toISOString().slice(0,10)}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
      }
      setNotice(`Exported ${result.total} filtered Proxy/IP History row${result.total === 1 ? '' : 's'}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  return <div className="proxy-ip-history-page">
    <section className="hero proxy-ip-history-hero">
      <div><span className="section-kicker">NETWORK HISTORY</span><h2>Proxy IP History</h2><p>See each proxy exit IP OrbitQA observed, how often it repeated in a Run, and how often it has appeared across runs.</p></div>
      <div className="proxy-ip-history-actions"><button type="button" className="secondary-button" onClick={() => void exportCsv()} disabled={busy || result.total === 0}>Export CSV</button><button type="button" className="danger-button" onClick={() => setConfirmClear(true)} disabled={busy || result.total === 0}>Clear History</button></div>
    </section>

    <section className="panel proxy-ip-history-recording" aria-label="Proxy IP History recording">
      <div><span className="section-kicker">PROXY IP HISTORY RECORDING</span><strong>{recordingState == null ? 'LOADING' : recordingState.recordingEnabled ? 'ACTIVE' : 'INACTIVE'}</strong><p>{recordingState == null ? 'Reading the confirmed recording state from OrbitQA Desktop.' : recordingState.recordingEnabled ? 'OrbitQA records new exit-IP observations from Run.' : 'History is view-only. New Run observations are not being recorded.'}</p></div>
      <div className="proxy-ip-history-recording-actions"><button type="button" aria-label="Set Proxy IP History recording ACTIVE" disabled={recordingBusy || recordingState == null || recordingState.recordingEnabled} onClick={() => void changeRecording(true)}>ACTIVE</button><button type="button" aria-label="Set Proxy IP History recording INACTIVE" disabled={recordingBusy || recordingState == null || !recordingState.recordingEnabled} onClick={() => void changeRecording(false)}>INACTIVE</button></div>
    </section>

    <section className="proxy-ip-history-summary" aria-label="Proxy IP history summary">
      <article><span>Unique IPs</span><strong>{result.summary.uniqueIps}</strong></article>
      <article><span>Repeated IPs</span><strong>{result.summary.repeatedIps}</strong></article>
      <article><span>Countries</span><strong>{result.summary.countries}</strong></article>
      <article><span>Total Observations</span><strong>{result.summary.totalObservations}</strong></article>
    </section>

    {confirmClear && <section className="panel proxy-ip-history-confirm"><div><strong>Clear Proxy/IP History?</strong><span>This removes only IP history aggregates. It does not delete Proxy Manager entries or Run Center history.</span></div><div><button type="button" className="text-button" onClick={() => setConfirmClear(false)}>Cancel</button><button type="button" className="danger-button" onClick={() => void clearHistory()}>Confirm clear</button></div></section>}
    {notice && <div className="proxy-notice">{notice}</div>}
    {error && <div className="run-error" role="alert">{error}</div>}

    <section className="panel proxy-ip-history-panel">
      <div className="proxy-ip-history-filters">
        <label><span>Search IP / proxy</span><input aria-label="Search IP or proxy" type="search" placeholder="IP or proxy identity…" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} /></label>
        <label><span>Country</span><input aria-label="Country filter" placeholder="All countries" value={countryCode} onChange={(event) => { setCountryCode(event.target.value); resetToFirstPage(); }} /></label>
        <label><span>Proxy</span><input aria-label="Proxy filter" placeholder="All proxies" value={proxyIdentity} onChange={(event) => { setProxyIdentity(event.target.value); resetToFirstPage(); }} /></label>
        <label><span>Run</span><input aria-label="Run filter" placeholder="All runs" value={runId} onChange={(event) => { setRunId(event.target.value); resetToFirstPage(); }} /></label>
        <label><span>Repeat status</span><select aria-label="Repeat status" value={repeatFilter} onChange={(event) => { setRepeatFilter(event.target.value as ProxyIpRepeatFilter | ''); resetToFirstPage(); }}><option value="">All IPs</option><option value="repeated-in-run">Repeated in run</option><option value="historically-repeated">Historically repeated</option><option value="new-only">New only</option></select></label>
      </div>

      <div className="proxy-ip-history-table-wrap">
        <table className="proxy-ip-history-table">
          <thead><tr><th>IP</th><th>Country</th><th>Proxy</th><th>Total Seen</th><th>This Run</th><th>Runs Seen</th><th>First Seen</th><th>Last Seen</th><th>Run</th></tr></thead>
          <tbody>{loading ? <tr><td colSpan={9} className="proxy-ip-history-empty">Loading IP history…</td></tr> : result.rows.length === 0 ? <tr><td colSpan={9} className="proxy-ip-history-empty">No matching proxy exit IP observations yet.</td></tr> : result.rows.map((row) => {
            const openRunId = rowRunId(row);
            return <tr key={`${row.proxyIdentity}-${row.observedIp}-${row.runId || 'global'}`}>
              <td><strong>{row.observedIp}</strong><div className="proxy-ip-history-badges">{row.repeatedInRun && <span className="proxy-ip-badge proxy-ip-badge--repeat">REPEATED IN RUN</span>}{row.historicallyRepeated && <span className="proxy-ip-badge proxy-ip-badge--history">HISTORICALLY REPEATED</span>}{!row.repeatedInRun && !row.historicallyRepeated && <span className="proxy-ip-badge proxy-ip-badge--new">NEW</span>}</div></td>
              <td>{row.countryCode || 'Unknown'}</td>
              <td><code>{row.proxyIdentity}</code></td>
              <td>{row.totalSeenCount}×</td>
              <td>{row.seenInRunCount != null ? `${row.seenInRunCount}×` : '—'}</td>
              <td>{row.runsSeenCount}</td>
              <td>{dateTime(row.firstSeenAt)}</td>
              <td>{dateTime(row.lastSeenAt)}</td>
              <td>{openRunId ? <button type="button" className="mini-button" onClick={() => onOpenRun?.(openRunId)}>Open Run</button> : '—'}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      <div className="proxy-ip-history-pagination"><span>Page <strong>{result.page}</strong> of <strong>{result.totalPages}</strong> · {result.total} aggregate row{result.total === 1 ? '' : 's'}</span><div><button type="button" className="text-button" aria-label="Previous" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button type="button" className="text-button" aria-label="Next" disabled={page >= result.totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>
    </section>
  </div>;
}
