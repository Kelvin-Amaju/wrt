# Blocking Surface Resolver, Multi-Target Runs, and Global Session Lifetime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one OrbitQA run test up to 20 target URLs with one shared configuration, keep every tab/window in each browser context on one non-resetting 5–600 second lifetime, and recover from ordinary blocking overlays through geometry-aware safe dismissal without automating CAPTCHA or clicking ads.

**Architecture:** The renderer sends normalized `targetUrls[]` plus one shared `sessionDurationSeconds`. The runner expands them into isolated `QaWorkUnit`s (`target URLs × repetitions`), each with its own browser context, proxy reservation, `SessionLifetimeController`, and stable work identity. Smart Interaction delegates blocker handling to a new geometry-aware `BlockingSurfaceResolver`; all waits and scroll checkpoints become deadline-aware, while context-level page tracking ensures auxiliary/user-created tabs share the same hard deadline and are closed with the context.

**Tech Stack:** Electron, React, TypeScript, Node.js CommonJS, Playwright, Vitest, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-15-blocking-surface-multitarget-session-lifecycle-design.md`

## Global Constraints

- Desktop Chromium/Firefox/WebKit and Local iOS Compatibility are in scope; Real iOS Smart Interaction remains unsupported.
- Android keeps its current single-target/single-session limitation for this milestone.
- Maximum target URLs per run: **20**.
- Browser session duration default: **60 seconds**; allowed range: **5–600 seconds**.
- Concurrency remains capped at **5** browser contexts.
- One browser context owns one non-resetting deadline; navigation, focus changes, redirects, new tabs, or manual tabs never reset it.
- At deadline, close the entire context and every tab/window in it immediately.
- STOP cancels the whole run, closes active contexts, prevents queued work from starting, and releases proxy reservations.
- Ads/scripts remain loadable. Do not add request-level ad blocking.
- Never intentionally click advertisements, sponsored offers, install/update/download-ad controls, random coordinates, or human-verification/CAPTCHA controls.
- Safe blocker dismissal is limited to semantic close/cancel/dismiss/skip paths, verified close metadata, safe blocker/backdrop clicks, and Escape fallback.
- Final proxy route verification remains fail-closed and may only report PASS if it actually completed before the session deadline.

---

## File Structure

### New files

- `electron/session-lifetime.cjs` — owns one browser context deadline, remaining-time calculations, deadline-aware waits, and idempotent shutdown reason.
- `electron/session-lifetime.test.cjs` — unit tests for non-resetting deadlines, STOP/deadline races, and remaining-time capping.
- `electron/blocking-surface-resolver.cjs` — detects viewport-blocking surfaces by geometry/hit-testing and selects only safe dismissal paths.
- `electron/blocking-surface-resolver.test.cjs` — unit tests for custom blockers, external X controls, safe backdrops, delayed blockers, repeat blockers, and CAPTCHA non-interaction.

### Modified files

- `src/shared/testRun.ts` — request/event/work-unit types, target-list normalization, session-duration validation.
- `src/shared/testRun.test.ts` — renderer-domain tests for target lists, duration, and work identity.
- `electron/qa-runner.cjs` — backend request migration, work-unit expansion, per-work-unit context/proxy/timer lifecycle, deadline-aware final verification, event identity.
- `electron/qa-runner.test.cjs` — matrix/concurrency, deadline, extra tabs, STOP, incomplete session, route-verification integration tests.
- `electron/smart-interaction.cjs` — consume resolver and deadline-aware timing; remove selector-first blocker ownership from this module.
- `electron/smart-interaction.test.cjs` — integration tests proving Smart Interaction repeatedly invokes resolver and respects human-verification blocks/deadlines.
- `electron/main.cjs` — keep one run-level AbortController and ensure normalized multi-target requests are passed to the runner without collapsing them.
- `electron/qa-stop-ipc-contract.test.cjs` — STOP contract tests covering active multi-work-unit cancellation.
- `src/pages/Run.tsx` — multiline targets, shared session-duration input, work-unit queue keyed by `workId`, hostname/repetition display, shared START/STOP.
- `src/pages/TestRuns.test.tsx` — multi-target form, request payload, queue labels, duration UI, STOP behavior.
- `src/styles.css` — textarea/session-duration/queue-label styling only as needed.

---

### Task 1: Evolve the shared run contract for target lists, duration, and work identity

**Files:**
- Modify: `src/shared/testRun.ts:1-190`
- Modify: `src/shared/testRun.test.ts`

**Interfaces:**
- Consumes: existing `QaBrowser`, `QaStep`, `PrivacyRunSettings`, `ProxySource`.
- Produces:
  - `normalizeTargetUrls(input: string | string[]): string[]`
  - `QaRunRequest.targetUrls: string[]`
  - legacy optional `QaRunRequest.targetUrl?: string` for one migration release
  - `QaRunRequest.sessionDurationSeconds: number`
  - `QaWorkUnit { workId: string; targetIndex: number; targetUrl: string; repetition: number; sessionId: number }`
  - `QaEvent.workId?: string`, `QaEvent.targetUrl?: string`, `QaEvent.repetition?: number`
  - `QaEvent.status` additionally accepts `'incomplete'`

- [ ] **Step 1: Write failing target-list normalization tests**

Add tests that assert all of the following in `src/shared/testRun.test.ts`:

```ts
expect(normalizeTargetUrls([' savevidly.xyz ', '', 'https://example.org', 'savevidly.xyz'])).toEqual([
  'https://savevidly.xyz',
  'https://example.org',
]);
expect(() => normalizeTargetUrls(['good.example', 'http://[bad'])).toThrow(/line 2/i);
expect(() => normalizeTargetUrls(Array.from({ length: 21 }, (_, i) => `site${i}.example`))).toThrow(/20/i);
```

- [ ] **Step 2: Run the shared-domain test and verify RED**

Run:

```bash
npx.cmd vitest run src/shared/testRun.test.ts
```

Expected: FAIL because `normalizeTargetUrls` and the new request fields do not exist.

- [ ] **Step 3: Implement shared normalization and types**

Implement:

```ts
export function normalizeTargetUrls(input: string | string[]): string[] {
  const lines = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
  if (lines.length > 20) throw new Error('A run can contain up to 20 target URLs');
  const seen = new Set<string>();
  const normalized: string[] = [];
  lines.forEach((line, index) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    let target: string;
    try {
      target = normalizeTargetUrl(trimmed);
    } catch {
      throw new Error(`Invalid target URL on line ${index + 1}`);
    }
    if (!seen.has(target)) {
      seen.add(target);
      normalized.push(target);
    }
  });
  if (normalized.length === 0) throw new Error('Enter at least one valid target URL');
  if (normalized.length > 20) throw new Error('A run can contain up to 20 target URLs');
  return normalized;
}
```

Update `QaRunRequest` and `QaEvent` with the interfaces listed above. In `validateQaRunRequest`, resolve targets from `targetUrls` first and fall back to legacy `targetUrl`; require `sessionDurationSeconds` to be an integer/finite number from 5 through 600, defaulting to 60 only when omitted by a legacy caller.

- [ ] **Step 4: Run the shared-domain tests and verify GREEN**

Run:

```bash
npx.cmd vitest run src/shared/testRun.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit/checkpoint**

