# OrbitQA v0.18.9 Privacy + History Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent ACTIVE/INACTIVE control for Proxy IP History and a truthful, lightweight Privacy & Route Integrity result that fails required-proxy Test Runs closed on proven or required-but-unverifiable route leaks without adding stealth/fingerprint masking.

**Architecture:** Extend the existing Proxy IP History store with one persisted recording flag and short-circuit observations before aggregation/country/persistence work when disabled. Build a new pure `privacy-route-integrity` summarizer that consumes the route/privacy/runtime evidence OrbitQA already collects, emit compact reports at the existing pre-navigation route gate, pre-behavior privacy gate, and post-behavior route check, store the latest report per work unit in Run Center, and render concise status in Test Runs/Run Detail without adding any new polling loop.

**Tech Stack:** Electron main/preload IPC, Node.js CommonJS services/tests, React 19 + TypeScript 5.9, Vitest/Testing Library for renderer tests, existing Playwright-based QA runner and privacy/session-integrity probes.

**Spec:** `docs/superpowers/specs/2026-09-19-v0189-privacy-history-control-design.md`

## Global Constraints

- Baseline is **OrbitQA v0.18.8 + frontend test hotfix**.
- Target release is **OrbitQA v0.18.9 — Privacy + History Control**.
- Proxy IP History recording defaults to `ACTIVE` when no saved setting exists.
- `INACTIVE` must short-circuit before history aggregation mutation, history-only country resolution, and history persistence scheduling for a new Test Run observation.
- Existing Proxy IP History remains readable, filterable, exportable, and clearable while recording is INACTIVE.
- Clearing history must never change the ACTIVE/INACTIVE setting.
- No new periodic IP polling or privacy polling is allowed; reuse existing preflight and post-behavior observations.
- Strict Privacy permission blocking for camera, microphone, geolocation, and notifications must remain intact.
- A required proxy route in Strict Privacy must fail closed on confirmed direct-route exposure, confirmed WebRTC host-IP exposure, confirmed wrong/disallowed route, or required route verification that cannot complete.
- No-proxy runs must not fail merely because the browser uses the host's normal public route.
- Unsupported checks must be labeled `UNSUPPORTED` or `NOT VERIFIED`; DNS must never be shown as PASS without an independent DNS check.
- `navigator.webdriver` and automation-relevant runtime facts remain visible and are never hidden, rewritten, or falsified.
- Do not add canvas/WebGL/AudioContext/plugin/font/device spoofing, automation-concealment scripts, or any anti-bot stealth mechanism.
- Preserve v0.18.8 Installed Google Chrome behavior plus Chromium, Firefox, WebKit/iOS compatibility, Android AVD Chrome, Real iOS/provider paths, proxy modes, Run Center, Auto Run Again, stuck-run/hard-stop recovery, screenshots, Streaming, and current history aggregation/filter/export behavior.
- Never persist proxy passwords/authentication secrets in history or privacy reports.
- Windows remains the required final gate for `npm.cmd run build`, `npm.cmd test`, live installed-Chrome smoke tests, and Android AVD smoke tests.

## Review Focus

1. **Recording-state write failure:** if persistence rejects while switching ACTIVE/INACTIVE, the UI must retain the last confirmed state and display an error; Task 1 tests store rollback and Task 2 tests renderer non-optimistic behavior.
2. **Required route verification error:** a route probe error under Strict Privacy + required proxy must become `NOT VERIFIED` and block the work unit, never PASS; Task 3 and Task 4 pin this behavior.
3. **No-proxy direct route:** observing the host public IP with no required proxy must remain informational and must not fail the work unit; Task 3 tests this explicitly.
4. **Rotating proxy continuity:** a rotating proxy may change from one verified non-direct exit IP to another without being treated as a leak; Task 3 tests verified rotation while Task 4 preserves the existing route-assessment semantics.
5. **Unsupported runtime evidence:** WebKit/Android AVD/Real iOS or unavailable WebRTC/permission evidence must remain `UNSUPPORTED`/`NOT VERIFIED` and must never be silently replaced with desktop-Chromium evidence; Task 3 and Task 5 render/test this truthfully.

---

## File Structure and Responsibilities

- `electron/proxy-ip-history-store.cjs` — owns history aggregates plus the persisted `recordingEnabled` setting.
- `electron/proxy-ip-history-store.test.cjs` — unit tests for default state, disabled short-circuit, persistence, clear semantics, and rollback on write failure.
- `electron/main.cjs` / `electron/preload.cjs` — expose only the two recording-state IPC operations to the renderer.
- `electron/proxy-ip-history-ipc-contract.test.cjs` — contract tests for main/preload/shared bridge names.
- `src/shared/proxyIpHistory.ts` / `src/vite-env.d.ts` — typed renderer contract for recording state.
- `src/pages/ProxyIpHistory.tsx` / `src/pages/ProxyIpHistory.test.tsx` — ACTIVE/INACTIVE control with confirmed-state UI and persistence-error handling.
- `electron/privacy-route-integrity.cjs` — pure report builder; no browser/network I/O.
- `electron/privacy-route-integrity.test.cjs` — report truth/fail-closed/unsupported/no-proxy/rotation tests.
- `src/shared/privacyRouteIntegrity.ts` — renderer type contract for the new report.
- `electron/qa-runner.cjs` / `electron/qa-runner.test.cjs` — emit preflight/post-behavior integrity reports and enforce fail-closed rules using existing observations.
- `src/shared/testRun.ts` — add `privacy-route-integrity` event payload type.
- `electron/run-registry.cjs` / `electron/run-registry.test.cjs` — retain latest report per work unit.
- `src/shared/runCenter.ts` — expose `privacyRouteIntegrityByWork` on Run Detail.
- `src/pages/Run.tsx` / `src/pages/RunCenter.tsx` — concise live token plus detailed Run Center rendering.
- `electron/privacy-route-integrity-renderer-source.test.cjs` — source contract for UI wiring when frontend dependencies are unavailable in the container.
- `src/styles.css` / `electron/layout-css.test.cjs` — minimal styling for state/report badges, preserving existing layout contracts.
- `electron/v0189-release-contract.test.cjs` / `package.json` / `README.md` / `V0.18.9-PRIVACY-HISTORY-CONTROL.md` — version, test inclusion, release documentation, and packaging contract.

---

### Task 1: Persisted Proxy IP History Recording State

**Files:**
- Modify: `electron/proxy-ip-history-store.cjs`
- Modify: `electron/proxy-ip-history-store.test.cjs`

**Interfaces:**
- Consumes: existing `createProxyIpHistoryStore({ filePath, writeFile, readFile, debounceMs, countryResolver })`.
- Produces:
  - `getRecordingState() -> { recordingEnabled: boolean }`
  - `setRecordingState(enabled: boolean) -> Promise<{ recordingEnabled: boolean }>`
  - unchanged `observe(event) -> boolean`, but it returns `false` immediately when recording is disabled.

- [ ] **Step 1: Write failing tests for default ACTIVE state and disabled short-circuit**

Append tests equivalent to:

```js
test('Proxy IP History defaults recording ACTIVE and INACTIVE short-circuits all observation work', async () => {
  const writes = [];
  const countryLookups = [];
  const store = createProxyIpHistoryStore({
    filePath:'/tmp/proxy-history.json',
    readFile:() => { throw new Error('missing'); },
    writeFile:async (_path, data) => { writes.push(JSON.parse(data)); },
    debounceMs:0,
    countryResolver:{ resolve:async (ip) => { countryLookups.push(ip); return 'NG'; } },
  });

  assert.deepEqual(store.getRecordingState(), { recordingEnabled:true });
  await store.setRecordingState(false);
  const writeCountAfterSetting = writes.length;

  assert.equal(store.observe({
    runId:'r-disabled', proxySource:'rotating', proxyId:'p1', observedIp:'8.8.8.8', phase:'preflight',
  }), false);
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(store.getRunSummary('r-disabled').observationCount, 0);
  assert.equal(countryLookups.length, 0);
  assert.equal(writes.length, writeCountAfterSetting);
});
```

Add a second test proving clear does not change recording state:

```js
test('clearing history preserves recording state', async () => {
  const store = createProxyIpHistoryStore({ filePath:'/tmp/history.json', readFile:() => { throw new Error('missing'); }, writeFile:async () => {}, debounceMs:0 });
  await store.setRecordingState(false);
  store.clear();
  assert.deepEqual(store.getRecordingState(), { recordingEnabled:false });
});
```

- [ ] **Step 2: Run the focused store tests and verify RED**

Run:

```bash
node --test electron/proxy-ip-history-store.test.cjs
```

Expected: FAIL because `getRecordingState` / `setRecordingState` do not exist and disabled observations still mutate history.

- [ ] **Step 3: Add persisted setting to the store snapshot/load path**

Implement state near the existing maps:

```js
let recordingEnabled = true;
```

Extend `load()` so a missing setting remains backward-compatible:

```js
if (parsed?.settings && typeof parsed.settings.recordingEnabled === 'boolean') {
  recordingEnabled = parsed.settings.recordingEnabled;
}
```

Extend `snapshot()`:

```js
const snapshot = () => ({
  version:1,
  settings:{ recordingEnabled },
  lifetime:[...lifetime.values()].map((row) => ({ ...row, runIds:[...(row.runIds || [])] })),
  perRun:[...perRun.values()].map((row) => ({ ...row, phasesSeen:[...(row.phasesSeen || [])] })),
  countryCache:Object.fromEntries(countryCache),
});
```

- [ ] **Step 4: Implement confirmed persistence with rollback on failure**

Add:

```js
const getRecordingState = () => ({ recordingEnabled });

const setRecordingState = async (enabled) => {
  const next = Boolean(enabled);
  if (next === recordingEnabled) return getRecordingState();
  const previous = recordingEnabled;
  if (timer) { clearTimeout(timer); timer = null; }
  recordingEnabled = next;
  dirty = true;
  const saved = await writeSnapshot();
  if (!saved) {
    recordingEnabled = previous;
    dirty = true;
    await writeSnapshot();
    throw new Error(persistenceError || 'Proxy IP History recording state could not be saved');
  }
  return getRecordingState();
};
```

Place the first line of `observe()` before validation, country normalization, aggregation, or scheduling:

```js
if (!recordingEnabled) return false;
```

Return the two new methods from `createProxyIpHistoryStore`.

- [ ] **Step 5: Add restart persistence and write-failure rollback tests**

Add a memory-backed persistence test that creates a store, disables recording, recreates the store from the written snapshot, and expects `false`.

Add a re-enable test proving disabled time is not reconstructed and only future observations count:

```js
test('re-enabling history records only future observations', async () => {
  const store = createProxyIpHistoryStore({ filePath:'/tmp/history.json', readFile:() => { throw new Error('missing'); }, writeFile:async () => {}, debounceMs:0 });
  await store.setRecordingState(false);
  store.observe({ runId:'r1', proxySource:'rotating', proxyId:'p1', observedIp:'8.8.8.8', phase:'preflight' });
  await store.setRecordingState(true);
  store.observe({ runId:'r1', proxySource:'rotating', proxyId:'p1', observedIp:'8.8.8.8', phase:'post-behavior' });
  assert.equal(store.getRunSummary('r1').observationCount, 1);
});
```

Add a failure test:

```js
test('recording state rolls back when persistence fails', async () => {
  let fail = false;
  let saved = '';
  const store = createProxyIpHistoryStore({
    filePath:'/tmp/history.json',
    readFile:() => saved || (() => { throw new Error('missing'); })(),
    writeFile:async (_path, data) => { if (fail) throw new Error('disk full'); saved = data; },
    debounceMs:0,
  });
  await store.setRecordingState(false);
  fail = true;
  await assert.rejects(() => store.setRecordingState(true), /disk full|could not be saved/i);
  assert.deepEqual(store.getRecordingState(), { recordingEnabled:false });
});
```

- [ ] **Step 6: Run focused tests GREEN**

Run:

```bash
node --test electron/proxy-ip-history-store.test.cjs
```

Expected: all Proxy IP History store tests pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add electron/proxy-ip-history-store.cjs electron/proxy-ip-history-store.test.cjs
git commit -m "feat: add proxy ip history recording state"
```

---

### Task 2: Recording-State IPC, Types, and ACTIVE/INACTIVE UI

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `electron/proxy-ip-history-ipc-contract.test.cjs`
- Modify: `electron/proxy-ip-history-renderer-source.test.cjs`
- Modify: `src/shared/proxyIpHistory.ts`
- Modify: `src/vite-env.d.ts`
- Modify: `src/pages/ProxyIpHistory.tsx`
- Modify: `src/pages/ProxyIpHistory.test.tsx`
- Modify: `src/styles.css`
- Modify: `electron/layout-css.test.cjs`

**Interfaces:**
- Consumes: Task 1 `getRecordingState()` and `setRecordingState(enabled)`.
- Produces renderer bridge:
  - `getProxyIpHistoryRecordingState(): Promise<ProxyIpHistoryRecordingState>`
  - `setProxyIpHistoryRecordingState(enabled: boolean): Promise<ProxyIpHistoryRecordingState>`
- Produces shared type:

```ts
export interface ProxyIpHistoryRecordingState {
  recordingEnabled: boolean;
}
```

- [ ] **Step 1: Add failing IPC contract assertions**

Extend `electron/proxy-ip-history-ipc-contract.test.cjs` with exact channel expectations:

```js
assert.match(main, /qa:getProxyIpHistoryRecordingState[\s\S]*proxyIpHistory\.getRecordingState\(\)/);
assert.match(main, /qa:setProxyIpHistoryRecordingState[\s\S]*proxyIpHistory\.setRecordingState\(Boolean\(enabled\)\)/);
assert.match(preload, /getProxyIpHistoryRecordingState:[^\n]*qa:getProxyIpHistoryRecordingState/);
assert.match(preload, /setProxyIpHistoryRecordingState:[^\n]*qa:setProxyIpHistoryRecordingState/);
```

- [ ] **Step 2: Run IPC contract test RED**

Run:

```bash
node --test electron/proxy-ip-history-ipc-contract.test.cjs
```

Expected: FAIL because the two IPC channels do not exist.

- [ ] **Step 3: Add main/preload/shared bridge**

In `electron/main.cjs` add:

```js
ipcMain.handle('qa:getProxyIpHistoryRecordingState', () => proxyIpHistory.getRecordingState());
ipcMain.handle('qa:setProxyIpHistoryRecordingState', (_event, enabled) => proxyIpHistory.setRecordingState(Boolean(enabled)));
```

In `electron/preload.cjs` add:

```js
getProxyIpHistoryRecordingState: () => ipcRenderer.invoke('qa:getProxyIpHistoryRecordingState'),
setProxyIpHistoryRecordingState: (enabled) => ipcRenderer.invoke('qa:setProxyIpHistoryRecordingState', enabled),
```

Add the shared interface to `src/shared/proxyIpHistory.ts`, import it in `src/vite-env.d.ts`, and add:

```ts
getProxyIpHistoryRecordingState: () => Promise<ProxyIpHistoryRecordingState>;
setProxyIpHistoryRecordingState: (enabled: boolean) => Promise<ProxyIpHistoryRecordingState>;
```

- [ ] **Step 4: Run IPC contract GREEN**

Run:

```bash
node --test electron/proxy-ip-history-ipc-contract.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Write failing renderer tests for confirmed state and persistence failure**

