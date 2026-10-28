const net = require('node:net');

const GUARD_FLAG = '__orbitqaStrictGuardBlocked';
const BLOCKED_MARKER = '__orbitqaStrictBlocked';
const GUARDED_PERMISSIONS = ['camera', 'microphone', 'geolocation', 'notifications'];

// Runs as an init script in the main world before any site code, on every document.
function strictPrivacyGuardSource(options) {
  const config = options && typeof options === 'object' ? options : {};
  const spoof = config.geolocation && Number.isFinite(Number(config.geolocation.latitude))
    && Number.isFinite(Number(config.geolocation.longitude))
    ? {
        latitude: Number(config.geolocation.latitude),
        longitude: Number(config.geolocation.longitude),
        accuracy: Number.isFinite(Number(config.geolocation.accuracy)) ? Number(config.geolocation.accuracy) : 20,
      }
    : null;

  const deniedError = () => new DOMException('Blocked by OrbitQA Strict Privacy Mode', 'NotAllowedError');
  const deniedPositionError = () => {
    const error = { code: 1, message: 'Blocked by OrbitQA Strict Privacy Mode' };
    try { Object.defineProperty(error, 'PERMISSION_DENIED', { value: 1 }); } catch { error.PERMISSION_DENIED = 1; }
    return error;
  };
  const spoofedPosition = () => ({
    coords: {
      latitude: spoof.latitude,
      longitude: spoof.longitude,
      accuracy: spoof.accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: Date.now(),
  });

  const define = (target, key, value) => {
    if (!target) return false;
    try {
      Object.defineProperty(target, key, { configurable: true, writable: true, value });
      return true;
    } catch {
      try { target[key] = value; return true; } catch { return false; }
    }
  };

  const markBlocked = (fn) => {
    try { Object.defineProperty(fn, BLOCKED_MARKER, { configurable: true, value: true }); } catch { /* marker is best effort */ }
    return fn;
  };

  // The engine may hand back a brand new instance for navigator.geolocation on every
  // access, so an own property written on the object captured at document-start is not
  // guaranteed to be the object a later access returns. Writing to the shared prototype
  // always is. Do both: the instance for stable objects, the prototype for lazy ones.
  const defineGuarded = (object, key, fn) => {
    if (!object) return null;
    const guarded = markBlocked(fn);
    define(object, key, guarded);
    let prototype = null;
    try { prototype = Object.getPrototypeOf(object); } catch { prototype = null; }
    if (prototype && prototype !== object && prototype !== Object.prototype && prototype !== Function.prototype) {
      define(prototype, key, guarded);
    }
    return guarded;
  };

  const blocked = { camera: false, microphone: false, geolocation: false, notifications: false };

  const media = globalThis.navigator && navigator.mediaDevices;
  if (media && typeof media.getUserMedia === 'function') {
    defineGuarded(media, 'getUserMedia', async () => { throw deniedError(); });
    blocked.camera = true;
    blocked.microphone = true;
  }

  const geo = globalThis.navigator && navigator.geolocation;
  if (geo && typeof geo.getCurrentPosition === 'function') {
    if (spoof) {
      defineGuarded(geo, 'getCurrentPosition', (success) => {
        if (typeof success === 'function') success(spoofedPosition());
      });
      defineGuarded(geo, 'watchPosition', (success) => {
        if (typeof success === 'function') success(spoofedPosition());
        return 0;
      });
    } else {
      const deny = (_success, error) => { if (typeof error === 'function') error(deniedPositionError()); };
      defineGuarded(geo, 'getCurrentPosition', deny);
      defineGuarded(geo, 'watchPosition', (_success, error) => { deny(_success, error); return 0; });
    }
    blocked.geolocation = true;
  }

  if (typeof globalThis.Notification !== 'undefined') {
    defineGuarded(Notification, 'requestPermission', async () => 'denied');
    try { Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'denied' }); } catch { /* requestPermission remains blocked */ }
    blocked.notifications = true;
  }

  // Keep the Permissions API consistent with what getCurrentPosition actually does.
  const permissions = globalThis.navigator && navigator.permissions;
  if (permissions && typeof permissions.query === 'function') {
    const nativeQuery = permissions.query.bind(permissions);
    defineGuarded(permissions, 'query', (descriptor) => {
      const name = descriptor && descriptor.name;
      if (!GUARDED_PERMISSIONS.includes(name)) return nativeQuery(descriptor);
      const state = name === 'geolocation' && spoof ? 'granted' : 'denied';
      return Promise.resolve(nativeQuery(descriptor))
        .then((status) => {
          try {
            return new Proxy(status, {
              get: (target, property) => {
                if (property === 'state') return state;
                const value = Reflect.get(target, property, target);
                return typeof value === 'function' ? value.bind(target) : value;
              },
              set: (target, property, value) => {
                try { target[property] = value; } catch { /* readonly status */ }
                return true;
              },
            });
          } catch {
            return status;
          }
        })
        .catch(() => nativeQuery(descriptor));
    });
  }

  // Identity-independent marker: survives instance recreation and prototype swaps.
  try {
    Object.defineProperty(globalThis, GUARD_FLAG, {
      configurable: true,
      value: Object.freeze({ ...blocked, spoofed: Boolean(spoof), version: 2 }),
    });
  } catch { /* the per-function marker remains */ }
}

