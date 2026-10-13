# Persistent Account Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace finite account-track browser sessions with one persistent authorized browser per selected account that continuously rotates only through selected QA tracks until manual browser close or STOP STREAMING.

**Architecture:** Keep legacy `runStreamingSession` for compatibility, add a persistent account-session worker for the new runner, and change `executeStreamingRun` to schedule one long-lived account plan per selected account. Initial track allocation is balanced, each account maintains its own looping track deck, and an allowed-song guard corrects platform Next when it leaves the selected QA pool.

**Tech Stack:** Electron, Node.js CommonJS, Playwright, React, TypeScript, node:test, Vitest source contracts.

**Spec:** `docs/superpowers/specs/2026-09-18-persistent-account-streaming-design.md`

## Global Constraints

- One browser per selected account.
- Browser closes only on manual browser close, STOP STREAMING, or unrecoverable startup failure.
- Min/max observation seconds control track transition only.
- Every selected account is active; persistent mode does not queue selected accounts behind Slots.
- Playback may use only the selected QA track pool.
- Durable authorized session state must remain full v2 storage-state, never downgraded to cookie-only state.
- No anti-detection or artificial engagement behavior.

---

### Task 1: Persistent track allocation and allowed-track helpers

**Files:**
- Modify: `electron/streaming/playback-planner.cjs`
- Modify: `electron/streaming/playback-planner.test.cjs`

**Interfaces:**
- Produces: `assignInitialTracks({accountIds,tracks,seed})`
- Produces: `createPersistentTrackDeck({tracks,initialTrack,seed})`
- Produces: `trackForCurrentUrl(tracks,url)`

- [ ] Add failing tests for 5 accounts/5 tracks, 10 accounts/5 tracks, and URL matching.
- [ ] Run `node --test electron/streaming/playback-planner.test.cjs` and confirm the new tests fail.
- [ ] Implement the minimal deterministic balanced assignment and URL matching helpers.
- [ ] Re-run the planner tests and confirm they pass.

### Task 2: Persistent per-account worker

**Files:**
- Modify: `electron/streaming/streaming-session-worker.cjs`
- Modify: `electron/streaming/streaming-session-worker.test.cjs`

**Interfaces:**
- Produces: `runPersistentAccountStreamingSession({...})`
- Consumes: one account, selected tracks, observation range, adapter, browser factory, durable-session persistence callback.

- [ ] Add failing tests proving one browser open per account, multiple track transitions, observation does not close the browser, manual page close exits only that worker, selected Next is accepted, and unselected Next is corrected.
- [ ] Run the worker test and confirm the new tests fail.
- [ ] Implement one-open-session lifecycle, per-track playback/observation loop, allowed-track guard, durable-session refresh, manual-close detection, and stop cleanup.
- [ ] Re-run the worker tests and confirm they pass.

### Task 3: Runner schedules accounts instead of account-track work

**Files:**
- Modify: `electron/streaming/streaming-runner.cjs`
- Modify: `electron/streaming/streaming-runner.test.cjs`

**Interfaces:**
- Produces: `makePersistentAccountPlans(request,tracks)`
- `executeStreamingRun` launches all selected account plans concurrently and waits until stop/manual close.

- [ ] Add failing runner tests for one work unit per account, balanced initial assignments, all selected accounts active, manual-close completion, and STOP cancellation.
- [ ] Run runner tests and confirm failures.
- [ ] Switch execution to persistent account plans while preserving session/log/summary events and durable session persistence.
- [ ] Re-run runner tests and confirm they pass.

### Task 4: Dense account library UI and persistent playback wording

**Files:**
- Modify: `src/components/StreamingAccountsPanel.tsx`
- Modify: `src/components/StreamingPlaybackPanel.tsx`
- Modify: `src/pages/StreamingHub.tsx`
- Modify: `src/styles.css`
- Modify: `electron/streaming/streaming-accounts-page-contract.test.cjs`
- Modify: `electron/streaming/streaming-renderer-source.test.cjs`

**Interfaces:**
- Account library adds search and selected count.
- Playback panel no longer exposes Slots.
- Streaming request sets `slots`, `requestedWorkUnits`, and manual concurrency to selected account count.

- [ ] Add source-contract tests for compact/searchable account UI, no Slots field, and requested work units equal selected account count.
- [ ] Run those source-contract tests and confirm failures.
- [ ] Implement the React/CSS changes and request metadata changes.
- [ ] Re-run source-contract tests and confirm they pass.

### Task 5: Release, regression, and patch rehearsal

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Create: `V0.17.3_PERSISTENT_ACCOUNT_STREAMING.md`
- Modify: package test script if new test files are introduced.

**Interfaces:**
- Package version becomes `0.17.3`.

- [ ] Update release documentation and build contracts.
- [ ] Run the focused Streaming suite.
- [ ] Run the complete runnable Node suite.
- [ ] Run Node syntax checks on changed CommonJS files.
- [ ] Run TypeScript transpile/source checks available in the sandbox.
- [ ] Build patch and full ZIPs.
- [ ] Apply the patch ZIP onto a clean v0.17.2 copy and rerun the complete runnable Node suite.
- [ ] Run `unzip -t` on both archives.
