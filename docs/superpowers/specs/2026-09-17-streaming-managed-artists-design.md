# Streaming Hub Managed Artists & Complete Spotify Catalog Design

**Date:** 2026-09-17
**Base:** OrbitQA Desktop v0.14.3
**Scope:** Streaming Hub catalog/source management redesign only. Existing authorized playback QA, account-session verification, proxy/privacy checks, Run Center scheduling, screenshots, pause/resume/stop, and safe-interaction restrictions remain in place unless explicitly changed below.

## Goal

Replace the current temporary "fetched tracks + manually named collection" workflow with a persistent **Saved Artists** model that can resolve an exact Spotify artist from artist/album/playlist/track inputs, fetch that artist's complete credited catalog, let the user choose exactly which songs to save, automatically name the saved entity from Spotify's artist name, clear the import workspace after saving, and support later edit/refresh/delete operations without mixing in unrelated artists.

## Product Principles

1. **Exact artist identity, not name matching.** Spotify artist IDs are the primary identity key.
2. **Complete pagination, not first-page scraping.** Artist catalog fetch continues through all available release pages and all tracks for those releases.
3. **No unrelated tracks.** A track is eligible only if the selected Spotify artist ID is present in the track's credited artist IDs.
4. **No manual collection naming.** The saved entity is named from Spotify artist metadata.
5. **Fetch first, save second.** Catalog import never silently adds every result to the saved artist.
6. **Clean workspace after save.** Successful save resets the import area so another artist/source can be added immediately.
7. **Saved artists are managed entities.** Each saved artist can be opened, edited, refreshed, checked for new songs, and deleted.
8. **No silent partial success.** If the catalog connection cannot produce a complete result, OrbitQA reports the failure/partial state instead of presenting an incomplete set as complete.
9. **Authorized QA only.** This redesign does not add follow/favorite/subscribe/ad-click automation or artificial engagement behavior.

## Replace Collections With Saved Artists

The primary Streaming Hub catalog entity becomes `SavedStreamingArtist`, not `StreamingCollection`.

```ts
export interface SavedStreamingArtist {
  schemaVersion: 2;
  id: string;
  platform: 'spotify';
  platformArtistId: string;
  artistName: string;
  artistUrl: string;
  artworkUrl?: string;
  sourceOrigins: StreamingSourceOrigin[];
  catalogTracks: StreamingCatalogTrack[];
  selectedTrackIds: string[];
  autoRefreshEnabled: boolean;
  lastFetchedAt?: string;
  lastFetchStatus: 'never' | 'complete' | 'partial' | 'failed';
  lastFetchError?: string;
  createdAt: string;
  updatedAt: string;
}
```

`platformArtistId` is unique within Spotify. Importing the same artist again must open/refresh the existing saved artist rather than create a duplicate card.

### Source Origins

A saved artist records how the user discovered it without using the source as identity:

```ts
export interface StreamingSourceOrigin {
  kind: 'artist' | 'album' | 'playlist' | 'track' | 'search';
  input: string;
  addedAt: string;
}
```

An artist may therefore be discovered first from a playlist and later from an album URL while still remaining one saved artist.

## Spotify Catalog Connection

Public Spotify page scraping is no longer the primary mechanism for a "complete artist catalog" operation. The managed-artist workflow uses Spotify's authenticated catalog API through a dedicated **Spotify Catalog Connection**.

### Authentication Model

- Authorization Code with PKCE.
- No Spotify client secret is stored in the desktop app.
- The user provides/configures a Spotify application Client ID once.
- OrbitQA opens the authorization URL in the user's normal browser.
- The redirect returns to a loopback callback on `127.0.0.1` using an ephemeral local port.
- Access/refresh tokens are stored only through OrbitQA's existing protected secret codec / Electron secure storage path.
- Tokens are never returned to the renderer and never written to activity logs or screenshots.
- Disconnect removes stored catalog tokens.

The catalog connection is separate from playback test accounts. Connecting Spotify Catalog does not create or replace a Streaming QA playback account.