If the workspace is a Git repository:

```bash
git add src/shared/testRun.ts src/shared/testRun.test.ts
git commit -m "feat: add multi-target QA run contract"
```

If this workspace remains non-Git, record the completed Task 1 checkpoint in the execution notes and continue without inventing a commit.

---

### Task 2: Add backend target normalization and deterministic work-unit expansion

**Files:**
- Modify: `electron/qa-runner.cjs:55-170,597-825`
- Modify: `electron/qa-runner.test.cjs`

**Interfaces:**
- Consumes: `request.targetUrls`, legacy `request.targetUrl`, `request.sessionDurationSeconds`.
- Produces:
  - `normalizeTargetUrlsForRunner(input): string[]`
  - `buildWorkUnits(targetUrls, sessions): QaWorkUnit[]`
  - normalized request with `targetUrls` and `sessionDurationSeconds`

- [ ] **Step 1: Write failing backend normalization/matrix tests**

Add Node tests that assert:

```js
const normalized = normalizeQaRunRequest({
  targetUrls: ['savevidly.xyz', 'https://example.com', 'savevidly.xyz'],
  sessionDurationSeconds: 60,
  browser: 'chromium',
  sessions: 2,
  concurrency: 2,
  headless: true,
  steps: [],
});
assert.deepEqual(normalized.targetUrls, ['https://savevidly.xyz', 'https://example.com']);
assert.equal(normalized.sessionDurationSeconds, 60);

const units = buildWorkUnits(normalized.targetUrls, 2);
assert.equal(units.length, 4);
assert.deepEqual(units.map((unit) => [unit.targetUrl, unit.repetition]), [
  ['https://savevidly.xyz', 1],
  ['https://example.com', 1],
  ['https://savevidly.xyz', 2],
  ['https://example.com', 2],
]);
assert.equal(new Set(units.map((unit) => unit.workId)).size, 4);
```

