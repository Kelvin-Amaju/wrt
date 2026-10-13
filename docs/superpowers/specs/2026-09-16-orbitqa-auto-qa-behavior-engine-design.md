# OrbitQA Auto QA Behavior Engine Design

**Date:** 2026-09-16  
**Target:** OrbitQA Desktop v0.11  
**Base:** v0.10.3 Navigation Resilience

## Goal

Replace the normal manual Behavior Script workflow with an autonomous, safety-aware QA behavior engine that inspects each visited page, classifies its interaction pattern, chooses an appropriate QA behavior plan, executes that plan at a readable pace with visible pointer/touch feedback, survives ordinary navigation and new-tab events, and keeps the existing proxy, WebRTC, device-consistency, timer, STOP, and scalable WorkUnit guarantees intact.

Manual scripting remains available under an Advanced mode.

## Non-goals and safety boundaries

OrbitQA remains an authorized QA tool. The Auto QA engine must not attempt to disguise automation or manufacture traffic/engagement signals.

It will not:

- click, tap, or intentionally hover advertisements, sponsored links, ad banners, SmartLinks, affiliate placements, or promotional popunders for engagement;
- solve or bypass CAPTCHA, anti-bot, human-verification, MFA, OTP, or account-verification challenges;
- submit payment, banking, checkout, purchase, subscription, donation, destructive, account-security, or credential-changing actions;
- type passwords, card data, banking data, government identifiers, OTPs, or other sensitive values;
- spoof `navigator.webdriver`, `navigator.platform`, GPU, CPU, memory, WebRTC candidates, canvas output, or unrelated hardware APIs;
- generate fake organic traffic through Google, Facebook, Pinterest, or other third-party services.

Referrer testing is permitted only as an explicit QA simulation. OrbitQA may set a test referrer/header where the browser/runtime supports it and must label the result as simulated. It must not search Google or social networks and click through as if a real visitor originated there.

## User experience

### Default behavior mode

The normal Test Runs workflow replaces the large Behavior Script card with a compact **Behavior Mode** card:

- `Auto QA` — default.
- `Manual Script (Advanced)` — exposes the existing visual/JSON step editor.

Auto QA exposes only high-value controls:

- **Reading pace:** Natural, Slow, Fast QA. Natural is default.
- **Referrer QA:** Direct, Simulated Google, Simulated Facebook, Simulated Pinterest, Custom test referrer.
- **Safe form actions:** enabled by default; never expands the protected-action boundary.
- **Observe new tabs:** enabled by default.

The selected mode/settings are run-wide and are copied into each WorkUnit at creation time so running WorkUnits remain immutable.

### Activity log

Auto QA logs decisions in plain language rather than low-level implementation noise. Example:

```text
Site type detected: Blog / Article
Initial observation complete
Reading scroll: 18%
Paused to inspect content
Reading scroll: 34%
Safe internal article selected: Example title
Opened internal article
New document loaded
Reading article
Blocking overlay detected
Observed overlay before dismissal
Dismissed safe close control
Returned to site home
Session route verified
AUTO QA completed
```

Unsafe or unsupported decisions must be explicit:

```text
Advertisement detected; interaction skipped
CAPTCHA detected; interaction skipped
Payment action detected; interaction skipped
Referrer QA: Simulated Google
WebRTC privacy remains verified
```

## Architecture

The feature is split into focused modules rather than expanding `qa-runner.cjs` further.

### 1. `auto-qa/site-analyzer.cjs`

Inspects the currently loaded document and returns a conservative `SiteAnalysis` object.

```js
{
  kind: 'article' | 'blog-index' | 'form-tool' | 'downloader' | 'generator' | 'search-listing' | 'survey' | 'generic' | 'unknown',
  confidence: 0..1,
  title: string,
  sameOriginLinks: [{ selectorHint, text, href, role }],
  editableFields: [{ selectorHint, type, name, label, placeholder }],
  safeActions: [{ selectorHint, text, role }],
  blockers: [{ kind, selectorHint, text }],
  adLikeElements: [{ selectorHint, text, href }],
  riskFlags: string[]
}
```

