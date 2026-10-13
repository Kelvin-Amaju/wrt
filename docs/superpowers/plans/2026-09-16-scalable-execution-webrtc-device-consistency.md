# Scalable Execution, WebRTC Privacy, and Device Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship OrbitQA v0.10 with lazy unbounded requested WorkUnits, Auto/manual concurrency without the old product caps, resource-pressure launch throttling, stricter truthful WebRTC privacy, and profile-consistency reporting that separates controllable device correctness from immutable host/runtime disclosure.

**Architecture:** Replace eager WorkUnit expansion with count/iterator/scheduler primitives and keep only active + small scheduling state in memory. Introduce a single resource-policy module for Auto concurrency and pressure gating, extend the renderer to display lazy queue metrics, and refactor device/WebRTC diagnostics into profile correctness vs runtime disclosure while preserving no-spoofing guarantees. Existing proxy, timer, STOP, screenshot, Smart Interaction, and session-integrity flows remain in place and consume the new interfaces.

**Tech Stack:** Electron 38, Node.js CommonJS backend, Playwright 1.63, React 19, TypeScript 5.9, Vite 7, Vitest 3, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-16-orbitqa-scalable-execution-webrtc-device-consistency-design.md`

## Global Constraints

- Keep the existing 20-target and 12-group editor limits; remove only workload caps.
- Requested instance counts accept any positive integer; there is no product maximum.
- Manual concurrency accepts any positive integer; there is no product maximum.
- Existing numeric saved concurrency values normalize to `{ mode: 'manual', value }`.
- Auto concurrency is derived from CPU/memory policy and is reevaluated only between launches.
- High resource pressure pauses only new launches; active sessions continue.
- STOP prevents new lazy WorkUnits from launching and cancels the remaining count without enumerating them.
- Android AVD exclusivity remains enforced.
- Strict Privacy Mode uses supported browser controls where available and then verifies WebRTC candidates.
- A required-proxy direct-IP WebRTC leak blocks only the affected WorkUnit.
- Never patch/falsify `navigator.webdriver`, `navigator.platform`, GPU, CPU, memory, sensors, canvas, audio, WebRTC candidates, or unrelated APIs to look undetectable.
- Compatibility-emulation host/runtime facts are informational and do not downgrade Profile Consistency.
- Existing proxy allocation, session timers, STOP, Smart Interaction, screenshots, and rotating-route recovery remain behaviorally intact.
- This source archive has no Git metadata, so each task ends with a focused verification checkpoint instead of a commit.

---

### Task 1: Lazy Work-Unit Plan and Unlimited Request Validation

**Files:**
- Modify: `electron/work-unit-scheduler.cjs`
- Modify: `electron/work-unit-scheduler.test.cjs`
- Modify: `src/shared/qaMatrix.ts`
- Modify: `src/shared/qaMatrix.test.ts`

**Interfaces:**
- Produces: `countWorkUnits(request): number`
- Produces: `iterateWorkUnits(request): IterableIterator<QaWorkUnitDescriptor>`
- Preserves temporarily: `expandWorkUnits(request)` as a compatibility helper implemented with `Array.from(iterateWorkUnits(request))` for small tests only; production runner must stop using it in Task 3.
- Produces TS type `QaConcurrencySetting = { mode: 'auto' } | { mode: 'manual'; value: number }`.

- [ ] **Step 1: Write failing scheduler tests for large counts and laziness**

Add tests that prove 50,000 WorkUnits can be counted without materializing and that the iterator yields correct first and last descriptors:

```js
test('counts 50000 work units without an arbitrary cap', () => {
  const input = {
    targets: [{ id: 't1', targetUrl: 'https://example.org', groups: [
      { id: 'g1', executionKind: 'desktop', browser: 'chromium', instances: 50000, sessionDurationSeconds: 60, proxySource: 'none' },
    ] }],
  };
  assert.equal(countWorkUnits(input), 50000);
});

