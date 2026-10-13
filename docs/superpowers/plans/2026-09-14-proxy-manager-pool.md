# Proxy Manager v0.6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent multi-proxy manager with Rotating and Static pools, automatic health testing, smart allocation, secure credential handling, and fail-closed Test Runs integration.

**Architecture:** Keep proxy management in focused Electron main-process modules. The renderer only receives public proxy metadata and pool summaries; decrypted secrets stay inside the main process and are handed transiently to `qa-runner.cjs` only for a browser session. `qa-runner.cjs` requests one allocation per desktop/local-iOS session, performs the existing post-launch privacy/proxy verification, reports failures back to the pool, and always releases reservations.

**Tech Stack:** Electron 38 CommonJS main process, React 19 + TypeScript renderer, Playwright 1.63 request/browser APIs, Electron `safeStorage`, Vitest + Testing Library, Node `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-14-proxy-manager-pool-design.md`

## Global Constraints

- One backend pool with two UI categories: `rotating` and `static`.
- Supported protocols: `http`, `https`, `socks5`.
- Protocol-less imports normalize to `http://` and remain visibly editable.
- Passwords are never returned to the renderer, logs, exports, or IPC error messages.
- Persist non-secret metadata as JSON under Electron `userData`; encrypt non-empty passwords with Electron `safeStorage`.
- If secure storage is unavailable, reject persistence of a non-empty proxy password.
- Health states are exactly `pending`, `testing`, `live`, `slow`, `dead`, `unavailable`.
- Slow threshold is exactly `2000 ms` in v0.6.
- Only enabled, verified, non-stale `live` proxies are automatically allocatable.
- Background health-check concurrency is capped at `3`.
- Retest schedule: live 10m; slow 5m; first dead 2m; second dead 5m; third failure unavailable + 15m; later unavailable failures 30m.
- Health older than 10 minutes is stale and must be retested before allocation.
- Duplicate health checks for the same proxy ID must coalesce.
- Rotating allocation is round-robin by gateway record.
- Static allocation is least-recently-used and must not share one static proxy concurrently.
- Static exit-IP changes pause automatic allocation until the user accepts the new IP.
- No eligible proxy means fail before browser launch; never silently fall back to direct networking.
- Android pool/manual proxy routing remains rejected in v0.6.
- Real iOS provider proxy routing remains outside v0.6.
- Existing Strict Privacy Mode and post-launch route checks remain active after allocation.
- No stealth fingerprint spoofing, anti-detection, hardware/browser identity falsification, or human-impersonation features.

---

## File Structure

Create:

- `src/shared/proxy.ts` — renderer-safe proxy types, source selection type, summary shapes, display helpers.
- `src/shared/proxy.test.ts` — shared type/helper behavior tests.
- `src/pages/ProxyManager.tsx` — Rotating/Static proxy management UI.
- `src/pages/ProxyManager.test.tsx` — renderer behavior tests.
- `electron/proxy-parser.cjs` — import parsing, normalization, duplicate identity, secret-safe serialization.
- `electron/proxy-parser.test.cjs` — parser tests.
- `electron/proxy-store.cjs` — metadata persistence + encrypted secret storage.
- `electron/proxy-store.test.cjs` — store and secret tests.
- `electron/proxy-health.cjs` — one proxy health test and classification.
- `electron/proxy-health.test.cjs` — health test tests with fake Playwright request API.
- `electron/proxy-pool-service.cjs` — scheduling, coalescing, smart allocation, reservations, release, public views.
- `electron/proxy-pool-service.test.cjs` — scheduling/allocation tests.

Modify:

- `src/shared/testRun.ts` — add `proxySource` to the run contract and validation.
- `src/shared/testRun.test.ts` — validate pool source and device restrictions.
- `src/pages/Run.tsx` — replace single `Use custom proxy` toggle with proxy-source selector and pool summaries.
- `src/pages/TestRuns.test.tsx` — test manual/pool request shapes and Android rejection UI.
- `src/App.tsx` — render `ProxyManager` for the `proxies` route.
- `src/App.test.tsx` — verify real proxy page is routed.
- `src/vite-env.d.ts` — add renderer-safe proxy IPC methods.
- `src/styles.css` — proxy manager layout, health states, table, import dialog, pagination, activity feed.
- `electron/proxy-diagnostics.cjs` — extend secret redaction to normalized proxy URL and colon-delimited credential forms.
- `electron/proxy-diagnostics.test.cjs` — redaction regression tests.
- `electron/preload.cjs` — expose narrow proxy CRUD/test IPC.
- `electron/main.cjs` — create one pool service, register IPC, pass it to `executeQaRun`, start/stop scheduler.
- `electron/qa-runner.cjs` — allocate/release one pool proxy per session and report post-launch failures.
- `electron/qa-runner.test.cjs` — allocation, release, reservation, and fail-closed tests.
- `package.json` — bump app version to `0.6.0` and add new Node test files to `npm test`.

---

### Task 1: Shared Proxy Contracts and Run Validation

**Files:**
- Create: `src/shared/proxy.ts`
- Create: `src/shared/proxy.test.ts`
- Modify: `src/shared/testRun.ts`
- Modify: `src/shared/testRun.test.ts`

**Interfaces:**
- Produces `ProxyKind`, `ProxyProtocol`, `ProxyHealth`, `ProxySource`, `ProxyPublicRecord`, `ProxySummary`, `ProxyImportResult`, `ProxyActivityEntry`.
- Extends `QaRunRequest` with `proxySource?: ProxySource`.
- `proxySource` defaults to `manual` only when the existing manual proxy is enabled; otherwise `none`.
- Renderer pool selections never carry a proxy password.

