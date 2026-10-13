import {
  createDefaultLaunchGroup,
  createDefaultTargetPlan,
  countMatrixWorkUnits,
  type QaExecutionKind,
  type QaLaunchGroup,
  type QaMatrixBrowser,
  type QaTargetPlan,
} from '../shared/qaMatrix';
import { ANDROID_EMULATION_PROFILES, IOS_DEVICE_PROFILES } from '../shared/mobileDevices';
import type { ProxySource, ProxySummary } from '../shared/proxy';
import type { RealIosProviderPublicConfig, RealIosProviderStatus } from '../shared/realIos';

type Props = {
  targets: QaTargetPlan[];
  onChange: (targets: QaTargetPlan[]) => void;
  androidAvds: string[];
  proxySummary: ProxySummary;
  realIosConfig: RealIosProviderPublicConfig | null;
  realIosStatus: RealIosProviderStatus | null;
  disabled?: boolean;
};

function replaceTarget(targets: QaTargetPlan[], index: number, next: QaTargetPlan): QaTargetPlan[] {
  return targets.map((target, targetIndex) => targetIndex === index ? next : target);
}

function replaceGroup(target: QaTargetPlan, groupIndex: number, next: QaLaunchGroup): QaTargetPlan {
  return { ...target, groups: target.groups.map((group, index) => index === groupIndex ? next : group) };
}

function browserOptions(kind: QaExecutionKind): Array<{ value: QaMatrixBrowser; label: string }> {
  switch (kind) {
    case 'android-emulation':
    case 'android-avd':
      return [{ value: 'chrome-android', label: 'Chrome Android' }];
    case 'ios-emulation':
      return [
        { value: 'chrome-installed', label: 'Google Chrome — iPhone/iPad Emulation' },
        { value: 'safari-ios', label: 'Safari iOS Compatibility' },
        { value: 'chrome-ios', label: 'Chrome iOS Compatibility' },
      ];
    case 'real-ios':
      return [
        { value: 'safari-ios', label: 'Safari iOS' },
        { value: 'chrome-ios', label: 'Chrome iOS' },
      ];
    default:
      return [
        { value: 'chrome-installed', label: 'Google Chrome — REAL / Default' },
        { value: 'chromium', label: 'Chromium' },
        { value: 'firefox', label: 'Firefox' },
        { value: 'webkit', label: 'WebKit' },
      ];
  }
}

function withKindDefaults(
  current: QaLaunchGroup,
  kind: QaExecutionKind,
  androidAvds: string[],
  realIosConfig: RealIosProviderPublicConfig | null,
): QaLaunchGroup {
  const defaults = createDefaultLaunchGroup(kind);
  const next: QaLaunchGroup = {
    ...defaults,
    id: current.id,
    instances: current.instances,
    sessionDurationSeconds: current.sessionDurationSeconds,
    proxySource: current.proxySource,
    allowSlowProxies: current.allowSlowProxies,
  };
  if ((kind === 'android-avd' || kind === 'real-ios') && next.proxySource !== 'none') {
    next.proxySource = 'none';
    next.allowSlowProxies = false;
  }
  if (kind === 'android-avd') { next.androidAvdName = androidAvds[0] || ''; next.instances = 1; }
  if (kind === 'real-ios') next.instances = 1;
  if (kind === 'real-ios' && realIosConfig) {
    next.realIos = {
      device: realIosConfig.defaultDevice,
      iosVersion: realIosConfig.defaultIosVersion,
      browser: realIosConfig.defaultBrowser,
    };
    next.browser = realIosConfig.defaultBrowser === 'chrome' ? 'chrome-ios' : 'safari-ios';
  }
  return next;
}

function poolOptionLabel(kind: 'rotating' | 'static', summary: ProxySummary): string {
  const live = kind === 'rotating' ? summary.rotatingLive : summary.staticLive;
  const slow = kind === 'rotating' ? summary.rotatingSlow : summary.staticSlow;
  return `${kind === 'rotating' ? 'Rotating' : 'Static'} Pool · ${live} live · ${slow} slow`;
}