### Connection UI

Streaming Hub displays a compact status panel:

```text
Spotify Catalog
Connected as <account label>   ✓
[Reconnect] [Disconnect]
```

or, when not configured:

```text
Spotify Catalog
Client ID [________________]
[Connect Spotify Catalog]
```

Catalog import buttons remain disabled with a clear explanation when the complete-catalog connection is unavailable.

## Source Inspection Flow

Import is two-stage:

1. **Inspect source** — identify the source kind and all relevant candidate artists.
2. **Fetch exact artist catalog** — after an artist is unambiguous or chosen, fetch that artist's complete catalog.

This avoids turning a playlist/album/track directly into unrelated track results.

### Artist Profile URL

For an artist profile URL:

1. Extract/resolve the exact Spotify artist ID.
2. Fetch artist metadata.
3. Set that artist as the chosen artist automatically.
4. Fetch the complete catalog for that artist.

No artist chooser is shown unless the source cannot be resolved unambiguously.

### Album URL

For an album URL:

1. Fetch album metadata and credited artists.
2. If exactly one credited artist exists, select it automatically.
3. If multiple credited artists exist, show the artist chooser.
4. After the user chooses one artist, fetch that chosen artist's complete catalog, not merely the album tracks.

### Track URL

For a track URL:

1. Fetch track metadata and credited artists.
2. If exactly one credited artist exists, select it automatically.
3. If multiple credited artists exist, show the artist chooser.
4. Fetch the complete catalog of the selected artist.

### Playlist URL — Approved Behavior C

For a playlist URL:

1. Paginate through the playlist's tracks.
2. Build the distinct artist list using Spotify artist IDs.
3. Show the candidate artist chooser with each artist's name, artwork when available, and number of playlist tracks on which that artist is credited.
4. The user chooses exactly one artist.
5. OrbitQA then fetches the complete catalog for only that selected artist.
6. Other artists in the playlist are ignored for this import.

No playlist import is allowed to silently choose the first artist.

### Search Query

Search remains supported, but it resolves to **artist candidates**, not an arbitrary mixed track list. The user chooses one artist, then OrbitQA fetches that artist's complete catalog.

## Complete Artist Catalog Algorithm

For the chosen exact Spotify artist ID:

1. Fetch artist metadata and canonical artist URL.
2. Request all release groups exposed for that artist: albums, singles/EPs, compilations, and appearances where Spotify reports the artist.
3. Follow pagination until no `next` page remains. No fixed `200 release` cap is allowed.
4. For every unique release ID, fetch all tracks, following pagination until complete.
5. Keep a track only when `track.artists[].id` contains the selected artist ID.
6. Normalize each kept track with canonical Spotify track ID, title, duration, album/release metadata, artwork, credited artist IDs/names, external URL, release date where available, and ISRC where available.
7. Deduplicate the same recording across single/album/deluxe/compilation appearances.
8. Return catalog completeness metadata including pages fetched, releases inspected, raw tracks inspected, eligible tracks, deduplicated tracks, and any failed pages.

### Duplicate Rules

Deduplication order:

1. exact Spotify track ID;
2. matching ISRC when available;
3. fallback fingerprint of normalized title + duration tolerance + exact credited artist ID set.

Different recordings such as live versions, remixes, acoustic versions, or rerecordings remain separate when Spotify metadata identifies them as distinct recordings.

When the same recording appears on multiple releases, OrbitQA keeps one catalog row and stores the alternate release references internally.

## Artist-Correctness Rule

A catalog row is eligible only when the chosen exact artist ID appears in Spotify's credited artist IDs for that track.

```text
Chosen artist ID credited as primary artist      -> keep
Chosen artist ID credited as feature/collaborator -> keep
Chosen artist name appears only in text           -> reject
Different artist only                             -> reject
Search result with similar artist name            -> reject
```

The renderer does not perform this filtering. The main-process catalog service returns already-verified tracks.

## Import Workspace UI

The existing `Collection name` field is removed.

The import area contains:

```text
SOURCE
[ Artist / Album / Playlist / Track URL or artist search ] [INSPECT]

CHOSEN ARTIST
Artist artwork
Artist Name
Spotify Artist

CATALOG
127 songs found     0 selected
[Select All] [Clear Selection] [Clear Workspace]

☐ Track A
☐ Track B
☐ Track C
...

[ADD 0 SELECTED SONGS]
```

### Selection Rules

- Fresh fetch starts with **0 selected**.
- `Select All` selects every currently fetched eligible song.
- `Clear Selection` only unticks songs and keeps the fetched catalog visible.
- The primary save button reads `ADD N SELECTED SONGS` and is disabled at `N = 0`.
- Visible row count and total catalog count remain distinct when virtualization/lazy rendering is used.

### Clear Workspace

`Clear Workspace` resets:

- source input;
- inspected source metadata;
- candidate artist chooser;
- chosen artist;
- fetched tracks;
- selection;
- import progress;
- transient success/error message related to that import.

It does **not** delete saved artists or accounts.

### After Successful Save

After `ADD N SELECTED SONGS` succeeds:

1. Persist/update the chosen artist using Spotify's artist name automatically.
2. Preserve the selected track IDs under that artist.
3. Show a short success toast/message naming the artist and selected count.
4. Clear the entire import workspace automatically.
5. Keep the Saved Artists section visible so the newly saved artist appears immediately.

There is no manual `Collection name` input anywhere in this flow.

## Saved Artists Section

Replace the current small collection chips with structured artist cards.

Each card shows:

```text
Artist artwork   ARTIST NAME
Spotify Artist
86 saved songs / 127 catalog songs
3 new songs available
Last refreshed: <time>
Refresh status: Complete
Auto refresh: On

[OPEN / EDIT] [REFRESH NOW] [DELETE]
```

Cards use the artist name and Spotify artist ID as identity, not the original pasted URL.

### OPEN / EDIT

Opening an artist loads a dedicated edit state in the catalog workspace:

- latest cached catalog is visible;
- currently saved songs are checked;
- unsaved catalog songs are unchecked;
- tracks discovered since the previous successful refresh are marked `NEW`;
- user can check additional songs;
- user can uncheck saved songs to remove them;
- `Add All New` checks every currently unsaved track marked `NEW`;
- `SAVE CHANGES` replaces `selectedTrackIds` with the edited selection;
- after successful save, the edit workspace clears and the artist card updates.

Removing songs from a saved artist never deletes them from the cached catalog; it only removes them from that artist's selected playback-QA set.

### REFRESH NOW

Refresh performs a new complete-catalog fetch using the exact saved Spotify artist ID.

On success:

- existing selected songs remain selected if they still exist;
- newly discovered songs are added to the cached catalog but are **not automatically selected**;
- new unsaved tracks receive the `NEW` marker;
- removed/unavailable Spotify tracks are marked unavailable rather than silently deleting historical selection information;
- refresh counts and timestamp update;
- card displays how many new selectable songs were discovered.

### Auto Refresh

Each saved artist has `autoRefreshEnabled`.

When enabled, OrbitQA checks the artist:

- when Streaming Hub opens, subject to a freshness window so reopening the page repeatedly does not hammer the API;
- before a Streaming QA run that uses that artist if the cached catalog is stale.

Auto refresh **discovers** new songs but does not auto-select them. The user remains in control through `Add All New` or individual selection.

### DELETE

Delete requires confirmation containing the artist name and removes:

- the saved artist record;
- its selected track list;
- its cached catalog metadata.

It does not delete Spotify account credentials, other artists, or historical completed Run Center records.

## Using Saved Artists For Streaming QA

The Streaming Hub run builder can target:

- all saved artists;
- one or more selected saved artists;
- an artist opened in Edit mode after explicit save.

Only each artist's `selectedTrackIds` participate in a run. Unsaved catalog tracks and newly discovered-but-unselected tracks are not included.

When multiple saved artists are selected, their saved track sets are merged and deduplicated by canonical Spotify track ID before the existing sequential/shuffle/loop planner receives them.

