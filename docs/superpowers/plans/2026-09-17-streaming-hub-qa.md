# Streaming Hub QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Streaming Hub subsystem for authorized catalog management, test-account session management, playback/navigation QA, and Run Center orchestration without artificial engagement behavior.

**Architecture:** Add platform-neutral streaming domain types and stores, then expose platform adapters behind one interface. Reuse OrbitQA's existing BrowserContext, proxy/privacy, global scheduler, multi-run registry, checkpoint/recovery, screenshot, and Run Center infrastructure. Streaming runs are a new run kind, not a second scheduler.

**Tech Stack:** Electron 38, React 19, TypeScript 5.9, Vite 7, Vitest 3, Node test runner, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-17-streaming-hub-qa-design.md`

## Global Constraints

- Base implementation on OrbitQA Desktop v0.13.4.
- Preserve all existing normal QA behavior and Run Center multi-run semantics.
- Do not automate follow/favorite/subscribe/ad-click behavior or hide automation observability.
- Do not persist browser/page objects or raw authentication secrets in run logs.
- Reuse existing proxy/direct-IP/WebRTC/privacy checks before platform activity.
- Background and visible execution must use the same QA logic.
- Screenshot capture must respect the existing per-run screenshot setting.
- Every production change follows red-green TDD.
- Final handoff requires `npm.cmd run build`, `npm.cmd test`, and `npm.cmd run test:browser-health` on Windows before the release is called fully verified.

---

### Task 1: Add Streaming Domain Types and Run Kind

**Files:**
- Create: `src/shared/streaming.ts`
- Create: `src/shared/streaming.test.ts`
- Modify: `src/shared/runCenter.ts`
- Modify: `src/shared/runCenter.test.ts`
- Modify: `src/shared/qaMatrix.ts`
- Modify: `src/shared/qaMatrix.test.ts`

**Interfaces:**
- Produces `StreamingPlatform`, `StreamingQueueMode`, `StreamingQaCheck`, `StreamingTrack`, `StreamingCollection`, `StreamingAccountPublic`, `StreamingRunConfig`, and validation helpers.
- Extends run records with `runKind: 'qa' | 'streaming'` while defaulting legacy records to `qa`.

- [ ] **Step 1: Write failing shared-type tests**

Add tests that verify:

```ts
expect(normalizeStreamingQueueMode('shuffle')).toBe('shuffle');
expect(normalizeStreamingQueueMode('garbage')).toBe('sequential');
expect(normalizeObservationRange({ minSeconds: 110, maxSeconds: 60 })).toEqual({ minSeconds: 60, maxSeconds: 110 });
expect(normalizeRunKind(undefined)).toBe('qa');
expect(normalizeRunKind('streaming')).toBe('streaming');
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npm test -- --run src/shared/streaming.test.ts src/shared/runCenter.test.ts src/shared/qaMatrix.test.ts
```

Expected: failures because the streaming types/helpers and `runKind` do not exist.

- [ ] **Step 3: Implement the domain types and normalizers**

Define:

```ts
export type StreamingPlatform = 'spotify' | 'youtube-music' | 'soundcloud' | 'deezer' | 'tidal' | 'audiomack' | 'pandora';
export type StreamingQueueMode = 'sequential' | 'shuffle' | 'loop';
export type StreamingQaCheck = 'playback' | 'pause-resume' | 'next-track' | 'previous-track' | 'queue-transition' | 'volume-control' | 'artist-navigation' | 'album-navigation' | 'playlist-loading' | 'session-verification';
```

Add `runKind` to `RunSummary`/`PersistedRunRecord` normalization and preserve backward compatibility.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same command and require 0 failures.

- [ ] **Step 5: Record implementation checkpoint**

Because this exported OrbitQA workspace has no Git metadata, record the task completion in the plan checklist rather than inventing a commit.

---

### Task 2: Add Persistent Catalog and Account Stores

**Files:**
- Create: `electron/streaming/collection-store.cjs`
- Create: `electron/streaming/collection-store.test.cjs`
- Create: `electron/streaming/account-store.cjs`
- Create: `electron/streaming/account-store.test.cjs`
- Create: `electron/streaming/secret-sanitizer.cjs`
- Create: `electron/streaming/secret-sanitizer.test.cjs`

**Interfaces:**
- `createCollectionStore({ baseDir })` → list/get/save/delete collections.
- `createStreamingAccountStore({ baseDir })` → list/get/save/delete public account records plus internal secret refs.
- `sanitizeStreamingAccount(record)` → public record without password/cookies/token values.

- [ ] **Step 1: Write failing persistence and secret-redaction tests**

Cover atomic JSON persistence, reload, delete, malformed-file recovery, and:

```js
assert.equal(JSON.stringify(publicAccount).includes('super-secret'), false);
assert.equal(JSON.stringify(publicAccount).includes('sp_dc'), false);
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test electron/streaming/collection-store.test.cjs electron/streaming/account-store.test.cjs electron/streaming/secret-sanitizer.test.cjs
```

- [ ] **Step 3: Implement stores using the run-store atomic-write pattern**

Use temp-file + rename writes, schema versioning, compact public records, and internal secret references. Never expose raw secrets from list/get public methods.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same Node command; require 0 failures.

- [ ] **Step 5: Record implementation checkpoint**

Mark Task 2 complete in the plan.

---

### Task 3: Create Platform Adapter Contract and Catalog Resolution

**Files:**
- Create: `electron/streaming/platform-adapter.cjs`
- Create: `electron/streaming/platform-adapter.test.cjs`
- Create: `electron/streaming/adapters/spotify.cjs`
- Create: `electron/streaming/adapters/youtube-music.cjs`
- Create: `electron/streaming/adapters/soundcloud.cjs`
- Create: `electron/streaming/adapters/deezer.cjs`
- Create: `electron/streaming/adapters/tidal.cjs`
- Create: `electron/streaming/adapters/audiomack.cjs`
- Create: `electron/streaming/adapters/pandora.cjs`
- Create: `electron/streaming/catalog-service.cjs`
- Create: `electron/streaming/catalog-service.test.cjs`

**Interfaces:**

Each adapter exports:

```js
{
  id,
  label,
  supports,
  classifyInput(input),
  normalizeTrack(raw),
  async resolveCatalog({ input, page, signal }),
  async verifySession({ page, account, signal }),
  async locateTrack({ page, track, signal }),
  async playbackControls({ page, signal })
}
```

Unsupported actions return `{ status: 'NOT_APPLICABLE', reason }`.

- [ ] **Step 1: Write failing adapter-contract tests**

Verify all seven adapters expose the same method names, classify representative URLs, and normalize tracks to the shared shape without starting playback.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test electron/streaming/platform-adapter.test.cjs electron/streaming/catalog-service.test.cjs
```

