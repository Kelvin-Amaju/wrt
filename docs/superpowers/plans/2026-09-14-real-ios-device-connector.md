# Real iOS Device Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-backed Real iOS Device mode to OrbitQA that can run one authorized Safari/Chrome iOS QA session on a physical/remote iPhone or iPad while preserving the existing local Windows WebKit compatibility mode.

**Architecture:** The renderer talks only to narrow Electron preload APIs. Electron owns provider configuration, encrypted secret storage, a generic WebDriver/Appium-compatible HTTP adapter, and the real-iOS session lifecycle. Shared TypeScript types define provider settings, capabilities, diagnostics, and the `real-ios` test-run request shape; renderer pages never receive the stored access key.

**Tech Stack:** Electron 38, React 19, TypeScript 5.9, Vite 7, Vitest 3, Node built-ins (`fetch`, `http`, `crypto`), Electron `safeStorage`, existing Playwright desktop/mobile stack.

**Spec:** `docs/superpowers/specs/2026-09-14-real-ios-device-connector-design.md`

## Global Constraints

- Windows-only V1; Local iOS Compatibility remains Windows WebKit and is never labeled as a real iPhone.
- Real iOS V1 permits exactly one remote session and concurrency `1`.
- Provider endpoint must be HTTPS, except `http://127.0.0.1` and `http://localhost` for local test servers.
- Access key/token must be encrypted with Electron `safeStorage` when available and must never be returned to the renderer after saving.
- Logs must redact credential values and query parameters named `token`, `key`, `secret`, `password`, or `accessKey`.
- Remote sessions must be deleted in `finally` after both success and failure.
- Safari is supported when the provider reports Safari support; Chrome iOS is selectable only when the provider reports Chrome support.
- No canvas/WebGL/AudioContext/ClientRects/WebRTC/hardware fingerprint spoofing.
- Camera and microphone permissions are not granted automatically.
- No provider polling when Real iOS Device mode is not selected.
- Existing Desktop, Android, and Local iOS Compatibility behavior must remain working.
- The project copy is not currently a Git repository; do not initialize Git or create commits unless the user explicitly requests it. Each task ends with a test checkpoint instead.

---

### Task 1: Shared Real-iOS Domain Types and Validation

**Files:**
- Create: `src/shared/realIos.ts`
- Create: `src/shared/realIos.test.ts`
- Modify: `src/shared/mobileDevices.ts`
- Modify: `src/shared/testRun.ts`
- Modify: `src/shared/testRun.test.ts`

**Interfaces:**
- Produces `RealIosProviderPublicConfig`, `RealIosProviderSaveRequest`, `RealIosProviderStatus`, `RealIosCapabilitySelection`, `RealIosObservedEnvironment`, `RealIosDiagnostics`, `RealIosRunResult`.
- Extends `QaDeviceMode` to `'desktop' | 'android' | 'ios-emulation' | 'real-ios'`.
- Extends `QaRunRequest` with `realIos?: RealIosCapabilitySelection`.
- `validateQaRunRequest()` enforces one session/concurrency and a supported browser for `real-ios`.

- [ ] **Step 1: Write failing shared-domain tests**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeProviderUrl, validateProviderSaveRequest, redactSensitiveText } from './realIos';

