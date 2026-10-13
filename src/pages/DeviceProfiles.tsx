import { useEffect, useMemo, useState } from 'react';
import { IOS_DEVICE_PROFILES, iosBrowserLabel, type MobileStatus } from '../shared/mobileDevices';

type ProfileTab = 'desktop' | 'android' | 'ios-local' | 'ios-real';

const EMPTY_STATUS: MobileStatus = {
  sdkPath: null,
  adbPath: null,
  emulatorPath: null,
  adbAvailable: false,
  emulatorAvailable: false,
  avds: [],
  devices: [],
  error: null,
};

export function DeviceProfiles() {
  const [tab, setTab] = useState<ProfileTab>('desktop');
  const [status, setStatus] = useState<MobileStatus>(EMPTY_STATUS);
  const [selectedAvd, setSelectedAvd] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const runningEmulator = useMemo(
    () => status.devices.find((device) => device.serial.startsWith('emulator-') && device.state === 'device'),
    [status.devices],
  );

  async function refreshAndroid() {
    if (!window.orbitqa?.getMobileStatus) {
      setError('Android bridge is unavailable. Run Device Profiles inside OrbitQA Desktop.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = await window.orbitqa.getMobileStatus();
      setStatus(next);
      if (!selectedAvd && next.avds[0]) setSelectedAvd(next.avds[0]);
      if (next.error) setError(next.error);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (tab === 'android') void refreshAndroid();
    // Only refresh when the Android tab is intentionally opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function launchSelectedAvd() {
    if (!selectedAvd || !window.orbitqa?.launchAvd) return;
    setBusy(true);
    setError('');
    setMessage(`Launching ${selectedAvd}…`);
    try {
      const result = await window.orbitqa.launchAvd(selectedAvd);
      setMessage(result.alreadyRunning ? `${selectedAvd} is already ready.` : `${selectedAvd} is ready.`);
      await refreshAndroid();
    } catch (cause) {
      setMessage('');
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function stopRunningAvd() {
    if (!runningEmulator || !window.orbitqa?.stopAvd) return;
    setBusy(true);
    setError('');
    setMessage(`Stopping ${runningEmulator.serial}…`);
    try {
      await window.orbitqa.stopAvd(runningEmulator.serial);
      setMessage('Android virtual phone stopped.');
      await refreshAndroid();
    } catch (cause) {
      setMessage('');
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="device-profiles-page">
      <section className="hero device-hero">
        <div>
          <span className="section-kicker">COMPATIBILITY LAB</span>
          <h2>Device checking profiles</h2>
          <p>Run desktop browsers, a real Android virtual phone, local iOS compatibility profiles, or provider-backed real iOS devices from one workspace.</p>
        </div>
        <span className="status-pill status-pill--soft"><i /> WINDOWS V1</span>
      </section>

      <div className="device-tabs" role="tablist" aria-label="Device profile categories">
        <button type="button" className={tab === 'desktop' ? 'active' : ''} onClick={() => setTab('desktop')}>Desktop</button>
        <button type="button" className={tab === 'android' ? 'active' : ''} onClick={() => setTab('android')}>Android Virtual Device</button>
        <button type="button" className={tab === 'ios-local' ? 'active' : ''} onClick={() => setTab('ios-local')}>Local iOS Compatibility</button>
        <button type="button" className={tab === 'ios-real' ? 'active' : ''} onClick={() => setTab('ios-real')}>Real iOS Device</button>
      </div>

      {tab === 'desktop' && (
        <section className="device-grid">
          <article className="panel device-card">
            <span className="device-card__tag">DESKTOP</span>
            <h3>Chromium</h3>
            <p>Chrome/Edge-style desktop QA with the Chromium browser engine.</p>
            <strong>Installed engine</strong>
          </article>
          <article className="panel device-card">
            <span className="device-card__tag">DESKTOP</span>
            <h3>Brave</h3>
            <p>Installed Brave Browser using the same OrbitQA device, proxy, cookie and background worker policies.</p>
            <strong>Installed browser</strong>
          </article>
          <article className="panel device-card">
            <span className="device-card__tag">DESKTOP</span>
            <h3>Firefox</h3>
            <p>Mozilla Firefox desktop rendering and interaction operation.</p>
            <strong>Installed engine</strong>
          </article>
          <article className="panel device-card">
            <span className="device-card__tag">DESKTOP</span>
            <h3>WebKit</h3>
            <p>WebKit browser engine checking on Windows.</p>
            <strong>Installed engine</strong>
          </article>
        </section>
      )}

      {tab === 'android' && (
        <section className="android-layout">
          <article className="panel android-status-panel">
            <div className="panel__header">
              <div><span className="section-kicker">REAL VIRTUAL PHONE</span><h3>Android SDK & emulator</h3></div>
              <button className="secondary-button" type="button" onClick={() => void refreshAndroid()} disabled={busy}>Refresh Devices</button>
            </div>

            <div className="mobile-status-grid">
              <div><span>Android SDK</span><strong className={status.sdkPath ? 'ok' : 'bad'}>{status.sdkPath ? 'Detected' : 'Not detected'}</strong></div>
              <div><span>ADB</span><strong className={status.adbAvailable ? 'ok' : 'bad'}>{status.adbAvailable ? 'Ready' : 'Missing'}</strong></div>
              <div><span>Emulator</span><strong className={status.emulatorAvailable ? 'ok' : 'bad'}>{status.emulatorAvailable ? 'Ready' : 'Missing'}</strong></div>
              <div><span>Device state</span><strong className={runningEmulator ? 'ok' : ''}>{runningEmulator ? `Ready · ${runningEmulator.serial}` : 'Stopped'}</strong></div>
            </div>

            {status.sdkPath && <div className="path-box"><span>SDK path</span><code>{status.sdkPath}</code></div>}

            {!status.sdkPath ? (
              <div className="setup-card">
                <strong>Android setup required</strong>
                <p>Install Android Studio, Android SDK Platform Tools, Android Emulator, then create one virtual device in Device Manager. Return here and press Refresh Devices.</p>
              </div>
            ) : status.avds.length === 0 ? (
              <div className="setup-card">
                <strong>No Android virtual devices found</strong>
                <p>Create one AVD in Android Studio → Device Manager, then return to OrbitQA and refresh.</p>
              </div>
            ) : (
              <div className="avd-control-row">
                <label className="field">
                  <span>Installed virtual phone</span>
                  <select aria-label="Android virtual device" value={selectedAvd} onChange={(event) => setSelectedAvd(event.target.value)}>
                    {status.avds.map((avd) => <option key={avd} value={avd}>{avd}</option>)}
                  </select>
                </label>
                <button className="primary-button" type="button" onClick={() => void launchSelectedAvd()} disabled={busy || !selectedAvd}>Launch Virtual Phone</button>
                <button className="danger-button" type="button" onClick={() => void stopRunningAvd()} disabled={busy || !runningEmulator}>Stop Virtual Phone</button>
              </div>
            )}

            {message && <div className="inline-message inline-message--ok">{message}</div>}
            {error && <div className="run-error" role="alert">{error}</div>}
          </article>

          <article className="panel android-note-panel">
            <span className="section-kicker">NATIVE RUNTIME FIDELITY</span>
            <h3>Native Android runtime</h3>
            <p>OrbitQA controls Chrome inside an ADB-connected Android emulator. The emulator window is a real Android virtual device, not a desktop viewport pretending to be a phone.</p>
            <ul>
              <li>ADB recovery checks common offline emulator states before launch.</li>
              <li>Cold-start-safe launch avoids loading a potentially corrupted quick-boot snapshot.</li>
              <li>Chrome readiness is verified before OrbitQA reports the virtual phone as ready.</li>
              <li>One virtual phone at a time to stay lightweight.</li>
            </ul>
          </article>
        </section>
      )}

      {tab === 'ios-local' && (
        <section className="ios-qa-section">
          <div className="ios-warning">
            <strong>Local iOS Compatibility · Compatibility emulation</strong>
            <span>WebKit-based compatibility checking on Windows, not Apple's real iOS Simulator. OrbitQA reports identity mismatches instead of spoofing hardware fingerprints.</span>
          </div>

          <div className="ios-capability-grid">
            <article className="panel ios-capability-card">
              <span className="section-kicker">BROWSER IDENTITIES</span>
              <h3>Safari + Chrome iOS compatibility</h3>
              <p>{iosBrowserLabel('safari-ios')} keeps the iOS Safari compatibility identity. {iosBrowserLabel('chrome-ios')} uses a CriOS-compatible user-agent identity while the underlying engine remains WebKit.</p>
            </article>
            <article className="panel ios-capability-card">
              <span className="section-kicker">PRIVACY DIAGNOSTICS</span>
              <h3>WebRTC exposure diagnostic</h3>
              <p>Every Local iOS Compatibility run checks touch, viewport, DPR, locale, timezone, navigator platform and literal-IP ICE candidate exposure. Camera and microphone permissions are not granted by OrbitQA.</p>
            </article>
          </div>

          <div className="device-grid device-grid--ios">
            {IOS_DEVICE_PROFILES.map((profile) => (
              <article className="panel device-card" key={profile.name}>
                <span className="device-card__tag">{profile.family}</span>
                <h3>{profile.name}</h3>
                <p>{profile.viewport.width} × {profile.viewport.height} CSS viewport · portrait or landscape</p>
                <div className="device-meta-row"><span>DPR</span><strong>{profile.deviceScaleFactor}×</strong></div>
                <div className="device-meta-row"><span>Touch</span><strong>Enabled</strong></div>
                <div className="device-meta-row"><span>Engine</span><strong>WebKit</strong></div>
                <div className="device-meta-row"><span>Identity QA</span><strong>Runtime checked</strong></div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === 'ios-real' && (
        <section className="ios-qa-section">
          <div className="ios-warning ios-warning--real">
            <strong>Real iOS Device · Real iOS provider</strong>
            <span>Provider-backed physical or remote iPhone/iPad operation. OrbitQA reads what the real browser exposes instead of spoofing Windows into an iPhone fingerprint.</span>
          </div>
          <div className="ios-capability-grid">
            <article className="panel ios-capability-card">
              <span className="section-kicker">REAL DEVICE PROVIDER</span>
              <h3>Safari first, Chrome when supported</h3>
              <p>Connect a WebDriver/Appium-compatible real-device provider in Settings. Safari is the primary V1 browser; Chrome iOS is enabled only when the provider reports support.</p>
            </article>
            <article className="panel ios-capability-card">
              <span className="section-kicker">OBSERVED, NOT SPOOFED</span>
              <h3>Real browser diagnostics</h3>
              <p>OrbitQA records user agent, navigator platform, touch points, viewport, screen, DPR, locale, timezone and WebRTC candidate exposure exactly as the device browser reports them.</p>
            </article>
          </div>
          <article className="panel real-ios-profile-card">
            <span className="section-kicker">SETUP</span>
            <h3>Configure in Settings → Real iOS Provider</h3>
            <p>Save the provider endpoint and credentials securely, check the connection, then choose Real iOS Device in Run. V1 intentionally runs one remote iPhone/iPad session at a time.</p>
          </article>
        </section>
      )}
    </div>
  );
}