Add Testing Library cases to `src/pages/ProxyIpHistory.test.tsx` using bridge mocks:

```tsx
it('shows confirmed recording state and only updates after main-process confirmation', async () => {
  let resolveSave!: (value: { recordingEnabled:boolean }) => void;
  const getRecordingState = vi.fn().mockResolvedValue({ recordingEnabled:true });
  const setRecordingState = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
  Object.defineProperty(window, 'orbitqa', {
    configurable:true,
    value:{ listProxyIpHistory, clearProxyIpHistory, exportProxyIpHistoryCsv, getProxyIpHistoryRecordingState:getRecordingState, setProxyIpHistoryRecordingState:setRecordingState },
  });

  render(<ProxyIpHistory />);
  expect(await screen.findByText('ACTIVE')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name:'Set Proxy IP History recording INACTIVE' }));
  expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  resolveSave({ recordingEnabled:false });
  expect(await screen.findByText('INACTIVE')).toBeInTheDocument();
});
```

Add failure behavior:

```tsx
it('keeps the last confirmed state when recording-state persistence fails', async () => {
  Object.defineProperty(window, 'orbitqa', {
    configurable:true,
    value:{
      listProxyIpHistory,
      clearProxyIpHistory,
      exportProxyIpHistoryCsv,
      getProxyIpHistoryRecordingState:vi.fn().mockResolvedValue({ recordingEnabled:true }),
      setProxyIpHistoryRecordingState:vi.fn().mockRejectedValue(new Error('disk full')),
    },
  });
  render(<ProxyIpHistory />);
  await screen.findByText('ACTIVE');
  fireEvent.click(screen.getByRole('button', { name:'Set Proxy IP History recording INACTIVE' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
  expect(screen.getByText('ACTIVE')).toBeInTheDocument();
});
```

Add a view-only behavior case:

```tsx
it('keeps existing history readable, exportable, and clearable while recording is inactive', async () => {
  Object.defineProperty(window, 'orbitqa', {
    configurable:true,
    value:{
      listProxyIpHistory,
      clearProxyIpHistory,
      exportProxyIpHistoryCsv,
      getProxyIpHistoryRecordingState:vi.fn().mockResolvedValue({ recordingEnabled:false }),
      setProxyIpHistoryRecordingState:vi.fn(),
    },
  });
  render(<ProxyIpHistory />);
  expect(await screen.findByText('INACTIVE')).toBeInTheDocument();
  expect(screen.getByText('102.89.33.10')).toBeInTheDocument();
  expect(screen.getByRole('button', { name:'Export CSV' })).toBeEnabled();
  expect(screen.getByRole('button', { name:'Clear History' })).toBeEnabled();
});
```

- [ ] **Step 6: Run frontend test RED on Windows or source-contract RED in the container**

Windows:

```powershell
npx.cmd vitest run src/pages/ProxyIpHistory.test.tsx
```

Container fallback:

```bash
node --test electron/proxy-ip-history-renderer-source.test.cjs
```

Expected: FAIL because the recording control and bridge calls are absent.

- [ ] **Step 7: Implement the page control without optimistic state**

Add state:

```ts
const [recordingState, setRecordingState] = useState<ProxyIpHistoryRecordingState | null>(null);
const [recordingBusy, setRecordingBusy] = useState(false);
```

Load history + state together or in sibling effects. The state effect must call `getProxyIpHistoryRecordingState()` once on page entry.

Implement:

```ts
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
```

Render above the existing summary cards without claiming a state before the main process confirms it:

```tsx
<section className="panel proxy-ip-history-recording" aria-label="Proxy IP History recording">
  <div>
    <span className="section-kicker">PROXY IP HISTORY RECORDING</span>
    <strong>{recordingState == null ? 'LOADING' : recordingState.recordingEnabled ? 'ACTIVE' : 'INACTIVE'}</strong>
    <p>{recordingState == null
      ? 'Reading the confirmed recording state from OrbitQA Desktop.'
      : recordingState.recordingEnabled
        ? 'OrbitQA records new exit-IP observations from Test Runs.'
        : 'History is view-only. New Test Run observations are not being recorded.'}</p>
  </div>
  <div className="proxy-ip-history-recording-actions">
    <button aria-label="Set Proxy IP History recording ACTIVE" disabled={recordingBusy || recordingState == null || recordingState.recordingEnabled} onClick={() => void changeRecording(true)}>ACTIVE</button>
    <button aria-label="Set Proxy IP History recording INACTIVE" disabled={recordingBusy || recordingState == null || !recordingState.recordingEnabled} onClick={() => void changeRecording(false)}>INACTIVE</button>
  </div>
</section>
```

Do not disable table/filter/export/clear controls when recording is INACTIVE.

- [ ] **Step 8: Add bounded styling and layout contract**

Add only component-scoped classes such as `.proxy-ip-history-recording` and `.proxy-ip-history-recording-actions`; no global button overrides. Extend `electron/layout-css.test.cjs` to assert the control has a bounded responsive grid/flex layout and minimum readable text size.

- [ ] **Step 9: Run focused frontend/source/CSS tests GREEN**

Run:

```bash
node --test electron/proxy-ip-history-ipc-contract.test.cjs electron/proxy-ip-history-renderer-source.test.cjs electron/layout-css.test.cjs
```

Windows additionally:

```powershell
npx.cmd vitest run src/pages/ProxyIpHistory.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit Task 2**

```bash
git add electron/main.cjs electron/preload.cjs electron/proxy-ip-history-ipc-contract.test.cjs electron/proxy-ip-history-renderer-source.test.cjs src/shared/proxyIpHistory.ts src/vite-env.d.ts src/pages/ProxyIpHistory.tsx src/pages/ProxyIpHistory.test.tsx src/styles.css electron/layout-css.test.cjs
git commit -m "feat: add proxy ip history recording control"
```

---

### Task 3: Pure Privacy & Route Integrity Report Builder

**Files:**
- Create: `electron/privacy-route-integrity.cjs`
- Create: `electron/privacy-route-integrity.test.cjs`
- Create: `src/shared/privacyRouteIntegrity.ts`

**Interfaces:**
- Consumes existing evidence only; performs no browser/network I/O.
- Produces:

```js
buildPrivacyRouteIntegrityReport({
  phase,                 // 'pre-navigation' | 'pre-behavior' | 'post-behavior'
  deviceMode,
  strictMode,
  proxySource,
  proxyRequired,
  initialRoute,
  finalRoute,
  initialRouteAssessment,
  finalRouteAssessment,
  privacyReport,
  runtimeVerification,
  runtimeLabel,
  identityReport,
  observedAt,
}) -> PrivacyRouteIntegrityReport
```

- Produces helper:

```js
shouldBlockPrivacyRouteIntegrity(report) -> boolean
```

- Produces TypeScript shapes:

```ts
export type PrivacyRouteIntegrityCheckStatus = 'pass' | 'fail' | 'blocked' | 'unsupported' | 'not-verified' | 'info';
export type PrivacyRouteIntegrityPhase = 'pre-navigation' | 'pre-behavior' | 'post-behavior';
export interface PrivacyRouteIntegrityCheck { key:string; label:string; status:PrivacyRouteIntegrityCheckStatus; expected?:string; observed?:string; detail?:string; }
export interface PrivacyRouteIntegrityReport { overallStatus:'pass'|'fail'|'not-verified'; strictMode:boolean; proxyRequired:boolean; checks:PrivacyRouteIntegrityCheck[]; runtimeLabel?:string; observedAt:string; phase:PrivacyRouteIntegrityPhase; }
```

- [ ] **Step 1: Write failing truth-table tests**

Create tests covering at least these cases:

```js
test('required proxy with verified different exit route passes pre-navigation route gate', () => { /* initial assessment pass; expect overallStatus pass */ });
test('required proxy matching host direct IP fails', () => { /* route/fallback fail; expect fail */ });
test('required proxy route probe error under strict privacy is NOT VERIFIED and blocks', () => { /* raw route has error; expect not-verified */ });
test('pre-navigation does not invent permission or WebRTC PASS before those checks have run', () => { /* privacyReport null; no permission PASS */ });
test('WebRTC direct host IP exposure fails a required proxy before behavior', () => { /* phase pre-behavior; privacyReport.webRtcPolicy = exposed */ });
test('indeterminate WebRTC under required strict privacy is NOT VERIFIED and blocks', () => { /* policy indeterminate */ });
test('no-proxy run does not fail because host public route is observed', () => { /* proxyRequired false */ });
test('verified rotating proxy may change exit IP post-behavior without being treated as leak', () => { /* 8.8.8.8 -> 1.1.1.1, both route assessments pass */ });
test('required static/manual proxy changing verified exit IP post-behavior fails continuity', () => { /* non-rotating */ });
test('unsupported WebRTC stays unsupported rather than pass', () => { /* policy unsupported */ });
test('Android AVD and Real iOS missing desktop probes remain unsupported/not-verified, not silently passed', () => { /* deviceMode android-avd/real-ios */ });
test('DNS route integrity is never pass without an independent DNS probe', () => { /* find dns check === not-verified */ });
test('navigator.webdriver is reported as info and never converted into a blocking failure', () => { /* identityReport.observed.webdriver true */ });
```

- [ ] **Step 2: Run new report tests RED**

Run:

```bash
node --test electron/privacy-route-integrity.test.cjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement a pure, phase-aware report builder that reuses existing evidence**

Implement helpers such as:

```js
function findCheck(report, key) {
  return (report?.checks || []).find((check) => check.key === key) || null;
}

function routeCheckStatus({ proxyRequired, strictMode, route, assessment }) {
  if (!proxyRequired) return 'info';
  if (route?.error || !route?.proxiedIp || !route?.directIp) return strictMode ? 'not-verified' : 'fail';
  if (assessment?.route?.status === 'fail' || assessment?.fallback?.status === 'fail') return 'fail';
  return 'pass';
}
```

Phase rules are explicit:

- `pre-navigation`: evaluate only runtime truth plus the already-observed HTTP/proxy route. Do not fabricate permission/WebRTC results before those probes run. DNS may be present only as `not-verified` and is never required.
- `pre-behavior`: add the existing privacy probe and device/automation evidence after target load but before behavior steps. This is where WebRTC/permission failures can block a required Strict Privacy work unit.
- `post-behavior`: add the existing second route observation and continuity check.

Build checks for:
- runtime (`info`), using `runtimeVerification.verificationLabel` when present and otherwise the caller-supplied truthful `runtimeLabel`;
- proxy exit route;
- direct IP exposure;
- WebRTC route privacy when a privacy probe has actually run;
- camera/microphone/geolocation/notifications when a privacy probe has actually run (`blocked` when Strict Privacy has confirmed denied state, `unsupported` when unavailable, `fail` if Strict Privacy says an available permission is not blocked);
- post-behavior route only in `post-behavior` phase;
- DNS (`not-verified`);
- automation environment (`info`) when identity evidence exists, with observed `navigator.webdriver=<value>`.

For runtimes such as Android AVD / Real iOS where a desktop probe is absent, emit `unsupported` or `not-verified` checks rather than substituting desktop-Chromium evidence.

Derive continuity only for post-behavior:

```js
const exitChanged = initialRoute?.proxiedIp && finalRoute?.proxiedIp && initialRoute.proxiedIp !== finalRoute.proxiedIp;
const continuityFail = proxyRequired && proxySource !== 'rotating' && exitChanged;
```

Do **not** fail a rotating proxy merely because the verified non-direct exit IP changes.

Derive overall status:

```js
const hasFail = checks.some((check) => check.status === 'fail');
const requiredNotVerified = proxyRequired && strictMode && checks.some((check) => REQUIRED_ROUTE_KEYS.has(check.key) && check.status === 'not-verified');
const overallStatus = hasFail ? 'fail' : requiredNotVerified ? 'not-verified' : 'pass';
```

Only route/WebRTC checks that are required at the current phase belong in `REQUIRED_ROUTE_KEYS`; pending permission/WebRTC checks during `pre-navigation` do not.

Block only when:

```js
function shouldBlockPrivacyRouteIntegrity(report) {
  return report.overallStatus === 'fail'
    || (report.strictMode && report.proxyRequired && report.overallStatus === 'not-verified');
}
```

Export exactly:

```js
module.exports = { buildPrivacyRouteIntegrityReport, shouldBlockPrivacyRouteIntegrity };
```

- [ ] **Step 4: Run report tests GREEN**

Run:

```bash
node --test electron/privacy-route-integrity.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add electron/privacy-route-integrity.cjs electron/privacy-route-integrity.test.cjs src/shared/privacyRouteIntegrity.ts
git commit -m "feat: add privacy route integrity report"
```

---

### Task 4: Integrate Fail-Closed Privacy Route Integrity into All Test Run Runtime Paths

**Files:**
- Modify: `electron/qa-runner.cjs`
- Modify: `electron/qa-runner.test.cjs`
- Modify: `src/shared/testRun.ts`

**Interfaces:**
- Consumes Task 3 `buildPrivacyRouteIntegrityReport` and `shouldBlockPrivacyRouteIntegrity`.
- Produces new event payload:

```ts
type: 'privacy-route-integrity';
privacyRouteIntegrity?: PrivacyRouteIntegrityReport;
```

- [ ] **Step 1: Write failing runner tests for all three lifecycle phases**

Add focused tests around exported helper/test hooks or runner event capture. Required assertions:

```js
assert.equal(routeGateReport.phase, 'pre-navigation');
assert.equal(routeGateReport.overallStatus, 'not-verified');
assert.equal(shouldBlockPrivacyRouteIntegrity(routeGateReport), true);
```