export function TargetPlanEditor({
  targets,
  onChange,
  androidAvds,
  proxySummary,
  realIosConfig,
  realIosStatus,
  disabled = false,
}: Props) {
  const totalWorkUnits = countMatrixWorkUnits(targets);

  function updateTarget(index: number, patch: Partial<QaTargetPlan>) {
    onChange(replaceTarget(targets, index, { ...targets[index], ...patch }));
  }

  function updateGroup(targetIndex: number, groupIndex: number, patch: Partial<QaLaunchGroup>) {
    const target = targets[targetIndex];
    updateTarget(targetIndex, { groups: replaceGroup(target, groupIndex, { ...target.groups[groupIndex], ...patch }).groups });
  }

  function changeKind(targetIndex: number, groupIndex: number, kind: QaExecutionKind) {
    const target = targets[targetIndex];
    const current = target.groups[groupIndex];
    updateTarget(targetIndex, { groups: replaceGroup(target, groupIndex, withKindDefaults(current, kind, androidAvds, realIosConfig)).groups });
  }

  function addGroup(targetIndex: number) {
    const target = targets[targetIndex];
    const group = createDefaultLaunchGroup('android-emulation');
    updateTarget(targetIndex, { groups: [...target.groups, group] });
  }

  function removeGroup(targetIndex: number, groupIndex: number) {
    const target = targets[targetIndex];
    if (target.groups.length <= 1) return;
    updateTarget(targetIndex, { groups: target.groups.filter((_, index) => index !== groupIndex) });
  }

  function addTarget() {
    if (targets.length >= 20) return;
    onChange([...targets, createDefaultTargetPlan('')]);
  }

  function removeTarget(targetIndex: number) {
    if (targets.length <= 1) return;
    onChange(targets.filter((_, index) => index !== targetIndex));
  }

  return (
    <div className="matrix-editor">
      <div className="matrix-editor__summary">
        <span>{targets.length} target{targets.length === 1 ? '' : 's'}</span>
        <strong>{totalWorkUnits} work units</strong>
      </div>

      {targets.map((target, targetIndex) => (
        <section className="matrix-target" key={target.id}>
          <div className="matrix-target__header">
            <div>
              <span className="section-kicker">TARGET {targetIndex + 1}</span>
              <strong>Website + device groups</strong>
            </div>
            <button
              type="button"
              className="text-button matrix-remove"
              aria-label={`Remove target ${targetIndex + 1}`}
              onClick={() => removeTarget(targetIndex)}
              disabled={disabled || targets.length <= 1}
            >
              Remove target
            </button>
          </div>

          <label className="field field--full matrix-target__url">
            <span>Target URL</span>
            <input
              aria-label={`Target ${targetIndex + 1} URL`}
              type="text"
              inputMode="url"
              value={target.targetUrl}
              placeholder="unknown-url.example"
              onChange={(event) => updateTarget(targetIndex, { targetUrl: event.target.value })}
              disabled={disabled}
            />
            <small>http:// or https:// is optional.</small>
          </label>

          <div className="matrix-groups">
            {target.groups.map((group, groupIndex) => {
              const prefix = `Target ${targetIndex + 1} group ${groupIndex + 1}`;
              const proxyUnsupported = group.executionKind === 'android-avd' || group.executionKind === 'real-ios';
              const slowCount = group.proxySource === 'rotating' ? proxySummary.rotatingSlow : group.proxySource === 'static' ? proxySummary.staticSlow : group.proxySource === 'smart-mix' ? proxySummary.rotatingSlow + proxySummary.staticSlow : 0;
              return (
                <article className="matrix-group" key={group.id}>
                  <div className="matrix-group__header">
                    <strong>Device group {groupIndex + 1}</strong>
                    <button
                      type="button"
                      className="step-remove"
                      aria-label={`Remove ${prefix}`}
                      onClick={() => removeGroup(targetIndex, groupIndex)}
                      disabled={disabled || target.groups.length <= 1}
                    >×</button>
                  </div>

                  <div className="matrix-group__grid">
                    <label className="field">
                      <span>Device type</span>
                      <select
                        aria-label={`${prefix} device type`}
                        value={group.executionKind}
                        onChange={(event) => changeKind(targetIndex, groupIndex, event.target.value as QaExecutionKind)}
                        disabled={disabled}
                      >
                        <option value="desktop">Desktop</option>
                        <option value="android-emulation">Android mobile emulation</option>
                        <option value="ios-emulation">iPhone / iPad compatibility</option>
                        <option value="android-avd">Android AVD</option>
                        <option value="real-ios">Real iOS provider</option>
                      </select>
                    </label>

                    <label className="field">
                      <span>Browser</span>
                      <select
                        aria-label={`${prefix} browser`}
                        value={group.browser}
                        onChange={(event) => {
                          const browser = event.target.value as QaMatrixBrowser;
                          const patch: Partial<QaLaunchGroup> = { browser };
                          if (group.executionKind === 'real-ios' && group.realIos) {
                            patch.realIos = { ...group.realIos, browser: browser === 'chrome-ios' ? 'chrome' : 'safari' };
                          }
                          updateGroup(targetIndex, groupIndex, patch);
                        }}
                        disabled={disabled}
                      >
                        {browserOptions(group.executionKind).map((option) => (
                          <option
                            key={option.value}
                            value={option.value}
                            disabled={group.executionKind === 'real-ios' && option.value === 'chrome-ios' && realIosStatus?.chromeSupported === false}
                          >
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    {group.executionKind === 'android-emulation' && (
                      <label className="field">
                        <span>Mobile profile</span>
                        <select
                          aria-label={`${prefix} device profile`}
                          value={group.deviceProfile || 'Pixel 11'}
                          onChange={(event) => updateGroup(targetIndex, groupIndex, { deviceProfile: event.target.value })}
                          disabled={disabled}
                        >
                          {ANDROID_EMULATION_PROFILES.map((profile) => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
                        </select>
                      </label>
                    )}

                    {group.executionKind === 'ios-emulation' && (
                      <>
                        <label className="field">
                          <span>iPhone / iPad profile</span>
                          <select
                            aria-label={`${prefix} device profile`}
                            value={group.deviceProfile || 'iPhone 18 Pro'}
                            onChange={(event) => updateGroup(targetIndex, groupIndex, { deviceProfile: event.target.value })}
                            disabled={disabled}
                          >
                            {IOS_DEVICE_PROFILES.map((profile) => <option key={profile.name} value={profile.name}>{profile.name}</option>)}
                          </select>
                        </label>
                        <label className="field">
                          <span>Orientation</span>
                          <select
                            aria-label={`${prefix} orientation`}
                            value={group.orientation || 'portrait'}
                            onChange={(event) => updateGroup(targetIndex, groupIndex, { orientation: event.target.value as 'portrait' | 'landscape' })}
                            disabled={disabled}
                          >
                            <option value="portrait">Portrait</option>
                            <option value="landscape">Landscape</option>
                          </select>
                        </label>
                        <label className="field"><span>Locale</span><input aria-label={`${prefix} locale`} value={group.locale || 'en-US'} onChange={(event) => updateGroup(targetIndex, groupIndex, { locale: event.target.value })} disabled={disabled} /></label>
                        <label className="field"><span>Timezone</span><input aria-label={`${prefix} timezone`} value={group.timezoneId || 'UTC'} onChange={(event) => updateGroup(targetIndex, groupIndex, { timezoneId: event.target.value })} disabled={disabled} /></label>
                      </>
                    )}

                    {group.executionKind === 'android-avd' && (
                      <label className="field">
                        <span>Android AVD</span>
                        <select
                          aria-label={`${prefix} Android AVD`}
                          value={group.androidAvdName || ''}
                          onChange={(event) => updateGroup(targetIndex, groupIndex, { androidAvdName: event.target.value })}
                          disabled={disabled || androidAvds.length === 0}
                        >
                          {androidAvds.length === 0 && <option value="">No AVDs found</option>}
                          {androidAvds.map((avd) => <option key={avd} value={avd}>{avd}</option>)}
                        </select>
                      </label>
                    )}

                    {group.executionKind === 'real-ios' && (
                      <>
                        <label className="field"><span>Real iOS device</span><input aria-label={`${prefix} real iOS device`} value={group.realIos?.device || ''} onChange={(event) => updateGroup(targetIndex, groupIndex, { realIos: { device: event.target.value, iosVersion: group.realIos?.iosVersion || '', browser: group.realIos?.browser || 'safari' } })} disabled={disabled || !realIosConfig} /></label>
                        <label className="field"><span>iOS version</span><input aria-label={`${prefix} real iOS version`} value={group.realIos?.iosVersion || ''} onChange={(event) => updateGroup(targetIndex, groupIndex, { realIos: { device: group.realIos?.device || '', iosVersion: event.target.value, browser: group.realIos?.browser || 'safari' } })} disabled={disabled || !realIosConfig} /></label>
                      </>
                    )}

                    <label className="field">
                      <span>Instances</span>
                      <input
                        aria-label={`${prefix} instances`}
                        type="number"
                        min="1"
                        value={group.instances}
                        onChange={(event) => updateGroup(targetIndex, groupIndex, { instances: Number(event.target.value) })}
                        disabled={disabled || group.executionKind === 'android-avd' || group.executionKind === 'real-ios'}
                      />
                    </label>

                    <label className="field">
                      <span>Session duration (seconds)</span>
                      <input
                        aria-label={`${prefix} session duration (seconds)`}
                        type="number"
                        min="5"
                        max="600"
                        value={group.sessionDurationSeconds}
                        onChange={(event) => updateGroup(targetIndex, groupIndex, { sessionDurationSeconds: Number(event.target.value) })}
                        disabled={disabled}
                      />
                    </label>

                    <label className="field">
                      <span>Proxy source</span>
                      <select
                        aria-label={`${prefix} proxy source`}
                        value={group.proxySource}
                        onChange={(event) => updateGroup(targetIndex, groupIndex, { proxySource: event.target.value as ProxySource, allowSlowProxies: ['rotating', 'static', 'smart-mix'].includes(event.target.value) })}
                        disabled={disabled}
                      >
                        <option value="none">No proxy</option>
                        <option value="manual" disabled={proxyUnsupported}>Manual proxy</option>
                        <option value="rotating" disabled={proxyUnsupported || (proxySummary.rotatingLive + proxySummary.rotatingSlow) === 0}>{poolOptionLabel('rotating', proxySummary)}</option>
                        <option value="static" disabled={proxyUnsupported || (proxySummary.staticLive + proxySummary.staticSlow) === 0}>{poolOptionLabel('static', proxySummary)}</option>
                        <option value="smart-mix" disabled={proxyUnsupported || (proxySummary.rotatingLive + proxySummary.rotatingSlow + proxySummary.staticLive + proxySummary.staticSlow) === 0}>Smart Mix · Rotating + Static</option>
                      </select>
                    </label>

                  </div>

                  {group.executionKind === 'real-ios' && (!realIosStatus?.reachable || !realIosStatus.authenticated) && (
                    <p className="editor-message editor-message--error">Real iOS provider is not ready. Configure and check it in Settings.</p>
                  )}
                </article>
              );
            })}
          </div>

          <button
            type="button"
            className="secondary-button matrix-add-group"
            aria-label={`Add device group to target ${targetIndex + 1}`}
            onClick={() => addGroup(targetIndex)}
            disabled={disabled || target.groups.length >= 12}
          >
            + Add device group
          </button>
        </section>
      ))}

      <button type="button" className="secondary-button matrix-add-target" aria-label="Add target website" onClick={addTarget} disabled={disabled || targets.length >= 20}>
        + Add target website
      </button>
    </div>
  );
}