- [ ] **Step 3: Implement adapter registry and conservative first adapters**

Implement URL/query classification and metadata normalization first. Keep selectors/operations that are not safely supported as `NOT_APPLICABLE`; do not guess selectors.

- [ ] **Step 4: Implement catalog service**

The service selects the adapter, invokes `resolveCatalog`, deduplicates tracks by canonical platform id/URL, and returns a normalized result for the renderer.

- [ ] **Step 5: Run tests and verify GREEN**

Run the Task 3 test command; require 0 failures.

- [ ] **Step 6: Record implementation checkpoint**

Mark Task 3 complete.

---

### Task 4: Add Streaming IPC and Preload APIs

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Create: `electron/streaming/streaming-ipc.test.cjs`
- Modify: `src/vite-env.d.ts`

**Interfaces:**

Expose:

```ts
listStreamingPlatforms()
resolveStreamingCatalog(request)
listStreamingCollections()
saveStreamingCollection(request)
deleteStreamingCollection(collectionId)
listStreamingAccounts()
saveStreamingAccount(request)
deleteStreamingAccount(accountId)
verifyStreamingAccount(accountId)
startStreamingRun(request)
```

- [ ] **Step 1: Write failing IPC contract tests**

Assert every preload method maps to the exact IPC channel and public account responses cannot contain raw secret fields.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test electron/streaming/streaming-ipc.test.cjs
```

- [ ] **Step 3: Wire main-process handlers**

Instantiate the stores/catalog service once during main-process startup and register the namespaced handlers. Return structured errors rather than throwing raw secret-bearing objects.

- [ ] **Step 4: Extend renderer type declarations**

Add the methods to `Window.orbitqa` with concrete shared types.

- [ ] **Step 5: Run tests and verify GREEN**

Run the Task 4 test command; require 0 failures.

- [ ] **Step 6: Record implementation checkpoint**

Mark Task 4 complete.

---

### Task 5: Build the Streaming Playback Planner

**Files:**
- Create: `electron/streaming/playback-planner.cjs`
- Create: `electron/streaming/playback-planner.test.cjs`
- Create: `electron/streaming/rest-policy.cjs`
- Create: `electron/streaming/rest-policy.test.cjs`

**Interfaces:**
- `createTrackDeck({ tracks, mode, seed })`
- `nextTrack(deckState)`
- `chooseObservationSeconds({ minSeconds, maxSeconds, rng })`
- `shouldRest({ tracksSinceRest, restAfterTracks })`

- [ ] **Step 1: Write failing deterministic planner tests**

Cover sequential order, seeded shuffle, loop wraparound, min/max duration clamping, and rest thresholds.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test electron/streaming/playback-planner.test.cjs electron/streaming/rest-policy.test.cjs
```

