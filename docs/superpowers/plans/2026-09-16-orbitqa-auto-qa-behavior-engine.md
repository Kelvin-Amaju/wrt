# OrbitQA Auto QA Behavior Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship OrbitQA Desktop v0.11.0 with Auto QA as the default behavior mode, using conservative site classification, safety-aware planning, readable pacing, navigation/new-tab resilience, blocker observation, simulated referrer QA, and unchanged privacy/device/session-integrity gates.

**Architecture:** Add focused CommonJS modules under `electron/auto-qa/` and keep `qa-runner.cjs` as the orchestration boundary. The renderer sends an immutable `autoQa` settings object with every v2 run request; the runner invokes `runAutoQa()` only after privacy and device consistency have passed, while legacy/manual steps remain unchanged when `behaviorMode === 'manual'`.

**Tech Stack:** Electron 38, React 19, TypeScript 5.9, Playwright 1.63, Node `node:test`, Vitest/Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-16-orbitqa-auto-qa-behavior-engine-design.md`

## Global Constraints

- Base implementation is OrbitQA v0.10.3 plus verified v0.10.x WebRTC/device-consistency fixes already present in the snapshot.
- Auto QA is the default for new UI-created runs; legacy v2 requests containing steps but no behavior mode normalize to manual.
- Auto QA never clicks/taps/intentionally hovers ads, sponsored links, SmartLinks, affiliate placements, or promotional popunders.
- Auto QA never solves CAPTCHA/human verification or submits payment, banking, checkout, account-security, credential, OTP, MFA, or destructive actions.
- Referrer testing is simulation only; no Google/Facebook/Pinterest browsing is automated to manufacture organic traffic.
- Existing proxy, WebRTC, privacy, device-consistency, WorkUnit timer, STOP, navigation-resilience, and scalable queue guarantees remain authoritative.
- Side-effecting actions are never blindly replayed after navigation.
- Manual Behavior Script remains available under `Manual Script (Advanced)` and keeps its existing step schema.

---

### Task 1: Run-request Auto QA data model and normalization

**Files:**
- Modify: `src/shared/qaMatrix.ts`
- Modify: `src/shared/qaMatrix.test.ts`
- Modify: `electron/qa-runner.cjs`
- Modify: `electron/qa-runner.test.cjs`

**Interfaces:**
- Produces TS types `BehaviorMode`, `ReadingPace`, `ReferrerMode`, `AutoQaSettings` and `createDefaultAutoQaSettings()`.
- Produces runner helper `normalizeAutoQaSettings(input, rawSteps)` returning `{ behaviorMode, readingPace, safeFormActions, observeNewTabs, referrerMode, customReferrer }`.
- `QaRunRequestV2` gains `autoQa: AutoQaSettings` while retaining `steps: QaStep[]`.

- [ ] **Step 1: Write failing shared-model tests**

Add assertions that a UI-style request with no explicit settings normalizes to Auto QA defaults, an invalid custom referrer is rejected, and manual mode preserves steps.

```ts
expect(normalizeQaRunRequestV2(baseRequest).autoQa).toEqual({
  behaviorMode: 'auto', readingPace: 'natural', safeFormActions: true,
  observeNewTabs: true, referrerMode: 'direct', customReferrer: undefined,
});
expect(() => normalizeQaRunRequestV2({ ...baseRequest, autoQa: { ...defaults, referrerMode: 'custom-simulated', customReferrer: 'http://bad.test' } })).toThrow(/https/i);
```

- [ ] **Step 2: Run targeted Vitest and confirm RED**

Run: `npx vitest run src/shared/qaMatrix.test.ts`
Expected: FAIL because Auto QA types/default normalization do not exist.

- [ ] **Step 3: Implement shared TS types/defaults/validation**

Add exact unions from the spec, validate reading pace/referrer values, require HTTPS for custom simulated referrers, and include `autoQa` in `QaRunRequestV2`.

- [ ] **Step 4: Add runner normalization tests and confirm RED**

Add Node tests proving new v2 UI requests normalize to Auto QA, while a legacy v2 request with `steps` and no `autoQa` normalizes to manual.

Run: `node --test electron/qa-runner.test.cjs`
Expected: new assertions FAIL before runner normalization is implemented.

- [ ] **Step 5: Implement runner normalization**

Add `normalizeAutoQaSettings()` and return the normalized object from `normalizeMatrixRequest()`. Use `manual` only for omitted settings when legacy steps are present; otherwise default to `auto`.

- [ ] **Step 6: Re-run targeted model + runner tests**

Run: `npx vitest run src/shared/qaMatrix.test.ts && node --test electron/qa-runner.test.cjs`
Expected: PASS.

---

### Task 2: Central Auto QA safety policy and site analyzer

**Files:**
- Create: `electron/auto-qa/safety-policy.cjs`
- Create: `electron/auto-qa/safety-policy.test.cjs`
- Create: `electron/auto-qa/site-analyzer.cjs`
- Create: `electron/auto-qa/site-analyzer.test.cjs`
- Modify: `package.json`

**Interfaces:**
- `safety-policy.cjs` exports `classifyCandidateText(text)`, `isAdLike(candidate)`, `isVerificationChallenge(candidate)`, `isSensitiveOrConsequential(candidate)`, `isSafeEditableField(candidate)`, `isSafeAction(candidate)`.
- `site-analyzer.cjs` exports `analyzeSite(page)` returning the spec `SiteAnalysis` shape.

- [ ] **Step 1: Write safety-policy RED tests**

Use plain objects to prove ads/sponsored links, CAPTCHA, password/OTP/payment/account/destructive controls are rejected, while ordinary URL/search/text fields and Search/Generate/Convert/Check actions are allowed.

- [ ] **Step 2: Run safety test and confirm RED**

Run: `node --test electron/auto-qa/safety-policy.test.cjs`
Expected: FAIL because module is missing.

- [ ] **Step 3: Implement minimal safety policy**

Use explicit text/type/name/role pattern sets, with deny rules evaluated before allow rules. Export predicates for analyzer/planner/engine reuse.

- [ ] **Step 4: Write analyzer RED tests using fake page.evaluate fixtures**

Cover `article`, `blog-index`, `form-tool`, `downloader`, `generator`, `survey`, `generic`, and `unknown`, and assert ad-like candidates are flagged rather than returned as safe actions.

- [ ] **Step 5: Run analyzer test and confirm RED**

Run: `node --test electron/auto-qa/site-analyzer.test.cjs`
Expected: FAIL because analyzer is missing.

- [ ] **Step 6: Implement conservative DOM analyzer**

Collect visible landmarks, headings, same-origin links, editable fields, buttons/actions, blockers, ad-like elements and risk text in one `page.evaluate()`. Classify by semantic evidence and use `unknown` below confidence 0.45.

- [ ] **Step 7: Run both module tests**

Run: `node --test electron/auto-qa/safety-policy.test.cjs electron/auto-qa/site-analyzer.test.cjs`
Expected: PASS.

---

### Task 3: Behavior planner, reading pace, and referrer simulation

**Files:**
- Create: `electron/auto-qa/behavior-planner.cjs`
- Create: `electron/auto-qa/behavior-planner.test.cjs`
- Create: `electron/auto-qa/reading-driver.cjs`
- Create: `electron/auto-qa/reading-driver.test.cjs`
- Create: `electron/auto-qa/referrer-simulation.cjs`
- Create: `electron/auto-qa/referrer-simulation.test.cjs`
- Modify: `package.json`

**Interfaces:**
- `planBehavior({ analysis, remainingMs, settings, seed, deviceMode })` returns a short action array with action types `observe`, `read-scroll`, `open-link`, `fill-field`, `activate`, `return-home`, or `browse-only`.
- `createReadingProfile(readingPace, seed)` returns bounded deterministic pause and scroll ranges.
- `performReadingScroll(page, options)` performs small scroll segments with lifetime checks and visible indicator callbacks.
- `resolveSimulatedReferrer(settings)` returns `{ mode, value, label, applicable }`.

- [ ] **Step 1: Write planner RED tests**

Assert blog index plans include observe/read/open-link, article plans include multiple read-scrolls, form-tool plans browse before fill/activate, unknown is browse-only, and insufficient time prevents new navigation/form actions.

- [ ] **Step 2: Write reading/referrer RED tests**

Assert natural pauses remain within 1400-2800ms for seeded samples, slow is longer, fast QA is shorter, and simulated modes resolve fixed HTTPS referrers with explicit `Simulated` labels.

- [ ] **Step 3: Run all three tests and confirm RED**

Run: `node --test electron/auto-qa/behavior-planner.test.cjs electron/auto-qa/reading-driver.test.cjs electron/auto-qa/referrer-simulation.test.cjs`
Expected: FAIL because modules are missing.

- [ ] **Step 4: Implement planner and deterministic seeded RNG**

Keep plans small and re-plannable after navigation. Filter every selected field/action/link through the central safety policy.

- [ ] **Step 5: Implement reading driver**

Use existing `smoothScrollBy`, lifetime waits, and indicator movement primitives. No fixed percentage pattern and no anti-detection logic.

- [ ] **Step 6: Implement referrer simulation**

Map Google/Facebook/Pinterest simulated modes to fixed HTTPS values, validate custom HTTPS URLs, and expose an explicit label. No third-party navigation.

- [ ] **Step 7: Re-run tests**

Run: `node --test electron/auto-qa/behavior-planner.test.cjs electron/auto-qa/reading-driver.test.cjs electron/auto-qa/referrer-simulation.test.cjs`
Expected: PASS.

---

### Task 4: Navigation supervisor and blocker observer

**Files:**
- Create: `electron/auto-qa/navigation-supervisor.cjs`
- Create: `electron/auto-qa/navigation-supervisor.test.cjs`
- Create: `electron/auto-qa/blocker-observer.cjs`
- Create: `electron/auto-qa/blocker-observer.test.cjs`
- Modify: `package.json`

**Interfaces:**
- `createNavigationSupervisor({ context, primaryPage, lifetime, log, analyzePage, browseAuxiliaryPage, settings })` exposes `runIdempotent(label, fn)`, `runSideEffect(label, fn)`, `observeNewPages()`, `settle(page)`, `focusPrimary()`.
- `createBlockerObserver({ page, resolver, lifetime, indicator, indicatorMode, log })` exposes `inspectAndResolve()` returning `{ detected, dismissed, humanVerification, skippedReason }`.

- [ ] **Step 1: Write navigation RED tests**

Prove an idempotent observation retries once after `Execution context was destroyed`, a side-effecting click is not replayed, safe new tabs wait for DOM settle and return focus, ad-like tabs are recorded/closed without scrolling, and repeated churn terminates.

- [ ] **Step 2: Write blocker RED tests**

Prove safe close controls receive an observation delay before dismissal, visible indicator movement is requested, CAPTCHA/ad/payment surfaces are skipped, and ambiguity never triggers a risky click.

- [ ] **Step 3: Run tests and confirm RED**

Run: `node --test electron/auto-qa/navigation-supervisor.test.cjs electron/auto-qa/blocker-observer.test.cjs`
Expected: FAIL because modules are missing.

- [ ] **Step 4: Implement navigation supervisor**

Reuse the v0.10.3 navigation-race error semantics. Bound auxiliary-page observation and never replay side-effecting operations.

- [ ] **Step 5: Implement blocker observer wrapper**

Call existing resolver only after a bounded observation wait and indicator movement. Do not weaken resolver safety classification.

- [ ] **Step 6: Re-run tests**

Run: `node --test electron/auto-qa/navigation-supervisor.test.cjs electron/auto-qa/blocker-observer.test.cjs`
Expected: PASS.

---

### Task 5: Auto QA engine orchestration

**Files:**
- Create: `electron/auto-qa/auto-qa-engine.cjs`
- Create: `electron/auto-qa/auto-qa-engine.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Export `runAutoQa({ page, context, workUnit, settings, lifetime, log, interactionIndicator, indicatorMode, resolver, pacing, signal })`.
- Return `{ detectedKinds, attempted, completed, skipped, navigationCount, newTabObservations, blockerObservations, terminalReason }`.

