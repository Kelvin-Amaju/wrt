# OrbitQA Smart Auto-QA, Ad Intelligence, Free Proxy Validation, and Live Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OrbitQA classify the final page after redirects, always choose an appropriate safe QA action when one exists, observe/count visible advertisements without clicking them, surface ad results in LIVE MATRIX, add an optional thoroughly validated fetched-free-proxy source, and hide Locale/Timezone from LIVE MATRIX while preserving their internal integrity checks.

**Architecture:** Extend the existing Auto QA pipeline rather than replacing it: final-document classification feeds the behavior planner; ad discovery becomes a frame-aware, deduplicated observation subsystem; session budgeting allocates time among reading, safe action, ad observation, follow-up, and final integrity. Add a separate fetched-free-proxy candidate service in front of the existing proxy pool so public candidates never enter a WorkUnit until they pass OrbitQA's own route/privacy checks. Extend the run-result data contract for ad summary reporting and keep Locale/Timezone checks internal while removing them from the visible Live Matrix.

**Tech Stack:** Electron, Node.js CommonJS, Playwright, React 19, TypeScript, Vite, Vitest, Node test runner.

**Spec:** Approved chat design from 2026-09-17; implementation base is OrbitQA v0.12.0 redirect-navigation+iOS compatibility fix.

## Global Constraints

- Preserve every existing v0.12 feature and regression fix.
- Never click advertisements, sponsored CTAs, CAPTCHA/human-verification challenges, payment/account controls, destructive actions, OTP/password controls, or banking controls.
- Safe popup dismissal may use only verified Close/X/Cancel/Dismiss/No thanks controls associated with a blocking surface.
- Auxiliary/new tabs must not be closed before full usable load is confirmed; if full load is unconfirmed, leave them open and re-check later.
- STOP must cancel active and queued work and clear backend/UI active-run state before Start becomes available again.
- Manual concurrency remains honored; lazy WorkUnit generation remains mandatory.
- No direct-IP fallback for proxy-required WorkUnits.
- WebRTC, proxy route, direct-IP fallback, locale, timezone, and device consistency remain internally verified.
- Local iOS compatibility warnings remain non-blocking unless a real privacy/network rule fails.
- Fetched free proxies are optional and are never trusted solely because a provider labels them live.
- Public proxy candidates must be normalized, deduplicated, validated, and quarantined on failure before use.
- Locale and Timezone are hidden only from visible LIVE MATRIX/Latest Result; internal checks and logs remain.
- Use TDD for every behavior change.

---

### Task 1: Final-document site classification after redirects

**Files:**
- Modify: `electron/auto-qa/site-analyzer.cjs`
- Modify: `electron/auto-qa/auto-qa-engine.cjs`
- Test: `electron/auto-qa/site-analyzer.test.cjs`
- Test: `electron/auto-qa/auto-qa-engine.test.cjs`

**Interfaces:**
- Consumes: the current Playwright page after navigation stabilization.
- Produces: a normalized site classification including `blog-index`, `article`, `downloader`, `shortlink`, `temp-mail`, `form-tool`, `search-listing`, `landing-redirect`, `generic-content`, or `unknown`, plus evidence used by the planner.

- [ ] **Step 1: Write failing redirect/final-document classification tests**

Add tests that simulate a URL initially landing on one document and then replacing it with a second document containing recognizable structure. Assert that classification uses the final document, not the original URL/domain.

```js
test('classifies the final redirected document rather than the submitted URL', async () => {
  const page = makePageSequence([
    { url: 'https://redirect.example/x', html: '<html><body>redirecting</body></html>' },
    { url: 'https://news.example/', html: '<main><article><a href="/latest">Latest story</a></article><article><a href="/older">Older story</a></article></main>' },
  ]);
  const result = await analyzeSite(page);
  assert.equal(result.category, 'blog-index');
  assert.equal(result.finalUrl, 'https://news.example/');
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test electron/auto-qa/site-analyzer.test.cjs electron/auto-qa/auto-qa-engine.test.cjs
```

Expected: the new final-document classification test fails because current logic classifies too early or falls back to `unknown`.

- [ ] **Step 3: Implement navigation-stable final-document analysis**

Update the engine so classification occurs only after the page's current document is stable enough to inspect, using the existing navigation-resilience helpers. Re-read URL and DOM evidence after a detected replacement navigation.

- [ ] **Step 4: Add explicit landing/redirect heuristics**