- [ ] **Step 1: Write failing shared-model tests**

Add `src/shared/proxy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatMaskedProxyEndpoint, isPoolProxySource } from './proxy';

describe('proxy shared helpers', () => {
  it('masks endpoint display without exposing credentials', () => {
    expect(formatMaskedProxyEndpoint({
      protocol: 'socks5', hostname: 'proxy.example', port: 1080, username: 'alice', hasPassword: true,
    })).toBe('socks5://alice:***@proxy.example:1080');
  });

  it('recognizes pool sources only', () => {
    expect(isPoolProxySource('rotating')).toBe(true);
    expect(isPoolProxySource('static')).toBe(true);
    expect(isPoolProxySource('manual')).toBe(false);
    expect(isPoolProxySource('none')).toBe(false);
  });
});
```

Extend `src/shared/testRun.test.ts` with cases that prove:

```ts
it('accepts rotating/static pools on desktop without renderer proxy secrets', () => {
  const base = validRequest();
  expect(validateQaRunRequest({ ...base, proxySource: 'rotating' })).toEqual({ ok: true });
  expect(validateQaRunRequest({ ...base, proxySource: 'static' })).toEqual({ ok: true });
});

it('rejects proxy pools for Android and Real iOS', () => {
  const android = { ...validRequest(), deviceMode: 'android' as const, deviceName: 'Pixel_9_API_36', sessions: 1, concurrency: 1, proxySource: 'rotating' as const };
  expect(validateQaRunRequest(android)).toEqual({ ok: false, error: 'Proxy pools are not available for Android AVD runs in v0.6' });
});
```

- [ ] **Step 2: Run the shared tests and verify RED**

Run:

```bash
npx vitest run src/shared/proxy.test.ts src/shared/testRun.test.ts
```

Expected: FAIL because `src/shared/proxy.ts` and `proxySource` handling do not exist yet.

- [ ] **Step 3: Implement the shared contracts**

Create `src/shared/proxy.ts` with these exact public shapes:

```ts
export type ProxyKind = 'rotating' | 'static';
export type ProxyProtocol = 'http' | 'https' | 'socks5';
export type ProxyHealth = 'pending' | 'testing' | 'live' | 'slow' | 'dead' | 'unavailable';
export type ProxySource = 'none' | 'manual' | ProxyKind;

export interface ProxyPublicRecord {
  id: string;
  kind: ProxyKind;
  protocol: ProxyProtocol;
  hostname: string;
  port: number;
  username?: string;
  hasPassword: boolean;
  enabled: boolean;
  health: ProxyHealth;
  latencyMs?: number;
  observedIp?: string;
  expectedStaticIp?: string;
  pendingStaticIp?: string;
  staticIpChangePending?: boolean;
  countryCode?: string;
  failureCount: number;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProxySummary {
  total: number;
  live: number;
  slow: number;
  dead: number;
  unavailable: number;
  testing: number;
  rotatingLive: number;
  staticLive: number;
}

export interface ProxyImportResult {
  accepted: ProxyPublicRecord[];
  duplicates: Array<{ line: string; existingId: string; passwordChanged: boolean }>;
  invalid: Array<{ line: string; error: string }>;
}

export interface ProxyActivityEntry {
  id: string;
  proxyId?: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
}

export function isPoolProxySource(source: ProxySource): source is ProxyKind {
  return source === 'rotating' || source === 'static';
}

export function formatMaskedProxyEndpoint(proxy: Pick<ProxyPublicRecord, 'protocol' | 'hostname' | 'port' | 'username' | 'hasPassword'>): string {
  const auth = proxy.username ? `${proxy.username}${proxy.hasPassword ? ':***' : ''}@` : '';
  return `${proxy.protocol}://${auth}${proxy.hostname}:${proxy.port}`;
}
```

Modify `QaRunRequest`:

```ts
import type { ProxySource } from './proxy';

export interface QaRunRequest {
  // existing fields
  proxySource?: ProxySource;
}
```

Add validation after `deviceMode` is resolved:

```ts
const proxySource = request.proxySource ?? (request.privacy?.proxy.enabled ? 'manual' : 'none');
if (!['none', 'manual', 'rotating', 'static'].includes(proxySource)) {
  return { ok: false, error: 'Choose a supported proxy source' };
}
if ((proxySource === 'rotating' || proxySource === 'static') && deviceMode === 'android') {
  return { ok: false, error: 'Proxy pools are not available for Android AVD runs in v0.6' };
}
if ((proxySource === 'rotating' || proxySource === 'static') && deviceMode === 'real-ios') {
  return { ok: false, error: 'Proxy pools are not available for Real iOS Device runs in v0.6' };
}
if (proxySource === 'manual' && !request.privacy?.proxy.enabled) {
  return { ok: false, error: 'Manual proxy source requires proxy settings' };
}
```

- [ ] **Step 4: Run shared tests and verify GREEN**

Run:

```bash
npx vitest run src/shared/proxy.test.ts src/shared/testRun.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit if this workspace is a Git repository**

