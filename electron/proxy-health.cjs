const { parseObservedIp, redactSecrets } = require('./proxy-diagnostics.cjs');
const { findInstalledChromiumBrowser } = require('./streaming/supported-browser-policy.cjs');
const { buildProxyContainmentLaunchPolicy, buildRuntimePerformanceLaunchPolicy, mergeLaunchArgs } = require('./qa-runner.cjs');

const SLOW_THRESHOLD_MS = 2000;
const LIVE_RECHECK_MS = 10 * 60 * 1000;
const SLOW_RECHECK_MS = 5 * 60 * 1000;
const FIRST_DEAD_RETRY_MS = 2 * 60 * 1000;
const SECOND_DEAD_RETRY_MS = 5 * 60 * 1000;
const THIRD_FAILURE_RETRY_MS = 15 * 60 * 1000;
const UNAVAILABLE_RETRY_MS = 30 * 60 * 1000;

function classifyProxyHealth({ ok, latencyMs = 0, failureCount = 0, checkedAtMs = Date.now(), slowThresholdMs = SLOW_THRESHOLD_MS }) {
  if (ok) {
    const health = latencyMs > slowThresholdMs ? 'slow' : 'live';
    const delay = health === 'slow' ? SLOW_RECHECK_MS : LIVE_RECHECK_MS;
    return {
      health,
      failureCount: 0,
      nextCheckAt: new Date(checkedAtMs + delay).toISOString(),
    };
  }

  const nextFailureCount = Number(failureCount || 0) + 1;
  let health = 'dead';
  let delay = FIRST_DEAD_RETRY_MS;
  if (nextFailureCount === 2) delay = SECOND_DEAD_RETRY_MS;
  if (nextFailureCount === 3) {
    health = 'unavailable';
    delay = THIRD_FAILURE_RETRY_MS;
  }
  if (nextFailureCount >= 4) {
    health = 'unavailable';
    delay = UNAVAILABLE_RETRY_MS;
  }
  return {
    health,
    failureCount: nextFailureCount,
    nextCheckAt: new Date(checkedAtMs + delay).toISOString(),
  };
}

function createProxyHealthChecker({ chromium, routeCheckUrl, now = Date.now, slowThresholdMs = SLOW_THRESHOLD_MS, browserResolver = findInstalledChromiumBrowser }) {
  if (!chromium?.launch) throw new Error('Chromium is required for proxy health checks');
  const checkUrl = String(routeCheckUrl || '').trim();
  if (!checkUrl) throw new Error('Proxy route-check URL is required');

  async function checkProxy(runtimeProxy, directIp) {
    const secrets = [runtimeProxy?.username, runtimeProxy?.password];
    let browser;
    try {
      const installedBrowser = browserResolver?.();
      if (!installedBrowser?.executablePath) {
        throw new Error('Google Chrome or Microsoft Edge is required for proxy health checks');
      }
      const containmentPolicy = buildProxyContainmentLaunchPolicy({proxyRequired:true,browserEngine:'chromium',proxyServer:`${runtimeProxy.protocol}://${runtimeProxy.hostname}:${runtimeProxy.port}`});
      const performancePolicy = buildRuntimePerformanceLaunchPolicy({browserEngine:'chromium'});
      browser = await chromium.launch({
        headless: true,
        executablePath: installedBrowser.executablePath,
        args:mergeLaunchArgs(containmentPolicy.args||[],performancePolicy.args||[]),
        proxy: {
          server: `${runtimeProxy.protocol}://${runtimeProxy.hostname}:${runtimeProxy.port}`,
          username: runtimeProxy.username || undefined,
          password: runtimeProxy.password || undefined,
        },
      });
      const page = await browser.newPage();
      const startedAt = now();
      const response = await page.goto(checkUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      if (response && typeof response.ok === 'function' && !response.ok()) {
        throw new Error(`Proxy health check returned HTTP ${response.status()}`);
      }
      const observedIp = parseObservedIp(await page.textContent('body'));
      if (!observedIp) throw new Error('Proxy health check returned an invalid IP response');
      if (directIp && observedIp === directIp) throw new Error('Proxy health check observed the direct route instead of a distinct proxy route');

      const routeCheckedAtMs = now();
      const latencyMs = Math.max(0, routeCheckedAtMs - startedAt);

      // Resolve location metadata through the already-proxied browser only. This never uses
      // the host/direct route and lets later sessions align timezone/locale to the proxy exit.
      let countryCode;
      let country;
      let region;
      let city;
      let latitude;
      let longitude;
      let timezoneId;
      try {
        const geoResponse = await page.goto(`https://ipwho.is/${encodeURIComponent(observedIp)}?fields=success,country,country_code,region,city,latitude,longitude,timezone`, { waitUntil:'domcontentloaded', timeout:7000 });
        if (!geoResponse || typeof geoResponse.ok !== 'function' || geoResponse.ok()) {
          const geoText = String(await page.textContent('body') || '').trim();
          const geo = JSON.parse(geoText);
          if (geo?.success !== false) {
            const code=String(geo?.country_code||'').trim().toUpperCase();
            const zone=String(geo?.timezone?.id||geo?.timezone||'').trim();
            const lat=Number(geo?.latitude); const lon=Number(geo?.longitude);
            if (/^[A-Z]{2}$/.test(code)) countryCode=code;
            if (String(geo?.country||'').trim()) country=String(geo.country).trim();
            if (String(geo?.region||'').trim()) region=String(geo.region).trim();
            if (String(geo?.city||'').trim()) city=String(geo.city).trim();
            if (Number.isFinite(lat) && Math.abs(lat)<=90) latitude=lat;
            if (Number.isFinite(lon) && Math.abs(lon)<=180) longitude=lon;
            if (zone && zone.includes('/')) timezoneId=zone;
          }
        }
      } catch { /* Location metadata is optional; route health remains authoritative. */ }

      const checkedAtMs = now();
      const classification = classifyProxyHealth({
        ok: true,
        latencyMs,
        failureCount: runtimeProxy.failureCount || 0,
        checkedAtMs,
        slowThresholdMs,
      });
      return {
        ...classification,
        latencyMs,
        observedIp,
        ...(countryCode?{countryCode}:{}),
        ...(country?{country}:{}),
        ...(region?{region}:{}),
        ...(city?{city}:{}),
        ...(latitude!=null?{latitude}:{}),
        ...(longitude!=null?{longitude}:{}),
        ...(timezoneId?{timezoneId}:{}),
        checkedAt: new Date(checkedAtMs).toISOString(),
      };
    } catch (cause) {
      const checkedAtMs = now();
      const classification = classifyProxyHealth({
        ok: false,
        failureCount: runtimeProxy?.failureCount || 0,
        checkedAtMs,
        slowThresholdMs,
      });
      return {
        ...classification,
        checkedAt: new Date(checkedAtMs).toISOString(),
        error: redactSecrets(cause instanceof Error ? cause.message : String(cause), secrets),
      };
    } finally {
      if (browser) await browser.close().catch(() => undefined);
    }
  }

  return { checkProxy };
}

module.exports = {
  createProxyHealthChecker,
  classifyProxyHealth,
  SLOW_THRESHOLD_MS,
  LIVE_RECHECK_MS,
  SLOW_RECHECK_MS,
  FIRST_DEAD_RETRY_MS,
  SECOND_DEAD_RETRY_MS,
  THIRD_FAILURE_RETRY_MS,
  UNAVAILABLE_RETRY_MS,
};
