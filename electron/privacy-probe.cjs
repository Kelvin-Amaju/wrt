const net = require('node:net');

const GUARD_FLAG = '__orbitqaStrictGuardBlocked';
const BLOCKED_MARKER = '__orbitqaStrictBlocked';
const GUARD_VERSION = 5;
const REASSERT_DELAYS_MS = [0, 16, 50, 120, 300, 700, 1500, 3000, 6000];
const MEDIA_PROBE_TIMEOUT_MS = 700;

// Runs as an init script in the main world before any site code, on every document.
//
// Three layers, most reliable first:
//   1. navigator accessors become caching getters that guard the returned object on
//      first access - works whenever the attribute appears and survives wrapper churn.
//   2. the interface prototypes (MediaDevices, Geolocation, Permissions) are guarded
//      so a plain instance is covered even if the accessor write is rejected.
//   3. a bounded re-assert loop covers capabilities exposed late in the load.
function strictPrivacyGuardSource(options) {
  const config = options && typeof options === 'object' ? options : {};
  const requested = config.geolocation;
  const spoof = requested
    && Number.isFinite(Number(requested.latitude))
    && Number.isFinite(Number(requested.longitude))
      ? {
          latitude: Number(requested.latitude),
          longitude: Number(requested.longitude),
          accuracy: Number.isFinite(Number(requested.accuracy)) ? Number(requested.accuracy) : 20,
        }
      : null;

  const guardedPermissionNames = ['camera', 'microphone', 'geolocation', 'notifications'];

  const deniedError = () => new DOMException('Blocked by OrbitQA Strict Privacy Mode', 'NotAllowedError');
  const deniedPositionError = () => {
    const error = { code: 1, message: 'Blocked by OrbitQA Strict Privacy Mode' };
    try { Object.defineProperty(error, 'PERMISSION_DENIED', { configurable: true, value: 1 }); } catch { error.PERMISSION_DENIED = 1; }
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

  // Verifies by read-back so a silently ignored assignment is not reported as applied.
  const define = (target, key, value) => {
    if (!target) return false;
    try {
      Object.defineProperty(target, key, { configurable: true, writable: true, value });
      if (target[key] === value) return true;
    } catch { /* fall through to assignment */ }
    try {
      target[key] = value;
      return target[key] === value;
    } catch {
      return false;
    }
  };

  const markBlocked = (fn) => {
    try { Object.defineProperty(fn, BLOCKED_MARKER, { configurable: true, value: true }); } catch { /* marker is best effort */ }
    return fn;
  };

  const guardedGetUserMedia = markBlocked(async () => { throw deniedError(); });
  const guardedGetCurrentPosition = markBlocked(spoof
    ? (success) => { if (typeof success === 'function') success(spoofedPosition()); }
    : (_success, error) => { if (typeof error === 'function') error(deniedPositionError()); });
  const guardedWatchPosition = markBlocked(spoof
    ? (success) => { if (typeof success === 'function') success(spoofedPosition()); return 0; }
    : (_success, error) => { if (typeof error === 'function') error(deniedPositionError()); return 0; });
  const guardedRequestPermission = markBlocked(async () => 'denied');

  const applied = { camera: false, microphone: false, geolocation: false, notifications: false };
  let stabilized = false;
  let permissionsQueryGuarded = false;
  let guardedPermissionsQuery = null;

  const publishFlag = () => {
    try {
      let flag = globalThis[GUARD_FLAG];
      if (!flag || typeof flag !== 'object' || Object.isFrozen(flag)) {
        flag = {};
        Object.defineProperty(globalThis, GUARD_FLAG, { configurable: true, value: flag });
      }
      flag.camera = applied.camera;
      flag.microphone = applied.microphone;
      flag.geolocation = applied.geolocation;
      flag.notifications = applied.notifications;
      flag.spoofed = Boolean(spoof);
      flag.version = GUARD_VERSION;
    } catch { /* the per-function marker remains */ }
  };

  // Guards the prototype and the object. The prototype write survives wrapper churn;
  // the own write survives a rejected prototype write.
  const guardOnChain = (object, key, fn) => {
    if (!object) return false;
    let guarded = false;
    try {
      const prototype = Object.getPrototypeOf(object);
      if (prototype && prototype !== object && prototype !== Object.prototype && prototype !== Function.prototype) {
        if (define(prototype, key, fn)) guarded = true;
      }
    } catch { /* own write below still applies */ }
    if (define(object, key, fn)) guarded = true;
    return guarded;
  };

  const guardMediaDevices = (mediaDevices) => {
    if (!mediaDevices) return;
    if (guardOnChain(mediaDevices, 'getUserMedia', guardedGetUserMedia)) {
      applied.camera = true;
      applied.microphone = true;
      publishFlag();
    }
  };

  const guardGeolocation = (geolocation) => {
    if (!geolocation) return;
    const position = guardOnChain(geolocation, 'getCurrentPosition', guardedGetCurrentPosition);
    const watch = guardOnChain(geolocation, 'watchPosition', guardedWatchPosition);
    if (position || watch) {
      applied.geolocation = true;
      publishFlag();
    }
  };

  const guardNotification = () => {
    if (typeof globalThis.Notification === 'undefined') return;
    define(globalThis.Notification, 'requestPermission', guardedRequestPermission);
    try {
      Object.defineProperty(globalThis.Notification, 'permission', { configurable: true, get: () => 'denied' });
    } catch { /* requestPermission remains blocked */ }
    applied.notifications = true;
  };

  const guardPermissions = (permissions) => {
    if (permissionsQueryGuarded || !permissions || typeof permissions.query !== 'function') return;
    const nativeQuery = permissions.query.bind(permissions);
    guardedPermissionsQuery = (descriptor) => {
      const name = descriptor && descriptor.name;
      if (guardedPermissionNames.indexOf(name) === -1) return nativeQuery(descriptor);
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
    };
    const prototype = globalThis.Permissions && globalThis.Permissions.prototype;
    if (prototype) define(prototype, 'query', guardedPermissionsQuery);
    if (define(permissions, 'query', guardedPermissionsQuery)) permissionsQueryGuarded = true;
  };

  // Replaces a navigator accessor with a caching getter that guards on first access.
  const stabilizeAccessor = (navigatorPrototype, key, onValue) => {
    let descriptor = null;
    try { descriptor = Object.getOwnPropertyDescriptor(navigatorPrototype, key); } catch { descriptor = null; }
    if (!descriptor) return false;
    const nativeGetter = descriptor.get;
    let cached = null;
    const getter = function () {
      if (cached) return cached;
      let value = null;
      try {
        value = nativeGetter ? nativeGetter.call(this) : (descriptor.value || null);
      } catch {
        value = null;
      }
      if (!value) return value;
      cached = value;
      try { onValue(value); } catch { /* keep the value even if guarding failed */ }
      return value;
    };
    try {
      Object.defineProperty(navigatorPrototype, key, { get: getter, configurable: true, enumerable: descriptor.enumerable });
      return true;
    } catch {
      try {
        Object.defineProperty(globalThis.navigator, key, { get: getter, configurable: true });
        return true;
      } catch {
        return false;
      }
    }
  };

  const apply = () => {
    const navigatorObject = globalThis.navigator;
    let navigatorPrototype = null;
    try { navigatorPrototype = navigatorObject ? Object.getPrototypeOf(navigatorObject) : null; } catch { navigatorPrototype = null; }

    if (!stabilized && navigatorPrototype && navigatorPrototype !== Object.prototype) {
      stabilized = true;
      stabilizeAccessor(navigatorPrototype, 'mediaDevices', guardMediaDevices);
      stabilizeAccessor(navigatorPrototype, 'geolocation', guardGeolocation);
    }

    const mediaPrototype = globalThis.MediaDevices && globalThis.MediaDevices.prototype;
    if (mediaPrototype && define(mediaPrototype, 'getUserMedia', guardedGetUserMedia)) {
      applied.camera = true;
      applied.microphone = true;
    }
    const geolocationPrototype = globalThis.Geolocation && globalThis.Geolocation.prototype;
    if (geolocationPrototype) {
      if (define(geolocationPrototype, 'getCurrentPosition', guardedGetCurrentPosition)) applied.geolocation = true;
      if (define(geolocationPrototype, 'watchPosition', guardedWatchPosition)) applied.geolocation = true;
    }

    if (navigatorObject) {
      guardMediaDevices(navigatorObject.mediaDevices);
      guardGeolocation(navigatorObject.geolocation);
      guardPermissions(navigatorObject.permissions);
    }

    guardNotification();
    publishFlag();
  };

  apply();

  const reassert = () => { try { apply(); } catch { /* keep the previous guard */ } };
  if (typeof setTimeout === 'function') {
    for (const delay of REASSERT_DELAYS_MS) {
      try { setTimeout(reassert, delay); } catch { /* no timer support */ }
    }
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    for (const eventName of ['readystatechange', 'DOMContentLoaded', 'load']) {
      try { document.addEventListener(eventName, reassert, true); } catch { /* no document support */ }
    }
  }
  if (typeof globalThis.addEventListener === 'function') {
    try { globalThis.addEventListener('load', reassert, true); } catch { /* no window support */ }
  }
}

async function installStrictPrivacyGuard(context, strictMode, options) {
  if (!strictMode) return;
  if (!context || typeof context.addInitScript !== 'function') {
    throw new Error('Strict Privacy Mode is unavailable in this browser context');
  }
  await context.addInitScript(strictPrivacyGuardSource, options || {});
}

async function collectStrictPrivacyGuardState(page) {
  return page.evaluate(async () => {
    const flag = globalThis.__orbitqaStrictGuardBlocked || null;
    const flagged = (key) => Boolean(flag && flag[key] === true);
    const isMarked = (fn) => Boolean(fn && fn.__orbitqaStrictBlocked === true);
    const anyMarked = (...candidates) => candidates.some((candidate) => isMarked(candidate));

    const navigatorObject = globalThis.navigator;
    const rtc = globalThis.RTCPeerConnection || globalThis.webkitRTCPeerConnection;

    // Read the instance AND the interface prototype. The instance wrapper is not
    // guaranteed to be the object the guard wrote to, so the prototype is the
    // authoritative reference.
    const mediaObject = navigatorObject && navigatorObject.mediaDevices ? navigatorObject.mediaDevices : null;
    const mediaInstance = mediaObject ? mediaObject.getUserMedia : undefined;
    const mediaPrototype = globalThis.MediaDevices && globalThis.MediaDevices.prototype
      ? globalThis.MediaDevices.prototype.getUserMedia
      : undefined;
    const mediaPresent = Boolean(mediaInstance || mediaPrototype);

    const geoObject = navigatorObject ? navigatorObject.geolocation : undefined;
    const geoInstance = geoObject ? geoObject.getCurrentPosition : undefined;
    const geoPrototype = globalThis.Geolocation && globalThis.Geolocation.prototype
      ? globalThis.Geolocation.prototype.getCurrentPosition
      : undefined;
    const geoPresent = Boolean(geoInstance || geoPrototype);

    const notificationRequest = typeof globalThis.Notification === 'undefined'
      ? undefined
      : globalThis.Notification.requestPermission;

    // Behavioural probe for media capture: the guard rejects with NotAllowedError.
    // A native prompt stays pending and is therefore not counted as blocked.
    const mediaBehaviourallyDenied = await new Promise((resolve) => {
      if (!mediaObject || typeof mediaObject.getUserMedia !== 'function') return resolve(false);
      let settled = false;
      let timer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer);
        resolve(value);
      };
      if (typeof setTimeout === 'function') timer = setTimeout(() => finish(false), 700);
      const isDenied = (error) => Boolean(error && (error.name === 'NotAllowedError' || error.code === 1));
      try {
        const pending = mediaObject.getUserMedia({ video: true, audio: true });
        if (pending && typeof pending.then === 'function') {
          pending.then(() => finish(false), (error) => finish(isDenied(error)));
        } else {
          finish(false);
        }
      } catch (error) {
        finish(isDenied(error));
      }
    });

    // Same idea for geolocation: the guard answers synchronously, a native prompt does not.
    let geolocationBehaviourallyDenied = false;
    if (typeof geoInstance === 'function') {
      try {
        geoInstance.call(geoObject, () => {}, (error) => {
          geolocationBehaviourallyDenied = Boolean(error && error.code === 1);
        });
      } catch {
        geolocationBehaviourallyDenied = false;
      }
    }

    const stateOf = (present, marked, verified) => {
      if (!present) return 'unsupported';
      if (marked || verified) return 'denied';
      return 'prompt';
    };

    const notificationsPresent = typeof globalThis.Notification !== 'undefined';
    const notificationsDenied = notificationsPresent
      && (flagged('notifications') || anyMarked(notificationRequest));

    return {
      webrtc: !rtc ? 'unsupported' : 'available',
      camera: stateOf(mediaPresent, flagged('camera') || anyMarked(mediaInstance, mediaPrototype), mediaBehaviourallyDenied),
      microphone: stateOf(mediaPresent, flagged('microphone') || anyMarked(mediaInstance, mediaPrototype), mediaBehaviourallyDenied),
      geolocation: stateOf(geoPresent, flagged('geolocation') || anyMarked(geoInstance, geoPrototype), geolocationBehaviourallyDenied),
      notifications: !notificationsPresent
        ? 'unsupported'
        : notificationsDenied ? 'denied' : (globalThis.Notification.permission || 'prompt'),
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
    const version = await page.evaluate(() => globalThis.__orbitqaStrictGuardBlocked?.version ?? null).catch(() => null);
    throw new Error(
      `Strict Privacy Mode could not block: ${failures.join(', ')} ` +
      `(guard v${version ?? 'MISSING'}, state ${JSON.stringify(state)})`,
    );
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