Run:

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git add src/shared/proxy.ts src/shared/proxy.test.ts src/shared/testRun.ts src/shared/testRun.test.ts && git commit -m "feat: add proxy pool contracts"
```

If the command reports that the directory is not a Git work tree, continue without creating a commit.

---

### Task 2: Proxy Parsing, Normalization, and Secret Redaction

**Files:**
- Create: `electron/proxy-parser.cjs`
- Create: `electron/proxy-parser.test.cjs`
- Modify: `electron/proxy-diagnostics.cjs`
- Modify: `electron/proxy-diagnostics.test.cjs`

**Interfaces:**
- `parseProxyLine(line, defaultKind)` -> `{ ok: true, value } | { ok: false, error }`.
- `parseProxyImport(text, defaultKind)` -> `{ accepted, invalid }` internal parsed records with plaintext password only inside main-process memory.
- `proxyIdentity(record)` -> normalized duplicate key from protocol + hostname + port + username.
- `toProxyServer(record)` -> `protocol://hostname:port`, without embedding credentials.
- `redactSecrets(message, secrets)` continues to sanitize logs and now also masks URL/colon-form credentials.

- [ ] **Step 1: Write parser/redaction regression tests**

Create `electron/proxy-parser.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProxyLine, parseProxyImport, proxyIdentity } = require('./proxy-parser.cjs');

test('normalizes supported proxy import forms', () => {
  assert.deepEqual(parseProxyLine('proxy.test:8080', 'rotating').value, {
    kind: 'rotating', protocol: 'http', hostname: 'proxy.test', port: 8080, username: '', password: '',
  });
  assert.equal(parseProxyLine('proxy.test:8080:alice:secret', 'static').value.username, 'alice');
  assert.equal(parseProxyLine('socks5://alice:secret@proxy.test:1080', 'static').value.protocol, 'socks5');
});

test('rejects malformed protocol and port', () => {
  assert.equal(parseProxyLine('ftp://proxy.test:21', 'rotating').ok, false);
  assert.equal(parseProxyLine('proxy.test:notaport', 'rotating').ok, false);
});

test('duplicate identity ignores password but includes username', () => {
  const a = parseProxyLine('http://alice:first@proxy.test:8080', 'rotating').value;
  const b = parseProxyLine('http://alice:second@proxy.test:8080', 'rotating').value;
  assert.equal(proxyIdentity(a), proxyIdentity(b));
});
```

Extend `electron/proxy-diagnostics.test.cjs`:

```js
test('redacts colon-delimited and URL proxy passwords', () => {
  const input = 'failed http://alice:secret@proxy.test:8080 and proxy.test:8080:alice:secret';
  const safe = redactSecrets(input, ['alice', 'secret']);
  assert.equal(safe.includes('secret'), false);
  assert.equal(safe.includes('alice'), false);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test electron/proxy-parser.test.cjs electron/proxy-diagnostics.test.cjs
```

Expected: parser module missing and/or redaction test failing.

- [ ] **Step 3: Implement parser and stronger redaction**

Implement `proxy-parser.cjs` with no shell execution and URL parsing only. The normalized parser result must be:

```js
{
  kind: 'rotating' | 'static',
  protocol: 'http' | 'https' | 'socks5',
  hostname: 'proxy.test',
  port: 8080,
  username: '',
  password: '',
}
```

Use these rules:

```js
const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:', 'socks5:']);

function proxyIdentity(record) {
  return [record.protocol, record.hostname.toLowerCase(), record.port, record.username || ''].join('|');
}

function toProxyServer(record) {
  return `${record.protocol}://${record.hostname}:${record.port}`;
}
```

For `host:port:user:pass`, split only the first four fields and reject empty host, invalid integer port, or port outside `1..65535`.

Extend `redactSecrets()` so messages containing credentials in either supported import form are converted to safe forms before explicit secret replacement. Preserve host/port because they are not secrets; replace usernames/passwords with `[REDACTED]`.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
node --test electron/proxy-parser.test.cjs electron/proxy-diagnostics.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit if Git is available**

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git add electron/proxy-parser.cjs electron/proxy-parser.test.cjs electron/proxy-diagnostics.cjs electron/proxy-diagnostics.test.cjs && git commit -m "feat: parse and sanitize proxy imports"
```

---

### Task 3: Secure Persistent Proxy Store

**Files:**
- Create: `electron/proxy-store.cjs`
- Create: `electron/proxy-store.test.cjs`

**Interfaces:**
- `createProxyStore({ userDataPath, safeStorage, fsImpl? })`.
- Methods: `list()`, `get(id)`, `importMany(parsedRecords)`, `update(id, patch)`, `remove(ids)`, `setEnabled(ids, enabled)`, `getRuntimeProxy(id)`, `acceptStaticIp(id)`, `saveHealth(id, result)`, `markUsed(id, at)`, `close()`.
- `getRuntimeProxy(id)` is main-process only and may return decrypted password.
- Every other public/store list shape includes `hasPassword` and excludes plaintext password.

- [ ] **Step 1: Write store tests first**

Create tests using `node:fs/promises` temp directories and a fake `safeStorage`:

```js
function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8').replace(/^enc:/, ''),
  };
}

test('persists metadata without plaintext passwords', async () => {
  const store = createProxyStore({ userDataPath: tempDir, safeStorage: fakeSafeStorage() });
  const [record] = await store.importMany([{ kind: 'static', protocol: 'http', hostname: 'proxy.test', port: 8080, username: 'alice', password: 'secret' }]);
  const raw = await fs.readFile(path.join(tempDir, 'proxies.json'), 'utf8');
  assert.equal(raw.includes('secret'), false);
  assert.equal((await store.list())[0].hasPassword, true);
  assert.equal((await store.getRuntimeProxy(record.id)).password, 'secret');
});

test('rejects non-empty password when safe storage is unavailable', async () => {
  const store = createProxyStore({ userDataPath: tempDir, safeStorage: { isEncryptionAvailable: () => false } });
  await assert.rejects(() => store.importMany([{ kind: 'rotating', protocol: 'http', hostname: 'proxy.test', port: 8080, username: 'alice', password: 'secret' }]), /secure storage/i);
});
```