describe('real iOS provider domain', () => {
  it('accepts HTTPS and localhost development endpoints only', () => {
    expect(normalizeProviderUrl('https://hub.example.test/wd/hub')).toBe('https://hub.example.test/wd/hub');
    expect(normalizeProviderUrl('http://127.0.0.1:4444/wd/hub')).toBe('http://127.0.0.1:4444/wd/hub');
    expect(() => normalizeProviderUrl('http://example.test/wd/hub')).toThrow(/HTTPS/);
  });

  it('requires a provider name, endpoint, device, iOS version and browser', () => {
    expect(validateProviderSaveRequest({
      providerName: '', remoteUrl: 'https://hub.example.test', username: '', accessKey: '',
      defaultDevice: 'iPhone 15', defaultIosVersion: '17', defaultBrowser: 'safari',
    })).toEqual({ ok: false, error: 'Enter a provider name' });
  });

  it('redacts secrets from logs and URLs', () => {
    expect(redactSensitiveText('https://x.test?a=1&token=abc accessKey=xyz password=pw')).not.toMatch(/abc|xyz|pw/);
  });
});
```

- [ ] **Step 2: Run shared tests and verify RED**

Run:

```bash
npx vitest run src/shared/realIos.test.ts src/shared/testRun.test.ts
```

Expected: FAIL because `realIos.ts` and `real-ios` request support do not exist.

- [ ] **Step 3: Implement `src/shared/realIos.ts`**

```ts
export type RealIosBrowser = 'safari' | 'chrome';

export type RealIosProviderSaveRequest = {
  providerName: string;
  remoteUrl: string;
  username: string;
  accessKey: string;
  defaultDevice: string;
  defaultIosVersion: string;
  defaultBrowser: RealIosBrowser;
};

export type RealIosProviderPublicConfig = Omit<RealIosProviderSaveRequest, 'accessKey'> & {
  credentialsSaved: boolean;
};

export type RealIosProviderStatus = {
  configured: boolean;
  reachable: boolean;
  authenticated: boolean;
  safariSupported: boolean;
  chromeSupported: boolean;
  message: string;
};

export type RealIosCapabilitySelection = {
  device: string;
  iosVersion: string;
  browser: RealIosBrowser;
};

export type RealIosObservedEnvironment = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
  devicePixelRatio: number;
  locale: string;
  timezoneId: string;
  webRtcSupported: boolean;
  literalIpCandidates: string[];
};

export type RealIosDiagnostics = { observed: RealIosObservedEnvironment };

export type RealIosRunResult = {
  sessionId: string;
  providerName: string;
  device: string;
  iosVersion: string;
  browser: RealIosBrowser;
  durationMs: number;
  screenshotPath?: string;
  diagnostics: RealIosDiagnostics;
};

export type RealIosValidationResult = { ok: true } | { ok: false; error: string };

