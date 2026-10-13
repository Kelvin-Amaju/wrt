# Mobile Device Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real Android AVD lifecycle support and clearly labeled iPhone/iPad WebKit emulation to OrbitQA while preserving the existing desktop QA runner.

**Architecture:** Keep mobile lifecycle control in the Electron main process behind narrow IPC APIs. Extend the shared run request with a device mode, route desktop/iOS runs through Playwright browser contexts, and route Android runs through Playwright's Android bridge against an ADB-connected emulator. React receives only validated status/data and never direct shell access.

**Tech Stack:** Electron 38, React 19, TypeScript 5.9, Playwright 1.63, Node.js child_process, Vitest, node:test.

**Spec:** `docs/superpowers/specs/2026-09-14-mobile-device-testing-design.md`

## Global Constraints

- Windows-only V1.
- Local-first; no login or cloud dependency.
- Android tooling must not start at normal app launch beyond lightweight path detection.
- One Android AVD at a time in this milestone.
- Existing desktop Chromium/Firefox/WebKit behavior must remain supported.
- iPhone/iPad mode must be labeled Emulation and must not be presented as Apple's real iOS Simulator.
- Renderer receives no Node.js or arbitrary shell access.
- Existing desktop concurrency cap remains five; Android runs are forced to one session and one concurrency.

---

### Task 1: Extend the shared mobile run model

**Files:**
- Modify: `src/shared/testRun.ts`
- Modify: `src/shared/testRun.test.ts`
- Create: `src/shared/mobileDevices.ts`
- Create: `src/shared/mobileDevices.test.ts`

**Interfaces:**
- Produces: `QaDeviceMode`, `IosDeviceProfile`, `IOS_DEVICE_PROFILES`, `QaRunRequest.deviceMode`, `QaRunRequest.deviceName`.
- Produces validation that desktop, Android, and iOS-emulation requests obey mode-specific constraints.

- [x] Write failing tests for desktop defaults, Android one-session limits, missing Android AVD name, iOS descriptor validation, and WebKit requirement.
- [x] Run the focused tests and confirm they fail because mobile model support is missing.
- [x] Implement the minimal shared types/catalog/validation.
- [x] Run the focused tests and confirm they pass.

### Task 2: Add Android SDK and AVD service

**Files:**
- Create: `electron/android-service.cjs`
- Create: `electron/android-service.test.cjs`

**Interfaces:**
- Produces: `discoverAndroidSdk(env, fsExists)`, `parseAvdList(text)`, `parseAdbDevices(text)`, `isSafeAvdName(name)`, `createAndroidService(options)`.
- `createAndroidService()` exposes `getStatus()`, `listAvds()`, `launchAvd(name)`, `stopAvd(serial?)`.

- [x] Write failing node:test cases for SDK discovery, AVD parsing, ADB parsing, unsafe AVD rejection, and command argument construction.
- [x] Run the focused node test and confirm failures.
- [x] Implement the service using `execFile`/`spawn` with argument arrays only.
- [x] Run the focused node test and confirm all cases pass.

### Task 3: Expose narrow mobile IPC

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vite-env.d.ts`

**Interfaces:**
- Renderer APIs: `getMobileStatus()`, `listAvds()`, `launchAvd(name)`, `stopAvd(serial?)`.
- IPC channels: `mobile:getStatus`, `mobile:listAvds`, `mobile:launchAvd`, `mobile:stopAvd`.

- [x] Add IPC wiring around one `createAndroidService()` instance.
- [x] Keep the renderer bridge limited to explicit methods and data.
- [x] Type the new bridge methods in `vite-env.d.ts`.
- [x] Syntax-check Electron files.

### Task 4: Extend the QA runner for iOS emulation and Android

**Files:**
- Modify: `electron/qa-runner.cjs`
- Modify: `electron/qa-runner.test.cjs`

**Interfaces:**
- `normalizeQaRunRequest()` returns normalized `deviceMode` and `deviceName`.
- Desktop: existing launcher path unchanged.
- iOS emulation: WebKit context created with curated Playwright device descriptor.
- Android: Playwright `_android.devices()` finds the active emulator, opens Chrome, executes shared page steps, and reports explicit prerequisite failures.

- [x] Add failing runner tests for mode normalization and iOS context-option selection.
- [x] Run node runner tests and confirm failure.
- [x] Implement desktop/iOS runner path and Android runner path with one device/session.
- [x] Re-run node runner tests and confirm pass.

### Task 5: Build Device Profiles mobile UI

**Files:**
- Create: `src/pages/DeviceProfiles.tsx`
- Create: `src/pages/DeviceProfiles.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Tabs: Desktop, Android Virtual Device, iPhone/iPad Emulation.
- Android tab calls the mobile bridge only on refresh/launch/stop.
- iOS tab displays curated profiles and their viewport/DPR/touch metadata.

- [x] Write failing React tests for the three tabs and Android refresh state.
- [x] Run the focused Vitest test and confirm failure.
- [x] Implement the page and route it from `App.tsx`.
- [x] Add lightweight styling that matches OrbitQA.
- [x] Run focused React tests and confirm pass.

### Task 6: Add target-device controls to Test Runs

**Files:**
- Modify: `src/pages/Run.tsx`
- Modify: `src/pages/TestRuns.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Target Device selector: Desktop Browser / Android Virtual Device / iPhone/iPad Emulation.
- Android mode shows AVD selector and forces sessions/concurrency to 1.
- iOS mode shows profile selector and uses WebKit.
- `startQaRun()` receives the extended request.

- [x] Write failing React tests for device mode controls and request payloads.
- [x] Run focused tests and confirm failure.
- [x] Implement controls and mode-specific behavior.
- [x] Run focused tests and confirm pass.

### Task 7: Verification and beginner setup guidance

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Create: `MOBILE-SETUP.txt`

**Interfaces:**
- `npm test` includes the Android service node tests.
- Setup guide provides Android Studio / SDK / AVD steps without pretending iOS Simulator is available on Windows.

- [x] Update test scripts and setup documentation.
- [ ] Run node unit tests and TypeScript/Vitest tests.
- [ ] Run the full build command.
- [x] Package only changed source/docs into a beginner-friendly update ZIP.
