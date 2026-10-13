# Streaming Hub Managed Artists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace v0.14.3's manually named Streaming Collections with a Spotify-backed Saved Artists workflow that resolves exact artists from artist/album/track/playlist/search inputs, fetches the complete credited catalog, supports select/save/edit/refresh/delete, clears the import workspace after saving, and safely feeds only selected saved tracks into existing Streaming QA runs.

**Architecture:** Keep playback QA, account verification, proxy/privacy enforcement, and Run Center unchanged. Add a dedicated Spotify Catalog subsystem in the Electron main process: protected PKCE catalog authentication, an authenticated Spotify API client, source inspection, complete exact-artist catalog orchestration, and a schema-v2 saved-artist store. The renderer becomes a thin managed-artist UI that talks only through typed IPC and never receives OAuth tokens.

**Tech Stack:** Electron 38 CommonJS main process, Node built-ins (`crypto`, `http`, `fs`, `path`), Electron `safeStorage` and `shell`, Spotify Web API over `fetch`, React 19 + TypeScript, Vite 7, Vitest/Testing Library, Playwright for existing browser-health/runtime tests, Node `node:test` for main-process tests.

**Spec:** `docs/superpowers/specs/2026-09-17-streaming-managed-artists-design.md`

## Global Constraints

- Base implementation is OrbitQA Desktop v0.14.3; release target is v0.15.0.
- Exact Spotify artist ID is the identity key; artist-name string matching never determines ownership.
- Complete catalog traversal follows Spotify pagination until `next` is null; no fixed release or track cap.
- Eligible tracks must credit the exact selected Spotify artist ID.
- Public Spotify HTML scraping is not a fallback for any operation labeled complete.
- Fresh fetched catalogs start with zero selected tracks.
- Collection Name UI is removed; artist name always comes from Spotify metadata.
- Successful save clears the import workspace without deleting saved artists/accounts.
- Refresh discovers new tracks but never auto-selects them.
- Legacy `streaming-collections` files are preserved unless the user explicitly converts or deletes them.
- Catalog OAuth tokens never cross into renderer responses, logs, screenshots, Run Center records, or plaintext persistence.
- CAPTCHA/MFA bypass, artificial engagement, follow/favorite/subscribe automation, and ad-click automation remain unavailable.
- Every production change uses red-green TDD.
- Release handoff requires `npm.cmd run build`, `npm.cmd test`, `npm.cmd run test:browser-health`, the complete Node/Electron regression suite, and ZIP integrity on the exact packaged tree; unavailable checks must be disclosed rather than assumed.

---

## File Structure

**Create**
- `electron/streaming/spotify-catalog-auth.cjs` — protected Client ID/token persistence, PKCE verifier/challenge, loopback callback, refresh/disconnect.
- `electron/streaming/spotify-catalog-auth.test.cjs` — PKCE, token redaction, refresh, disconnect, timeout tests.
- `electron/streaming/spotify-catalog-client.cjs` — authenticated API requests, bounded retry, pagination, Spotify entity fetchers.
- `electron/streaming/spotify-catalog-client.test.cjs` — pagination, 429/5xx retry, abort, exact API request fixture tests.
- `electron/streaming/streaming-source-inspector.cjs` — artist/album/track/playlist/search inspection and candidate artist aggregation.
- `electron/streaming/streaming-source-inspector.test.cjs` — approved playlist behavior C plus single/multi-artist resolution.
- `electron/streaming/streaming-artist-service.cjs` — full catalog traversal, exact-credit filter, dedup, refresh diff, partial/failed status.
- `electron/streaming/streaming-artist-service.test.cjs` — multi-page catalog, exact artist, dedup, partial result, NEW/unavailable fixtures.
- `electron/streaming/saved-artist-store.cjs` — schema-v2 persistence/upsert/delete/selection/auto-refresh.
- `electron/streaming/saved-artist-store.test.cjs` — unique artist identity, selection persistence, merge/delete/schema behavior.
- `electron/streaming/streaming-run-preparer.cjs` — merge selected tracks from saved artists and refresh stale auto-refresh artists before a run.
- `electron/streaming/streaming-run-preparer.test.cjs` — all/selected artist union, dedup, stale refresh, legacy compatibility.
- `src/components/SpotifyCatalogConnectionPanel.tsx` — Client ID/connect/reconnect/disconnect/status UI.
- `src/components/StreamingImportWorkspace.tsx` — source inspect, artist chooser, catalog list, select/clear/save/edit UI.
- `src/components/SavedStreamingArtistsPanel.tsx` — structured saved-artist cards/actions/selection for runs.
- `src/components/LegacyStreamingCollectionsPanel.tsx` — read/run/convert legacy collection subsection.
- `src/components/StreamingImportWorkspace.test.tsx` — import/selection/clear/save/edit behavior.
- `src/components/SavedStreamingArtistsPanel.test.tsx` — cards, refresh, edit, auto-refresh, delete confirmation.

