# OrbitQA v0.18.9 Design: Proxy IP History Control + Privacy & Route Integrity

Date: 2026-09-19
Status: Design approved in chat; awaiting written-spec review before implementation planning
Baseline: OrbitQA v0.18.8 + frontend test hotfix

## 1. Purpose

OrbitQA should let the user explicitly enable or disable Proxy IP History recording, while keeping the existing history available for viewing and export. OrbitQA should also strengthen and surface real privacy and proxy-route integrity checks so Test Runs fail closed when OrbitQA proves that a required proxy route leaked or was bypassed.

The privacy work must remain truthful. OrbitQA may prevent accidental network/privacy leakage and report browser automation indicators, but it must not hide, rewrite, or falsify browser automation signals to impersonate human traffic or defeat anti-bot systems.

## 2. Current State Confirmed from v0.18.8

The current baseline already contains the following protections and behavior:

- Proxy IP History records valid observed proxy exit IPs from existing Test Run route observations.
- `qa-runner.cjs` records exit-IP observations through `proxyIpHistory.observe(...)` at existing route-observation points.
- Strict Privacy blocks camera, microphone, geolocation, and notification access before page code runs.
- Chromium privacy launches use a `disable_non_proxied_udp` WebRTC policy switch.
- WebRTC remains observable; OrbitQA does not replace `RTCPeerConnection`, rewrite ICE candidates, or hide the API.
- Session-integrity logic can block a required proxy when the host direct public IP appears in WebRTC candidates.
- Device-consistency diagnostics deliberately report `navigator.webdriver` and explicitly state that OrbitQA does not modify or hide it.
- The new Real Chrome runtime work records the actual browser/runtime used instead of relying only on labels.

The missing pieces are:

1. No global ACTIVE/INACTIVE control exists for Proxy IP History recording.
2. Existing privacy/session-integrity checks are spread across diagnostics and are not presented as one clear per-work-unit Privacy & Route Integrity result.
3. Some route/privacy states need stricter fail-closed rules when a proxy is explicitly required.
4. DNS route integrity is not independently verified and must not be reported as a passing check.

## 3. Goals

### 3.1 Proxy IP History control

1. Add a persistent global recording state:
   - `ACTIVE` — new valid exit-IP observations are recorded.
   - `INACTIVE` — no new history observations are recorded.
2. Default to `ACTIVE` for backward compatibility with v0.18.8.
3. When recording is INACTIVE:
   - do not call the history aggregation write path;
   - do not increment per-run repeat counts;
   - do not increment lifetime counts;
   - do not start country-resolution work solely for history;
   - do not schedule/flush history writes solely because of a new Test Run observation.
4. Existing history remains readable, filterable, exportable, and clearable while recording is INACTIVE.
5. Turning recording back ACTIVE affects future observations only; OrbitQA does not reconstruct observations from runs that happened while disabled.
6. Keep the switch lightweight: no polling loop and no new background service.

### 3.2 Privacy & route integrity

1. Preserve all existing strict-privacy permission blocking.
2. Preserve visible WebRTC diagnostics and direct-IP leak detection.
3. Preserve transparent reporting of `navigator.webdriver` and other automation-relevant runtime facts.
4. Add a single per-work-unit Privacy & Route Integrity result that consolidates existing checks.
5. For a required proxy route, fail the work unit when OrbitQA proves any of the following:
   - observed HTTP/browser exit IP equals the host direct public IP;
   - observed route does not satisfy the assigned required proxy route;
   - WebRTC exposes the host direct public IP;
   - a previously verified required proxy route changes to a disallowed route during the same work unit.
6. In Strict Privacy Mode with a required proxy, if a required route check cannot be completed, OrbitQA must report `NOT VERIFIED` and treat the route as non-passing rather than claiming success.
7. Unsupported or unavailable capabilities must be labeled `UNSUPPORTED` or `NOT VERIFIED`, never fake `PASS`.
8. Repeat route verification after the behavior phase using the existing post-behavior observation path.

### 3.3 Runtime truth

1. Keep the v0.18.8 real-Chrome runtime verification unchanged.
2. Privacy results must include enough runtime context to tell whether the check ran in:
   - Installed Google Chrome;
   - Playwright Chromium;
   - Firefox;
   - WebKit;
   - Android AVD Chrome;
   - Real iOS/provider runtime.
3. Do not claim a privacy guarantee on a runtime where the underlying check is unsupported.

## 4. Non-Goals and Safety Boundaries

This feature does **not** implement stealth or anti-detection behavior.

OrbitQA will not:

- set `navigator.webdriver` to false or undefined;
- inject scripts whose purpose is to conceal automation;
- falsify canvas, WebGL, AudioContext, fonts, plugins, media devices, battery, hardware concurrency, memory, or other fingerprint surfaces to impersonate a human device;
- rewrite user-agent/runtime facts to contradict the actual selected runtime;
- hide Playwright/automation characteristics from websites;
- alter browser APIs solely to bypass bot-detection or anti-abuse systems;
- simulate organic human identity to evade site controls.

OrbitQA may still configure legitimate QA environment properties that are part of the selected device/browser test profile, such as viewport, touch, locale, timezone, user agent, and mobile emulation, provided the UI labels the mode truthfully.

## 5. Proxy IP History Recording Architecture

### 5.1 Persistent setting

Add a tiny persisted settings object owned by the Proxy IP History subsystem:

```text
{
  recordingEnabled: true
}
```

Default when the setting does not yet exist:

```text
recordingEnabled = true
```

The state must survive application restart.

### 5.2 Store interface

Extend the history store with a focused control surface:

```text
getRecordingState() -> { recordingEnabled: boolean }
setRecordingState(enabled: boolean) -> { recordingEnabled: boolean }
observe(event) -> boolean
```

`observe(event)` must check `recordingEnabled` before any aggregation mutation, country-history enrichment, or persistence scheduling.

When disabled, `observe(event)` returns a clear non-recorded result without modifying existing data.

### 5.3 IPC surface

Add only the minimum IPC required by the UI:

```text
qa:getProxyIpHistoryRecordingState
qa:setProxyIpHistoryRecordingState
```

The preload bridge exposes typed methods for those two operations. No raw store access is exposed to the renderer.

### 5.4 UI

At the top of the existing **Proxy IP History** page add a compact recording control:

```text
Recording
[ ACTIVE ] [ INACTIVE ]
```

ACTIVE state copy:

```text
OrbitQA records new exit-IP observations from Test Runs.
```

INACTIVE state copy:

```text
New Test Run exit-IP observations are not added to history. Existing history remains available.
```

The state change should update immediately after the main-process setting confirms success. Do not use an optimistic UI that can show ACTIVE when the persisted state change failed.

### 5.5 Clear/export behavior

- `Clear History` remains available regardless of recording state.
- `Export CSV` remains available regardless of recording state.
- Turning recording INACTIVE never deletes data.
- Clearing history never changes the ACTIVE/INACTIVE setting.

## 6. Privacy & Route Integrity Model

### 6.1 Consolidated report

Create a small shared report shape that can be attached to a work unit/run detail without duplicating raw probe objects:

```text
PrivacyRouteIntegrityReport {
  overallStatus: 'pass' | 'fail' | 'not-verified';
  strictMode: boolean;
  proxyRequired: boolean;
  checks: PrivacyRouteIntegrityCheck[];
  runtimeLabel?: string;
  observedAt: string;
}

PrivacyRouteIntegrityCheck {
  key: string;
  label: string;
  status: 'pass' | 'fail' | 'blocked' | 'unsupported' | 'not-verified' | 'info';
  expected?: string;
  observed?: string;
  detail?: string;
}
```

This object summarizes verified facts. It should reference existing privacy/session-integrity evidence rather than create a second independent probe system.

### 6.2 Required checks

Where supported, the report includes:

1. **Browser runtime** — informational truth from v0.18.8 runtime verification.
2. **Proxy exit route** — whether the browser route matches the required proxy expectation.
3. **Direct IP exposure** — fail when the browser-observed route equals the host direct public IP under a required proxy.
4. **WebRTC route privacy** — fail when WebRTC exposes the host direct public IP under a required proxy.
5. **Camera** — blocked/denied under Strict Privacy.
6. **Microphone** — blocked/denied under Strict Privacy.
7. **Geolocation** — blocked/denied under Strict Privacy.
8. **Notifications** — blocked/denied under Strict Privacy.
9. **Post-behavior proxy route** — verify the route again after behavior steps.
10. **Automation environment** — informational reporting such as `navigator.webdriver`; never treated as something to conceal.

### 6.3 DNS status

The current application does not independently prove DNS resolver routing.

Therefore the consolidated report must use one of these states:

```text
DNS route integrity: NOT VERIFIED
```

or omit DNS entirely from the default report.

It must not say `PASS` based only on an HTTP exit-IP check.

A future controlled DNS-leak probe would require its own design and tests.

## 7. Fail-Closed Rules

### 7.1 Required proxy + Strict Privacy

If `proxyRequired === true` and Strict Privacy is enabled:

- confirmed wrong route -> FAIL work unit;
- confirmed direct-IP route -> FAIL work unit;
- confirmed WebRTC direct-IP leak -> FAIL work unit;
- required route check cannot complete -> overall `not-verified`, fail the work unit closed, and never emit a privacy PASS;
- post-behavior route changes to a disallowed route -> FAIL work unit.

The runner may surface a specific terminal reason such as:

```text
PRIVACY ROUTE INTEGRITY FAILED
Required proxy route could not be verified.
```

or:

```text
PRIVACY ROUTE INTEGRITY FAILED
Host direct public IP appeared in WebRTC candidates.
```

### 7.2 No required proxy

When no proxy is required, OrbitQA still reports privacy observations but must not fail merely because the browser uses the host's normal public route.

Strict Privacy permission rules still apply independently of proxy requirement.

### 7.3 Unsupported environments

For Android AVD, WebKit, Real iOS, or provider runtimes where a specific check cannot run reliably:

- mark the individual check `UNSUPPORTED` or `NOT VERIFIED`;
- do not silently substitute a desktop-Chromium result;
- do not convert unsupported evidence into a pass;
- preserve the rest of the Test Run if no required fail-closed rule is violated.

## 8. Data Flow

### 8.1 Before target navigation

```text
work unit starts
  -> runtime resolved
  -> strict privacy guard installed
  -> required proxy route established
  -> existing preflight route observation
  -> session/privacy integrity assessment
  -> consolidated Privacy & Route Integrity report snapshot
  -> if proxy history ACTIVE: record existing exit-IP observation
  -> if fail-closed rule violated: stop only this work unit
  -> navigate target
```

### 8.2 After behavior steps

```text
behavior phase finishes
  -> existing post-behavior route observation
  -> compare with required/initial route expectations
  -> update Privacy & Route Integrity report
  -> if proxy history ACTIVE: record existing exit-IP observation
  -> if fail-closed rule violated: fail this work unit
  -> otherwise continue normal completion/cleanup
```

No new periodic polling loop is added.

## 9. UI and Run Detail

### 9.1 Proxy IP History page

Add a lightweight status card/control above the existing summary/table:

```text
PROXY IP HISTORY RECORDING
ACTIVE
Records new Test Run exit-IP observations.
```

or:

```text
PROXY IP HISTORY RECORDING
INACTIVE
History is view-only. New Test Run observations are not being recorded.
```

The table, summary cards, filters, export, and clear-history actions remain unchanged.

### 9.2 Run Detail

Add a compact **Privacy & Route Integrity** section near the existing runtime/proxy summary.

Example:

```text
Privacy & Route Integrity
Overall: PASS

Google Chrome Runtime       PASS
Proxy Exit Route            PASS
Direct IP Exposure          PASS
WebRTC Route Privacy        PASS
Camera                      BLOCKED
Microphone                  BLOCKED
Geolocation                 BLOCKED
Notifications               BLOCKED
Post-Behavior Route         PASS
DNS Route Integrity         NOT VERIFIED
Automation Environment      INFO · navigator.webdriver=true
```

For a failed work unit:

```text
Overall: FAIL
WebRTC Route Privacy        FAIL
Host direct public IP appeared in a WebRTC candidate while a required proxy was configured.
```

### 9.3 Live Matrix / active run display

If the current Live Matrix already has room for concise network status, show only a small status token such as:

```text
PRIVACY PASS
PRIVACY FAIL
NOT VERIFIED
```

Do not stream large privacy objects into the matrix on every event.

## 10. Performance and Storage Constraints

1. No new periodic IP polling.
2. No new periodic privacy polling.
3. Reuse existing preflight and post-behavior route observations.
4. Proxy IP History disabled state must short-circuit before aggregation/persistence work.
5. Country cache remains bounded by the existing history architecture; disabled history must not trigger country resolution solely for history.
6. Consolidated privacy reports should be small summaries, not copies of full page/browser objects.
7. Active-run UI updates should use existing event/update paths rather than adding a high-frequency timer.
8. Existing history pagination remains bounded.

## 11. Error Handling

### 11.1 Recording-state persistence failure

If the user changes ACTIVE/INACTIVE and persistence fails:

- keep the prior confirmed state in the UI;
- display a small error message;
- do not pretend the new state is active.

### 11.2 Privacy probe failure

A failed probe is not automatically a privacy leak.

- If the check is optional: mark `NOT VERIFIED`.
- If a required proxy + Strict Privacy rule depends on the check: mark `NOT VERIFIED`, fail that work unit closed, and never return a privacy PASS.

### 11.3 Browser/runtime crash

The v0.18.7 hard-stop and stuck-run recovery behavior remains authoritative. Privacy diagnostics must never create a second unbounded shutdown wait.