Recognize pages dominated by redirect/continue wrappers, link gateways, and generic landing content as `landing-redirect` rather than `unknown` when evidence is sufficient. Keep `unknown` only for genuinely unclassifiable pages.

- [ ] **Step 5: Verify GREEN**

Run the focused tests again and require 0 failures.

---

### Task 2: Site-type-specific safe mandatory action selection

**Files:**
- Modify: `electron/auto-qa/behavior-planner.cjs`
- Modify: `electron/auto-qa/auto-qa-engine.cjs`
- Modify: `electron/auto-qa/safety-policy.cjs`
- Test: `electron/auto-qa/behavior-planner.test.cjs`
- Test: `electron/auto-qa/auto-qa-engine.test.cjs`
- Test: `electron/auto-qa/safety-policy.test.cjs`

**Interfaces:**
- Consumes: normalized classification/evidence from Task 1.
- Produces: a deterministic primary safe action plan with one of `open-recent-article`, `operate-downloader`, `operate-shortlink`, `operate-temp-mail`, `operate-form-tool`, `open-safe-same-origin`, or `no-safe-action`.

- [ ] **Step 1: Write failing behavior tests for each supported site family**

Cover:

```text
blog-index -> newest timestamped safe article, else first Recent/Latest, else first safe article
article -> safe same-origin next/read-more action only if time remains
downloader -> URL/text field + legitimate Download/Convert action
shortlink -> URL field + Shorten/Create action
temp-mail -> Copy/Refresh/Get Mail/New Mail safe control
form-tool -> ordinary safe field/control/action
landing-redirect -> benign same-origin action if one exists
generic-content -> benign same-origin action if one exists
unknown -> no-safe-action
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test electron/auto-qa/behavior-planner.test.cjs electron/auto-qa/auto-qa-engine.test.cjs electron/auto-qa/safety-policy.test.cjs
```

Expected: one or more new family/action assertions fail.

- [ ] **Step 3: Implement planner mapping**

Keep prohibited controls blocked by the safety policy. Require same-origin for article/generic navigation unless existing approved external-tab handling explicitly supervises the action.

- [ ] **Step 4: Ensure `no-safe-action` is explicit and logged once**

The engine must not repeatedly re-run full-page observation because no action exists. Log a single clear result and continue only with remaining observation/final integrity work.

- [ ] **Step 5: Verify GREEN**

Run the focused tests and require 0 failures.

---

### Task 3: Frame-aware ad discovery, classification, and deduplication

**Files:**
- Modify: `electron/auto-qa/ad-observer.cjs`
- Modify: `electron/auto-qa/auto-qa-engine.cjs`
- Test: `electron/auto-qa/ad-observer.test.cjs`
- Test: `electron/auto-qa/auto-qa-engine.test.cjs`

**Interfaces:**
- Consumes: main page plus child frames and current session budget.
- Produces: `ads[]` where each ad has stable identity, frame URL, geometry, visibility, confidence evidence, and type: `banner`, `sticky-anchor`, `interstitial-vignette`, `native-sponsored`, `iframe-network`, or `unknown-ad`.

- [ ] **Step 1: Write failing tests for ad formats and deduplication**

Create cases for:

```text
728x90/320x50 style banner container
bottom/top sticky anchor
full-screen vignette/interstitial
native card labeled Sponsored/Ad
cross-origin ad iframe
same element detected by multiple heuristics -> counted once
hidden/offscreen element -> not counted visible
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test electron/auto-qa/ad-observer.test.cjs electron/auto-qa/auto-qa-engine.test.cjs
```

- [ ] **Step 3: Implement main-document and child-frame discovery**

Use DOM/frame/network-origin evidence such as common ad frame/container patterns, explicit Ad/Sponsored labels, fixed overlay geometry, and frame URLs. Do not depend on a single CSS class.

- [ ] **Step 4: Implement stable deduplication**

Deduplicate by frame+element identity where available, otherwise by normalized geometry plus nearby text/network evidence. Ensure a nested iframe/container pair is one visible ad, not two counts.

- [ ] **Step 5: Verify GREEN**

Require all focused tests to pass.

---

### Task 4: Safe ad observation without ad engagement

**Files:**
- Modify: `electron/auto-qa/ad-observer.cjs`
- Modify: `electron/interaction-indicator.cjs`
- Modify: `electron/auto-qa/session-budget.cjs`
- Test: `electron/auto-qa/ad-observer.test.cjs`
- Test: `electron/interaction-indicator.test.cjs`
- Test: `electron/auto-qa/session-budget.test.cjs`

