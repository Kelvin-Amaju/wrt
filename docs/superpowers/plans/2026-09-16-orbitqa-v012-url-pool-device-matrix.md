# OrbitQA v0.12 URL Pool, Device Matrix, and Auto QA Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace repeated target/device-group cards with a scalable URL Pool + checkbox Device Matrix, while making popup dismissal and secondary-tab observation reliable and preserving the existing proxy/WebRTC/device/timer protections.

**Architecture:** Introduce a v3 run request model in `src/shared/qaMatrix.ts` with a normalized URL pool, selected device-family configurations, and General/Per-device proxy policy. Compile that model lazily in `electron/work-unit-scheduler.cjs` using a deterministic shuffled URL deck. Keep v2 parsing as a compatibility adapter in the backend while the renderer moves to v3. Strengthen Auto QA with a global cross-frame dismiss-control scan and a secondary-tab usable-ready/minimum-observation contract.

**Tech Stack:** Electron 38, React 19, TypeScript 5.9, Vite 7, Vitest 3, Playwright 1.63, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-16-orbitqa-v012-url-pool-device-matrix-design.md`

## Global Constraints

- No arbitrary app-level cap on URL pool size or requested WorkUnits.
- Active launches remain governed by Auto Concurrency/resource pressure or a positive manual concurrency value.
- Strict Privacy Mode fails closed on direct fallback or fatal WebRTC leak.
- Secondary tabs remain in the same BrowserContext and therefore inherit the WorkUnit proxy/privacy policy.
- Never click advertisement bodies, promotional CTAs, SmartLinks, CAPTCHA, OTP, password, payment, checkout, destructive-account, banking, or other consequential controls.
- Promotional overlays may only be dismissed through verified `Close`, `X`, `Cancel`, `Dismiss`, `No thanks`, or clearly equivalent dismissive controls.
- Referrer QA remains explicitly simulated and never generates fake search/social clicks.
- `navigator.webdriver`, host platform, CPU/GPU/memory and other host/runtime facts remain truthful.
- Existing v0.11.2 proxy recovery, navigation resilience, device consistency, STOP semantics, timer ownership, and Auto QA safety remain intact.

---

### Task 1: URL Pool Domain and Deterministic Shuffled Deck

**Files:**
- Create: `src/shared/urlPool.ts`
- Create: `src/shared/urlPool.test.ts`
- Create: `electron/url-pool.cjs`
- Create: `electron/url-pool.test.cjs`

**Interfaces:**
- Produces renderer `parseUrlPool(text: string): UrlPoolParseResult`.
- Produces backend `createUrlDeck(urls, seed)` with `next()` returning normalized URLs without reuse until exhaustion.
- URL normalization adds `https://` only when scheme is omitted, rejects non-http(s), deduplicates by normalized scheme/host plus exact path/query semantics.

- [ ] **Step 1: Write failing renderer tests**

```ts
it('normalizes and deduplicates a large multiline URL pool without a product cap', () => {
  const input = ['example.com', 'https://EXAMPLE.com/', 'https://a.example/p?q=1', '', ...Array.from({ length: 1000 }, (_, i) => `host${i}.example`) ].join('\n');
  const result = parseUrlPool(input);
  expect(result.valid[0]).toBe('https://example.com/');
  expect(result.duplicates).toBe(1);
  expect(result.invalid).toEqual([]);
  expect(result.valid.length).toBe(1002);
});

it('keeps invalid entries visible while preserving valid entries', () => {
  const result = parseUrlPool('good.example\nfile:///tmp/a\nnot a url');
  expect(result.valid).toEqual(['https://good.example/']);
  expect(result.invalid.map((item) => item.input)).toEqual(['file:///tmp/a', 'not a url']);
});
```

- [ ] **Step 2: Run renderer URL pool tests and confirm RED**

Run: `npm.cmd test -- src/shared/urlPool.test.ts` on Windows or `npx vitest run src/shared/urlPool.test.ts` where dependencies exist.
Expected: FAIL because `urlPool.ts` does not exist.

- [ ] **Step 3: Implement renderer URL pool parsing**

Create `src/shared/urlPool.ts` exporting:

```ts
export interface UrlPoolInvalidEntry { line: number; input: string; reason: string }
export interface UrlPoolParseResult { valid: string[]; duplicates: number; invalid: UrlPoolInvalidEntry[] }
export function normalizePoolUrl(input: string): string;
export function parseUrlPool(text: string): UrlPoolParseResult;
```

Canonical duplicate key must lowercase protocol/hostname and preserve pathname/search/hash.

- [ ] **Step 4: Write failing backend shuffled-deck tests**

```js
test('fixed seed covers every URL before reuse and is reproducible', () => {
  const urls = ['https://a.example/', 'https://b.example/', 'https://c.example/'];
  const first = createUrlDeck(urls, 'run-42');
  const second = createUrlDeck(urls, 'run-42');
  const seq1 = Array.from({ length: 6 }, () => first.next());
  const seq2 = Array.from({ length: 6 }, () => second.next());
  assert.deepEqual(seq1, seq2);
  assert.equal(new Set(seq1.slice(0, 3)).size, 3);
  assert.equal(new Set(seq1.slice(3, 6)).size, 3);
});
```

- [ ] **Step 5: Implement deterministic shuffled deck and verify GREEN**

Create `electron/url-pool.cjs` with a tiny deterministic seeded PRNG + Fisher-Yates shuffle. `next()` reshuffles only after the current deck is exhausted.

Run: `node --test electron/url-pool.test.cjs`.
Expected: PASS.

---

### Task 2: v3 Device Matrix + Proxy Mode Request Model

**Files:**
- Modify: `src/shared/qaMatrix.ts`
- Modify: `src/shared/qaMatrix.test.ts`
- Modify: `src/shared/mobileDevices.ts`
- Modify: `src/shared/realIos.ts`

**Interfaces:**
- Produces `QaRunRequestV3` with `urlPool`, `devices`, `proxyMode`, `generalProxy`, existing concurrency/privacy/Auto QA/steps.
- Device-family config types: `DesktopMatrixConfig`, `AndroidEmulationMatrixConfig`, `IosCompatibilityMatrixConfig`, `AndroidAvdMatrixConfig`, `RealIosMatrixConfig`.
- Produces `createDefaultQaRunV3()` and `normalizeQaRunRequestV3()`.
- Existing v2 exports remain available during migration.

- [ ] **Step 1: Write failing v3 request tests**

```ts
it('normalizes one URL pool with multiple device families and general proxy inheritance', () => {
  const request = normalizeQaRunRequestV3({
    urlPoolText: 'a.example\nb.example',
    proxyMode: 'general',
    generalProxy: { source: 'rotating', allowSlowProxies: true },
    devices: {
      desktop: { enabled: true, browsers: ['chromium', 'firefox'], instancesPerBrowser: 2, sessionDurationSeconds: 60 },
      androidEmulation: { enabled: true, profiles: ['Pixel 7'], instancesPerProfile: 3, sessionDurationSeconds: 90 },
    },
    concurrency: { mode: 'auto' },
    headless: false,
    interactionIndicator: true,
    autoQa: createDefaultAutoQaSettings(),
    steps: [],
    privacy: createDefaultPrivacySettings(),
  });
  expect(request.urlPool).toEqual(['https://a.example/', 'https://b.example/']);
  expect(countMatrixWorkUnitsV3(request.devices)).toBe(7);
  expect(request.generalProxy.source).toBe('rotating');
});
```

Add separate tests for: multiple iOS profiles; unsupported proxy on AVD/Real iOS surfaced as unavailable; manual concurrency >5; no URL/WorkUnit cap.

- [ ] **Step 2: Run v3 domain tests and confirm RED**

Run: `npx vitest run src/shared/qaMatrix.test.ts`.
Expected: FAIL because v3 APIs are absent.

- [ ] **Step 3: Implement v3 types/defaults/normalization**

Keep v2 intact but add v3 alongside it. Validation must require at least one valid URL and one enabled device family with at least one valid browser/profile. Session duration stays 5..600 seconds. Instance counts are positive integers with no product cap.

- [ ] **Step 4: Verify qaMatrix tests GREEN**

Run: `npx vitest run src/shared/qaMatrix.test.ts src/shared/urlPool.test.ts`.
Expected: PASS.

---

### Task 3: Lazy v3 WorkUnit Compiler and URL Assignment