**Modify**
- `src/shared/streaming.ts` — schema-v2 catalog/artist/connection/source/progress/run types and pure helpers.
- `src/shared/streaming.test.ts` — domain normalizers, dedup run-track helpers, statuses.
- `electron/main.cjs` — initialize new catalog services and explicit streaming catalog IPC.
- `electron/preload.cjs` — expose new catalog/saved-artist methods plus progress subscription.
- `src/vite-env.d.ts` — type all new renderer IPC methods without token fields.
- `src/pages/StreamingHub.tsx` — replace collection workflow with catalog connection/import/saved artists while preserving playback/accounts/checks.
- `src/pages/StreamingHub.test.tsx` — end-to-end renderer state expectations for the managed-artist workflow.
- Delete: `src/components/StreamingCatalogPanel.tsx` — remove the old manually named collection UI after `StreamingImportWorkspace` and `LegacyStreamingCollectionsPanel` replace all callers.
- `electron/streaming/collection-store.cjs` — no schema mutation; expose legacy records to compatibility layer only.
- `electron/streaming/collection-store.test.cjs` — verify legacy files remain unchanged.
- `electron/streaming/streaming-session-worker.cjs` — accept canonical selected Spotify track objects produced by saved artists without changing account/proxy safety behavior.
- `electron/streaming/streaming-session-worker.test.cjs` — canonical track lookup regression.
- `electron/streaming/streaming-registry.test.cjs` — run persistence still excludes catalog OAuth material.
- `electron/streaming/frontend-contract.test.cjs` — enforce Collection Name removal/new controls.
- `electron/streaming/streaming-ipc.test.cjs` — explicit IPC contract and token redaction.
- `electron/streaming/streaming-build-contract.test.cjs` — new files/types are compiled/exported.
- `package.json` — version `0.15.0` and include new Node tests in `npm test`.
- `README.md` — document Spotify Catalog Connection, Saved Artists workflow, and legacy collection behavior.

---

### Task 1: Define the schema-v2 Streaming domain and IPC-safe public types

**Files:**
- Modify: `src/shared/streaming.ts`
- Modify: `src/shared/streaming.test.ts`
- Modify: `src/vite-env.d.ts`
- Test: `electron/streaming/streaming-build-contract.test.cjs`

**Interfaces:**
- Produces `SpotifyCatalogConnectionStatus`, `StreamingArtistCandidate`, `StreamingSourceInspection`, `StreamingCatalogTrack`, `StreamingCatalogFetchResult`, `SavedStreamingArtist`, `StreamingCatalogProgress`, and `SavedArtistRunSelection`.
- `SavedStreamingArtist.platformArtistId` is the unique Spotify identity.
- Renderer-facing types contain no access token, refresh token, PKCE verifier, password blob, or session blob.

- [ ] **Step 1: Write failing domain tests**

Add tests asserting the new schema shape and helpers:

```ts
const artist: SavedStreamingArtist = {
  schemaVersion: 2,
  id: 'saved-1',
  platform: 'spotify',
  platformArtistId: 'artist-123',
  artistName: 'Exact Artist',
  artistUrl: 'https://open.spotify.com/artist/artist-123',
  sourceOrigins: [],
  catalogTracks: [],
  selectedTrackIds: [],
  autoRefreshEnabled: true,
  lastFetchStatus: 'never',
  createdAt: '2026-09-17T00:00:00.000Z',
  updatedAt: '2026-09-17T00:00:00.000Z',
};
expect(artist.platformArtistId).toBe('artist-123');
expect(Object.keys(artist)).not.toContain('accessToken');
```

Add pure helper coverage for merging selected canonical track IDs from multiple saved artists without duplicates.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npx vitest run src/shared/streaming.test.ts
node --test electron/streaming/streaming-build-contract.test.cjs
```

Expected: FAIL because the schema-v2 interfaces/helpers do not yet exist.

- [ ] **Step 3: Implement the domain types and normalizers**

Add exact interfaces matching the approved spec, including:

```ts
export type StreamingCatalogFetchStatus = 'complete' | 'partial' | 'failed';

export interface StreamingCatalogTrack extends StreamingTrack {
  spotifyTrackId: string;
  creditedArtistIds: string[];
  creditedArtistNames: string[];
  releaseId?: string;
  releaseName?: string;
  releaseDate?: string;
  isrc?: string;
  alternateReleaseIds?: string[];
  unavailable?: boolean;
  discoveredAt?: string;
}