Also cover:
- duplicate identity does not create a second record;
- replacing a duplicate password requires `replacePassword: true` from the caller;
- `acceptStaticIp(id)` moves `pendingStaticIp` into `expectedStaticIp` and clears `staticIpChangePending`;
- `remove(ids)` removes encrypted secret entries too.

- [ ] **Step 2: Run store tests and verify RED**

```bash
node --test electron/proxy-store.test.cjs
```

Expected: FAIL because store does not exist.

- [ ] **Step 3: Implement JSON metadata + encrypted secret persistence**

Persist files under:

```text
<userData>/proxy-manager/proxies.json
<userData>/proxy-manager/secrets.json
```

Metadata record initialization:

```js
{
  id: randomUUID(),
  kind,
  protocol,
  hostname,
  port,
  username: username || '',
  enabled: true,
  health: 'pending',
  failureCount: 0,
  createdAt: now,
  updatedAt: now,
}
```

Store encrypted password bytes as base64 in `secrets.json`, keyed by proxy ID. `list()` and `get()` must decorate metadata with `hasPassword: Boolean(secrets[id])` and never attach decrypted password.

Use write-to-temp-then-rename for each JSON file:

```js
await fs.writeFile(`${file}.tmp`, JSON.stringify(data, null, 2), 'utf8');
await fs.rename(`${file}.tmp`, file);
```

- [ ] **Step 4: Run store tests and verify GREEN**

```bash
node --test electron/proxy-store.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit if Git is available**

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git add electron/proxy-store.cjs electron/proxy-store.test.cjs && git commit -m "feat: persist proxy pool securely"
```

---

### Task 4: Health Tester and Classification

**Files:**
- Create: `electron/proxy-health.cjs`
- Create: `electron/proxy-health.test.cjs`

**Interfaces:**
- `createProxyHealthTester({ playwrightRequest, routeCheckUrl, now?, slowThresholdMs? })`.
- `testProxy(runtimeProxy, directIp?)` -> health result without credentials.
- `classifyProxyHealth({ ok, latencyMs, failureCount })`.
- Health result fields: `health`, `latencyMs?`, `observedIp?`, `error?`, `checkedAt`, `failureCount`, `nextCheckAt`.

- [ ] **Step 1: Write health-classification tests**

Use a fake Playwright request API that records options and returns fake bodies:

```js
test('classifies a fast verified proxy as live', async () => {
  const tester = createProxyHealthTester({ playwrightRequest: fakeRequest('203.0.113.20'), routeCheckUrl: 'https://check.test/ip', now: () => 1_000 });
  const result = await tester.testProxy({ id: 'p1', protocol: 'http', hostname: 'proxy.test', port: 8080, username: '', password: '', failureCount: 0 }, '198.51.100.10');
  assert.equal(result.health, 'live');
  assert.equal(result.observedIp, '203.0.113.20');
});

test('fails a proxy whose observed route equals the direct route', async () => {
  const tester = createProxyHealthTester({ playwrightRequest: fakeRequest('198.51.100.10'), routeCheckUrl: 'https://check.test/ip' });
  const result = await tester.testProxy(runtimeProxy(), '198.51.100.10');
  assert.equal(result.health, 'dead');
  assert.match(result.error, /direct route/i);
});

test('marks third consecutive failure unavailable and schedules 15 minutes', async () => {
  const result = classifyProxyHealth({ ok: false, failureCount: 2, checkedAtMs: 1_000 });
  assert.equal(result.health, 'unavailable');
  assert.equal(Date.parse(result.nextCheckAt) - 1_000, 15 * 60 * 1000);
});
```

Also test:
- latency `> 2000` => `slow`;
- first failure => dead + 2m;
- second => dead + 5m;
- fourth+ => unavailable + 30m;
- invalid route payload => failure;
- returned errors are passed through `redactSecrets()`.

- [ ] **Step 2: Run health tests and verify RED**

```bash
node --test electron/proxy-health.test.cjs
```

Expected: FAIL because health tester does not exist.

- [ ] **Step 3: Implement browser-compatible proxy health requests**

Create a temporary Playwright request context per health check:

```js
const context = await playwrightRequest.newContext({
  proxy: {
    server: `${runtime.protocol}://${runtime.hostname}:${runtime.port}`,
    username: runtime.username || undefined,
    password: runtime.password || undefined,
  },
  ignoreHTTPSErrors: false,
});
```

Measure around `context.get(routeCheckUrl, { timeout: 15000 })`, parse body with existing `parseObservedIp()`, and always `await context.dispose()` in `finally`.

Classification schedule constants:

```js
const SLOW_THRESHOLD_MS = 2000;
const LIVE_RECHECK_MS = 10 * 60 * 1000;
const SLOW_RECHECK_MS = 5 * 60 * 1000;
const FIRST_DEAD_RETRY_MS = 2 * 60 * 1000;
const SECOND_DEAD_RETRY_MS = 5 * 60 * 1000;
const THIRD_FAILURE_RETRY_MS = 15 * 60 * 1000;
const UNAVAILABLE_RETRY_MS = 30 * 60 * 1000;
```

When verification passes, reset `failureCount` to `0`; otherwise increment it before classification.

- [ ] **Step 4: Run health tests and verify GREEN**

```bash
node --test electron/proxy-health.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit if Git is available**

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git add electron/proxy-health.cjs electron/proxy-health.test.cjs && git commit -m "feat: verify and classify proxy health"
```

---

### Task 5: Pool Service, Scheduler, Coalescing, and Smart Allocation

**Files:**
- Create: `electron/proxy-pool-service.cjs`
- Create: `electron/proxy-pool-service.test.cjs`

**Interfaces:**
- `createProxyPoolService({ store, healthTester, directIpProvider, now?, setTimer?, clearTimer? })`.
- Renderer-facing: `list(kind?)`, `getSummary()`, `importText({ text, kind, replacePasswords? })`, `update(id, patch)`, `remove(ids)`, `setEnabled(ids, enabled)`, `test(id)`, `testMany(ids)`, `retestDead()`, `exportSafe({ kind?, includeUsernames? })`, `getActivity()`.
- Runner-facing: `allocate(kind, reservationOwner)`, `release(allocationId)`, `reportRuntimeFailure(proxyId, message)`.
- Lifecycle: `start()`, `stop()`.

- [ ] **Step 1: Write allocation and scheduler tests**

Cover these exact behaviors:

```js
test('rotating allocation uses round robin across live fresh gateways', async () => {
  const service = await serviceWithLiveRecords(['r1', 'r2'], 'rotating');
  assert.equal((await service.allocate('rotating', 's1')).proxyId, 'r1');
  await service.release('s1');
  assert.equal((await service.allocate('rotating', 's2')).proxyId, 'r2');
});