- [ ] **Step 3: Implement pure planner functions**

Keep the planner browser-independent so it can be fully unit tested.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same command; require 0 failures.

- [ ] **Step 5: Record implementation checkpoint**

Mark Task 5 complete.

---

### Task 6: Build Safe Streaming QA Session Worker

**Files:**
- Create: `electron/streaming/streaming-session-worker.cjs`
- Create: `electron/streaming/streaming-session-worker.test.cjs`
- Modify: `electron/session-integrity.cjs`
- Reuse: `electron/privacy-probe.cjs`, `electron/proxy-pool-service.cjs`, `electron/session-lifetime.cjs`

**Interfaces:**

`runStreamingSession({ runId, workUnit, account, trackPlan, adapter, browserFactory, screenshotPolicy, signal, log })`

Produces a compact result containing session verification, route/privacy outcome, per-check PASS/FAIL/NOT_APPLICABLE, screenshot references, and no secrets.

- [ ] **Step 1: Write failing worker tests**

Test order of operations:

```text
proxy allocation → BrowserContext → privacy checks → platform navigation → session verification → locate track → playback check → observation timer → optional safe checks → final integrity
```

Also assert follow/favorite/subscribe methods are never called because they do not exist on the adapter contract.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test electron/streaming/streaming-session-worker.test.cjs
```

- [ ] **Step 3: Implement the worker using injected browser/adapter dependencies**

Reuse existing privacy/session-integrity functions. Redact account values from logs. Respect AbortSignal at every wait boundary.

- [ ] **Step 4: Add screenshot-policy tests**

Verify OFF captures zero screenshots and ON captures only configured QA checkpoints without secret-bearing login fields.

- [ ] **Step 5: Run tests and verify GREEN**

Run Task 6 tests plus existing session integrity tests.

- [ ] **Step 6: Record implementation checkpoint**

Mark Task 6 complete.

---

### Task 7: Integrate Streaming Runs into Run Registry and Global Scheduler

**Files:**
- Modify: `electron/run-registry.cjs`
- Modify: `electron/run-registry.test.cjs`
- Modify: `electron/global-run-scheduler.cjs`
- Modify: `electron/global-run-scheduler.test.cjs`
- Create: `electron/streaming/streaming-runner.cjs`
- Create: `electron/streaming/streaming-runner.test.cjs`
- Modify: `electron/run-checkpoint-filter.test.cjs`
- Modify: `electron/run-recovery.test.cjs`

**Interfaces:**
- Run Registry dispatches `runKind === 'streaming'` to `streaming-runner`.
- Streaming runner uses existing global startup scheduler and emits normal `qa:event` run events with streaming payload summaries.

- [ ] **Step 1: Write failing multi-run scheduling tests**

Create one ordinary QA run and one streaming run and verify both receive fair startup opportunities and isolated cancellation controllers.

- [ ] **Step 2: Write failing streaming checkpoint/recovery tests**

Verify completed streaming work units remain terminal, in-flight work units restart cleanly, selected account/config survives recovery, and secrets do not enter checkpoint JSON.

- [ ] **Step 3: Run tests and verify RED**

```bash
node --test electron/streaming/streaming-runner.test.cjs electron/run-registry.test.cjs electron/global-run-scheduler.test.cjs electron/run-recovery.test.cjs electron/run-checkpoint-filter.test.cjs
```

- [ ] **Step 4: Implement registry dispatch and streaming runner**

Reuse existing run lifecycle/status transitions. Build one work unit per scheduled account/track assignment without duplicating scheduler infrastructure.

- [ ] **Step 5: Run tests and verify GREEN**

Run the Task 7 command; require 0 failures.

- [ ] **Step 6: Record implementation checkpoint**

Mark Task 7 complete.

---

### Task 8: Build Streaming Hub Renderer Page

**Files:**
- Create: `src/pages/StreamingHub.tsx`
- Create: `src/pages/StreamingHub.test.tsx`
- Create: `src/components/StreamingPlatformTabs.tsx`
- Create: `src/components/StreamingCatalogPanel.tsx`
- Create: `src/components/StreamingPlaybackPanel.tsx`
- Create: `src/components/StreamingAccountsPanel.tsx`
- Create: `src/components/StreamingChecksPanel.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Streaming Hub reads/writes only through `window.orbitqa` streaming APIs.
- Page produces a validated `StreamingRunConfig` and calls `startStreamingRun`.

- [ ] **Step 1: Write failing navigation/render tests**

Assert `Streaming Hub` appears in Sidebar, routes through `App`, renders the seven platform tabs, and does not break existing navigation.

- [ ] **Step 2: Write failing Catalog UI tests**

