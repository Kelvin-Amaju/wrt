# OrbitQA v0.12 URL Pool, Device Matrix, and Auto QA Reliability Design

## Goal

Replace the repeated Target/Device Group editor with a single scalable URL Pool + Device Matrix workflow, while fixing the remaining Auto QA popup and secondary-tab reliability defects without weakening proxy, WebRTC, device-consistency, timer, STOP, or safety guarantees.

## Scope

This release changes three tightly related areas:

1. Test Run configuration UX and scheduling model.
2. Auto QA popup/blocker and secondary-tab supervision.
3. Time-budgeted Auto QA execution so browsing, primary action, follow-up observation, and final integrity checks all fit within the configured session duration.

The release preserves the existing v0.11.2 network/privacy model, scalable lazy queue, automatic rotating-proxy recovery, truthful host/runtime reporting, navigation-race resilience, and adaptive Auto QA site analysis.

## Safety and truthfulness constraints

OrbitQA remains an authorized QA tool rather than an ad-engagement, anti-detection, or fake-traffic system.

- Never click advertisement bodies, sponsored CTAs, coupon/continue buttons inside promotional units, SmartLinks, or ad landing-page controls as part of simulated engagement.
- It may close an obstructing promotional overlay only through a verified dismissal control such as Close, X, Cancel, Dismiss, or No thanks.
- Never automate CAPTCHA, OTP, password, payment, checkout, account-destructive, banking, or other consequential actions.
- Never hide `navigator.webdriver`, forge CPU/GPU/memory/platform values, or claim physical-device fidelity for compatibility emulation.
- Referrer QA remains explicitly simulated and must not generate fake Google/Facebook/Pinterest search/social clicks.
- Secondary tabs must inherit the same BrowserContext and WorkUnit proxy policy. Route changes from rotating providers are reported, not hidden.

## 1. URL Pool

### 1.1 UI

Replace repeated per-target URL cards with one multiline field labeled `TARGET URL POOL`.

The field accepts one URL per line. Paste operations may contain hundreds or thousands of lines.

Below the field, show live counts:

- Valid URLs
- Duplicates removed
- Invalid entries

Invalid entries remain visible in an expandable validation list and prevent START only when no valid URL exists. Mixed valid/invalid input may run valid URLs after the user has seen the validation count.

### 1.2 Normalization

Each candidate is trimmed, empty lines are removed, and `https://` is added when a hostname-like entry omits a scheme. URLs are canonicalized for duplicate detection without rewriting meaningful path/query data.

Duplicate detection is case-insensitive for scheme/host and preserves path/query semantics.

### 1.3 Random deck selection

A run uses a shuffled-deck selector:

1. Shuffle the validated URL pool at run start.
2. Assign URLs without reuse until the deck is exhausted.
3. Reshuffle and continue when more WorkUnits remain than unique URLs.
4. Keep assignment deterministic within one run when a run seed is present so logs can be reproduced.

The UI does not materialize one card per URL or one queued object per future WorkUnit.

## 2. Device Matrix

### 2.1 Device selection

Replace repeated Device Group cards with one `DEVICE MATRIX` section containing checkboxes for supported device families:

- Desktop
- Android mobile emulation
- Local iPhone/iPad Compatibility
- Android AVD
- Real iOS Provider

Selecting a device family expands only the relevant settings for that family.

### 2.2 Desktop settings

Desktop supports multi-select browsers from the engines available in the project (Chromium, Firefox, WebKit).

Desktop configuration contains:

- Browser checkboxes
- Instances per selected browser
- Session duration seconds
- Optional per-device proxy source when Proxy Mode = Per device

Each selected browser expands into independent WorkUnits.

### 2.3 Android mobile emulation settings

Android mobile emulation exposes:

- Chrome Android browser identity
- Mobile profile checkboxes (existing supported Android profiles)
- Instances per selected profile
- Session duration seconds
- Optional per-device proxy source

Each selected profile expands independently.

### 2.4 Local iPhone/iPad Compatibility settings

Local iOS Compatibility exposes:

- Supported compatibility browser choice(s)
- iPhone/iPad profile checkboxes
- Instances per selected profile
- Session duration seconds
- Optional per-device proxy source where supported

Host/runtime limitations remain reported as Host Info and do not become false profile failures.

### 2.5 Android AVD and Real iOS Provider

AVD and provider-backed iOS keep their existing capability checks.

Unsupported proxy combinations are shown as unavailable rather than silently ignored.

### 2.6 WorkUnit generation

The matrix compiles selections into a lazy WorkUnit source rather than a fully materialized array.

Each generated WorkUnit owns:

- Assigned URL from the shuffled URL deck
- Device family/profile/browser
- Session duration
- Proxy policy/source
- Independent timer
- Browser/device context
- Diagnostics, screenshots, integrity report, and cleanup

No arbitrary app-level cap is imposed on requested URLs or requested WorkUnits. Active concurrency remains constrained by Auto Concurrency/resource protection or a positive manual concurrency value.

## 3. Proxy Mode

Add a top-level selector:

- General
- Per device

### 3.1 General

