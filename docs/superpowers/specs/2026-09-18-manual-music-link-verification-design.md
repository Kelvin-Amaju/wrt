# Manual Music Link Verification Design

## Goal

Make OrbitQA's Music Library trustworthy even when a streaming platform cannot be scraped automatically. Users must be able to save a link manually, open the exact saved link in the chosen device view, visually confirm it, and explicitly mark it verified before the verification window can close.

## Scope

This update is limited to Streaming Music Library storage, verification UI, verification-window lifecycle, IPC/preload contracts, and regression tests. Existing Streaming QA playback, accounts, proxy, importer extraction, and Run Center behavior remain unchanged.

## Manual save workflow

The existing Music Link field remains the single source URL input. Beside FETCH SONGS, add SAVE LINK MANUALLY. Manual save requires a supported platform URL and a user label. OrbitQA auto-detects the platform and infers `track`, `album`, `artist`, or `playlist` from the URL. The user may override the inferred kind.

A manual `track` is saved as a collection containing one track whose URL is the exact/canonical saved link. Manual album/artist/playlist entries may have zero tracks; they remain valid library records for later verification and can receive songs later through the existing ADD SONGS flow. Entries with zero tracks cannot be selected for Streaming QA.

Duplicate detection applies to manual saves exactly as it does to fetched imports.

## Verification model

Both collections and individual saved tracks can carry verification metadata:

- `status`: `unverified` or `verified`
- `verifiedAt`
- `verifiedUrl`
- `verifiedDeviceMode`
- `verifiedDeviceProfile`

Starting verification does not persist `verified`; it creates an in-memory verification session. A successful explicit confirmation writes the metadata atomically to the saved collection/track.

## Verification window lifecycle

VERIFY opens the exact saved URL in a dedicated Electron BrowserWindow using the currently selected Streaming device family/profile. Desktop uses the desktop viewport and UA. Android and iOS use the corresponding OrbitQA mobile viewport/user-agent profiles. If Streaming Hub is set to Mixed Devices, the Music Library exposes a compact `Verify on` selector limited to the mixed families selected in Playback Engine.

The verification BrowserWindow intercepts its close event. While verification is pending, clicking the window close button does not close it; OrbitQA refocuses it. This ensures the link remains visible until the user decides.

After VERIFY is clicked, the library button becomes MARK VERIFIED. Clicking MARK VERIFIED persists verification metadata, then unlocks and closes the verification window. The saved item then shows VERIFIED ✓ with timestamp and device. A verified item also exposes RE-VERIFY to repeat the process.

If navigation itself fails, the verification window remains open on its error page and the item remains unverified.

## UI placement

Music Library keeps its current two main areas:

1. Link Importer: fetch link, manual-save controls, fetched-track list.
2. Saved Music: unified platform-filtered cards.

Rename the saved section presentation from album-only language to `SAVED MUSIC` / `All imported & manually saved music`, while preserving the underlying collection store for compatibility.

Each collection card gets a verification badge and VERIFY / MARK VERIFIED / RE-VERIFY controls. OPEN continues to load its tracks into the workspace. When a saved collection is open, each saved track row receives its own verification control and verification state.

## Data compatibility

Existing collection JSON remains readable. Missing verification fields are treated as unverified. Store schema remains backward compatible; no destructive migration is required.

## Error handling

- Unsupported manual link: block save with clear error.
- Duplicate manual link: show existing duplicate notice and do not create another record.
- Verification session already open: focus existing window instead of opening a duplicate.
- Verification window close attempt before confirmation: prevent close and refocus.
- Collection/track deleted while verification is open: completion returns a clear not-found error and closes only after explicit cleanup.

## Tests

Add tests for:

- manual track/album/artist/playlist saving;
- duplicate protection for manual links;
- collection and track verification persistence;
- locked verification BrowserWindow close behavior;
- exact URL/device profile passed to verification window;
- second click required before verified state is persisted;
- zero-track manual collections cannot be selected for QA;
- legacy collections without verification fields remain readable;
- IPC/preload/type contracts;
- frontend source contracts and focused UI tests where runnable;
- full OrbitQA Node regression suite and syntax/type parsing.