**Files:**
- Modify: `electron/work-unit-scheduler.cjs`
- Modify: `electron/work-unit-scheduler.test.cjs`
- Modify: `electron/qa-runner.cjs`
- Modify: `electron/qa-runner.test.cjs`

**Interfaces:**
- Adds `countWorkUnitsV3(request)`.
- Adds `iterateWorkUnitsV3(request)` which constructs one descriptor at a time and assigns each descriptor `targetUrl: urlDeck.next()`.
- v3 descriptors retain existing `settingsForWorkUnit` fields, so browser/device launch code does not need a second execution engine.
- General proxy resolves before yield; Per-device proxy resolves from the family configuration.

- [ ] **Step 1: Write failing scheduler tests**

```js
test('v3 lazy compiler assigns every URL before deck reuse', () => {
  const request = makeV3Request({ urls: ['https://a.example/', 'https://b.example/', 'https://c.example/'], desktopInstances: 5, seed: 'r1' });
  const units = Array.from(iterateWorkUnitsV3(request));
  assert.equal(units.length, 5);
  assert.equal(new Set(units.slice(0, 3).map((u) => u.targetUrl)).size, 3);
});

test('STOP cancels a huge v3 lazy queue without materializing remaining descriptors', async () => {
  const request = makeV3Request({ desktopInstances: 50000 });
  const source = iterateWorkUnitsV3(request);
  // abort after first worker begins; assert remaining 49,999 are counted cancelled without iterating them all.
});
```

Add tests for General proxy inheritance, Per-device override, multiple desktop browsers, multiple Android/iOS profiles, AVD exclusivity, and deterministic seed assignment.

- [ ] **Step 2: Run scheduler/runner tests and confirm RED**

Run: `node --test electron/work-unit-scheduler.test.cjs electron/qa-runner.test.cjs`.
Expected: FAIL because v3 compiler is absent.

- [ ] **Step 3: Implement v3 compilation and runner normalization**

`normalizeQaRunRequest()` in `qa-runner.cjs` must recognize `{ version: 3 }`/`urlPool` requests before legacy v2. `settingsForWorkUnit()` remains the single launch adapter.

- [ ] **Step 4: Verify scheduler/runner tests GREEN**

Run: `node --test electron/url-pool.test.cjs electron/work-unit-scheduler.test.cjs electron/qa-runner.test.cjs`.
Expected: PASS.

---

### Task 4: Replace Target Cards with URL Pool + Device Matrix UI

**Files:**
- Create: `src/components/UrlPoolEditor.tsx`
- Create: `src/components/UrlPoolEditor.test.tsx`
- Create: `src/components/DeviceMatrixEditor.tsx`
- Create: `src/components/DeviceMatrixEditor.test.tsx`
- Modify: `src/pages/Run.tsx`
- Modify: `src/pages/TestRuns.test.tsx`
- Modify: `src/styles.css`
- Retain but stop rendering by default: `src/components/TargetPlanEditor.tsx`

**Interfaces:**
- `UrlPoolEditor` consumes raw text + `parseUrlPool` result and emits text changes.
- `DeviceMatrixEditor` consumes v3 device config, proxy mode, proxy summary/mobile/provider capabilities and emits immutable config changes.
- `TestRuns` owns one `QaRunRequestV3`-compatible configuration state.

- [ ] **Step 1: Write failing UI tests**