Classification uses DOM/semantic evidence only: headings, article/main landmarks, visible forms, common field/action semantics, same-origin link structure, page title, and text patterns. It does not send page content to an external AI service.

A low-confidence or contradictory page is `unknown` and receives browse-only behavior.

### 2. `auto-qa/safety-policy.cjs`

Centralizes the interaction boundary so classifiers and planners cannot independently weaken it.

It exposes predicates such as:

```js
isSafeEditableField(candidate)
isSafeAction(candidate)
isAdLike(candidate)
isVerificationChallenge(candidate)
isSensitiveOrConsequential(candidate)
```

Existing protected patterns from Smart Interaction and blocking-surface handling are reused and extended. All Auto QA clicks/types pass through this policy.

### 3. `auto-qa/behavior-planner.cjs`

Converts `SiteAnalysis`, remaining session time, device mode, and Auto QA settings into an `AutoQaPlan`.

The planner is deterministic per WorkUnit seed so behavior is varied but testable.

Plans are short-lived. After a meaningful navigation, the page is re-analyzed and a new plan is produced rather than assuming the old DOM still exists.

Examples:

- **Blog index:** observe -> reading scroll -> choose a safe same-origin recent/article link -> open -> re-analyze.
- **Article:** observe -> several reading-paced scroll segments -> optionally return to site home/logo if enough timer remains.
- **Form/tool/downloader/generator:** observe -> browse first -> choose one safe ordinary field -> type QA value -> choose a directly related safe action -> submit/click once -> re-analyze result.
- **Survey:** observe -> only ordinary non-sensitive controls with neutral QA values; no identity, financial, account, or protected fields; submit only when the action is clearly non-consequential.
- **Generic:** observe -> reading/browsing scroll -> optional safe same-origin navigation.
- **Unknown:** browse-only; no typing or submitting.

### 4. `auto-qa/reading-driver.cjs`

Provides human-readable pacing without pretending to be human.

Natural pace uses:

- small scroll segments rather than fixed percentage jumps;
- variable pauses centered around roughly 2 seconds during content reading;
- longer pauses around headings, visible forms, and major navigation transitions;
- visible pointer movement on desktop and visible touch feedback on mobile;
- no anti-detection timing logic.

The existing `qa-pacing.cjs`, `scroll-surface-driver.cjs`, and interaction indicator remain sources of timing/scroll primitives where appropriate.

### 5. `auto-qa/navigation-supervisor.cjs`

Owns document transitions during Auto QA.

Responsibilities:

- detect same-tab navigation and SPA transitions;
- recover from `Execution context was destroyed` using the v0.10.3 navigation-resilience rules;
- detect newly opened tabs/pages;
- wait for safe new tabs to settle rather than closing them instantly;
- analyze and lightly browse an ordinary new tab when it is part of a safe site action;
- never interact with ad/promotional tabs;
- close or return from observed auxiliary tabs after a bounded observation window;
- return focus to the original WorkUnit page when possible;
- never replay a click or form submission after navigation if that could duplicate side effects.

### 6. `auto-qa/blocker-observer.cjs`

Wraps the existing blocking-surface resolver with an observation phase.

When a blocking overlay appears:

1. identify whether it is safe to dismiss;
2. wait briefly so the overlay is observable in the run;
3. move the visible pointer/touch indicator toward the close/dismiss control;
4. dismiss only a safe, explicit close/cancel/not-now control;
5. continue the plan.

CAPTCHA, verification, ad/promo overlays, payment dialogs, account dialogs, and ambiguous surfaces are not auto-dismissed by risky controls. Ad-like overlays may be recorded and left alone unless they expose an unambiguous non-ad `Close`/`X` dismissal control that only removes the obstruction.

### 7. `auto-qa/referrer-simulation.cjs`

Implements QA-only referrer simulation.

Modes:

- Direct — no simulated referrer.
- Simulated Google — uses a fixed documented Google test referrer value.
- Simulated Facebook — fixed Facebook test referrer value.
- Simulated Pinterest — fixed Pinterest test referrer value.
- Custom — validated `https://` URL supplied by the tester.

The renderer and logs always label non-direct modes as **Simulated**. The module must never automate third-party search/social sites to produce the referrer.