Also assert legacy `{ targetUrl: 'example.com' }` becomes a one-item `targetUrls` array.

- [ ] **Step 2: Run the focused backend tests and verify RED**

Run:

```bash
node --test electron/qa-runner.test.cjs
```

Expected: FAIL because work-unit expansion and multi-target normalization do not yet exist.

- [ ] **Step 3: Implement backend normalization and work-unit expansion**

Add helpers to `electron/qa-runner.cjs`:

```js
function normalizeRunnerTarget(raw, lineNumber) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed;
  try { parsed = new URL(candidate); } catch { throw new Error(`Invalid target URL on line ${lineNumber}`); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`Invalid target URL on line ${lineNumber}`);
  return candidate;
}

function buildWorkUnits(targetUrls, sessions) {
  const units = [];
  let sessionId = 0;
  for (let repetition = 1; repetition <= sessions; repetition += 1) {
    targetUrls.forEach((targetUrl, targetIndex) => {
      sessionId += 1;
      units.push({
        workId: `target-${targetIndex + 1}-run-${repetition}`,
        targetIndex,
        targetUrl,
        repetition,
        sessionId,
      });
    });
  }
  return units;
}
```

Normalize `targetUrls` with de-duplication and max 20. Validate `sessionDurationSeconds` in the same 5–600 range. Change the desktop/iOS-emulation pool source from numeric session IDs to `buildWorkUnits(...)`. Keep Android using only the first normalized target and reject `targetUrls.length > 1` for Android in this milestone. Keep Real iOS existing single-target restrictions.

- [ ] **Step 4: Run backend tests and verify GREEN**

Run:

```bash
node --test electron/qa-runner.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit/checkpoint**

```bash
git add electron/qa-runner.cjs electron/qa-runner.test.cjs
git commit -m "feat: expand QA runs into target work units"
```

Skip the commit only if the workspace is still non-Git; keep the task checkpoint recorded.

---

### Task 3: Introduce a non-resetting SessionLifetimeController

**Files:**
- Create: `electron/session-lifetime.cjs`
- Create: `electron/session-lifetime.test.cjs`
- Modify: `electron/qa-runner.cjs`

**Interfaces:**
- Produces:

```js
createSessionLifetimeController({ context, durationMs, signal, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout })
```

Controller API:

```js
{
  startedAt,
  deadlineAt,
  durationMs,
  get expired(),
  get reason(), // null | 'duration-elapsed' | 'user-stop' | 'completed'
  remainingMs(),
  wait(ms),
  throwIfExpired(),
  markCompleted(),
  close(reason),
}
```

- [ ] **Step 1: Write failing lifetime tests**

Test that:

```js
const controller = createSessionLifetimeController({ context, durationMs: 1000, signal, now, setTimer, clearTimer });
assert.equal(controller.deadlineAt - controller.startedAt, 1000);
// navigation/new page operations do not call any reset API because none exists
await advanceClock(1000);
assert.equal(controller.reason, 'duration-elapsed');
assert.equal(context.close.mock.calls.length, 1);
```

Add a race test where STOP and deadline fire together and `context.close()` is called once. Add a wait test proving `wait(5000)` is capped to remaining lifetime and rejects/throws a named session-expired error once the deadline closes the context.

- [ ] **Step 2: Run lifetime tests and verify RED**

Run:

```bash
node --test electron/session-lifetime.test.cjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the controller**

Create `electron/session-lifetime.cjs` with a single timer started at construction. Use one internal `closePromise` for idempotent cleanup:

```js
function createSessionLifetimeController({ context, durationMs, signal, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const startedAt = now();
  const deadlineAt = startedAt + durationMs;
  let expired = false;
  let reason = null;
  let closePromise = null;

  const close = (nextReason) => {
    if (closePromise) return closePromise;
    reason = reason || nextReason;
    expired = nextReason === 'duration-elapsed';
    closePromise = Promise.resolve().then(() => context.close()).catch(() => undefined);
    return closePromise;
  };

  const timer = setTimer(() => { void close('duration-elapsed'); }, durationMs);
  const onAbort = () => { clearTimer(timer); void close('user-stop'); };
  signal?.addEventListener('abort', onAbort, { once: true });

  return {
    startedAt,
    deadlineAt,
    durationMs,
    get expired() { return expired; },
    get reason() { return reason; },
    remainingMs() { return Math.max(0, deadlineAt - now()); },
    async wait(ms) {
      const remaining = Math.max(0, deadlineAt - now());
      if (remaining <= 0) throw Object.assign(new Error('Browser session duration elapsed'), { name: 'SessionExpiredError' });
      await new Promise((resolve) => setTimer(resolve, Math.min(ms, remaining)));
      if (now() >= deadlineAt || expired) throw Object.assign(new Error('Browser session duration elapsed'), { name: 'SessionExpiredError' });
    },
    throwIfExpired() {
      if (expired || now() >= deadlineAt) throw Object.assign(new Error('Browser session duration elapsed'), { name: 'SessionExpiredError' });
    },
    markCompleted() { if (!reason) reason = 'completed'; },
    close,
  };
}
```