test('static allocation is least recently used and reserves concurrently', async () => {
  const service = await serviceWithLiveRecords(['s1', 's2'], 'static');
  const a = await service.allocate('static', 'session-1');
  const b = await service.allocate('static', 'session-2');
  assert.notEqual(a.proxyId, b.proxyId);
  await assert.rejects(() => service.allocate('static', 'session-3'), /No eligible static proxy/i);
});

test('stale candidate is retested before allocation', async () => {
  const service = await serviceWithStaleRecord('r1');
  const allocation = await service.allocate('rotating', 'session-1');
  assert.equal(allocation.proxyId, 'r1');
  assert.equal(healthTesterCalls(), 1);
});

test('coalesces concurrent health checks for the same proxy id', async () => {
  const [a, b] = await Promise.all([service.test('p1'), service.test('p1')]);
  assert.equal(healthTesterCalls(), 1);
  assert.deepEqual(a, b);
});
```

Also cover:
- `slow`, `dead`, `unavailable`, disabled records skipped;
- pending static IP change skipped;
- health test failure during allocation tries next candidate;
- no candidates throws without direct fallback;
- successful static allocation updates `lastUsedAt`;
- runtime failure marks proxy failed and schedules retest;
- background scheduler max active tests is 3;
- `stop()` clears timers and prevents new scheduled checks;
- activity messages contain masked endpoint/ID but no credentials.

- [ ] **Step 2: Run pool-service tests and verify RED**

```bash
node --test electron/proxy-pool-service.test.cjs
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement service with a single bounded queue**

Use these constants:

```js
const HEALTH_CONCURRENCY = 3;
const STALE_AFTER_MS = 10 * 60 * 1000;
```

Maintain:

```js
const inFlightTests = new Map();       // proxyId -> Promise
const reservations = new Map();        // proxyId -> owner
const rotatingCursor = { value: 0 };
const activity = [];
let stopped = true;
```

`test(id)` must return the existing promise when `inFlightTests` already has the ID. Always remove the map entry in `finally`.

`allocate(kind, owner)` must:

```text
load public candidates
-> filter enabled/live/not-static-change-pending
-> order rotating round-robin OR static least-recently-used
-> skip reserved static entries
-> retest stale candidate
-> retrieve decrypted runtime secret from store only after candidate passes
-> reserve static record
-> return runtime allocation with allocationId + proxyId + server + username + password
```

The returned runtime allocation must never be sent through renderer IPC.

- [ ] **Step 4: Run pool-service tests and verify GREEN**

```bash
node --test electron/proxy-pool-service.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit if Git is available**

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git add electron/proxy-pool-service.cjs electron/proxy-pool-service.test.cjs && git commit -m "feat: add smart proxy pool service"
```

---