async function installStrictPrivacyGuard(context, strictMode, options) {
  if (!strictMode) return;
  if (!context || typeof context.addInitScript !== 'function') {
    throw new Error('Strict Privacy Mode is unavailable in this browser context');
  }
  await context.addInitScript(strictPrivacyGuardSource, options || {});
}

async function collectStrictPrivacyGuardState(page) {
  return page.evaluate(() => {
    const flag = globalThis.__orbitqaStrictGuardBlocked || null;
    const flagged = (key) => Boolean(flag && flag[key] === true);
    const isMarked = (fn) => Boolean(fn && fn.__orbitqaStrictBlocked === true);

    const rtc = globalThis.RTCPeerConnection || globalThis.webkitRTCPeerConnection;
    const media = globalThis.navigator && navigator.mediaDevices ? navigator.mediaDevices.getUserMedia : undefined;
    const geoObject = globalThis.navigator ? navigator.geolocation : undefined;
    const geo = geoObject ? geoObject.getCurrentPosition : undefined;
    const notificationRequest = typeof globalThis.Notification === 'undefined' ? undefined : Notification.requestPermission;

    // Behavioural probe: the guard answers synchronously, a native prompt does not.
    // This cannot be defeated by object identity, and unlike a marker it proves the
    // replacement is actually reachable from a fresh access.
    let geolocationAnswersSynchronously = false;
    if (typeof geo === 'function') {
      try {
        geo.call(geoObject, () => { geolocationAnswersSynchronously = true; }, () => { geolocationAnswersSynchronously = true; });
      } catch {
        geolocationAnswersSynchronously = false;
      }
    }

    const stateOf = (key, fn, verified) => {
      if (!fn) return 'unsupported';
      if (flagged(key) || isMarked(fn) || verified) return 'denied';
      return 'prompt';
    };

    const notificationState = typeof globalThis.Notification === 'undefined'
      ? 'unsupported'
      : stateOf('notifications', notificationRequest, false);

    return {
      webrtc: !rtc ? 'unsupported' : 'available',
      camera: stateOf('camera', media, false),
      microphone: stateOf('microphone', media, false),
      geolocation: stateOf('geolocation', geo, geolocationAnswersSynchronously),
      notifications: notificationState === 'denied' ? 'denied' : (Notification.permission || 'prompt'),
    };
  });
}

async function assertStrictPrivacyGuard(page, strictMode) {
  if (!strictMode) return;
  const state = await collectStrictPrivacyGuardState(page);
  const failures = [];
  for (const key of ['camera', 'microphone', 'geolocation', 'notifications']) {
    if (!['denied', 'unsupported'].includes(state[key])) failures.push(key);
  }
  if (failures.length > 0) {
    throw new Error(`Strict Privacy Mode could not block: ${failures.join(', ')}`);
  }
}

function extractLiteralIpCandidates(candidates) {
  const seen = new Set();
  for (const candidate of candidates || []) {
    const parts = String(candidate).trim().split(/\s+/);
    const address = parts[4];
    if (address && net.isIP(address)) seen.add(address);
  }
  return [...seen];
}

function makeCheck(key, label, status, required, expected, observed, detail) {
  return { key, label, status, required, expected, observed, detail };
}

function statusForWebRtcPolicy(policy, proxyRequired) {
  if (policy === 'unsupported') return { status: 'not-applicable', required: false };
  if (policy === 'prevented' || policy === 'verified-no-leak') return { status: 'pass', required: Boolean(proxyRequired) };
  if (policy === 'exposed') return { status: proxyRequired ? 'fail' : 'warning', required: Boolean(proxyRequired) };
  return { status: proxyRequired ? 'fail' : 'warning', required: Boolean(proxyRequired) };
}

function webRtcObservedLabel(policy, literalCount) {
  if (policy === 'prevented') return `Restriction applied · ${literalCount} literal candidate(s) · no direct-IP leak detected`;
  if (policy === 'verified-no-leak') return `${literalCount} literal candidate(s) · no direct-IP leak detected`;
  if (policy === 'unsupported') return 'WebRTC unavailable';
  if (policy === 'exposed') return 'Host direct public IP exposed in ICE candidates';
  return 'WebRTC verification could not be completed';
}