export interface SavedArtistRunSelection {
  mode: 'all' | 'selected';
  artistIds: string[];
}
```

Extend `StreamingRunConfig` with optional `savedArtistIds?: string[]` while preserving `collectionIds` for legacy Run Again compatibility.

- [ ] **Step 4: Add typed renderer IPC signatures**

Define methods for connection status/connect/disconnect, inspect/fetch/cancel, list/get/save/refresh/auto-refresh/delete saved artists, legacy listing/conversion, and catalog progress subscription. Do not define token-bearing return types.

- [ ] **Step 5: Re-run tests and verify GREEN**

Run the same two commands; expected 0 failures.

- [ ] **Step 6: Commit**

```bash
git add src/shared/streaming.ts src/shared/streaming.test.ts src/vite-env.d.ts electron/streaming/streaming-build-contract.test.cjs
git commit -m "feat: define managed streaming artist domain"
```

---

### Task 2: Add protected Spotify Catalog PKCE authentication

**Files:**
- Create: `electron/streaming/spotify-catalog-auth.cjs`
- Create: `electron/streaming/spotify-catalog-auth.test.cjs`
- Modify: `electron/main.cjs`

**Interfaces:**
- `createSpotifyCatalogAuth({ baseDir, secretCodec, openExternal, fetchImpl, now, randomBytes })`
- Public methods:
  - `getPublicStatus(): { configured:boolean; connected:boolean; clientId?:string; expiresAt?:string; accountLabel?:string }`
  - `configureClientId(clientId:string): PublicStatus`
  - `connect({ timeoutMs?:number }): Promise<PublicStatus>`
  - `getValidAccessToken(): Promise<string>` (main-process only)
  - `disconnect(): PublicStatus`
- Internal persistence file: `<userData>/streaming-catalog/spotify.json`; tokens encoded with the existing `secretCodec`.

- [ ] **Step 1: Write failing PKCE/auth tests**

Cover:

```js
test('builds S256 PKCE and stores tokens only through secretCodec', async () => {
  // inject deterministic verifier/randomBytes, mock openExternal and token endpoint
  // assert authorization URL has code_challenge_method=S256
  // assert persisted file contains encoded blobs, never raw access/refresh tokens
});
```

Also test refresh-before-expiry, disconnect deleting token blobs while retaining configured client ID, OAuth callback state mismatch rejection, callback timeout, and error messages that redact token material.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test electron/streaming/spotify-catalog-auth.test.cjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement PKCE with Node/Electron built-ins**

Use `crypto.randomBytes`, SHA-256 base64url challenge, `http.createServer()` bound to `127.0.0.1` on an ephemeral port, and Electron `shell.openExternal()` injected as `openExternal`. Exchange code at Spotify's token endpoint with `grant_type=authorization_code`, `client_id`, `code_verifier`, and the exact loopback `redirect_uri`. Refresh with `grant_type=refresh_token`.

- [ ] **Step 4: Keep secrets main-process only**

Persist only encoded token blobs; `getPublicStatus()` must construct a fresh allowlisted object and never spread the internal record.

- [ ] **Step 5: Verify GREEN**

Run the auth tests; expected all pass.

- [ ] **Step 6: Commit**

```bash
git add electron/streaming/spotify-catalog-auth.cjs electron/streaming/spotify-catalog-auth.test.cjs electron/main.cjs
git commit -m "feat: add spotify catalog pkce connection"
```

---

### Task 3: Build the authenticated Spotify API client with pagination and bounded retry

**Files:**
- Create: `electron/streaming/spotify-catalog-client.cjs`
- Create: `electron/streaming/spotify-catalog-client.test.cjs`

**Interfaces:**
- `createSpotifyCatalogClient({ auth, fetchImpl, sleep, maxRetries=3 })`
- Produces:
  - `requestJson(pathOrUrl, { signal }={})`
  - `paginate(pathOrUrl, { signal, onPage }={})`
  - `getArtist(id, options)`
  - `getAlbum(id, options)`
  - `getTrack(id, options)`
  - `getPlaylist(id, options)`
  - `getPlaylistTracks(id, options)`
  - `searchArtists(query, options)`
  - `getArtistReleases(id, options)`
  - `getReleaseTracks(id, options)`

- [ ] **Step 1: Write failing fixture tests**

Use injected `fetchImpl` responses to prove pagination continues until `next === null`, and that each request uses `Authorization: Bearer <token>` without exposing it in thrown error text.

Add tests for:
- 429 honoring numeric `Retry-After`;
- 500/502 bounded exponential retry;
- 400/401/403 non-transient errors;
- abort before/inside pagination;
- multi-page release tracks.

- [ ] **Step 2: Verify RED**

```bash
node --test electron/streaming/spotify-catalog-client.test.cjs
```

Expected: module missing/failing behavior.

- [ ] **Step 3: Implement request and pagination helpers**

Normalize Spotify relative paths under `https://api.spotify.com/v1/`. Retry only 429 and 5xx, cap attempts at `maxRetries`, parse `Retry-After` seconds when available, and stop immediately on `AbortSignal.aborted`.

- [ ] **Step 4: Implement exact entity fetchers**

Artist releases must request all groups needed by the spec and follow all pages. Release track retrieval must follow all track pages. Search returns artist entities only.

- [ ] **Step 5: Verify GREEN**

Run the client test file; expected 0 failures.

- [ ] **Step 6: Commit**

```bash
git add electron/streaming/spotify-catalog-client.cjs electron/streaming/spotify-catalog-client.test.cjs
git commit -m "feat: add resilient spotify catalog api client"
```

---

### Task 4: Inspect source inputs and implement playlist behavior C