Ensure timer/listener cleanup occurs when `close()` or `markCompleted()` finalizes the lifecycle; do not expose any reset method.

- [ ] **Step 4: Run lifetime tests and qa-runner tests**

Run:

```bash
node --test electron/session-lifetime.test.cjs electron/qa-runner.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit/checkpoint**

```bash
git add electron/session-lifetime.cjs electron/session-lifetime.test.cjs electron/qa-runner.cjs electron/qa-runner.test.cjs
git commit -m "feat: enforce one browser context lifetime"
```

---

### Task 4: Replace selector-first dismissal with a geometry-aware Blocking Surface Resolver

**Files:**
- Create: `electron/blocking-surface-resolver.cjs`
- Create: `electron/blocking-surface-resolver.test.cjs`
- Modify: `electron/smart-interaction.cjs:175-320`
- Modify: `electron/smart-interaction.test.cjs`

**Interfaces:**
- Produces:

```js
createBlockingSurfaceResolver({ page, lifetime, log })
```

Resolver API:

```js
{
  inspect(): Promise<{ blocked: boolean; humanVerification: boolean; surfaces: SurfaceSummary[] }>,
  resolveOnce(): Promise<{ outcome: 'none' | 'dismissed' | 'human-verification-blocked'; method?: string; label?: string }>,
  resolveLoop(maxDismissals = 5): Promise<ResolveResult>,
}
```

`SurfaceSummary` contains only safe serializable diagnostics: bounding box, overlap ratio, z-index, role, accessible/visible text snippet, and whether hit-testing identifies it as topmost. Do not return DOM handles from page evaluation.

- [ ] **Step 1: Write failing custom-blocker geometry tests**

Build deterministic Playwright-like test doubles for page/frame `evaluate`, locator, keyboard, and hit-testing. Cover these cases separately:

```text
A. Custom fixed DIV covers >50% viewport and intercepts center point; nested span "Close" dismisses it.
B. Modal card is centered but X control sits outside the card on the same covering layer; resolver chooses the X.
C. Backdrop covers viewport; hit-test target is the backdrop itself and is not anchor/button/iframe/form/download; resolver may click it.
D. Backdrop contains an ad iframe/anchor at the proposed point; resolver must not click the backdrop there.
E. Surface contains "I'm not a robot" / reCAPTCHA text; resolver never clicks the verification control.
F. CAPTCHA surface has an independent safe X; resolver may click X.
```

- [ ] **Step 2: Run resolver tests and verify RED**

Run:

```bash
node --test electron/blocking-surface-resolver.test.cjs
```

Expected: FAIL because the resolver module does not exist.

- [ ] **Step 3: Implement blocker inspection with viewport geometry/hit-testing**

In the new resolver, evaluate each accessible page/frame to collect visible elements matching semantic dialogs plus fixed/sticky/absolute/high-overlap candidates. Sample viewport hit-testing at center and quarter points with `document.elementsFromPoint()`. Calculate overlap ratio from `getBoundingClientRect()` against viewport area. Candidate confidence increases when it is topmost at sampled points, receives pointer events, has modal/overlay metadata, and materially overlaps the viewport.

Do not classify small ordinary banners as blockers solely due to high z-index. Use a minimum material-overlap threshold (for example 0.20 viewport area) unless the candidate is a semantic dialog/modal that intercepts the active target.

- [ ] **Step 4: Implement safe dismissal priority**

For the highest-confidence surface, attempt in order:

```text
1. Explicit close/cancel/dismiss/skip/no-thanks/not-now/maybe-later/×/X control inside surface.
2. Adjacent/owned control with close/dismiss aria-label/title/data-close/data-dismiss/class/id metadata.
3. Small upper-right control whose metadata has close semantics.
4. Verified backdrop click only if hit-tested element is the blocker/backdrop itself and not an anchor/button/iframe/form/download/human-verification widget.
5. Escape for modal-style blockers.
```

Before any click, reject candidates whose label/metadata includes `continue`, `install`, `update`, `download`, `sponsored`, `offer`, `open`, `verify`, `robot`, `captcha`, `allow`, or purchase/checkout semantics unless the same control independently has explicit close/dismiss semantics.

- [ ] **Step 5: Integrate resolver into Smart Interaction and delete ownership of old selector-first dismissal**

`smart-interaction.cjs` should import the resolver and use one helper such as:

```js
async function resolveBlockers(page, context) {
  const result = await context.resolver.resolveLoop(5);
  if (result.outcome === 'human-verification-blocked') {
    context.log('Human verification blocks automated QA');
    const error = new Error('Human verification blocks automated QA');
    error.name = 'HumanVerificationBlockedError';
    throw error;
  }
  return result;
}
```

Invoke it during initial observation, between scroll chunks, during pauses, before locating input, before/after typing, before website action click, after navigation settles, and during remaining-session waiting. Replace direct `page.waitForTimeout` calls in Smart Interaction with `lifetime.wait` when a lifetime is provided.

- [ ] **Step 6: Add delayed/repeated blocker regression tests**

Tests must inject blocker A at scroll checkpoint 2 and blocker B later at checkpoint 5. Assert both are resolved and the real site action still executes. Add a CAPTCHA-only blocker test that logs/throws `Human verification blocks automated QA` and never records a click on the verification control.

- [ ] **Step 7: Run resolver + Smart Interaction tests**

Run:

```bash
node --test electron/blocking-surface-resolver.test.cjs electron/smart-interaction.test.cjs
```

Expected: PASS.

- [ ] **Step 8: Commit/checkpoint**

```bash
git add electron/blocking-surface-resolver.cjs electron/blocking-surface-resolver.test.cjs electron/smart-interaction.cjs electron/smart-interaction.test.cjs
git commit -m "feat: resolve blocking surfaces by geometry"
```

---

### Task 5: Bind every page/tab/window to the work-unit context lifetime

**Files:**
- Modify: `electron/qa-runner.cjs:597-825`
- Modify: `electron/qa-runner.test.cjs`

**Interfaces:**
- Consumes: `QaWorkUnit`, `createSessionLifetimeController`, `createBlockingSurfaceResolver` through Smart Interaction context.
- Produces: per-work-unit context registry and deadline-aware execution.

- [ ] **Step 1: Write failing page-lifecycle tests**

Create a fake context with `pages()`, `on('page')`, and `close()` behavior. Test:

```text
- page script opens a new page at t=20s; session deadline remains original t=60s.
- test manually adds an unrelated extra page at t=30s; it remains in the context and is closed by context.close() at t=60s.
- original page closes while an auxiliary page remains; lifetime still expires at t=60s and closes the context.
- QA-created popup during a safe action may wait briefly for domcontentloaded, close, and restore primary page without resetting the lifetime.
```

- [ ] **Step 2: Run qa-runner tests and verify RED**

Run:

```bash
node --test electron/qa-runner.test.cjs
```

Expected: FAIL on the new lifetime/tab assertions.

- [ ] **Step 3: Create context-level page registry before primary navigation**

Immediately after `browser.newContext(...)`:

```js
const pages = new Set();
context.on('page', (page) => pages.add(page));
for (const existing of context.pages()) pages.add(existing);
const lifetime = createSessionLifetimeController({
  context,
  durationMs: normalized.sessionDurationSeconds * 1000,
  signal,
});
```

Do not create or reset another timer on page navigation/new tab.

- [ ] **Step 4: Pass deadline-aware context to behavior helpers**

Extend `executeStep(page, step, context)` so Smart Interaction receives `{ lifetime, resolver, log }`; manual wait/scroll/type/navigation waits use `lifetime.remainingMs()` caps where applicable. For a raw wait step, replace `page.waitForTimeout(step.ms)` with `lifetime.wait(step.ms)`.

- [ ] **Step 5: Keep final route verification honest**

After behavior finishes, call `lifetime.throwIfExpired()` before final pooled-proxy route verification. If final verification passes, emit the interaction-route PASS event immediately, then wait only for the remaining session lifetime. If the deadline fires before final verification, emit `session-complete`/status as `incomplete` (or a dedicated `session-incomplete` event if the existing UI mapping is clearer) with message `Browser session duration elapsed before final route verification`; never emit a PASS check for a verification that did not run.

For successful early completion, keep the context open until the hard deadline by awaiting a deadline promise/remaining wait rather than closing immediately. At deadline, the controller closes the entire context.

- [ ] **Step 6: Make proxy release idempotent after context shutdown**

Keep proxy release in `finally`; ensure the controller/context close and STOP/deadline cannot double-release. Preserve current runtime failure marking only for genuine proxy/runtime failures, not for a normal duration-elapsed completion.

- [ ] **Step 7: Run runner/lifetime tests**

Run:

```bash
node --test electron/session-lifetime.test.cjs electron/qa-runner.test.cjs electron/proxy-pool-service.test.cjs
```

Expected: PASS.

- [ ] **Step 8: Commit/checkpoint**

```bash
git add electron/qa-runner.cjs electron/qa-runner.test.cjs electron/session-lifetime.cjs electron/session-lifetime.test.cjs
git commit -m "feat: bind all browser pages to one session deadline"
```

---

### Task 6: Preserve run-level STOP across active and queued work units

**Files:**
- Modify: `electron/main.cjs:88-137`
- Modify: `electron/qa-stop-ipc-contract.test.cjs`
- Modify: `electron/qa-runner.test.cjs`

**Interfaces:**
- Consumes: existing `qa:startRun`, `qa:stopRun`, run-level `AbortController`.
- Produces: STOP semantics that abort every active context and prevent queued work from starting.

- [ ] **Step 1: Write failing STOP integration tests**

Test a run with 3 targets × 2 repetitions at concurrency 2. Start two work units, keep four queued, fire run abort, and assert:

```text
- both active context.close() methods are called;
- no queued worker creates a browser context after abort;
- pool reservations for active units are released once each;
- run emits run-cancelled, not run-complete;
- no new session-start/work-start event appears after STOP.
```

- [ ] **Step 2: Run STOP/runner tests and verify RED**

Run:

```bash
node --test electron/qa-stop-ipc-contract.test.cjs electron/qa-runner.test.cjs
```

Expected: FAIL if any queued unit starts or cleanup races.

- [ ] **Step 3: Harden runPool and abort boundaries**

Ensure `runPool` checks `throwIfRunAborted(signal)` before obtaining the next item and immediately before invoking the worker. Keep `main.cjs` with exactly one run-level AbortController; `qa:stopRun` calls `controller.abort()` and waits for `currentRun.done` as it does today.

Each work unit's `SessionLifetimeController` listens to the same signal, so STOP closes its entire context. Do not add one AbortController per tab.

- [ ] **Step 4: Run STOP/runner tests and verify GREEN**

Run:

```bash
node --test electron/qa-stop-ipc-contract.test.cjs electron/qa-runner.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit/checkpoint**

