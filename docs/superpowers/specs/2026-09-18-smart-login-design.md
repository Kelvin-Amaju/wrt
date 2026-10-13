# Smart Login Design

## Goal
Make Streaming Test Accounts establish and reuse reliable authorized sessions without depending on cookies alone, while keeping normal password login as a clean fallback and preserving the tester's final visual confirmation.

## User flow
1. Saving or re-testing an account starts a visible verification browser.
2. OrbitQA first restores the account's encrypted saved session snapshot.
3. The platform home is opened and the session is verified twice.
4. If the restored session is active, the browser stays open for MARK VERIFIED.
5. If the restored state is stale, incomplete, or lands on a transient error such as "Something went wrong", OrbitQA retries the page once.
6. If it is still not active, OrbitQA closes that session and opens a clean supported browser context using the same selected proxy/device.
7. OrbitQA performs the platform's normal username/email + password flow, preferring password over magic-link/code alternatives.
8. CAPTCHA, MFA, passkeys, device confirmation, or required one-time codes remain manual and keep the browser open.
9. MARK VERIFIED performs a final live-session check. Only after PASS does OrbitQA capture a fresh Playwright storage state, including IndexedDB where supported, encrypt it in the account store, mark the account ready, and close the browser.

## Session format
The existing encrypted `sessionBlob` remains the storage field for backward compatibility. Its plaintext may be:
- legacy cookie JSON array;
- legacy `{cookies:[...]}` object;
- raw `name=value; ...` cookie string;
- Smart Login envelope:
  `{ "version": 2, "kind": "playwright-storage-state", "capturedAt": "...", "storageState": { "cookies": [...], "origins": [...] } }`.

Public account objects never expose the snapshot or password.

## Components
- `streaming-browser-factory.cjs`: parse legacy and v2 session formats; restore full `storageState` at context creation; support `ignoreStoredSession` for clean credential fallback.
- `account-verification-manager.cjs`: orchestrate session restore -> retry -> clean credential login, keep only the successful/pending browser open, and capture full storage state on MARK VERIFIED.
- `adapters/_auth.cjs`: expose transient-page detection and keep credential login responsible only for clean form authentication.
- `account-store.cjs`: keep encrypted persistence and invalidation semantics; no public secret exposure.

## Error handling
- A passive reCAPTCHA notice is not a challenge.
- A visible CAPTCHA/MFA/OTP field is a manual challenge.
- Generic transient error pages never count as authenticated.
- Stored session failure never marks the account ready and never blocks a clean credential fallback.
- Credential failure leaves the clean browser open with a precise reason.
- No repeated password hammering: one clean credential attempt per verification start.

## Security
- Password/session snapshot remains encrypted using the existing secret codec.
- No passwords/session payloads are logged or returned to the renderer.
- Security challenges are not bypassed.
- MARK VERIFIED remains human-controlled final confirmation.

## Verification
Add tests for full storage-state parsing/restoration, legacy cookie compatibility, IndexedDB capture fallback, stale session -> clean login, transient-error retry -> clean login, proxy/device preservation across fallback, real challenge pending behavior, and all seven platform adapters. Run focused Streaming tests, the complete runnable Node suite, syntax/source checks, and patch-rehearsal tests.