## Persistence

Create a new saved-artist store rather than overloading the existing collection JSON schema.

Suggested location:

```text
<userData>/streaming-artists/<artist-record-id>.json
```

Use atomic temp-file + rename writes consistent with existing OrbitQA stores.

### Legacy Collection Preservation

Existing `streaming-collections` files from v0.14.0-v0.14.3 must not be deleted automatically.

On first load after this redesign:

- keep legacy files untouched;
- show a `Legacy Collections` subsection only when legacy records exist;
- where every track maps unambiguously to one Spotify artist ID, offer `Convert to Saved Artist`;
- otherwise allow the legacy collection to remain readable/runnable until the user deletes it manually.

No destructive automatic migration is allowed.

## Main-Process Services

Introduce focused services rather than growing `StreamingHub.tsx` or `spotify.cjs` further.

### `spotify-catalog-client.cjs`

Responsibilities:

- PKCE token exchange/refresh;
- authenticated Spotify API requests;
- pagination helper;
- source inspection for artist/album/track/playlist/search;
- exact artist metadata lookup;
- complete artist release/track traversal;
- request retry for transient 429/5xx responses using bounded backoff and `Retry-After` where supplied;
- structured API errors with no token leakage.

### `saved-artist-store.cjs`

Responsibilities:

- list/get/upsert/delete saved artists;
- preserve selected track IDs across refresh;
- compute new-track counts;
- atomic persistence and schema migration.

### `streaming-source-inspector.cjs`

Responsibilities:

- classify input;
- return candidate artists;
- preserve playlist artist counts;
- return one selected artist when unambiguous;
- never fetch arbitrary unrelated tracks.

### `streaming-artist-service.cjs`

Responsibilities:

- orchestrate full catalog fetch;
- enforce exact artist-ID filtering;
- deduplicate recordings;
- compare previous/new catalogs;
- mark `NEW` and unavailable tracks;
- produce complete/partial/failed status.

## Renderer/Main IPC

Add or replace catalog IPC with explicit operations:

```text
streaming:getCatalogConnectionStatus
streaming:connectCatalog
streaming:disconnectCatalog
streaming:inspectSource
streaming:fetchArtistCatalog
streaming:listSavedArtists
streaming:getSavedArtist
streaming:saveArtistSelection
streaming:refreshSavedArtist
streaming:setArtistAutoRefresh
streaming:deleteSavedArtist
streaming:listLegacyCollections
streaming:convertLegacyCollection
```

The existing playback-account IPC remains separate.

Renderer responses never include OAuth access/refresh tokens.

## Error and Progress States

Catalog work may take multiple paginated requests. The UI must expose real progress rather than appearing frozen:

```text
Resolving artist…
Fetching releases 3/8 pages…
Reading release 24/67…
Filtering credited tracks…
Deduplicating recordings…
127 unique artist tracks found
```

Possible terminal states:

- `complete` — all pages/releases succeeded;
- `partial` — some release/page requests failed after retry; result may be inspected but cannot be labeled complete;
- `failed` — artist/source could not be resolved or no usable catalog was obtained.

A partial result must display a warning and the failed-page/release count. `Select All` remains available, but the UI must not describe a partial result as "all artist songs".

## API Reliability Rules

- Respect Spotify pagination until `next` is null.
- Respect rate-limit responses and bounded retry timing.
- Abort cleanly when the user presses Clear Workspace, changes platform, or navigates away.
- Do not launch uncontrolled parallel requests for every release; use a bounded catalog-request concurrency.
- Cache successful artist catalogs locally and refresh intentionally.
- Do not fall back to HTML scraping and silently claim completeness if the API connection fails.

## Testing Strategy

Every production change follows red-green TDD.

### Domain and Store Tests

Verify:

- exact artist ID is the unique saved-artist identity;
- duplicate imports merge into one artist record;
- selected track IDs persist across refresh;
- new tracks are detected without being auto-selected;
- removed/unavailable tracks do not silently erase historical selection;
- delete affects only the selected saved artist;
- legacy collections remain untouched unless explicitly converted.