After target privacy/identity probes but before behavior:

```js
assert.equal(preBehaviorReport.phase, 'pre-behavior');
assert.equal(preBehaviorReport.checks.find((check) => check.key === 'webrtc-route').status, 'fail');
```

For post-behavior static route change:

```js
assert.equal(postReport.phase, 'post-behavior');
assert.equal(postReport.checks.find((check) => check.key === 'post-behavior-route').status, 'fail');
```

Add a rotating-route case proving two verified non-direct exit IPs do not block, plus Android AVD and Real iOS cases proving an honest report is emitted with unsupported/not-verified checks rather than borrowed desktop evidence.

- [ ] **Step 2: Run focused runner tests RED**

Run:

```bash
node --test electron/qa-runner.test.cjs
```

Expected: the new privacy-route-integrity assertions fail because the event/report is not emitted or enforced.

- [ ] **Step 3: Add one runner helper for report emission and capture runtime truth**

Import Task 3:

```js
const { buildPrivacyRouteIntegrityReport, shouldBlockPrivacyRouteIntegrity } = require('./privacy-route-integrity.cjs');
```

Add a helper with explicit runtime context:

```js
function emitPrivacyRouteIntegrity({ pushWork, phase, deviceMode, strictMode, proxySource, proxyRequired, initialRoute, finalRoute, initialRouteAssessment, finalRouteAssessment, privacyReport, runtimeVerification, runtimeLabel, identityReport }) {
  const report = buildPrivacyRouteIntegrityReport({
    phase, deviceMode, strictMode, proxySource, proxyRequired, initialRoute, finalRoute,
    initialRouteAssessment, finalRouteAssessment, privacyReport,
    runtimeVerification, runtimeLabel, identityReport, observedAt:new Date().toISOString(),
  });
  pushWork({
    type:'privacy-route-integrity',
    message: report.overallStatus === 'fail'
      ? 'Privacy & Route Integrity failed'
      : report.overallStatus === 'not-verified'
        ? 'Privacy & Route Integrity could not be fully verified'
        : 'Privacy & Route Integrity passed',
    privacyRouteIntegrity:report,
  });
  return report;
}

function privacyRouteFailureSummary(report) {
  const labels = (report?.checks || [])
    .filter((check) => check.status === 'fail' || check.status === 'not-verified')
    .map((check) => check.label);
  return labels.length > 0 ? labels.join(', ') : report?.overallStatus || 'privacy route integrity failure';
}
```

For desktop/Android-emulation/iOS-emulation launch code, lift runtime verification into an outer variable so later phases use the exact verified runtime:

```js
let currentRuntimeVerification = null;
// inside the existing browser-launch success path:
currentRuntimeVerification = verifyBrowserRuntime({
  runtimeKind:runtimeLaunch.runtimeKind,
  deviceMode:settings.deviceMode,
  executablePath:runtimeLaunch.executablePath,
  browserVersion:typeof browser?.version === 'function' ? browser.version() : undefined,
});
pushWork({
  type:'runtime-verification',
  message:`Browser runtime verified: ${currentRuntimeVerification.verificationLabel}`,
  runtimeVerification:currentRuntimeVerification,
});
```

Do not add a new timer, request, page, or probe.

- [ ] **Step 4: Enforce the existing route observation before target navigation without removing legacy diagnostics**

At the existing required-proxy preflight, after `assessProxyRoute(...)` and before `page.goto(...)`, emit the new route report, then preserve the current session-integrity emission/retry semantics before throwing:

```js
const routeGateReport = emitPrivacyRouteIntegrity({
  pushWork,
  phase:'pre-navigation',
  deviceMode:settings.deviceMode,
  strictMode:settings.privacy.strictMode,
  proxySource:effectiveProxySource,
  proxyRequired:requireRoute,
  initialRoute:initialProxyObservation,
  finalRoute:null,
  initialRouteAssessment:preflight,
  finalRouteAssessment:null,
  privacyReport:null,
  runtimeVerification:currentRuntimeVerification,
  runtimeLabel:workUnitBrowserLabel(workUnit),
  identityReport:null,
});
if (shouldBlockPrivacyRouteIntegrity(routeGateReport)) {
  proxyRuntimeSuspect = true;
  if (effectiveProxySource !== 'rotating' || preflightAttempt > 1) {
    await emitSessionIntegrityReport({
      screenshotDir,
      workId:workUnit.workId,
      pushWork,
      proxySource:effectiveProxySource,
      proxyRequired:true,
      initialRoute:initialProxyObservation,
      finalRoute:null,
      privacyReport:null,
      identityReport:null,
    });
  }
  throw new Error(`PRIVACY ROUTE INTEGRITY FAILED: ${privacyRouteFailureSummary(routeGateReport)}`);
}
```

This keeps the current rotating-proxy one-retry path intact: the first failed rotating route still throws into the existing retry loop, and a later successful retry emits a newer PASS report for the same work unit.

In the legacy runner path, preserve its existing `closeImmediately` and `emitSessionIntegrityReport(...)` behavior before throwing:

```js
const legacyRouteGate = emitPrivacyRouteIntegrity({
  pushWork,
  phase:'pre-navigation',
  deviceMode:normalized.deviceMode,
  strictMode:normalized.privacy.strictMode,
  proxySource:effectiveProxySource,
  proxyRequired:requireRoute,
  initialRoute:initialProxyObservation,
  finalRoute:null,
  initialRouteAssessment:preflight,
  finalRouteAssessment:null,
  privacyReport:null,
  runtimeVerification:null,
  runtimeLabel:workUnitBrowserLabel(workUnit),
  identityReport:null,
});
if (shouldBlockPrivacyRouteIntegrity(legacyRouteGate)) {
  proxyRuntimeSuspect = true;
  closeImmediately = true;
  await emitSessionIntegrityReport({
    screenshotDir,
    workId:workUnit.workId,
    pushWork,
    proxySource:effectiveProxySource,
    proxyRequired:true,
    initialRoute:initialProxyObservation,
    finalRoute:null,
    privacyReport:null,
    identityReport:null,
  });
  throw new Error(`PRIVACY ROUTE INTEGRITY FAILED: ${privacyRouteFailureSummary(legacyRouteGate)}`);
}
```

- [ ] **Step 5: Emit/enforce pre-behavior privacy truth before behavior begins**

Immediately after the existing `privacy-diagnostics` event and **before** the current `if (!shouldRunBehaviorSteps(privacyReport))` throw, emit a pre-behavior report with `identityReport:null` so WebRTC/permission failures are always captured even when they block before identity diagnostics:

```js
const privacyGateIntegrity = emitPrivacyRouteIntegrity({
  pushWork,
  phase:'pre-behavior',
  deviceMode:settings.deviceMode,
  strictMode:settings.privacy.strictMode,
  proxySource:effectiveProxySource,
  proxyRequired,
  initialRoute:initialProxyObservation,
  finalRoute:null,
  initialRouteAssessment:proxyResult,
  finalRouteAssessment:null,
  privacyReport,
  runtimeVerification:currentRuntimeVerification,
  runtimeLabel:workUnitBrowserLabel(workUnit),
  identityReport:null,
});
if (shouldBlockPrivacyRouteIntegrity(privacyGateIntegrity) || !shouldRunBehaviorSteps(privacyReport)) {
  if (runtimeProxy.enabled) proxyRuntimeSuspect = true;
  throw new Error(`PRIVACY ROUTE INTEGRITY FAILED: ${privacyRouteFailureSummary(privacyGateIntegrity)}`);
}
```