test('iterates large work plans lazily with stable descriptors', () => {
  const input = {
    targets: [{ id: 't1', targetUrl: 'https://example.org', groups: [
      { id: 'g1', executionKind: 'desktop', browser: 'chromium', instances: 50000, sessionDurationSeconds: 60, proxySource: 'none' },
    ] }],
  };
  const iterator = iterateWorkUnits(input);
  assert.equal(iterator.next().value.workId, 't1-g1-instance-1');
  let last;
  for (let i = 1; i < 50000; i += 1) last = iterator.next().value;
  assert.equal(last.workId, 't1-g1-instance-50000');
  assert.equal(iterator.next().done, true);
});
```

- [ ] **Step 2: Run scheduler tests and verify RED**

Run:

```bash
node --test electron/work-unit-scheduler.test.cjs
```

Expected: FAIL because `countWorkUnits`/`iterateWorkUnits` do not exist and the current expansion rejects over 50.

- [ ] **Step 3: Implement lazy count/iterator and remove backend 50-unit cap**

Use nested target/group/instance loops in a generator; do not allocate the whole run:

```js
function countWorkUnits(request) {
  if (!request || !Array.isArray(request.targets)) throw new Error('QA matrix targets are required');
  return request.targets.reduce((total, target) => total + (Array.isArray(target.groups) ? target.groups : [])
    .reduce((groupTotal, group) => groupTotal + Math.max(0, Number(group.instances) || 0), 0), 0);
}

function* iterateWorkUnits(request) {
  if (!request || !Array.isArray(request.targets)) throw new Error('QA matrix targets are required');
  for (let targetIndex = 0; targetIndex < request.targets.length; targetIndex += 1) {
    const target = request.targets[targetIndex];
    const groups = Array.isArray(target.groups) ? target.groups : [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      const instances = Number(group.instances) || 0;
      for (let instanceIndex = 0; instanceIndex < instances; instanceIndex += 1) {
        yield Object.freeze({
          workId: `${target.id}-${group.id}-instance-${instanceIndex + 1}`,
          targetId: target.id,
          targetIndex,
          targetUrl: target.targetUrl,
          groupId: group.id,
          groupIndex,
          instanceIndex,
          executionKind: group.executionKind,
          browser: group.browser,
          deviceProfile: group.deviceProfile,
          androidAvdName: group.androidAvdName,
          realIos: group.realIos,
          orientation: group.orientation,
          locale: group.locale,
          timezoneId: group.timezoneId,
          sessionDurationSeconds: group.sessionDurationSeconds,
          proxySource: group.proxySource,
          allowSlowProxies: group.allowSlowProxies === true,
        });
      }
    }
  }
}
```

Keep `validateAvdConcurrency` but validate the request shape without materializing all non-AVD units: reject `android-avd` groups with `instances > 1` for the same named AVD and duplicate named AVD groups within the request.

- [ ] **Step 4: Write failing TS normalization tests for unlimited instances and concurrency setting**

Add tests equivalent to:

```ts
expect(normalizeQaRunRequestV2({ ...base, targets: hugeTargets, concurrency: 17 }).concurrency)
  .toEqual({ mode: 'manual', value: 17 });
expect(countMatrixWorkUnits(hugeTargets)).toBe(50000);
expect(() => normalizeQaRunRequestV2({ ...base, targets: hugeTargets, concurrency: { mode: 'auto' } })).not.toThrow();
```

- [ ] **Step 5: Run matrix tests and verify RED**

Run:

```bash
npx vitest run src/shared/qaMatrix.test.ts
```

Expected: FAIL on the old 20-instance/50-total/5-concurrency guards and numeric-only type.

- [ ] **Step 6: Implement `QaConcurrencySetting` normalization and remove workload caps**

Update `QaRunRequestV2`:

```ts
export type QaConcurrencySetting =
  | { mode: 'auto' }
  | { mode: 'manual'; value: number };