**Files:**
- Create: `electron/streaming/streaming-source-inspector.cjs`
- Create: `electron/streaming/streaming-source-inspector.test.cjs`

**Interfaces:**
- `createStreamingSourceInspector({ spotifyClient })`
- `inspect({ input, signal }): Promise<StreamingSourceInspection>`
- `StreamingSourceInspection` includes `kind`, normalized source ID, `candidateArtists`, and `autoSelectedArtistId?: string`.
- Candidate artist shape: `{ platformArtistId, artistName, artistUrl, artworkUrl?, sourceTrackCount? }`.

- [ ] **Step 1: Write failing source-inspection tests**

Fixtures must verify:

```js
test('playlist returns distinct artists and does not auto-select one', async () => {
  const result = await inspector.inspect({ input:'https://open.spotify.com/playlist/p1' });
  assert.equal(result.kind, 'playlist');
  assert.deepEqual(result.candidateArtists.map(a=>a.platformArtistId), ['a1','a2','a3']);
  assert.equal(result.autoSelectedArtistId, undefined);
});
```

Also test artist URL auto-selects exact artist, single-artist album/track auto-selects, multi-artist album/track waits for a choice, and search returns artist candidates only.

- [ ] **Step 2: Verify RED**

```bash
node --test electron/streaming/streaming-source-inspector.test.cjs
```

- [ ] **Step 3: Implement strict URL classification and entity resolution**

Parse canonical `open.spotify.com/{artist|album|track|playlist}/<id>` URLs ignoring query strings. For playlists, paginate every track page through the client, aggregate artists by ID, and count how many playlist tracks credit each artist.

- [ ] **Step 4: Prevent mixed-track import behavior**

The inspector returns candidates only. It must not return an arbitrary mixed playlist/album track list as the final catalog.

- [ ] **Step 5: Verify GREEN and commit**

```bash
node --test electron/streaming/streaming-source-inspector.test.cjs
git add electron/streaming/streaming-source-inspector.cjs electron/streaming/streaming-source-inspector.test.cjs
git commit -m "feat: resolve streaming sources to exact artists"
```

---

### Task 5: Fetch the complete exact-artist catalog and deduplicate recordings

**Files:**
- Create: `electron/streaming/streaming-artist-service.cjs`
- Create: `electron/streaming/streaming-artist-service.test.cjs`

**Interfaces:**
- `createStreamingArtistService({ spotifyClient, savedArtistStore?, now, catalogConcurrency=4 })`
- `fetchCatalog({ platformArtistId, previousArtist?, signal, onProgress }): Promise<StreamingCatalogFetchResult>`
- `refreshSavedArtist({ savedArtistId, signal, onProgress })`
- `StreamingCatalogFetchResult.status` is `complete | partial | failed` and includes completeness counters plus normalized tracks.

- [ ] **Step 1: Write failing complete-catalog fixtures**

Use deterministic fixtures for:
- more than one release page;
- more than one track page in a release;
- selected artist primary credit;
- selected artist featured/collaborator credit;
- similarly named different artist ID rejected;
- same recording on single/album/deluxe deduplicated;
- live/remix/acoustic versions kept when metadata differs;
- one release request failing after retries produces `partial`, never `complete`;
- `onProgress` receives resolving/releases/release-tracks/filtering/deduplicating/complete stages.

- [ ] **Step 2: Verify RED**

```bash
node --test electron/streaming/streaming-artist-service.test.cjs
```

- [ ] **Step 3: Implement bounded release traversal**

Fetch all release pages, deduplicate release IDs, process releases with at most `catalogConcurrency` active requests, and collect failed release/page IDs instead of launching unbounded promises.

- [ ] **Step 4: Enforce exact-credit filtering and normalization**

Keep a track only when `track.artists.some(a => a.id === platformArtistId)`. Normalize canonical track ID/URL, title, duration, release metadata, credited IDs/names, artwork, release date, ISRC, and availability.

- [ ] **Step 5: Implement recording dedup order exactly**

Use:
1. Spotify track ID;
2. ISRC;
3. normalized title + bounded duration tolerance + sorted exact credited artist ID set.

Merge alternate release IDs onto the kept row.

- [ ] **Step 6: Compute refresh differences**

When `previousArtist` is supplied, preserve prior selected IDs, tag newly discovered unsaved tracks with `discoveredAt`, and keep missing historical catalog rows as `unavailable: true` rather than erasing them.

- [ ] **Step 7: Verify GREEN and commit**

```bash
node --test electron/streaming/streaming-artist-service.test.cjs
git add electron/streaming/streaming-artist-service.cjs electron/streaming/streaming-artist-service.test.cjs
git commit -m "feat: fetch complete exact artist catalogs"
```

---

### Task 6: Persist Saved Artists and preserve legacy collections

**Files:**
- Create: `electron/streaming/saved-artist-store.cjs`
- Create: `electron/streaming/saved-artist-store.test.cjs`
- Modify: `electron/streaming/collection-store.cjs`
- Modify: `electron/streaming/collection-store.test.cjs`

