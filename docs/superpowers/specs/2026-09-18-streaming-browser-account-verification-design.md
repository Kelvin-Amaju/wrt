# Streaming Browser and Account Verification Design

## Goal
Unify OrbitQA Streaming browser support across music verification, Streaming QA, and Test Accounts; redesign verification controls; and make Test Login a visible, user-confirmed flow that can use Direct or any saved proxy mode chosen by the user.

## Approved behavior
- Desktop Streaming uses an installed supported Chromium browser, preferring Google Chrome and falling back to Microsoft Edge.
- Android Streaming uses the same installed Chrome/Edge engine under OrbitQA Android mobile emulation with touch, mobile viewport, and Android UA/profile.
- iOS on Windows uses Playwright WebKit with iPhone/iPad compatibility profiles. The UI must identify this honestly as iOS/WebKit compatibility rather than real Safari hardware.
- The supported-browser decision is centralized and shared by Streaming QA, link verification, and Test Account verification.
- Test Login lets the user choose Direct / No proxy, Rotating Pool, Static Pool, or Smart Mix for each test. The choice is passed only to that test session unless the user separately edits the account default proxy.
- Test Login opens a visible supported browser, attempts the platform's real login flow using stored credentials/session data, and keeps the browser open after automation completes.
- The account is not marked verified until the user presses MARK VERIFIED after visually confirming successful login.
- CAPTCHA, MFA, email codes, Google security checks, and other human verification remain open in the same browser for the user to complete; OrbitQA does not bypass them.
- MARK VERIFIED performs a final session-state check, saves refreshed cookies when available, records browser/device/proxy/time, marks the account verified, and closes the verification browser.
- Cancel Verification closes the pending browser without marking verified.
- Music and account verification controls use the same comfortable card treatment as the existing Mix these device families UI, replacing the current small MARK VERIFIED button.
- Closing an account verification browser early leaves the account pending/unverified; the user can restart Test Login. Music verification retains its existing reopen-while-pending behavior.

## Browser support policy
- Desktop and Android automation: Playwright controls an installed Google Chrome if present, otherwise Microsoft Edge.
- iOS compatibility: Playwright WebKit plus current project iPhone/iPad profiles. No claim of real Safari on Windows.
- System-browser discovery is centralized and returns browser family, executable/channel information, and a support label.
- Hard-coded browser-version claims are removed from Streaming profiles where the actual installed engine can provide a current supported browser. Android/iOS device UAs remain compatibility identities and are isolated to device-profile emulation.

## Account verification lifecycle
1. User selects account and a Test Login proxy mode.
2. OrbitQA starts a visible browser session using that proxy mode.
3. Stored cookies/session are loaded first, then credentials are entered when needed.
4. Automation stops at either a likely signed-in page, a manual challenge, or a readable failure state.
5. Browser stays open and account card enters Pending Confirmation with MARK VERIFIED and CANCEL.
6. MARK VERIFIED checks session state again. PASS stores fresh cookies and verification metadata; WARNING/NEEDS_VERIFICATION leaves the browser open and shows the reason.
7. Successful confirmation closes the browser.

## Verification metadata
Account public state adds optional fields for last verification browser label, device mode/profile, proxy source, and pending verification session id/state. Secrets remain private and never returned to renderer.

## Testing
- Unit tests for browser discovery/policy and installed Chrome/Edge preference.
- Streaming browser factory tests for Desktop/Android using supported installed browser launch policy and iOS WebKit compatibility.
- Account verification manager tests for start/complete/cancel, proxy selection, browser-stays-open, manual challenges, refreshed cookies, and final session check.
- Adapter authentication tests for all seven platforms.
- UI source/contract tests for proxy chooser, pending verification card, MARK VERIFIED, CANCEL, and redesigned verification surface.
- Full runnable OrbitQA Node regression suite, syntax checks, archive integrity, and Windows-side Vitest/build instructions.
