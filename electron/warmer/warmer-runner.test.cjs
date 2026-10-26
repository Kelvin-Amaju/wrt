const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPodStore } = require('../pod-store.cjs');
const { createCookieStore } = require('../cookie-store.cjs');
const { createWarmerRunner } = require('./warmer-runner.cjs');

test('warmer searches topics, saves profile cookies, continues after a profile failure and sticks to its assigned proxy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-warmer-'));
  const store = createPodStore({ userDataPath: dir }); const { pod, profiles } = store.createPod({ count: 3 });
  store.addTopic('testing'); store.updateProfile(profiles[0].id, { proxyId: 'proxy-1' });
  const typed = []; const scopes = []; const launches = [];
  const chromium = { async launchPersistentContext(profilePath, options) {
    launches.push({ profilePath, options });
    if (profilePath.endsWith(profiles[1].id)) throw new Error('profile 2 failed');
    let currentUrl = 'https://www.google.com';
    const page = { goto: async (url) => { currentUrl = url; }, url: () => currentUrl, waitForLoadState: async () => {}, locator: (selector) => { const target = selector.includes('name="q"') ? { fill: async (value) => typed.push(value), press: async (key) => typed.push(key) } : { evaluateAll: async () => ['https://example.com/a', 'https://example.com/b'].map((href) => ({ href })), nth: (index) => ({ click: async () => { currentUrl = ['https://example.com/a', 'https://example.com/b'][index]; } }) }; return { ...target, first: () => target }; } };
    return { pages: () => [page], newPage: async () => page, cookies: async () => [{ name: 'PREF', value: 'x', domain: 'google.com', path: '/', sameSite: 'Lax' }], close: async () => {} };
  } };
  const cookieStore = createCookieStore({ userDataPath: dir });
  const runner = createWarmerRunner({ userDataPath: dir, podStore: store, cookieStore: { add: (cookie) => { scopes.push(cookie.scope); return cookieStore.add(cookie); } }, chromium, proxyPoolService: { list: async () => [{ id: 'proxy-1', protocol: 'http', hostname: 'proxy.test', port: 8080 }] }, sleep: async () => {}, timeoutMs: 5000 });
  const started = await runner.start({ podId: pod.id });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const final = runner.get(started.run.runId);
  assert.ok(typed.includes('testing')); assert.ok(typed.includes('Enter'));
  assert.equal(store.getProfile(profiles[0].id).status, 'WARM'); assert.equal(store.getProfile(profiles[1].id).status, 'FAILED'); assert.equal(store.getProfile(profiles[2].id).status, 'WARM');
  assert.ok(scopes.includes(profiles[0].id)); assert.ok(cookieStore.list().some((cookie) => cookie.scope === profiles[0].id)); assert.ok(launches.find((x) => x.profilePath.endsWith(profiles[0].id)).options.proxy.server === 'http://proxy.test:8080');
  assert.equal(final.status, 'FAILED'); assert.equal(fs.existsSync(path.join(dir, 'pod-history', `${profiles[0].id}.json`)), true);
  fs.rmSync(dir, { recursive: true, force: true });
});