## 12. Security and Data Handling

- Never write proxy passwords or authentication secrets into history or privacy reports.
- Proxy identity in history uses the existing sanitized proxy identity/source.
- Local executable paths remain local diagnostic data.
- Direct public IP values may be stored only where existing Test Run/IP-history diagnostics already require them.
- Do not send privacy reports to an external telemetry service.
- Do not add remote fingerprinting or third-party anti-bot scoring services.

## 13. Compatibility Requirements

This work must preserve:

- v0.18.8 Installed Google Chrome runtime behavior;
- Playwright Chromium compatibility option;
- Firefox;
- WebKit/iOS compatibility;
- Android AVD `com.android.chrome` path;
- Real iOS/provider path;
- proxy pool modes and validation;
- Run Center;
- Auto Run Again;
- Stuck Run Auto-Recovery / hard-stop recovery;
- screenshot controls;
- existing privacy probe behavior;
- existing Proxy IP History aggregation, repeat counting, country caching, filters, pagination, CSV export, and clear-history behavior;
- streaming functionality unless it already shares an unchanged privacy helper.

## 14. Testing Strategy

Implementation must be test-first.

### 14.1 Proxy IP History control tests

Tests must prove:

- missing setting defaults to ACTIVE;
- ACTIVE observation updates history;
- INACTIVE observation does not mutate per-run counts;
- INACTIVE observation does not mutate lifetime counts;
- INACTIVE observation does not schedule a history write;
- INACTIVE observation does not start history-only country resolution;
- turning ACTIVE back on records future observations;
- clear history does not change recording state;
- recording state survives store recreation/restart;
- renderer shows confirmed ACTIVE/INACTIVE state and handles persistence failure without lying.

### 14.2 Privacy/session-integrity tests

Tests must prove:

- required proxy + direct route exposure fails;
- required proxy + WebRTC host-IP exposure fails;
- required proxy + correct preflight/post-behavior route passes;
- route changes to a disallowed route after behavior fail;
- unavailable required route verification becomes NOT VERIFIED rather than PASS;
- no-proxy run does not fail simply because host public IP is observed;
- permission checks report camera/microphone/geolocation/notifications correctly;
- unsupported runtime checks remain UNSUPPORTED/NOT VERIFIED;
- `navigator.webdriver` is reported and never modified/hidden by OrbitQA;
- DNS is not reported PASS without an independent DNS check.

### 14.3 Regression tests

Run the full existing Node/Electron suite plus frontend tests on Windows. Re-run focused regressions for:

- Test Runs;
- privacy probe;
- session integrity;
- device consistency;
- Chrome runtime verification;
- Proxy IP History;
- Run Center recovery;
- Streaming privacy helpers if shared code changes.

## 15. Acceptance Criteria

The feature is accepted when all of the following are true:

1. Proxy IP History page shows a persistent ACTIVE/INACTIVE recording control.
2. Default state is ACTIVE on an existing installation with no saved setting.
3. INACTIVE means no new history observations, repeat increments, history-only country resolution, or history persistence work.
4. Existing history remains viewable/exportable/clearable while INACTIVE.
5. Re-enabling affects only future observations.
6. Run Detail shows a consolidated Privacy & Route Integrity result.
7. Proven direct-IP, wrong-route, WebRTC direct-IP, and disallowed post-behavior route leaks fail a required-proxy work unit.
8. Required but unverifiable route checks are never labeled PASS.
9. Unsupported checks are labeled honestly.
10. DNS is not labeled PASS without independent verification.
11. `navigator.webdriver` and automation-relevant diagnostics remain observable/reported; OrbitQA does not conceal them.
12. No anti-bot stealth/fingerprint-spoofing behavior is added.
13. No existing browser/runtime/device mode is removed.
14. Existing Run Center, recovery, screenshots, proxy modes, and history functionality continue to pass regression tests.
15. No new high-frequency polling loop is introduced.

## 16. Release Packaging

Target release: **OrbitQA v0.18.9 — Privacy + History Control**.

Release package should include:

- cumulative-safe patch from the final v0.18.8 + frontend-hotfix baseline;
- full backup ZIP;
- release note summarizing:
  - Proxy IP History ACTIVE/INACTIVE control;
  - Privacy & Route Integrity Run Detail section;
  - fail-closed required-proxy leak handling;
  - truthful automation/runtime reporting;
  - explicit non-support for stealth masking;
  - preserved v0.18.8 Real Chrome behavior.

Windows verification remains required for the final Vite/Vitest build and live real-Chrome/Android-AVD smoke tests.
