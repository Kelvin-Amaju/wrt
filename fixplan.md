# FIX-PLAN.README.md — Pods & Warmer: from mockup to working feature

## 0. Mission

`src/pages/pods/index.tsx` and `src/pages/warmer/index.tsx` were merged in commit `0addade`
as pure UI mockups. They render, they look right, and **nothing behind them exists**. This
document specifies the work to make both features real, persistent, and connected to the
existing QA engine, plus a set of correctness fixes found in the same commit.

Work through the phases in order. Each task has acceptance criteria. Do not skip the tests.

## 1. Non-negotiables

- **No new npm dependencies.** `package.json` has exactly one runtime dep (`playwright`) and
  a fixed dev set. Do not add state managers, UUID libs, date libs, or validation libs.
- **Main process stays CommonJS.** All new main-side code is `.cjs`, matching every other file
  in `electron/`. Renderer stays TSX under `src/`.
- **No renderer persistence.** No `localStorage`, no `sessionStorage`, no `indexedDB`. State
  lives in the main process and is read back over IPC, exactly like `run-store.cjs`,
  `proxy-store.cjs`, `cookie-store.cjs` and the streaming/social account stores.
- **Never touch unrelated behavior.** The existing QA runner, proxy pool, streaming and social
  lanes must keep passing their suites byte-for-byte.
- **Tests are part of the deliverable.** Every new module gets a `node --test` file. The
  release ships with a contract test (see §9) in the style of `v0218-release-contract.test.cjs`.
- **Registration is mandatory.** A module that isn't wired into `electron/preload.cjs`,
  `electron/main.cjs` and `package.json`'s `test:electron` list does not count as done.
- **Do not `npm audit fix --force`.** It breaks the pinned Electron 38 tree.

## 2. Reference files — read before writing

| Purpose | File |
| --- | --- |
| JSON store pattern to copy | `electron/run-store.cjs`, `electron/proxy-store.cjs` |
| Store test pattern | `electron/run-store.test.cjs`, `electron/proxy-store.test.cjs` |
| Real device fingerprint data | `src/shared/deviceIdentity.ts`, `src/shared/mobileDevices.ts` |
| IPC naming + registration | `electron/preload.cjs`, `electron/main.cjs` |
| Proxy pool to allocate from | `electron/proxy-pool-service.cjs` |
| Existing account session store | `electron/streaming/account-store.cjs` |
| Cookie store to write into | `electron/cookie-store.cjs` |
| Playwright driver to reuse | `electron/qa-runner.cjs` |
| Page/UI conventions | `src/pages/DeviceProfiles.tsx`, `src/pages/ProxyManager.tsx` |
| Contract test template | `electron/v0218-release-contract.test.cjs` |
| Product brief | `update for QAorbit.txt` |

## 3. Current state — what is actually there

Read these two files in full. Confirm each item before starting.

**`src/pages/pods/index.tsx` (104 lines)**
- Pods held in `useState<any[]>`; nothing is persisted.
- Profiles are `{ id, device, country, createdAt }` — no user agent, viewport, DPR, locale,
  timezone, touch points, or platform. `deviceIdentity.ts` is not imported.
- `id: Date.now().toString()` for the pod and `` `${Date.now()}-${i}` `` for profiles — both
  collide when two pods are created inside the same millisecond.
- `setCount(Number(e.target.value))` — clearing the field stores `0` and creates an empty pod.
  `min={1}` / `max={100}` are DOM hints only; nothing clamps.
- `setPods([...pods, pod])` — non-functional update.
- No delete, no expand, no proxy/country assignment per profile, no handoff to Run or Warmer.
- Uses `var(--text-secondary)`, which does not exist in `styles.css`.

**`src/pages/warmer/index.tsx` (100 lines)**
- Topics in `useState<string[]>(['investments'])`; lost on refresh. Duplicates and empties
  allowed. `key={idx}`.
- `runWarmup` is `setRunning(true); setTimeout(() => setRunning(false), 2000)` — it never
  visits Google, never searches, never writes a cookie or history entry.
- The Gmail/account inputs are uncontrolled with no state, and the **Assign button has no
  `onClick`**. Nothing is stored and no assignment list is rendered.
