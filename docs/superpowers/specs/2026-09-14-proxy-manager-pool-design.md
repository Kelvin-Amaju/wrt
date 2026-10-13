# OrbitQA Proxy Manager v0.6 Design

## Purpose

Build a professional multi-proxy management subsystem for authorized QA testing. OrbitQA will maintain one internal proxy pool with two user-facing categories: **Rotating / Gateway** and **Static / Dedicated**. The subsystem will import, normalize, test, classify, retest, allocate, and safely hand verified proxies to Test Runs without silently falling back to the host network.

This feature is for legitimate QA, compatibility, network-path, localization, and privacy testing. It must not include stealth fingerprint spoofing, anti-detection, or mechanisms intended to impersonate a real person or conceal automation from a site. Browser/device identity checks remain truthful. A later QA interaction feature may vary normal test pacing for realism, but it may not falsify browser, hardware, WebRTC, canvas, WebGL, or OS identity.

## User Experience

The existing **Proxy Manager** placeholder becomes a working page with a dark, original OrbitQA layout inspired by the user's reference without copying it. The page contains:

- summary cards for Total, Live, Slow, Dead/Unavailable, and Testing;
- tabs for **Rotating Pool** and **Static Pool**;
- a proxy table with protocol, masked endpoint, observed exit IP, country when detectable, latency, health, consecutive failures, last checked time, next check time, enabled state, and actions;
- buttons for **Add Proxies**, **Import**, **Test All**, **Test Selected**, **Retest Dead**, **Enable / Disable**, **Delete**, and **Export Safe List**;
- a Health Activity panel that never exposes proxy credentials;
- an import dialog that accepts many lines at once and reports accepted, duplicate, and invalid rows separately.

The page must remain usable with hundreds of entries. V0.6 may use client-side table filtering and pagination rather than virtualization unless performance testing shows virtualization is needed.

## Proxy Types and Supported Input

One backend model stores every proxy. `kind` determines which UI tab and allocation policy applies:

- `rotating`: gateway/residential/mobile endpoints whose observed exit IP may legitimately change between tests;
- `static`: dedicated endpoints expected to retain the same observed exit IP unless the user edits or replaces them.

Supported protocols:

- HTTP
- HTTPS
- SOCKS5

Accepted import formats:

```text
host:port
host:port:user:pass
http://host:port
http://user:pass@host:port
https://user:pass@host:port
socks5://user:pass@host:port
```

For ambiguous protocol-less imports, OrbitQA defaults to `http://` and visibly labels the normalized protocol so the user can edit it.

Duplicate detection is based on normalized protocol + hostname + port + username. Password differences alone do not create separate duplicate entries for the same normalized endpoint/user combination; the latest explicitly imported password replaces the prior secret only after user confirmation in the import summary.

## Proxy Data Model

Each proxy record contains non-secret fields similar to:

```ts
type ProxyKind = 'rotating' | 'static';
type ProxyProtocol = 'http' | 'https' | 'socks5';
type ProxyHealth = 'pending' | 'testing' | 'live' | 'slow' | 'dead' | 'unavailable';

interface ProxyRecord {
  id: string;
  kind: ProxyKind;
  protocol: ProxyProtocol;
  hostname: string;
  port: number;
  username?: string;
  enabled: boolean;
  health: ProxyHealth;
  latencyMs?: number;
  observedIp?: string;
  expectedStaticIp?: string;
  countryCode?: string;
  failureCount: number;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

Passwords are stored separately from public proxy records. Renderer IPC must never receive a plaintext password merely to display a proxy row.

## Persistence and Secret Storage

V0.6 uses a local persistent store under Electron `userData`. The implementation should follow the same security principle used by the Real iOS provider configuration:

- non-secret proxy metadata is stored locally in structured JSON for v0.6;
- proxy passwords are encrypted with Electron `safeStorage` where available;
- when secure storage is unavailable, OrbitQA must not persist a non-empty password in plaintext;
- user-facing rows expose only a boolean such as `hasPassword`;
- error strings, IPC responses, logs, exports, and health activity messages pass through secret redaction before reaching the renderer.

A later migration to SQLite can replace the JSON store without changing the renderer-facing service interface.

## Health Test Definition

A proxy is not considered usable merely because its TCP port accepts a connection. A health check must verify the actual proxy path through Playwright's request API or an equivalent browser-compatible network path.

A successful health check records:

1. proxy authentication succeeds when credentials are present;
2. a configured route-check endpoint is reachable through the proxy;
3. the endpoint returns a syntactically valid public IP address;
4. the proxied observed IP differs from the host's direct observed IP when direct-route verification is available;
5. latency is measured around the proxied verification request;
6. no plaintext credentials are returned to the renderer or log;
7. for a static proxy, a changed exit IP is recorded as a warning state/detail but is not automatically treated as credential or transport failure;
8. for a rotating proxy, exit-IP changes are expected and update the current observed IP.

Health classifications:

- `pending`: imported but never tested;
- `testing`: active test in progress;
- `live`: full health verification passed and latency is below the slow threshold;
- `slow`: full health verification passed but latency exceeds the configured threshold;
- `dead`: the most recent test failed;
- `unavailable`: three or more consecutive failures; excluded from allocation until a later successful retest.

Default slow threshold: **2000 ms**. This should be a service constant in v0.6, not an exposed advanced setting yet.

Only `live` proxies are eligible for automatic allocation. `slow` proxies remain visible but are skipped by default. This keeps Test Runs deterministic and avoids degrading QA results.

## Background Retest Schedule

Background testing runs while OrbitQA is open and must use bounded concurrency to avoid excessive local resource/network use.

Default schedule:

- `live`: recheck every 10 minutes;
- `slow`: recheck every 5 minutes;
- first `dead` failure: retry after 2 minutes;
- second consecutive failure: retry after 5 minutes;
- third consecutive failure: mark `unavailable` and retry after 15 minutes;
- further unavailable failures: retry every 30 minutes;
- manual **Test**, **Test Selected**, **Test All**, and **Retest Dead** bypass the schedule and queue immediate checks;
- immediately before allocation, any health result older than 10 minutes is stale and must be retested before use.

Background health checks use a maximum concurrency of **3**. Duplicate checks for the same proxy ID must coalesce rather than run simultaneously.

## Smart Allocation

### Rotating Pool

Eligible entries are enabled, `live`, verified, and not stale. Allocation uses round-robin across eligible gateway records. A stale candidate is retested before it can be returned. A failed retest removes the candidate and tries the next healthy entry.

Because rotating gateways may intentionally change observed IPs, allocation fairness applies to gateway records, not individual observed exit IPs.

### Static Pool

Eligible entries are enabled, `live`, verified, and not stale. Allocation uses least-recently-used ordering so each healthy static proxy is used before recently used entries are reused.

If a static endpoint's observed exit IP changed from its prior verified value, the record remains visible with a warning detail. The user can explicitly accept the new static IP. Until accepted, that proxy is not automatically allocated.

### No Eligible Proxy

If Test Runs requests a pool and no eligible proxy remains after stale checks/retests, OrbitQA fails the run before browser launch with a clear error. It must never fall back to a direct connection or silently switch to a manual proxy.

## Test Runs Integration

The current custom proxy controls evolve into a `Proxy source` selector:

- No proxy
- Manual proxy
- Rotating Pool
- Static Pool

When a pool source is selected:

1. Test Runs requests an eligible proxy from the Proxy Manager service;
2. the service retests stale candidates before allocation;
3. the service returns a transient runtime proxy configuration containing the secret only to the main-process runner;
4. the browser starts with that proxy;
5. existing strict privacy and route verification run after browser launch;
6. if the post-launch proxy route check fails, the QA run fails closed;
7. the failed proxy records a health failure so it is not immediately reallocated;
8. the renderer sees the proxy record ID, protocol, masked endpoint, health result, observed IP, and latency, never its password.

For multi-session desktop QA, each session gets its own allocation. Static proxies should not be assigned concurrently to multiple sessions unless the number of active sessions exceeds the number of eligible static proxies; in v0.6, fail instead of sharing the same static proxy concurrently.

Android custom proxy/pool routing remains unsupported until a proper Android network-routing implementation exists. OrbitQA must reject pool selection for Android rather than silently ignore it.

Real iOS remote-device provider proxy routing remains outside v0.6 because providers have vendor-specific network capabilities.

## Fail-Closed Rules

OrbitQA must stop before or during a QA run rather than continue insecurely when any of these occur:

- selected proxy is dead, unavailable, disabled, or stale and cannot be reverified;
- authentication fails;
- route-check endpoint returns an invalid IP response;
- proxy path matches the direct path when a distinct proxy route is required;
- no healthy pool candidate exists;
- requested static proxy is already reserved by another concurrent session;
- proxy secret cannot be retrieved securely;
- browser launch fails with the allocated proxy;
- post-launch privacy/proxy verification reports a required failure.

## Credential and Log Safety

Every proxy-related error is sanitized with the existing `redactSecrets()` mechanism, extended to cover normalized proxy URLs and imported credential formats.

Examples of safe activity output:

```text
proxy-07 verified - 286 ms - exit 203.0.113.8
proxy-04 scheduled for retest in 5 min
proxy-11 authentication failed
static proxy exit IP changed - allocation paused pending review
```

Unsafe output such as `user:password@host:port` must never be emitted.

## Export

`Export Safe List` exports only non-secret values by default:

```text
protocol://host:port
```

If usernames are included, passwords still remain excluded. V0.6 does not provide a plaintext credential export function.

## Main-Process Architecture

Add focused modules rather than putting pool logic into `qa-runner.cjs`:

- `electron/proxy-store.cjs`: persistence and encrypted secret handling;
- `electron/proxy-parser.cjs`: import parsing, normalization, duplicate identity;
- `electron/proxy-health.cjs`: individual health checks and classification;
- `electron/proxy-pool-service.cjs`: scheduling, queueing, allocation, reservation, release, and renderer-safe public views;
- reuse and extend `electron/proxy-diagnostics.cjs` for IP parsing, route comparison, and redaction.

`electron/main.cjs` owns a singleton proxy pool service and exposes narrow IPC handlers. `electron/qa-runner.cjs` consumes allocated runtime proxy settings but does not own the pool.

## IPC Surface

Renderer-safe IPC should support operations equivalent to:

```text
proxy:list
proxy:import
proxy:update
proxy:delete
proxy:setEnabled
proxy:test
proxy:testMany
proxy:retestDead
proxy:getSummary
proxy:exportSafe
```

Allocation is internal to the main process and should not expose decrypted proxy secrets to the renderer.

## Renderer Architecture

Create a real `ProxyManager.tsx` page and supporting shared types. `App.tsx` routes the existing `proxies` page to it instead of `PlaceholderPage`.

The page is responsible for display, filtering, selection, import editing, and action requests only. It does not perform network health checks itself.

Test Runs consumes pool summaries/public choices through the preload API and sends only the selected pool source/kind in its run request.

## QA Interaction Realism Boundary

Proxy Manager v0.6 does not implement stealth or fingerprint spoofing. OrbitQA will continue to expose truthful diagnostics for user agent, platform, touch, viewport, DPR, locale, timezone, permissions, and WebRTC availability.

A separate future **Realistic QA Interaction** feature may add authorized-test conveniences such as configurable think-time ranges, scroll pacing, typing speed, and normal pointer movement. It must remain a QA timing/input simulation feature, not an anti-bot bypass, fingerprint forgery, fake engagement, or identity-concealment system.

## Testing Strategy

Implementation is test-driven.

Unit tests cover:

- all supported import formats;
- invalid ports/protocols/hosts;
- duplicate normalization;
- password redaction;
- secure-secret persistence behavior;
- health classifications and latency threshold;
- static exit-IP change handling;
- retest backoff schedule;
- round-robin rotating allocation;
- least-recently-used static allocation;
- reservation/release behavior;
- stale-health retesting;
- no-eligible-proxy fail-closed behavior;
- renderer-safe public records containing no passwords.

Service tests use a local fake HTTP proxy/route-check fixture or injected request adapter so CI does not require paid proxies.

UI tests cover:

- rotating/static tabs;
- summary counts;
- masked endpoint rendering;
- multi-line import summary;
- manual test/retest actions;
- dead/unavailable entries excluded from selectable pool behavior;
- Test Runs proxy-source selector and pool-mode request serialization.

Regression tests ensure existing Chromium, Firefox, WebKit privacy checks continue passing and manual proxy mode continues to work.

## Acceptance Criteria

V0.6 is accepted when:

1. multiple HTTP/HTTPS/SOCKS5 proxies can be imported and normalized safely;
2. secrets are encrypted at rest when secure storage is available and never returned to the renderer as plaintext;
3. automatic background tests correctly classify live/slow/dead/unavailable entries;
4. only live, verified, non-stale proxies can be automatically allocated;
5. rotating allocation is fair round-robin;
6. static allocation avoids concurrent reuse and uses least-recently-used ordering;
7. a dead proxy automatically leaves the eligible pool and is rescheduled for retest;
8. a recovered proxy automatically becomes eligible again;
9. Test Runs can choose No Proxy, Manual Proxy, Rotating Pool, or Static Pool;
10. browser runs fail closed rather than silently use the direct connection;
11. proxy credentials never appear in UI logs, errors, exports, or persisted public metadata;
12. existing strict privacy tests and Chromium/Firefox/WebKit health tests remain green;
13. Android rejects unsupported proxy-pool routing clearly rather than ignoring it;
14. no stealth fingerprint spoofing or automation-concealment capability is introduced.