export interface QaRunRequestV2 {
  targets: QaTargetPlan[];
  concurrency: QaConcurrencySetting;
  headless: boolean;
  interactionIndicator: boolean;
  steps: QaStep[];
  privacy: PrivacyRunSettings;
}
```

Accept legacy numeric values:

```ts
function normalizeConcurrency(value: unknown): QaConcurrencySetting {
  if (value && typeof value === 'object' && (value as { mode?: string }).mode === 'auto') return { mode: 'auto' };
  const raw = value && typeof value === 'object' && (value as { mode?: string }).mode === 'manual'
    ? (value as { value?: unknown }).value
    : value;
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) throw new Error('Manual concurrency must be a positive integer');
  return { mode: 'manual', value: number };
}
```

Change instance validation to positive integer only and delete totalWorkUnits > 50 / concurrency > 5 / concurrency > total errors.

- [ ] **Step 7: Run focused scheduler + matrix tests and verify GREEN**

Run:

```bash
node --test electron/work-unit-scheduler.test.cjs
npx vitest run src/shared/qaMatrix.test.ts
```

Expected: PASS.

---

### Task 2: Auto Concurrency and Resource Pressure Policy

**Files:**
- Create: `electron/resource-policy.cjs`
- Create: `electron/resource-policy.test.cjs`
- Modify: `electron/work-unit-scheduler.cjs`
- Modify: `electron/work-unit-scheduler.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `getResourceSnapshot(): { freeMemoryBytes, totalMemoryBytes, cpuLoadFraction, logicalCpuCount }`
- Produces: `computeAutoConcurrency(snapshot): number`
- Produces: `isLaunchPaused(snapshot): boolean`
- Produces: `isLaunchResumable(snapshot): boolean`
- Extends: `runWorkUnitQueue(source, options, worker, signal)` where `options` contains `requestedCount`, `concurrency`, `resourceProvider`, `onMetrics`, and optional `exclusivityKey`.

- [ ] **Step 1: Write failing policy tests**

Test deterministic snapshots:

```js
test('auto concurrency reserves one CPU and respects memory budget', () => {
  assert.equal(computeAutoConcurrency({ logicalCpuCount: 8, totalMemoryBytes: 16e9, freeMemoryBytes: 12e9, cpuLoadFraction: 0.2 }), 4);
});

test('high pressure pauses and lower pressure resumes launches', () => {
  assert.equal(isLaunchPaused({ logicalCpuCount: 8, totalMemoryBytes: 16e9, freeMemoryBytes: 1e9, cpuLoadFraction: 0.93 }), true);
  assert.equal(isLaunchResumable({ logicalCpuCount: 8, totalMemoryBytes: 16e9, freeMemoryBytes: 6e9, cpuLoadFraction: 0.55 }), true);
});
```

- [ ] **Step 2: Run policy test and verify RED**

Run:

```bash
node --test electron/resource-policy.test.cjs
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement resource policy using Node `os`**

Policy constants live only in this module:

```js
const MEMORY_PER_WORKER_BYTES = 768 * 1024 * 1024;
const PAUSE_FREE_MEMORY_FRACTION = 0.10;
const RESUME_FREE_MEMORY_FRACTION = 0.18;
const PAUSE_CPU_LOAD = 0.92;
const RESUME_CPU_LOAD = 0.78;
```

Auto worker count:

```js
const cpuWorkers = Math.max(1, Math.floor(Math.max(1, logicalCpuCount - 1) / 2));
const memoryWorkers = Math.max(1, Math.floor(freeMemoryBytes / MEMORY_PER_WORKER_BYTES));
return Math.max(1, Math.min(cpuWorkers, memoryWorkers));
```

- [ ] **Step 4: Write failing scheduler tests for >5 manual concurrency, pressure pause/resume, and huge STOP**

Use a generator that counts `next()` calls and assert STOP does not drain it:

```js
test('STOP cancels a huge lazy queue without materializing the remainder', async () => {
  let yielded = 0;
  function* source() { for (let i = 0; i < 50000; i += 1) { yielded += 1; yield i; } }
  const controller = new AbortController();
  await runWorkUnitQueue(source(), {
    requestedCount: 50000,
    concurrency: { mode: 'manual', value: 8 },
    resourceProvider: stableResourceProvider,
  }, async (value) => { if (value === 0) controller.abort(); }, controller.signal);
  assert.ok(yielded < 50);
});
```

- [ ] **Step 5: Implement lazy concurrent queue and metrics**

`runWorkUnitQueue` must:
- pull from the iterator only when a worker slot is available;
- resolve manual/auto concurrency at launch boundaries;
- check pressure before pulling another item;
- wait in short abortable intervals while paused;
- maintain `requested/running/queued/completed/failed/cancelled/incomplete` counters;
- emit metrics through `onMetrics`;
- stop pulling immediately after abort.

Do not pre-create `Promise` objects for all requested units.

- [ ] **Step 6: Add resource-policy tests to `npm test` and run focused tests**

Update package script to include `electron/resource-policy.test.cjs`, then run:

```bash
node --test electron/resource-policy.test.cjs electron/work-unit-scheduler.test.cjs
```

Expected: PASS.

---

### Task 3: Runner Migration to Lazy Queue and Accurate Run Metrics

**Files:**
- Modify: `electron/qa-runner.cjs`
- Modify: `electron/qa-runner.test.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs` only if event typing/bridge shape requires no-op pass-through updates.

**Interfaces:**
- Consumes: `countWorkUnits`, `iterateWorkUnits`, `runWorkUnitQueue`.
- Emits `run-metrics` events with `{ requested, running, queued, completed, failed, cancelled, incomplete }`.
- `run-complete.summary` uses the same counter shape.

- [ ] **Step 1: Write failing runner tests proving no eager expansion**

Use a request with 50,000 instances and stub the WorkUnit executor so only the first few are started, then abort. Assert runner starts promptly and does not allocate/emit 50,000 queued WorkUnit events.

Also add:

```js
assert.equal(firstMetrics.requested, 50000);
assert.equal(firstMetrics.queued, 50000);
assert.ok(events.filter((event) => event.type === 'session-start').length < 20);
```

- [ ] **Step 2: Run runner tests and verify RED**

Run:

```bash
node --test electron/qa-runner.test.cjs
```

Expected: FAIL because the runner still uses eager expansion / numeric concurrency.

- [ ] **Step 3: Replace `expandWorkUnits` production usage**

At run start:

```js
const requested = countWorkUnits(normalizedRequest);
const source = iterateWorkUnits(normalizedRequest);
push({ type: 'run-metrics', metrics: { requested, running: 0, queued: requested, completed: 0, failed: 0, cancelled: 0, incomplete: 0 } });
await runWorkUnitQueue(source, {
  requestedCount: requested,
  concurrency: normalizedRequest.concurrency,
  resourceProvider,
  onMetrics: (metrics) => push({ type: 'run-metrics', metrics }),
  exclusivityKey: (unit) => unit.executionKind === 'android-avd' ? `avd:${unit.androidAvdName}` : null,
}, executeWorkUnit, signal);
```

Preserve existing per-WorkUnit lifecycle, proxy reservation/release, timers, rotating-route recovery, screenshots, and event metadata.

- [ ] **Step 4: Make STOP summary lazy-safe**

When aborted, calculate queued/cancelled from counters (`requested - started terminal/nonterminal counts`) instead of enumerating each unstarted WorkUnit. Do not synthesize one cancellation event per never-started unit.

- [ ] **Step 5: Run runner + STOP tests and verify GREEN**

Run:

```bash
node --test electron/qa-runner.test.cjs electron/qa-stop-ipc-contract.test.cjs electron/work-unit-scheduler.test.cjs
```

Expected: PASS.

---

### Task 4: Renderer Unlimited Counts, Auto Concurrency, and Lazy Queue Metrics

**Files:**
- Modify: `src/components/TargetPlanEditor.tsx`
- Modify: `src/components/TargetPlanEditor.test.tsx`
- Modify: `src/pages/Run.tsx`
- Modify: `src/pages/TestRuns.test.tsx`
- Modify: `src/shared/qaMatrix.ts`

**Interfaces:**
- UI concurrency state becomes `QaConcurrencySetting`.
- Renderer stores aggregate `runMetrics` rather than prebuilding one `workStates` entry for every requested WorkUnit.
- `workStates` remains a bounded map of WorkUnits that have actually emitted lifecycle events so active/recent rows remain inspectable.

- [ ] **Step 1: Write failing renderer tests**

Cover:
- Instances input accepts `50000`.
- Work-unit counter shows `50000 WORK UNITS` without rendering 50,000 rows.
- Concurrency selector supports `Auto` and manual `17`.
- Run metrics render `REQUESTED`, `RUNNING`, `QUEUED`, `COMPLETED`, `FAILED`, `CANCELLED`.
- Starting a 50,000 request does not call a helper that builds 50,000 queued states.

- [ ] **Step 2: Run renderer tests and verify RED**

Run:

```bash
npx vitest run src/components/TargetPlanEditor.test.tsx src/pages/TestRuns.test.tsx
```

Expected: FAIL due old `max=20`, numeric concurrency, and eager `buildQueuedStates`.

- [ ] **Step 3: Remove instance max and change input handling**

Use positive integer text/number handling without a product `max` attribute. On blur/update, reject non-positive/non-integer values through normalization rather than expanding WorkUnits.

- [ ] **Step 4: Add Auto/manual concurrency control**

Render a mode select:

```tsx
<select value={concurrency.mode} onChange={...}>
  <option value="auto">Auto</option>
  <option value="manual">Manual</option>