Test artist/album/playlist/track/search input, Fetch, selectable normalized results, Select All/Clear/Save Selected, and saved collection rendering.

- [ ] **Step 3: Write failing Playback/Checks UI tests**

Test min/max validation, sequential/shuffle/loop, slots, rest policy, visible/background mode, screenshot toggle, and safe QA check selection. Assert there are no Follow/Favorite/Subscribe controls.

- [ ] **Step 4: Write failing Accounts UI tests**

Test add/edit/delete account metadata, proxy source selection, masked secret input, verify-account action, and no secret echo after save.

- [ ] **Step 5: Implement the page/components with OrbitQA visual language**

Use compact cards, responsive two-column layout on wide screens, single-column on narrow screens, clear `START STREAMING QA` CTA, and existing status-pill conventions.

- [ ] **Step 6: Run renderer tests and verify GREEN**

```bash
npx vitest run src/pages/StreamingHub.test.tsx src/App.test.tsx
```

- [ ] **Step 7: Record implementation checkpoint**

Mark Task 8 complete.

---

### Task 9: Add Streaming Run Detail and Completed-History Presentation

**Files:**
- Modify: `src/pages/RunCenter.tsx`
- Modify: `src/pages/RunCenter.test.tsx`
- Modify: `src/components/RunCard.tsx`
- Modify: `src/components/RunCard.test.tsx`
- Modify: `src/shared/runCenter.ts`

**Interfaces:**
- `RunDetail` gains optional `streamingSummary` with only compact result fields.

- [ ] **Step 1: Write failing Run Center tests**

Assert streaming cards show platform/slots/accounts, ordinary QA cards remain unchanged, and streaming Run Detail shows queue mode, observation range, collection/track counts, session/check summaries, screenshots, and network status.

- [ ] **Step 2: Add rerun/delete/history tests**

Verify Run Again copies streaming config into a new run id, completed-history compaction preserves summary, and delete removes only the selected terminal run.

- [ ] **Step 3: Implement compact presentation**

Avoid rendering complete historical streaming logs by default; load detail only when opened.

- [ ] **Step 4: Run renderer/shared tests and verify GREEN**

```bash
npx vitest run src/pages/RunCenter.test.tsx src/components/RunCard.test.tsx src/shared/runCenter.test.ts
```

- [ ] **Step 5: Record implementation checkpoint**

Mark Task 9 complete.

---

### Task 10: Full Regression, Build, Browser Health, and Release Packaging

**Files:**
- Modify: `package.json`
- Create: `electron/streaming/streaming-build-contract.test.cjs`
- Create: `V0.14.0-STREAMING-HUB-QA.txt`
- Update: `README.md`

**Interfaces:**
- Release version becomes `0.14.0` only after all checks pass.

- [ ] **Step 1: Add Streaming Hub tests to the project test script**

Include all new Node tests while preserving every existing test command.

- [ ] **Step 2: Add source/build-contract checks**

Verify Streaming Hub is wired into Sidebar/App, preload APIs exist, no engagement-action strings are exposed as controls, and shared types compile.

- [ ] **Step 3: Run complete tests**

On the development environment:

```bash
npm test
```

Expected: 0 failures.

- [ ] **Step 4: Run TypeScript/Vite build**

```bash
npm run build
```

Expected: exit code 0 and a generated `dist/` bundle.

- [ ] **Step 5: Run browser-health test**

```bash
npm run test:browser-health
```

Expected: 0 failures with Playwright installed.

- [ ] **Step 6: Run targeted manual smoke test**

Create one visible and one background streaming QA run using authorized test accounts. Confirm Run Center coexistence with a normal QA run, independent Stop, screenshot ON/OFF behavior, and no engagement actions.

- [ ] **Step 7: Update version and release notes only after verification**

Set `package.json` version to `0.14.0`, document supported adapters and safety constraints, and record exact verification counts.

- [ ] **Step 8: Package and integrity-check ZIP**

Create `orbitqa-v0.14.0-streaming-hub-qa.zip` excluding `node_modules`, `dist`, temp files, and secrets. Run ZIP integrity verification before handoff.

---

## Plan Self-Review

- Spec coverage: every approved section maps to Tasks 1-10.
- Secret handling: covered by Tasks 2, 4, 6, and 7.
- Platform isolation: covered by Task 3 adapter contract.
- Existing scheduler/proxy/recovery reuse: covered by Tasks 6-7.
- UI and Run Center integration: covered by Tasks 8-9.
- Safety boundary against artificial engagement: enforced in adapter contract, renderer controls, worker tests, and build-contract checks.
- No placeholders or undefined cross-task interfaces remain.
- Type names are consistent across tasks: `StreamingRunConfig`, `StreamingPlatform`, `StreamingQueueMode`, `StreamingQaCheck`, and `runKind`.