export function normalizeProviderUrl(value: string): string {
  const parsed = new URL(value.trim());
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('Provider endpoint must use HTTPS');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function validateProviderSaveRequest(request: RealIosProviderSaveRequest): RealIosValidationResult {
  if (!request.providerName.trim()) return { ok: false, error: 'Enter a provider name' };
  try { normalizeProviderUrl(request.remoteUrl); } catch { return { ok: false, error: 'Enter a valid HTTPS provider endpoint' }; }
  if (!request.defaultDevice.trim()) return { ok: false, error: 'Enter a default iOS device model' };
  if (!request.defaultIosVersion.trim()) return { ok: false, error: 'Enter a default iOS version' };
  if (!['safari', 'chrome'].includes(request.defaultBrowser)) return { ok: false, error: 'Choose Safari or Chrome iOS' };
  return { ok: true };
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/([?&](?:token|key|secret|password|accessKey)=)[^&\s]*/gi, '$1[REDACTED]')
    .replace(/\b(token|key|secret|password|accessKey)\s*[=:]\s*[^\s&]+/gi, '$1=[REDACTED]');
}
```

- [ ] **Step 4: Extend `QaDeviceMode` and request validation**

In `src/shared/mobileDevices.ts`:

```ts
export type QaDeviceMode = 'desktop' | 'android' | 'ios-emulation' | 'real-ios';
```

In `src/shared/testRun.ts`, import `RealIosCapabilitySelection`, add `realIos?: RealIosCapabilitySelection`, include `real-ios` in the accepted device modes, and enforce:

```ts
if (deviceMode === 'real-ios') {
  if (request.sessions !== 1 || request.concurrency !== 1) {
    return { ok: false, error: 'Real iOS Device runs use exactly 1 session and concurrency 1' };
  }
  if (!request.realIos?.device.trim()) return { ok: false, error: 'Choose a real iOS device model' };
  if (!request.realIos?.iosVersion.trim()) return { ok: false, error: 'Choose a real iOS version' };
  if (!['safari', 'chrome'].includes(request.realIos?.browser ?? '')) {
    return { ok: false, error: 'Choose Safari or Chrome iOS' };
  }
}
```

- [ ] **Step 5: Add `real-ios` cases to `src/shared/testRun.test.ts`**

```ts
it('limits real iOS runs to one remote device', () => {
  const request: QaRunRequest = {
    targetUrl: 'https://example.com', deviceMode: 'real-ios', browser: 'webkit',
    sessions: 2, concurrency: 1, headless: false, steps: [],
    realIos: { device: 'iPhone 15', iosVersion: '17', browser: 'safari' },
  };
  expect(validateQaRunRequest(request)).toEqual({
    ok: false,
    error: 'Real iOS Device runs use exactly 1 session and concurrency 1',
  });
});
```

- [ ] **Step 6: Run shared tests and verify GREEN**

```bash
npx vitest run src/shared/realIos.test.ts src/shared/testRun.test.ts src/shared/mobileDevices.test.ts
```

Expected: all selected tests PASS.

---

### Task 2: Generic WebDriver/Appium Provider Adapter

**Files:**
- Create: `electron/real-ios-provider.cjs`
- Create: `electron/real-ios-provider.test.cjs`

**Interfaces:**
- Produces `createRealIosProvider({ fetchImpl, timeoutMs })`.
- Adapter methods: `testConnection(config)`, `createSession(config, selection)`, `navigate(config, sessionId, url)`, `executeScript(config, sessionId, script, args)`, `click(config, sessionId, selector)`, `type(config, sessionId, selector, value)`, `scroll(config, sessionId, direction, distance)`, `screenshot(config, sessionId)`, `deleteSession(config, sessionId)`.
- Uses W3C WebDriver JSON payloads only.

- [ ] **Step 1: Write failing adapter tests with a local fake WebDriver server**

Use Node `http.createServer()` and record requests. Required assertions:

```js
test('creates and deletes a Safari iOS WebDriver session', async () => {
  // fake POST /session returns { value: { sessionId: 'abc', capabilities: { browserName: 'safari' } } }
  // fake DELETE /session/abc returns { value: null }
  const provider = createRealIosProvider({ fetchImpl: fetch, timeoutMs: 1000 });
  const created = await provider.createSession(config, { device: 'iPhone 15', iosVersion: '17', browser: 'safari' });
  assert.equal(created.sessionId, 'abc');
  await provider.deleteSession(config, 'abc');
  assert.equal(requests.at(-1).method, 'DELETE');
});
```

Also test:
- Basic auth header when username/accessKey are present.
- timeout becomes `Provider unreachable or timed out`.
- `testConnection()` reads `/status` and normalizes `safariSupported`/`chromeSupported` from returned capabilities when available.

- [ ] **Step 2: Run adapter tests and verify RED**

```bash
node --test electron/real-ios-provider.test.cjs
```

Expected: FAIL because the adapter module does not exist.

- [ ] **Step 3: Implement the adapter**

Use a small `request()` helper:

```js
async function request(config, path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
    if (config.username || config.accessKey) {
      headers.authorization = `Basic ${Buffer.from(`${config.username || ''}:${config.accessKey || ''}`).toString('base64')}`;
    }
    const response = await fetchImpl(`${config.remoteUrl}${path}`, { ...options, headers, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.value?.error) throw new Error(body?.value?.message || `Provider HTTP ${response.status}`);
    return body;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Provider unreachable or timed out');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
```

Create-session payload:

```js
{
  capabilities: {
    alwaysMatch: {
      platformName: 'iOS',
      browserName: selection.browser === 'chrome' ? 'chrome' : 'safari',
      'appium:deviceName': selection.device,
      'appium:platformVersion': selection.iosVersion,
      'appium:automationName': 'XCUITest'
    }
  }
}
```

Translate CSS selector actions using `/element` followed by `/element/{id}/click` or `/element/{id}/value`; scroll via `/execute/sync` with `window.scrollBy(0, distance)`.

- [ ] **Step 4: Run adapter tests and verify GREEN**

```bash
node --test electron/real-ios-provider.test.cjs
```

Expected: all adapter tests PASS.

---

### Task 3: Encrypted Provider Configuration and Real-iOS Service Lifecycle

**Files:**
- Create: `electron/real-ios-service.cjs`
- Create: `electron/real-ios-service.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces `createRealIosService({ userDataPath, safeStorage, provider, now, randomId })`.
- Methods: `getPublicConfig()`, `saveConfig(request)`, `testConnection()`, `run({ runId, request, emit, screenshotsRoot })`.
- `getPublicConfig()` never returns `accessKey`.
- `run()` always calls `deleteSession()` in `finally`.

- [ ] **Step 1: Write failing service tests**

Cover these concrete behaviors:

```js
test('saves access key encrypted and never returns it publicly', async () => {
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`),
    decryptString: (buffer) => buffer.toString().replace(/^enc:/, ''),
  };
  const service = createRealIosService({ userDataPath: tempDir, safeStorage, provider: fakeProvider });
  await service.saveConfig(saveRequest);
  const publicConfig = await service.getPublicConfig();
  assert.equal(publicConfig.credentialsSaved, true);
  assert.equal('accessKey' in publicConfig, false);
});
```

```js
test('deletes remote session when a behavior step fails', async () => {
  fakeProvider.click = async () => { throw new Error('element not found'); };
  await assert.rejects(() => service.run(runArgs), /element not found/);
  assert.equal(fakeProvider.deletedSessionIds.includes('remote-1'), true);
});
```

Also test:
- invalid endpoint rejected before storage;
- connection test returns provider capability status;
- Chrome run rejected when `chromeSupported === false`;
- cleanup error is emitted separately while preserving the primary error;
- screenshot base64 is written below `screenshotsRoot/<runId>/`;
- diagnostics execute script returns observed values and literal ICE candidate list unchanged.

- [ ] **Step 2: Run service tests and verify RED**

```bash
node --test electron/real-ios-service.test.cjs
```

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement encrypted config storage**

Store only a JSON config file under `userDataPath/real-ios-provider.json`:

```js
{
  "providerName": "Device Cloud",
  "remoteUrl": "https://hub.example.test/wd/hub",
  "username": "qa-user",
  "accessKeyEncrypted": "<base64>",
  "defaultDevice": "iPhone 15",
  "defaultIosVersion": "17",
  "defaultBrowser": "safari"
}
```

When `safeStorage.isEncryptionAvailable()` is false, reject saving a non-empty access key with `Secure credential storage is unavailable on this system` instead of storing plaintext.

- [ ] **Step 4: Implement real-device run lifecycle**

Run order:

```js
const startedAt = now();
let sessionId = null;
let primaryError = null;
try {
  const status = await testConnection();
  // validate requested browser against capability flags
  const created = await provider.createSession(privateConfig, request.realIos);
  sessionId = created.sessionId;
  emit({ type: 'real-ios-session', runId, timestamp: nowIso(), message: 'Remote iOS session started' });
  await provider.navigate(privateConfig, sessionId, request.targetUrl);
  // execute Wait/Scroll/Click/Type/Screenshot steps
  // execute diagnostic script
  // capture final screenshot
  return structuredResult;
} catch (error) {
  primaryError = error;
  throw error;
} finally {
  if (sessionId) {
    try { await provider.deleteSession(privateConfig, sessionId); }
    catch (cleanupError) {
      emit({ type: 'log', runId, timestamp: nowIso(), message: `Cleanup warning: ${redact(cleanupError.message)}` });
      if (!primaryError) throw cleanupError;
    }
  }
}
```

- [ ] **Step 5: Add service tests to the project test command**

Change `package.json`:

```json
"test": "vitest run && node --test electron/qa-runner.test.cjs electron/android-service.test.cjs electron/real-ios-provider.test.cjs electron/real-ios-service.test.cjs electron/layout-css.test.cjs"
```

- [ ] **Step 6: Run service tests and verify GREEN**

```bash
node --test electron/real-ios-provider.test.cjs electron/real-ios-service.test.cjs
```

Expected: all provider/service tests PASS.

---

### Task 4: Electron IPC and Preload Boundary

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/vite-env.d.ts`

