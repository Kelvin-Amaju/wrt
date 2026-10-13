# Streaming Hub QA Design

**Date:** 2026-09-17
**Base:** OrbitQA Desktop v0.13.4

## Purpose

Add a new **Streaming Hub** page to OrbitQA for legitimate streaming-platform QA, catalog management, test-account session management, playback-control verification, queue/timer testing, screenshots, proxy/network validation, and Run Center reporting.

The feature is for authorized QA of accounts and content the operator is permitted to test. It must not be designed to inflate streams, followers, favorites, ad impressions, or monetization metrics; it must not hide automation observability or spoof browser/device hardware to make automated traffic appear human.

## Supported Platform Model

The first implementation exposes adapters for:

- Spotify
- YouTube Music
- SoundCloud
- Deezer
- TIDAL
- Audiomack
- Pandora (only when the adapter can operate in the configured region/account environment)

Each platform implements the same adapter interface so the orchestration layer does not contain platform-specific selectors.

## Streaming Hub Page

Add `Streaming Hub` to the main sidebar. The page uses OrbitQA's current dark Run Center visual language, not the supplied reference layout.

The page has these sections:

1. **Platform selector** — chooses the active platform adapter.
2. **Catalog Library** — accepts artist, album, playlist, track URLs, and search queries.
3. **Saved Collections** — reusable collections of selected tracks grouped by artist/album/playlist/custom list.
4. **Playback Test** — min/max observation duration, queue mode, playback speed, slot count, rest policy.
5. **QA Checks** — playback start, pause/resume, next, previous, queue transition, artist navigation, album navigation, playlist loading, session verification, screenshots.
6. **Streaming Accounts** — saved authorized test-account profiles and assigned OrbitQA proxy mode/profile.
7. **Start Streaming QA** — creates a normal Run Center run using the streaming run type.

## Catalog Import

A catalog input may be:

- artist URL
- album URL
- playlist URL
- track URL
- search query

The platform adapter resolves metadata through a supported public/official metadata path or the authenticated page available to the authorized QA account. Importing an artist/album/playlist returns a normalized list of tracks.

The user can:

- select all
- clear selection
- select individual tracks
- save selected tracks into a collection
- keep multiple artists/albums/playlists in the library

Catalog import must not start playback or generate engagement.

## Saved Collections

A collection contains:

- collection id
- platform
- label
- source references
- normalized track ids/URLs/titles/artists/durations when available
- created/updated timestamps

Collections persist locally and are loaded lazily.

## Streaming Accounts

Store authorized QA account profiles locally. Each account contains:

- account id
- platform
- label
- username/email when applicable
- authentication mode (`session`, `oauth`, or `credentials` where explicitly supported)
- encrypted/OS-protected secret reference when available; raw secret values must not be rendered back into the UI
- optional imported session cookies for user-authorized QA
- proxy source selection using OrbitQA's existing modes
- enabled/disabled state
- last verification state and timestamp

The first implementation must prefer session/OAuth authentication when supported. It may support user-entered credentials for platforms where the normal login flow is required, but secrets must never appear in activity logs or screenshots.

## Playback QA Configuration

A Streaming QA run config contains:

- platform
- selected collection ids and/or selected track ids
- selected account ids
- slot count
- min observation seconds
- max observation seconds
- queue mode: `sequential | shuffle | loop`
- playback speed: only values supported by the platform UI; default `1.0`
- optional rest policy (`enabled`, tracks before rest, rest seconds)
- selected QA checks
- screenshot enabled/disabled
- execution mode: visible/background

For each track observation, choose a random duration inside the configured min/max range. The duration is a QA observation window, not a mechanism for stream-count manipulation.

## Queue Behavior

- `sequential`: follow the selected track order.
- `shuffle`: choose from the selected tracks using a seeded shuffled deck so the run is reproducible from its run config.
- `loop`: repeat the selected collection after the last item until the run is stopped or its configured test scope completes.

## Slot and Account Scheduling

Slots represent concurrent QA sessions. One slot maps to one selected test account/browser context at a time.

Rules:

- no account may occupy two slots simultaneously in the same run
- each account receives its configured proxy policy before platform navigation
- the global Run Center scheduler remains the authority for browser-start fairness across normal QA runs and streaming runs
- streaming runs must not bypass global startup limits