Where a browser engine cannot apply a requested referrer consistently, the WorkUnit reports `NOT APPLICABLE` or `WARNING` rather than forging browser state.

### 8. `auto-qa/auto-qa-engine.cjs`

Coordinates analyzer -> policy -> planner -> drivers -> navigation supervisor until the WorkUnit timer no longer has enough time for another meaningful action.

The engine receives:

```js
runAutoQa({
  page,
  context,
  workUnit,
  settings,
  lifetime,
  log,
  interactionIndicator,
  signal
})
```

It returns a structured report containing detected site kinds, actions attempted/completed/skipped, navigation count, new-tab observations, blocker observations, and terminal reason.

The engine checks STOP/session expiry before and after every wait or interaction.

## Site behavior rules

### Blogs and article sites

The engine first browses the current page. On a blog index/home page it may choose a visible same-origin article/recent-post link. It must prefer semantic article links and avoid ads, sponsored cards, external domains, account links, and category/navigation loops.

On an article page it performs multiple small reading scrolls with pauses. If meaningful time remains, it may use a same-origin Home link or logo and continue browsing.

### Forms, tools, downloaders, generators, and temp-mail style utilities

The engine always observes/browses before interacting. It may fill an ordinary text/email/URL/search field using harmless QA values selected by field semantics. It may invoke a clearly related non-consequential action such as Search, Generate, Convert, Check, Submit test form, or Download test output when the action is within the safety policy.

It must not upload arbitrary local files unless the test plan explicitly provides a safe fixture in a future feature. File inputs are skipped in v0.11.

### Surveys

Survey behavior is conservative. It may interact with generic, non-sensitive survey controls using neutral QA values only when labels/options are available and the submission has no account, payment, identity-verification, or other consequential effect. Otherwise it records the controls and remains browse-only.

### Unknown and unsupported pages

Unknown pages are not guessed aggressively. OrbitQA browses, records visible structure, resolves safe blockers, and captures diagnostics without submitting actions.

## Advertisement and promotional-content handling

Ad-like detection includes common semantic indicators such as `advertisement`, `sponsored`, known ad iframe/container patterns, external promo cards, and overlay copy. Detection is heuristic and is reported as such.

Auto QA must not deliberately click/tap ads or sponsored content, and must not intentionally hover ads to simulate organic engagement. The visible pointer/touch path avoids ad-like elements when possible.

If an ad opens a tab because of a site event outside OrbitQA's direct action, the navigation supervisor may wait for the tab to settle, record its URL/title when safely available, and close/return without scrolling or interacting with the advertisement.

## Timer and pacing behavior

The WorkUnit session timer remains authoritative.

Before starting each planned action the engine estimates whether the remaining time is sufficient. Near expiry it stops initiating navigation or form actions and returns to passive observation/cleanup.

Natural reading pace uses bounded jitter and deterministic WorkUnit seeding so automated tests can assert ranges. Typical content pauses are approximately 1.4-2.8 seconds, with occasional longer observation pauses. The exact distribution is implementation-defined but may not be a fixed repeating pattern.

## Proxy, WebRTC, privacy, and device consistency

Auto QA does not weaken any existing gate.

The existing order remains:

1. launch browser/device context;
2. verify required proxy route;
3. navigate to target;
4. run Privacy & Network Check;
5. run Device Identity/Profile Consistency;
6. only then start Auto QA;
7. re-verify route/session integrity after behavior;
8. keep the WorkUnit open until its own timer ends unless blocked/failed/stopped.

If Strict Privacy Mode blocks the WorkUnit, Auto QA never starts.

## Navigation resilience

All page-dependent Auto QA primitives use the v0.10.3 navigation-resilience contract.

Safe idempotent observation operations may retry once after a document transition. Potentially side-effecting clicks/types/submissions are never replayed blindly. The engine re-analyzes the resulting document instead.

Repeated navigation churn, closed pages, browser crashes, STOP, privacy blocks, and expired timers remain terminal or controlled outcomes rather than being hidden.

## Data model

Add a run-wide settings object:

```ts
type BehaviorMode = 'auto' | 'manual';
type ReadingPace = 'natural' | 'slow' | 'fast';
type ReferrerMode = 'direct' | 'google-simulated' | 'facebook-simulated' | 'pinterest-simulated' | 'custom-simulated';

interface AutoQaSettings {
  behaviorMode: BehaviorMode;
  readingPace: ReadingPace;
  safeFormActions: boolean;
  observeNewTabs: boolean;
  referrerMode: ReferrerMode;
  customReferrer?: string;
}
```

The existing manual `steps` array remains unchanged for backward compatibility and is used only when `behaviorMode === 'manual'`.

## UI changes

`TestRuns.tsx` will:

- default new runs to `Auto QA`;
- replace the current Behavior Script panel with a compact Auto QA card;
- show the existing step editor only after selecting `Manual Script (Advanced)`;
- display Reading Pace, Referrer QA, Safe form actions, and Observe new tabs controls in Auto mode;
- show `SIMULATED` beside every non-direct referrer mode;
- keep START/STOP placement and run console unchanged;
- preserve settings while a run is idle and freeze them while running.

## Error handling

Auto QA failures are classified:

- **blocked:** privacy/network policy, CAPTCHA/human-verification when the requested action depends on it, or protected consequential action;
- **skipped:** unsafe/ambiguous candidate, ad/promo, unsupported field/action, insufficient remaining timer;
- **recovered:** ordinary DOM detach/navigation race recovered by re-analysis;
- **failed:** browser/page crash, unrecoverable repeated navigation churn, invalid internal plan, or runner infrastructure error.

A skipped action does not fail the WorkUnit. A blocked protected action stops only the unsafe branch; if safe browsing can continue, the WorkUnit continues unless an existing strict privacy/network gate requires failure.

## Testing strategy

### Unit tests

Add focused Node tests for:

- site classification for article/blog, form tool, downloader/generator, survey, generic, and unknown fixtures;
- safety-policy rejection of ads, sponsored links, CAPTCHA, password/payment/account/destructive controls;
- planner outputs for each site kind and remaining-time boundary;
- deterministic reading-pacing ranges;
- referrer-mode validation and explicit simulated labeling;
- navigation supervisor behavior for same-tab navigation, SPA transitions, new tabs, ad-like tabs, and repeated churn;
- blocker observation/dismissal timing and unsafe-overlay skipping;
- STOP/session-expiry checks between actions;
- no replay of side-effecting actions after navigation.

### Runner integration tests

Extend `qa-runner.test.cjs` to prove:

- Auto QA is default when settings are omitted by the UI;
- manual scripts still execute unchanged when selected;
- Auto QA starts only after privacy/device diagnostics pass;
- strict privacy failure prevents Auto QA;
- session integrity still runs after Auto QA;
- new-tab observation returns to the primary page;
- Auto QA operates independently in concurrent WorkUnits.

### Renderer tests

Extend `TestRuns.test.tsx` to prove:

- Auto QA card renders by default;
- manual script editor is hidden until Advanced/manual is selected;
- simulated referrer labels are visible;
- custom referrer rejects invalid/non-HTTPS values;
- running state disables behavior-setting changes.

### Live Windows acceptance

One combined live run should cover Desktop Chromium, Pixel 7 emulation, and iPhone 13 compatibility against controlled/public QA-safe pages representing:

- article/blog navigation;
- ordinary form/tool interaction;
- a popup/blocking overlay fixture;
- same-origin link/new-tab handling;
- proxy + Strict Privacy Mode.

Acceptance requires:

- no privacy/device regression;
- visible pointer/touch feedback;
- readable-paced scrolling rather than fixed fast sweeps;
- no automated ad/sponsored interaction;
- no CAPTCHA/protected-action interaction;
- route integrity verified after behavior;
- independent WorkUnit timers and STOP unchanged.

## Compatibility and migration

Existing saved/manual step definitions remain valid. Runs without an explicit behavior mode from older renderer state are normalized to `manual` only when legacy steps are supplied; new UI-created runs explicitly send `auto`.

No database migration is required because current run configuration is transient.

## Versioning

This feature is a major behavior-flow change and should ship as **v0.11.0**, based on v0.10.3 plus any subsequently verified v0.10.x fixes required during implementation.