function buildPrivacyReport({ expected, observed, proxyChecks, strictMode, permissionPolicy, startedAt, proxyRequired = false }) {
  const checks = [...(proxyChecks || [])];
  checks.push(makeCheck('browser-launch', 'Browser launch health', 'pass', true, 'Browser running', 'Running'));
  checks.push(makeCheck('page-load', 'Page load health', 'pass', true, 'Target loaded', 'Loaded'));

  const webRtcPolicy = observed.webRtcPolicy
    || (observed.webRtcSupported === false
      ? 'unsupported'
      : observed.webRtcBlocked === true
        ? 'prevented'
        : observed.webRtcVerificationError
          ? 'indeterminate'
          : 'verified-no-leak');
  const rtcAssessment = statusForWebRtcPolicy(webRtcPolicy, proxyRequired);
  checks.push(makeCheck(
    'webrtc',
    'WebRTC route privacy',
    rtcAssessment.status,
    rtcAssessment.required,
    proxyRequired ? 'No host direct public IP through WebRTC' : 'Verified WebRTC route state',
    webRtcObservedLabel(webRtcPolicy, observed.literalIpCandidates?.length || 0),
    webRtcPolicy === 'exposed'
      ? 'A required proxy session exposed the known host direct public IP through ICE.'
      : webRtcPolicy === 'indeterminate'
        ? 'OrbitQA does not claim a privacy pass when ICE verification cannot complete.'
        : 'WebRTC remains observable; OrbitQA does not replace RTCPeerConnection or rewrite candidates.',
  ));

  for (const key of ['camera', 'microphone', 'geolocation', 'notifications']) {
    const state = observed.permissionStates[key];
    const unsupported = state === 'unsupported';
    const granted = state === 'granted';
    const isNotification = key === 'notifications';
    const strictStatus = state === 'denied' ? 'pass' : 'fail';
    checks.push(makeCheck(
      key,
      `${key[0].toUpperCase()}${key.slice(1)} permission`,
      unsupported
        ? 'not-applicable'
        : strictMode
          ? strictStatus
          : granted ? (isNotification ? 'warning' : 'fail') : 'pass',
      strictMode ? !unsupported : !unsupported && !isNotification,
      strictMode ? 'denied' : permissionPolicy[key],
      state,
    ));
  }

  const userAgentPass = !expected.userAgentIncludes || observed.userAgent.includes(expected.userAgentIncludes);
  checks.push(makeCheck('user-agent', 'User agent consistency', userAgentPass ? 'pass' : 'warning', false, expected.userAgentIncludes || 'Browser-native', observed.userAgent));

  const platformHostInfo = expected.platformMode === 'host-info';
  const platformPass = !expected.platformIncludes || observed.platform.includes(expected.platformIncludes);
  checks.push(makeCheck(
    'platform',
    platformHostInfo ? 'Navigator platform (host/runtime)' : 'Navigator platform consistency',
    platformHostInfo ? 'not-applicable' : (platformPass ? 'pass' : 'warning'),
    false,
    platformHostInfo ? 'Host/runtime reported as observed' : (expected.platformIncludes || 'Browser-native host/runtime information'),
    observed.platform,
    platformHostInfo ? 'Compatibility emulation runs inside the host browser runtime; navigator.platform is reported for transparency and is not a device-profile failure.' : undefined,
  ));

  if (typeof expected.touch === 'boolean') {
    const touchPass = expected.touch ? observed.maxTouchPoints > 0 : observed.maxTouchPoints === 0;
    checks.push(makeCheck('touch', 'Touch capability consistency', touchPass ? 'pass' : 'warning', false, expected.touch ? 'Touch enabled' : 'No touch requirement', String(observed.maxTouchPoints)));
  }

  const viewportPass = observed.viewport.width === expected.viewport.width && observed.viewport.height === expected.viewport.height;
  checks.push(makeCheck('viewport', 'Viewport consistency', viewportPass ? 'pass' : 'warning', false, `${expected.viewport.width}×${expected.viewport.height}`, `${observed.viewport.width}×${observed.viewport.height}`));
  checks.push(makeCheck('dpr', 'Device pixel ratio consistency', observed.devicePixelRatio === expected.dpr ? 'pass' : 'warning', false, String(expected.dpr), String(observed.devicePixelRatio)));
  const localePass = !expected.locale || observed.locale === expected.locale;
  checks.push(makeCheck('locale', 'Locale consistency', localePass ? 'pass' : 'warning', false, expected.locale || 'Browser-native', observed.locale));
  const timezonePass = !expected.timezoneId || observed.timezoneId === expected.timezoneId;
  checks.push(makeCheck('timezone', 'Timezone consistency', timezonePass ? 'pass' : 'warning', false, expected.timezoneId || 'Browser-native', observed.timezoneId));

  const blocking = checks.filter((check) => check.required && check.status === 'fail');
  const blocked = blocking.length > 0;
  const overall = blocked || checks.some((check) => check.status === 'fail')
    ? 'fail'
    : checks.some((check) => check.status === 'warning') ? 'warning' : 'pass';

  return {
    overall,
    blocked,
    blockingReasons: blocking.map((check) => check.label),
    checks,
    observed,
    webRtcPolicy,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
  };
}