**Interfaces:**
- `createSavedArtistStore({ baseDir, now })`
- Methods: `list()`, `get(id)`, `getByPlatformArtistId(platformArtistId)`, `upsertArtist(input)`, `saveSelection(id, selectedTrackIds)`, `setAutoRefresh(id, enabled)`, `delete(id)`.
- Persistence directory: `<userData>/streaming-artists/`.

- [ ] **Step 1: Write failing store tests**

Verify that importing the same `platformArtistId` twice updates one record and merges `sourceOrigins` rather than creating duplicates.

Verify selection persistence across catalog refresh, new-track counts, unavailable historical selection retention, auto-refresh persistence, atomic temp-file rename, and deletion isolation.

- [ ] **Step 2: Verify RED**

```bash
node --test electron/streaming/saved-artist-store.test.cjs electron/streaming/collection-store.test.cjs
```

- [ ] **Step 3: Implement schema-v2 store**

Use a JSON file per saved artist and an atomic write function consistent with the current collection/account stores. `artistName` is always taken from catalog metadata, never renderer input.

- [ ] **Step 4: Preserve legacy collection files verbatim**

Do not move, rewrite, or delete `streaming-collections/*.json` on startup. Add read-only helpers needed by the legacy UI and explicit conversion path.

- [ ] **Step 5: Implement explicit legacy conversion**

Convert only when every legacy Spotify track can be mapped to one exact artist ID supplied by verified catalog metadata; otherwise return `{ converted:false, reason }` and leave the original file untouched.

- [ ] **Step 6: Verify GREEN and commit**

```bash
node --test electron/streaming/saved-artist-store.test.cjs electron/streaming/collection-store.test.cjs
git add electron/streaming/saved-artist-store.cjs electron/streaming/saved-artist-store.test.cjs electron/streaming/collection-store.cjs electron/streaming/collection-store.test.cjs
git commit -m "feat: persist managed streaming artists"
```

---

### Task 7: Wire explicit catalog IPC, cancellation, progress, and token isolation

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `electron/streaming/streaming-ipc.test.cjs`
- Modify: `electron/streaming/streaming-registry.test.cjs`
- Modify: `src/vite-env.d.ts`

**Interfaces:**
- IPC handlers from the approved spec plus `streaming:cancelCatalogOperation`.
- Push event `streaming:catalogProgress` with `{ operationId, stage, message, completed?, total? }`.
- Each inspect/fetch/refresh request carries an `operationId`; main process owns the `AbortController` map.

- [ ] **Step 1: Write failing IPC contract tests**

Assert handlers exist for:

```text
streaming:getCatalogConnectionStatus
streaming:connectCatalog
streaming:disconnectCatalog
streaming:inspectSource
streaming:fetchArtistCatalog
streaming:cancelCatalogOperation
streaming:listSavedArtists
streaming:getSavedArtist
streaming:saveArtistSelection
streaming:refreshSavedArtist
streaming:setArtistAutoRefresh
streaming:deleteSavedArtist
streaming:listLegacyCollections
streaming:convertLegacyCollection
streaming:refreshStaleSavedArtists
```

Assert JSON serialization of every public response contains none of `access_token`, `refresh_token`, `passwordBlob`, `sessionBlob`, or PKCE verifier values.

- [ ] **Step 2: Verify RED**

```bash
node --test electron/streaming/streaming-ipc.test.cjs electron/streaming/streaming-registry.test.cjs
```

- [ ] **Step 3: Initialize new services in `app.whenReady()`**

Reuse the existing `secretCodec`; inject `shell.openExternal`, `safeStorage`, `app.getPath('userData')`, and `fetch` into auth/client creation. Keep playback account store/browser factory separate.

- [ ] **Step 4: Replace primary `streaming:resolveCatalog` use**

Keep the old `streaming:resolveCatalog` handler only for legacy collections and existing non-Spotify platform catalog behavior. The new Spotify Saved Artist renderer path must never call it; it uses inspect + exact catalog IPC exclusively.

- [ ] **Step 5: Add operation cancellation/progress**

Create an AbortController per operation ID. `Clear Workspace`, platform changes, and renderer unmount call cancel. Delete the controller from the map on completion/failure.

- [ ] **Step 6: Verify GREEN and commit**

```bash
node --test electron/streaming/streaming-ipc.test.cjs electron/streaming/streaming-registry.test.cjs
git add electron/main.cjs electron/preload.cjs electron/streaming/streaming-ipc.test.cjs electron/streaming/streaming-registry.test.cjs src/vite-env.d.ts
git commit -m "feat: expose managed artist catalog ipc"
```

---

### Task 8: Replace Collection Name/import chips with the managed import workspace

**Files:**
- Create: `src/components/SpotifyCatalogConnectionPanel.tsx`
- Create: `src/components/StreamingImportWorkspace.tsx`
- Create: `src/components/StreamingImportWorkspace.test.tsx`
- Modify: `src/pages/StreamingHub.tsx`
- Modify: `src/pages/StreamingHub.test.tsx`
- Delete: `src/components/StreamingCatalogPanel.tsx`
- Modify: `electron/streaming/frontend-contract.test.cjs`
- Modify: `src/styles.css`