- Uses `var(--panel-alt)` (chips) and `var(--text-secondary)`, neither of which exists.

**`src/pages/Dashboard.tsx`**
- `totalProfiles` / `setTotalProfiles` are declared and never used or rendered.
- The `COMPLETED` metric card counts `COMPLETED + FAILED + STOPPED` — mislabeled.

**Repo-wide**
- `version` file = `0.21.67`, `package.json` = `0.21.79` — unsynced.
- `BUILD-ORBITQA-EXE.bat` prints `v0.20.1` in four places.

## 4. Data model

Create `src/shared/pods.ts` with exported types. These are the contract for everything below.

```ts
export type PodDeviceType = 'desktop' | 'android' | 'ios';
export type PodCountry = 'US' | 'GB' | 'CA' | 'AU' | 'NG' | 'IN';

export interface PodProfileFingerprint {
  userAgent: string;
  platform: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number; colorDepth: number };
  deviceScaleFactor: number;
  maxTouchPoints: number;
  hardwareConcurrency: number;
  deviceMemory: number;
  locale: string;
  languages: string[];
  timezoneId: string;
  browserFamily: 'chromium' | 'brave' | 'firefox' | 'webkit';
}

export interface PodProfile {
  id: string;
  podId: string;
  index: number;
  deviceType: PodDeviceType;
  country: PodCountry;
  fingerprint: PodProfileFingerprint;
  proxyId: string | null;
  status: 'NEW' | 'WARMING' | 'WARM' | 'FAILED';
  createdAt: string;
  lastWarmedAt: string | null;
  warmCount: number;
}

export interface Pod {
  id: string;
  name: string;
  deviceType: PodDeviceType;
  country: PodCountry;
  count: number;
  createdAt: string;
}

export interface WarmerTopic { id: string; label: string; createdAt: string; }

export interface WarmerAssignment {
  id: string;
  email: string;
  purpose: string;
  podId: string | null;
  profileId: string | null;
  createdAt: string;
}

export interface WarmerRunSummary {
  runId: string;
  podId: string;
  profileIds: string[];
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STOPPED';
  startedAt: string;
  finishedAt: string | null;
  searches: number;
  cookiesSaved: number;
  error: string | null;
}
```

Derive fingerprints from the existing catalogs in `mobileDevices.ts` / `deviceIdentity.ts`.
If a real catalog entry is missing for a combination, synthesize from a **static, seeded**
table in `src/shared/podFingerprints.ts` — never `Math.random()` at read time, or the same
profile reports a different fingerprint on every render.

## 5. Persistence

New module `electron/pod-store.cjs`, modelled on `run-store.cjs`:

- File: `app.getPath('userData')/pods.json`, plus `warmer.json` for topics and assignments.
- Atomic write (temp file + rename), schema version field, corrupt-file recovery that logs and
  starts from an empty collection rather than throwing.
- Exports: `listPods`, `createPod`, `deletePod`, `getPod`, `listProfiles`, `getProfile`,
  `updateProfile`, `listTopics`, `addTopic`, `removeTopic`, `listAssignments`,
  `addAssignment`, `removeAssignment`.
- Cap total pods at 200 and profiles per pod at 100; return typed errors, never `throw` into IPC.
- **ID generation:** a `createId(prefix)` helper in `electron/id.cjs` using
  `crypto.randomUUID()`. Use it for pods, profiles, topics and assignments. No `Date.now()` IDs.

## 6. IPC contract

Add to `electron/preload.cjs`, in the existing flat style:

```
listPods, createPod, deletePod
listPodProfiles, deletePodProfile, assignPodProfileProxy
listWarmerTopics, addWarmerTopic, removeWarmerTopic
listWarmerAssignments, addWarmerAssignment, removeWarmerAssignment
startWarmerRun, stopWarmerRun, listWarmerRuns, getWarmerRun
```

Channels: `pod:list`, `pod:create`, `pod:delete`, `pod:listProfiles`, `pod:deleteProfile`,
`pod:assignProxy`, `warmer:listTopics`, `warmer:addTopic`, `warmer:removeTopic`,
`warmer:listAssignments`, `warmer:addAssignment`, `warmer:removeAssignment`,
`warmer:startRun`, `warmer:stopRun`, `warmer:listRuns`, `warmer:getRun`.