### Task 6: Electron IPC and Lifecycle Wiring

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vite-env.d.ts`
- Modify: `package.json`

**Interfaces:**
- Renderer IPC methods exactly:
  - `listProxies(kind?)`
  - `importProxies(request)`
  - `updateProxy(id, patch)`
  - `deleteProxies(ids)`
  - `setProxiesEnabled(ids, enabled)`
  - `testProxy(id)`
  - `testProxies(ids)`
  - `retestDeadProxies()`
  - `getProxySummary()`
  - `getProxyActivity()`
  - `exportSafeProxies(options)`
  - `acceptStaticProxyIp(id)`
- Secrets stay internal; there is no renderer `getProxyPassword` method.

- [ ] **Step 1: Add failing contract assertions**

Extend `src/vite-env.d.ts` compile coverage through `npm run build`, and add/extend an Electron test that imports `preload.cjs` through a mocked `contextBridge` only if the existing test harness supports it. If not, add a source-level Node test `electron/proxy-ipc-contract.test.cjs` that reads `preload.cjs` and asserts every allowed channel is present and no secret-fetch channel exists:

```js
assert.match(source, /proxy:list/);
assert.match(source, /proxy:import/);
assert.doesNotMatch(source, /proxy:getPassword/);
```

- [ ] **Step 2: Run contract/build verification and verify RED**

```bash
node --test electron/proxy-ipc-contract.test.cjs
npm run build
```

Expected: contract test fails before IPC is added.

- [ ] **Step 3: Wire main-process singleton and narrow IPC**

In `app.whenReady()` initialize in this order:

```js
const { request } = require('playwright');
const proxyStore = createProxyStore({ userDataPath: app.getPath('userData'), safeStorage });
const proxyHealthTester = createProxyHealthTester({ playwrightRequest: request, routeCheckUrl: 'https://api64.ipify.org?format=json' });
proxyPoolService = createProxyPoolService({
  store: proxyStore,
  healthTester: proxyHealthTester,
  directIpProvider: async () => {
    const result = await verifyProxyRoute({ playwrightRequest: request, proxy: { enabled: false }, routeCheckUrl: 'https://api64.ipify.org?format=json' });
    return result.directIp;
  },
});
proxyPoolService.start();
```

Register handlers using only public service methods. Sanitize thrown errors before returning them through IPC.

In `app.on('before-quit')`, call `proxyPoolService?.stop()`.

Pass `proxyPoolService` into `executeQaRun(...)` from `qa:startRun`.

Expose matching methods in `preload.cjs` and add precise TypeScript signatures in `vite-env.d.ts` using types from `src/shared/proxy.ts`.

Bump `package.json` version to `0.6.0` and append new Node test files to the existing `test` script.

- [ ] **Step 4: Run contract and build verification**

```bash
node --test electron/proxy-ipc-contract.test.cjs
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit if Git is available**

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git add electron/main.cjs electron/preload.cjs electron/proxy-ipc-contract.test.cjs src/vite-env.d.ts package.json && git commit -m "feat: expose secure proxy manager IPC"
```

---

### Task 7: Real Proxy Manager Renderer Page

**Files:**
- Create: `src/pages/ProxyManager.tsx`
- Create: `src/pages/ProxyManager.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes renderer-safe IPC methods from Task 6.
- Shows no plaintext password at any time.
- Keeps one selected `ProxyKind` tab at a time.
- Import dialog sends text + selected kind to main process.

- [ ] **Step 1: Write renderer tests first**

Add mocks in `ProxyManager.test.tsx` for list, summary, activity, import, test, delete, enable, and export.

Required tests:

```tsx
it('shows summary cards and separate rotating/static tabs', async () => {
  render(<ProxyManager />);
  expect(await screen.findByText('Rotating Pool')).toBeInTheDocument();
  expect(screen.getByText('Static Pool')).toBeInTheDocument();
  expect(screen.getByText('Live')).toBeInTheDocument();
});

it('imports multiple proxies into the selected pool and reports invalid rows', async () => {
  render(<ProxyManager />);
  fireEvent.click(screen.getByRole('button', { name: 'Add Proxies' }));
  fireEvent.change(screen.getByLabelText('Proxy import lines'), { target: { value: 'proxy.test:8080\nbad-line' } });
  fireEvent.click(screen.getByRole('button', { name: 'Import proxies' }));
  await waitFor(() => expect(importProxies).toHaveBeenCalledWith({ text: 'proxy.test:8080\nbad-line', kind: 'rotating', replacePasswords: false }));
  expect(await screen.findByText(/1 invalid/i)).toBeInTheDocument();
});

it('never renders plaintext proxy password returned by test fixtures', async () => {
  render(<ProxyManager />);
  expect(document.body.textContent).not.toContain('super-secret');
});
```

Extend `App.test.tsx` so clicking Proxy Manager renders a page element unique to the real page, for example `getByRole('button', { name: 'Test All' })`.

- [ ] **Step 2: Run renderer tests and verify RED**

```bash
npx vitest run src/pages/ProxyManager.test.tsx src/App.test.tsx
```

Expected: FAIL because page does not exist and App still routes to placeholder.

- [ ] **Step 3: Implement the page with original OrbitQA layout**

Structure:

```tsx
<div className="proxy-manager-page">
  <section className="hero proxy-hero">...</section>
  <section className="proxy-summary-grid">...</section>
  <section className="panel proxy-table-panel">
    <header>tabs + actions</header>
    <table>Protocol / Endpoint / Exit IP / Country / Latency / Health / Failures / Last Check / Next Check / Enabled / Actions</table>
    <footer>pagination</footer>
  </section>
  <section className="panel proxy-activity-panel">...</section>
  {importOpen ? <div role="dialog">...</div> : null}
</div>
```

Use client-side filtering and pagination with `PAGE_SIZE = 50`.

Health visual mapping:

```ts
const healthLabels = {
  pending: 'Pending', testing: 'Testing', live: 'Live', slow: 'Slow', dead: 'Dead', unavailable: 'Unavailable',
};
```

Action buttons:

```text
Add Proxies
Import
Test All
Test Selected
Retest Dead
Enable
Disable
Delete
Export Safe List
```

Static rows with `staticIpChangePending` must show an `Accept new IP` action. No row or dialog ever displays stored password text; use only `hasPassword` and masked endpoint formatting.

Update `App.tsx`:

```tsx
import { ProxyManager } from './pages/ProxyManager';
// ...
) : page === 'proxies' ? (
  <ProxyManager />
```

Add responsive styles without copying the reference image pixel-for-pixel. Keep existing OrbitQA panel, spacing, typography, and color variables.

- [ ] **Step 4: Run page tests and build**

```bash
npx vitest run src/pages/ProxyManager.test.tsx src/App.test.tsx
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit if Git is available**

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git add src/pages/ProxyManager.tsx src/pages/ProxyManager.test.tsx src/App.tsx src/App.test.tsx src/styles.css && git commit -m "feat: build proxy manager interface"
```

---

### Task 8: Test Runs Pool Selection and Per-Session Allocation

**Files:**
- Modify: `src/pages/Run.tsx`
- Modify: `src/pages/TestRuns.test.tsx`
- Modify: `electron/qa-runner.cjs`
- Modify: `electron/qa-runner.test.cjs`