- [ ] **Step 1: Write engine RED tests**

Cover blog/article flow, form/tool browse-before-interact flow, unknown browse-only flow, STOP/expiry between actions, protected candidates skipped, and navigation causes re-analysis rather than stale-plan continuation.

- [ ] **Step 2: Run engine test and confirm RED**

Run: `node --test electron/auto-qa/auto-qa-engine.test.cjs`
Expected: FAIL because engine is missing.

- [ ] **Step 3: Implement engine loop**

On each cycle: lifetime/abort check -> blocker observation -> analyze -> log site kind -> plan -> execute bounded actions -> re-analyze after meaningful navigation. Stop initiating consequential actions near expiry.

- [ ] **Step 4: Add safe form helpers inside engine**

Use harmless QA values by field semantics (`https://example.org/`, `qa@example.org`, `OrbitQA QA test`, `OrbitQA search`). Never touch file/password/payment/identity fields.

- [ ] **Step 5: Re-run engine tests**

Run: `node --test electron/auto-qa/auto-qa-engine.test.cjs`
Expected: PASS.

---

### Task 6: Runner integration and referrer application

**Files:**
- Modify: `electron/qa-runner.cjs`
- Modify: `electron/qa-runner.test.cjs`
- Modify: `electron/main.cjs` only if the existing bridge needs no-schema changes; otherwise leave unchanged.

