# OrbitQA Run Center / Multi-Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OrbitQA's single-active-run model with a persistent Run Center that can execute multiple isolated runs concurrently, pause unfinished runs on app exit, resume them on restart, and support per-run Visible Desktop or Background execution.

**Architecture:** Introduce a backend `run-registry` as the authoritative owner of run state, plus a durable `run-store` and a fair `global-run-scheduler`. Existing `executeQaRun` stays the per-run execution engine, but receives a run-scoped scheduler lease and execution mode. Renderer state moves from one mutable Test Runs session to run-scoped data exposed through new IPC and a Run Center page.

**Tech Stack:** Electron main process, Node/CommonJS, React 18 + TypeScript, Vite, Playwright, Node test runner, Vitest/React Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-17-run-center-multi-run-design.md`

## Global Constraints

- Multiple STARTING/RUNNING/PAUSED/STOPPING runs may coexist.
- Every event emitted by the backend must carry the owning `runId`.
- STOP is strictly per-run unless the user explicitly invokes Stop All.
- App navigation never changes run lifecycle state.
- App shutdown pauses unfinished runs; app startup automatically resumes them.
- In-flight WorkUnits at shutdown are persisted as restartable pending work, never as completed.
- Per-run execution mode is `visible` or `background`; background mode must keep the same QA logic and privacy checks.
- Existing popup, Auto-QA, ad, proxy, WebRTC, device, URL-pool, mixed-device, auxiliary-tab, navigation-resilience, and STOP semantics must not regress.
- Fetched free proxies remain removed.

---

### Task 1: Add Shared Multi-Run Domain Types

**Files:**
- Create: `src/shared/runCenter.ts`
- Create: `src/shared/runCenter.test.ts`
- Modify: `src/shared/qaMatrix.ts`
- Modify: `src/shared/testRun.ts`

**Interfaces:**
- Produces `RunStatus`, `RunExecutionMode`, `RunSummary`, `RunDetail`, `PersistedRunRecord`, `RunCheckpoint`, and `RunCenterEvent`.
- Adds `executionMode: 'visible' | 'background'` to `QaRunRequestV3`.
- Keeps `QaEvent.runId` mandatory.

- [ ] **Step 1: Write failing tests for status normalization, terminal-state detection, and execution-mode defaults.**

```ts
import { describe, expect, it } from 'vitest';
import { isTerminalRunStatus, normalizeRunExecutionMode } from './runCenter';