```bash
git add electron/main.cjs electron/qa-stop-ipc-contract.test.cjs electron/qa-runner.cjs electron/qa-runner.test.cjs
git commit -m "fix: stop active and queued QA work atomically"
```

---

### Task 7: Update Test Runs UI for multiple targets, shared duration, and work-unit queue

**Files:**
- Modify: `src/pages/Run.tsx:48-85,95-125,285-375,400-555,798-805`
- Modify: `src/pages/TestRuns.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `normalizeTargetUrls`, `QaRunRequest.targetUrls`, `sessionDurationSeconds`, work-aware `QaEvent` fields.
- Produces: one multiline target field, one shared duration field, work queue keyed by `workId`.

- [ ] **Step 1: Write failing renderer tests**

Add tests that fill:

```text
savevidly.xyz
example.com
savevidly.xyz
```

and assert `startQaRun` receives:

```ts
expect(startQaRun).toHaveBeenCalledWith(expect.objectContaining({
  targetUrls: ['https://savevidly.xyz', 'https://example.com'],
  sessionDurationSeconds: 60,
  sessions: 2,
  concurrency: 2,
}));
```

Add tests for an invalid second line showing `Invalid target URL on line 2`. Add duration bounds tests (4 and 601 rejected). Add queue rendering tests for events:

```ts
{ workId: 'target-1-run-1', targetUrl: 'https://savevidly.xyz', repetition: 1, sessionId: 1 }
{ workId: 'target-2-run-1', targetUrl: 'https://example.com', repetition: 1, sessionId: 2 }
```

Expected labels: `savevidly.xyz · run 1` and `example.com · run 1`.

- [ ] **Step 2: Run TestRuns tests and verify RED**

Run:

```bash
npx.cmd vitest run src/pages/TestRuns.test.tsx
```

Expected: FAIL because the UI still has one target URL and numeric session-only queue state.

- [ ] **Step 3: Replace single target state with textarea state and duration**

Use:

```ts
const [targetUrlsText, setTargetUrlsText] = useState('');
const [sessionDurationSeconds, setSessionDurationSeconds] = useState(60);
const [workStates, setWorkStates] = useState<Record<string, {
  status: SessionState | 'incomplete';
  targetUrl: string;
  repetition: number;
  sessionId?: number;
}>>({});
```

Render:

```tsx
<label>
  <span>Target websites</span>
  <textarea
    aria-label="Target websites"
    value={targetUrlsText}
    onChange={(event) => setTargetUrlsText(event.target.value)}
    placeholder={'savevidly.xyz\nexample.com/path'}
    disabled={running}
  />
  <small>One website per line; http:// or https:// is optional.</small>
