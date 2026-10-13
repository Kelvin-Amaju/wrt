# Manual Music Link Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manual music-link saving plus a locked, explicit visual verification workflow for every saved collection and track.

**Architecture:** Extend the existing streaming collection schema with backward-compatible verification metadata, add a focused Electron verification-window manager, expose IPC/preload methods, and wire Music Library controls to two-step verification. Preserve existing importer and QA behavior.

**Tech Stack:** Electron BrowserWindow, Node.js CJS, React + TypeScript, Vitest/Testing Library, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-18-manual-music-link-verification-design.md`

## Global Constraints

- Preserve existing Streaming QA, accounts, proxy, and Run Center behavior.
- Existing collection files must remain readable without migration.
- Verification is never recorded merely because a window opened.
- Verification windows cannot close normally while pending.
- Manual save must still use existing duplicate detection.

---

### Task 1: Verification data model and persistence

**Files:**
- Modify: `src/shared/streaming.ts`
- Modify: `electron/streaming/collection-store.cjs`
- Test: `electron/streaming/collection-store.test.cjs`

**Interfaces:**
- Produces `StreamingLinkVerification` and optional `verification` on collection/track.
- Produces `collectionStore.markVerified(id,{trackId,url,deviceMode,deviceProfile,verifiedAt})`.

- [ ] Write failing tests for legacy unverified records, collection verification, and track verification.
- [ ] Run the focused store test and confirm failure for missing `markVerified`.
- [ ] Implement backward-compatible verification persistence.
- [ ] Re-run focused tests and confirm pass.

### Task 2: Locked verification-window manager

**Files:**
- Create: `electron/streaming/link-verification-manager.cjs`
- Create: `electron/streaming/link-verification-manager.test.cjs`

**Interfaces:**
- `createLinkVerificationManager({BrowserWindow,deviceProfileResolver})`
- `start({targetKey,url,deviceMode,deviceProfile}) -> {sessionId,targetKey,url,deviceMode,deviceProfile}`
- `complete(sessionId) -> verification metadata`
- `get(sessionId)` and `closeAll()`.

- [ ] Write failing tests proving exact URL/UA/viewport use and prevented close.
- [ ] Run focused test and confirm missing manager failure.
- [ ] Implement the manager with in-memory session map and close lock.
- [ ] Re-run focused tests and confirm pass.

### Task 3: IPC and preload verification APIs

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vite-env.d.ts`
- Test: `electron/streaming/streaming-ipc.test.cjs`

**Interfaces:**
- `startStreamingLinkVerification(request)`
- `completeStreamingLinkVerification(request)`
- Request carries collectionId, optional trackId, exact url, device family/profile.

- [ ] Add failing source/IPC assertions for both handlers and preload methods.
- [ ] Wire manager initialization during app startup.
- [ ] On complete, call collection store `markVerified`, then close the session.
- [ ] On app quit, close verification sessions.
- [ ] Re-run IPC tests.

### Task 4: Manual link-save behavior

**Files:**
- Modify: `src/pages/StreamingHub.tsx`
- Modify: `src/components/SimpleStreamingImporter.tsx`
- Create: `src/shared/manualStreamingLink.ts`
- Create: `src/shared/manualStreamingLink.test.ts`

**Interfaces:**
- `inferManualStreamingKind(input): StreamingInputKind`
- Manual save uses existing platform detection and duplicate IPC.

- [ ] Write tests for YouTube watch/channel/playlist and representative Spotify/SoundCloud/Deezer/TIDAL/Audiomack/Pandora route inference.
- [ ] Add manual label/kind controls and SAVE LINK MANUALLY button.
- [ ] Save track links as one-track collections and non-track links as zero-track collections.
- [ ] Ensure duplicate notice blocks manual save.

### Task 5: Verification UI for collections and tracks

**Files:**
- Modify: `src/components/SavedStreamingAlbumsPanel.tsx`
- Modify: `src/components/SimpleStreamingImporter.tsx`
- Modify: `src/pages/StreamingHub.tsx`
- Modify: `src/styles.css`
- Test: `src/pages/StreamingHub.test.tsx`
- Test: `electron/streaming/frontend-contract.test.cjs`

**Interfaces:**
- Saved panel receives `onVerifyCollection` and active verification state.
- Importer receives `onVerifyTrack` for opened saved tracks.

- [ ] Add source/UI tests for VERIFY -> MARK VERIFIED -> VERIFIED states.
- [ ] Add verification-device display/selector for mixed mode.
- [ ] Add collection verification action and badge.
- [ ] Add track verification action when a saved collection is open.
- [ ] Disable QA checkbox for zero-track manual entries.
- [ ] Refresh collection state after confirmation.

### Task 6: Final regression and packaging

**Files:**
- Modify: `package.json` to version `0.16.7`.
- Add: `V0.16.7-MANUAL-LINK-VISUAL-VERIFICATION.txt`

- [ ] Run focused verification/store/IPC Node tests.
- [ ] Run all runnable Node regression tests.
- [ ] Run `node --check` for changed CJS files.
- [ ] Parse/type-check changed TS/TSX files with available local tools.
- [ ] Create final ZIP excluding `node_modules`/build caches.
- [ ] Run archive integrity verification.
