# Real Device Fidelity & Android Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add truthful runtime-fidelity diagnostics and improve Android AVD startup/recovery reliability on Windows.

**Architecture:** Extend the existing device-consistency module with fidelity metadata and per-check classification, then surface it in Test Runs. Strengthen the existing Android service rather than introducing a new launcher. Preserve all current execution modes and safety behavior.

**Tech Stack:** Electron, Node.js, React, TypeScript, Playwright, Node test runner, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-real-device-fidelity-design.md`

## Global Constraints
- Never hide or overwrite navigator.webdriver.
- Never spoof navigator.platform or unrelated hardware APIs.
- No automatic AVD data wipe.
- Existing STOP, privacy, proxy, scheduler, and Smart Interaction behavior must remain intact.

---

### Task 1: Runtime fidelity model

**Files:**
- Modify: `electron/device-consistency.cjs`
- Modify: `electron/device-consistency.test.cjs`

**Interfaces:**
- Produces: `buildRuntimeFidelity(expected)` and `identityReport.fidelity`.
- Produces: `check.classification` on every identity check.

- [ ] Write failing tests for Android emulation, Android AVD, desktop, and iOS compatibility fidelity classes.
- [ ] Run the focused test and confirm RED.
- [ ] Implement fidelity classification and expected-limitation classification.
- [ ] Run focused tests and confirm GREEN.

### Task 2: Android ADB recovery and readiness

**Files:**
- Modify: `electron/android-service.cjs`
- Modify: `electron/android-service.test.cjs`

**Interfaces:**
- Produces: `ensureAdbReady()` internally.
- `launchAvd(name)` reuses a recovered device or launches with safe cold-boot args.
- `waitForReady(timeoutMs, avdName)` validates boot completion and Chrome/package-manager readiness.

- [ ] Write failing tests for offline-device recovery and cold-boot launch args.
- [ ] Run focused tests and confirm RED.
- [ ] Implement ADB server recovery and readiness checks.
- [ ] Run focused tests and confirm GREEN.

### Task 3: Fidelity UI

**Files:**
- Modify: `src/shared/deviceIdentity.ts`
- Modify: `src/pages/Run.tsx`
- Modify: `src/pages/TestRuns.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `identityDiagnostics.fidelity` and `check.classification`.
- Renders: fidelity badge plus expected-limitation styling.

- [ ] Write failing renderer tests for fidelity badge and expected-limitation copy.
- [ ] Run focused test and confirm RED.
- [ ] Implement the UI and styles.
- [ ] Run focused tests and confirm GREEN.

### Task 4: Device Profiles copy and release notes

**Files:**
- Modify: `src/pages/DeviceProfiles.tsx`
- Modify: `src/pages/DeviceProfiles.test.tsx`
- Create: `V0.9.1-REAL-DEVICE-FIDELITY.txt`

- [ ] Write/update tests that distinguish compatibility emulation from native Android AVD and real iOS provider.
- [ ] Run focused tests and confirm RED if needed.
- [ ] Update copy and release notes.
- [ ] Run focused tests and confirm GREEN.

### Task 5: Full verification and package

**Files:**
- No production code unless verification finds a regression.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `npm run test:browser-health` when browser binaries are available.
- [ ] Create `orbitqa-v0.9.1-real-device-fidelity.zip` excluding `node_modules`, `dist`, and transient run output.
- [ ] Verify ZIP integrity.