**Interfaces:**
- Test Runs sends only `proxySource` when `rotating`/`static` is selected.
- Manual proxy keeps current `privacy.proxy` inputs.
- `executeQaRun({ ..., proxyPoolService })` calls `proxyPoolService.allocate(kind, owner)` inside each session worker.
- Allocation runtime fields stay main-process only.
- Every allocation is released in `finally`.

- [ ] **Step 1: Write Test Runs UI tests**

Add mocked methods:

```ts
const getProxySummary = vi.fn().mockResolvedValue({ total: 4, live: 3, slow: 0, dead: 1, unavailable: 0, testing: 0, rotatingLive: 2, staticLive: 1 });
```

Required cases:

```tsx
it('selects Rotating Pool without sending proxy credentials', async () => {
  render(<TestRuns />);
  fireEvent.change(screen.getByLabelText('Proxy source'), { target: { value: 'rotating' } });
  fireEvent.change(screen.getByLabelText('Target website'), { target: { value: 'https://example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Start QA test' }));
  await waitFor(() => expect(startQaRun).toHaveBeenCalled());
  expect(startQaRun.mock.calls[0][0]).toMatchObject({ proxySource: 'rotating' });
  expect(startQaRun.mock.calls[0][0].privacy.proxy.password).toBe('');
});

it('shows pool health counts and disables an empty pool', async () => {
  getProxySummary.mockResolvedValueOnce({ total: 0, live: 0, slow: 0, dead: 0, unavailable: 0, testing: 0, rotatingLive: 0, staticLive: 0 });
  render(<TestRuns />);
  expect(await screen.findByRole('option', { name: /Rotating Pool.*0 live/i })).toBeDisabled();
});
```

- [ ] **Step 2: Write runner allocation tests**

Add fake pool service:

```js
function fakePoolService() {
  const allocations = [];
  const releases = [];
  return {
    allocations,
    releases,
    allocate: async (kind, owner) => {
      const allocation = { allocationId: owner, proxyId: `${kind}-1`, server: 'http://proxy.test:8080', username: 'alice', password: 'secret', requireVerifiedRoute: true };
      allocations.push({ kind, owner });
      return allocation;
    },
    release: async (allocationId) => releases.push(allocationId),
    reportRuntimeFailure: async () => undefined,
  };
}
```

Required runner assertions:

```js
test('allocates one rotating proxy per desktop session and releases each reservation', async () => {
  const pool = fakePoolService();
  await executeQaRun({ runId: 'run-1', request: rotatingRequest(2), screenshotsRoot: tempDir, emit: () => {}, proxyPoolService: pool });
  assert.equal(pool.allocations.length, 2);
  assert.equal(pool.releases.length, 2);
});

test('fails closed before browser launch when no pool proxy is eligible', async () => {
  const pool = { allocate: async () => { throw new Error('No eligible rotating proxy is available'); }, release: async () => {} };
  const result = await executeQaRun({ runId: 'run-2', request: rotatingRequest(1), screenshotsRoot: tempDir, emit: collectEvents(), proxyPoolService: pool });
  assert.equal(result.failed, 1);
  assert.equal(browserLaunchCount(), 0);
});
```

Also verify:
- post-launch proxy route failure calls `reportRuntimeFailure(proxyId, ...)`;
- credentials do not appear in emitted `session-error`;
- static allocation is released even when navigation/step fails;
- manual proxy path still works unchanged;
- `none` source never calls pool service.

- [ ] **Step 3: Run UI + runner tests and verify RED**

```bash
npx vitest run src/pages/TestRuns.test.tsx
node --test electron/qa-runner.test.cjs
```

Expected: FAIL before implementation.

- [ ] **Step 4: Implement Test Runs proxy-source controls**

Replace the current `Use custom proxy` switch with:

```tsx
<select aria-label="Proxy source" value={proxySource} onChange={...}>
  <option value="none">No proxy</option>
  <option value="manual">Manual proxy</option>
  <option value="rotating" disabled={proxySummary.rotatingLive === 0}>Rotating Pool · {proxySummary.rotatingLive} live</option>
  <option value="static" disabled={proxySummary.staticLive === 0}>Static Pool · {proxySummary.staticLive} live</option>
</select>
```

Show the existing manual server/username/password/route-verification fields only for `manual`.

For `rotating`/`static`, show a compact readout with live eligible count and a message that stale entries are retested before use.

When device mode becomes Android or Real iOS, automatically reset `proxySource` to `none` and show the unsupported note rather than leaving a hidden invalid selection.

Build request:

```ts
const request: QaRunRequest = {
  // existing fields
  proxySource,
  privacy: {
    ...privacySettings,
    proxy: proxySource === 'manual'
      ? privacySettings.proxy
      : { ...privacySettings.proxy, enabled: false, server: '', username: '', password: '' },
  },
};
```

- [ ] **Step 5: Implement per-session main-process allocation in `qa-runner.cjs`**

Normalize source:

```js
const proxySource = request.proxySource || (privacy.proxy.enabled ? 'manual' : 'none');
```

Do not run the single pre-run `verifyProxyRoute()` for pool sources. Instead, inside each desktop/local-iOS session worker:

```js
let poolAllocation = null;
let runtimeProxy = normalized.privacy.proxy;

if (normalized.proxySource === 'rotating' || normalized.proxySource === 'static') {
  if (!proxyPoolService) throw new Error('Proxy pool service is unavailable');
  poolAllocation = await proxyPoolService.allocate(normalized.proxySource, `${runId}:${sessionId}`);
  runtimeProxy = {
    enabled: true,
    server: poolAllocation.server,
    username: poolAllocation.username || '',
    password: poolAllocation.password || '',
    requireVerifiedRoute: true,
    routeCheckUrl: normalized.privacy.proxy.routeCheckUrl,
  };
}
```

