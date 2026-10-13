# OrbitQA Scalable Execution, WebRTC Privacy, and Device Consistency Design

## Goal

Remove arbitrary run-size limits while keeping OrbitQA stable under large workloads, strengthen WebRTC/privacy enforcement, and make device-consistency results distinguish controllable profile correctness from immutable host/runtime facts without spoofing browser fingerprints or hiding automation.

## Scope

This release changes three existing subsystems together because they interact at runtime:

1. Matrix scheduling and queueing.
2. Strict privacy / WebRTC protection.
3. Device-consistency classification and presentation.

Android AVD reliability remains deferred. Real iOS provider limits remain provider-driven.

## Safety and truthfulness constraints

- OrbitQA must not patch or falsify `navigator.webdriver`, `navigator.platform`, GPU, CPU, memory, sensors, canvas, audio, or unrelated hardware/browser APIs to look "undetectable".
- Device profiles may configure legitimate browser-context options that Playwright/browser engines support: UA, viewport, screen, DPR, touch emulation, locale, timezone, orientation, browser selection.
- Host/runtime facts that cannot be made truthful in compatibility emulation are reported as host/runtime information, not treated as a profile defect.
- Strict Privacy Mode must prefer prevention over post-hoc warning where the browser engine offers a supported control, then verify the resulting runtime state.
- A required proxy route must never silently fall back to the host direct route.

## 1. Scalable run model

### User-visible behavior

- Remove the `20 instances/group` limit.
- Remove the `50 work units/run` limit.
- Remove the `concurrency <= 5` product limit.
- Preserve explicit incompatibility rules that reflect actual resources, e.g. a single named Android AVD cannot be occupied by overlapping work units.
- Keep target/group count limits only if they are UI-structure limits, not workload limits. For this release the existing 20-target / 12-group limits remain unchanged to avoid an unrelated editor redesign.

### Lazy work-unit generation

OrbitQA must not expand every requested instance into a giant in-memory array before execution. Replace eager expansion with a work-plan descriptor plus a lazy iterator/queue source.

Required interfaces:

```js
countWorkUnits(request) -> integer
iterateWorkUnits(request) -> iterator<QaWorkUnitDescriptor>
runWorkUnitQueue(source, options, worker, signal) -> Promise<summary>
```

`countWorkUnits` computes totals without materializing units. `iterateWorkUnits` yields immutable descriptors one at a time. The queue owns only pending metadata needed for the current scheduling window.

### Concurrency modes

The run request supports:

```ts
type QaConcurrencySetting =
  | { mode: 'auto' }
  | { mode: 'manual'; value: number };
```

For backward compatibility, a numeric `concurrency` from older saved UI state is normalized to manual mode.

Manual concurrency accepts any positive integer, but the scheduler never launches more workers than total work units and still respects per-resource exclusivity rules.

Auto concurrency is computed at run start from host resources. Initial policy:

- reserve at least 1 logical CPU for the desktop/UI;
- estimate 1 browser worker per 2 logical CPUs;
- cap the estimate by available-memory budget using a conservative per-worker allowance;
- minimum 1 worker;
- recompute only between work-unit launches, never kill a healthy active worker merely because transient load rises.

The exact memory thresholds live in one policy module so they can be tuned without changing queue code.

### Resource pressure guard

Before starting another queued WorkUnit, the scheduler checks host resource pressure through a provider abstraction:

```js
getResourceSnapshot() -> {
  freeMemoryBytes,
  totalMemoryBytes,
  cpuLoadFraction
}
```

If pressure is above the configured high-water mark, launching pauses. Active WorkUnits continue. When pressure falls below the resume threshold, queue consumption continues.

There is no arbitrary maximum requested count. Very large requests remain queued and process over time.

### Queue metrics

Run summary and UI expose:

- requested
- running
- queued
- completed
- failed
- cancelled
- incomplete

Counters are derived from scheduler events rather than from a fully materialized WorkUnit array.

## 2. WebRTC privacy policy

### Strict Privacy Mode behavior

Strict Privacy Mode applies a supported browser-level WebRTC restriction before target navigation when available. The implementation must be engine-specific and feature-detected; unsupported controls are not silently claimed.

The privacy report distinguishes:

- `prevented` — supported control applied and runtime verification shows no disallowed direct-IP candidate;
- `verified-no-leak` — no disallowed candidate observed, but no stronger prevention primitive is available;
- `unsupported` — WebRTC API is unavailable in that runtime;
- `exposed` — direct host/public IP appeared in a candidate while a required proxy is active;
- `indeterminate` — verification could not complete.

### Verification

OrbitQA gathers ICE candidates after page launch using its existing privacy probe. When a proxy is required:

- direct public host IP in a literal candidate => blocking failure;
- proxy exit IP or non-public/local candidates may be reported but are not rewritten;
- inability to verify because the browser API is unavailable => `not-applicable`/`unsupported`, not false PASS;
- inability to verify because an expected verification operation failed => warning or failure according to whether the route is required.

### No WebRTC spoofing

OrbitQA does not rewrite candidates, fabricate IPs, patch `RTCPeerConnection`, or hide API existence to simulate a physical device. Prevention must rely on browser-supported launch/context policy only.

