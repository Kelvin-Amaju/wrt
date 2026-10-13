# OrbitQA Blocking Surface Resolver, Global Session Timer, and Multi-Target Design

## Purpose

Upgrade OrbitQA desktop QA runs so intrusive overlays no longer stall normal authorized page interaction, every tab/window in a browser session obeys one hard session deadline, and one run can test multiple target URLs with the same browser, proxy, privacy, behavior, and timing settings.

This design replaces the current selector-first overlay dismissal approach with a geometry-aware **Blocking Surface Resolver**. It does not add ad blocking, CAPTCHA solving, stealth fingerprinting, bot-detection bypasses, or random ad clicking. Ads and page scripts load normally. OrbitQA may dismiss a covering surface only through a safe close/cancel/backdrop path so the underlying authorized QA task can continue.

## Scope

This milestone contains three connected changes:

1. Blocking Surface Resolver for desktop Playwright runs and Local iOS Compatibility runs.
2. One global browser-session timer that owns every tab/window in that Playwright context.
3. Multi-target runs where all target URLs share one settings profile and one behavior script.

Real iOS provider runs remain outside Smart Interaction support. Android keeps its current one-device limitation; multi-target scheduling for Android is deferred until the desktop architecture is proven because Android browser lifecycle differs from Playwright desktop contexts.

## User Experience

### Multiple target websites

The single `Target website` input becomes a `Target websites` multiline field. Users can enter one URL per line, for example:

```text
savevidly.xyz
example.com/path
https://example.org
```

Each line is normalized independently. A missing scheme becomes `https://`; an existing `http://` or `https://` is preserved. Blank lines are ignored. Duplicate normalized targets are removed while preserving first-entry order.

The same settings apply to every target. OrbitQA does not expose per-link browser, proxy, privacy, session, timer, or behavior overrides.

Initial limit: **20 target URLs per run**. This keeps the job matrix bounded and matches the existing session cap philosophy.

### Browser session duration

Add a shared `Browser session duration` field expressed in **seconds**. Professional default: **60 seconds**. Allowed range: **5–600 seconds**.

The timer is a hard lifetime for one browser context, not for one page URL. It starts when that browser context is created and continues regardless of:

- which tab is active;
- whether the original target navigated elsewhere;
- whether the site opens a popup/new tab;
- whether the user manually opens another tab in the same context;
- whether OrbitQA is currently scrolling, waiting, typing, or clicking.

At the deadline OrbitQA closes the entire browser context, which closes every page/tab/window owned by that context. It must not wait for the browser to return to the original URL.

If the normal QA behavior and final route verification finish before the deadline, the browser remains open for the remaining duration and then the context closes at the deadline. If the deadline expires while behavior is still running, OrbitQA immediately closes the context. In that case the session is reported as duration-ended/incomplete rather than pretending all requested behavior and final route verification completed.

The existing `STOP QA TEST` control remains an immediate override: STOP closes active contexts immediately instead of waiting for the duration timer.

### Multi-target execution model

For desktop and Local iOS Compatibility, a run expands into independent work units:

```text
work units = target URLs x sessions
```

Example: 3 target URLs and 2 sessions = 6 work units. `Concurrency` continues to cap simultaneous browser contexts at 5.

Each work unit receives the same:

- browser/device configuration;
- behavior steps;
- Strict Privacy Mode setting;
- proxy-source configuration;
- verified-slow opt-in;
- session duration.

Each work unit gets its own browser context, proxy allocation, timer, screenshots, and route verification. This prevents one target's tabs/cookies/navigation from contaminating another target.

Activity rows and session queue entries include the target hostname so the user can tell which URL each browser belongs to.

## Blocking Surface Resolver

### Problem with the current implementation

The existing Smart Interaction code looks primarily for known close selectors and exact close text. Real ad/promo blockers can use custom nested `div`/`span` controls, a close icon positioned outside the dialog, a backdrop separate from the content card, delayed injection during scrolling, or a child frame. A selector list cannot robustly model all of those layouts.

### Resolver model

The resolver first identifies **what is physically blocking the viewport**, then looks for a safe way to dismiss that specific surface.

For each page and accessible child frame, OrbitQA collects candidate blocking surfaces using DOM geometry and hit-testing. Signals include:

- `dialog`, `[role=dialog]`, `[aria-modal=true]`;
- fixed/sticky/absolute elements with high viewport overlap;
- large backdrops covering the viewport;
- topmost elements returned by `elementsFromPoint()` at several viewport sample points;
- high z-index and pointer-receiving layers;
- modal/popup/overlay/backdrop class or id patterns as supporting evidence, not the sole requirement.

