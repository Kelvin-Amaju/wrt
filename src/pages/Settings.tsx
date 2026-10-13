import { useEffect, useState } from 'react';
import {
  validateProviderSaveRequest,
  type RealIosBrowser,
  type RealIosProviderPublicConfig,
  type RealIosProviderSaveRequest,
  type RealIosProviderStatus,
} from '../shared/realIos';

const EMPTY_FORM: RealIosProviderSaveRequest = {
  providerName: '',
  remoteUrl: '',
  username: '',
  accessKey: '',
  defaultDevice: 'iPhone 15',
  defaultIosVersion: '17',
  defaultBrowser: 'safari',
};

export function Settings() {
  const [form, setForm] = useState<RealIosProviderSaveRequest>(EMPTY_FORM);
  const [publicConfig, setPublicConfig] = useState<RealIosProviderPublicConfig | null>(null);
  const [status, setStatus] = useState<RealIosProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const config = await window.orbitqa?.getRealIosProviderConfig?.();
        if (!alive || !config) return;
        setPublicConfig(config);
        setForm({
          providerName: config.providerName,
          remoteUrl: config.remoteUrl,
          username: config.username,
          accessKey: '',
          defaultDevice: config.defaultDevice,
          defaultIosVersion: config.defaultIosVersion,
          defaultBrowser: config.defaultBrowser,
        });
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => { alive = false; };
  }, []);

  function update<K extends keyof RealIosProviderSaveRequest>(key: K, value: RealIosProviderSaveRequest[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    setError('');
    setMessage('');
    const validation = validateProviderSaveRequest(form);
    if (validation.ok === false) {
      setError(validation.error);
      return;
    }
    if (!window.orbitqa?.saveRealIosProviderConfig) {
      setError('Real iOS provider bridge is unavailable');
      return;
    }
    setBusy(true);
    try {
      const saved = await window.orbitqa.saveRealIosProviderConfig(form);
      setPublicConfig(saved);
      setForm((current) => ({ ...current, accessKey: '' }));
      setStatus(null);
      setMessage('Provider settings saved securely.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function checkConnection() {
    setError('');
    setMessage('');
    if (!window.orbitqa?.checkRealIosProvider) {
      setError('Real iOS provider bridge is unavailable');
      return;
    }
    setBusy(true);
    try {
      const next = await window.orbitqa.checkRealIosProvider();
      setStatus(next);
      setMessage(next.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-page">
      <section className="hero settings-hero">
        <div>
          <span className="section-kicker">PREFERENCES</span>
          <h2>Settings</h2>
          <p>Configure local OrbitQA behavior and optional provider-backed real iOS operation.</p>
        </div>
        <span className="status-pill status-pill--soft"><i /> LOCAL FIRST</span>
      </section>

      <section className="panel provider-panel">
        <div className="panel__header">
          <div>
            <span className="section-kicker">REAL iOS PROVIDER</span>
            <h3>Physical / remote iPhone &amp; iPad connector</h3>
          </div>
          <span className={`status-pill ${publicConfig ? '' : 'status-pill--soft'}`}>
            <i /> {publicConfig ? 'CONFIGURED' : 'NOT CONFIGURED'}
          </span>
        </div>

        <div className="provider-settings-grid">
          <label className="field">
            <span>Provider name</span>
            <input aria-label="Provider name" value={form.providerName} onChange={(event) => update('providerName', event.target.value)} placeholder="Device Cloud" disabled={loading || busy} />
          </label>
          <label className="field provider-field--wide">
            <span>Remote WebDriver / Appium URL</span>
            <input aria-label="Remote WebDriver URL" value={form.remoteUrl} onChange={(event) => update('remoteUrl', event.target.value)} placeholder="https://provider.example/wd/hub" disabled={loading || busy} />
          </label>
          <label className="field">
            <span>Username</span>
            <input aria-label="Provider username" value={form.username} onChange={(event) => update('username', event.target.value)} placeholder="Optional" disabled={loading || busy} />
          </label>
          <label className="field">
            <span>Access key / token</span>
            <input aria-label="Access key" type="password" value={form.accessKey} onChange={(event) => update('accessKey', event.target.value)} placeholder={publicConfig?.credentialsSaved ? 'Saved securely — leave blank to keep' : 'Optional if provider does not require one'} autoComplete="off" disabled={loading || busy} />
          </label>
          <label className="field">
            <span>Default iOS device model</span>
            <input aria-label="Default iOS device model" value={form.defaultDevice} onChange={(event) => update('defaultDevice', event.target.value)} placeholder="iPhone 15" disabled={loading || busy} />
          </label>
          <label className="field">
            <span>Default iOS version</span>
            <input aria-label="Default iOS version" value={form.defaultIosVersion} onChange={(event) => update('defaultIosVersion', event.target.value)} placeholder="17" disabled={loading || busy} />
          </label>
          <label className="field">
            <span>Default browser</span>
            <select aria-label="Default iOS browser" value={form.defaultBrowser} onChange={(event) => update('defaultBrowser', event.target.value as RealIosBrowser)} disabled={loading || busy}>
              <option value="safari">Safari iOS</option>
              <option value="chrome">Chrome iOS</option>
            </select>
          </label>
        </div>

        <div className="provider-actions">
          <button className="primary-button" type="button" onClick={() => void save()} disabled={loading || busy}>SAVE PROVIDER SETTINGS</button>
          <button className="secondary-button" type="button" onClick={() => void checkConnection()} disabled={loading || busy || !publicConfig}>CHECK CONNECTION</button>
          <div className="credential-state">
            <span>Credentials</span>
            <strong>{publicConfig?.credentialsSaved ? 'Credentials saved' : 'No stored access key'}</strong>
          </div>
        </div>

        {status && (
          <div className="provider-status-grid" aria-label="Real iOS provider status">
            <div><span>Configuration</span><strong>{status.configured ? 'Configured' : 'Not configured'}</strong></div>
            <div><span>Connection</span><strong className={status.reachable ? 'ok' : 'bad'}>{status.reachable ? 'Reachable' : 'Unreachable'}</strong></div>
            <div><span>Authentication</span><strong className={status.authenticated ? 'ok' : 'bad'}>{status.authenticated ? 'Authenticated' : 'Authentication rejected'}</strong></div>
            <div><span>Safari</span><strong className={status.safariSupported ? 'ok' : 'bad'}>{status.safariSupported ? 'Safari Supported' : 'Safari Unsupported'}</strong></div>
            <div><span>Chrome iOS</span><strong className={status.chromeSupported ? 'ok' : 'bad'}>{status.chromeSupported ? 'Chrome iOS Supported' : 'Chrome iOS Unsupported'}</strong></div>
          </div>
        )}

        <div className="setup-card provider-security-note">
          <strong>Credential safety</strong>
          <p>OrbitQA stores the access key with Electron secure storage when available and never loads the secret back into this page. Provider endpoints must use HTTPS, except localhost for development.</p>
        </div>

        {message && <div className="inline-message inline-message--ok">{message}</div>}
        {error && <div className="run-error" role="alert">{error}</div>}
      </section>
    </div>
  );
}