If privacy passes, continue collecting the existing device identity report, then emit the same phase once more with `identityReport` populated so the latest stored report includes truthful automation/runtime facts before behavior starts:

```js
const preBehaviorIntegrity = emitPrivacyRouteIntegrity({
  pushWork,
  phase:'pre-behavior',
  deviceMode:settings.deviceMode,
  strictMode:settings.privacy.strictMode,
  proxySource:effectiveProxySource,
  proxyRequired,
  initialRoute:initialProxyObservation,
  finalRoute:null,
  initialRouteAssessment:proxyResult,
  finalRouteAssessment:null,
  privacyReport,
  runtimeVerification:currentRuntimeVerification,
  runtimeLabel:workUnitBrowserLabel(workUnit),
  identityReport,
});
if (shouldBlockPrivacyRouteIntegrity(preBehaviorIntegrity)) {
  if (runtimeProxy.enabled) proxyRuntimeSuspect = true;
  throw new Error(`PRIVACY ROUTE INTEGRITY FAILED: ${privacyRouteFailureSummary(preBehaviorIntegrity)}`);
}
```

In the legacy path, which currently has no identity report, emit only the first form using `deviceMode:normalized.deviceMode`, `strictMode:normalized.privacy.strictMode`, `runtimeVerification:null`, `runtimeLabel:workUnitBrowserLabel(workUnit)`, and `identityReport:null` before the existing privacy-block throw. The builder reports automation identity as not verified rather than fabricating it.

- [ ] **Step 6: Emit/enforce post-behavior report from the existing second route observation**

Immediately after the existing post-behavior `assessProxyRoute(...)`, emit:

```js
const postIntegrity = emitPrivacyRouteIntegrity({
  pushWork,
  phase:'post-behavior',
  deviceMode:settings.deviceMode,
  strictMode:settings.privacy.strictMode,
  proxySource:effectiveProxySource,
  proxyRequired,
  initialRoute:initialProxyObservation,
  finalRoute:observation,
  initialRouteAssessment:proxyResult,
  finalRouteAssessment:assessment,
  privacyReport:finalPrivacyReport,
  runtimeVerification:currentRuntimeVerification,
  runtimeLabel:workUnitBrowserLabel(workUnit),
  identityReport,
});
if (shouldBlockPrivacyRouteIntegrity(postIntegrity)) {
  if (runtimeProxy.enabled) proxyRuntimeSuspect = true;
  throw new Error(`PRIVACY ROUTE INTEGRITY FAILED: ${privacyRouteFailureSummary(postIntegrity)}`);
}
```

In the legacy post-behavior path, use the existing `interactionRouteObservation` and `interactionRouteAssessment` locals:

```js
const legacyPostIntegrity = emitPrivacyRouteIntegrity({
  pushWork,
  phase:'post-behavior',
  deviceMode:normalized.deviceMode,
  strictMode:normalized.privacy.strictMode,
  proxySource:effectiveProxySource,
  proxyRequired:runtimeProxy.enabled && (Boolean(poolAllocation) || runtimeProxy.requireVerifiedRoute === true),
  initialRoute:initialProxyObservation,
  finalRoute:interactionRouteObservation,
  initialRouteAssessment:proxyResult,
  finalRouteAssessment:interactionRouteAssessment,
  privacyReport:finalPrivacyReport,
  runtimeVerification:null,
  runtimeLabel:workUnitBrowserLabel(workUnit),
  identityReport:null,
});
if (shouldBlockPrivacyRouteIntegrity(legacyPostIntegrity)) {
  proxyRuntimeSuspect = true;
  closeImmediately = true;
  throw new Error(`PRIVACY ROUTE INTEGRITY FAILED: ${privacyRouteFailureSummary(legacyPostIntegrity)}`);
}
```

Keep the existing `session-integrity` event/report intact for backward compatibility; v0.18.9 adds the new truthful summary rather than deleting legacy diagnostics.

- [ ] **Step 7: Emit truthful unsupported-runtime reports for Android AVD and Real iOS branches**

Those branches currently return early and do not run the desktop privacy probe. After their existing `runtime-verification` event and before completion, emit a compact report using:

```js
emitPrivacyRouteIntegrity({
  pushWork,
  phase:'pre-behavior',
  deviceMode:settings.deviceMode,
  strictMode:settings.privacy.strictMode,
  proxySource:'none',
  proxyRequired:false,
  initialRoute:null,
  finalRoute:null,
  initialRouteAssessment:null,
  finalRouteAssessment:null,
  privacyReport:null,
  runtimeVerification,
  runtimeLabel:runtimeVerification.verificationLabel,
  identityReport:null,
});
```

The builder must mark unsupported/unverified capabilities honestly and keep overall status non-blocking because those runtime paths do not support OrbitQA proxy routing.

- [ ] **Step 8: Add the new event type/property to `src/shared/testRun.ts`**

Import `PrivacyRouteIntegrityReport`, add `'privacy-route-integrity'` to the `QaEvent['type']` union, and add:

```ts
privacyRouteIntegrity?: PrivacyRouteIntegrityReport;
```

- [ ] **Step 9: Run focused privacy/runner/session regressions GREEN**

Run:

```bash
node --test electron/privacy-route-integrity.test.cjs electron/privacy-probe.test.cjs electron/session-integrity.test.cjs electron/device-consistency.test.cjs electron/proxy-diagnostics.test.cjs electron/qa-runner.test.cjs
```

Expected: PASS, including existing session-integrity behavior and both matrix/legacy runner paths.

- [ ] **Step 10: Commit Task 4**

```bash
git add electron/qa-runner.cjs electron/qa-runner.test.cjs src/shared/testRun.ts
git commit -m "feat: enforce privacy route integrity in test runs"
```

---

### Task 5: Persist Per-Work-Unit Privacy Truth and Render It in Test Runs / Run Center

**Files:**
- Modify: `electron/run-registry.cjs`
- Modify: `electron/run-registry.test.cjs`
- Modify: `src/shared/runCenter.ts`
- Modify: `src/pages/Run.tsx`
- Modify: `src/pages/RunCenter.tsx`
- Create: `electron/privacy-route-integrity-renderer-source.test.cjs`
- Modify: `src/styles.css`
- Modify: `electron/layout-css.test.cjs`

**Interfaces:**
- Consumes Task 4 `QaEvent.privacyRouteIntegrity`.
- Produces `RunDetail.privacyRouteIntegrityByWork?: Record<string, PrivacyRouteIntegrityReport>`.
- Produces live work-unit token values `PRIVACY PASS`, `PRIVACY FAIL`, `NOT VERIFIED` without streaming the full object at high frequency.

- [ ] **Step 1: Write failing Run Registry persistence test**

Add a registry test that emits two reports for the same `workId` and verifies the latest one is retained:

```js
const baseReport = {
  strictMode:true,
  proxyRequired:true,
  checks:[],
  runtimeLabel:'Google Chrome',
  observedAt:'2026-09-19T12:00:00Z',
  phase:'post-behavior',
};
emit({ type:'privacy-route-integrity', workId:'work-1', privacyRouteIntegrity:{ ...baseReport, overallStatus:'pass' } });
emit({ type:'privacy-route-integrity', workId:'work-1', privacyRouteIntegrity:{ ...baseReport, overallStatus:'fail' } });
const detail = registry.getRun(runId);
assert.equal(detail.privacyRouteIntegrityByWork['work-1'].overallStatus, 'fail');
```

- [ ] **Step 2: Run registry test RED**

Run:

```bash
node --test electron/run-registry.test.cjs
```

Expected: FAIL because `privacyRouteIntegrityByWork` is absent.

- [ ] **Step 3: Store latest report per work unit**

In `updateEvent(...)` add:

```js
if (owned.privacyRouteIntegrity && owned.workId) {
  record.results.privacyRouteIntegrityByWork = record.results.privacyRouteIntegrityByWork || {};
  record.results.privacyRouteIntegrityByWork[owned.workId] = owned.privacyRouteIntegrity;
}
```

Ensure `getRun`/detail projection includes `results.privacyRouteIntegrityByWork` using the same pattern as `runtimeVerifications`.

Extend `RunDetail`, importing the type from `./privacyRouteIntegrity`:

```ts
import type { PrivacyRouteIntegrityReport } from './privacyRouteIntegrity';

privacyRouteIntegrityByWork?: Record<string, PrivacyRouteIntegrityReport>;
```

- [ ] **Step 4: Run registry test GREEN**

Run:

```bash
node --test electron/run-registry.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Add a failing source contract for renderer truth**

Create `electron/privacy-route-integrity-renderer-source.test.cjs` asserting:
- `TestRuns.tsx` handles `privacy-route-integrity` events and keeps a per-work map or status token;
- Run Center renders heading `Privacy & Route Integrity`;
- it renders status text for `pass`, `fail`, `not-verified`, plus individual `unsupported`/`blocked`/`info` checks;
- source contains `DNS Route Integrity` rendering only from the report and does not hard-code `DNS ... PASS`;
- source contains automation environment text and does not contain code that writes `navigator.webdriver`.

- [ ] **Step 6: Run renderer source contract RED**

Run:

```bash
node --test electron/privacy-route-integrity-renderer-source.test.cjs
```

Expected: FAIL because the UI does not consume the new report.

- [ ] **Step 7: Render a concise live token in Test Runs**

Import `PrivacyRouteIntegrityReport` from `../shared/privacyRouteIntegrity` and add:

```ts
const [privacyRouteByWork, setPrivacyRouteByWork] = useState<Record<string, PrivacyRouteIntegrityReport>>({});
```

When a `privacy-route-integrity` event arrives with `workId`, update only that entry. In the existing new-run reset block immediately beside `setWorkStates({})` and `setLogs([])`, also call:

```ts
setPrivacyRouteByWork({});
```

so a new run never inherits tokens from the previous run.

In each `.matrix-session-row`, render at most one concise token:

```tsx
{privacyRouteByWork[id] && <small className={`privacy-route-token privacy-route-token--${privacyRouteByWork[id].overallStatus}`}>
  {privacyRouteByWork[id].overallStatus === 'pass' ? 'PRIVACY PASS' : privacyRouteByWork[id].overallStatus === 'fail' ? 'PRIVACY FAIL' : 'NOT VERIFIED'}
</small>}
```

No timer is added.

- [ ] **Step 8: Render detailed per-work reports in Run Center**

Build rows from `detail.privacyRouteIntegrityByWork ?? {}` and render one compact card per work unit with:
- overall status;
- runtime label;
- all checks as label/status/observed/detail;
- `BLOCKED`, `UNSUPPORTED`, `NOT VERIFIED`, `INFO`, `PASS`, `FAIL` text exactly from the report.

Do not derive new privacy claims in the renderer.

- [ ] **Step 9: Add scoped styles and CSS contract**

Add classes for `.privacy-route-token`, `.run-privacy-route-card`, `.run-privacy-route-check`, status modifiers, and responsive wrapping. Extend `layout-css.test.cjs` to reject unreadably small status text and malformed selector concatenation.

- [ ] **Step 10: Run renderer/CSS/registry tests GREEN**

Run:

```bash
node --test electron/privacy-route-integrity-renderer-source.test.cjs electron/layout-css.test.cjs electron/run-registry.test.cjs
```

Windows additionally:

```powershell
npx.cmd vitest run src/pages/RunCenter.test.tsx src/pages/TestRuns.test.tsx
```

Expected: PASS.

- [ ] **Step 11: Commit Task 5**

```bash
git add electron/run-registry.cjs electron/run-registry.test.cjs src/shared/runCenter.ts src/pages/Run.tsx src/pages/RunCenter.tsx electron/privacy-route-integrity-renderer-source.test.cjs src/styles.css electron/layout-css.test.cjs
git commit -m "feat: show privacy route integrity in run ui"
```

---

### Task 6: No-Stealth and Compatibility Regression Contracts

**Files:**
- Modify: `electron/device-consistency.test.cjs`
- Modify: `electron/privacy-probe.test.cjs`
- Create: `electron/privacy-safety-contract.test.cjs`
- Modify: `electron/streaming/streaming-browser-factory.test.cjs` only if shared privacy code was touched during Tasks 3–5.

**Interfaces:**
- Consumes the completed v0.18.9 privacy/reporting behavior.
- Produces regression guards that forbid automation concealment and protect existing runtimes.

- [ ] **Step 1: Write failing/locking safety contract before any cleanup refactor**

Create a source test that reads browser-launch/privacy/device-consistency files and asserts the codebase still contains truthful reporting and does not add known concealment patterns:

```js
assert.match(deviceConsistencySource, /navigator\.webdriver/);
assert.match(deviceConsistencySource, /does not modify or hide it/i);
assert.doesNotMatch(allRelevantSource, /Object\.defineProperty\s*\(\s*navigator\s*,\s*['"]webdriver['"]/);
assert.doesNotMatch(allRelevantSource, /delete\s+navigator\.webdriver/);
assert.doesNotMatch(allRelevantSource, /RTCPeerConnection\s*=\s*undefined/);
assert.doesNotMatch(allRelevantSource, /canvas.*spoof|webgl.*spoof|audiocontext.*spoof/i);
```

This is a regression guard, not a claim that pattern matching can detect every possible concealment mechanism.

- [ ] **Step 2: Run safety contract**

Run:

```bash
node --test electron/privacy-safety-contract.test.cjs
```

Expected: PASS once written against the approved non-stealth baseline. If it fails because Tasks 3–5 accidentally introduced concealment, treat that as a defect and remove the concealment rather than weakening the test.

- [ ] **Step 3: Add explicit existing-protection assertions**

Extend privacy/device tests to continue proving:
- strict privacy guard blocks media/geolocation/notifications without replacing WebRTC APIs;
- WebRTC host-IP exposure is detectable;
- `navigator.webdriver` remains reported as observed;
- unsupported WebRTC remains unsupported/not-applicable at the probe layer;
- runtime/device mode facts remain browser-native/transparent.

- [ ] **Step 4: Run compatibility-focused regression set**

Run:

```bash
node --test electron/privacy-safety-contract.test.cjs electron/privacy-probe.test.cjs electron/device-consistency.test.cjs electron/privacy-route-integrity.test.cjs electron/session-integrity.test.cjs electron/chrome-runtime-resolver.test.cjs electron/browser-runtime-verifier.test.cjs electron/qa-matrix-runtime-source.test.cjs
```

If any shared Streaming privacy helper changed, also run:

```bash
node --test electron/streaming/streaming-browser-factory.test.cjs electron/streaming/streaming-session-worker.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

```bash
git add electron/device-consistency.test.cjs electron/privacy-probe.test.cjs electron/privacy-safety-contract.test.cjs electron/streaming/streaming-browser-factory.test.cjs
git commit -m "test: lock privacy transparency and runtime compatibility"
```

If the Streaming file was not changed, omit it from `git add`.

---

### Task 7: v0.18.9 Release Contract, Full Regression, and Packaging

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Create: `V0.18.9-PRIVACY-HISTORY-CONTROL.md`
- Create: `electron/v0189-release-contract.test.cjs`
- Modify: any existing build/version contract that pins `0.18.8`.

**Interfaces:**
- Consumes all prior tasks.
- Produces version `0.18.9`, cumulative-safe patch ZIP, full backup ZIP, and Windows verification checklist.

- [ ] **Step 1: Write failing release contract**

Create assertions equivalent to:

```js
assert.equal(pkg.version, '0.18.9');
for (const required of [
  'electron/privacy-route-integrity.test.cjs',
  'electron/privacy-route-integrity-renderer-source.test.cjs',
  'electron/privacy-safety-contract.test.cjs',
  'electron/v0189-release-contract.test.cjs',
]) {
  assert.match(pkg.scripts.test, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.match(releaseNote, /Proxy IP History ACTIVE\/INACTIVE/i);
assert.match(releaseNote, /Privacy & Route Integrity/i);
assert.match(releaseNote, /navigator\.webdriver/i);
assert.match(releaseNote, /no stealth|does not conceal/i);
```

- [ ] **Step 2: Run release contract RED**

Run:

```bash
node --test electron/v0189-release-contract.test.cjs
```

Expected: FAIL on version/test-script/release-note requirements.

- [ ] **Step 3: Bump version and include every new Node contract in `npm test`**

Set:

```json
"version": "0.18.9"
```

Append the new `.cjs` tests to the existing Node test list in `scripts.test`; do not remove any existing v0.18.8 test.

- [ ] **Step 4: Write release note and README summary**

Document exactly:
- Proxy IP History ACTIVE/INACTIVE, default ACTIVE;
- disabled mode is view-only and does not record future observations;
- Privacy & Route Integrity Run Detail section;
- required-proxy fail-closed behavior;
- DNS not independently verified;
- `navigator.webdriver` reported truthfully;
- no automation concealment/fingerprint spoofing;
- preserved real-Chrome/runtime paths and recovery functionality.

- [ ] **Step 5: Run release contract GREEN**

Run:

```bash
node --test electron/v0189-release-contract.test.cjs
```

Expected: PASS.

- [ ] **Step 6: Run complete runnable Node/Electron regression**

Run the exact Node portion listed in `package.json` or simply on a Windows/dependency-complete environment:

```powershell
npm.cmd test
```

Container fallback before Windows:

```bash
node --test $(find electron -name '*.test.cjs' ! -name 'browser-health.test.cjs' -print | sort)
```

Expected: all runnable tests pass; if the container lacks Playwright/browser binaries, report only the specifically dependency-blocked browser-health gate instead of claiming it passed.

- [ ] **Step 7: Run syntax/type gates**

For CommonJS:

```bash
find electron -name '*.cjs' -print0 | xargs -0 -n1 node --check
```

For Windows full TypeScript/Vite:

```powershell
npm.cmd run build
```

Expected: zero syntax errors and Windows build exits 0 without warnings/errors introduced by v0.18.9.

- [ ] **Step 8: Windows frontend and live smoke verification**

Run:

```powershell
npm.cmd test
npm.cmd run test:browser-health
npm.cmd run dev
```

Manually verify:
1. Proxy IP History starts ACTIVE on a clean/no-setting profile.
2. Switching INACTIVE survives app restart.
3. While INACTIVE, a Test Run does not increase Proxy IP History counts.
4. Re-enable ACTIVE and confirm future observations are recorded.
5. Run a required-proxy strict-privacy Test Run and confirm preflight + post-behavior integrity entries appear.
6. Confirm a proven wrong/direct route fails only that work unit.
7. Confirm a no-proxy run does not fail on the normal direct route.
8. Confirm Run Detail shows DNS as NOT VERIFIED, automation environment as INFO, and no stealth masking is present.
9. Confirm installed Chrome, Android AVD, WebKit/Firefox compatibility, Stop, Auto Run Again, and Stuck Run Auto-Recovery still operate normally.

- [ ] **Step 9: Build cumulative-safe release artifacts**

Create:

```text
orbitqa-v0.18.9-privacy-history-control-patch.zip
orbitqa-v0.18.9-privacy-history-control-full.zip
```

The patch must be generated from the exact final v0.18.8 + frontend-hotfix baseline and contain every file changed by v0.18.9.

- [ ] **Step 10: Rehearse the exact patch**

1. Copy/extract a clean v0.18.8 + frontend-hotfix baseline.
2. Apply the exact patch ZIP with overwrite-all semantics.
3. Byte-compare the patched tree against the canonical v0.18.9 release tree, excluding generated dependencies/build outputs.
4. Run the focused privacy/history/recovery suite on the patched copy.
5. Verify both ZIPs with an archive-integrity command.

Expected: patched tree matches canonical v0.18.9 source and focused tests pass.

- [ ] **Step 11: Commit Task 7**

```bash
git add package.json README.md V0.18.9-PRIVACY-HISTORY-CONTROL.md electron/v0189-release-contract.test.cjs
git commit -m "release: prepare OrbitQA v0.18.9"
```

---

## Final Verification Checklist

Before calling v0.18.9 complete:

- [ ] Every new production function has a test that was observed failing before implementation.
- [ ] Proxy IP History defaults ACTIVE and persists ACTIVE/INACTIVE across restart.
- [ ] Disabled history performs no observation aggregation, history-only country resolution, or observation-triggered history write.
- [ ] Clear/export/view behavior remains available while recording is INACTIVE.
- [ ] Recording-state persistence failure leaves the last confirmed UI state visible.
- [ ] Required-proxy Strict Privacy fails closed on direct route, WebRTC host-IP leak, wrong/disallowed route, and required-but-unverifiable route evidence.
- [ ] Rotating verified non-direct exit-IP changes are not falsely treated as leaks.
- [ ] No-proxy work units do not fail merely for using the host direct route.
- [ ] Unsupported capabilities and DNS route integrity are never mislabeled PASS.
- [ ] `navigator.webdriver` remains reported and is not modified/hidden.
- [ ] No canvas/WebGL/AudioContext/plugin/font/device spoofing or automation-concealment logic was added.
- [ ] Run Center stores and renders the latest privacy-route report per work unit.
- [ ] Live Test Runs show only a concise status token, with no new high-frequency timer.
- [ ] Full Node/Electron regression is green except any explicitly documented environment-only gate.
- [ ] Windows `npm.cmd run build` and `npm.cmd test` pass.
- [ ] Exact patch rehearsal matches the canonical release tree.