Then:

```js
const proxyObservation = runtimeProxy.enabled
  ? await verifyProxyRoute({ playwrightRequest: playwright.request, proxy: runtimeProxy, routeCheckUrl: runtimeProxy.routeCheckUrl })
  : null;
```

Launch the session using `runtimeProxy`, not the original renderer settings.

If proxy/privacy verification fails after allocation:

```js
if (poolAllocation) {
  await proxyPoolService.reportRuntimeFailure(poolAllocation.proxyId, safeRunErrorMessage(error, { ...normalized, privacy: { ...normalized.privacy, proxy: runtimeProxy } }));
}
```

Always release in `finally`:

```js
if (poolAllocation) await proxyPoolService.release(poolAllocation.allocationId).catch(() => undefined);
```

Redaction must include `runtimeProxy.username` and `runtimeProxy.password`, because pool secrets were never present in the renderer request.

- [ ] **Step 6: Run tests and verify GREEN**

```bash
npx vitest run src/pages/TestRuns.test.tsx
node --test electron/qa-runner.test.cjs
```

Expected: PASS.

- [ ] **Step 7: Commit if Git is available**

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git add src/pages/Run.tsx src/pages/TestRuns.test.tsx electron/qa-runner.cjs electron/qa-runner.test.cjs && git commit -m "feat: allocate proxy pools per QA session"
```

---

### Task 9: Full Regression, Security Verification, and Windows Handoff

**Files:**
- Modify if needed only to fix failures introduced by Tasks 1-8.
- Verify: all files listed in this plan.

**Interfaces:**
- No new interface is introduced in this task.
- Completion requires both automated regression and real Windows browser/proxy smoke testing.

- [ ] **Step 1: Run the complete automated suite**

Run:

```bash
npm test
```

Expected: all Vitest and Node tests pass with zero failures.

- [ ] **Step 2: Run TypeScript/Vite build**

```bash
npm run build
```

Expected: TypeScript compile and Vite build exit successfully.

- [ ] **Step 3: Run existing browser health suite**

```bash
npm run test:browser-health
```

Expected: Chromium, Firefox, and WebKit health checks pass.

- [ ] **Step 4: Run source-level secret scan against generated app source**

Search source/test output for test fixture passwords and ensure they appear only inside tests, never generated public records or fixtures intended for renderer display:

```bash
grep -R "super-secret\|user:password@" electron src --exclude='*.test.cjs' --exclude='*.test.ts' --exclude='*.test.tsx' || true
```

Expected: no production-code occurrence of fixture credentials.

- [ ] **Step 5: Windows manual QA checklist**

On the user's Windows project:

```text
1. Open Proxy Manager.
2. Import one authorized HTTP proxy, one HTTPS proxy, and one SOCKS5 proxy.
3. Confirm the table masks credentials and shows Pending.
4. Click Test All; confirm each becomes Live/Slow/Dead/Unavailable based on actual result.
5. Confirm latency, observed exit IP, last check, and next check populate.
6. Close/reopen OrbitQA; confirm metadata persists and passwords are not displayed.
7. Start a Chromium Test Run with Rotating Pool + Strict Privacy Mode ON.
8. Confirm Proxy route PASS, Direct-connection fallback PASS, WebRTC blocked, permissions denied.
9. Repeat with Firefox and WebKit.
10. Disconnect/disable the selected proxy and run again; confirm the run stops or selects another healthy proxy and never silently goes direct.
11. With only one live static proxy, start two concurrent sessions; confirm OrbitQA refuses to share the same static proxy.
12. Verify Android and Real iOS modes reject proxy-pool selection in v0.6.
```

- [ ] **Step 6: Package the user update only after green verification**

Create a patch ZIP containing all files added/modified by v0.6 and no `node_modules`, `dist`, browser binaries, secrets, or local `userData` files.

Recommended filename:

```text
orbitqa-proxy-manager-v0.6.zip
```

- [ ] **Step 7: Commit final verification metadata if Git is available**

```bash
git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git add package.json && git commit -m "chore: finalize proxy manager v0.6"
```

If `package.json` is already committed and unchanged after verification, do not create an empty commit.

---

## Self-Review Results

- **Spec coverage:** Every approved v0.6 requirement maps to Tasks 1-9: import/normalization, secret storage, health verification, automatic retesting, smart allocation, Static/Rotating behavior, IPC, UI, Test Runs handoff, fail-closed behavior, export safety, Android/Real-iOS restrictions, and credential-safe logs.
- **Scope:** v0.6 remains one cohesive subsystem because parser/store/health/scheduler/allocation/UI all serve the same proxy-pool contract. SQLite migration, Android proxy routing, Real iOS provider routing, realistic interaction pacing, and any fingerprint/anti-detection behavior remain outside this plan.
- **Type consistency:** Renderer uses `ProxySource = 'none' | 'manual' | 'rotating' | 'static'`; pool service uses `ProxyKind = 'rotating' | 'static'`; runner requests allocation only for pool kinds; secrets remain main-process-only.
- **Security check:** No renderer IPC returns decrypted passwords. Pool runtime credentials exist only between store -> pool service -> runner. Every user-visible error/log path must be redacted.
- **No unresolved placeholders:** The plan contains concrete file names, interfaces, test commands, expected outcomes, constants, scheduling values, and implementation shapes.