**Interfaces:**
- Renderer methods: `getRealIosProviderConfig()`, `saveRealIosProviderConfig(request)`, `testRealIosProvider()`, existing `startQaRun(request)`.
- `qa:startRun` delegates `real-ios` requests to `RealIosService.run()` and existing modes to `executeQaRun()`.

- [ ] **Step 1: Add renderer-side type contract first**

In `src/vite-env.d.ts` import shared real-iOS types and add:

```ts
getRealIosProviderConfig: () => Promise<RealIosProviderPublicConfig | null>;
saveRealIosProviderConfig: (request: RealIosProviderSaveRequest) => Promise<RealIosProviderPublicConfig>;
testRealIosProvider: () => Promise<RealIosProviderStatus>;
```

- [ ] **Step 2: Add narrow preload methods**

```js
getRealIosProviderConfig: () => ipcRenderer.invoke('realIos:getConfig'),
saveRealIosProviderConfig: (request) => ipcRenderer.invoke('realIos:saveConfig', request),
testRealIosProvider: () => ipcRenderer.invoke('realIos:testConnection'),
```

Do not expose generic `ipcRenderer`, arbitrary HTTP, or stored access keys.

- [ ] **Step 3: Add main-process handlers and routing**

At startup:

```js
const { safeStorage } = require('electron');
const { createRealIosProvider } = require('./real-ios-provider.cjs');
const { createRealIosService } = require('./real-ios-service.cjs');

let realIosService;
app.whenReady().then(() => {
  realIosService = createRealIosService({
    userDataPath: app.getPath('userData'),
    safeStorage,
    provider: createRealIosProvider(),
  });
  createMainWindow();
});
```