</select>
```

When manual, show a positive-integer input with no product maximum.

- [ ] **Step 5: Replace eager queued states with aggregate metrics**

Before bridge start, initialize only:

```ts
setRunMetrics({ requested: totalWorkUnits, running: 0, queued: totalWorkUnits, completed: 0, failed: 0, cancelled: 0, incomplete: 0 });
setWorkStates({});
```

Handle `run-metrics` events by replacing aggregate counters. Add WorkUnit rows only after a session event arrives.

- [ ] **Step 6: Run renderer tests and verify GREEN**

Run:

```bash
npx vitest run src/components/TargetPlanEditor.test.tsx src/pages/TestRuns.test.tsx src/shared/qaMatrix.test.ts
```

Expected: PASS.

---

### Task 5: Profile Consistency vs Host/Runtime Disclosure + iOS Functional Tap Verification

**Files:**
- Modify: `electron/device-consistency.cjs`
- Modify: `electron/device-consistency.test.cjs`
- Modify: `src/shared/deviceIdentity.ts`
- Modify: `src/pages/Run.tsx`
- Modify: `electron/device-identity-renderer-source.test.cjs`

**Interfaces:**
- `DeviceIdentityReport` gains:
  - `profileConsistency: 'pass' | 'warning' | 'fail'`
  - `profileChecks: DeviceIdentityCheck[]`
  - `runtimeFacts: DeviceIdentityCheck[]`
  - `functionalCompatibility?: { iosTap?: 'pass' | 'fail' | 'not-applicable'; mobileInteraction?: 'pass' | 'fail' | 'not-applicable' }`
- Existing `overall` remains for backward compatibility and mirrors `profileConsistency`.

- [ ] **Step 1: Write failing device-consistency tests**

Add tests where iOS compatibility has correct UA/viewport/DPR/locale/timezone but:

```js
platform: 'Win32',
maxTouchPoints: 0,
webdriver: true,
```

Expected:

```js
assert.equal(report.profileConsistency, 'pass');
assert.equal(report.overall, 'pass');
assert.equal(report.runtimeFacts.find((c) => c.key === 'platform').classification, 'host-runtime');
assert.equal(report.runtimeFacts.find((c) => c.key === 'webdriver').classification, 'host-runtime');
```

Also test iOS active tap result `fail` makes profile consistency fail.

- [ ] **Step 2: Run device tests and verify RED**

Run:

```bash
node --test electron/device-consistency.test.cjs
```

Expected: FAIL because runtime facts are mixed into `checks` and active tap is absent.

- [ ] **Step 3: Refactor assessment into profile checks and runtime facts**

Profile checks contain UA, viewport, screen/DPR, configured locale/timezone, requested touch/mobile interaction, browser identity. Runtime facts contain `navigator.platform`, `navigator.webdriver`, CPU, memory, and compatibility-engine disclosure.

Add classification union `host-runtime` in TS.

- [ ] **Step 4: Add active iOS functional tap probe**

Implement a DOM-isolated probe that uses the same Playwright click/tap path without modifying the target app state:

```js
async function verifyFunctionalTap(page) {
  return page.evaluate(async () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:4px;height:4px;';
    let activated = false;
    button.addEventListener('click', () => { activated = true; });
    document.documentElement.appendChild(button);
    return { marker: button.dataset.orbitqaTapProbe = '1' };
  }).then(async () => {
    const locator = page.locator('[data-orbitqa-tap-probe="1"]');
    await locator.tap({ timeout: 3000 }).catch(async () => locator.click({ timeout: 3000 }));
    return page.evaluate(() => {
      const button = document.querySelector('[data-orbitqa-tap-probe="1"]');
      const activated = Boolean(button && button.__orbitqaActivated);
      button?.remove();
      return activated;
    });
  });
}
```

Implementation must store activation in a DOM-observable attribute/property correctly; test the helper directly. The probe must not submit forms, navigate, or touch site controls.

- [ ] **Step 5: Render separate sections**

Device Identity panel headings:
- `PROFILE CONSISTENCY`
- `FUNCTIONAL COMPATIBILITY`
- `HOST / RUNTIME INFORMATION`

For local iOS show `Physical iPhone Fidelity: NOT APPLICABLE` explicitly.

- [ ] **Step 6: Run device + renderer-source tests and verify GREEN**

Run:

```bash
node --test electron/device-consistency.test.cjs electron/device-identity-renderer-source.test.cjs
npx vitest run src/pages/TestRuns.test.tsx
```

Expected: PASS.

---

### Task 6: Strict WebRTC Policy and Session-Integrity Integration

**Files:**
- Modify: `electron/privacy-probe.cjs`
- Modify: `electron/privacy-probe.test.cjs`
- Modify: `electron/qa-runner.cjs`
- Modify: `electron/session-integrity.cjs`
- Create or modify: `electron/session-integrity.test.cjs`
- Modify: `src/shared/privacy.ts`
- Modify: `src/shared/sessionIntegrity.ts`
- Modify: `src/pages/Run.tsx`
- Modify: `package.json` if `session-integrity.test.cjs` is newly added to the test script.

**Interfaces:**
- Privacy report gains `webRtcPolicy: 'prevented' | 'verified-no-leak' | 'unsupported' | 'exposed' | 'indeterminate'`.
- Browser launch/context helper returns whether a supported WebRTC restriction was applied.
- Session integrity consumes `identityReport.profileConsistency`, not host/runtime notes.

- [ ] **Step 1: Write failing privacy tests for all five WebRTC policy states**

Cases:
- supported restriction applied + no direct candidate => `prevented`;
- no prevention primitive + no direct candidate => `verified-no-leak`;
- API unavailable => `unsupported`;
- required proxy + direct host public IP candidate => `exposed`, blocked;
- verification throws/fails => `indeterminate`.

- [ ] **Step 2: Run privacy tests and verify RED**

Run:

```bash
node --test electron/privacy-probe.test.cjs
```

Expected: FAIL because current report has only raw supported/candidate fields.

- [ ] **Step 3: Apply browser-supported WebRTC restrictions without spoofing**

For Chromium-based contexts under Strict Privacy Mode, add only supported launch/context policy (e.g. Chromium WebRTC IP handling policy preference where Playwright launch arguments support it) and record `preventionApplied=true`. Do not patch `RTCPeerConnection`, rewrite candidates, or hide API existence. Firefox/WebKit use verification-only when no equivalent supported control exists.

- [ ] **Step 4: Compute and persist WebRTC policy status**

After ICE collection compare literal candidates against the known direct host IP when proxy is required. Return `exposed` and block the affected WorkUnit when the direct IP is present. `unsupported` is not a false PASS.

- [ ] **Step 5: Write failing session-integrity tests**

Assert:

```js
assert.equal(buildSessionIntegrityReport({ identityReport: { profileConsistency: 'pass', runtimeFacts: [{ status: 'warning' }] }, ... }).checks.find(c => c.key === 'device-consistency').status, 'pass');
```

Also assert direct-IP WebRTC exposure is a required failure under required proxy.

- [ ] **Step 6: Update session integrity**

Device line reads only `profileConsistency`. WebRTC line uses privacy `webRtcPolicy`; `prevented` and `verified-no-leak` => PASS, `unsupported` => NOT APPLICABLE, `exposed` => FAIL when proxy required, `indeterminate` => WARNING/FAIL according to requirement.

- [ ] **Step 7: Run privacy + integrity tests and verify GREEN**

Run:

```bash
node --test electron/privacy-probe.test.cjs electron/session-integrity.test.cjs electron/qa-runner.test.cjs
```

Expected: PASS.

---

### Task 7: Full Regression, Build, Browser Health, and v0.10 Release Package

**Files:**
- Modify: `package.json` version to `0.10.0`
- Create: `V0.10.0-SCALABLE-EXECUTION-WEBRTC-DEVICE-CONSISTENCY.txt`
- Modify: `README.md` release notes / current capabilities.

**Interfaces:** No new runtime interfaces; this task verifies the integrated release.

- [ ] **Step 1: Run full automated tests**

Run:

```bash
npm test
```

Expected: all Vitest + backend Node tests PASS with 0 failures.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: TypeScript `--noEmit` and Vite production build both exit 0.

- [ ] **Step 3: Run browser-health verification**

Run:

```bash
npm run test:browser-health
```

Expected: Chromium, Firefox, WebKit health tests all PASS in the build environment if browser binaries are available. If unavailable in this environment, record that limitation and require the user's Windows verification exactly as previous releases.

- [ ] **Step 4: Verify acceptance criteria with targeted commands**

Run focused tests proving:
- 50,000 count + lazy STOP;
- manual concurrency 8+;
- Auto policy;
- resource pause/resume;
- iOS `Win32`/`webdriver`/0 touch runtime facts with Profile Consistency PASS;
- active iOS tap failure still fails profile consistency;
- required-proxy direct-IP WebRTC leak blocks;
- session integrity stays VERIFIED when only host/runtime compatibility notes exist.

- [ ] **Step 5: Package release ZIP**

Create:

```text
/mnt/data/orbitqa-v0.10.0-scalable-execution-webrtc-device-consistency.zip
```

Exclude `node_modules`, `dist`, temporary test output, and any secrets/local proxy stores.

- [ ] **Step 6: Verify ZIP integrity and contents**

Run:

```bash
unzip -t /mnt/data/orbitqa-v0.10.0-scalable-execution-webrtc-device-consistency.zip
```

Expected: `No errors detected`.

- [ ] **Step 7: Hand off Windows verification**

Ask the user to replace files without deleting `node_modules`, then run:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:browser-health
npm.cmd run dev
```

The live acceptance check should request a large count without launching it fully, verify Auto/manual concurrency UI, then run a small proxied Desktop + Pixel + iPhone compatibility matrix and inspect Profile Consistency + WebRTC/Session Integrity.

---

## Self-Review

- Spec coverage: every acceptance criterion maps to Tasks 1–7.
- Placeholder scan: no TBD/TODO/"implement later" instructions remain.
- Type consistency: `QaConcurrencySetting`, `profileConsistency`, `runtimeFacts`, `webRtcPolicy`, and aggregate run metrics are named consistently across backend/shared/UI tasks.
- Scope control: Android AVD reliability and Real iOS provider scaling remain explicitly out of scope except preserving existing exclusivity/provider behavior.