One proxy source configuration applies to every compatible WorkUnit.

The existing options such as rotating pool, static/manual source, and `Allow verified slow` remain available where already supported.

### 3.2 Per device

Each selected device-family section exposes its own proxy source controls.

The run compiler resolves the effective proxy policy per WorkUnit before launch.

### 3.3 Invariants

- Proxy-required sessions fail closed on direct fallback.
- Strict Privacy Mode WebRTC policy remains active.
- Static/manual routes are expected to retain the same verified exit IP.
- Rotating providers may change provider exit IP on new connections; such changes are logged as provider rotation rather than a false leak.

## 4. Auto QA Timer Budgeter

### 4.1 Purpose

Auto QA must use the configured session duration intentionally instead of allowing a reading pass to consume all available time or leaving the browser idle after one action.

### 4.2 Reserved phases

Before the first page action, compute a session budget with these logical phases:

1. Initial observation/downward reading
2. Fast upward return
3. Site classification
4. Primary safe action
5. Result/new-tab/blocker handling
6. Continued reading/follow-up actions when time remains
7. Final route/WebRTC integrity reserve

The final integrity reserve cannot be consumed by optional browsing.

### 4.3 Adaptive pacing

Reading speed depends on both page height and remaining discretionary time.

Long sessions use smaller scroll increments and longer reading pauses. Short sessions use larger smooth increments and shorter pauses, while preserving visible movement.

The downward pass is the reading-heavy pass. The return upward is deliberately faster so the engine can reach actionable controls before the action reserve expires.

### 4.4 Minimum viable behavior on short sessions

When the configured timer is too short for all optional behavior, prioritize:

- page observation
- one meaningful primary safe action when available
- one result observation
- final integrity checks

Log any skipped optional phase as budget-exhausted rather than pretending it ran.

## 5. Popup and Overlay Resolver

### 5.1 Problem addressed

Promotional overlays may dim the parent page while their actual Close control lives inside a nested or cross-origin iframe. A resolver that requires the blocker and control to share one document scope misses visible dismiss buttons.

### 5.2 Global blocker scan

At each blocker checkpoint, inspect:

- main document
- same-origin child frames
- cross-origin child-frame metadata available through Playwright frame APIs

Collect candidate dismissal controls by accessible name/text/role and simple icon heuristics.

Supported safe dismiss intents include:

- Close
- X
- Cancel
- Dismiss
- No thanks / Not now when clearly dismissive

Do not treat Continue, Coupon, Download, Learn more, Open, Visit, Claim, or other promotional CTAs as dismiss buttons.

### 5.3 Cross-frame association

A top-level page may be considered blocked when an overlay/iframe materially occludes the viewport even if the explicit Close control is inside the child frame.

The resolver may pair the blocking surface with the child-frame dismissal control when:

- the frame occupies a substantial visible region or is layered above page content, and
- the candidate is unambiguously dismissive.

### 5.4 Dismissal sequence

For a verified dismiss control:

1. Bring the owning page/frame into focus.
2. Move the visible pointer/touch indicator toward the control.
3. Pause briefly.
4. Activate the dismissal control once.
5. Verify that the overlay/control is gone or no longer blocks content.
6. Resume Auto QA browsing.

Never fall back to clicking the advertisement body. Promotional overlays must not use ambiguous backdrop clicking as a substitute for a real dismiss control.

### 5.5 Checkpoints

Run blocker checks:

- after initial page load
- periodically during the reading pass
- before a primary click/type action
- after navigation
- after returning from a secondary tab
- before final idle/continuation behavior

## 6. Secondary/New Tab Supervisor

### 6.1 Context inheritance

All ordinary tabs opened by a WorkUnit stay in the same BrowserContext as the primary page. This preserves the configured browser proxy and privacy policy.

### 6.2 Usable-ready state

Do not close a newly opened tab merely because one load-state wait timed out.

A tab becomes usable for observation when:

- it has a non-blank URL, and
- `document.readyState` reaches `interactive` or `complete`, and
- layout/document metrics can be read successfully.

Then attempt bounded additional settling:

- `load` when available
- bounded network-idle attempt
- short stability dwell

Network-idle failure alone is not permission to close immediately.

### 6.3 Minimum observation contract

Before automatic closure, an auxiliary tab must satisfy all applicable conditions:

- usable-ready state reached
- minimum dwell elapsed
- at least one visible content observation/scroll attempt occurred when the page is scrollable
- route/privacy verification did not detect a fatal leak/fallback

If the page is not scrollable, record that explicitly and keep the minimum dwell.

### 6.4 Reading behavior

Use a shortened timer-aware reading pass on auxiliary pages:

- gentle downward observation
- one or more pauses when time permits
- optional partial upward return when useful

Do not interact with ads or consequential controls on the auxiliary page.

### 6.5 Return to primary page

After closing the auxiliary page:

1. Bring the primary page to front.
2. Wait for a short layout/focus stabilization period.
3. Immediately run the global popup/blocker scan.
4. Dismiss a verified blocker if present.
5. Resume the remaining Auto QA plan if time remains.

