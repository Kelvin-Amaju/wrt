# Smart Auto-QA Conclusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OrbitQA reliably classify sites, budget the session timer, dismiss repeated safe popups, perform one legitimate site-type action when available, observe/count ads without clicking them, supervise auxiliary tabs to full load, and preserve fresh proxy/privacy integrity.

**Architecture:** Keep the existing Auto-QA pipeline but add small focused policy modules: a deterministic session-budget calculator and passive ad observer. Extend site analysis/planning with `shortlink` and `temp-mail` strategies and preferred safe actions. Harden blocker activation and completion semantics without weakening the existing safety policy.

**Tech Stack:** Electron, Node.js CommonJS, Playwright, React, TypeScript, Vite, Node test runner, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-smart-autoqa-conclusion-design.md`

## Global Constraints
- Never click ads, sponsored CTAs, CAPTCHA/human-verification controls, payment/account actions, destructive controls, or other consequential actions.
- Never bypass CAPTCHA or human verification.
- Keep new tabs inside the same BrowserContext and proxy/privacy policy.
- Do not close an auxiliary tab until complete load is confirmed and minimum observation/scroll is complete.
- Keep STOP cancellation and lazy queue behavior intact.
- Preserve WebRTC, direct-IP, locale, timezone, and device-consistency integrity checks.
- Do not fake `navigator.webdriver`, platform, CPU, RAM, GPU, or hardware APIs.

---

### Task 1: Session Budget Policy

**Files:**
- Create: `electron/auto-qa/session-budget.cjs`
- Create: `electron/auto-qa/session-budget.test.cjs`
- Modify: `electron/auto-qa/auto-qa-engine.cjs`
- Modify: `electron/auto-qa/reading-driver.cjs`

**Interfaces:**
- Produces: `createSessionBudget(durationMs)` returning `{ finalIntegrityMs, primaryActionMs, adObservationMs, followUpMs, readingMs, pace }`.
- Consumed by Auto-QA engine and reading driver.

- [ ] Write failing tests proving short, medium, and long durations always reserve final integrity + primary action time and scale reading/ad dwell monotonically.
- [ ] Run `node --test electron/auto-qa/session-budget.test.cjs` and confirm RED.
- [ ] Implement `createSessionBudget` with bounded deterministic allocations.
- [ ] Pass the budget into full-page observation so reading cannot consume the action/final-integrity reserve.
- [ ] Run session-budget + reading-driver tests and confirm GREEN.

### Task 2: Site Classification and Mandatory Safe Strategy

**Files:**
- Modify: `electron/auto-qa/site-analyzer.cjs`
- Modify: `electron/auto-qa/site-analyzer.test.cjs`
- Modify: `electron/auto-qa/behavior-planner.cjs`
- Modify: `electron/auto-qa/behavior-planner.test.cjs`
- Modify: `electron/auto-qa/auto-qa-engine.cjs`

**Interfaces:**
- Site kinds add `shortlink` and `temp-mail`.
- Analysis adds safe action semantics: `actionIntent` on actions and `preferredSafeActions` in classification output.

- [ ] Write failing classifier tests for blog/news index, article, downloader, shortlink, temp-mail, generator/form, and generic pages.
- [ ] Write failing planner tests proving blog opens newest/recent article, shortlink/downloader fill+submit, temp-mail prefers Copy/Refresh/Get Mail, generic uses benign same-origin action, and no-safe-action produces explicit fallback.
- [ ] Run the two test files and confirm RED.
- [ ] Implement semantic action-intent extraction and the new classifications.
- [ ] Update planner to prefer site-type-appropriate actions and add `no-safe-action` action when none exists.
- [ ] Update Auto-QA engine logging/completion so one legitimate safe site action is attempted when available and fallback is explicit when not.
- [ ] Run analyzer/planner/engine tests and confirm GREEN.

### Task 3: Passive Advertisement Counting and Observation

**Files:**
- Create: `electron/auto-qa/ad-observer.cjs`
- Create: `electron/auto-qa/ad-observer.test.cjs`
- Modify: `electron/auto-qa/site-analyzer.cjs`
- Modify: `electron/interaction-indicator.cjs`
- Modify: `electron/interaction-indicator.test.cjs`
- Modify: `electron/auto-qa/auto-qa-engine.cjs`

**Interfaces:**
- Analysis ad entries include `{ selectorHint, text, href, rect, kind }` where available.
- Produces `observeAds({ page, ads, indicator, mode, lifetime, budgetMs, log })` returning `{ detected, observed }`.
- Adds `moveInteractionIndicatorToPoint(page, point, options)`; this moves only the OrbitQA visual indicator and dispatches no page mouse event.

- [ ] Write failing tests for ad-container/iframe detection and passive observation count.
- [ ] Verify RED.
- [ ] Implement ad-region extraction and visual-indicator-only near-ad observation.
- [ ] Log `Visible advertisements detected: N` and `Advertisement regions observed: M`; never call locator.click/hover on ads.
- [ ] Run ad-observer, analyzer, indicator, and engine tests and confirm GREEN.

### Task 4: Repeated Popup Safe-Dismiss Reliability

**Files:**
- Modify: `electron/blocking-surface-resolver.cjs`
- Modify: `electron/blocking-surface-resolver.test.cjs`
- Modify: `electron/auto-qa/blocker-observer.cjs`
- Modify: `electron/auto-qa/blocker-observer.test.cjs`

**Interfaces:**
- Explicit safe dismiss controls may use a fallback activation path only after exact safe-label verification.
- Dismissal success is verified by re-inspecting blocker state, not merely by the clicked control disappearing.

- [ ] Add failing tests for roleless `Close + Continue`, child-frame `Close`, Google-vignette-style `Close`, repeated second popup, and normal click interception requiring safe explicit force fallback.
- [ ] Verify RED.
- [ ] Implement `activateExplicitDismissControl` that tries normal click then force click only for verified safe dismiss controls.
- [ ] Re-inspect blocker state after activation and report dismissed only when blocking state clears or the exact blocker disappears.
- [ ] Keep continuous monitor alive for the full lifetime and ensure one failed attempt does not stop later inspections.
- [ ] Run resolver + blocker-observer tests and confirm GREEN.

### Task 5: Strict Auxiliary-Tab Completion

**Files:**
- Modify: `electron/auto-qa/navigation-supervisor.cjs`
- Modify: `electron/auto-qa/navigation-supervisor.test.cjs`

**Interfaces:**
- Track pending auxiliary pages until full-load criteria are met.
- `observeNewPages()` rechecks previously pending pages before considering closure.

- [ ] Add failing tests that a not-complete tab remains pending/open, later reaches complete, receives minimum observation/scroll, then closes.
- [ ] Verify RED.
- [ ] Implement persistent pending-page tracking and only add a page to `knownPages` after full load confirmation.
- [ ] Run navigation-supervisor tests and confirm GREEN.

### Task 6: Fresh Context and Integrity Completion Gate

**Files:**
- Modify: `electron/qa-runner.cjs`
- Modify: `electron/qa-runner.test.cjs`
- Modify: `electron/session-integrity.cjs`
- Modify: `electron/session-integrity.test.cjs`

**Interfaces:**
- New WorkUnits must create fresh BrowserContexts and clear permissions before target behavior.
- Completion requires route/WebRTC/direct-IP/locale/timezone/device integrity plus Auto-QA strategy outcome.

- [ ] Add failing tests that each WorkUnit gets a distinct fresh context, permissions are cleared, configured locale/timezone are passed to the context, and a work unit cannot be marked completed before final integrity.
- [ ] Verify RED.
- [ ] Implement only the minimum lifecycle changes required by those tests; preserve existing proxy retry and STOP behavior.
- [ ] Run runner + integrity tests and confirm GREEN.

### Task 7: Full Regression, Build Metadata, and Package

**Files:**
- Modify: `package.json` only if a new Node test file must be added to the `npm test` script.
- Create: `V0.12.0-SMART-AUTOQA-CONCLUSION.txt`

**Interfaces:** none.

- [ ] Add all newly created Node test files to the `npm test` script.
- [ ] Run targeted new tests.
- [ ] Run all Node/backend tests available in the environment.
- [ ] Run syntax checks on every `.cjs` file.
- [ ] Run `npm test`, `npm run build`, and `npm run test:browser-health` when dependencies are available; report environment blockers truthfully if not.
- [ ] Create release notes summarizing exact behavior and remaining environment limitations.
- [ ] Package a ZIP only after verification and verify ZIP integrity with `unzip -t`.
