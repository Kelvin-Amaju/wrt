import { useEffect, useMemo, useState } from 'react';
import {
  formatMaskedProxyEndpoint,
  type ProxyActivityEntry,
  type ProxyImportResult,
  type ProxyKind,
  type ProxyPublicRecord,
  type ProxySummary,
} from '../shared/proxy';

const PAGE_SIZE = 50;
const EMPTY_SUMMARY: ProxySummary = {
  total: 0, live: 0, slow: 0, dead: 0, unavailable: 0, checking: 0, rotatingLive: 0, rotatingSlow: 0, staticLive: 0, staticSlow: 0,
};

const healthLabels: Record<ProxyPublicRecord['health'], string> = {
  pending: 'Pending', checking: 'Checking', live: 'Live', slow: 'Slow', dead: 'Dead', unavailable: 'Unavailable',
};

function ago(value?: string): string {
  if (!value) return 'Never';
  const diff = Date.now() - Date.parse(value);
  if (!Number.isFinite(diff) || diff < 0) return 'Now';
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

function later(value?: string): string {
  if (!value) return '—';
  const diff = Date.parse(value) - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return 'Due';
  if (diff < 60_000) return `<1m`;
  return `${Math.ceil(diff / 60_000)}m`;
}

export function ProxyManager() {
  const [kind, setKind] = useState<ProxyKind>('rotating');
  const [records, setRecords] = useState<ProxyPublicRecord[]>([]);
  const [summary, setSummary] = useState<ProxySummary>(EMPTY_SUMMARY);
  const [activity, setActivity] = useState<ProxyActivityEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [replacePasswords, setReplacePasswords] = useState(false);
  const [importResult, setImportResult] = useState<ProxyImportResult | null>(null);
  const [editRecord, setEditRecord] = useState<ProxyPublicRecord | null>(null);
  const [editPassword, setEditPassword] = useState('');

  async function refresh(showSpinner = false) {
    if (!window.orbitqa?.listProxies || !window.orbitqa?.getProxySummary || !window.orbitqa?.getProxyActivity) {
      setError('Proxy Manager bridge is unavailable. Run this page inside OrbitQA Desktop.');
      setLoading(false);
      return;
    }
    if (showSpinner) setLoading(true);
    try {
      const [nextRecords, nextSummary, nextActivity] = await Promise.all([
        window.orbitqa.listProxies(kind),
        window.orbitqa.getProxySummary(),
        window.orbitqa.getProxyActivity(),
      ]);
      setRecords(nextRecords);
      setSummary(nextSummary);
      setActivity(nextActivity.slice(0, 80));
      setSelected((current) => new Set([...current].filter((id) => nextRecords.some((record) => record.id === id))));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setSelected(new Set());
    setPage(1);
    void refresh(true);
    const timer = window.setInterval(() => void refresh(false), 5000);
    return () => window.clearInterval(timer);
  }, [kind]);

  const filteredRecords = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((record) => [
      record.protocol, record.hostname, String(record.port), record.username || '', record.observedIp || '',
      record.countryCode || '', record.health,
    ].some((value) => value.toLowerCase().includes(needle)));
  }, [records, filterText]);
  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const pageRecords = useMemo(() => filteredRecords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filteredRecords, page]);
  const allPageSelected = pageRecords.length > 0 && pageRecords.every((record) => selected.has(record.id));

  async function perform(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      if (success) setNotice(success);
      await refresh(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function togglePageSelection() {
    setSelected((current) => {
      const next = new Set(current);
      if (allPageSelected) pageRecords.forEach((record) => next.delete(record.id));
      else pageRecords.forEach((record) => next.add(record.id));
      return next;
    });
  }

  async function submitImport() {
    if (!window.orbitqa?.importProxies || !importText.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await window.orbitqa.importProxies({ text: importText, kind, replacePasswords });
      setImportResult(result);
      setImportText('');
      setNotice(`${result.accepted.length} imported · ${result.duplicates.length} duplicate · ${result.invalid.length} invalid`);
      await refresh(false);
      if (result.invalid.length === 0) setImportOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editRecord || !window.orbitqa?.updateProxy) return;
    const patch = {
      kind: editRecord.kind,
      protocol: editRecord.protocol,
      hostname: editRecord.hostname,
      port: editRecord.port,
      username: editRecord.username || '',
      ...(editPassword ? { password: editPassword } : {}),
    };
    await perform(() => window.orbitqa!.updateProxy(editRecord.id, patch), 'Proxy updated. Health reset if the endpoint changed.');
    setEditRecord(null);
    setEditPassword('');
  }

  async function exportSafe() {
    if (!window.orbitqa?.exportSafeProxies) return;
    setBusy(true);
    try {
      const text = await window.orbitqa.exportSafeProxies({ kind, includeUsernames: true });
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      setNotice(`Safe ${kind} list copied without passwords.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }


  const selectedIds = [...selected];

  return (
    <div className="proxy-manager-page">
      <section className="hero proxy-hero">
        <div>
          <span className="section-kicker">NETWORK CONTROL</span>
          <h2>Verified proxy pools</h2>
          <p>Import, check, classify, and allocate authorized proxies. Only healthy verified entries are eligible for QA runs.</p>
        </div>
        <div className="proxy-hero-actions">
          <button className="secondary-button" type="button" onClick={() => { setImportOpen(true); setImportResult(null); }}>Import</button>
          <button className="primary-button" type="button" onClick={() => { setImportOpen(true); setImportResult(null); }}>+ Add Proxies</button>
        </div>
      </section>

      <section className="proxy-summary-grid" aria-label="Proxy health summary">
        <article><span>Total</span><strong>{summary.total}</strong></article>
        <article><span>Live</span><strong className="proxy-count--live">{summary.live}</strong></article>
        <article><span>Slow</span><strong className="proxy-count--slow">{summary.slow}</strong></article>
        <article><span>Dead</span><strong className="proxy-count--dead">{summary.dead}</strong></article>
        <article><span>Unavailable</span><strong>{summary.unavailable}</strong></article>
        <article><span>Checking</span><strong>{summary.checking}</strong></article>
      </section>

      <section className="panel proxy-table-panel">
        <div className="proxy-toolbar">
          <div className="proxy-tabs" role="tablist" aria-label="Proxy pools">
            <button type="button" className={kind === 'rotating' ? 'active' : ''} onClick={() => setKind('rotating')}>Rotating Pool</button>
            <button type="button" className={kind === 'static' ? 'active' : ''} onClick={() => setKind('static')}>Static Pool</button>
          </div>
          <div className="proxy-toolbar__right">
            <input
              className="proxy-filter"
              aria-label="Filter proxies"
              type="search"
              placeholder="Filter host, IP, country, health…"
              value={filterText}
              onChange={(event) => { setFilterText(event.target.value); setPage(1); }}
            />
            <div className="proxy-actions">
            <button type="button" onClick={() => perform(() => window.orbitqa!.checkProxies(records.map((record) => record.id)), 'Health checking completed.')} disabled={busy || records.length === 0}>Check All</button>
            <button type="button" onClick={() => perform(() => window.orbitqa!.checkProxies(selectedIds), 'Selected proxies checked.')} disabled={busy || selectedIds.length === 0}>Check Selected</button>
            <button type="button" onClick={() => perform(() => window.orbitqa!.recheckDeadProxies(), 'Dead proxies queued for recheck.')} disabled={busy}>Recheck Dead</button>
            <button type="button" onClick={() => perform(() => window.orbitqa!.setProxiesEnabled(selectedIds, true), 'Selected proxies enabled.')} disabled={busy || selectedIds.length === 0}>Enable</button>
            <button type="button" onClick={() => perform(() => window.orbitqa!.setProxiesEnabled(selectedIds, false), 'Selected proxies disabled.')} disabled={busy || selectedIds.length === 0}>Disable</button>
            <button type="button" onClick={() => perform(() => window.orbitqa!.deleteProxies(selectedIds), 'Selected proxies deleted.')} disabled={busy || selectedIds.length === 0}>Delete</button>
            <button type="button" onClick={exportSafe} disabled={busy || records.length === 0}>Export Safe List</button>
            </div>
          </div>
        </div>

        {notice && <div className="proxy-notice">{notice}</div>}
        {error && <div className="run-error" role="alert">{error}</div>}

        <div className="proxy-table-wrap">
          <table className="proxy-table">
            <thead>
              <tr>
                <th><input aria-label="Select page proxies" type="checkbox" checked={allPageSelected} onChange={togglePageSelection} /></th>
                <th>Protocol</th><th>Endpoint</th><th>Exit IP</th><th>Country</th><th>Latency</th><th>Health</th><th>Failures</th><th>Last Check</th><th>Next Check</th><th>Enabled</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} className="proxy-empty">Loading proxy pool…</td></tr>
              ) : pageRecords.length === 0 ? (
                <tr><td colSpan={12} className="proxy-empty">No {kind} proxies yet. Add authorized proxy endpoints to begin health operation.</td></tr>
              ) : pageRecords.map((record) => (
                <tr key={record.id}>
                  <td><input aria-label={`Select ${record.hostname}:${record.port}`} type="checkbox" checked={selected.has(record.id)} onChange={() => toggleSelected(record.id)} /></td>
                  <td><span className="proxy-protocol">{record.protocol.toUpperCase()}</span></td>
                  <td><strong>{formatMaskedProxyEndpoint(record)}</strong>{record.staticIpChangePending && <small className="proxy-warning-text">Exit IP changed</small>}</td>
                  <td>{record.observedIp || '—'}</td>
                  <td>{record.countryCode || '—'}</td>
                  <td>{record.latencyMs == null ? '—' : `${record.latencyMs} ms`}</td>
                  <td><span className={`proxy-health proxy-health--${record.health}`}>{healthLabels[record.health]}</span></td>
                  <td>{record.failureCount}</td>
                  <td>{ago(record.lastCheckedAt)}</td>
                  <td>{later(record.nextCheckAt)}</td>
                  <td><span className={record.enabled ? 'proxy-enabled' : 'proxy-disabled'}>{record.enabled ? 'Yes' : 'No'}</span></td>
                  <td>
                    <div className="proxy-row-actions">
                      <button type="button" onClick={() => perform(() => window.orbitqa!.checkProxy(record.id))} disabled={busy}>Check</button>
                      <button type="button" onClick={() => { setEditRecord({ ...record }); setEditPassword(''); }} disabled={busy}>Edit</button>
                      {record.staticIpChangePending && <button type="button" onClick={() => perform(() => window.orbitqa!.acceptStaticProxyIp(record.id), 'New static IP accepted.')} disabled={busy}>Accept new IP</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="proxy-pagination">
          <span>{filteredRecords.length}{filterText.trim() ? ` of ${records.length}` : ''} record{filteredRecords.length === 1 ? '' : 's'} · {kind === 'rotating' ? summary.rotatingLive : summary.staticLive} live eligible</span>
          <div><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>Previous</button><span>Page {page} / {pageCount}</span><button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={page >= pageCount}>Next</button></div>
        </footer>
      </section>

      <section className="panel proxy-activity-panel">
        <div className="panel__header"><div><span className="section-kicker">HEALTH ACTIVITY</span><h3>Automatic verification</h3></div><span className="status-pill status-pill--soft"><i /> AUTO RETEST</span></div>
        <div className="proxy-activity-list">
          {activity.length === 0 ? <div className="proxy-empty">Health events will appear here after imports and checks.</div> : activity.map((entry) => (
            <div className={`proxy-activity proxy-activity--${entry.level}`} key={entry.id}><time>{ago(entry.timestamp)}</time><p>{entry.message}</p></div>
          ))}
        </div>
      </section>

      {importOpen && (
        <div className="proxy-modal-backdrop" role="presentation">
          <div className="proxy-modal" role="dialog" aria-modal="true" aria-label="Import proxies">
            <div className="panel__header"><div><span className="section-kicker">BULK IMPORT</span><h3>Add to {kind === 'rotating' ? 'Rotating' : 'Static'} Pool</h3></div><button className="text-button" type="button" onClick={() => setImportOpen(false)}>Close</button></div>
            <p>One proxy per line. Supported: host:port, host:port:user:pass, and HTTP/HTTPS/SOCKS5 URLs. Credentials are encrypted locally and never displayed again.</p>
            <textarea aria-label="Proxy import lines" value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={'proxy.example:8080\nhttp://user:pass@proxy.example:8080\nsocks5://user:pass@proxy.example:1080'} spellCheck={false} />
            <label className="check-row"><input type="checkbox" checked={replacePasswords} onChange={(event) => setReplacePasswords(event.target.checked)} /><span>Replace stored password when the same proxy identity already exists</span></label>
            {importResult && <div className="proxy-import-result"><strong>{importResult.accepted.length} imported · {importResult.duplicates.length} duplicate · {importResult.invalid.length} invalid</strong>{importResult.invalid.map((item, index) => <span key={`${item.line}-${index}`}>{item.line}: {item.error}</span>)}</div>}
            <button className="primary-button" type="button" onClick={submitImport} disabled={busy || !importText.trim()}>Import proxies</button>
          </div>
        </div>
      )}

      {editRecord && (
        <div className="proxy-modal-backdrop" role="presentation">
          <div className="proxy-modal" role="dialog" aria-modal="true" aria-label="Edit proxy">
            <div className="panel__header"><div><span className="section-kicker">EDIT PROXY</span><h3>{editRecord.hostname}:{editRecord.port}</h3></div><button className="text-button" type="button" onClick={() => setEditRecord(null)}>Close</button></div>
            <div className="provider-settings-grid">
              <label className="field"><span>Protocol</span><select value={editRecord.protocol} onChange={(event) => setEditRecord({ ...editRecord, protocol: event.target.value as ProxyPublicRecord['protocol'] })}><option value="http">HTTP</option><option value="https">HTTPS</option><option value="socks5">SOCKS5</option></select></label>
              <label className="field"><span>Pool</span><select value={editRecord.kind} onChange={(event) => setEditRecord({ ...editRecord, kind: event.target.value as ProxyKind })}><option value="rotating">Rotating</option><option value="static">Static</option></select></label>
              <label className="field"><span>Host</span><input value={editRecord.hostname} onChange={(event) => setEditRecord({ ...editRecord, hostname: event.target.value })} /></label>
              <label className="field"><span>Port</span><input type="number" min="1" max="65535" value={editRecord.port} onChange={(event) => setEditRecord({ ...editRecord, port: Number(event.target.value) })} /></label>
              <label className="field"><span>Username</span><input value={editRecord.username || ''} onChange={(event) => setEditRecord({ ...editRecord, username: event.target.value })} autoComplete="off" /></label>
              <label className="field"><span>New password</span><input type="password" value={editPassword} onChange={(event) => setEditPassword(event.target.value)} placeholder={editRecord.hasPassword ? 'Stored securely · leave blank to keep' : 'Optional'} autoComplete="new-password" /></label>
            </div>
            <button className="primary-button" type="button" onClick={saveEdit} disabled={busy}>Save proxy</button>
          </div>
        </div>
      )}
    </div>
  );
}
