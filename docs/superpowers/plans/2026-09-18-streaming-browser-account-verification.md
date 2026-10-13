# Streaming Browser and Account Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Streaming QA, music verification, and Test Account verification use a consistent supported-browser policy, while adding user-selected proxy login testing and manual account verification.

**Architecture:** Introduce a shared browser-policy module that discovers installed Chrome/Edge and supplies launch settings to automated Streaming sessions. Replace the one-shot account verifier with a verification-session manager that owns an open browser until explicit complete/cancel. Keep iOS as Playwright WebKit compatibility on Windows and record this honestly in metadata/UI.

**Tech Stack:** Electron 38, Node.js, Playwright 1.63+, React 19, TypeScript, Node test runner, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-18-streaming-browser-account-verification-design.md`

## Global Constraints
- Preserve all existing Streaming Library, duplicate detection, manual link saving, music verification, Mixed Devices, account encryption, proxy pool, and QA safety behavior.
- Test Login proxy is explicitly chosen per test and may be Direct / No proxy, Rotating Pool, Static Pool, or Smart Mix.
- No CAPTCHA/MFA/security-check bypass.
- Account browser stays open until MARK VERIFIED succeeds or user cancels.
- Never expose stored passwords/session cookies to renderer or logs.
- Do not claim real Safari on Windows; label iOS as WebKit compatibility.

---

### Task 1: Shared supported-browser policy

**Files:**
- Create: `electron/streaming/supported-browser-policy.cjs`
- Create: `electron/streaming/supported-browser-policy.test.cjs`
- Modify: `electron/streaming/system-verification-browser.cjs`
- Modify: `electron/streaming/streaming-browser-factory.cjs`
- Modify: `electron/streaming/streaming-browser-factory.test.cjs`

**Interfaces:**
- Produces `findInstalledChromiumBrowser()`, `resolveAutomationBrowserPolicy()`, and stable support labels.
- Streaming browser factory consumes the policy to launch installed Chrome/Edge for desktop/android and WebKit for iOS.

- [ ] Write failing tests for Chrome preference, Edge fallback, desktop/android policy, and iOS WebKit policy.
- [ ] Run focused tests and confirm RED.
- [ ] Implement browser-policy module and route both verification and Streaming browser factories through it.
- [ ] Run focused tests and confirm GREEN.

### Task 2: Account verification session manager

**Files:**
- Create: `electron/streaming/account-verification-manager.cjs`
- Create: `electron/streaming/account-verification-manager.test.cjs`
- Modify: `electron/streaming/account-verifier.cjs`
- Modify: `electron/streaming/account-verifier.test.cjs`
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`

**Interfaces:**
- `start({accountId, proxySource, deviceMode, deviceProfile}) -> {sessionId, status, reason, browserLabel, proxySource}`
- `complete(sessionId) -> verified public account or readable reason while session remains open`
- `cancel(sessionId) -> {cancelled:true}`

- [ ] Write failing tests proving per-test proxy override, browser remains open after automated login, manual challenge remains pending, completion re-verifies and persists cookies, and cancel closes without verification.
- [ ] Run focused tests and confirm RED.
- [ ] Implement manager and IPC/preload endpoints.
- [ ] Run focused tests and confirm GREEN.

### Task 3: Test Accounts verification UI

**Files:**
- Modify: `src/components/StreamingAccountsPanel.tsx`
- Modify: `src/shared/streaming.ts`
- Modify: `src/global.css`
- Modify: `electron/streaming/streaming-accounts-page-contract.test.cjs`
- Modify: `electron/streaming/frontend-contract.test.cjs`

**Interfaces:**
- Account panel receives start/complete/cancel verification callbacks.
- Per-account Test Login proxy selector is independent of default QA proxy selector.

- [ ] Write failing source/contract tests for Test Login proxy chooser, pending confirmation card, MARK VERIFIED, CANCEL, and verification metadata.
- [ ] Run focused tests and confirm RED.
- [ ] Implement UI/state and redesigned verification card matching Mixed Devices visual treatment.
- [ ] Run focused tests and confirm GREEN.

### Task 4: Music verification UI redesign

**Files:**
- Modify: `src/components/SimpleStreamingImporter.tsx`
- Modify: `src/components/SavedStreamingAlbumsPanel.tsx`
- Modify: `src/global.css`
- Modify: `electron/streaming/simple-import-ui-contract.test.cjs`

**Interfaces:**
- Preserve existing music verification IPC/lifecycle; only improve presentation and consistent verification-state controls.

- [ ] Write failing contract test for card-style pending/verified verification controls.
- [ ] Run focused test and confirm RED.
- [ ] Implement shared verification card styles/components or equivalent focused markup.
- [ ] Run focused test and confirm GREEN.

### Task 5: Seven-platform login compatibility checks

**Files:**
- Modify: `electron/streaming/adapters/_auth.cjs` only if current live login surfaces require selector/URL updates.
- Modify: `electron/streaming/platform-auth.test.cjs`
- Modify: `electron/streaming/account-ui-auth-regression.test.cjs`

**Interfaces:**
- All seven adapters keep `authenticate()` and `verifySession()` contracts.

- [ ] Add/refresh fixtures/tests for Spotify, YouTube Music/Google, SoundCloud, Deezer, TIDAL, Audiomack, and Pandora login progression/challenge detection.
- [ ] Run tests and confirm any failures are understood before selector changes.
- [ ] Make minimal selector/config changes if needed.
- [ ] Run focused tests and confirm GREEN.

### Task 6: Release verification and packaging

**Files:**
- Modify: `package.json` version to `0.16.8`.
- Modify: `README.md`.
- Create: `V0.16.8_SUPPORTED_BROWSER_ACCOUNT_VERIFICATION.md`.

**Interfaces:** None.

- [ ] Run all changed-file syntax checks.
- [ ] Run the full runnable Node regression suite with zero failures.
- [ ] Run focused Streaming/browser/account suites.
- [ ] Run TypeScript/Vitest/build if dependencies are available; otherwise provide exact Windows verification commands and do not claim those checks ran locally.
- [ ] Package full ZIP and small patch ZIP.
- [ ] Run archive integrity checks on both ZIPs.