A candidate must be visible and materially cover/intercept the page. Small ordinary banners or page content are not treated as blockers merely because they have a high z-index.

### Safe dismissal priority

For the highest-confidence blocker, OrbitQA tries these paths in order:

1. Explicit semantic dismiss control inside the blocker: `Close`, `Cancel`, `Dismiss`, `Skip`, `No thanks`, `Not now`, `Maybe later`, `×`, `X`.
2. Icon/control metadata inside or adjacent to the blocker: `aria-label`, `title`, `data-close`, `data-dismiss`, close/cancel class/id patterns.
3. A small clickable control in the blocker's upper-right region when its accessible name/metadata indicates close/dismiss semantics.
4. A verified **backdrop click** only when hit-testing shows the clicked element is the blocker/backdrop itself and is not an anchor, button, iframe, form control, download control, or human-verification widget.
5. `Escape` as a last safe fallback for modal-style blockers.

OrbitQA does not click arbitrary page coordinates and does not intentionally click advertisements, sponsored offers, install/update/download-ad buttons, or promotional `Continue` buttons to clear the page.

### CAPTCHA / human-verification handling

If a blocking surface contains a human-verification challenge such as `I'm not a robot`, CAPTCHA/reCAPTCHA/hCaptcha/Turnstile wording, OrbitQA must **not click the verification control**. It may still dismiss the surrounding ad/modal through an independent safe close/X/backdrop path. If no safe dismissal exists, it logs `Human verification blocks automated QA` and treats Smart Interaction as blocked rather than impersonating a human.

### Continuous resolver loop

The resolver is not a one-shot precheck. Smart Interaction invokes it:

- during initial page observation;
- between every incremental scroll chunk;
- during deliberate pauses;
- before locating an input;
- before and after progressive typing;
- immediately before clicking the intended site action;
- after a click/navigation settles;
- during the remaining session-duration wait.

The loop is bounded so pathological pages cannot create an infinite dismiss cycle. Default per-check cap: 5 dismissals; repeated checks occur throughout the session.

### Auxiliary tabs and windows

The browser context owns every page created during a work unit.

OrbitQA registers a context-level page listener as soon as the context starts. It records all pages, including tabs opened by site scripts, Smart Interaction, or the user.

For an auxiliary page clearly created as a side effect of OrbitQA's safe backdrop/action attempt, OrbitQA waits briefly for `domcontentloaded` (bounded timeout), closes that auxiliary page, and brings the primary target page back to the front if it still exists.

For user-opened or otherwise unrelated tabs, OrbitQA does not need to guess why they were opened. They remain members of the same context and therefore share the same global session timer. At deadline, `context.close()` closes all of them together.

If the original target page closes but another page in the context remains, the timer still owns the context. OrbitQA does not extend or reset the deadline because focus changed.

## Global Session Timer Architecture

Create a per-work-unit `SessionLifetimeController` in the main runner. It records:

```ts
interface SessionLifetime {
  startedAt: number;
  deadlineAt: number;
  durationMs: number;
  expired: boolean;
}
```

The deadline timer is created immediately after the Playwright browser context is available. The controller receives the run-level abort signal and can end for two reasons:

- `user-stop`: run AbortController fires;
- `duration-elapsed`: session deadline fires.

On either reason it closes the whole context. Cleanup must be idempotent so a simultaneous STOP and timer event cannot double-close or leak a proxy reservation.

Behavior helpers use deadline-aware waits instead of unbounded waits. Any long `waitForTimeout`, navigation wait, overlay watch, scroll pause, or popup-load wait is capped to the remaining session time.

The timer never resets on navigation or tab creation.

## Privacy and Proxy Semantics

Proxy configuration is attached to the browser context/work unit, so auxiliary tabs inherit the same proxy path. Strict Privacy Mode is installed at context scope so new pages inherit the guard.

For pooled proxies:

1. allocate and verify proxy before target navigation;
2. run privacy diagnostics;
3. execute behavior;
4. perform final interaction-route verification as soon as requested behavior completes;
5. if verification passes before the deadline, keep the browser open only for the remaining configured duration;
6. when the timer ends, close the full context and release the proxy reservation.

If the timer expires before final route verification can complete, OrbitQA must close the context and mark the work unit **incomplete**. It must not claim `Interaction route verification PASS` when that check never happened.

The session timer never causes direct-network fallback. Existing fail-closed proxy behavior remains unchanged.

## Renderer and IPC Changes

### Shared request contract

