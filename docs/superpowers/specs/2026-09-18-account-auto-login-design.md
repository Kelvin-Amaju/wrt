# Account Auto Login Design

## Goal
When an authorized test account is saved, OrbitQA immediately opens a persistent supported-browser login verification session for that account. The login engine restores a valid cookie/session first, then falls back to username/email plus password, preferring password-based routes over one-time-code/magic-link routes. The browser remains open until the tester explicitly confirms or cancels.

## Security and session handling
Secrets remain encrypted by the existing account store codec and are never returned in public account objects or logs. A changed password or imported session invalidates any prior ready status. Successful manual confirmation stores refreshed cookies for faster later login. CAPTCHA, MFA, passkey, email/SMS verification and similar platform security challenges are never bypassed; the visible browser remains open for the tester to complete them.

## Save flow
Creating an account or editing its credentials/session starts verification immediately using the form's selected default proxy and Desktop profile. Proxy-only/label-only edits do not unexpectedly open a login browser. Multi-platform saves start one independent verification session per saved platform.

## Login flow
Adapters first navigate to their authenticated home with installed cookies. If not authenticated, they navigate to the official login page, fill identifier fields, prefer any visible password/password-instead action, fill the stored password, submit, and keep the browser session alive. Explicit one-time-code/magic-link actions are not selected automatically.

## Confirmation
An automated PASS means the credential/session login reached an authenticated-looking state, but the account remains pending until the tester clicks MARK VERIFIED. Confirmation rechecks the live session and persists refreshed cookies and verification metadata before closing the browser.