describe('run center domain', () => {
  it('treats only completed, failed, and stopped as terminal', () => {
    expect(isTerminalRunStatus('RUNNING')).toBe(false);
    expect(isTerminalRunStatus('PAUSED')).toBe(false);
    expect(isTerminalRunStatus('COMPLETED')).toBe(true);
    expect(isTerminalRunStatus('FAILED')).toBe(true);
    expect(isTerminalRunStatus('STOPPED')).toBe(true);
  });

  it('defaults execution mode to visible', () => {
    expect(normalizeRunExecutionMode(undefined)).toBe('visible');
    expect(normalizeRunExecutionMode('background')).toBe('background');
  });
});
```

- [ ] **Step 2: Run the new test and verify RED.**

Run:
```bash
npm test -- src/shared/runCenter.test.ts
```
Expected: fail because `src/shared/runCenter.ts` does not exist.

- [ ] **Step 3: Implement the shared types and helpers.**

`src/shared/runCenter.ts` must export:
```ts
export type RunStatus = 'CREATED' | 'STARTING' | 'RUNNING' | 'PAUSING' | 'PAUSED' | 'RESUMING' | 'STOPPING' | 'STOPPED' | 'COMPLETED' | 'FAILED';
export type RunExecutionMode = 'visible' | 'background';
export type RunCounters = { requested: number; running: number; queued: number; completed: number; failed: number; cancelled: number; incomplete: number };
export type RunSummary = { runId: string; createdAt: string; updatedAt: string; status: RunStatus; executionMode: RunExecutionMode; requestedConcurrency: number | 'auto'; targetSummary: string; deviceFamilies: string[]; counters: RunCounters; resourceMessage?: string };
export type RunDetail = RunSummary & { config: unknown; logs: unknown[]; latestPrivacy?: unknown; latestIdentity?: unknown; latestIntegrity?: unknown; latestAdSummary?: unknown };
export type RunCheckpoint = { nextWorkOrdinal: number; terminalWorkIds: string[]; inFlightWorkIds: string[]; urlDeckState?: unknown };
export type PersistedRunRecord = { schemaVersion: 1; summary: RunSummary; config: unknown; checkpoint: RunCheckpoint; logs: unknown[]; results: Record<string, unknown>; lastCheckpointAt: string };
export function isTerminalRunStatus(status: RunStatus): boolean { return status === 'COMPLETED' || status === 'FAILED' || status === 'STOPPED'; }
export function normalizeRunExecutionMode(value: unknown): RunExecutionMode { return value === 'background' ? 'background' : 'visible'; }
```

Add to `QaRunRequestV3`:
```ts
executionMode: RunExecutionMode;
```
Default to `visible` inside `normalizeQaRunRequestV3`.

- [ ] **Step 4: Run shared tests and the existing matrix tests.**

```bash
npm test -- src/shared/runCenter.test.ts src/shared/qaMatrix.test.ts src/shared/testRun.test.ts
```
Expected: all pass.

---

### Task 2: Build the Durable Run Store

**Files:**
- Create: `electron/run-store.cjs`
- Create: `electron/run-store.test.cjs`

**Interfaces:**
- `createRunStore({ userDataPath })`
- `list()` -> persisted run records
- `get(runId)` -> record or null
- `save(record)` -> atomic temp-write + fsync + rename
- `remove(runId)`
- `loadRecoverable()` -> records with corrupt/incompatible records converted to recovery failures instead of throwing

- [ ] **Step 1: Write failing tests for atomic save/load, multiple runs, corrupt JSON, and schema mismatch.**

Test cases must assert:
```js
assert.equal(store.get('RUN-A').summary.status, 'PAUSED');
assert.equal(store.list().length, 2);
assert.equal(recovered[0].summary.status, 'FAILED');
assert.match(recovered[0].summary.resourceMessage, /recovery/i);
```

- [ ] **Step 2: Run the store test and verify RED.**

```bash
node --test electron/run-store.test.cjs
```
Expected: module-not-found failure.

- [ ] **Step 3: Implement atomic JSON persistence.**

Use one file per run under:
```text
<userData>/run-center/<runId>.json
```
`save()` must write `<runId>.json.tmp`, open/sync/close, then rename to `<runId>.json`.

- [ ] **Step 4: Run the store tests.**

```bash
node --test electron/run-store.test.cjs
```
Expected: pass.

---

### Task 3: Replace Single Active Run With a Run Registry

**Files:**
- Create: `electron/run-registry.cjs`
- Create: `electron/run-registry.test.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`

**Interfaces:**
- `createRunRegistry({ runStore, executeRun, realIosService, screenshotsRootProvider })`
- `createRun(config)` -> `{ runId }`
- `listRuns()`
- `getRun(runId)`
- `stopRun(runId)`
- `pauseRun(runId)`
- `resumeRun(runId)`
- `stopAllRuns()`
- `pauseAllForShutdown()`
- `resumePersistedRuns()`
- `subscribe(listener)` returns unsubscribe

- [ ] **Step 1: Write failing tests proving Run A and Run B can coexist and STOP A does not abort B.**

Use a fake `executeRun` that waits on per-run AbortSignals. Assert:
```js
const a = await registry.createRun(configA);
const b = await registry.createRun(configB);
assert.notEqual(a.runId, b.runId);
assert.equal(registry.listRuns().filter((r) => r.status === 'RUNNING').length, 2);
await registry.stopRun(a.runId);
assert.equal(registry.getRun(a.runId).status, 'STOPPED');
assert.equal(registry.getRun(b.runId).status, 'RUNNING');
```

Also verify every emitted event includes the correct `runId`.

- [ ] **Step 2: Run the registry test and verify RED.**

```bash
node --test electron/run-registry.test.cjs
```

- [ ] **Step 3: Implement registry lifecycle and replace `runLifecycle` usage in `main.cjs`.**

Remove the single global `runLifecycle` start gate. Register IPC handlers:
```text
qa:createRun
qa:listRuns
qa:getRun
qa:stopRun
qa:pauseRun
qa:resumeRun
qa:stopAllRuns
```
Preserve `qa:startRun` only as a backward-compatible alias that calls `qa:createRun` during this release.

Every backend event sent to renderer must include `runId`.

- [ ] **Step 4: Update preload bridge with run-scoped methods.**

Expose:
```js
createQaRun, listQaRuns, getQaRun, stopQaRun, pauseQaRun, resumeQaRun, stopAllQaRuns, onQaEvent
```

- [ ] **Step 5: Run registry, main-source, preload, and old lifecycle tests.**

```bash
node --test electron/run-registry.test.cjs electron/run-lifecycle.test.cjs electron/run-terminal-gate.test.cjs electron/scalable-runner-source.test.cjs
```
Expected: all pass; old lifecycle helpers may remain only where still used by tests, but `main.cjs` no longer depends on a single-active-run gate.

---

### Task 4: Add Fair Global Multi-Run Scheduling

**Files:**
- Create: `electron/global-run-scheduler.cjs`
- Create: `electron/global-run-scheduler.test.cjs`
- Modify: `electron/qa-runner.cjs`
- Modify: `electron/work-unit-scheduler.cjs`

**Interfaces:**
- `createGlobalRunScheduler({ startupLimit })`
- `registerRun(runId, requestedConcurrency)`
- `unregisterRun(runId)`
- `requestLaunch(runId, signal)` -> lease release function
- round-robin fairness across runnable runs
- existing per-run mixed-device scheduler remains unchanged inside a run

- [ ] **Step 1: Write failing tests for fairness across 3 runs and independent per-run ceilings.**

Test order must demonstrate A/B/C rotation rather than A draining first. Also assert a run with concurrency 2 never holds more than 2 active leases.

- [ ] **Step 2: Run the scheduler test and verify RED.**

```bash
node --test electron/global-run-scheduler.test.cjs
```

- [ ] **Step 3: Implement the scheduler and pass it into each run execution.**

In `executeQaRun`, wrap browser/work-unit launch entry with a global lease:
```js
const releaseGlobal = await globalRunScheduler.requestLaunch(runId, signal);
try {
  // existing run-specific launch path
} finally {
  releaseGlobal();
}
```
Do not alter the existing per-run mixed-device ordering logic.

- [ ] **Step 4: Run global + existing scheduler tests.**

```bash
node --test electron/global-run-scheduler.test.cjs electron/work-unit-scheduler.test.cjs electron/resource-policy.test.cjs
```
Expected: all pass.

---

### Task 5: Add Visible and Background Execution Per Run

**Files:**
- Modify: `src/shared/qaMatrix.ts`
- Modify: `src/components/DeviceMatrixEditor.tsx`
- Modify: `src/pages/Run.tsx`
- Modify: `electron/qa-runner.cjs`
- Create: `electron/execution-mode.test.cjs`
- Modify: `src/pages/TestRuns.test.tsx`

**Interfaces:**
- `executionMode: 'visible' | 'background'`
- visible -> headed browser launches
- background -> hidden/headless browser launches while preserving Auto-QA logic

- [ ] **Step 1: Write failing backend tests mapping execution mode to launch visibility.**

Assert:
```js
assert.equal(resolveRunHeadless('visible'), false);
assert.equal(resolveRunHeadless('background'), true);
```
and verify the same Auto-QA behavior configuration is passed in both modes.

- [ ] **Step 2: Write failing renderer test for the execution-mode selector.**

Test labels:
```text
Visible Desktop Activity
Background Activity
```
Selecting Background must include `executionMode: 'background'` in the request snapshot.

- [ ] **Step 3: Implement execution-mode selection in Test Runs and runner launch options.**

Keep the existing interaction indicator disabled automatically for background mode only because there is no visible surface to display it on; do not reduce Auto-QA actions.

- [ ] **Step 4: Run execution-mode and Test Runs tests.**

```bash
node --test electron/execution-mode.test.cjs
npm test -- src/pages/TestRuns.test.tsx src/shared/qaMatrix.test.ts
```
Expected: all pass.

---

### Task 6: Implement Pause-on-Exit and Automatic Resume

**Files:**
- Modify: `electron/run-registry.cjs`
- Modify: `electron/main.cjs`
- Create: `electron/run-recovery.test.cjs`
- Modify: `electron/qa-runner.cjs`

**Interfaces:**
- shutdown: RUNNING/STARTING -> PAUSING -> PAUSED persisted
- in-flight WorkUnits -> pending/restartable checkpoint
- startup: PAUSED -> RESUMING -> RUNNING automatically
- STOPPED/FAILED/COMPLETED never auto-resume

- [ ] **Step 1: Write failing recovery tests.**

Cover:
```text
one active run -> pause -> restart -> resume
multiple active runs -> independent resume
completed + stopped + active -> only active resumes
in-flight WorkUnit is pending after checkpoint
completed WorkUnit does not rerun
```

- [ ] **Step 2: Run recovery tests and verify RED.**

```bash
node --test electron/run-recovery.test.cjs
```

- [ ] **Step 3: Implement checkpoint hooks in run execution.**

At each WorkUnit terminal transition, update persisted terminal IDs and counters. During shutdown, abort active contexts with a pause reason and persist active WorkUnit IDs as pending rather than terminal.

- [ ] **Step 4: Wire Electron shutdown/startup.**

`before-quit` must await `runRegistry.pauseAllForShutdown()` before final exit. After services initialize in `app.whenReady()`, call `runRegistry.resumePersistedRuns()` before/after window creation without blocking the renderer from opening.

- [ ] **Step 5: Run recovery and shutdown regression tests.**

```bash
node --test electron/run-recovery.test.cjs electron/session-lifetime.test.cjs electron/qa-runner.test.cjs
```
Expected: all pass.

---

### Task 7: Build Run Center UI and Run-Scoped Detail View

**Files:**
- Create: `src/pages/RunCenter.tsx`
- Create: `src/pages/RunCenter.test.tsx`
- Create: `src/components/RunCard.tsx`
- Create: `src/components/RunCard.test.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/pages/Run.tsx`

**Interfaces:**
- Sidebar page key `runs`
- Run Center polls/loads `listQaRuns()` and subscribes to run events
- Run detail is scoped by `runId`
- Test Runs creates a run but remains usable for creating another run

- [ ] **Step 1: Write failing RunCard tests.**

Assert card shows:
```text
run ID/name
status text
Visible or Background badge
requested concurrency
Running / Queued / Completed / Failed
Open
Stop
Pause or Resume where valid
```
Do not rely on color alone.

- [ ] **Step 2: Write failing Run Center tests for two simultaneous runs and per-run Stop.**

Stopping Run A must call `stopQaRun('RUN-A')` and must not mutate Run B's displayed status.

- [ ] **Step 3: Update Sidebar and App routing.**

Add:
```text
Run Center
```
after Test Runs, with a numeric badge for active runs when available.

- [ ] **Step 4: Implement the Run Center card/grid and detail surface.**

The detail surface must show, scoped to the selected run:
```text
LIVE MATRIX / Latest Result
Work Units
Activity Log
Device Identity
Privacy & Network
Ad Summary
Counters
Configuration summary
```
Reuse extracted rendering helpers from `TestRuns.tsx` where possible instead of duplicating business logic.

- [ ] **Step 5: Refactor Test Runs to become creation-only after a run starts.**

On successful create:
- keep the editor mounted and editable
- show a non-blocking "Run created" confirmation with run ID
- do not attach all runtime logs/counters to the editor
- allow immediate creation of another run

- [ ] **Step 6: Run renderer tests.**

```bash
npm test -- src/components/RunCard.test.tsx src/pages/RunCenter.test.tsx src/pages/TestRuns.test.tsx src/App.test.tsx
```
Expected: all pass.

---

### Task 8: Add Stop All, Failure Isolation, and Cross-Run Event Guards

**Files:**
- Modify: `electron/run-registry.cjs`
- Modify: `src/pages/RunCenter.tsx`
- Create: `electron/multi-run-isolation.test.cjs`
- Modify: `src/pages/RunCenter.test.tsx`

**Interfaces:**
- `stopAllRuns()` explicit only
- one run error never aborts unrelated runs
- renderer discards/misroutes no events because every event is keyed by run ID

- [ ] **Step 1: Write failing isolation tests.**

Cover:
```text
Run A throws -> Run A FAILED, Run B still RUNNING
STOP A closes only A contexts
Stop All stops all non-terminal runs
run event for A cannot change B counters/logs
```

- [ ] **Step 2: Implement registry isolation and explicit Stop All.**

Run Center must require an explicit confirmation control before invoking `stopAllQaRuns()`.

- [ ] **Step 3: Run isolation tests.**

```bash
node --test electron/multi-run-isolation.test.cjs
npm test -- src/pages/RunCenter.test.tsx
```
Expected: all pass.

---

### Task 9: Full Regression, Build, Browser Health, and Packaging

**Files:**
- Modify only if a failing regression identifies a root cause.
- Create release note: `V0.13.0-RUN-CENTER-MULTI-RUN.txt`

**Interfaces:**
- No new functionality in this task; verification only.

- [ ] **Step 1: Run the complete Node/backend suite.**

```bash
node --test electron/*.test.cjs electron/auto-qa/*.test.cjs
```
Expected: 0 failures.

- [ ] **Step 2: Run the complete renderer/Vitest suite.**

```bash
npm test
```
Expected: 0 failures.

- [ ] **Step 3: Run TypeScript/Vite build.**

```bash
npm run build
```
Expected: exit code 0.

- [ ] **Step 4: Run browser health.**

```bash
npm run test:browser-health
```
Expected: exit code 0 in an environment with installed Playwright browsers.

- [ ] **Step 5: Re-run the spec acceptance matrix explicitly.**

Verify all 25 acceptance items in `docs/superpowers/specs/2026-09-17-run-center-multi-run-design.md`, including:
```text
A + B concurrent
STOP A leaves B alive
3-run fairness
visible + background concurrent
shutdown -> PAUSED persistence
restart -> automatic resume
in-flight restart
completed work not repeated
multiple paused runs resume independently
auxiliary-tab scoping
Stop All
all existing popup/proxy/WebRTC/device/URL pool regressions
corrupt store recovery
```

- [ ] **Step 6: Create the release note and package only the verified tree.**

Release note must state the verified test counts and any environment-specific checks that could not be run. Package the source ZIP only after Steps 1-5 are green.

---

## Plan Self-Review

- Spec coverage: every Run Center design section maps to Tasks 1-9.
- Persistence and startup recovery are separate from registry lifecycle so failures are isolated and testable.
- Existing per-run scheduler is preserved; only global fairness is added above it.
- Background execution changes browser visibility only, not behavior logic.
- Renderer receives only run-scoped events and details.
- STOP and Stop All remain explicit and isolated.
- No fetched-free-proxy work is reintroduced.
- No placeholders or undefined interfaces remain in this plan.