```tsx
it('renders one Target URL Pool instead of repeated target cards', () => {
  render(<TestRuns />);
  expect(screen.getByRole('textbox', { name: /Target URL Pool/i })).toBeInTheDocument();
  expect(screen.queryByText(/Add target website/i)).not.toBeInTheDocument();
});

it('enables multiple device families and exposes only compatible controls', async () => {
  render(<TestRuns />);
  await user.click(screen.getByRole('checkbox', { name: /Android mobile emulation/i }));
  await user.click(screen.getByRole('checkbox', { name: /Local iPhone/i }));
  expect(screen.getByRole('checkbox', { name: /Pixel 7/i })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /iPhone 13/i })).toBeInTheDocument();
});

it('switches proxy controls between General and Per device', async () => {
  render(<TestRuns />);
  expect(screen.getByLabelText(/General proxy source/i)).toBeInTheDocument();
  await user.click(screen.getByRole('radio', { name: /Per device/i }));
  expect(screen.getByLabelText(/Desktop proxy source/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run UI tests and confirm RED**

Run: `npx vitest run src/components/UrlPoolEditor.test.tsx src/components/DeviceMatrixEditor.test.tsx src/pages/TestRuns.test.tsx`.
Expected: FAIL because new components are absent and old target cards are still rendered.

- [ ] **Step 3: Implement the new UI**

Normal order in `TestRuns`: Target URL Pool → Device Matrix → Proxy Mode → Auto QA/Manual Advanced → concurrency/privacy/start controls. Show live valid/duplicate/invalid counts. Manual Script remains collapsed/advanced when Auto QA is selected.

- [ ] **Step 4: Verify UI tests GREEN**

Run: `npx vitest run src/components/UrlPoolEditor.test.tsx src/components/DeviceMatrixEditor.test.tsx src/pages/TestRuns.test.tsx`.
Expected: PASS.

---

### Task 5: Cross-Frame Popup Resolver Reliability

**Files:**
- Modify: `electron/auto-qa/blocker-observer.cjs`
- Modify: `electron/auto-qa/blocker-observer.test.cjs`
- Modify: `electron/blocking-surface-resolver.cjs`
- Modify: `electron/blocking-surface-resolver.test.cjs`

**Interfaces:**
- Adds a global frame scan returning `{ frame, locator, label, intent }` for verified dismissive controls.
- Separates `dismissive` intent from promotional/action intent; `Continue`, `Coupon`, `Download`, `Open`, `Visit`, `Claim` must never qualify.
- Dismissal verifies that the control/overlay is gone or no longer blocks content.

- [ ] **Step 1: Write failing popup regression tests**

```js
test('pairs parent dimming overlay with child-frame Close and never selects Continue', async () => {
  const result = await findGlobalDismissControl(fakePageWithParentOverlayAndChildFrame(['Close', 'Continue']));
  assert.equal(result.label, 'Close');
});

test('re-scans after returning from a secondary tab and dismisses a newly appeared frame popup', async () => {
  // first scan none; second scan after return exposes child-frame X; assert one verified dismissal.
});
```

Also cover child-frame `X`, `Cancel`, `Dismiss`, `No thanks`, no ad-body fallback, and failed-disappearance verification.

- [ ] **Step 2: Run popup tests and confirm RED**

Run: `node --test electron/auto-qa/blocker-observer.test.cjs electron/blocking-surface-resolver.test.cjs`.
Expected: FAIL on cross-frame association/intent filtering.

- [ ] **Step 3: Implement global scan + verified dismissal**

Search every Playwright frame for explicit dismiss controls and correlate with substantial visible overlays/frames without evaluating cross-origin DOM from the parent. Only activate one unambiguously dismissive control.

- [ ] **Step 4: Verify popup tests GREEN**

Run: same command; expected PASS.

---

### Task 6: Secondary-Tab Usable-Ready and Minimum-Observation Contract

**Files:**
- Modify: `electron/auto-qa/navigation-supervisor.cjs`
- Modify: `electron/auto-qa/navigation-supervisor.test.cjs`
- Modify: `electron/auto-qa/reading-driver.cjs`
- Modify: `electron/auto-qa/reading-driver.test.cjs`
- Modify: `electron/auto-qa/auto-qa-engine.cjs`
- Modify: `electron/auto-qa/auto-qa-engine.test.cjs`

**Interfaces:**
- `waitForUsableReady(page, options)` returns only after non-blank URL + interactive/complete readyState + readable layout metrics.
- `observeAuxiliaryPage(page, budget, hooks)` enforces minimum dwell and at least one scroll attempt if scrollable.
- Network-idle timeout is non-fatal and cannot by itself authorize immediate closure.
- Before close, the existing route/privacy verification hook must run for proxy-required work units.

- [ ] **Step 1: Write failing secondary-tab tests**

```js
test('does not close a new tab when networkidle times out before usable-ready observation', async () => {
  const events = [];
  await superviseSecondaryTab(fakePage({ networkIdleTimeout: true, scrollable: true }), { onEvent: (e) => events.push(e) });
  assert.ok(events.indexOf('usable-ready') < events.indexOf('scroll-attempt'));
  assert.ok(events.indexOf('scroll-attempt') < events.indexOf('close'));
});

