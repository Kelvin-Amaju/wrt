# Account Auto Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically establish and visually verify an authorized streaming login as soon as an account is saved.

**Architecture:** Reuse the existing encrypted account store, supported streaming browser factory, platform adapters, and persistent account verification manager. Strengthen adapter credential routing and add save-triggered verification in the account UI without changing proxy-only edits.

**Tech Stack:** Electron, Node.js, React, TypeScript, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-account-auto-login-design.md`

## Global Constraints
- Never bypass CAPTCHA, MFA, passkey, email/SMS verification, or other platform security challenges.
- Never expose stored passwords or session secrets through renderer/public account objects or logs.
- Try valid imported/refreshed cookies before credential entry.
- Prefer password-based login routes over magic-link/one-time-code routes.
- Keep login browser open until explicit MARK VERIFIED or Cancel.

---

### Task 1: Credential/session invalidation and persistence
- [ ] Add failing store tests proving changed password/session resets stale verification while metadata-only edits preserve it.
- [ ] Implement minimal store status invalidation.
- [ ] Run account-store tests.

### Task 2: Password-first platform authentication
- [ ] Add failing adapter tests for cookie-first restore and password-route selection across generic adapters plus Spotify.
- [ ] Implement password-route helper without selecting one-time-code/magic-link routes.
- [ ] Run platform authentication tests.

### Task 3: Auto login immediately after account save
- [ ] Add failing UI/contract test that new/edit credential save invokes verification and proxy-only edits do not.
- [ ] Implement save-triggered verification using saved account ID, form proxy, Desktop profile.
- [ ] Keep each returned verification session mapped to its saved account.
- [ ] Run account page/StreamingHub tests/contracts.

### Task 4: Verification manager lifecycle hardening
- [ ] Add failing tests for replacing an older pending session for the same account and persisting cookie refresh only after manual confirmation.
- [ ] Implement one-live-session-per-account behavior and pending status/reason persistence.
- [ ] Run manager/IPC tests.

### Task 5: Regression/release verification
- [ ] Fix existing exact VERIFIED badge test if needed.
- [ ] Run all streaming Node tests.
- [ ] Run full runnable Node suite.
- [ ] Run syntax/TS transpile checks for changed files.
- [ ] Package patch/full archive and verify ZIP integrity.