Handlers:

```js
ipcMain.handle('realIos:getConfig', () => realIosService.getPublicConfig());
ipcMain.handle('realIos:saveConfig', (_event, request) => realIosService.saveConfig(request));
ipcMain.handle('realIos:testConnection', () => realIosService.testConnection());
```

Inside `qa:startRun`, branch on `normalized.deviceMode === 'real-ios'` and call `realIosService.run(...)`; keep the existing active-run guard unchanged.

- [ ] **Step 4: Run the Node service suite**

```bash
node --test electron/qa-runner.test.cjs electron/android-service.test.cjs electron/real-ios-provider.test.cjs electron/real-ios-service.test.cjs
```

Expected: all Node tests PASS.

---

### Task 5: Real iOS Provider Settings Page

**Files:**
- Create: `src/pages/Settings.tsx`
- Create: `src/pages/Settings.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes preload methods from Task 4.
- Saves only user-entered access key; loaded settings expose `credentialsSaved` but never the secret value.
- Connection test renders capability flags for Safari and Chrome iOS.

- [ ] **Step 1: Write failing Settings renderer tests**

```tsx
it('never renders a stored access key after loading provider settings', async () => {
  window.orbitqa = fakeOrbitqa({
    getRealIosProviderConfig: async () => ({
      providerName: 'Cloud', remoteUrl: 'https://hub.test', username: 'qa',
      defaultDevice: 'iPhone 15', defaultIosVersion: '17', defaultBrowser: 'safari', credentialsSaved: true,
    }),
  });
  render(<Settings />);
  expect(await screen.findByText(/credentials saved/i)).toBeInTheDocument();
  expect(screen.queryByDisplayValue(/secret/i)).not.toBeInTheDocument();
});
```

```tsx
it('shows provider browser support after connection test', async () => {
  // click Test Connection; assert Safari Supported and Chrome Unsupported labels
});
```

- [ ] **Step 2: Run Settings tests and verify RED**

```bash
npx vitest run src/pages/Settings.test.tsx
```

Expected: FAIL because `Settings.tsx` does not exist and App still renders a placeholder.

- [ ] **Step 3: Implement the Settings page**

Form fields:
- Provider name
- Remote WebDriver URL
- Username
- Access key/token (`type="password"`, blank after load)
- Default device
- Default iOS version
- Default browser Safari/Chrome

Buttons:
- `SAVE PROVIDER SETTINGS`
- `TEST CONNECTION`

Status card must display:
- Configured / Not configured
- Reachable / Unreachable
- Authenticated / Authentication rejected
- Safari Supported / Unsupported
- Chrome iOS Supported / Unsupported

- [ ] **Step 4: Wire Settings in `src/App.tsx`**

```tsx
import { Settings } from './pages/Settings';
...
} else if (page === 'settings') {
  return <Settings />;
}
```

Use the existing conditional JSX style rather than introducing a router.

- [ ] **Step 5: Add focused CSS for provider cards/forms**

Reuse existing `.panel`, `.field`, `.primary-button`, `.secondary-button`, `.status-pill` styles. Add only layout classes such as `.provider-settings-grid`, `.provider-status-grid`, `.credential-state`.

- [ ] **Step 6: Run Settings tests and verify GREEN**

```bash
npx vitest run src/pages/Settings.test.tsx src/App.test.tsx
```

Expected: PASS.

---

### Task 6: Test Runs Real-iOS Mode and Device Profiles Labeling

**Files:**
- Modify: `src/pages/Run.tsx`
- Modify: `src/pages/TestRuns.test.tsx`
- Modify: `src/pages/DeviceProfiles.tsx`
- Modify: `src/pages/DeviceProfiles.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Test Runs consumes provider public config and connection status from Task 4.
- Builds `QaRunRequest.deviceMode = 'real-ios'` with `realIos` selection.
- Chrome option disabled/hidden when `chromeSupported` is false.
- Existing local mode text becomes `Local iOS Compatibility` everywhere.

