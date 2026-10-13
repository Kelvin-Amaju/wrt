function makeCheck(key, label, status, required, observed, detail) {
  return { key, label, status, required, observed, detail };
}

function routeIsVerified(route) {
  return Boolean(route && !route.error && route.proxiedIp && (!route.directIp || route.directIp !== route.proxiedIp));
}

function buildSessionIntegrityReport({
  proxySource = 'none',
  proxyRequired = false,
  initialRoute = null,
  finalRoute = null,
  privacyReport = null,
  identityReport = null,
}) {
  const checks = [];
  const proxyConfigured = proxySource !== 'none';
  const initialVerified = routeIsVerified(initialRoute);
  const finalVerified = routeIsVerified(finalRoute);
  const directIp = finalRoute?.directIp || initialRoute?.directIp;
  const initialExitIp = initialRoute?.proxiedIp;
  const finalExitIp = finalRoute?.proxiedIp;

  const unverifiedStatus = proxyRequired ? 'fail' : 'warning';
  checks.push(makeCheck(
    'proxy-assignment',
    'Assigned proxy',
    !proxyConfigured ? 'not-applicable' : initialVerified ? 'pass' : unverifiedStatus,
    proxyRequired,
    !proxyConfigured ? 'No proxy configured' : initialVerified ? `${proxySource} proxy reserved` : 'Unverified',
    proxyConfigured ? 'The route is checked from inside the launched browser before target navigation.' : 'This work unit uses the direct route.',
  ));

  checks.push(makeCheck(
    'browser-exit-ip',
    'Browser exit IP',
    !proxyConfigured ? 'not-applicable' : initialVerified ? 'pass' : unverifiedStatus,
    proxyRequired,
    initialExitIp || 'unknown',
    proxyConfigured ? 'Observed inside the browser before the target is opened.' : 'No proxy route verification requested.',
  ));

  const directFallbackDetected = Boolean(proxyConfigured && ((initialRoute?.directIp && initialRoute?.proxiedIp === initialRoute.directIp) || (finalRoute?.directIp && finalRoute?.proxiedIp === finalRoute.directIp)));
  let fallbackStatus = 'not-applicable';
  let fallbackObserved = 'No proxy configured';
  if (proxyConfigured) {
    fallbackObserved = initialVerified && finalVerified ? 'Direct fallback disabled' : 'Proxy verification incomplete';
    fallbackStatus = !initialVerified || !finalVerified ? unverifiedStatus : 'pass';
  }
  checks.push(makeCheck(
    'direct-fallback',
    'Direct IP fallback',
    fallbackStatus,
    proxyRequired,
    fallbackObserved,
    proxyConfigured ? 'The browser is launched with the assigned proxy and OrbitQA does not probe or retry through the host direct route while proxy mode is active.' : 'No proxy route is configured for this work unit.',
  ));

  let continuityStatus = 'not-applicable';
  let continuityObserved = 'No proxy configured';
  if (proxyConfigured) {
    if (!initialVerified || !finalVerified) {
      continuityStatus = unverifiedStatus;
      continuityObserved = 'Route verification incomplete';
    } else if (initialExitIp === finalExitIp) {
      continuityStatus = 'pass';
      continuityObserved = `${initialExitIp} → ${finalExitIp}`;
    } else if (proxySource === 'rotating') {
      continuityStatus = 'warning';
      continuityObserved = `${initialExitIp} → ${finalExitIp}`;
    } else {
      continuityStatus = proxyRequired ? 'fail' : 'warning';
      continuityObserved = `${initialExitIp} → ${finalExitIp}`;
    }
  }
  checks.push(makeCheck(
    'route-continuity',
    'Route continuity',
    continuityStatus,
    proxyRequired && proxySource !== 'rotating',
    continuityObserved,
    proxySource === 'rotating' && continuityStatus === 'warning'
      ? 'Rotating pools may change exit IP. OrbitQA records the change without treating it as direct-route fallback.'
      : 'Static and manual proxy routes are expected to keep the same verified exit IP for the session.',
  ));

  const literalCandidates = privacyReport?.observed?.literalIpCandidates || [];
  const webRtcSupported = privacyReport?.observed?.webRtcSupported !== false;
  const directIpLeak = Boolean(proxyConfigured && directIp && literalCandidates.includes(directIp));
  const webRtcPolicy = privacyReport?.webRtcPolicy
    || (!webRtcSupported ? 'unsupported' : directIpLeak ? 'exposed' : 'verified-no-leak');
  let webrtcStatus = 'not-applicable';
  let webrtcRequired = false;
  if (webRtcPolicy === 'prevented' || webRtcPolicy === 'verified-no-leak') {
    webrtcStatus = 'pass';
    webrtcRequired = Boolean(proxyRequired);
  } else if (webRtcPolicy === 'exposed') {
    webrtcStatus = proxyRequired ? 'fail' : 'warning';
    webrtcRequired = Boolean(proxyRequired);
  } else if (webRtcPolicy === 'indeterminate') {
    webrtcStatus = proxyRequired ? 'fail' : 'warning';
    webrtcRequired = Boolean(proxyRequired);
  }
  checks.push(makeCheck(
    'webrtc-ip-exposure',
    'WebRTC route privacy',
    webrtcStatus,
    webrtcRequired,
    webRtcPolicy === 'unsupported' ? 'WebRTC unavailable' : `${webRtcPolicy} · ${literalCandidates.length} literal candidate(s)`,
    webRtcPolicy === 'exposed'
      ? 'The host direct public IP appeared in a WebRTC candidate while a required proxy route was configured.'
      : webRtcPolicy === 'indeterminate'
        ? 'ICE verification did not complete, so OrbitQA does not claim a privacy pass.'
        : 'WebRTC remains observable and is verified without hiding or rewriting browser candidates.',
  ));

  const locale = privacyReport?.observed?.locale;
  const timezoneId = privacyReport?.observed?.timezoneId;
  checks.push(makeCheck('locale', 'Locale', locale ? 'pass' : 'warning', false, locale || 'unknown', 'Observed browser locale.'));
  checks.push(makeCheck('timezone', 'Timezone', timezoneId ? 'pass' : 'warning', false, timezoneId || 'unknown', 'Observed browser timezone.'));

  const profileConsistency = identityReport?.profileConsistency || identityReport?.overall;
  const identityStatus = identityReport?.blocked
    ? 'fail'
    : profileConsistency === 'warning'
      ? 'warning'
      : profileConsistency === 'pass'
        ? 'pass'
        : 'not-applicable';
  checks.push(makeCheck(
    'device-consistency',
    'Device consistency',
    identityStatus,
    Boolean(identityReport?.blocked),
    identityReport?.profile || identityReport?.mode || (identityReport ? profileConsistency : 'Not reported'),
    identityReport?.blocked ? `Blocked: ${(identityReport.blockingReasons || []).join(', ')}` : 'Uses profile consistency only; host/runtime information is reported separately and does not create a false device warning.',
  ));

  const blockingChecks = checks.filter((check) => check.required && check.status === 'fail');
  const blocked = blockingChecks.length > 0;
  const hasWarning = checks.some((check) => check.status === 'warning');
  const overall = blocked ? 'fail' : hasWarning ? 'warning' : 'pass';

  return {
    overall,
    verdict: blocked ? 'blocked' : hasWarning ? 'warning' : 'verified',
    blocked,
    blockingReasons: blockingChecks.map((check) => check.label),
    proxySource,
    proxyRequired,
    checks,
    observed: {
      directIp,
      initialExitIp,
      finalExitIp,
      literalIpCandidates: [...literalCandidates],
      webRtcPolicy,
      locale,
      timezoneId,
    },
    recordedAt: new Date().toISOString(),
  };
}

module.exports = { buildSessionIntegrityReport, routeIsVerified };