**Interfaces:**
- `StreamingImportWorkspace` consumes connection state, source input, inspection/candidate state, chosen artist, catalog result, selection, progress, and callbacks for inspect/fetch/select/save/clear/edit.
- Save callback accepts only `{ savedArtistId?, platformArtistId, selectedTrackIds, sourceOrigin }`; artist name is not user-entered.

- [ ] **Step 1: Write failing renderer tests**

Verify:
- no `Collection name` field exists;
- disconnected catalog shows Client ID + Connect control and disables complete-catalog import;
- artist source auto-selects exact artist;
- multi-artist playlist shows chooser and does not fetch until user selects an artist;
- fresh catalog renders `N songs found` and `0 selected`;
- Select All selects the entire catalog even when only part is rendered;
- Clear Selection leaves the catalog/input intact;
- Clear Workspace empties source/chooser/catalog/selection/progress;
- `ADD N SELECTED SONGS` is disabled at 0;
- save uses artist metadata name and clears workspace after success.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run src/components/StreamingImportWorkspace.test.tsx src/pages/StreamingHub.test.tsx
node --test electron/streaming/frontend-contract.test.cjs
```

- [ ] **Step 3: Implement catalog connection panel**

Render only public connection fields. `Connect Spotify Catalog` calls `connectCatalog`; `Reconnect` reauthorizes; `Disconnect` requires a simple confirmation and updates status.

- [ ] **Step 4: Implement import state machine**

Explicit states: `idle -> inspecting -> choose-artist? -> fetching -> ready|partial|failed -> saving`. Generate an operation ID per inspect/fetch, subscribe to progress events, and cancel on Clear Workspace/unmount/platform change.

- [ ] **Step 5: Implement exact selection behavior**

Fresh fetch sets `selected = new Set()`. `Select All` derives IDs from the full `catalogTracks`, not visible rows. `Clear Selection` only empties the set. `Clear Workspace` resets all temporary import state.

- [ ] **Step 6: Implement successful-save reset**

After `saveArtistSelection` resolves, show a toast such as `Saved 86 songs for Artist Name`, reload Saved Artists, then clear the import workspace automatically.

- [ ] **Step 7: Retire old collection UI from the primary path**

Remove `collectionName`, `setCollectionName`, and collection chips from `StreamingHub.tsx`. Delete `StreamingCatalogPanel.tsx` after `StreamingImportWorkspace` and `LegacyStreamingCollectionsPanel` replace every caller; legacy rendering must use the dedicated legacy panel, not the obsolete collection editor.

- [ ] **Step 8: Verify GREEN and commit**

Run the same Vitest and Node contract commands; expected 0 failures.

```bash
git add -A src/components/SpotifyCatalogConnectionPanel.tsx src/components/StreamingImportWorkspace.tsx src/components/StreamingImportWorkspace.test.tsx src/pages/StreamingHub.tsx src/pages/StreamingHub.test.tsx src/components/StreamingCatalogPanel.tsx src/styles.css electron/streaming/frontend-contract.test.cjs
git commit -m "feat: redesign streaming artist import workspace"
```

---

### Task 9: Add structured Saved Artists cards with edit, refresh, auto-refresh, and delete

**Files:**
- Create: `src/components/SavedStreamingArtistsPanel.tsx`
- Create: `src/components/SavedStreamingArtistsPanel.test.tsx`
- Modify: `src/pages/StreamingHub.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Card actions: `onOpenEdit(id)`, `onRefresh(id)`, `onSetAutoRefresh(id, enabled)`, `onDelete(id)`.
- Run selection: `selectedArtistIds: Set<string>` and `onSelectedArtistIdsChange`.
- Edit mode loads the latest cached `catalogTracks`, preselects exactly `selectedTrackIds`, and exposes NEW unsaved rows.

- [ ] **Step 1: Write failing card/edit tests**

Verify each card shows artist name, saved/catalog/new counts, last refresh, refresh status, and auto-refresh state.