**Interfaces:**
- Runner imports `runAutoQa` and `resolveSimulatedReferrer`.
- Browser/context creation applies the simulated referrer only where supported; logs `Referrer QA: Simulated ...` and reports unsupported engines without forging state.

- [ ] **Step 1: Add integration RED tests**

Prove Auto QA starts only after privacy/device diagnostics, strict privacy block prevents engine start, manual mode still calls `executeStep`, session integrity still runs after Auto QA, and two concurrent WorkUnits receive independent engine settings/logs.

- [ ] **Step 2: Run runner test and confirm RED**

Run: `node --test electron/qa-runner.test.cjs`
Expected: new Auto QA integration tests FAIL.

- [ ] **Step 3: Integrate Auto QA branch**

Replace the unconditional `for (normalized.steps)` behavior section with `if (settings.autoQa.behaviorMode === 'auto') runAutoQa(...) else execute manual steps` in matrix execution; preserve legacy runner behavior.

- [ ] **Step 4: Apply referrer simulation before target navigation**

Use Playwright context/page support without third-party browsing. Log simulated/non-applicable state clearly.

- [ ] **Step 5: Re-run runner tests**

Run: `node --test electron/qa-runner.test.cjs`
Expected: PASS.

---

### Task 7: Auto QA renderer controls and Manual Advanced fallback