</label>
```

Add numeric duration input with `min={5}`, `max={600}`, default `60`, label `Browser session duration (seconds)`.

- [ ] **Step 4: Build the request from one shared configuration**

Before START:

```ts
const targetUrls = normalizeTargetUrls(targetUrlsText);
const request: QaRunRequest = {
  targetUrls,
  sessionDurationSeconds,
  browser,
  deviceMode,
  sessions,
  concurrency,
  headless,
  steps,
  privacy: privacySettings,
  proxySource,
  allowSlowProxies,
  // preserve existing iOS/Android fields
};
```

Do not generate per-target settings objects.

For Android, reject multiple normalized targets in the UI with the same backend message used in Task 2.

- [ ] **Step 5: Update event handling and queue rendering**

When a work-aware event arrives, key state by `event.workId`. Render hostname via `new URL(item.targetUrl).hostname` and repetition. Keep `sessionId` only as optional secondary/debug identity. STOP remains one button for the whole run.

- [ ] **Step 6: Add minimal styling**

Ensure the target textarea has the same panel/input visual language, a practical minimum height for 3–5 lines, and no horizontal page overflow. Keep the existing responsive structure.

- [ ] **Step 7: Run renderer tests**

Run:

```bash
npx.cmd vitest run src/shared/testRun.test.ts src/pages/TestRuns.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit/checkpoint**

