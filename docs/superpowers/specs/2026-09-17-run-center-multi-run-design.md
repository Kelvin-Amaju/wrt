# OrbitQA Run Center / Multi-Run Design

## Goal
Transform OrbitQA from a single-active-run application into a persistent multi-run QA manager where multiple independent test runs can execute concurrently, survive navigation within the app, pause safely when OrbitQA exits, and automatically resume when OrbitQA launches again.

## Product Surface
Add a new main-menu page named **Run Center**.

Run Center is the authoritative view for every run that is currently:
- STARTING
- RUNNING
- PAUSING
- PAUSED
- RESUMING
- STOPPING
- COMPLETED
- FAILED
- STOPPED

Each run card shows:
- run name / generated run ID
- target summary
- selected device families
- execution mode: Visible Desktop Activity or Background Activity
- requested concurrency
- Running / Queued / Completed / Failed counts
- elapsed / remaining session information
- current status
- actions: Open, Pause/Resume where applicable, Stop

A deliberate **Stop All** control may exist in Run Center, but it must require an explicit confirmation and must never be triggered by ordinary page navigation.

## Core Multi-Run Model
The backend must no longer contain a single global `activeRun` slot.

Introduce a run registry keyed by a stable run ID:

```text
RUN-20260917-0001
RUN-20260917-0002
RUN-20260917-0003
```

Each run owns independent state:
- immutable run configuration snapshot
- target URL pool and shuffled-deck position
- work-unit generator / queue state
- per-run requested concurrency
- selected devices and profiles
- browser selection
- proxy configuration and reservations
- WorkUnit counters
- activity log
- privacy / device / ad / interaction results
- cancellation controller
- browser contexts / pages
- session timers
- screenshots / result references
- execution mode
- persistence metadata

No mutable run-specific state may be stored in globals shared between runs except through explicitly multi-run services such as the global scheduler and proxy pool service.

## Run Lifecycle
Use an explicit state machine:

```text
CREATED
  -> STARTING
  -> RUNNING
  -> PAUSING -> PAUSED -> RESUMING -> RUNNING
  -> STOPPING -> STOPPED
  -> COMPLETED
  -> FAILED
```

Rules:
- Starting a new run is allowed while other runs are STARTING, RUNNING, PAUSED, or STOPPING.
- Stopping one run only cancels that run.
- Leaving Test Runs, Run Center, Dashboard, Settings, etc. never changes run state.
- A run may only enter COMPLETED when every requested WorkUnit has reached a terminal state.
- STOP must cancel active + queued WorkUnits for only that run and release only that run's resources.

## Global Scheduler
Multiple runs may each request concurrency independently. A global scheduler coordinates browser startup and active WorkUnits so one run cannot starve all others or create a simultaneous browser-launch storm.

Example:
- Run A requested concurrency: 10
- Run B requested concurrency: 8
- Run C requested concurrency: 12

Each run may have up to its own requested active limit, while the global scheduler interleaves launch opportunities fairly across runnable runs.

Fairness policy:
- round-robin across runnable runs
- within each run, preserve the approved mixed-device scheduler
- freed capacity is offered to the next runnable run rather than always returning to the same run
- manual concurrency remains the run's requested active ceiling
- browser startup remains staggered/ramped to avoid same-millisecond process spikes

The global scheduler must never collapse a manually requested run to one WorkUnit merely because another run exists.

## Visible Desktop Activity vs Background Activity
Each run chooses an execution mode at creation.

### Visible Desktop Activity
- browser windows are headed and visible
- user can watch scrolling, pointer/touch indicators, popup dismissal, site actions, and auxiliary tabs
- all existing headed-mode privacy/WebRTC behavior remains active

### Background Activity
- uses the same QA engine and test logic
- browser windows do not appear on the desktop
- WorkUnits still load pages, scroll, perform safe actions, observe ads, monitor popups, supervise auxiliary tabs, and run privacy/device checks
- results and logs are identical in structure to visible mode
- no artificial reduction in QA behavior solely because the browser is hidden

Execution mode is per run, not global.

## Application Exit / Restart Persistence
When OrbitQA begins normal application shutdown:

1. stop scheduling new WorkUnits
2. mark active runs PAUSING
3. persist a crash-safe checkpoint for each unfinished run
4. terminate active browser processes cleanly
5. persist unfinished in-flight WorkUnits as pending/restartable, not completed
6. mark the run PAUSED in durable state
7. allow Electron to exit

OrbitQA cannot continue browser automation after the desktop process has fully exited. Therefore closing the app means **pause**, not continued execution.

On next startup:

1. load persisted runs
2. display them immediately in Run Center
3. convert unfinished PAUSED runs to RESUMING
4. rebuild lazy queues from persisted checkpoints
5. restart any WorkUnit that was in-flight at shutdown from a clean browser context
6. resume scheduling automatically
7. return run state to RUNNING

A partially executed WorkUnit must never be counted as completed simply because the app closed.

## Durable Run Store
Create a persistent run-store service under Electron's application data directory.

Persist, at minimum:
- schema version
- run ID
- creation time
- run status
- execution mode
- configuration snapshot
- URL pool + shuffled deck cycle/index or equivalent deterministic checkpoint
- requested / queued / running / completed / failed counters
- terminal WorkUnit records
- pending WorkUnit checkpoint information sufficient to recreate remaining work lazily
- log tail / persisted activity log
- summary results
- timestamps for last checkpoint and resume

Persistence must be atomic:
- write to temporary file
- fsync/close
- rename over the previous checkpoint

Corrupt or incompatible persisted state must not crash OrbitQA. The run should be surfaced as FAILED/RECOVERY NEEDED with an explanatory message.