## 3. Device consistency model

### Separate profile correctness from runtime disclosure

Each device report contains two categories:

**Profile consistency checks** — values OrbitQA deliberately configured and can validate:
- browser/mobile UA family;
- viewport;
- screen geometry when supported by the selected browser descriptor;
- DPR;
- touch emulation requested by the browser context;
- locale;
- timezone;
- orientation/browser identity.

**Runtime disclosure facts** — observations OrbitQA does not forge:
- `navigator.webdriver`;
- host `navigator.platform` in compatibility emulation;
- CPU count;
- device memory;
- GPU/sensor availability when later added;
- WebKit-on-Windows touch-reporting limitations.

Runtime disclosure facts never downgrade the top-level *Profile Consistency* status merely because compatibility emulation exposes the host.

### iOS compatibility functional verification

Local iOS compatibility must not equate `navigator.maxTouchPoints === 0` with broken interaction. Add an active functional touch/tap test using the same interaction path OrbitQA uses for mobile QA. Report:

- `iOS Functional Compatibility: PASS/FAIL`
- `Physical iPhone Fidelity: NOT APPLICABLE`

Host `Win32`, `navigator.webdriver`, and `maxTouchPoints` remain visible in a separate `Host/runtime information` section.

### Android browser emulation

Android mobile emulation remains compatibility emulation. UA, viewport, DPR, requested touch context, locale, timezone, and functional mobile interaction are strict profile checks. Host platform / automation disclosure remain host/runtime information.

### Desktop

Desktop uses browser-native UA/platform/hardware values. No mobile-only identity requirement applies.

## 4. Session integrity integration

`Session & Network Integrity` consumes only the top-level *Profile Consistency* result for its `Device consistency` line. Host/runtime disclosure notes do not turn the network-integrity card into WARNING.

A session can therefore be:

```text
Profile Consistency: PASS
Host/runtime information: compatibility limitations present
Session & Network Integrity: VERIFIED
```

Actual controllable mismatches still produce WARNING/FAIL and propagate into session integrity.

## 5. Validation and failure handling

- Requested instance counts must be positive integers; there is no product maximum.
- Manual concurrency must be a positive integer; there is no product maximum.
- The scheduler clamps active workers to the number of remaining work units and resource/exclusivity constraints.
- Extremely large counts must not freeze the renderer; UI inputs use numeric text handling that does not generate WorkUnits during typing.
- STOP aborts active workers, prevents new launches, and cancels all remaining lazy queue items without enumerating them individually.
- Run summaries remain accurate after STOP even when millions of work units were requested.

## 6. Testing strategy

### Scheduler

- 51, 500, and 50,000 requested WorkUnits normalize without arbitrary-limit errors.
- Lazy iterator yields correct first/middle/final descriptors without prebuilding all units.
- Manual concurrency above 5 is honored subject to requested total and resource guard.
- Auto concurrency returns a positive bounded worker count from mocked CPU/memory snapshots.
- Resource high-water pauses launches and resume threshold restarts them.
- STOP cancels a huge lazy queue without materializing it.
- AVD exclusivity validation remains enforced.

### Privacy/WebRTC

- Strict policy reports prevention when a supported engine control is applied.
- Direct host/public IP candidate with required proxy blocks the WorkUnit.
- No literal/direct leak produces PASS.
- Unsupported WebRTC is reported honestly, not as a fabricated PASS.

### Device consistency

- iOS compatibility with correct UA/viewport/DPR but `Win32`, `webdriver=true`, and `maxTouchPoints=0` yields `Profile Consistency: PASS` plus host/runtime notes.
- Active iOS tap-functional check failure produces FAIL.
- Android emulation with wrong mobile UA/viewport/DPR or failed functional touch remains a real mismatch.
- Desktop runtime observations remain informational unless a configured expectation is violated.

### Renderer

- Instance input accepts values above 20.
- Run counter displays large totals without generating huge arrays.
- Concurrency supports Auto and manual values above 5.
- Queue metrics render Requested/Running/Queued/Completed/Failed/Cancelled.
- Device Identity panel separates Profile Consistency from Host/runtime information.

## 7. Compatibility and migration

- Existing saved requests with numeric `concurrency` remain valid and normalize to manual mode.
- Existing matrix groups remain valid; only arbitrary maximum checks are removed.
- Existing proxy, session timer, STOP, Smart Interaction, and screenshot behavior remain unchanged except for scheduler plumbing needed for lazy work-unit delivery.

## Acceptance criteria

1. User can request any positive instance count without the old 20/50 caps.
2. Requested large runs do not materialize all WorkUnits at once.
3. Auto concurrency and manual concurrency both work; manual is no longer capped at 5.
4. Resource pressure pauses only new launches, never silently kills healthy sessions.
5. STOP immediately prevents additional lazy WorkUnits from starting.
6. Strict Privacy Mode actively applies supported WebRTC restrictions and verifies candidates.
7. Required-proxy direct-IP WebRTC exposure blocks only that WorkUnit.
8. iOS/Android compatibility modes can show Profile Consistency PASS while still displaying immutable host/runtime facts.
9. No automation/fingerprint concealment or unsupported hardware spoofing is introduced.