```bash
git add src/shared/testRun.ts src/shared/testRun.test.ts src/pages/Run.tsx src/pages/TestRuns.test.tsx src/styles.css
git commit -m "feat: add multi-target test run UI"
```

---

### Task 8: Add work identity to events, screenshots, and summary accounting

**Files:**
- Modify: `electron/qa-runner.cjs`
- Modify: `electron/qa-runner.test.cjs`
- Modify: `src/pages/Run.tsx`
- Modify: `src/pages/TestRuns.test.tsx`

**Interfaces:**
- Consumes: `QaWorkUnit`.
- Produces: all session/log/step/privacy events carry `workId`, `targetUrl`, and `repetition`; screenshot paths are collision-safe across targets/repetitions.

- [ ] **Step 1: Write failing event identity tests**

Assert a 2-target × 2-repetition run emits four unique `session-start` events and each includes work identity. Assert screenshot file naming includes sanitized hostname or workId, for example:

```text
runs/<runId>/target-1-run-1-step-3.png
```

- [ ] **Step 2: Run runner/TestRuns tests and verify RED**

Run:

```bash
node --test electron/qa-runner.test.cjs
npx.cmd vitest run src/pages/TestRuns.test.tsx
```

Expected: FAIL because events currently identify only numeric `sessionId`.

- [ ] **Step 3: Add one emitter wrapper per work unit**

Inside the worker create:

```js
const pushWork = (event) => push({
  ...event,
  sessionId: workUnit.sessionId,
  workId: workUnit.workId,
  targetUrl: workUnit.targetUrl,
  repetition: workUnit.repetition,
});
```

Use `pushWork` for `session-start`, `session-complete`, `session-error`, `session-cancelled`, `log`, `step`, `privacy-diagnostics`, and iOS diagnostics emitted by that work unit.

- [ ] **Step 4: Count summary totals by work units**

Set `summary.total = workUnits.length`. Increment completed/failed/incomplete exactly once per work unit. Preserve `durationMs` as total run wall time.

- [ ] **Step 5: Run event/renderer tests and verify GREEN**

Run:

```bash
node --test electron/qa-runner.test.cjs
npx.cmd vitest run src/pages/TestRuns.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit/checkpoint**

```bash
git add electron/qa-runner.cjs electron/qa-runner.test.cjs src/pages/Run.tsx src/pages/TestRuns.test.tsx
git commit -m "feat: identify QA work by target and repetition"
```

---

### Task 9: Full regression, browser-health validation, and release packaging

**Files:**
- Verify all modified/new files from Tasks 1–8.
- Package only after all Windows-visible test gates pass.

**Interfaces:**
- Consumes: completed implementation.
- Produces: release candidate ZIP with correct `electron/`, `src/`, and docs paths.

- [ ] **Step 1: Run full renderer suite**

On the user's Windows project:

```powershell
npm.cmd test
```

Expected: all Vitest tests pass and all backend Node tests pass with zero failures. React `act(...)` warnings may be cleaned if they remain, but warnings must not hide failed assertions.

- [ ] **Step 2: Run production build**

```powershell
npm.cmd run build
```

Expected: exit code 0.

- [ ] **Step 3: Run browser-health smoke tests**

```powershell
npm.cmd run test:browser-health
```

Expected: Chromium, Firefox, and WebKit pass.

- [ ] **Step 4: Manual acceptance test — blocker recovery**

Use an authorized target that produces ordinary overlays. Verify the Activity Log shows geometry-aware blocker detection/dismissal and never logs a click on CAPTCHA/human-verification controls. Confirm a delayed second overlay is dismissed on a later checkpoint.

- [ ] **Step 5: Manual acceptance test — one timer owns all tabs**

Set duration to 30 seconds. During the visible run, manually open another tab in the same browser context before the deadline. Confirm the countdown does not reset and the entire context closes at approximately 30 seconds from context creation, including the manually opened tab.

- [ ] **Step 6: Manual acceptance test — auxiliary tab**

Use a safe site action that opens another tab. Confirm OrbitQA may close the QA-created auxiliary tab and return to the primary page, but the context deadline remains unchanged.

- [ ] **Step 7: Manual acceptance test — multiple targets**

Run three authorized targets with two repetitions and concurrency two. Confirm six queue entries, never more than two simultaneous contexts, identical shared settings, independent cookies/tabs, and unique work identities.

- [ ] **Step 8: Manual acceptance test — STOP**

Start a multi-target run with queued work. Press STOP while two contexts are active. Confirm all active browser windows close promptly, queued work never starts, and pooled proxy reservations are released.

- [ ] **Step 9: Manual acceptance test — proxy honesty**

For a pooled-proxy run that finishes requested behavior before deadline, confirm final interaction-route verification runs and passes before the browser remains open for the rest of its configured lifetime. Then test a deliberately short duration that expires before verification and confirm the work unit is marked incomplete with no false route PASS.

- [ ] **Step 10: Package release candidate**

Create the ZIP from the project root while preserving paths:

```bash
zip -r /mnt/data/orbitqa-blocking-surface-multitarget-session-v0.7.0.zip \
  electron src docs/superpowers/specs/2026-09-15-blocking-surface-multitarget-session-lifecycle-design.md \
  docs/superpowers/plans/2026-09-15-blocking-surface-multitarget-session-lifecycle.md \
  package.json package-lock.json vite.config.* tsconfig*.json index.html README.md
```

Then verify archive contents with:

```bash
unzip -l /mnt/data/orbitqa-blocking-surface-multitarget-session-v0.7.0.zip | sed -n '1,220p'
```

Expected: changed runtime files are under their real `electron/` and `src/` directories; no duplicate root-level runtime files.

---

## Plan Self-Review

### Spec coverage

- Multi-target normalization/limit/shared settings: Tasks 1, 2, 7, 8.
- Work-unit matrix and concurrency: Tasks 2, 8, 9.
- Non-resetting context lifetime/global tab closure: Tasks 3, 5, 9.
- STOP active + queued behavior: Task 6 and Task 9.
- Geometry/hit-test blocker resolver and safe priority: Task 4.
- Repeated/delayed blockers: Task 4 and Task 9.
- CAPTCHA non-interaction: Task 4 and Task 9.
- Auxiliary/manual tabs: Task 5 and Task 9.
- Proxy/privacy/final verification honesty: Task 5 and Task 9.
- Event identity/queue hostname/repetition: Tasks 7 and 8.
- Windows browser-health and packaging: Task 9.

### Placeholder scan

No `TBD`, `TODO`, “implement later”, or unspecified test/error-handling steps remain. Every code-producing task names files, interfaces, focused test commands, and expected outcomes.

### Type/interface consistency

- Renderer and backend both use `targetUrls`, `sessionDurationSeconds`, `workId`, `targetUrl`, `repetition`, and legacy `sessionId` only as a display/back-compat field.
- `SessionLifetimeController` has no reset method, preserving the non-resetting deadline invariant.
- Smart Interaction receives the resolver/lifetime through its execution context rather than creating independent timers.
- STOP uses the existing run-level AbortController and does not introduce per-tab abort state.
