# Streaming Accounts, Channel Import, and Mixed Devices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add robust YouTube Music channel imports, selectable Mixed Devices, a dedicated Test Accounts page, and adapter-specific authorized login/session verification for all supported streaming services.

**Architecture:** Keep the existing Streaming subsystem boundaries. Extend resolver/device/account interfaces rather than rewriting the runner. Move UI ownership into three pages: Streaming Hub (execution), Music Library (import/library), Test Accounts (credentials/session/proxy management).

**Tech Stack:** Electron 38, React 19, TypeScript 5.9, Playwright 1.63, Node `node:test`, Vitest/Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-18-streaming-accounts-channel-mixed-devices-design.md`

## Global Constraints
- Preserve all existing non-streaming behavior.
- No challenge/MFA/CAPTCHA bypassing.
- No secrets in logs or public account objects.
- Tests first for every behavior change.

---

### Task 1: YouTube Music channel resolution
**Files:** `electron/streaming/service-catalog-resolver.cjs`, `electron/streaming/adapters/youtube-music.cjs`, related tests.
**Produces:** channel URL normalization/feed parsing helpers and adapter channel fallback.
- [ ] Add failing tests for exact user channel URL, YouTube channel normalization, JSON video extraction, feed fallback.
- [ ] Run focused tests and confirm failure.
- [ ] Implement channel resolver/fallback.
- [ ] Re-run focused tests.

### Task 2: Selectable Mixed Devices
**Files:** `src/shared/streaming.ts`, `src/components/StreamingPlaybackPanel.tsx`, `electron/streaming/streaming-runner.cjs`, related tests.
**Produces:** explicit mixed family/profile configuration carried into work-unit rotation.
- [ ] Add failing runner/UI-source tests for family subsets.
- [ ] Implement state/types and runner rotation.
- [ ] Re-run focused tests.

### Task 3: Account model and multi-platform management
**Files:** `electron/streaming/account-store.cjs`, `src/shared/streaming.ts`, `src/components/StreamingAccountsPanel.tsx`, `src/pages/StreamingAccounts.tsx`, App/Sidebar/preload/types/tests.
**Produces:** multi-platform save/edit/delete/select/proxy/status page.
- [ ] Add failing store/navigation/UI contract tests.
- [ ] Extend status/public model and store patch semantics.
- [ ] Create dedicated accounts page and sidebar route.
- [ ] Re-run focused tests.

### Task 4: Per-platform authentication adapters
**Files:** platform adapters, new auth helper, verifier/tests.
**Produces:** conservative login/session verification with PASS/NEEDS_VERIFICATION/WARNING/FAILED outcomes.
- [ ] Add failing adapter contract tests for seven services.
- [ ] Implement shared form/challenge helpers.
- [ ] Implement platform-specific login targets/selectors.
- [ ] Update verifier status mapping/cookie persistence.
- [ ] Re-run authentication tests.

### Task 5: Clean Streaming Hub and data handoff
**Files:** `src/pages/StreamingHub.tsx`, `src/App.tsx`, `src/components/Sidebar.tsx`, related tests.
**Produces:** execution-only Hub, separate Music Library and Test Accounts pages, no top platform tabs.
- [ ] Add failing page source/UI tests.
- [ ] Remove platform tabs/accounts form from Hub and show account selection summary.
- [ ] Wire Test Accounts page shared account state through IPC/local refresh.
- [ ] Re-run UI/source tests.

### Task 6: Final verification and packaging
- [ ] Run all built-in Node streaming tests.
- [ ] Run entire Node regression suite.
- [ ] Run Vitest if dependencies are available.
- [ ] Run TypeScript build/syntax checks where dependencies permit.
- [ ] Verify archive integrity.
- [ ] Package as v0.16.5 with beginner Windows commands.
