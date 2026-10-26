const fs = require('node:fs');
const path = require('node:path');
const { createId } = require('../id.cjs');

function createWarmerRunner({ userDataPath, podStore, cookieStore, chromium, webkit, firefox, proxyPoolService, emit = () => {}, now = () => new Date().toISOString(), random = Math.random, timeoutMs = 90000, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const runs = new Map();
  async function warmProfile(run, profile, topics) {
    if (run.stopped) return;
    let context;
    try {
      const profileDeadline = Date.now() + timeoutMs;
      const remainingMs = () => Math.max(1, profileDeadline - Date.now());
      let proxy;
      if (profile.proxyId) {
        const row = (await proxyPoolService?.list?.()).find((item) => item.id === profile.proxyId);
        if (!row) throw new Error('Assigned proxy was not found');
        proxy = row; // Resolved once: proxy remains sticky for the whole profile session.
      }
      podStore.updateProfile(profile.id, { status: 'WARMING', lastProxyRoute: proxy ? `proxy:${profile.proxyId}` : 'direct' });
      emit({ runId: run.runId, profileId: profile.id, status: 'WARMING', proxyRoute: proxy ? `proxy:${profile.proxyId}` : 'direct' });
      const fp = profile.fingerprint;
      const options = { userAgent: fp.userAgent, viewport: fp.viewport, screen: { width: fp.screen.width, height: fp.screen.height }, deviceScaleFactor: fp.deviceScaleFactor, isMobile: profile.deviceType !== 'desktop', hasTouch: fp.maxTouchPoints > 0, locale: fp.locale, timezoneId: fp.timezoneId };
      if (proxy) options.proxy = { server: `${proxy.protocol}://${proxy.hostname}:${proxy.port}`, ...(proxy.username ? { username: proxy.username, password: proxy.password } : {}) };
      const browserType = fp.browserFamily === 'webkit' ? (webkit || chromium) : fp.browserFamily === 'firefox' ? (firefox || chromium) : chromium;
      const launchPromise = browserType.launchPersistentContext(path.join(userDataPath, 'pod-browser-profiles', profile.id), options);
      let timeoutId;
      context = await Promise.race([launchPromise, new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error('Profile warming timed out')), remainingMs()); })]).catch((error) => { void launchPromise.then((lateContext) => lateContext.close()).catch(() => {}); throw error; }).finally(() => clearTimeout(timeoutId));
      run.contexts.add(context);
      const page = context.pages()[0] || await context.newPage();
      const historyFile = path.join(userDataPath, 'pod-history', `${profile.id}.json`);
      let history = []; try { history = JSON.parse(fs.readFileSync(historyFile, 'utf8')); } catch {}
      const navigate = async (url) => { if (run.stopped) throw new Error('Run stopped'); await page.goto(url, { waitUntil: 'domcontentloaded', timeout: remainingMs() }); history.push({ url, visitedAt: now() }); };
      await navigate('https://www.google.com');
      const topic = topics[Math.floor(random() * topics.length)]?.label || 'investments';
      const consent = page.getByRole?.('button', { name: /accept all|agree/i }).first();
      if (consent && await consent.isVisible().catch(() => false)) await consent.click().catch(() => {});
      const search = page.locator('textarea[name="q"], input[name="q"]').first();
      await search.fill(topic, { timeout: remainingMs() }); await search.press('Enter', { timeout: remainingMs() }); await page.waitForLoadState('domcontentloaded', { timeout: remainingMs() }).catch(() => {});
      run.searches += 1; emit({ runId: run.runId, profileId: profile.id, status: 'SEARCHING', topic });
      const links = await page.locator('#search a:has(h3)').evaluateAll((nodes) => nodes.map((node) => node.href).filter((url) => /^https?:/.test(url)).slice(0, 3)).catch(() => []);
      const visits = Math.min(3, links.length);
      for (let i = 0; i < visits && !run.stopped; i += 1) {
        let priorUrl;
        try { const host = new URL(links[i]).hostname; priorUrl = history.find((row) => new URL(row.url).hostname === host)?.url; } catch {}
        if (priorUrl) await navigate(priorUrl);
        else {
          await page.locator('#search a:has(h3)').nth(i).click({ timeout: remainingMs() });
          await page.waitForLoadState('domcontentloaded', { timeout: remainingMs() }).catch(() => {});
          history.push({ url: page.url(), visitedAt: now() });
        }
        await sleep(700 + Math.floor(random() * 1300));
      }
      fs.mkdirSync(path.dirname(historyFile), { recursive: true }); fs.writeFileSync(`${historyFile}.tmp`, JSON.stringify(history, null, 2)); fs.renameSync(`${historyFile}.tmp`, historyFile);
      if (context.cookies) {
        const cookies = await context.cookies();
        for (const c of cookies) { try { cookieStore?.add?.({ label: `Warmer ${profile.id}`, name: c.name, value: c.value, domain: String(c.domain || '').replace(/^\./, ''), path: c.path, secure: c.secure, sameSite: c.sameSite, expires: c.expires, enabled: true, scope: profile.id }); run.cookiesSaved += 1; } catch {} }
      }
      const status = run.stopped ? 'NEW' : 'WARM';
      podStore.updateProfile(profile.id, status === 'WARM' ? { status, lastWarmedAt: now(), warmCount: profile.warmCount + 1 } : { status });
      emit({ runId: run.runId, profileId: profile.id, status });
    } catch (error) {
      const reason = String(error?.message || error); podStore.updateProfile(profile.id, { status: run.stopped ? 'NEW' : 'FAILED' });
      if (!run.stopped) emit({ runId: run.runId, profileId: profile.id, status: 'FAILED', error: reason });
    } finally { run.contexts.delete(context); await context?.close?.().catch?.(() => {}); }
  }
  async function start(request = {}) {
    const pod = podStore.getPod(request.podId); if (!pod) return { ok: false, error: 'Pod was not found' };
    const all = podStore.listProfiles(pod.id); const wanted = Array.isArray(request.profileIds) ? new Set(request.profileIds.map(String)) : null;
    const profiles = all.filter((p) => !wanted || wanted.has(p.id)); if (!profiles.length) return { ok: false, error: 'No profiles selected' };
    const topicIds = Array.isArray(request.topicIds) ? new Set(request.topicIds.map(String)) : null;
    const topics = podStore.listTopics().filter((x) => !topicIds || topicIds.has(x.id));
    const runId = createId('warmer-run'); const run = { runId, podId: pod.id, profileIds: profiles.map((p) => p.id), status: 'RUNNING', startedAt: now(), finishedAt: null, searches: 0, cookiesSaved: 0, error: null, stopped: false, contexts: new Set() };
    runs.set(runId, run); emit({ runId, status: 'RUNNING' });
    run.promise = (async () => { for (let i = 0; i < profiles.length && !run.stopped; i += 3) await Promise.all(profiles.slice(i, i + 3).map((p) => warmProfile(run, p, topics))); run.status = run.stopped ? 'STOPPED' : profiles.some((p) => podStore.getProfile(p.id)?.status === 'FAILED') ? 'FAILED' : 'COMPLETED'; run.finishedAt = now(); emit({ ...summary(run) }); })();
    return { ok: true, run: summary(run) };
  }
  function summary(run) { const { stopped, promise, ...value } = run; return value; }
  return { start, stop(id) { const run = runs.get(String(id)); if (!run || run.finishedAt) return { ok: false, error: 'Run is not active' }; run.stopped = true; run.status = 'STOPPED'; for (const context of run.contexts) void context.close().catch(() => {}); return { ok: true }; }, delete(id) { const run = runs.get(String(id)); if (!run || !run.finishedAt) return { ok: false, error: 'Only finished warmer runs can be deleted' }; runs.delete(String(id)); return { ok: true, deleted: true, runId: String(id) }; }, list() { return [...runs.values()].map(summary).sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }, get(id) { return runs.has(String(id)) ? summary(runs.get(String(id))) : null; } };
}

module.exports = { createWarmerRunner };