Evolve the request shape from one target to an array:

```ts
interface QaRunRequest {
  targetUrls: string[];
  sessionDurationSeconds: number;
  // existing shared settings remain unchanged
}
```

For one migration release, the backend may accept legacy `targetUrl` and convert it to a one-item array so existing tests/callers remain compatible. The renderer sends `targetUrls` only.

### Event identity

A work unit needs stable identity independent of the old numeric session index:

```ts
interface QaWorkUnit {
  workId: string;
  targetIndex: number;
  targetUrl: string;
  repetition: number;
}
```

Events include `workId` and `targetUrl`; `sessionId` may remain as a numeric display sequence for backwards-compatible UI rendering.

### Test Runs UI

Replace the target text input with a textarea and helper text: `One website per line; http:// or https:// is optional.`

Add one shared `Browser session duration` numeric field labeled in seconds.

The queue shows target hostname plus repetition, for example:

```text
savevidly.xyz · run 1
example.com · run 1
savevidly.xyz · run 2
```

START/STOP remain one pair for the entire run. STOP cancels every active work unit and prevents queued units from starting.

## Error Handling

A malformed target line prevents the run from starting and identifies its line number.

The run fails or marks a work unit incomplete when appropriate for:

- no eligible proxy;
- browser/context launch failure;
- required privacy/proxy verification failure;
- target navigation failure;
- human-verification blocker with no safe dismiss path when it prevents the requested interaction;
- session timer expires before required final verification;
- user STOP.

Overlay absence is not an error. Failure to dismiss a non-blocking promotional element is not an error. OrbitQA only treats a surface as blocking when hit-testing/geometry shows that it intercepts the QA flow.

## Testing Strategy

Implementation follows TDD. New tests must include:

1. target-list normalization accepts bare domains, preserves schemes, removes blanks/duplicates, and reports invalid line numbers;
2. 3 targets x 2 sessions creates 6 work units and respects concurrency;
3. every work unit receives the same browser/proxy/privacy/behavior/timer settings;
4. global deadline does not reset when navigation or focus changes;
5. a new tab opened by page script shares the deadline and is closed by context shutdown;
6. a manually-created extra page in the test double is also closed when the timer expires;
7. automation-created popup can settle briefly, close, and restore the primary page without resetting the timer;
8. STOP closes all pages/context, stops queued work, and releases static/rotating reservations;
9. blocker detection finds a custom div/modal with no normal button element;
10. blocker detection finds a close/X control outside the modal card but on the same covering layer;
11. safe backdrop click works only for a non-navigational blocker/backdrop element;
12. random anchors/buttons/ad iframes are never used as backdrop fallbacks;
13. delayed blocker injected during scrolling is resolved on the next scroll checkpoint;
14. a second blocker appearing later is resolved again;
15. CAPTCHA/human-verification control is never clicked, while an independent surrounding X may still dismiss the surface;
16. if no safe CAPTCHA dismissal exists, Smart Interaction logs the block instead of pretending success;
17. final proxy route verification remains required when behavior completes before deadline;
18. deadline expiry before final verification marks the work unit incomplete, never PASS;
19. full existing Vitest/backend suites stay green;
20. Chromium/Firefox/WebKit browser-health smoke tests pass on the user's Windows environment.

## Safety / Non-Goals

This milestone does not add:

- CAPTCHA solving or clicking `I'm not a robot`;
- anti-bot evasion or stealth fingerprint spoofing;
- intentional ad/sponsored-offer clicks;
- random coordinate clicking across arbitrary page content;
- fake hardware/browser/WebRTC identities;
- per-target settings profiles;
- background traffic generation after the configured QA session ends.

The goal is deterministic authorized QA that can recover from ordinary intrusive UI while keeping the run transparent, bounded, and privacy-verifiable.

## Acceptance Criteria

The feature is accepted when:

- the user can paste multiple target URLs and run them with one shared configuration;
- each target/session combination gets an isolated browser context and one non-resetting session deadline;
- every page in that context closes when the deadline fires, regardless of active tab or URL;
- STOP closes active contexts immediately and prevents queued contexts from starting;
- a blocking overlay is identified from viewport interception/geometry rather than only selector text;
- safe close/X/backdrop dismissal can occur repeatedly throughout scrolling and interaction;
- human-verification controls are never automated;
- auxiliary tabs created by QA actions are closed and the primary page is restored when possible;
- ads remain loadable and no request-level ad blocker is introduced;
- final route verification remains honest and fail-closed;
- all automated regressions and Windows browser-health checks pass before release packaging.