test('non-scrollable secondary page still dwells before close', async () => {
  // assert dwell event then close, with explicit non-scrollable log.
});
```

Add tests for same BrowserContext identity, route/privacy fatal failure blocks closure/WorkUnit, and return-to-primary blocker rescan.

- [ ] **Step 2: Run navigation/engine tests and confirm RED**

Run: `node --test electron/auto-qa/navigation-supervisor.test.cjs electron/auto-qa/reading-driver.test.cjs electron/auto-qa/auto-qa-engine.test.cjs`.
Expected: FAIL on minimum observation contract.

- [ ] **Step 3: Implement usable-ready/minimum-observation flow**

Do not wait forever for network silence. Use DOM readiness + layout metrics + bounded load/network-settle + minimum dwell. Keep all tabs in the same BrowserContext; never spawn a second browser just for the auxiliary page.

- [ ] **Step 4: Verify navigation/engine tests GREEN**

Run: same command; expected PASS.

---

### Task 7: Timer Budgeter Integration, Activity Log, and Release Regression

**Files:**
- Modify: `electron/auto-qa/reading-driver.cjs`
- Modify: `electron/auto-qa/reading-driver.test.cjs`
- Modify: `electron/auto-qa/auto-qa-engine.cjs`
- Modify: `electron/auto-qa/auto-qa-engine.test.cjs`
- Modify: `src/pages/Run.tsx`
- Modify: `electron/activity-log-label-source.test.cjs`
- Modify: `package.json`
- Create: `V0.12.0-URL-POOL-DEVICE-MATRIX-AUTO-QA-RELIABILITY.txt`

**Interfaces:**
- Timer budget exposes reading/action/follow-up/integrity reserves and logs them.
- Short sessions preserve one meaningful safe action + result observation + final integrity reserve.
- Long sessions use slower reading; upward return remains faster than downward reading.

- [ ] **Step 1: Write failing timer/log tests**

```js
test('short budget increases reading stride while preserving action and integrity reserves', () => {
  const short = createSessionBudget({ remainingMs: 30000, pageHeight: 12000 });
  const long = createSessionBudget({ remainingMs: 180000, pageHeight: 12000 });
  assert.ok(short.downwardStepPx > long.downwardStepPx);
  assert.ok(short.integrityReserveMs > 0);
  assert.ok(short.actionReserveMs > 0);
  assert.ok(short.upwardPauseMs < short.downwardPauseMs);
});
```

- [ ] **Step 2: Run timer tests and confirm RED**

Run: `node --test electron/auto-qa/reading-driver.test.cjs electron/auto-qa/auto-qa-engine.test.cjs`.
Expected: FAIL on the newly specified budget/log contract.

- [ ] **Step 3: Implement budget integration and v0.12 activity logs**

Add logs for URL-pool assignment, timer budget, stable-bottom reading, fast upward return, site classification, popup cross-frame association, secondary-tab usable-ready/minimum observation, return-to-primary rescan, and final integrity reserve.

- [ ] **Step 4: Update version/release notes**

Set package version to `0.12.0`. Release note must list URL Pool, Device Matrix, General/Per-device proxy mode, timer budgeting, cross-frame popup fix, and secondary-tab contract.

- [ ] **Step 5: Run full regression verification**

Run on a dependency-complete Windows project:

```powershell
npm.cmd test
if ($LASTEXITCODE -ne 0) { exit }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { exit }
npm.cmd run test:browser-health
```

Expected: all Vitest + Node tests pass, TypeScript/Vite build exits 0, Chromium/Firefox/WebKit browser-health tests pass.

- [ ] **Step 6: Package and verify archive**

Create `orbitqa-v0.12.0-url-pool-device-matrix-autoqa-reliability.zip`, then verify archive integrity before presenting it.

---

## Self-Review Results

- **Spec coverage:** URL pool, shuffled deck, Device Matrix, General/Per-device proxies, lazy generation, popup cross-frame dismissal, secondary-tab observation, timer budget, logs, safety boundaries, and release verification are each mapped to a task.
- **Placeholder scan:** no TBD/TODO/fill-later placeholders remain.
- **Type consistency:** v3 renderer request → backend normalization → lazy scheduler → existing `settingsForWorkUnit` adapter is the single execution data path; URL deck API names are consistent across tasks.