### Spotify Catalog Fixture Tests

Use deterministic fixtures covering:

- artist with more than one page of releases;
- release with more than one page of tracks;
- album with one artist;
- album with multiple credited artists;
- track with one artist;
- track with multiple credited artists;
- playlist with several artists where Behavior C requires user selection;
- same recording repeated on single/album/deluxe release;
- exact target artist as featured collaborator;
- similarly named but different artist ID that must be rejected;
- rate-limit retry;
- a failed release page producing `partial` rather than false `complete`.

### Renderer Tests

Verify:

- Collection Name field is absent;
- artist name is displayed automatically;
- artist/album/track unambiguous sources fetch after inspection;
- playlist displays artist chooser and waits for explicit selection;
- fresh catalog starts with 0 selected;
- Select All selects the entire fetched catalog, not just visible rows;
- Clear Selection only unticks;
- Clear Workspace empties input/result/selection/chooser;
- successful save automatically clears workspace;
- Saved Artists cards show correct counts and actions;
- Open/Edit loads checked saved songs;
- Add All New selects newly discovered songs;
- Save Changes can add and remove selected songs;
- Refresh Now preserves selections and identifies new tracks;
- Delete requires confirmation and removes only that artist.

### Integration Tests

Verify:

- imported/saved artist selection feeds the existing Streaming QA run config;
- All Saved Artists and Selected Artists produce the expected union of selected track IDs;
- existing accounts/proxy/session verification remains unchanged;
- normal Run Center QA remains unaffected;
- no raw catalog OAuth tokens appear in IPC, logs, screenshots, or persisted run records.

### Final Verification Gate

Before release handoff, require all of the following on the exact release tree:

```text
npm.cmd run build
npm.cmd test
npm.cmd run test:browser-health
```

Also run the complete Node/Electron regression suite and package integrity test. A release is not described as fully verified if any of these commands is unavailable or failing.

## Acceptance Criteria

1. Pasting a Spotify artist profile resolves the exact artist and fetches the complete paginated credited catalog available through the connected Spotify catalog API.
2. Pasting an album or track with one artist automatically resolves that artist and fetches the artist's complete catalog.
3. Pasting an album or track with multiple artists requires choosing the artist before catalog fetch.
4. Pasting a playlist lists distinct real artists; after choosing one, OrbitQA fetches only that artist's complete catalog.
5. No track from another artist is included unless the exact chosen artist ID is credited on that track.
6. The complete-catalog path does not stop at a first page or fixed release limit.
7. Duplicate appearances of the same recording do not create duplicate selectable songs.
8. The Collection Name input no longer exists.
9. Saved artist name comes automatically from Spotify metadata.
10. A fresh fetched catalog begins with zero selected tracks.
11. Select All selects every eligible fetched track.
12. After selected songs are saved, the import workspace clears automatically.
13. Clear Workspace reliably resets import state without deleting saved artists.
14. Each saved artist is displayed in a structured card with saved/catalog/new counts, last refresh, refresh status, and Auto Refresh state.
15. Open/Edit allows songs to be added or removed from that artist's selected set.
16. Refresh Now refetches the exact artist, preserves existing selection, and marks newly discovered unsaved songs as NEW.
17. Auto Refresh checks stale artist catalogs but does not automatically select new songs.
18. Delete removes only the requested saved artist after confirmation.
19. Re-importing the same Spotify artist updates/opens the existing artist rather than creating a duplicate.
20. Existing legacy Streaming Collections are preserved and not destructively migrated.
21. Saved artists can be used individually or together in the existing authorized Streaming QA run builder.
22. Existing account login, proxy/privacy verification, screenshots, queue modes, Run Center scheduling, pause/resume/stop, and history behavior continue to pass regression tests.
23. The release is not handed off as fully verified until build, frontend tests, browser-health, Node/Electron regression tests, and ZIP integrity checks are all green on the exact packaged tree.