## Network and Session Verification

Before platform interaction:

1. allocate the account's configured proxy policy
2. launch a fresh isolated BrowserContext
3. verify proxy route and no direct-IP fallback
4. verify WebRTC privacy policy
5. run existing locale/timezone diagnostics internally
6. navigate to the platform
7. restore/authenticate the authorized account session
8. verify the account session before catalog/playback QA

No fingerprint spoofing or automation-hiding logic is added.

## Safe QA Interactions

Supported checks are limited to benign playback/navigation verification:

- play starts
- pause/resume
- next track
- previous track
- queue transition
- volume-control presence/operation where safe
- artist navigation
- album navigation
- playlist loading
- account/session verification
- screenshots when enabled

Do not automate follow, favorite/like, subscribe, ad clicks, or other engagement actions whose purpose is to alter platform metrics.

## Run Center Integration

Streaming QA uses the existing multi-run registry. Add `runKind: 'qa' | 'streaming'` to the run record.

Streaming run cards show:

- platform
- collection summary
- accounts selected
- slots
- running/queued/completed/failed counters
- execution mode

Run Detail adds a Streaming QA section with:

- platform
- queue mode
- observation range
- collections/tracks selected
- account session summary
- playback/navigation check counts
- screenshots count
- network/session result per account

Pause, resume, stop, Run Again, completed-history compaction, delete, application-close pause, and automatic resume follow existing Run Center semantics.

## Persistence

Create lightweight stores for:

- streaming collections
- streaming account metadata/secret references
- streaming run configuration/results

Large transient browser objects and page handles are never persisted.

On application shutdown, active streaming runs checkpoint like normal runs. In-flight streaming work units restart cleanly on resume; completed work units are not repeated.

## IPC and Security

Add namespaced IPC methods:

- `streaming:listPlatforms`
- `streaming:resolveCatalog`
- `streaming:listCollections`
- `streaming:saveCollection`
- `streaming:deleteCollection`
- `streaming:listAccounts`
- `streaming:saveAccount`
- `streaming:deleteAccount`
- `streaming:verifyAccount`
- `streaming:startRun`

IPC responses must never return stored raw passwords/session secrets.

## Error Handling

Catalog failures, account verification failures, unsupported platform actions, proxy failures, and playback-control failures are scoped to the affected item/account/work unit. They must not crash the Streaming Hub page or unrelated Run Center runs.

Unsupported platform operations are reported as `NOT_APPLICABLE` rather than guessed.

## Performance

- catalog lists use lazy rendering
- collections load metadata without loading every historical log
- streaming account secrets are not duplicated into run logs
- no polling loop faster than needed for UI status
- browser contexts exist only for active slots
- slot scheduling reuses Run Center's global start scheduler

## Acceptance Criteria

1. Streaming Hub appears in the sidebar and renders without affecting existing pages.
2. Platform selector exposes the supported adapters.
3. Catalog import normalizes artist/album/playlist/track/search results.
4. User can save selected tracks into reusable collections.
5. User can save/delete authorized test-account profiles without secrets leaking to the renderer/logs.
6. Each account can reference existing OrbitQA proxy modes.
7. Streaming QA validates route/privacy before platform login/session verification.
8. Sequential, shuffle, and loop queue planning are deterministic/testable.
9. Observation duration is randomly selected within configured min/max bounds.
10. Rest policy pauses QA orchestration without blocking unrelated runs.
11. Slots never double-assign one account within a run.
12. Visible/background execution follows existing OrbitQA semantics.
13. Safe playback/navigation checks run without engagement actions.
14. Screenshot OFF produces no screenshots; ON captures configured QA evidence.
15. Streaming runs appear in Run Center and coexist with ordinary QA runs.
16. Per-run stop/pause/resume does not affect other runs.
17. App close checkpoints active streaming runs and reopening resumes them.
18. Run Again creates a new streaming run id with copied safe configuration.
19. Completed streaming runs compact transient state and can be deleted.
20. Existing OrbitQA test, proxy, popup, auxiliary-tab, device, scheduler, Run Center, and build contracts remain green.
