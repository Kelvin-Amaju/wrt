function check(key, label, status, extra = {}) {
  return { key, label, status, ...extra };
}

function routeState(proxyRequired, strictMode, route, assessment) {
  if (!proxyRequired) return 'info';
  if (!route || route.error || !route.proxiedIp) return strictMode ? 'not-verified' : 'fail';
  if (assessment?.route?.status === 'fail' || assessment?.fallback?.status === 'fail') return 'fail';
  if (!assessment || !assessment.route || !assessment.fallback) return strictMode ? 'not-verified' : 'fail';
  return 'pass';
}

function permissionStatus(state, strictMode) {
  if (state === 'unsupported' || state == null) return 'unsupported';
  if (!strictMode) return 'info';
  return state === 'denied' ? 'blocked' : 'fail';
}

function webdriverValue(identityReport) {
  if (typeof identityReport?.observed?.webdriver === 'boolean') return identityReport.observed.webdriver;
  const found = (identityReport?.checks || []).find((item) => item?.key === 'webdriver');
  if (found && /true/i.test(String(found.observed))) return true;
  if (found && /false/i.test(String(found.observed))) return false;
  return null;
}

function buildPrivacyRouteIntegrityReport(input = {}) {
  const {
    phase = 'pre-navigation', deviceMode = 'desktop', strictMode = false,
    proxySource = 'none', proxyRequired = false,
    initialRoute = null, finalRoute = null,
    initialRouteAssessment = null, finalRouteAssessment = null,
    privacyReport = null, runtimeVerification = null, runtimeLabel = '', identityReport = null,
    observedAt = new Date().toISOString(),
  } = input;

  const checks = [];
  const runtimeObserved = runtimeVerification?.verificationLabel || runtimeVerification?.browserVersion || runtimeLabel || deviceMode || 'Unknown runtime';
  checks.push(check('browser-runtime', 'Browser runtime', 'info', { observed:String(runtimeObserved) }));

  const activeRoute = phase === 'post-behavior' ? finalRoute : initialRoute;
  const activeAssessment = phase === 'post-behavior' ? finalRouteAssessment : initialRouteAssessment;
  const activeRouteStatus = routeState(proxyRequired, strictMode, activeRoute, activeAssessment);
  checks.push(check(
    phase === 'post-behavior' ? 'post-behavior-route' : 'proxy-exit-route',
    phase === 'post-behavior' ? 'Post-behavior proxy route' : 'Proxy exit route',
    activeRouteStatus,
    {
      expected:proxyRequired ? 'Verified required proxy route' : 'Direct or configured route',
      observed:activeRoute?.proxiedIp || activeRoute?.error || 'Unavailable',
      detail:activeRoute?.error ? `Route verification error: ${activeRoute.error}` : undefined,
    },
  ));

  const proxiedIp = activeRoute?.proxiedIp;
  const directIp = activeRoute?.directIp || initialRoute?.directIp || finalRoute?.directIp;
  const directExposure = Boolean(proxyRequired && directIp && proxiedIp && directIp === proxiedIp);
  checks.push(check('direct-ip-exposure', 'Direct route isolation', proxyRequired ? (directExposure ? 'fail' : activeRouteStatus === 'not-verified' ? 'not-verified' : 'pass') : 'info', {
    expected:proxyRequired ? 'No host/direct request while proxy mode is active' : 'No required proxy',
    observed:proxyRequired ? (directExposure ? `Known direct route matched: ${proxiedIp}` : proxiedIp ? `Proxy-only exit: ${proxiedIp}` : 'Proxy verification unavailable') : 'Direct mode',
    detail:proxyRequired ? 'Host direct-IP probing and direct fallback are disabled for proxied work units.' : undefined,
  }));

  if (privacyReport) {
    const policy = privacyReport.webRtcPolicy || privacyReport?.observed?.webRtcPolicy || 'indeterminate';
    let status = 'not-verified';
    if (policy === 'prevented' || policy === 'verified-no-leak') status = 'pass';
    else if (policy === 'exposed') status = proxyRequired ? 'fail' : 'info';
    else if (policy === 'unsupported') status = 'unsupported';
    else if (policy === 'indeterminate') status = proxyRequired && strictMode ? 'not-verified' : 'info';
    checks.push(check('webrtc', 'WebRTC route privacy', status, {
      expected:proxyRequired ? 'No host direct public IP through WebRTC' : 'Observed WebRTC route state',
      observed:String(policy),
    }));

    const permissionStates = privacyReport?.observed?.permissionStates || {};
    for (const key of ['camera','microphone','geolocation','notifications']) {
      const state = permissionStates[key];
      checks.push(check(key, `${key[0].toUpperCase()}${key.slice(1)} permission`, permissionStatus(state, strictMode), {
        expected:strictMode ? 'denied' : 'Observed only', observed:state || 'Unavailable',
      }));
    }
  } else if (phase !== 'pre-navigation' && ['android-avd','real-ios'].includes(deviceMode)) {
    checks.push(check('webrtc', 'WebRTC route privacy', 'unsupported', { observed:`${deviceMode} probe unavailable` }));
  }

  if (phase === 'post-behavior') {
    const before = initialRoute?.proxiedIp;
    const after = finalRoute?.proxiedIp;
    const changed = Boolean(before && after && before !== after);
    const routeVerified = activeRouteStatus === 'pass';
    let continuity = 'not-verified';
    if (!proxyRequired) continuity = 'info';
    else if (!routeVerified || !before || !after) continuity = strictMode ? 'not-verified' : 'fail';
    else if (!changed || proxySource === 'rotating') continuity = 'pass';
    else continuity = 'fail';
    checks.push(check('route-continuity', 'Route continuity', continuity, {
      expected:proxySource === 'rotating' ? 'Verified proxy exit may rotate' : 'Required static/manual proxy exit remains stable',
      observed:before && after ? `${before} -> ${after}` : 'Unavailable',
    }));
  }

  const dnsStatus = !proxyRequired
    ? 'info'
    : activeRouteStatus === 'pass'
      ? 'pass'
      : strictMode ? 'not-verified' : 'fail';
  checks.push(check('dns-route-integrity', 'DNS route integrity', dnsStatus, {
    expected:proxyRequired ? 'Destination hostnames stay inside the configured proxy transport' : 'Direct-mode resolver behavior',
    observed:proxyRequired
      ? (dnsStatus === 'pass' ? 'Proxy transport verified for destination routing' : 'Proxy transport could not be verified')
      : 'Direct mode',
    detail:proxyRequired
      ? 'OrbitQA verifies the browser proxy route and does not install a host DNS kill-switch. HTTP/HTTPS and SOCKS proxy transports carry destination hostnames through the configured proxy path. This verifies enforced transport routing; it does not claim the identity of an upstream resolver.'
      : 'No proxy route is required for this task.',
    verificationMethod:proxyRequired ? 'proxy-transport' : 'direct-mode',
  }));

  const webdriver = webdriverValue(identityReport);
  if (webdriver !== null) {
    checks.push(check('automation-environment', 'Automation environment', 'info', {
      observed:`navigator.webdriver=${webdriver}`,
      detail:'Reported truthfully. OrbitQA does not hide or rewrite automation observability.',
    }));
  }

  const hasFail = checks.some((item) => item.status === 'fail');
  const requiredKeys = new Set(phase === 'post-behavior'
    ? ['post-behavior-route','direct-ip-exposure','route-continuity','webrtc','dns-route-integrity']
    : phase === 'pre-behavior'
      ? ['proxy-exit-route','direct-ip-exposure','webrtc','dns-route-integrity']
      : ['proxy-exit-route','direct-ip-exposure','dns-route-integrity']);
  const requiredNotVerified = proxyRequired && strictMode && checks.some((item) => requiredKeys.has(item.key) && item.status === 'not-verified');
  const overallStatus = hasFail ? 'fail' : requiredNotVerified ? 'not-verified' : 'pass';

  return {
    overallStatus,
    strictMode:Boolean(strictMode),
    proxyRequired:Boolean(proxyRequired),
    checks,
    runtimeLabel:String(runtimeObserved || ''),
    observedAt:String(observedAt || new Date().toISOString()),
    phase,
  };
}

function shouldBlockPrivacyRouteIntegrity(report) {
  return report?.overallStatus === 'fail'
    || Boolean(report?.strictMode && report?.proxyRequired && report?.overallStatus === 'not-verified');
}

module.exports = { buildPrivacyRouteIntegrityReport, shouldBlockPrivacyRouteIntegrity };