**Interfaces:**
- Consumes: deduplicated visible ad list and available ad-observation budget.
- Produces: passive visual observation records with dwell duration and `observed: true/false`; no click and no DOM hover dispatch into ad content.

- [ ] **Step 1: Write failing tests proving observation is passive**

Assert that ad observation moves OrbitQA's visible pointer/touch indicator near the ad boundary/center-safe offset and waits, but does not call `locator.hover()`, `click()`, `dispatchEvent('mouseover')`, or any ad CTA action.

- [ ] **Step 2: Verify RED**

Run the three focused test files.

- [ ] **Step 3: Implement timer-scaled dwell**

Short sessions: observe fewer ads for shorter dwell; long sessions: observe more ads for longer dwell. Bound each dwell to a safe range and never consume final-integrity reserve.

- [ ] **Step 4: Verify GREEN**

Require focused tests to pass.

---

### Task 5: Live Matrix ad summary data contract

**Files:**
- Modify: `electron/qa-runner.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/shared/testRun.ts`
- Modify: `src/shared/testRun.test.ts`
- Modify: `src/pages/Run.tsx`
- Modify: `src/pages/TestRuns.test.tsx`
- Test: `electron/qa-runner.test.cjs`

**Interfaces:**
- Consumes: per-WorkUnit ad observation result from Auto QA.
- Produces: `latestResult.adSummary` with total visible ads, counts by type, observed count, and status.

- [ ] **Step 1: Write failing shared-contract tests**

Define the result shape:

```ts
type AdSummary = {
  total: number;
  observed: number;
  byType: {
    banner: number;
    stickyAnchor: number;
    interstitialVignette: number;
    nativeSponsored: number;
    iframeNetwork: number;
    unknownAd: number;
  };
  status: 'pass' | 'none' | 'partial';
};
```

- [ ] **Step 2: Write failing renderer test**

Assert LIVE MATRIX -> Latest Result renders:

```text
Ads seen: 4
Banner: 2
Sticky/Anchor: 1
Interstitial/Vignette: 1
Ad observation: PASS
```

- [ ] **Step 3: Verify RED**

Run:

```bash
npm test -- src/shared/testRun.test.ts src/pages/TestRuns.test.tsx
```

and:

```bash
node --test electron/qa-runner.test.cjs
```

- [ ] **Step 4: Implement result propagation and UI rendering**

Keep individual ad details in Activity Log; show aggregate summary in LIVE MATRIX.

- [ ] **Step 5: Verify GREEN**

Run the focused renderer and runner tests.

---

### Task 6: Hide Locale and Timezone from visible Live Matrix only

**Files:**
- Modify: `src/pages/Run.tsx`
- Modify: `src/pages/TestRuns.test.tsx`
- Test: `electron/session-integrity.test.cjs`
- Test: `electron/device-consistency.test.cjs`

**Interfaces:**
- Consumes: existing integrity result that still contains locale/timezone checks internally.
- Produces: cleaner visible Live Matrix with those rows omitted.

- [ ] **Step 1: Write failing renderer test**

Assert that `Locale` and `Timezone` are absent from LIVE MATRIX/Latest Result while proxy route, WebRTC, page-load, and device summary remain visible.

- [ ] **Step 2: Add regression assertions that internal checks remain**

Keep assertions in Node tests that locale/timezone are still collected and can still contribute to warnings/failures according to existing rules.

- [ ] **Step 3: Verify RED**

Run renderer plus integrity/device tests.

- [ ] **Step 4: Remove only the visible rows**

Do not delete data collection, session-integrity checks, or log messages.

- [ ] **Step 5: Verify GREEN**

Require focused tests to pass.

---

### Task 7: Fetched free proxy candidate provider

**Files:**
- Create: `electron/free-proxy-provider.cjs`
- Create: `electron/free-proxy-provider.test.cjs`
- Modify: `electron/proxy-pool-service.cjs`
- Modify: `electron/proxy-pool-service.test.cjs`
- Modify: `electron/proxy-store.cjs`
- Modify: `electron/proxy-store.test.cjs`

**Interfaces:**
- Produces: normalized candidate proxies only; it does not mark a proxy usable.
- Candidate shape: `{ protocol, host, port, username?, password?, source, fetchedAt }`.

- [ ] **Step 1: Write failing parsing/deduplication tests**

