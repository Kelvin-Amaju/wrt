# Test Runs Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Test Runs placeholder into a lightweight cross-browser QA runner that launches Chromium, Firefox, or WebKit through Playwright and streams real run events back to the Electron UI.

**Architecture:** The React renderer owns configuration and live presentation. A secure preload bridge exposes a small IPC API. The Electron main process validates requests and delegates browser work to a focused Playwright runner with a bounded worker pool. One QA run may be active at a time in V1, and concurrency is capped at five to protect the user's PC.

**Tech Stack:** Electron, React 19, TypeScript, Vite, Vitest, Playwright 1.63.

**Spec:** Approved in chat: Windows-only, local-first, modern dark UI, Chromium + Firefox + WebKit, scripted actions, balanced/lightweight concurrency.

## Global Constraints

- Windows-only V1.
- Local-first with no login or cloud requirement.
- Default concurrency is 3; maximum concurrency is 5.
- Browser engines launch only while a QA run is active.
- No anti-detection, CAPTCHA bypass, fingerprint spoofing, fake engagement, or ad interaction features.
- Renderer keeps Node integration disabled and communicates only through preload IPC.

---

### Task 1: Test-run domain validation

**Files:**
- Create: `src/shared/testRun.ts`
- Create: `src/shared/testRun.test.ts`

**Interfaces:**
- Produces: `QaBrowser`, `QaStep`, `QaRunRequest`, `validateQaRunRequest`, `createDefaultSteps`.

- [ ] Write failing tests for URL validation, session/concurrency limits, and defaults.
- [ ] Run the focused test and confirm failure because the module does not exist.
- [ ] Implement the smallest domain module that satisfies the tests.
- [ ] Run the focused test and confirm it passes.

### Task 2: Test Runs UI

**Files:**
- Create: `src/pages/Run.tsx`
- Create: `src/pages/TestRuns.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Modify: `src/vite-env.d.ts`

**Interfaces:**
- Consumes: `QaRunRequest`, `QaStep`, `createDefaultSteps`.
- Consumes preload API: `window.orbitqa.startQaRun(request)` and `window.orbitqa.onQaEvent(listener)`.

- [ ] Write failing UI tests for configuration controls, adding a step, and starting a run.
- [ ] Run the focused test and confirm it fails because TestRuns is absent.
- [ ] Implement the screen and renderer event handling.
- [ ] Run UI tests and confirm they pass.

### Task 3: Secure Electron Playwright runner

**Files:**
- Create: `electron/qa-runner.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `startQaRun(request, emit, paths)` in `qa-runner.cjs`.
- IPC: `qa:startRun` returns `{ runId }` or throws a validation/runtime error.
- Events: `qa:event` with run/session/step status data.

- [ ] Add a pure request normalization/worker-pool testable boundary where feasible.
- [ ] Implement bounded concurrency and Playwright engine selection.
- [ ] Implement wait, scroll, click, type, and screenshot actions.
- [ ] Stream run/session/log/result events through IPC.
- [ ] Save screenshots under Electron userData per run.

### Task 4: Verification and packaging

**Files:**
- Modify: `README.md`

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Check generated source for placeholders in Test Runs.
- [ ] Package the updated source into a ZIP for the user.
- [ ] Document exact replacement/install/run commands for Windows PowerShell.