## 7. Auto QA Site Behavior

The v0.11 site classifier remains, but it runs after the initial observation budget rather than before it.

### 7.1 Blog/article

- Initial page reading pass.
- Fast return toward top/navigation controls.
- Prefer recent/latest same-origin article candidates when safe.
- On article navigation, perform a new timer-aware reading pass.
- If enough discretionary time remains, use safe same-origin `Read More`, `Continue Reading`, or `Next Article` controls.

### 7.2 Tools/forms/downloaders/generators/surveys

- Observe page first.
- Return to actionable area.
- Fill ordinary safe QA fields with test values appropriate to the input type.
- Activate the related safe action once.
- Observe resulting content/page/tab.
- Continue reading when time remains.

### 7.3 Unknown/generic pages

Use browse-only behavior unless the engine finds a clearly safe non-consequential action.

## 8. Activity Log

Add clear structured lines so a user can understand why OrbitQA acted or waited.

Examples:

```text
URL pool: 428 valid · 7 duplicates removed · 2 invalid
Assigned shuffled URL: https://example.com/post
Timer budget: 41s reading · 8s action · 7s follow-up · 4s integrity reserve
Initial observation: reading toward stable bottom
Returned toward actionable area using fast upward pass
Site type detected: Downloader / Tool
Blocking overlay detected across parent page + child frame
Verified dismiss control in child frame: Close
Overlay dismissed; resumed page activity
Secondary tab detected in same BrowserContext
Secondary tab usable-ready; settling network
Secondary tab observation complete after 2 scroll movement(s)
Returned to primary page; checking blockers
Final route/privacy verification started
```

## 9. UI Layout

The normal Test Runs configuration order becomes:

1. Target URL Pool
2. Device Matrix
3. Proxy Mode
4. Behavior Mode / Auto QA options
5. Concurrency/resource settings
6. Start/Stop controls

Manual Script remains available under an Advanced section and does not clutter the default flow.

## 10. Validation Rules

START requires:

- at least one valid URL
- at least one selected device family
- at least one valid browser/profile selection inside every enabled family
- positive instances and session duration values
- valid proxy configuration for the selected Proxy Mode

Large URL pools and large requested WorkUnit counts do not fail because of product caps.

## 11. Testing Requirements

### 11.1 URL Pool

Automated tests must cover:

- hundreds/thousands of URLs accepted without app-level cap
- blank-line removal
- scheme normalization
- duplicate removal
- invalid-entry reporting
- shuffled deck covers every unique URL before reuse
- deck reshuffle after exhaustion
- deterministic assignment with a fixed run seed

### 11.2 Device Matrix and Proxy Mode

Tests must cover:

- multiple device families selected simultaneously
- multiple desktop browsers
- multiple mobile profiles
- device-valid browser/profile combinations only
- General proxy inheritance
- Per-device proxy override
- unsupported proxy combinations surfaced as unavailable
- lazy generation with very large requested counts
- STOP without materializing remaining WorkUnits

### 11.3 Popup resolver

Regression fixtures must include:

- parent-page dim overlay + child-frame `Close`
- child-frame `X`
- promotional `Continue` next to safe `Close`; only Close may be chosen
- popup appearing after returning from secondary tab
- no ad-body click fallback
- overlay verification after dismissal

### 11.4 Secondary-tab supervisor

Tests must cover:

- no closure before usable-ready state
- network-idle timeout does not trigger immediate close
- minimum dwell before closure
- at least one observation scroll when scrollable
- non-scrollable page logged and dwelled
- same BrowserContext retained
- proxy policy retained
- fatal direct fallback/WebRTC leak blocks WorkUnit
- return to primary triggers blocker re-scan

### 11.5 Timer budgeter

Tests must cover:

- short sessions use faster downward pacing and fast upward return
- long sessions use slower reading pacing
- action reserve is preserved
- final integrity reserve is preserved
- optional phases are skipped/logged when budget is insufficient
- no idle gap when safe continuation work remains

### 11.6 Existing regression suite

The full existing Node/backend suite, React/Vitest suite, TypeScript build, Vite production build, and browser-health checks must still pass before release.

## 12. Acceptance Criteria

The release is acceptable when all of the following are true:

- A user can paste a large URL list into one pool and run selected devices against randomly assigned URLs without repeated target cards.
- Device selection is checkbox-driven and only exposes compatible browser/profile controls.
- Proxy Mode can be General or Per device.
- The screenshot-class popup pattern with a visible child-frame Close control is dismissed through the Close control while the ad body remains untouched.
- A normal secondary tab is not closed before it reaches a usable-ready state and receives its minimum observation behavior.
- Returning from a secondary tab immediately re-checks and dismisses verified blockers on the primary page.
- Auto QA adapts reading speed to the timer and preserves enough time for the primary action and final integrity checks.
- No app-level URL/WorkUnit count cap is reintroduced.
- Proxy/direct-fallback/WebRTC/device-consistency protections remain intact.
- No new behavior clicks advertisements, bypasses CAPTCHA, forges fingerprint values, or fabricates organic referral traffic.
