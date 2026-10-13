# OrbitQA Smart Auto-QA Conclusion Design

## Goal
Make Auto QA reliably understand the visited site type, spend the configured session duration intelligently, complete at least one legitimate safe site action when available, continuously dismiss safe popup Close/X controls, passively observe/count ads without clicking them, keep auxiliary tabs open until fully loaded and observed, and preserve fresh-session proxy/privacy integrity.

## Safety boundary
OrbitQA never clicks advertisements, sponsored CTAs, CAPTCHA/human-verification controls, payment/account actions, destructive actions, or other consequential controls. When no legitimate safe site action exists, it records `No safe action available` after observation instead of fabricating engagement.

## Site strategy
- Blog/news index: observe the index, choose newest timestamped article, otherwise first recent/latest article, otherwise first article candidate; open it and perform article reading.
- Article: read top-to-bottom-to-top; optionally use safe Read More/Next Article/Home navigation only if time remains.
- Downloader/converter/shortlink: identify the URL/text field, enter deterministic QA data, activate the matching legitimate submit/download/convert/shorten action.
- Temporary mail: prefer legitimate Copy, Refresh, Get Mail, New Address, Generate, or similar non-sensitive controls.
- Search/listing/generator/form tool: fill a legitimate safe field and use its matching safe action.
- Generic: use a benign same-origin navigation/control if available.
- Unknown/no-safe-action: observe and record `No safe action available`.

## Timer intelligence
A session budget is derived from the configured session duration. It reserves time for final integrity verification and at least one safe primary action/follow-up. Reading speed, scroll distance, pauses, ad observation dwell, and secondary actions scale with remaining time. Short sessions remain visibly human-paced but faster; long sessions read more slowly and can perform secondary actions. The reading pass must not consume the primary action or final verification reserve.

## Popup/blocker architecture
A continuous monitor runs for the full active QA lifetime, not only at action checkpoints. It searches main document and child frames. Explicit exact safe dismiss controls (`Close`, `X`, `×`, `Cancel`, `Dismiss`, `No thanks`, etc.) are preferred. If normal pointer activation is intercepted by a blocker, OrbitQA may force-activate only the already-verified explicit safe dismiss control, then verifies the blocker is gone. Promotional CTAs such as Continue/Open/Download/Install remain forbidden.

## Advertisement observation
Site analysis records visible ad-like regions (links, ad containers, ad iframes, sponsored labels) with geometry. OrbitQA logs the total visible ad count, visually moves its own QA indicator near ad regions without clicking or dispatching mouse events to the ad, dwells according to the timer budget, and records how many ad regions were observed.

## Auxiliary tabs
A newly opened tab remains in the same BrowserContext/proxy policy. OrbitQA requires a usable document, load event, and `document.readyState === complete` before any close decision. It then performs a minimum visible observation/scroll. If complete load is not confirmed, the tab remains open for later re-check and is never closed merely because a timeout occurred.

## Fresh-session and privacy integrity
Each WorkUnit uses a new BrowserContext, which gives fresh cookies/storage/cache isolation. Permissions are cleared. Locale/timezone context settings stay aligned with the configured WorkUnit; proxy route, direct-IP fallback, WebRTC, locale/timezone, and device consistency checks remain mandatory before completion. No `navigator.webdriver`, platform, CPU, RAM, GPU, or other host values are forged.

## Completion criteria
A WorkUnit can complete only after its required site strategy has either completed one legitimate safe primary action or explicitly recorded that no safe action exists, plus final session/network integrity verification. STOP continues to cancel active and queued work and fully tears down the run.
