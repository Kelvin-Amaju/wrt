# Stop Lifecycle, Live Matrix Ads, and Proxy Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make STOP definitive and immediately restartable, render ad observations as a clean Live Matrix card, and completely remove the fetched-free-proxy subsystem while preserving existing authorized proxy modes and all prior OrbitQA behavior.

**Architecture:** Add a backend run-lifecycle state machine that owns IDLE/STARTING/RUNNING/STOPPING transitions and exposes authoritative state to the renderer. Simplify proxy contracts back to none/manual/rotating/static only, excluding any legacy fetched-free records from listing/allocation. Render ad summaries with semantic rows and only non-zero ad types.

**Tech Stack:** Electron, Node.js CommonJS, React 19, TypeScript, Vitest, Node test runner.

**Spec:** Approved conversation design on 2026-09-17: definitive STOP; clean Live Matrix ad card; remove fetched-free proxies completely; preserve all existing v0.12 regressions.

## Global Constraints

- STOP must cancel active and queued work and not report IDLE until backend teardown is complete.
- Starting while a prior STOP is finalizing must wait for teardown rather than throw "A QA run is already active".
- Existing None/Manual/Rotating/Static proxy modes remain unchanged in behavior.
- Legacy fetched-free proxy records must not appear in Proxy Manager or be allocatable as Static Pool entries.
- Ad observation remains passive: detect/count/observe but never click ads or sponsored controls.
- Locale/Timezone checks remain internal while hidden from the visible result UI.
- Preserve popup, external-tab, redirect, WebRTC, privacy, iOS compatibility, scheduler, and concurrency behavior.

---

### Task 1: Authoritative backend run lifecycle

**Files:**
- Create: `electron/run-lifecycle.cjs`
- Create: `electron/run-lifecycle.test.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vite-env.d.ts`
- Modify: `src/pages/Run.tsx`
- Modify: `electron/qa-stop-ipc-contract.test.cjs`

**Interfaces:**
- `createRunLifecycle()` returns `getState()`, `begin(run)`, `markStopping(runId)`, `finish(runId)`, `waitForIdle()`.
- `qa:getRunState` returns `{ phase, runId }`.
- Renderer waits for authoritative `idle` after STOP and before a new START.

- [ ] Write failing tests proving START waits through STOPPING and that STOP completion means no active run remains.
- [ ] Run the lifecycle and IPC contract tests and verify they fail for the missing state machine/status bridge.
- [ ] Implement the lifecycle helper and wire `main.cjs` so active-run ownership is cleared before IDLE is exposed.
- [ ] Wire preload/types/renderer to query backend state after STOP and before START.
- [ ] Re-run targeted tests until green.

### Task 2: Clean Live Matrix advertisement summary

**Files:**
- Modify: `src/pages/Run.tsx`
- Modify: `src/pages/TestRuns.test.tsx`
- Modify: `src/styles.css`
- Modify: `electron/auto-qa/renderer-source.test.cjs`

**Interfaces:**
- Existing `AdSummary` remains unchanged.
- `AdSummaryCard` displays total, observed, status, and only non-zero type rows; zero-ad state displays one clean message.

- [ ] Write failing renderer tests for structured ad rows, hidden zero-count types, and the zero-ad message.
- [ ] Run targeted tests and confirm failure on the old inline sentence layout.
- [ ] Implement semantic card markup and focused CSS.
- [ ] Re-run targeted tests until green.

### Task 3: Remove fetched-free proxy feature and background load

**Files:**
- Delete: `electron/free-proxy-provider.cjs`
- Delete: `electron/free-proxy-provider.test.cjs`
- Modify: `electron/proxy-pool-service.cjs`
- Modify: `electron/proxy-pool-service.test.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `electron/proxy-ipc-contract.test.cjs`
- Modify: `electron/proxy-renderer-contract.test.cjs`
- Modify: `src/shared/proxy.ts`
- Modify: `src/shared/qaMatrix.ts` consumers through proxy type narrowing
- Modify: `src/pages/ProxyManager.tsx`
- Modify: `src/pages/ProxyManager.test.tsx`
- Modify: `src/pages/Run.tsx`
- Modify: `src/pages/TestRuns.test.tsx`
- Modify: `src/components/TargetPlanEditor.tsx`
- Modify: related component tests and default summary fixtures.
- Modify: `src/vite-env.d.ts`
- Modify: `package.json`

**Interfaces:**
- `ProxySource = 'none' | 'manual' | 'rotating' | 'static'`.
- `PoolProxySource = 'rotating' | 'static'`.
- Proxy summary contains only total/live/slow/dead/unavailable/testing plus rotating/static eligible counts.
- Proxy pool `list`, `summary`, `allocate`, scheduler checks and exports exclude legacy records whose `source === 'fetched-free'`.

- [ ] Write failing contract/service/UI tests proving fetched-free controls are absent and legacy fetched-free records cannot be listed or allocated.
- [ ] Run targeted proxy tests and confirm failure against the current candidate.
- [ ] Remove fetching provider, IPC, UI, shared types, and package test entry.
- [ ] Add legacy-record exclusion to proxy-pool service paths.
- [ ] Re-run all proxy and renderer tests until green.

### Task 4: Full regression and packaging

**Files:**
- Modify: release validation note as needed.
- Create final ZIP under `/mnt/data` only after verification.

- [ ] Run every Node backend test including new lifecycle tests.
- [ ] Run CommonJS syntax checks over `electron/**/*.cjs`.
- [ ] Run TypeScript/Vitest/build/browser-health when dependencies are available; report missing-environment limitations truthfully.
- [ ] Search source for remaining `fetched-free`, free-proxy IPC/provider, and old inline ad-summary wording.
- [ ] Verify ZIP integrity.
- [ ] Package only the verified tree.