Verify Open/Edit checks saved songs, `Add All New` adds only tracks that are NEW and unsaved, Save Changes can both add and remove selected track IDs, Refresh Now preserves saved selection, and Delete requires confirmation containing the artist name.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run src/components/SavedStreamingArtistsPanel.test.tsx src/pages/StreamingHub.test.tsx
```

- [ ] **Step 3: Implement structured cards**

Replace small collection chips with full cards. Use status labels `Complete`, `Partial`, `Failed`, `Never refreshed`; never label a partial catalog as complete/all songs.

- [ ] **Step 4: Implement edit mode in the shared import workspace**

Opening a saved artist bypasses source inspection and loads cached catalog. Saving changes replaces `selectedTrackIds` only; catalog rows remain cached.

- [ ] **Step 5: Implement refresh and NEW behavior**

Refresh calls main process for the exact saved artist ID. Newly discovered unsaved tracks show `NEW`; existing selected tracks remain checked; missing historical selected tracks remain represented as unavailable.

- [ ] **Step 6: Implement delete isolation**

Confirmation text includes the artist name. On success remove only that saved artist from renderer state; do not touch accounts, legacy collections, or completed runs.

- [ ] **Step 7: Verify GREEN and commit**

```bash
npx vitest run src/components/SavedStreamingArtistsPanel.test.tsx src/pages/StreamingHub.test.tsx
git add src/components/SavedStreamingArtistsPanel.tsx src/components/SavedStreamingArtistsPanel.test.tsx src/pages/StreamingHub.tsx src/styles.css
git commit -m "feat: manage saved streaming artists"
```

---

### Task 10: Add auto-refresh freshness rules and Saved Artist run preparation

**Files:**
- Create: `electron/streaming/streaming-run-preparer.cjs`
- Create: `electron/streaming/streaming-run-preparer.test.cjs`
- Modify: `electron/main.cjs`
- Modify: `src/pages/StreamingHub.tsx`
- Modify: `src/shared/streaming.ts`
- Modify: `electron/streaming/streaming-session-worker.cjs`
- Modify: `electron/streaming/streaming-session-worker.test.cjs`

**Interfaces:**
- `createStreamingRunPreparer({ savedArtistStore, artistService, freshnessMs })`
- `prepare({ savedArtistIds, mode, signal, onProgress }): Promise<{ tracks: StreamingCatalogTrack[]; refreshedArtistIds:string[]; warnings:string[] }>`
- `refreshStaleSavedArtists({ reason:'hub-open'|'pre-run', signal, onProgress }): Promise<{ refreshedArtistIds:string[]; warnings:string[] }>`
- Default freshness window: 6 hours, represented by one exported constant so tests can inject/override time.

- [ ] **Step 1: Write failing run-preparer tests**

Verify:
- `mode:'all'` uses every saved artist with at least one selected track;
- `mode:'selected'` uses only requested saved artist IDs;
- only `selectedTrackIds` enter the run;
- duplicate canonical Spotify track IDs across artists are merged once;
- stale `autoRefreshEnabled` artists refresh before the run;
- fresh artists do not refresh;
- refresh discovers new songs but does not add them unless selected;
- partial refresh emits a warning but preserves the last safe selected cached set;
- legacy inline/collection Run Again requests remain executable.

- [ ] **Step 2: Verify RED**

```bash
node --test electron/streaming/streaming-run-preparer.test.cjs electron/streaming/streaming-session-worker.test.cjs
```

- [ ] **Step 3: Implement run preparation**

Resolve selected canonical track objects in main process, perform freshness checks, merge/dedup tracks, then pass the prepared `inlineTracks` into the existing Run Registry streaming request. Do not alter account/proxy verification semantics.

- [ ] **Step 4: Implement hub-open Auto Refresh**

After Saved Artists load, call `streaming:refreshStaleSavedArtists` once for stale records with `autoRefreshEnabled=true`. The main process applies the same 6-hour freshness rule used pre-run, refreshes with bounded concurrency, and returns warnings without auto-selecting discovered tracks. Reload cards after any refresh completes.

- [ ] **Step 5: Implement Streaming Hub run target controls**

Add `All Saved Artists` and `Selected Artists` targeting. Disable Start if the resulting selected saved-track set is empty.

- [ ] **Step 6: Preserve account/proxy/session safety**

Keep the existing browser factory, assigned proxy route verification, WebRTC checks, authenticated playback-account sessions, and screenshot settings unchanged.

- [ ] **Step 7: Verify GREEN and commit**

```bash
node --test electron/streaming/streaming-run-preparer.test.cjs electron/streaming/streaming-session-worker.test.cjs
git add electron/streaming/streaming-run-preparer.cjs electron/streaming/streaming-run-preparer.test.cjs electron/main.cjs src/pages/StreamingHub.tsx src/shared/streaming.ts electron/streaming/streaming-session-worker.cjs electron/streaming/streaming-session-worker.test.cjs
git commit -m "feat: prepare saved artists for streaming qa runs"
```

---

### Task 11: Surface Legacy Collections without destructive migration

**Files:**
- Create: `src/components/LegacyStreamingCollectionsPanel.tsx`
- Modify: `src/pages/StreamingHub.tsx`
- Modify: `src/pages/StreamingHub.test.tsx`
- Modify: `electron/streaming/collection-store.test.cjs`

**Interfaces:**
- Legacy panel appears only when legacy records exist.
- Actions: Load/Run legacy record, Convert when exact one-artist mapping is available, Delete only via the existing explicit legacy delete action.

- [ ] **Step 1: Write failing renderer/persistence tests**

Verify no Legacy Collections heading when list is empty; heading/cards appear when records exist; failed conversion leaves source JSON byte-for-byte intact; successful conversion creates/updates one Saved Artist and leaves legacy source intact until explicit deletion.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run src/pages/StreamingHub.test.tsx
node --test electron/streaming/collection-store.test.cjs
```