- [ ] **Step 1: Write failing Test Runs renderer tests**

Add tests:

```tsx
it('shows real iOS controls only in Real iOS Device mode', async () => {
  render(<TestRuns />);
  fireEvent.change(screen.getByLabelText(/target device/i), { target: { value: 'real-ios' } });
  expect(await screen.findByLabelText(/real iOS device model/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/iOS version/i)).toBeInTheDocument();
});
```

```tsx
it('disables Chrome iOS when provider reports it unsupported', async () => {
  // mock testRealIosProvider => chromeSupported false
  // assert Chrome option disabled or absent
});
```

```tsx
it('blocks start when provider settings are missing', async () => {
  // getRealIosProviderConfig => null; select real-ios; assert Start disabled and explanation visible
});
```

- [ ] **Step 2: Write failing Device Profiles labeling test**

```tsx
it('separates Local iOS Compatibility from Real iOS Device', () => {
  render(<DeviceProfiles />);
  expect(screen.getByRole('button', { name: 'Local iOS Compatibility' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Real iOS Device' })).toBeInTheDocument();
});
```

- [ ] **Step 3: Run renderer tests and verify RED**

```bash
npx vitest run src/pages/TestRuns.test.tsx src/pages/DeviceProfiles.test.tsx
```

Expected: FAIL because Real iOS controls do not exist and local mode still says `iOS Browser QA`.

- [ ] **Step 4: Implement Test Runs Real-iOS UI**

When `deviceMode === 'real-ios'`:
- force `sessions = 1`, `concurrency = 1`, `headless = false`;
- load provider public config once on mode selection;
- user can select/edit device model, iOS version, Safari/Chrome based on provider status;
- Start button disabled unless provider config exists and last connection test says reachable/authenticated;
- button label `START REAL iOS TEST`;
- session logs reuse the existing activity feed;
- real-iOS diagnostics render in the same observed-environment panel style, but display values as observed rather than “pass” spoofing.

