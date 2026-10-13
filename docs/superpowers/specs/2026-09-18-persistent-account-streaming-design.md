# Persistent Account Streaming Design

## Goal

Make Streaming QA operate as one long-lived authorized browser session per selected account. The browser remains open until the user manually closes it or stops the run. The observation range controls only how long a selected track is observed before the account moves to another selected track.

## Safety and scope

This remains an authorized playback/navigation QA workflow. It does not add anti-detection behavior, artificial engagement actions, follow/favorite actions, or mechanisms intended to manufacture stream counts. It only opens selected authorized account sessions, navigates among the user's selected QA tracks, exercises safe playback controls, and verifies that playback remains inside the selected QA set.

## Account browser lifecycle

Each selected account receives exactly one browser session for the run. OrbitQA restores the durable authorized session for that account, authenticates if needed, captures refreshed authorized state, and keeps the session open.

The account browser is closed only when:

1. the user stops the Streaming QA run,
2. the user manually closes that account browser, or
3. startup fails before the account session becomes usable.

An observation timeout must never close the browser.

## Track assignment and rotation

The runner builds one account plan per selected account. Initial tracks are assigned from a seeded shuffled track pool. When the number of accounts is less than or equal to the number of selected tracks, initial assignments are unique. When there are more accounts than tracks, the pool repeats in balanced cycles.

Each account has its own seeded looping deck after the initial assignment. With more than one selected track, the next planned track should differ from the current track where possible.

## Observation range

For every selected track visit, OrbitQA independently chooses a random duration between the configured minimum and maximum observation seconds. Different accounts choose independently. The timer controls only when the worker transitions to another selected track.

## Allowed-song guard

The selected tracks in OrbitQA are the allowed QA pool. After an observation window, OrbitQA may exercise the platform's safe Next control. It then checks the resulting page URL against the selected track URLs.

If the resulting track is one of the selected tracks, OrbitQA may continue with that selected track. If it is not selected, or cannot be identified as selected, OrbitQA navigates directly to the account worker's next planned selected track. It must never continue intentionally on an unrelated recommendation.

## Browser-close behavior

The account worker periodically checks whether its page/context has been closed. If the user manually closes one browser, only that account worker exits. Other account workers continue. If all account browsers are manually closed, the Streaming run finishes normally.

STOP STREAMING aborts the run and closes every browser owned by that run.

## Run metrics

Persistent Streaming QA has one long-lived work unit per selected account, not account x track work units. Track transitions are emitted as logs/checkpoints beneath that account session. The requested work count therefore equals the number of selected accounts.

## Test account library UI

The Test Accounts library becomes denser:

- compact tiles with smaller vertical footprint,
- responsive auto-fit grid with a smaller minimum width,
- search by label/username,
- selected-account count beside saved-account count,
- advanced proxy/device controls remain available but no longer dominate the card height.

Pending login confirmation still expands visibly so MARK VERIFIED remains obvious.

## Playback controls UI

The labels for minimum and maximum observation remain because they now mean exactly what the user requested: the random track observation range. The Slots field is removed from the persistent playback panel because every selected account owns one active browser. The request sent to the backend sets slots/concurrency equal to selected account count for compatibility with Run Center metadata.

## Verification targets

Automated coverage must include:

- 1 account / 1 selected track,
- 5 accounts / 5 tracks with unique initial assignment,
- 10 accounts / 5 tracks with balanced reuse,
- more tracks than accounts,
- random observation selection per transition,
- observation expiry does not close a browser,
- manual close stops one account worker only,
- STOP closes all account browsers,
- Next landing on an unselected URL is corrected to a selected track,
- Next landing on a selected URL is accepted,
- durable authorized session is restored and refreshed without cookie-only downgrade,
- dense account-card source/CSS contracts.