**Files:**
- Modify: `src/pages/Run.tsx`
- Modify: `src/pages/TestRuns.test.tsx`
- Modify: `src/styles.css`
- Modify: `src/shared/qaMatrix.ts`

**Interfaces:**
- Renderer state uses `AutoQaSettings` from `qaMatrix.ts`.
- Start request sends `autoQa` plus existing steps.

- [ ] **Step 1: Write renderer RED tests**

Assert Auto QA card is default, Behavior Script editor is absent initially, selecting `Manual Script (Advanced)` reveals current editor, simulated referrer options display `SIMULATED`, custom non-HTTPS referrer blocks Start, and running disables behavior settings.

- [ ] **Step 2: Run renderer test and confirm RED**

Run: `npx vitest run src/pages/TestRuns.test.tsx`
Expected: FAIL because Auto QA UI is not present.

- [ ] **Step 3: Implement compact Behavior Mode card**

Add controls for mode, Reading Pace, Referrer QA, Safe form actions, Observe new tabs. Keep START/STOP and run console positions unchanged.

- [ ] **Step 4: Gate existing script editor behind manual mode**

Keep Visual/Advanced JSON sub-modes and exact step editing behavior when manual is selected.

- [ ] **Step 5: Send immutable normalized settings with run request**

Call `normalizeQaRunRequestV2({ ..., autoQa, steps, ... })`; disable all Auto QA settings while `running`.

- [ ] **Step 6: Add focused CSS without unrelated redesign**

Reuse existing form/toggle/segmented-control classes where possible; add only compact Auto QA card styles.

- [ ] **Step 7: Re-run renderer tests**

Run: `npx vitest run src/pages/TestRuns.test.tsx src/shared/qaMatrix.test.ts`
Expected: PASS.

---

### Task 8: Full suite, version/docs, packaging verification

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Create: `V0.11.0-AUTO-QA-BEHAVIOR-ENGINE.txt`
- Modify: `package.json` test script to include every new Auto QA Node test.

**Interfaces:**
- Package version becomes `0.11.0`.

- [ ] **Step 1: Add all Auto QA tests to `npm test`**

Append the new `electron/auto-qa/*.test.cjs` files to the Node test command so Windows verification cannot silently skip them.

- [ ] **Step 2: Update version and release notes**

Document Auto QA default, Manual Advanced fallback, site types, navigation/tab behavior, simulated referrer QA, and explicit safety boundaries.

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: all Vitest and Node tests PASS, zero failures.

- [ ] **Step 4: Run production build**

Run: `npm run build`
Expected: `tsc --noEmit` and Vite production build exit 0.

- [ ] **Step 5: Run browser-health suite**

Run: `npm run test:browser-health`
Expected: Chromium, Firefox, and WebKit health tests PASS where Playwright browser binaries are installed; if binaries are unavailable in the packaging container, record that limitation and require Windows verification before claiming browser-health success.

- [ ] **Step 6: Verify package contents and ZIP integrity**

Create `orbitqa-v0.11.0-auto-qa-behavior-engine.zip`, inspect its file list, and run `unzip -t` with no errors.