All handlers in `electron/main.cjs`, wrapped in the existing error-guard style so a store
failure returns `{ ok: false, error }` instead of rejecting the renderer.

`warmer:startRun` request shape: `{ podId: string; profileIds?: string[]; topicIds?: string[] }`.
Omit `profileIds` to warm the whole pod.

## 7. The warmer engine

New module `electron/warmer/warmer-runner.cjs`, driving Playwright the way `qa-runner.cjs` does:

1. Per profile: resolve its proxy. **If the profile has a proxy assigned, it is sticky for the
   whole session — never rotate mid-run.** If it has none, run direct and record that.
2. Apply the stored fingerprint as a browser context: UA, viewport, screen, DPR, locale,
   timezone, touch points.
3. Navigate `https://www.google.com`, accept the consent surface if present, then type one
   random topic into the search box and submit. Pick from the run's topic list.
4. Click two or three organic results from the SERP and dwell briefly. On any visited site,
   read from the profile's own history first before issuing a fresh navigation.
5. Persist cookies through `cookie-store.cjs` scoped to the profile, and append the visited
   URLs to a per-profile `history.json` in `userData/pod-history/<profileId>.json`.
6. Mark the profile `WARM`, increment `warmCount`, set `lastWarmedAt`. On error: `FAILED` with
   the reason, and continue with the next profile — one failure never aborts the run.
7. Emit progress over a `warmer:event` channel mirroring `qa:event` so the page can show live
   per-profile rows. Register an `onWarmerEvent` listener in preload.
8. Respect a concurrency ceiling of 3 contexts, a per-profile timeout, and honour `stopWarmerRun`
   between profiles and mid-navigation.

Wire the run into the existing run center: register the run kind `warmer` so it appears in
`Run Center` and in `listAllRunCenterSummaries()`. Do not fork that aggregation logic.

## 8. UI work

### `src/pages/pods/index.tsx`
- Load pods and profiles from IPC on mount; a refresh must restore everything.
- Keep the create form, but clamp count to `1..100`, treat an empty/NaN field as `1`, and use
  functional state updates.
- Each pod card becomes expandable to a profile table: index, browser family, UA short form,
  viewport, timezone, proxy (dropdown of available proxies, with "Direct"), status pill,
  warm count.
- Per-profile and per-pod delete with confirm.
- A **"Warm this pod"** button that deep-links to Warmer with the pod preselected, and a
  **"Run with this pod"** button that hands the pod to the Run page.
- Show a real empty state and a real loading state.

### `src/pages/warmer/index.tsx`
- Topics from IPC, deduplicated case-insensitively, no blanks, stable IDs.
- Pod selector populated from `listPods`; a profile multi-select that defaults to all profiles.
- The run button calls `startWarmerRun` and renders live per-profile rows from `warmer:event`
  plus a stop button. Remove the `setTimeout` fake.
- Rebuild the Gmail section as a controlled form (`email`, `purpose`, optional pod/profile
  target) wired to `addWarmerAssignment`, with a rendered assignment list and remove buttons.
  Validate the email shape before submit.
- Show recent `warmer` runs with status and counts.

### `src/pages/Dashboard.tsx`
- Delete the unused `totalProfiles` pair, or better: populate and render a `POD PROFILES` card
  from `listPodProfiles`-backed totals.
- Relabel `COMPLETED` to `FINISHED` (it counts `COMPLETED + FAILED + STOPPED`) or split it into
  `COMPLETED` and `FAILED`. Keep the success-rate math over terminal runs.
- Keep the 15s poll, but add an `AbortController`-style `cancelled` guard already present and
  skip the update when the page is hidden (`document.hidden`).

### `src/styles.css`
- Add the missing tokens to `:root`: `--panel-alt: rgba(28, 34, 56, 0.72)` and
  `--text-secondary: var(--muted)`.
- Move the new pages' inline `style={{ ... }}` blocks into real classes
  (`.pod-grid`, `.pod-card`, `.pod-profile-table`, `.warmer-topic-chip`, `.warmer-run-row`)
  instead of shipping layout in JSX.