Request shape:

```ts
realIos: deviceMode === 'real-ios' ? {
  device: realIosDevice,
  iosVersion: realIosVersion,
  browser: realIosBrowser,
} : undefined,
```

- [ ] **Step 5: Rename local iOS compatibility labels**

Change user-facing `iOS Browser QA` strings to `Local iOS Compatibility`, preserving the warning that it is Windows WebKit and not Apple's simulator.

Add a separate Device Profiles tab/card `Real iOS Device` that explains provider-backed physical/remote devices and links the user conceptually to Settings without embedding credentials there.

- [ ] **Step 6: Run renderer tests and verify GREEN**

```bash
npx vitest run src/pages/TestRuns.test.tsx src/pages/DeviceProfiles.test.tsx src/App.test.tsx
```

Expected: PASS.

---

### Task 7: Full Regression, Build, and Patch Packaging

**Files:**
- Modify if needed: `README.md`
- Create: `REAL-IOS-SETUP.txt`
- Create artifact outside project: `/mnt/data/orbitqa-real-ios-device-v0.4.zip`

**Interfaces:**
- Documentation explains Local iOS Compatibility versus Real iOS Device, generic WebDriver endpoint requirements, safe credential behavior, one-session limit, and provider capability gating.

- [ ] **Step 1: Update documentation with exact setup flow**

`REAL-IOS-SETUP.txt` must instruct:

```text
OrbitQA > Settings > Real iOS Provider
1. Enter provider name.
2. Enter HTTPS remote WebDriver/Appium endpoint.
3. Enter username if required.
4. Enter access key/token; OrbitQA stores it encrypted and will not display it again.
5. Enter default iPhone/iPad model and iOS version.
6. Choose Safari; choose Chrome only if your provider supports Chrome iOS automation.
7. Save settings.
8. Click Test Connection.
9. Open Test Runs > Real iOS Device.
10. Run one authorized QA session.
```

- [ ] **Step 2: Run the complete test suite**

```bash
npm test
```

Expected: exit code `0`, all Vitest and Node tests pass.

- [ ] **Step 3: Run the production TypeScript/Vite build**

```bash
npm run build
```

Expected: exit code `0`, TypeScript emits no errors and Vite creates `dist/`.

- [ ] **Step 4: Verify no secret leakage strings in renderer source**

```bash
grep -R "accessKeyEncrypted\|decryptString" src || true
```

Expected: no matches. Encryption/decryption stays in `electron/` only.

- [ ] **Step 5: Package the update**

From `/mnt/data/orbitqa_build/orbitqa-desktop`, include only source/config/docs required to overwrite the user's project; exclude `node_modules`, `dist`, `.git`, and runtime screenshots.

```bash
zip -r /mnt/data/orbitqa-real-ios-device-v0.4.zip . \
  -x 'node_modules/*' 'dist/*' '.git/*' 'runs/*'
```

- [ ] **Step 6: Report exact verification evidence**

Report the fresh `npm test` totals and `npm run build` exit status. Do not claim completion if either command fails.

---

## Self-Review

- **Spec coverage:** Tasks cover provider-independent adapter, encrypted config, Settings UI, Test Runs integration, Safari/Chrome capability gating, one-session limit, observed diagnostics, cleanup-on-failure, local-mode rename, and fake-server automated testing.
- **Placeholder scan:** No `TBD`, `TODO`, “implement later”, or undefined future behavior remains in the plan.
- **Type consistency:** `RealIosBrowser` is `safari | chrome`; `RealIosCapabilitySelection` uses `device`, `iosVersion`, `browser`; `QaDeviceMode` uses `real-ios`; preload method names match the renderer contract exactly.
- **Scope:** This plan produces one working Real iOS connector feature; vendor-specific presets, billing, cloud account management, and anti-detection spoofing are explicitly outside V1.
