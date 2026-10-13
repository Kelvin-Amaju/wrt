import type { QaDeviceMatrixConfig } from '../shared/qaMatrix';
import { ANDROID_EMULATION_PROFILES, IOS_DEVICE_PROFILES } from '../shared/mobileDevices';
import type { ProxySummary } from '../shared/proxy';
import type { RealIosProviderPublicConfig, RealIosProviderStatus } from '../shared/realIos';

type Props = {
  value: QaDeviceMatrixConfig;
  onChange: (value: QaDeviceMatrixConfig) => void;
  androidAvds: string[];
  proxySummary: ProxySummary;
  realIosConfig: RealIosProviderPublicConfig | null;
  realIosStatus: RealIosProviderStatus | null;
  chromeRuntimeFound?: boolean | null;
  braveRuntimeFound?: boolean | null;
  disabled?: boolean;
};

function toggleString(values: string[], item: string, checked: boolean): string[] {
  if (checked) return values.includes(item) ? values : [...values, item];
  return values.filter((value) => value !== item);
}

export function DeviceMatrixEditor({ value, onChange, androidAvds, realIosConfig, realIosStatus, chromeRuntimeFound = null, braveRuntimeFound = null, disabled = false }: Props) {
  const setFamily = <K extends keyof QaDeviceMatrixConfig>(family: K, patch: Partial<QaDeviceMatrixConfig[K]>) => {
    onChange({ ...value, [family]: { ...value[family], ...patch } });
  };

  const enableRealIos = (enabled: boolean) => {
    const current = value.realIos.selections;
    const fallback = realIosConfig
      ? [{ device: realIosConfig.defaultDevice, iosVersion: realIosConfig.defaultIosVersion, browser: realIosConfig.defaultBrowser }]
      : [];
    setFamily('realIos', { enabled, selections: enabled && current.length === 0 ? fallback : current });
  };

  const realSelection = value.realIos.selections[0] || {
    device: realIosConfig?.defaultDevice || '',
    iosVersion: realIosConfig?.defaultIosVersion || '',
    browser: realIosConfig?.defaultBrowser || 'safari',
  };

  return (
    <div className="device-matrix-editor">
      <div className="device-family-picker" role="group" aria-label="Device families">
        <label className="check-row"><input aria-label="Desktop" type="checkbox" checked={value.desktop.enabled} onChange={(event) => setFamily('desktop', { enabled: event.target.checked })} disabled={disabled} /><span><strong>Desktop</strong><small>Real Chrome default · compatibility engines available</small></span></label>
        <label className="check-row"><input aria-label="Android mobile emulation" type="checkbox" checked={value.androidEmulation.enabled} onChange={(event) => setFamily('androidEmulation', { enabled: event.target.checked })} disabled={disabled} /><span><strong>Android mobile emulation</strong><small>Real Chrome with Android profiles by default</small></span></label>
        <label className="check-row"><input aria-label="Local iPhone/iPad Compatibility" type="checkbox" checked={value.iosEmulation.enabled} onChange={(event) => setFamily('iosEmulation', { enabled: event.target.checked })} disabled={disabled} /><span><strong>Local iPhone/iPad Compatibility</strong><small>Real Chrome emulation or WebKit compatibility</small></span></label>
        <label className="check-row"><input aria-label="Android AVD" type="checkbox" checked={value.androidAvd.enabled} onChange={(event) => setFamily('androidAvd', { enabled: event.target.checked })} disabled={disabled || androidAvds.length === 0} /><span><strong>Android AVD</strong><small>{androidAvds.length ? `${androidAvds.length} AVD(s) detected` : 'No AVD detected'}</small></span></label>
        <label className="check-row"><input aria-label="Real iOS Provider" type="checkbox" checked={value.realIos.enabled} onChange={(event) => enableRealIos(event.target.checked)} disabled={disabled || !realIosConfig || realIosStatus?.authenticated === false} /><span><strong>Real iOS Provider</strong><small>{realIosConfig ? realIosStatus?.authenticated === false ? 'Provider not ready' : 'Provider configured' : 'Configure provider in Settings'}</small></span></label>
      </div>

      {chromeRuntimeFound === false && <p className="editor-message editor-message--warning" role="status">Google Chrome not found</p>}
      {braveRuntimeFound === false && <p className="editor-message editor-message--warning" role="status">Brave not found</p>}

      {value.desktop.enabled && (
        <section className="device-family-card">
          <div className="device-family-card__title"><span>DESKTOP</span><strong>{value.desktop.browsers.length} browser(s)</strong></div><label className="check-row"><input aria-label="Desktop use cookie" type="checkbox" checked={value.desktop.useCookies} onChange={(event) => setFamily('desktop', { useCookies:event.target.checked })} disabled={disabled}/><span><strong>Use Cookie</strong><small>Random enabled Cookie Manager entry is preloaded before navigation, regardless of target site</small></span></label>
          <div className="choice-grid">
            {([
              ['chrome-installed', 'Google Chrome — REAL', 'Installed Google Chrome · default'],
              ['brave-installed', 'Brave — REAL', 'Installed Brave Browser'],
              ['chromium', 'Chromium — Compatibility', 'Playwright bundled Chromium'],
              ['firefox', 'Firefox — Compatibility', 'Playwright Firefox'],
              ['webkit', 'WebKit — Compatibility', 'Playwright WebKit'],
            ] as const).map(([browser, label, detail]) => (
              <label className="check-row" key={browser}><input aria-label={label} type="checkbox" checked={value.desktop.browsers.includes(browser)} onChange={(event) => setFamily('desktop', { browsers: toggleString(value.desktop.browsers, browser, event.target.checked) as typeof value.desktop.browsers })} disabled={disabled} /><span><strong>{label}</strong><small>{detail}</small></span></label>
            ))}
          </div>
          <div className="form-grid matrix-run-settings">
            <label className="field"><span>Instances per browser</span><input aria-label="Desktop instances per browser" type="number" min="1" value={value.desktop.instancesPerBrowser} onChange={(event) => setFamily('desktop', { instancesPerBrowser: Number(event.target.value) })} disabled={disabled} /></label>
            <label className="field"><span>Session duration (seconds)</span><input aria-label="Desktop session duration" type="number" min="5" max="600" value={value.desktop.sessionDurationSeconds} onChange={(event) => setFamily('desktop', { sessionDurationSeconds: Number(event.target.value) })} disabled={disabled} /></label>
          </div>
        </section>
      )}

      {value.androidEmulation.enabled && (
        <section className="device-family-card">
          <div className="device-family-card__title"><span>ANDROID MOBILE</span><strong>Chrome runtime + Android profile</strong></div><label className="check-row"><input aria-label="Android mobile use cookie" type="checkbox" checked={value.androidEmulation.useCookies} onChange={(event) => setFamily('androidEmulation', { useCookies:event.target.checked })} disabled={disabled}/><span><strong>Use Cookie</strong><small>Random enabled Cookie Manager entry is preloaded before navigation, regardless of target site</small></span></label>
          <div className="choice-grid runtime-choice-grid" role="radiogroup" aria-label="Android mobile browser runtime">
            <label className="check-row"><input aria-label="Android Google Chrome — REAL" type="radio" name="android-browser-runtime" checked={value.androidEmulation.browserRuntime === 'chrome-installed'} onChange={() => setFamily('androidEmulation', { browserRuntime: 'chrome-installed' })} disabled={disabled} /><span><strong>Google Chrome — REAL / Default</strong><small>Installed desktop Chrome with Android mobile emulation</small></span></label>
            <label className="check-row"><input aria-label="Android Brave — REAL" type="radio" name="android-browser-runtime" checked={value.androidEmulation.browserRuntime === 'brave-installed'} onChange={() => setFamily('androidEmulation', { browserRuntime: 'brave-installed' })} disabled={disabled} /><span><strong>Brave — REAL</strong><small>Installed Brave with the same Android mobile emulation profile</small></span></label>
            <label className="check-row"><input aria-label="Android Chromium — Compatibility" type="radio" name="android-browser-runtime" checked={value.androidEmulation.browserRuntime === 'chromium-playwright'} onChange={() => setFamily('androidEmulation', { browserRuntime: 'chromium-playwright' })} disabled={disabled} /><span><strong>Chromium — Compatibility</strong><small>Playwright bundled Chromium with the same Android profile</small></span></label>
          </div>
          <div className="choice-grid">
            {ANDROID_EMULATION_PROFILES.map((profile) => (
              <label className="check-row" key={profile.name}><input aria-label={profile.name} type="checkbox" checked={value.androidEmulation.profiles.includes(profile.name)} onChange={(event) => setFamily('androidEmulation', { profiles: toggleString(value.androidEmulation.profiles, profile.name, event.target.checked) })} disabled={disabled} /><span><strong>{profile.name}</strong><small>{profile.viewport.width}×{profile.viewport.height}</small></span></label>
            ))}
          </div>
          <div className="form-grid matrix-run-settings">
            <label className="field"><span>Instances per profile</span><input aria-label="Android mobile instances per profile" type="number" min="1" value={value.androidEmulation.instancesPerProfile} onChange={(event) => setFamily('androidEmulation', { instancesPerProfile: Number(event.target.value) })} disabled={disabled} /></label>
            <label className="field"><span>Session duration (seconds)</span><input aria-label="Android mobile session duration" type="number" min="5" max="600" value={value.androidEmulation.sessionDurationSeconds} onChange={(event) => setFamily('androidEmulation', { sessionDurationSeconds: Number(event.target.value) })} disabled={disabled} /></label>
          </div>
        </section>
      )}

      {value.iosEmulation.enabled && (
        <section className="device-family-card">
          <div className="device-family-card__title"><span>LOCAL IPHONE / IPAD</span><strong>Compatibility emulation</strong></div><label className="check-row"><input aria-label="Local iOS use cookie" type="checkbox" checked={value.iosEmulation.useCookies} onChange={(event) => setFamily('iosEmulation', { useCookies:event.target.checked })} disabled={disabled}/><span><strong>Use Cookie</strong><small>Random enabled Cookie Manager entry is preloaded before navigation, regardless of target site</small></span></label>
          <div className="choice-grid">
            <label className="check-row"><input aria-label="iPhone/iPad Google Chrome — REAL" type="checkbox" checked={value.iosEmulation.browsers.includes('chrome-installed')} onChange={(event) => setFamily('iosEmulation', { browsers: toggleString(value.iosEmulation.browsers, 'chrome-installed', event.target.checked) as typeof value.iosEmulation.browsers })} disabled={disabled} /><span><strong>Google Chrome — REAL / Default</strong><small>Installed desktop Chrome with iPhone/iPad emulation</small></span></label>
            <label className="check-row"><input aria-label="iPhone/iPad Brave — REAL" type="checkbox" checked={value.iosEmulation.browsers.includes('brave-installed')} onChange={(event) => setFamily('iosEmulation', { browsers: toggleString(value.iosEmulation.browsers, 'brave-installed', event.target.checked) as typeof value.iosEmulation.browsers })} disabled={disabled} /><span><strong>Brave — REAL</strong><small>Installed Brave with iPhone/iPad compatibility emulation</small></span></label>
            <label className="check-row"><input aria-label="WebKit — iOS/Safari Compatibility" type="checkbox" checked={value.iosEmulation.browsers.includes('safari-ios')} onChange={(event) => setFamily('iosEmulation', { browsers: toggleString(value.iosEmulation.browsers, 'safari-ios', event.target.checked) as typeof value.iosEmulation.browsers })} disabled={disabled} /><span><strong>WebKit — iOS/Safari Compatibility</strong><small>Playwright WebKit compatibility engine</small></span></label>
            <label className="check-row"><input aria-label="Chrome iOS Identity — WebKit Compatibility" type="checkbox" checked={value.iosEmulation.browsers.includes('chrome-ios')} onChange={(event) => setFamily('iosEmulation', { browsers: toggleString(value.iosEmulation.browsers, 'chrome-ios', event.target.checked) as typeof value.iosEmulation.browsers })} disabled={disabled} /><span><strong>Chrome iOS Identity — WebKit Compatibility</strong><small>Legacy compatibility identity preserved</small></span></label>
          </div>
          <div className="choice-grid choice-grid--profiles">
            {IOS_DEVICE_PROFILES.map((profile) => (
              <label className="check-row" key={profile.name}><input aria-label={profile.name} type="checkbox" checked={value.iosEmulation.profiles.includes(profile.name)} onChange={(event) => setFamily('iosEmulation', { profiles: toggleString(value.iosEmulation.profiles, profile.name, event.target.checked) })} disabled={disabled} /><span><strong>{profile.name}</strong><small>{profile.viewport.width}×{profile.viewport.height}</small></span></label>
            ))}
          </div>
          <div className="form-grid matrix-run-settings">
            <label className="field"><span>Instances per profile/browser</span><input aria-label="Local iOS instances per profile" type="number" min="1" value={value.iosEmulation.instancesPerProfile} onChange={(event) => setFamily('iosEmulation', { instancesPerProfile: Number(event.target.value) })} disabled={disabled} /></label>
            <label className="field"><span>Session duration (seconds)</span><input aria-label="Local iOS session duration" type="number" min="5" max="600" value={value.iosEmulation.sessionDurationSeconds} onChange={(event) => setFamily('iosEmulation', { sessionDurationSeconds: Number(event.target.value) })} disabled={disabled} /></label>
            <label className="field"><span>Orientation</span><select aria-label="Local iOS orientation" value={value.iosEmulation.orientation} onChange={(event) => setFamily('iosEmulation', { orientation: event.target.value === 'landscape' ? 'landscape' : 'portrait' })} disabled={disabled}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
          </div>
        </section>
      )}

      {value.androidAvd.enabled && (
        <section className="device-family-card">
          <div className="device-family-card__title"><span>ANDROID AVD</span><strong>Google Chrome Android · com.android.chrome · REAL CHROME APP</strong></div><label className="check-row"><input aria-label="Android AVD use cookie" type="checkbox" checked={value.androidAvd.useCookies} onChange={(event) => setFamily('androidAvd', { useCookies:event.target.checked })} disabled={disabled}/><span><strong>Use Cookie</strong><small>Random enabled Cookie Manager entry is preloaded before navigation, regardless of target site</small></span></label>
          <div className="choice-grid">
            {androidAvds.map((avd) => <label className="check-row" key={avd}><input aria-label={`AVD ${avd}`} type="checkbox" checked={value.androidAvd.avdNames.includes(avd)} onChange={(event) => setFamily('androidAvd', { avdNames: toggleString(value.androidAvd.avdNames, avd, event.target.checked) })} disabled={disabled} /><span><strong>{avd}</strong></span></label>)}
          </div>
          <label className="field"><span>Session duration (seconds)</span><input aria-label="Android AVD session duration" type="number" min="5" max="600" value={value.androidAvd.sessionDurationSeconds} onChange={(event) => setFamily('androidAvd', { sessionDurationSeconds: Number(event.target.value) })} disabled={disabled} /></label>
          <p className="editor-message">Proxy routing is unavailable for the integrated AVD path.</p>
        </section>
      )}

      {value.realIos.enabled && (
        <section className="device-family-card">
          <div className="device-family-card__title"><span>REAL IOS PROVIDER</span><strong>{realIosConfig?.providerName || 'Provider'}</strong></div><p className="editor-message">Cookie Manager injection is unavailable through the current remote provider API.</p>
          <div className="form-grid matrix-run-settings">
            <label className="field"><span>Device</span><input aria-label="Real iOS device" value={realSelection.device} onChange={(event) => setFamily('realIos', { selections: [{ ...realSelection, device: event.target.value }] })} disabled={disabled} /></label>
            <label className="field"><span>iOS version</span><input aria-label="Real iOS version" value={realSelection.iosVersion} onChange={(event) => setFamily('realIos', { selections: [{ ...realSelection, iosVersion: event.target.value }] })} disabled={disabled} /></label>
            <label className="field"><span>Browser</span><select aria-label="Real iOS browser" value={realSelection.browser} onChange={(event) => setFamily('realIos', { selections: [{ ...realSelection, browser: event.target.value === 'chrome' ? 'chrome' : 'safari' }] })} disabled={disabled}><option value="safari">Safari</option><option value="chrome" disabled={realIosStatus?.chromeSupported === false}>Chrome iOS</option></select></label>
            <label className="field"><span>Session duration (seconds)</span><input aria-label="Real iOS session duration" type="number" min="5" max="600" value={value.realIos.sessionDurationSeconds} onChange={(event) => setFamily('realIos', { sessionDurationSeconds: Number(event.target.value) })} disabled={disabled} /></label>
          </div>
          <p className="editor-message">Proxy routing is unavailable for provider-backed Real iOS sessions.</p>
        </section>
      )}
    </div>
  );
}