- The chips, tables and cards must survive a 900px-wide window without horizontal overflow —
  `v02170-responsive-containment.test.cjs` is watching.

### Navigation
- Give Pods and Warmer `badge: 'YOUTUBE'` and `badge: 'WARMUP'` in `Sidebar.tsx` so they read as
  a pair, and place them directly after `runs`.

## 9. Tests

Unit tests (all registered in `package.json` `test:electron`):

- `electron/pod-store.test.cjs` — create/list/delete, cap enforcement, atomic-write recovery
  from a truncated JSON file, ID uniqueness across 1,000 rapid creations.
- `electron/warmer/warmer-runner.test.cjs` — stub the browser; assert topic is typed and
  submitted, cookies are written per profile, a failure on profile 2 does not abort profile 3,
  and an assigned proxy is reused for the entire profile session.
- `electron/pod-fingerprint.test.cjs` — a profile's fingerprint is byte-identical across two
  reads; every country/device combination resolves a complete fingerprint.
- `src/pages/pods/pods.test.tsx` and `src/pages/warmer/warmer.test.tsx` — render with a stubbed
  `window.orbitqa`, assert the empty state, a successful create, topic dedupe, and that Assign
  fires the IPC call.

Contract test `electron/v02180-release-contract.test.cjs`:

- Asserts `package.json` version matches `/^0\.(?:21\.(?:8\d|9\d)|2[2-9]\.\d+)$/`.
- Asserts `version` file content equals `package.json` version.
- Asserts `preload.cjs` contains `listPods`, `startWarmerRun`, `addWarmerAssignment`.
- Asserts `main.cjs` contains `pod:create`, `warmer:startRun`, `warmer:listRuns`.
- Asserts both pages import from `../../shared/pods`.
- Asserts `warmer/index.tsx` no longer contains `setTimeout(() => setRunning(false)`.
- Asserts `warmer/index.tsx` contains `onClick={addAssignment` (or the wired handler name).
- Asserts `styles.css` defines `--panel-alt` and `--text-secondary`.

## 10. Version, build and docs sync

- Bump `package.json` to `0.21.80` and write the same value to the `version` file.
- Update all four `v0.20.1` occurrences in `BUILD-ORBITQA-EXE.bat` to the new version, and
  change the hard-coded artifact name line to match `electron-builder.yml`'s `artifactName`.
- Rewrite `NEW-FEATURES.README.md` so it describes behavior that actually exists — current text
  claims pods generate device profiles and that warming saves cookies, neither of which was true.
  Add a "Persistence" section stating where the JSON files live.
- Add a root `README.md` with a description, the build/run commands, the `node --test` layout,
  and a note that data is local to `userData`. Add GitHub topics: `electron`, `playwright`,
  `qa-automation`, `typescript`, `react`, `windows-desktop`.

## 11. Definition of done

- [ ] `npm run build` clean — `tsc --noEmit` and `vite build`.
- [ ] `npm test` green, with the new files included.
- [ ] `npm run test:electron` green, with the new files included.
- [ ] Create a pod, fully restart the app, confirm pods, profiles, topics and assignments return.
- [ ] Warm a 3-profile pod against live Google: cookies land in the profile scope, history files
      appear, statuses move `NEW → WARM`, and one profile can fail without killing the run.
- [ ] Assign a proxy to one profile and confirm the whole session sticks to it.
- [ ] Stop mid-run and confirm no orphaned browser contexts remain.
- [ ] Dashboard shows profile totals; no unused state remains anywhere.
- [ ] Pods and Warmer render at 900px with no horizontal scroll.
- [ ] Version strings agree in `package.json`, `version` and the build script.

## 12. Out of scope

Do not redesign the Run page, the proxy pool, the streaming or social lanes, or the Android
emulator flow. Do not migrate existing stores to a database. Do not add a Settings section for
the warmer — defaults live in code until the feature is proven.

## 13. Output

Work phase by phase: model + store, then IPC, then engine, then UI, then tests, then docs.
After each phase, run the suites that touch it and report the actual output. Finish with a
short summary of files added and changed, plus anything in this spec you had to deviate from
and why.