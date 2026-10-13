# OrbitQA Streaming Accounts, Channel Import, and Mixed Devices Design

## Goal
Make Streaming QA reliable for YouTube Music channel imports and authorized multi-platform account/session QA while simplifying navigation and allowing users to choose exactly which device families participate in Mixed Devices runs.

## Scope
1. YouTube Music channel/artist URLs (`music.youtube.com/channel/...`, `music.youtube.com/@...`) resolve through ordinary YouTube channel surfaces first, then catalog JSON/continuations, then public channel feed fallback.
2. Streaming Hub removes platform tabs and becomes execution-only: playback/device configuration, QA checks, selected music summary, selected accounts summary, and Start Streaming QA.
3. Music Library remains a dedicated subpage containing Link Importer + unified Saved Albums.
4. New Test Accounts subpage contains all account creation/management across all seven platforms.
5. Mixed Devices exposes explicit family selection for Desktop, Android, and iOS. Users may choose any non-empty subset. Work units rotate only across selected families and chosen profiles.
6. Test Accounts supports multi-platform creation from one form. Each selected platform is persisted as a separate platform-specific account entry sharing the supplied label/username/password/session cookie data.
7. Each account row supports Edit, Test Login, Delete, Select for QA, and Proxy policy switching (Direct, Rotating, Static, Smart Mix).
8. Login/session verification is adapter-specific. Stored cookies are tried first. Credential flows use current public login pages where practical. MFA/CAPTCHA/challenge screens produce `needs-verification`, never false success. No challenge bypassing is implemented.

## Account Status Model
- `unverified`: saved but never tested.
- `ready`: authenticated session positively verified.
- `needs-verification`: MFA/CAPTCHA/email code/manual challenge is required.
- `warning`: platform page loaded but session could not be conclusively verified.
- `failed`: navigation/authentication failed.

## Authentication Strategy
Each adapter exposes `authenticate({page,context,account})` and `verifySession({page,account})`.

Common flow:
1. Browser factory installs stored cookie JSON before navigation.
2. Adapter navigates to a platform home/account URL and verifies cookie session.
3. If cookie session is not authenticated and credentials are present, adapter navigates to its current login URL and performs conservative form entry using semantic labels plus selector fallbacks.
4. If MFA/CAPTCHA/challenge is detected, return `NEEDS_VERIFICATION` without bypassing it.
5. On PASS, verifier stores refreshed cookies and last-tested timestamp.

Platform targets:
- Spotify: existing current stepwise email/password logic retained and hardened.
- YouTube Music: Google Account identifier/password flow; 2FA/CAPTCHA becomes needs-verification.
- SoundCloud: sign-in page; email/password where available; challenge becomes needs-verification.
- Deezer: web login email/password form; challenge becomes needs-verification.
- TIDAL: `login.tidal.com` email/login-name step then password; social login is not automated.
- Audiomack: `audiomack.com/login` sign-in form; challenge becomes needs-verification.
- Pandora: `pandora.com/account/sign-in` email/password where region permits; region block becomes warning/failed with clear reason.

## Device Model
`StreamingPlaybackState` and `StreamingRunConfig` gain:
- `mixedDeviceModes: Array<'desktop'|'android'|'ios'>`
- `mixedDeviceProfiles: { desktop: string; android: string; ios: string }`

When `deviceMode === 'mixed'`, the runner builds a rotation list only from selected families. Desktop uses its chosen desktop profile, Android uses the chosen Android profile, iOS uses the chosen iOS profile. Empty mixed selection is rejected in UI and normalization defaults to all three only for backwards compatibility with old saved requests.

## YouTube Channel Resolver
For channel/artist input:
1. Normalize Music URL to ordinary YouTube channel URL (`/channel/<id>/videos` or `/@handle/videos`).
2. Navigate ordinary YouTube surface rather than relying on Music artist page.
3. Capture `ytInitialData` and network catalog JSON.
4. Extract `videoId` values into canonical `https://music.youtube.com/watch?v=<id>` links.
5. If initial payload contains continuation tokens, request/inspect continuation data only when already exposed through page/network responses; no private auth bypass.
6. If still empty and channel ID is known, fetch public Atom feed `https://www.youtube.com/feeds/videos.xml?channel_id=<id>` and convert entries to Music watch URLs.

## Testing
- Exact user channel URL `https://music.youtube.com/channel/UC3o5HxAo2Eyq3YK4t2KnYLA?si=3J2n9MVhLb6IyBA6` must classify as artist and produce YouTube Music track URLs from representative/live-compatible channel data.
- Existing direct YouTube song regression remains.
- Mixed Device subsets: Desktop+Android, Android+iOS, Desktop+iOS, all three, one family.
- Account store edit/update/proxy/status/last-test behavior.
- One adapter authentication contract test per platform, including cookie PASS, credential PASS fixture, and challenge state where applicable.
- Navigation contracts: Streaming Hub has no platform tabs; Music Library and Test Accounts are separate sidebar subpages.
- Full Node suite, Vitest suite when dependencies exist, TypeScript build, syntax checks, archive integrity.

## Safety / UX Constraints
- Authorized QA only; no account creation, CAPTCHA bypass, MFA bypass, social-engagement, ad-click, or artificial engagement behavior.
- Passwords/session secrets never rendered or logged.
- Account edit form shows only booleans for stored password/session existence unless the user supplies replacements.
- Current session cookies are refreshed only after successful verification.
