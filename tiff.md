# OrbitQA: Pods, Warmer, and Streaming

OrbitQA is a local-first Windows desktop QA tool. It has three related but separate work areas:

- **Pods** create and store reusable browser profiles.
- **Warmer** exercises those profiles so they look like established, returning browsers.
- **Streaming** runs authorized playback and navigation QA on music-streaming services using saved accounts.

All state is kept locally under Electron's `userData` directory. There is no cloud sync, no account login for OrbitQA itself, and no shared backend.

---

## 1. Pods

### What a pod is

A pod is a named group of persistent browser profiles for one device family and country. It is the starting point for "instant YouTube without Gmail": instead of manually creating accounts, you create a set of independent browser profiles with stable device fingerprints.

You choose:

- Pod name
- Device type: `desktop`, `android`, or `ios`
- Number of profiles: clamped to `1..100`
- Country: `US`, `GB`, `CA`, `AU`, `NG`, or `IN`

The main process creates the pod and its profiles and stores them in `pods.json`.

### What each profile contains

Every profile gets a deterministic fingerprint, so the same profile reports the same identity on every read:

- User agent and browser family
- Platform
- Viewport and screen size
- Device scale factor (DPR)
- Touch points
- Hardware concurrency and device memory
- Locale and language list
- Timezone
- Country
- Assigned proxy (or Direct)
- Warmer status: `NEW`, `WARMING`, `WARM`, or `FAILED`
- Creation time, last warmed time, and warm count

### What you can do with pods

- Expand a pod to inspect its profile table.
- Assign a proxy per profile, or leave it on Direct.
- Delete one profile or the whole pod.
- Use **Warm this pod** to open Warmer with the pod selected.
- Use **Run with this pod** to hand the pod ID to the Run page.

### Limits and persistence

- Maximum 200 pods.
- Maximum 100 profiles per pod.
- Stored in `userData/pods.json`.
- IDs use `crypto.randomUUID()`, not timestamps.

---

## 2. Warmer

### What the warmer is for

The warmer is supposed to make pod profiles look used rather than brand new. It runs controlled browser journeys so each profile builds its own cookies and browsing history.

### What a warmer run does

You build a topic list, choose a pod, and optionally choose a subset of its profiles. The default is all profiles in the pod.

For each profile, the warmer:

1. Resolves the profile's proxy assignment. If a proxy is assigned, it stays sticky for the entire profile session and is never rotated mid-run. If none is assigned, the profile runs direct and that is recorded.
2. Launches a persistent browser context using the stored fingerprint (user agent, viewport, screen, DPR, locale, timezone, touch).
3. Opens Google, accepts a consent surface if one appears, types a random topic from the run's topic list, and submits the search.
4. Visits two or three organic results and dwells briefly.
5. Reuses the profile's own history for a site when possible instead of always issuing a fresh navigation.
6. Saves cookies through the cookie store, scoped to that profile.
7. Appends visited URLs to `pod-history/<profileId>.json`.
8. Marks the profile `WARM`, increments `warmCount`, and sets `lastWarmedAt`.

If a profile fails, it is marked `FAILED` with the reason, and the run continues with the remaining profiles. A single failure does not abort the whole run.

### Run behavior

- Up to 3 browser contexts at a time.
- Per-profile timeout.
- A stop action that is honored between profiles and mid-navigation.
- Live progress through the `warmer:event` channel.
- Warmers appear in Run Center under the **WARMER** lane.

### Gmail / account assignments

The Gmail section records an email address, a purpose, and an optional pod/profile target. It is an assignment list only. It does not log in to Gmail, does not store passwords, and does not perform account actions.

### Persistence

- `userData/warmer.json` stores topics and account assignments.
- `userData/pod-history/<profileId>.json` stores per-profile visited URLs.
- `userData/pod-browser-profiles/<profileId>/` stores persistent browser state, including cookies.

### Intended scope versus current runner

The product brief also mentions targeting YouTube videos. The current warmer runner implements Google search and organic-result visits. It does not yet implement a dedicated YouTube video journey.

---

## 3. Streaming

### What streaming QA is for

Streaming QA is for authorized playback and navigation testing on music services. It uses saved, already-authorized accounts and real browser sessions to verify that pages load, playback starts, and controls behave correctly.

Supported platforms in the UI:

- Spotify
- YouTube Music
- SoundCloud
- Deezer
- TIDAL
- Audiomack
- Pandora

The shared model also defines Apple Music as a platform type.

### Accounts and sessions

Streaming accounts are stored locally with encrypted secret blobs. Supported authentication modes are:

- `credentials`
- `session` (imported cookie or session)
- `oauth` (existing authorized session)

The app supports:

- Adding an account with a label, username, authentication mode, optional proxy, browser runtime, device, and group.
- Opening a dedicated login browser for the account.
- Marking an account verified only after you visually confirm the signed-in session.
- Checking a saved session and repairing a profile.
- Preserving saved accounts between restarts.
- Assigning a sticky proxy to an account. Manual sticky proxies remain fixed until changed.

OrbitQA does not type passwords into streaming websites automatically. Login is performed manually in the dedicated browser profile.

### Music Library and run setup

Streaming Hub works with a separate Music Library:

- Import an artist, album, playlist, track, or search link.
- Detect the platform from the link.
- Resolve the catalog and save selected tracks.
- Select saved songs and albums for a run.
- Group accounts into sequential QA groups.
- Choose all songs, a track count, repeat count, and content-intelligence options.

### Playback and QA checks

A streaming run can configure:

- Observation window in seconds (minimum and maximum)
- Queue mode: sequential, shuffle, or loop
- Playback speed
- Rest periods after a number of tracks
- Rest and replay
- Visible or background execution
- Mute audio and screenshot capture
- Browser runtime: installed Chrome or Brave
- Device mode: desktop, Android, iOS, or mixed
- Device profile per family

Supported QA checks include:

- Session verification
- Playback
- Pause and resume
- Next track and previous track
- Queue transition
- Volume control
- Artist navigation
- Album navigation
- Playlist loading

Some check types exist in the shared model but social-engagement actions are intentionally unavailable. Streaming Hub is explicitly for authorized playback and navigation QA, not for artificial engagement, ad clicking, or social manipulation.

### Run behavior and integration

- Each account uses its persistent, account-specific browser profile.
- Saved sessions are reused instead of being overwritten by stale snapshots.
- Runs appear in Run Center under the **STREAMING HUB** lane.
- Live activity is shown in the streaming log with severity filters.
- Secrets are redacted from activity text and errors.

### Persistence

Streaming data is stored under `userData`, including account files, saved collections, and dedicated browser profiles. Secrets are encoded with Electron `safeStorage` when available.

---

## How the three areas relate

- **Pods** are the source of persistent browser identities.
- **Warmer** makes those pod profiles look established by building history and cookies.
- **Streaming** is a separate QA lane for authorized music-service playback. It has its own accounts, groups, music library, and browser profiles.

Pods and Warmer feed each other directly. Streaming is a different workflow with its own account and session model. All three feed into Run Center so their runs can be monitored, stopped, and reviewed in one place.

## Safety boundaries

- Use only accounts and content you are authorized to use.
- Pods and warmer profiles are for controlled QA, not for bypassing platform rules.
- Streaming QA verifies playback and navigation. It does not perform artificial engagement.
- All pods, warmer, streaming, cookie, and history data stays local to the Windows user profile.