async function queryPermission(page, name) {
  return page.evaluate(async (permissionName) => {
    if (!navigator.permissions?.query) return 'unsupported';
    try {
      const result = await navigator.permissions.query({ name: permissionName });
      return result.state;
    } catch {
      return 'unsupported';
    }
  }, name);
}

async function collectIceCandidates(page) {
  return page.evaluate(async () => {
    if (!window.RTCPeerConnection) return { supported: false, candidates: [] };
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const candidates = [];
    try {
      pc.createDataChannel('orbitqa-privacy-check');
      pc.onicecandidate = (event) => {
        if (event.candidate?.candidate) candidates.push(event.candidate.candidate);
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await Promise.race([
        new Promise((resolve) => {
          if (pc.iceGatheringState === 'complete') return resolve();
          pc.addEventListener('icegatheringstatechange', () => {
            if (pc.iceGatheringState === 'complete') resolve();
          });
        }),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
      return { supported: true, candidates };
    } finally {
      pc.close();
    }
  });
}

function classifyWebRtcPolicy({ supported, literalIpCandidates, verificationError, directIp, proxyRequired, preventionApplied }) {
  if (!supported) return 'unsupported';
  if (verificationError) return 'indeterminate';
  if (proxyRequired && directIp && (literalIpCandidates || []).includes(directIp)) return 'exposed';
  if (preventionApplied) return 'prevented';
  if (proxyRequired && !directIp) return 'indeterminate';
  return 'verified-no-leak';
}

async function collectPrivacyReport({ page, expected, proxyChecks, strictMode, routeObservation, proxyRequired = false, webRtcPreventionApplied = false }) {
  const startedAt = Date.now();
  const configuredViewport = typeof page?.viewportSize === 'function' ? page.viewportSize() : null;
  const runtime = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    locale: navigator.language,
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }));
  if (configuredViewport) {
    runtime.layoutViewport = runtime.viewport;
    runtime.viewport = configuredViewport;
  }

  let camera;
  let microphone;
  let geolocation;
  let notifications;
  let rtc = { supported: false, candidates: [] };
  let webRtcVerificationError = '';

  if (strictMode) {
    const guard = await collectStrictPrivacyGuardState(page);
    camera = guard.camera;
    microphone = guard.microphone;
    geolocation = guard.geolocation;
    notifications = guard.notifications;
    if (guard.webrtc !== 'unsupported') {
      try {
        rtc = await collectIceCandidates(page);
      } catch (error) {
        rtc = { supported: true, candidates: [] };
        webRtcVerificationError = error instanceof Error ? error.message : String(error);
      }
    }
  } else {
    [camera, microphone, geolocation, notifications] = await Promise.all([
      queryPermission(page, 'camera'),
      queryPermission(page, 'microphone'),
      queryPermission(page, 'geolocation'),
      queryPermission(page, 'notifications'),
    ]);
    try {
      rtc = await collectIceCandidates(page);
    } catch (error) {
      rtc = { supported: true, candidates: [] };
      webRtcVerificationError = error instanceof Error ? error.message : String(error);
    }
  }

  const literalIpCandidates = extractLiteralIpCandidates(rtc.candidates);
  const webRtcPolicy = classifyWebRtcPolicy({
    supported: rtc.supported,
    literalIpCandidates,
    verificationError: webRtcVerificationError,
    directIp: routeObservation?.directIp,
    proxyRequired,
    preventionApplied: Boolean(strictMode && webRtcPreventionApplied),
  });

  const observed = {
    ...runtime,
    webRtcSupported: rtc.supported,
    webRtcBlocked: false,
    webRtcVerificationError,
    literalIpCandidates,
    permissionStates: { camera, microphone, geolocation, notifications },
    directIp: routeObservation?.directIp,
    proxiedIp: routeObservation?.proxiedIp,
    webRtcPolicy,
  };
  return buildPrivacyReport({
    expected,
    observed,
    proxyChecks,
    strictMode,
    proxyRequired,
    permissionPolicy: { camera: 'not-granted', microphone: 'not-granted', geolocation: 'not-granted', notifications: 'not-granted' },
    startedAt,
  });
}

module.exports = {
  extractLiteralIpCandidates,
  classifyWebRtcPolicy,
  buildPrivacyReport,
  collectPrivacyReport,
  installStrictPrivacyGuard,
  collectStrictPrivacyGuardState,
  assertStrictPrivacyGuard,
};