## Run Center Detail View
Opening a run in Run Center shows that run's existing diagnostic surfaces scoped only to the selected run:
- LIVE MATRIX / Latest Result
- Work Units
- Activity Log
- latest Device Identity Check
- latest Privacy & Network Check
- ad summary
- counters
- run configuration summary

Switching between run detail pages does not affect execution.

## Test Runs Page
Test Runs remains the run creation page.

Starting a run:
- snapshots the current configuration
- creates a new run ID
- registers it with the backend run registry
- immediately navigates/links it into Run Center
- leaves the Test Runs editor available for configuring another run

There is no global `A QA run is already active` error anymore.

## Per-Run STOP
Stopping Run B performs only:
- set Run B STOPPING
- abort Run B active behavior
- cancel Run B queued work
- stop Run B browser contexts and auxiliary tabs
- release Run B proxy reservations
- settle Run B worker promises
- persist final Run B state
- mark Run B STOPPED

Runs A and C continue without losing slots, timers, browser contexts, or queue state.

## Stop All
If implemented, Stop All must:
- require explicit confirmation
- independently transition each non-terminal run to STOPPING
- await all run teardowns
- never be triggered by navigating away or closing a page

## Auxiliary Tabs
Preserve the approved auxiliary-tab session-retention behavior per WorkUnit:
- auxiliary tabs belong to the same WorkUnit and BrowserContext
- fully load / verify / observe / scroll as applicable
- remain open for the remainder of that WorkUnit session
- close with their BrowserContext when the WorkUnit timer ends
- STOP of that run closes them immediately
- pausing due to application exit closes them, but the WorkUnit is checkpointed as unfinished and restarted after resume

## Existing Auto-QA Behavior That Must Not Regress
Preserve:
- timer-aware top -> bottom -> top reading
- required safe site actions for blog/news, downloader, shortlink, temp-mail, tool/form, and generic safe pages
- repeated popup monitoring and safe Close/X handling
- passive ad observation/counting without ad clicks
- auxiliary-tab complete-load supervision
- URL pool random deck behavior
- mixed-device scheduling
- proxy route validation and no direct fallback
- WebRTC leak checks
- device identity / iOS compatibility behavior
- navigation resilience
- fresh per-WorkUnit BrowserContexts
- STOP cancellation semantics

## IPC Contract
Replace single-run start/stop assumptions with run-scoped APIs.

Required conceptual operations:

```text
qa:createRun(config) -> runId
qa:listRuns() -> RunSummary[]
qa:getRun(runId) -> RunDetail
qa:stopRun(runId)
qa:pauseRun(runId)
qa:resumeRun(runId)
qa:stopAllRuns()
qa:subscribeRunEvents(runId?)
```

Events must include run ID on every run/work-unit event so the renderer cannot mix logs or counters from different runs.

## UI Design
Sidebar:

```text
Dashboard
Test Runs
Run Center   [badge: number running]
Proxy Manager
Device Profiles
Settings
```

Run Center visual design:
- clean card/grid layout consistent with current OrbitQA styling
- strong status pill per run
- compact progress bar
- device badges
- Visible / Background badge
- counters aligned in a small matrix
- primary actions aligned consistently
- no dense raw logs on the card; logs stay in the detail view

Suggested statuses:
- Running: green/accent treatment
- Paused: amber
- Stopping/Pausing/Resuming: neutral progress state
- Failed: red
- Completed: subdued success
- Stopped: gray

Do not rely on color alone; always show status text.

## Resource / Failure Isolation
A failure in one run must not crash other runs.

Each run's worker errors are caught and attributed to that run. Global services may report degraded state, but they may not indiscriminately cancel unrelated runs.

If the OS runs out of resources:
- preserve run registry
- stop launching additional browser startups temporarily
- do not silently mark queued WorkUnits failed
- continue already healthy active work where possible
- surface resource pressure in Run Center

## Startup Recovery
Startup recovery tests must cover:
- app closes with one active run
- app closes with multiple active runs
- one run completed, one active, one stopped
- restart recreates only unfinished runs
- in-flight WorkUnits become pending/restartable
- completed WorkUnits stay completed
- URL deck does not lose/duplicate already-completed assignments beyond the documented restart semantics
- logs remain associated with the correct run

## Acceptance Tests
Before packaging, automated coverage must include at least:

1. start Run A, then start Run B without stopping A
2. Run A and B execute concurrently
3. run events never cross-contaminate logs/counters
4. STOP Run A while Run B continues
5. STOP does not cancel another run's BrowserContexts
6. independent per-run concurrency limits
7. fair global scheduling across 3+ runs
8. mixed devices remain fair inside each run
9. one visible run + one background run concurrently
10. background mode performs the same Auto-QA behavior without visible windows
11. navigation between application pages does not alter active runs
12. close application with active run -> persisted PAUSED checkpoint
13. restart -> automatic RESUMING -> RUNNING
14. in-flight WorkUnit restarts cleanly after resume
15. completed WorkUnits do not rerun after restart
16. stopped runs do not auto-resume
17. failed runs do not auto-resume unless explicitly retried
18. multiple paused runs resume independently
19. auxiliary tabs remain scoped to their WorkUnit/run
20. Stop All requires explicit action and stops all runs cleanly
21. existing popup/action/blog/downloader/shortlink/temp-mail tests still pass
22. existing proxy/WebRTC/device/navigation tests still pass
23. existing URL pool/lazy queue tests still pass
24. app shutdown cannot corrupt the run store
25. incompatible/corrupt persisted run state is handled without crashing the app

## Non-Goals
- OrbitQA will not continue browser automation after the application process has fully exited.
- OrbitQA will not fake physical iPhone hardware.
- OrbitQA will not click ads, sponsored CTAs, CAPTCHA/human-verification controls, payments, or destructive/account-sensitive controls.
- This change does not reintroduce fetched free proxies.

