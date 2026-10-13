# Smart Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cookie-only account restoration with encrypted full browser-session restoration plus one clean password-login fallback.

**Architecture:** Keep the existing account store and browser factory boundaries. Teach the browser factory to understand a versioned Playwright storage-state envelope, then make the account verification manager orchestrate restore/retry/clean-login. Capture a fresh full storage state only after MARK VERIFIED succeeds.

**Tech Stack:** Electron, Node.js CommonJS, Playwright 1.63, React/TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-18-smart-login-design.md`

## Global Constraints
- Preserve legacy cookie JSON and raw cookie string support.
- Passwords and session state remain encrypted at rest and absent from renderer/log payloads.
- No CAPTCHA/MFA/passkey/OTP bypass.
- Preserve selected proxy and Desktop/Android/iOS device settings across fallback.
- One credential-login attempt per verification start.

---

### Task 1: Versioned session-state parser and browser restore

**Files:**
- Modify: `electron/streaming/streaming-browser-factory.cjs`
- Test: `electron/streaming/streaming-browser-factory.test.cjs`

**Interfaces:**
- Produces: `parseAuthorizedSessionState(value, platform)` -> `{storageState, kind}`.
- `createStreamingBrowserFactory().open(...)` accepts `ignoreStoredSession`.

- [ ] Write failing tests proving a v2 envelope restores cookies + origins through `browser.newContext({storageState})`, legacy cookie formats still restore, and `ignoreStoredSession:true` skips restoration.
- [ ] Run the browser-factory tests and confirm they fail for missing v2 behavior.
- [ ] Implement the minimal parser and `storageState` context option.
- [ ] Run browser-factory tests and confirm green.

### Task 2: Smart restore/fallback orchestration

**Files:**
- Modify: `electron/streaming/account-verification-manager.cjs`
- Modify: `electron/streaming/adapters/_auth.cjs`
- Test: `electron/streaming/account-verification-manager.test.cjs`
- Test: `electron/streaming/platform-auth.test.cjs`

**Interfaces:**
- Produces: account verification `start()` that first tries restored session, retries one transient page once, then opens a clean browser for credentials when needed.
- Produces: `_test.transientPageReason(page, config)` for deterministic tests.

- [ ] Write failing manager tests for stored session PASS, stale session -> second clean browser, transient "Something went wrong" -> retry then clean browser, and proxy/device preservation.
- [ ] Write failing auth test that transient error pages are never PASS.
- [ ] Run those tests and confirm red.
- [ ] Implement one-retry transient detection and clean credential fallback.
- [ ] Run focused tests and confirm green.

### Task 3: Full encrypted session snapshot on MARK VERIFIED

**Files:**
- Modify: `electron/streaming/account-verification-manager.cjs`
- Test: `electron/streaming/account-verification-manager.test.cjs`
- Test: `electron/streaming/account-store.test.cjs`

**Interfaces:**
- Produces: v2 encrypted session envelope saved through existing `sessionSecret` input to the account store.

- [ ] Write failing tests that MARK VERIFIED calls `context.storageState({indexedDB:true})`, falls back to `storageState()` if the option errors, and stores a v2 envelope without exposing it publicly.
- [ ] Run tests and confirm red.
- [ ] Implement capture + envelope serialization.
- [ ] Run tests and confirm green.

### Task 4: Regression and release

**Files:**
- Modify: `package.json`
- Create: `V0.17.1_SMART_LOGIN_SESSION_SNAPSHOT.md`
- Test: existing Streaming and project suites.

**Interfaces:**
- Produces: OrbitQA v0.17.1 patch and full backup archives.

- [ ] Bump version to `0.17.1` and add release note.
- [ ] Run all Streaming Node tests.
- [ ] Run complete runnable Node suite.
- [ ] Run syntax/source contract checks.
- [ ] Package patch and full ZIP.
- [ ] Apply patch to a clean v0.17.0 copy and rerun the complete runnable Node suite.
