import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  IOS_DEVICE_PROFILES,
  REAL_DEVICE_FLEET_BASE,
  iosBrowserLabel,
  type MobileStatus,
} from '../shared/mobileDevices';

type ProfileTab = 'desktop' | 'android' | 'ios-local' | 'ios-real';

const EMPTY_STATUS: MobileStatus = {
  sdkPath: null,
  adbPath: null,
  emulatorPath: null,
  adbAvailable: false,
  emulatorAvailable: false,
  avds: [],
  devices: [],
  running: [],
  runningSerials: [],
  avdHome: '',
  maxParallel: 20,
  error: null,
};

export function DeviceProfiles() {
  const [tab, setTab] = useState<ProfileTab>('desktop');
  const [status, setStatus] = useState<MobileStatus>(EMPTY_STATUS);
  const [selectedAvd, setSelectedAvd] = useState('');
  const [fleetCount, setFleetCount] = useState(3);
  const [alwaysNew, setAlwaysNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [setup, setSetup] = useState<{ running: boolean; phase: string; log: string; error: string | null }>({ running: false, phase: 'idle', log: '', error: null });
  const [acceptTerms, setAcceptTerms] = useState(false);

  useEffect(() => {
    const bridge = window.orbitqa;
    if (tab !== 'android' || !bridge?.getAndroidSetupState) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let wasRunning = false;
    async function poll() {
      try {
        const next = await bridge!.getAndroidSetupState();
        if (disposed) return;
        setSetup(next);
        if (wasRunning && !next.running) {
          const mobile = await bridge!.getMobileStatus();
          if (disposed) return;
          setStatus(mobile);
          setSelectedAvd((current) => current || mobile.avds[0] || '');
        }
        wasRunning = next.running;
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause));
      }
      if (!disposed) timer = setTimeout(() => void poll(), 1000);
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [tab]);

  async function setupAndroid() {
    if (!acceptTerms || !window.orbitqa?.startAndroidSetup) return;
    setBusy(true);
    setError('');
    setMessage('');
    try { setSetup(await window.orbitqa.startAndroidSetup()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  const runningDevices = useMemo(
    () => status.running.filter((device) => device.serial.startsWith('emulator-')),
    [status.running],
  );

  const refreshAndroid = useCallback(async () => {
    if (!window.orbitqa?.getMobileStatus) {
      setError('Android bridge is unavailable. Run Device Profiles inside OrbitQA Desktop.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = await window.orbitqa.getMobileStatus();
      setStatus(next);
      if (next.error) setError(next.error);
      setSelectedAvd((current) => current || next.avds[0] || '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'android') void refreshAndroid();
  }, [tab, refreshAndroid]);

  async function launchSelectedAvd() {
    if (!selectedAvd || !window.orbitqa?.launchAvd) return;
    setBusy(true);
    setError('');
    setMessage(`Launching ${selectedAvd}…`);
    try {
      const result = await window.orbitqa.launchAvd(selectedAvd, alwaysNew ? { reuse: false } : undefined);
      setMessage(result.alreadyRunning ? `${selectedAvd} is already ready on ${result.serial}.` : `${selectedAvd} is ready on ${result.serial}.`);
      await refreshAndroid();
    } catch (cause) {
      setMessage('');
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function launchFleet() {
    if (!window.orbitqa?.launchAvdFleet) return;
    const count = Math.max(1, Math.min(Number(fleetCount) || 1, status.maxParallel));
    setBusy(true);
    setError('');
    setMessage(`Preparing ${count} virtual phone(s)…`);
    try {
      const result = await window.orbitqa.launchAvdFleet({ count, baseName: REAL_DEVICE_FLEET_BASE });
      setMessage(`${result.devices.length} virtual phone(s) ready: ${result.devices.map((device) => device.serial).join(', ')}`);
      await refreshAndroid();
    } catch (cause) {
      setMessage('');
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function stopDevice(serial: string) {
    if (!window.orbitqa?.stopAvd) return;
    setBusy(true);
    setError('');
    try {
      await window.orbitqa.stopAvd(serial);
      setMessage(`${serial} stopped.`);
      await refreshAndroid();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function stopAllDevices() {
    if (!window.orbitqa?.stopAllAvds) return;
    setBusy(true);
    setError('');
    try {
      const stopped = await window.orbitqa.stopAllAvds();
      setMessage(stopped.length ? `Stopped ${stopped.length} virtual phone(s).` : 'No virtual phones were running.');
      await refreshAndroid();
    } catch (cause) {
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
          <p>Run desktop browsers, real Android virtual phones in parallel, local iOS compatibility profiles, or provider-backed real iOS devices from one workspace.</p>
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
              <button className="secondary-button" type="button" onClick={() => void refreshAndroid()} disabled={busy || setup.running}>Refresh Devices</button>
            </div>

            <div className="mobile-status-grid">
              <div><span>Android SDK</span><strong className={status.sdkPath ? 'ok' : 'bad'}>{status.sdkPath ? 'Detected' : 'Not detected'}</strong></div>
              <div><span>ADB</span><strong className={status.adbAvailable ? 'ok' : 'bad'}>{status.adbAvailable ? 'Ready' : 'Missing'}</strong></div>
              <div><span>Emulator</span><strong className={status.emulatorAvailable ? 'ok' : 'bad'}>{status.emulatorAvailable ? 'Ready' : 'Missing'}</strong></div>
              <div><span>Running</span><strong className={runningDevices.length ? 'ok' : ''}>{runningDevices.length ? `${runningDevices.length} of ${status.maxParallel}` : 'Stopped'}</strong></div>
            </div>

            {status.sdkPath && <div className="path-box"><span>SDK path</span><code>{status.sdkPath}</code></div>}

            {!status.sdkPath ? (
              <div className="setup-card">
                <strong>Android setup required</strong>
                <p>Use the setup below to install the tools and create a virtual phone. Android Studio is not required.</p>
              </div>
            ) : status.avds.length === 0 ? (
              <div className="setup-card">
                <strong>No Android virtual devices found</strong>
                <p>Use the setup below to download the Android image, then launch a fleet to create your virtual phones.</p>
              </div>
            ) : (
              <>
                <div className="avd-control-row">
                  <label className="field">
                    <span>Installed virtual phone</span>
                    <select aria-label="Android virtual device" value={selectedAvd} onChange={(event) => setSelectedAvd(event.target.value)}>
                      {status.avds.map((avd) => <option key={avd} value={avd}>{avd}</option>)}
                    </select>
                  </label>
                  <button className="primary-button" type="button" onClick={() => void launchSelectedAvd()} disabled={busy || setup.running || !selectedAvd}>Launch Virtual Phone</button>
                  <label className="check-row">
                    <input type="checkbox" checked={alwaysNew} onChange={(event) => setAlwaysNew(event.target.checked)} />
                    <span>Always start a new instance</span>
                  </label>
                </div>

                <div className="avd-control-row">
                  <label className="field">
                    <span>Parallel fleet size (max {status.maxParallel})</span>
                    <input
                      aria-label="Parallel fleet size"
                      type="number"
                      min={1}
                      max={status.maxParallel}
                      value={fleetCount}
                      onChange={(event) => setFleetCount(Number(event.target.value))}
                    />
                  </label>
                  <button className="primary-button" type="button" onClick={() => void launchFleet()} disabled={busy || setup.running}>Create &amp; Launch Fleet</button>
                  <button className="danger-button" type="button" onClick={() => void stopAllDevices()} disabled={busy || setup.running || runningDevices.length === 0}>Stop All</button>
                </div>

                {runningDevices.length > 0 && (
                  <table className="pod-profile-table">
                    <thead>
                      <tr><th>Serial</th><th>Virtual phone</th><th>State</th><th /></tr>
                    </thead>
                    <tbody>
                      {runningDevices.map((device) => (
                        <tr key={device.serial}>
                          <td><code>{device.serial}</code></td>
                          <td>{device.avdName || 'unknown'}</td>
                          <td><span className="status-pill status-pill--soft">{device.state}</span></td>
                          <td>
                            <button className="secondary-button" type="button" onClick={() => void stopDevice(device.serial)} disabled={busy}>Stop</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            <div className="setup-card">
              <strong>Set up Android Emulator</strong>
              <p>Downloads Java, Android tools and a system image, then creates OrbitQA_Pixel_7_Real. Requires internet and several GB of free space. Existing virtual phones are preserved.</p>
              <p>If acceleration is unavailable, enable CPU virtualization in BIOS/UEFI and Windows Hypervisor Platform in Windows Features, then restart Windows.</p>
              <label className="check-row"><input type="checkbox" checked={acceptTerms} disabled={setup.running} onChange={(event) => setAcceptTerms(event.target.checked)} /><span>I accept the Android SDK license terms at https://developer.android.com/studio/terms and authorize downloading the required components.</span></label>
              <button className="primary-button" type="button" disabled={busy || setup.running || !acceptTerms} onClick={() => void setupAndroid()}>{setup.running ? 'Setting up Android...' : setup.phase === 'failed' ? 'Retry Android Setup' : 'Set up Android Emulator'}</button>
              {setup.log && <pre aria-label="Android setup progress" role="log" style={{ maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{setup.log}</pre>}
              {setup.error && <div className="run-error" role="alert">{setup.error}</div>}
              {setup.phase === 'complete' && <p role="status">Installation complete. Check the log for any virtualization steps, then launch your virtual phone.</p>}
            </div>
            {message && <div className="inline-message inline-message--ok">{message}</div>}
            {error && <div className="run-error" role="alert">{error}</div>}
          </article>

          <article className="panel android-note-panel">
            <span className="section-kicker">NATIVE RUNTIME FIDELITY</span>
            <h3>Native Android runtime</h3>
            <p>OrbitQA controls Chrome inside ADB-connected Android emulators. Each emulator window is a real Android virtual device with its own writable disk, not a desktop viewport pretending to be a phone.</p>
            <ul>
              <li>Fleet members are separate AVDs, so cookies and history never collide between virtual phones.</li>
              <li>ADB recovery checks common offline emulator states before launch.</li>
              <li>Cold-start-safe launch avoids loading a potentially corrupted quick-boot snapshot.</li>
              <li>Launches are serialised so parallel starts never fight over a console port.</li>
              <li>Every fleet member keeps the Pixel 7 retail build fingerprint.</li>
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