Cover HTTP, HTTPS, SOCKS4, SOCKS5 candidate formats, malformed entries, duplicates, and source attribution.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test electron/free-proxy-provider.test.cjs electron/proxy-pool-service.test.cjs electron/proxy-store.test.cjs
```

- [ ] **Step 3: Implement provider adapters**

Implement a provider abstraction that can consume ProxyScrape-compatible and Geonode-compatible responses. Keep endpoints/config isolated from the core pool so one provider can fail without breaking manual/static/rotating modes.

- [ ] **Step 4: Add bounded fetch timeout and source-level error reporting**

A feed timeout must not stall QA runs. Return candidates from successful feeds and log unsuccessful feeds.

- [ ] **Step 5: Verify GREEN**

Require all provider/store focused tests to pass.

---

### Task 8: Thorough fetched-proxy validation and quarantine

**Files:**
- Modify: `electron/proxy-health.cjs`
- Modify: `electron/proxy-health.test.cjs`
- Modify: `electron/proxy-diagnostics.cjs`
- Modify: `electron/proxy-diagnostics.test.cjs`
- Modify: `electron/proxy-pool-service.cjs`
- Modify: `electron/proxy-pool-service.test.cjs`
- Modify: `electron/privacy-probe.cjs`
- Test: `electron/privacy-probe.test.cjs`

**Interfaces:**
- Consumes: fetched candidates from Task 7.
- Produces: verified usable proxy entries or quarantined/rejected entries with reason and recheck time.

- [ ] **Step 1: Write failing validation tests**

Required pipeline assertions:

```text
malformed -> reject
connection failure -> reject
HTTPS route failure -> reject
no browser exit IP -> reject
direct-IP fallback detected -> reject
latency above configured ceiling -> reject or slow-verified according to existing policy
WebRTC/direct-route leak -> reject for strict proxy WorkUnit
all checks pass -> eligible
```

- [ ] **Step 2: Verify RED**

Run proxy health/diagnostics/pool/privacy tests.

- [ ] **Step 3: Implement validation pipeline using existing diagnostics primitives**

Reuse current proxy route, direct-IP, WebRTC, and health checks instead of creating a second privacy implementation.

- [ ] **Step 4: Implement quarantine-on-runtime-failure**

Fetched proxies that fail during a WorkUnit are quarantined immediately and cannot be reserved again until a fresh validation succeeds.

- [ ] **Step 5: Verify GREEN**

Require focused tests to pass.

---

### Task 9: Optional Fetched Free Proxies UI mode

**Files:**
- Modify: `src/shared/proxy.ts`
- Modify: `src/shared/proxy.test.ts`
- Modify: `src/pages/ProxyManager.tsx`
- Modify: `src/pages/ProxyManager.test.tsx`
- Modify: `src/components/DeviceMatrixEditor.tsx`
- Modify: `src/components/DeviceMatrixEditor.test.tsx`
- Modify: `electron/preload.cjs`
- Modify: `electron/main.cjs`
- Test: `electron/proxy-ipc-contract.test.cjs`
- Test: `electron/proxy-renderer-contract.test.cjs`

**Interfaces:**
- Adds proxy source enum value `fetched-free`.
- Exposes fetch/validate/refresh status and verified count; does not alter existing Manual/Static/Rotating options.

- [ ] **Step 1: Write failing UI/contract tests**

Assert that the selector contains:

```text
None
Manual
Static Pool
Rotating Pool
Fetched Free Proxies
```

and that selecting `Fetched Free Proxies` shows verified/failed/fetching counts rather than manual credential inputs.

- [ ] **Step 2: Verify RED**

Run React proxy tests and Node IPC/renderer contract tests.

- [ ] **Step 3: Implement IPC and UI state**

Add explicit actions for fetch/validate/refresh. Never silently switch a run to fetched proxies; the user must select the mode.

- [ ] **Step 4: Verify GREEN**

Require focused tests to pass.

---

### Task 10: Timer-budget integration across reading, action, ads, follow-up, and integrity

**Files:**
- Modify: `electron/auto-qa/session-budget.cjs`
- Modify: `electron/auto-qa/session-budget.test.cjs`
- Modify: `electron/auto-qa/reading-driver.cjs`
- Modify: `electron/auto-qa/reading-driver.test.cjs`
- Modify: `electron/auto-qa/auto-qa-engine.cjs`
- Modify: `electron/auto-qa/auto-qa-engine.test.cjs`

**Interfaces:**
- Produces a budget object with explicit slices for `reading`, `primaryAction`, `adObservation`, `followUp`, and `finalIntegrity`.

- [ ] **Step 1: Write failing short/medium/long timer tests**

Test representative durations such as 20s, 60s, and 180s. Assert that every non-extreme session preserves primary-action and final-integrity time, while ad observation scales down/up with the available duration.

- [ ] **Step 2: Verify RED**

Run session-budget, reading-driver, and auto-qa-engine tests.

- [ ] **Step 3: Implement deterministic budget allocation**

Ensure the initial read cannot consume the primary action or final integrity reserve. Upward return remains faster than downward reading.

- [ ] **Step 4: Integrate ad observation within its own budget**

Stop ad observation when its budget is exhausted and continue to the main site action/follow-up as planned.

- [ ] **Step 5: Verify GREEN**

Require focused tests to pass.

---

### Task 11: Consolidated regression coverage for popup, auxiliary tabs, STOP, concurrency, privacy, and cache isolation

**Files:**
- Modify tests only unless a regression is discovered:
  - `electron/blocking-surface-resolver.test.cjs`
  - `electron/auto-qa/blocker-observer.test.cjs`
  - `electron/auto-qa/navigation-supervisor.test.cjs`
  - `electron/qa-runner.test.cjs`
  - `electron/work-unit-scheduler.test.cjs`
  - `electron/session-integrity.test.cjs`
  - `electron/privacy-probe.test.cjs`
  - `electron/device-consistency.test.cjs`

**Interfaces:**
- Regression gate only.

- [ ] **Step 1: Add combined scenario tests**

Cover:

```text
popup appears, is closed, later popup appears, monitor closes it too
popup with Close + Continue chooses Close only
new tab remains open until complete, is observed/scrolled, then closes
STOP during active+queued run leaves 0 running/0 queued and allows immediate restart
mixed Desktop/Android/iOS manual concurrency remains fair
fresh WorkUnit browser contexts do not share cookies/storage
proxy-required work never falls back direct
locale/timezone remain internally checked although hidden from UI
```

- [ ] **Step 2: Run the regression subset**

Run the listed Node test files and require 0 failures.

- [ ] **Step 3: Fix only genuine regressions exposed by the new work**

Any production-code fix must get its own failing regression assertion first.

---

### Task 12: Full verification and release packaging

**Files:**
- Update: `README.md`
- Create: `V0.12.0-SMART-AUTOQA-ADS-FETCHED-PROXY-LIVE-MATRIX.txt`
- No production changes after the final full test run unless the suite is rerun.

**Interfaces:**
- Produces the tested release ZIP.

- [ ] **Step 1: Run complete Node/backend test suite**

Run:

```bash
npm test
```

If local dependencies are unavailable in the container, separately run every Node test file with `node --test` and document the exact missing-dependency limitation for Vitest.

- [ ] **Step 2: Run TypeScript/Vite build**

Run:

```bash
npm run build
```

Require exit 0 in an environment with installed dependencies.

- [ ] **Step 3: Run browser-health test**

Run:

```bash
npm run test:browser-health
```

Require exit 0 in an environment with Playwright installed.

- [ ] **Step 4: Run CommonJS syntax verification**

Run `node --check` across every `.cjs` source file and require 0 failures.

- [ ] **Step 5: Update release notes**

Document final-page classification, site-specific safe actions, ad summary, fetched proxy validation/quarantine, hidden Locale/Timezone UI, timer budgeting, and preserved safety/privacy rules.

- [ ] **Step 6: Package and validate ZIP**

Create a new release ZIP without `node_modules` and verify archive integrity with `unzip -t`.

- [ ] **Step 7: Provide Windows copy/paste verification block**

Provide exactly:

```powershell
npm.cmd install
npm.cmd test
npm.cmd run build
npm.cmd run test:browser-health
npm.cmd run dev
```

with beginner-friendly instructions for opening PowerShell in the extracted folder.

---

## Self-Review

- Spec coverage: site recognition, appropriate safe actions, ad detection/type/count/observation, Live Matrix ad summary, optional fetched-free-proxy mode, thorough proxy validation/quarantine, hidden Locale/Timezone UI, timer budgeting, and preservation of popup/tab/STOP/concurrency/privacy behavior are each mapped to explicit tasks.
- Placeholder scan: no TBD/TODO/implement-later placeholders remain.
- Type consistency: `AdSummary` and `fetched-free` are defined once and referenced consistently throughout the plan.
- Safety consistency: ad observation remains passive; ads/sponsored CTAs/CAPTCHA/payment/destructive actions are never clicked.