- [ ] **Step 3: Implement the compatibility panel**

Keep this subsection visually secondary to Saved Artists. Do not mix legacy cards into the primary managed artist grid.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx vitest run src/pages/StreamingHub.test.tsx
node --test electron/streaming/collection-store.test.cjs
git add src/components/LegacyStreamingCollectionsPanel.tsx src/pages/StreamingHub.tsx src/pages/StreamingHub.test.tsx electron/streaming/collection-store.test.cjs
git commit -m "feat: preserve legacy streaming collections"
```

---

### Task 12: Complete integration, regression coverage, documentation, and v0.15.0 release verification

**Files:**
- Modify: `electron/streaming/frontend-contract.test.cjs`
- Modify: `electron/streaming/streaming-build-contract.test.cjs`
- Modify: `electron/streaming/streaming-ipc.test.cjs`
- Modify: `electron/streaming/streaming-registry.test.cjs`
- Modify: `package.json`
- Modify: `README.md`
- Create: `V0.15.0-STREAMING-MANAGED-ARTISTS.txt`

**Interfaces:**
- `npm test` must execute every new main-process test file.
- Package version must be exactly `0.15.0`.
- Final artifact filename: `orbitqa-v0.15.0-streaming-managed-artists.zip`.

- [ ] **Step 1: Add final integration tests before release changes**

Add tests proving:
- Collection Name text no longer exists in the primary Streaming Hub source;
- exact artist-ID filter is main-process enforced;
- playlist behavior C waits for artist selection;
- successful save clears import state;
- Saved Artists Run builder uses only saved selections;
- OAuth tokens are absent from IPC/log/run serialization;
- existing playback account/password/session/proxy APIs still have their expected signatures;
- normal non-streaming Run Center tests remain unchanged.

- [ ] **Step 2: Run targeted managed-artist suite**

Run:

```bash
node --test electron/streaming/spotify-catalog-auth.test.cjs electron/streaming/spotify-catalog-client.test.cjs electron/streaming/streaming-source-inspector.test.cjs electron/streaming/streaming-artist-service.test.cjs electron/streaming/saved-artist-store.test.cjs electron/streaming/streaming-run-preparer.test.cjs electron/streaming/streaming-ipc.test.cjs
npx vitest run src/components/StreamingImportWorkspace.test.tsx src/components/SavedStreamingArtistsPanel.test.tsx src/pages/StreamingHub.test.tsx src/shared/streaming.test.ts
```

Expected: 0 failures.

- [ ] **Step 3: Update version/docs/test script**

Set `package.json` version to `0.15.0`, append every new Node test to the `test` script, document the Catalog Connection + Saved Artists workflow, and add a release note describing legacy preservation and the no-scrape completeness rule.

- [ ] **Step 4: Run the exact release build**

On a dependency-complete environment run:

```bash
npm.cmd run build
npm.cmd test
npm.cmd run test:browser-health
```

Expected: all exit 0 with zero failed tests.

- [ ] **Step 5: Run the full Node/Electron regression directly**

Run the same Node/Electron files used by `npm test` (including every new managed-artist test) and confirm 0 fail/0 skipped unless a skip is explicitly documented.

- [ ] **Step 6: Verify secret leakage and source syntax**

Search the exact release tree and representative persisted/run fixtures for raw OAuth token strings. Run `node --check` over every `.cjs` file and the project TypeScript build from Step 4.

- [ ] **Step 7: Package and integrity-check**

Create:

```text
/mnt/data/orbitqa-v0.15.0-streaming-managed-artists.zip
```

Run:

```bash
unzip -t /mnt/data/orbitqa-v0.15.0-streaming-managed-artists.zip
```

Expected: `No errors detected in compressed data`.

- [ ] **Step 8: Commit**

```bash
git add package.json README.md V0.15.0-STREAMING-MANAGED-ARTISTS.txt electron src
git commit -m "release: orbitqa v0.15.0 managed streaming artists"
```

---

## Plan Self-Review

**Spec coverage:** Tasks 1-12 cover exact artist identity, PKCE catalog connection, artist/album/track/playlist/search inspection, playlist behavior C, full pagination, exact-credit filtering, deduplication, partial-state handling, automatic artist naming, zero-selected initial state, workspace clearing, saved artist cards/edit/refresh/auto-refresh/delete, legacy preservation, run integration, progress/cancellation, secret isolation, and final release verification.

**Type consistency:** Renderer uses `SavedStreamingArtist`, `StreamingCatalogTrack`, `StreamingSourceInspection`, `StreamingCatalogFetchResult`, and `StreamingCatalogProgress` from `src/shared/streaming.ts`; main-process services return shapes compatible with those public types. `savedArtistIds` is optional in `StreamingRunConfig` so historical v0.14.x Run Again payloads remain valid.

**Scope check:** This plan changes the Streaming Hub catalog/source-management subsystem and its run-input preparation only. Existing playback account login, browser/proxy/privacy engine, queue planner, rest policy, screenshots, and generic QA Run Center behavior are intentionally not redesigned.
