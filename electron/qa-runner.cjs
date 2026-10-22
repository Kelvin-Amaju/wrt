const fs = require("node:fs/promises");
const path = require("node:path");
const {
  collectPrivacyReport,
  installStrictPrivacyGuard,
  assertStrictPrivacyGuard,
} = require("./privacy-probe.cjs");
const {
  buildDeviceExpectation,
  collectRuntimeIdentity,
  assessDeviceConsistency,
  compareGraphicsStability,
  verifyFunctionalTap,
} = require("./device-consistency.cjs");
const { createQaPacing } = require("./qa-pacing.cjs");
const {
  assessProxyRoute,
  parseObservedIp,
  redactSecrets,
  verifyProxyRoute,
} = require("./proxy-diagnostics.cjs");
const { buildSessionIntegrityReport } = require("./session-integrity.cjs");
const {
  buildPrivacyRouteIntegrityReport,
  shouldBlockPrivacyRouteIntegrity,
} = require("./privacy-route-integrity.cjs");
const {
  smoothScrollBy,
  runSmartInteraction,
  progressiveType,
} = require("./smart-interaction.cjs");
const { createSessionLifetimeController } = require("./session-lifetime.cjs");
const {
  createBlockingSurfaceResolver,
} = require("./blocking-surface-resolver.cjs");
const {
  countWorkUnits,
  iterateWorkUnits,
  countWorkUnitsV3,
  iterateWorkUnitsV3,
  runWorkUnitQueue,
} = require("./work-unit-scheduler.cjs");
const { parseUrlPoolText } = require("./url-pool.cjs");
const {
  installInteractionIndicator,
  moveInteractionIndicator,
  moveInteractionIndicatorToPoint,
  pulseInteractionIndicator,
  indicatorModeForExecutionKind,
} = require("./interaction-indicator.cjs");
const { runAutoQa } = require("./auto-qa/auto-qa-engine.cjs");
const {
  resolveSimulatedReferrer,
} = require("./auto-qa/referrer-simulation.cjs");
const { navigateWithReferrerQa } = require("./auto-qa/referrer-navigation.cjs");
const {
  resolveInstalledChrome,
  resolveInstalledBrave,
} = require("./chrome-runtime-resolver.cjs");
const { verifyBrowserRuntime } = require("./browser-runtime-verifier.cjs");
const {
  sanitizeProxyEndpoint,
  isPublicObservedIp,
} = require("./proxy-ip-history-store.cjs");
const { profileForCountry } = require("./social/geo-profile.cjs");
const {
  buildConsistentWorkerContext,
  validateWorkerContext,
} = require("./worker-context-policy.cjs");
const {
  backgroundWindowArgs,
  concealBackgroundWorkerWindow,
} = require("./background-window.cjs");
const {
  synchronizeProxyTimezone,
} = require("./proxy-timezone-consistency.cjs");
const {
  waitBeforePageInteraction,
} = require("./mandatory-interaction-delay.cjs");
const deviceHardening = require("./device-hardening.cjs");

const SUPPORTED_BROWSERS = new Set([
  "chrome-installed",
  "brave-installed",
  "chromium",
  "firefox",
  "webkit",
]);
const SUPPORTED_DEVICE_MODES = new Set([
  "desktop",
  "android",
  "ios-emulation",
  "real-ios",
]);
const SUPPORTED_IOS_DEVICES = new Set([
  "iPhone 18 Pro",
  "iPhone 18 Pro Max",
  "iPhone Duo (Closed)",
  "iPhone Duo (Open)",
  "iPad Pro 11",
  "iPad Mini",
  "iPhone 13",
  "iPhone 13 Pro",
  "iPhone 13 Pro Max",
  "iPhone 13 Mini",
]);
const SUPPORTED_IOS_BROWSERS = new Set([
  "chrome-installed",
  "brave-installed",
  "safari-ios",
  "chrome-ios",
]);
const SUPPORTED_REAL_IOS_BROWSERS = new Set(["safari-ios", "chrome-ios"]);
const SUPPORTED_BROWSER_RUNTIMES = new Set([
  "chrome-installed",
  "brave-installed",
  "chromium-playwright",
  "firefox-playwright",
  "webkit-playwright",
  "android-chrome",
  "real-ios-provider",
]);
const SUPPORTED_IOS_ORIENTATIONS = new Set(["portrait", "landscape"]);
const SUPPORTED_STEPS = new Set([
  "wait",
  "scroll",
  "click",
  "type",
  "screenshot",
  "smart-interaction",
]);
const SUPPORTED_PROXY_SOURCES = new Set([
  "none",
  "manual",
  "rotating",
  "static",
  "smart-mix",
]);
const DEFAULT_ROUTE_CHECK_URL = "https://api64.ipify.org?format=json";
const PROXY_ROUTE_CHECK_FALLBACK_URLS = [
  "https://api64.ipify.org?format=json",
  "https://api.ipify.org?format=json",
  "https://checkip.amazonaws.com/",
  "https://icanhazip.com/",
];

const WEBRTC_CHROMIUM_HEADLESS_POLICY_ARG =
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp";
const WEBRTC_CHROMIUM_HEADED_POLICY_ARG =
  "--webrtc-ip-handling-policy=disable_non_proxied_udp";
const RUNTIME_PERFORMANCE_CHROMIUM_ARGS = [
  "--disable-background-timer-throttling",
  "--disable-renderer-backgrounding",
  "--disable-backgrounding-occluded-windows",
  "--disable-features=CalculateNativeWinOcclusion",
  "--disable-ipc-flooding-protection",
  "--hide-crash-restore-bubble",
  "--disable-session-crashed-bubble",
];

const PROXY_CHROMIUM_CONTAINMENT_ARGS = [
  "--disable-quic",
  "--disable-background-networking",
  "--disable-domain-reliability",
  "--disable-sync",
  "--no-pings",
  "--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication,Translate,NetworkTimeServiceQuerying",
];

function buildRuntimePerformanceLaunchPolicy({ browserEngine }) {
  if (browserEngine !== "chromium") return { applied: false, args: [] };
  return { applied: true, args: [...RUNTIME_PERFORMANCE_CHROMIUM_ARGS] };
}

function buildWebRtcLaunchPolicy({
  strictMode,
  browserEngine,
  headless = false,
}) {
  if (strictMode && browserEngine === "chromium") {
    return {
      preventionApplied: true,
      args: [
        headless
          ? WEBRTC_CHROMIUM_HEADLESS_POLICY_ARG
          : WEBRTC_CHROMIUM_HEADED_POLICY_ARG,
      ],
    };
  }
  return { preventionApplied: false, args: [] };
}

function proxyHostFromServer(server) {
  try {
    const value = String(server || "").trim();
    if (!value) return "";
    const parsed = new URL(value.includes("://") ? value : `http://${value}`);
    return String(parsed.hostname || "").replace(/^\[|\]$/g, "");
  } catch {
    return "";
  }
}

function buildProxyContainmentLaunchPolicy({
  proxyRequired,
  browserEngine,
  proxyServer = "",
}) {
  if (!proxyRequired || browserEngine !== "chromium")
    return { applied: false, args: [] };
  // Do not install a blanket host-resolver rule here. Chromium's proxy stack must be able to
  // pass arbitrary destination hostnames to the configured HTTP/HTTPS/SOCKS proxy. The old
  // MAP * ~NOTFOUND rule could strand newly opened tabs on previously unseen domains even
  // while an already-established target connection kept working. Fail-closed routing is
  // enforced by the mandatory proxy configuration and route-integrity checks instead.
  return { applied: true, args: [...PROXY_CHROMIUM_CONTAINMENT_ARGS] };
}

function mergeLaunchArgs(...groups) {
  const flat = [...new Set(groups.flat().filter(Boolean).map(String))];
  const disabledFeatures = [];
  const other = [];
  for (const arg of flat) {
    if (arg.startsWith("--disable-features=")) {
      for (const feature of arg
        .slice("--disable-features=".length)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean))
        if (!disabledFeatures.includes(feature)) disabledFeatures.push(feature);
    } else other.push(arg);
  }
  if (disabledFeatures.length)
    other.push(`--disable-features=${disabledFeatures.join(",")}`);
  return other;
}

function browserRuntimeForWorkUnit(browser, executionKind, explicitRuntime) {
  const explicit = String(explicitRuntime || "");
  if (SUPPORTED_BROWSER_RUNTIMES.has(explicit)) return explicit;
  if (executionKind === "android-emulation") return "chromium-playwright";
  if (executionKind === "android-avd") return "android-chrome";
  if (executionKind === "real-ios") return "real-ios-provider";
  if (executionKind === "ios-emulation")
    return browser === "chrome-installed"
      ? "chrome-installed"
      : browser === "brave-installed"
        ? "brave-installed"
        : "webkit-playwright";
  if (browser === "chrome-installed") return "chrome-installed";
  if (browser === "brave-installed") return "brave-installed";
  if (browser === "firefox") return "firefox-playwright";
  if (browser === "webkit") return "webkit-playwright";
  return "chromium-playwright";
}

function resolveBrowserRuntimeLaunch({
  settings,
  playwright,
  chromeRuntimeResolver = resolveInstalledChrome,
  braveRuntimeResolver = resolveInstalledBrave,
}) {
  const runtimeKind = browserRuntimeForWorkUnit(
    settings?.browser,
    settings?.deviceMode,
    settings?.browserRuntime,
  );
  if (runtimeKind === "chrome-installed" || runtimeKind === "brave-installed") {
    const resolved =
      runtimeKind === "brave-installed"
        ? braveRuntimeResolver()
        : chromeRuntimeResolver();
    if (!resolved?.found || !resolved.executablePath) {
      throw new Error(
        runtimeKind === "brave-installed"
          ? "Brave was not found on this PC. Install Brave or choose another browser."
          : "Google Chrome was not found on this PC. Choose Chromium compatibility or install Google Chrome.",
      );
    }
    return {
      launcher: playwright?.chromium,
      browserEngine: "chromium",
      runtimeKind,
      executablePath: resolved.executablePath,
    };
  }
  if (runtimeKind === "chromium-playwright")
    return {
      launcher: playwright?.chromium,
      browserEngine: "chromium",
      runtimeKind,
    };
  if (runtimeKind === "firefox-playwright")
    return {
      launcher: playwright?.firefox,
      browserEngine: "firefox",
      runtimeKind,
    };
  if (runtimeKind === "webkit-playwright")
    return {
      launcher: playwright?.webkit,
      browserEngine: "webkit",
      runtimeKind,
    };
  throw new Error(
    `Browser runtime is not a local Playwright launch: ${runtimeKind}`,
  );
}

function createRunAbortError() {
  const error = new Error("QA run stopped by user");
  error.name = "AbortError";
  return error;
}

function throwIfRunAborted(signal) {
  if (signal?.aborted) throw createRunAbortError();
}

function startupParallelismForConcurrency(concurrency) {
  const requested = Math.max(1, Number(concurrency?.value) || 1);
  if (concurrency?.mode === "auto")
    return Math.max(1, Math.min(4, Math.ceil(requested / 4)));
  return Math.max(1, Math.min(8, Math.ceil(requested / 4)));
}

function createLaunchGate(limit) {
  const capacity = Math.max(1, Number(limit) || 1);
  let active = 0;
  const waiters = [];

  const release = () => {
    active = Math.max(0, active - 1);
    while (waiters.length > 0 && active < capacity) {
      const waiter = waiters.shift();
      if (waiter.signal?.aborted) {
        waiter.reject(createRunAbortError());
        continue;
      }
      active += 1;
      waiter.resolve();
    }
  };

  const acquire = (signal) => {
    throwIfRunAborted(signal);
    if (active < capacity) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, abortListener: null };
      if (signal) {
        waiter.abortListener = () => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(createRunAbortError());
        };
        signal.addEventListener("abort", waiter.abortListener, { once: true });
      }
      const wrappedResolve = waiter.resolve;
      waiter.resolve = () => {
        if (waiter.abortListener)
          signal?.removeEventListener("abort", waiter.abortListener);
        wrappedResolve();
      };
      waiters.push(waiter);
    });
  };

  return {
    async run(task, signal = null) {
      await acquire(signal);
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

async function launchBrowserWithAbort(launcher, launchOptions, signal) {
  throwIfRunAborted(signal);
  if (!signal) return launcher.launch(launchOptions);

  let abortListener;
  const launchPromise = Promise.resolve().then(() =>
    launcher.launch(launchOptions),
  );
  const abortPromise = new Promise((_, reject) => {
    abortListener = () => reject(createRunAbortError());
    signal.addEventListener("abort", abortListener, { once: true });
  });

  try {
    const launchedBrowser = await Promise.race([launchPromise, abortPromise]);
    if (signal.aborted) {
      await launchedBrowser?.close?.().catch(() => undefined);
      throw createRunAbortError();
    }
    return launchedBrowser;
  } catch (error) {
    if (signal.aborted) {
      void launchPromise
        .then((lateBrowser) => lateBrowser?.close?.())
        .catch(() => undefined);
    }
    throw error;
  } finally {
    if (abortListener) signal.removeEventListener("abort", abortListener);
  }
}

function normalizePrivacySettings(input, deviceMode) {
  const raw = input && typeof input === "object" ? input : {};
  const rawProxy = raw.proxy && typeof raw.proxy === "object" ? raw.proxy : {};
  const privacy = {
    strictMode: raw.strictMode !== false,
    proxy: {
      enabled: rawProxy.enabled === true,
      server: String(rawProxy.server || "").trim(),
      username: String(rawProxy.username || ""),
      password: String(rawProxy.password || ""),
      requireVerifiedRoute: rawProxy.requireVerifiedRoute === true,
      routeCheckUrl:
        String(rawProxy.routeCheckUrl || DEFAULT_ROUTE_CHECK_URL).trim() ||
        DEFAULT_ROUTE_CHECK_URL,
    },
  };
  if (privacy.proxy.enabled && deviceMode === "android") {
    throw new Error(
      "Custom proxy privacy gating is not available for Android AVD runs in v0.5",
    );
  }
  if (privacy.proxy.enabled) {
    let proxyUrl;
    try {
      proxyUrl = new URL(privacy.proxy.server);
    } catch {
      throw new Error("Proxy server must use http://, https://, or socks5://");
    }
    if (!["http:", "https:", "socks5:"].includes(proxyUrl.protocol))
      throw new Error("Proxy server must use http://, https://, or socks5://");
  }
  let routeUrl;
  try {
    routeUrl = new URL(privacy.proxy.routeCheckUrl);
  } catch {
    throw new Error("Enter a valid proxy route-check URL");
  }
  if (routeUrl.protocol !== "https:")
    throw new Error("Proxy route-check URL must use https://");
  return privacy;
}

function normalizeRunnerTargets(input) {
  const rawTargets =
    Array.isArray(input?.targetUrls) && input.targetUrls.length > 0
      ? input.targetUrls
      : input?.targetUrl
        ? [input.targetUrl]
        : [];
  const seen = new Set();
  const targetUrls = [];

  rawTargets.forEach((raw, index) => {
    const trimmed = String(raw || "").trim();
    if (!trimmed) return;
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error(`Invalid target URL on line ${index + 1}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol))
      throw new Error(`Invalid target URL on line ${index + 1}`);
    const key = parsed.toString();
    if (seen.has(key)) return;
    seen.add(key);
    targetUrls.push(candidate);
    if (targetUrls.length > 20)
      throw new Error("A run can contain up to 20 target URLs");
  });

  if (targetUrls.length === 0)
    throw new Error("Enter at least one valid target URL");
  return targetUrls;
}

function buildWorkUnits(targetUrls, sessions) {
  const units = [];
  let sessionId = 0;
  for (let repetition = 1; repetition <= sessions; repetition += 1) {
    targetUrls.forEach((targetUrl, targetIndex) => {
      sessionId += 1;
      units.push({
        workId: `target-${targetIndex + 1}-run-${repetition}`,
        targetIndex,
        targetUrl,
        repetition,
        sessionId,
      });
    });
  }
  return units;
}

const MATRIX_EXECUTION_KINDS = new Set([
  "desktop",
  "android-emulation",
  "android-avd",
  "ios-emulation",
  "real-ios",
]);
const MATRIX_ANDROID_PROFILES = new Set([
  "Pixel 11",
  "Pixel 11 Pro",
  "Pixel 11 Pro XL",
  "Galaxy S26",
  "Galaxy S26+",
  "Galaxy S26 Ultra",
  "Galaxy S26 FE",
  "Galaxy Z Flip8",
  "Galaxy Z Fold8 (Open)",
  "Pixel 7",
  "Pixel 5",
  "Galaxy S23",
]);

function normalizeMatrixTargetUrl(raw, targetIndex) {
  const trimmed = String(raw || "").trim();
  if (!trimmed)
    throw new Error(`Target ${targetIndex + 1}: invalid target URL`);
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed}`;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`Target ${targetIndex + 1}: invalid target URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new Error("Target URL must start with http:// or https://");
  return candidate;
}

function normalizeMatrixGroup(raw, targetIndex, groupIndex) {
  const prefix = `Target ${targetIndex + 1}, group ${groupIndex + 1}`;
  const executionKind = String(raw?.executionKind || "desktop");
  if (!MATRIX_EXECUTION_KINDS.has(executionKind))
    throw new Error(`${prefix}: choose a supported device type`);
  const browser = String(raw?.browser || "");
  const instances = Number(raw?.instances);
  const sessionDurationSeconds = Number(raw?.sessionDurationSeconds);
  const proxySource = String(raw?.proxySource || "none");
  if (!Number.isInteger(instances) || instances < 1)
    throw new Error(`${prefix}: instances must be a positive integer`);
  if (
    !Number.isFinite(sessionDurationSeconds) ||
    sessionDurationSeconds < 5 ||
    sessionDurationSeconds > 600
  )
    throw new Error(
      `${prefix}: session duration must be between 5 and 600 seconds`,
    );
  if (!SUPPORTED_PROXY_SOURCES.has(proxySource))
    throw new Error(`${prefix}: choose a supported proxy source`);
  if (executionKind === "desktop" && !SUPPORTED_BROWSERS.has(browser))
    throw new Error(
      `${prefix}: choose Google Chrome, Chromium, Firefox, or WebKit for Desktop`,
    );
  if (executionKind === "android-emulation") {
    if (browser !== "chrome-android")
      throw new Error(
        `${prefix}: Android mobile emulation uses Chrome Android`,
      );
    if (!MATRIX_ANDROID_PROFILES.has(String(raw?.deviceProfile || "")))
      throw new Error(`${prefix}: choose a supported Android mobile profile`);
  }
  if (executionKind === "android-avd") {
    if (browser !== "chrome-android")
      throw new Error(`${prefix}: Android AVD uses Chrome Android`);
    if (!String(raw?.androidAvdName || "").trim())
      throw new Error(`${prefix}: choose an Android AVD`);
    if (proxySource !== "none")
      throw new Error(
        `${prefix}: proxy routing is not available for Android AVD`,
      );
  }
  if (executionKind === "ios-emulation") {
    if (!SUPPORTED_IOS_BROWSERS.has(browser))
      throw new Error(
        `${prefix}: choose Safari iOS or Chrome iOS compatibility`,
      );
    if (!SUPPORTED_IOS_DEVICES.has(String(raw?.deviceProfile || "")))
      throw new Error(`${prefix}: choose an iPhone/iPad profile`);
  }
  if (executionKind === "real-ios") {
    if (proxySource !== "none")
      throw new Error(`${prefix}: proxy routing is not available for Real iOS`);
    if (!SUPPORTED_REAL_IOS_BROWSERS.has(browser))
      throw new Error(
        `${prefix}: choose Safari iOS or Chrome iOS for Real iOS`,
      );
    const selection =
      raw?.realIos && typeof raw.realIos === "object" ? raw.realIos : {};
    if (!String(selection.device || "").trim())
      throw new Error(`${prefix}: choose a real iOS device model`);
    if (!String(selection.iosVersion || "").trim())
      throw new Error(`${prefix}: choose a real iOS version`);
    if (!["safari", "chrome"].includes(String(selection.browser || "")))
      throw new Error(`${prefix}: choose Safari or Chrome iOS`);
    const expectedProviderBrowser =
      browser === "chrome-ios" ? "chrome" : "safari";
    if (String(selection.browser || "") !== expectedProviderBrowser)
      throw new Error(
        `${prefix}: browser selection does not match the Real iOS provider browser`,
      );
  }
  return {
    id:
      String(raw?.id || `group-${groupIndex + 1}`).trim() ||
      `group-${groupIndex + 1}`,
    label: raw?.label ? String(raw.label) : undefined,
    executionKind,
    browser,
    browserRuntime: browserRuntimeForWorkUnit(
      browser,
      executionKind,
      raw?.browserRuntime,
    ),
    deviceProfile: raw?.deviceProfile ? String(raw.deviceProfile) : undefined,
    androidAvdName: raw?.androidAvdName
      ? String(raw.androidAvdName)
      : undefined,
    realIos: raw?.realIos,
    orientation:
      raw?.orientation === "landscape"
        ? "landscape"
        : raw?.orientation === "portrait"
          ? "portrait"
          : undefined,
    locale: raw?.locale ? String(raw.locale).trim() : undefined,
    timezoneId: raw?.timezoneId ? String(raw.timezoneId).trim() : undefined,
    instances,
    sessionDurationSeconds,
    proxySource,
    allowSlowProxies: ["rotating", "static", "smart-mix"].includes(proxySource),
  };
}

function normalizeAutoQaSettings(input, rawSteps = []) {
  const raw = input && typeof input === "object" ? input : null;
  const explicitMode =
    raw?.behaviorMode === "manual"
      ? "manual"
      : raw?.behaviorMode === "auto"
        ? "auto"
        : null;
  const behaviorMode =
    explicitMode ||
    (Array.isArray(rawSteps) && rawSteps.length > 0 ? "manual" : "auto");
  const readingPace = ["natural", "slow", "fast"].includes(raw?.readingPace)
    ? raw.readingPace
    : "natural";
  const referrerMode = [
    "direct",
    "google-simulated",
    "facebook-simulated",
    "pinterest-simulated",
    "custom-simulated",
    "site-referral",
  ].includes(raw?.referrerMode)
    ? raw.referrerMode
    : "direct";
  let customReferrer;
  if (referrerMode === "custom-simulated") {
    const value = String(raw?.customReferrer || "").trim();
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("Custom simulated referrer must be a valid https:// URL");
    }
    if (parsed.protocol !== "https:")
      throw new Error("Custom simulated referrer must use https://");
    customReferrer = parsed.toString();
  }
  const siteReferralTarget =
    referrerMode === "site-referral"
      ? String(raw?.siteReferralTarget || "")
          .trim()
          .slice(0, 2048) || undefined
      : undefined;
  return {
    behaviorMode,
    readingPace,
    safeFormActions: raw?.safeFormActions !== false,
    observeNewTabs: raw?.observeNewTabs !== false,
    directAutoType:
      referrerMode === "direct" ? raw?.directAutoType === true : false,
    referrerMode,
    customReferrer,
    ...(siteReferralTarget ? { siteReferralTarget } : {}),
  };
}

function resolveRunHeadless(executionMode, legacyHeadless = false) {
  // v0.21.62: Background Activity is a real headed renderer, not headless.
  // This preserves media playback, DOM/timer responsiveness, and the same behavior
  // when a user minimizes or covers the browser window.
  if (executionMode === "background") return false;
  if (executionMode === "visible") return false;
  return legacyHeadless === true;
}

function normalizeMatrixConcurrency(value) {
  if (value && typeof value === "object") {
    if (value.mode === "auto") return { mode: "auto" };
    if (value.mode === "manual") {
      const number = Number(value.value);
      if (!Number.isInteger(number) || number < 1)
        throw new Error("Manual concurrency must be a positive integer");
      return { mode: "manual", value: number };
    }
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1)
    throw new Error("Manual concurrency must be a positive integer");
  return { mode: "manual", value: number };
}

function normalizeMatrixRequest(input) {
  const rawTargets = Array.isArray(input.targets) ? input.targets : [];
  if (rawTargets.length === 0)
    throw new Error("Add at least one target website");
  if (rawTargets.length > 20)
    throw new Error("A run can contain up to 20 target plans");
  let total = 0;
  const targets = rawTargets.map((rawTarget, targetIndex) => {
    const groupsRaw = Array.isArray(rawTarget?.groups) ? rawTarget.groups : [];
    if (groupsRaw.length === 0)
      throw new Error(
        `Target ${targetIndex + 1}: add at least one device group`,
      );
    if (groupsRaw.length > 12)
      throw new Error(
        `Target ${targetIndex + 1}: up to 12 device groups are supported`,
      );
    const groups = groupsRaw.map((group, groupIndex) => {
      const normalized = normalizeMatrixGroup(group, targetIndex, groupIndex);
      total += normalized.instances;
      return normalized;
    });
    return {
      id:
        String(rawTarget?.id || `target-${targetIndex + 1}`).trim() ||
        `target-${targetIndex + 1}`,
      targetUrl: normalizeMatrixTargetUrl(rawTarget?.targetUrl, targetIndex),
      groups,
    };
  });
  const concurrency = normalizeMatrixConcurrency(input.concurrency);
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  if (rawSteps.length > 50) throw new Error("A run can contain up to 50 steps");
  const autoQa = normalizeAutoQaSettings(input.autoQa, rawSteps);
  const privacy = normalizePrivacySettings(input.privacy, "desktop");
  for (const target of targets) {
    for (const group of target.groups) {
      if (group.proxySource === "manual" && !privacy.proxy.enabled)
        throw new Error("Manual proxy source requires proxy settings");
      if (
        autoQa.behaviorMode === "manual" &&
        group.executionKind === "real-ios" &&
        rawSteps.some((step) => step?.type === "smart-interaction")
      ) {
        throw new Error(
          "Smart QA Interaction is not available for Real iOS Device runs yet",
        );
      }
    }
  }
  const steps = rawSteps.map((step, index) => normalizeStep(step, index));
  const executionMode =
    input.executionMode === "background" ? "background" : "visible";
  const headless = resolveRunHeadless(
    input.executionMode,
    input.headless === true,
  );
  return {
    version: 2,
    targets,
    concurrency,
    headless,
    executionMode,
    captureScreenshots: input.captureScreenshots !== false,
    interactionIndicator: headless
      ? false
      : input.interactionIndicator !== false,
    privacy,
    autoQa,
    steps,
  };
}

function normalizeV3ProxyPolicy(raw, label) {
  const source = String(raw?.source || "none");
  if (!SUPPORTED_PROXY_SOURCES.has(source))
    throw new Error(`${label}: choose a supported proxy source`);
  return {
    source,
    allowSlowProxies: ["rotating", "static", "smart-mix"].includes(source),
  };
}

function normalizeV3PositiveInt(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1)
    throw new Error(`${label} must be a positive integer`);
  return number;
}

function normalizeV3Duration(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 5 || number > 600)
    throw new Error(`${label} must be between 5 and 600 seconds`);
  return number;
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(values.map((value) => String(value || "").trim()).filter(Boolean)),
  );
}

function normalizeMatrixV3Request(input) {
  const rawUrlText =
    typeof input.urlPoolText === "string"
      ? input.urlPoolText
      : Array.isArray(input.urlPool)
        ? input.urlPool.join("\n")
        : "";
  const parsedPool = parseUrlPoolText(rawUrlText);
  if (parsedPool.valid.length === 0)
    throw new Error("Add at least one valid Target URL");
  const rawDevices =
    input.devices && typeof input.devices === "object" ? input.devices : {};
  const desktopRaw = rawDevices.desktop || {};
  const androidRaw = rawDevices.androidEmulation || {};
  const iosRaw = rawDevices.iosEmulation || {};
  const avdRaw = rawDevices.androidAvd || {};
  const realRaw = rawDevices.realIos || {};
  const desktopBrowsers = uniqueStrings(desktopRaw.browsers).filter((browser) =>
    SUPPORTED_BROWSERS.has(browser),
  );
  const androidProfiles = uniqueStrings(androidRaw.profiles).filter((profile) =>
    MATRIX_ANDROID_PROFILES.has(profile),
  );
  const iosBrowsers = uniqueStrings(iosRaw.browsers).filter((browser) =>
    SUPPORTED_IOS_BROWSERS.has(browser),
  );
  const iosProfiles = uniqueStrings(iosRaw.profiles).filter((profile) =>
    SUPPORTED_IOS_DEVICES.has(profile),
  );
  const realSelections = Array.isArray(realRaw.selections)
    ? realRaw.selections
        .map((selection) => ({
          device: String(selection?.device || "").trim(),
          iosVersion: String(selection?.iosVersion || "").trim(),
          browser: selection?.browser === "chrome" ? "chrome" : "safari",
        }))
        .filter((selection) => selection.device && selection.iosVersion)
    : [];
  const devices = {
    desktop: {
      enabled: desktopRaw.enabled === true,
      browsers: desktopBrowsers,
      instancesPerBrowser: normalizeV3PositiveInt(
        desktopRaw.instancesPerBrowser ?? 1,
        "Desktop instances",
      ),
      sessionDurationSeconds: normalizeV3Duration(
        desktopRaw.sessionDurationSeconds ?? 60,
        "Desktop session duration",
      ),
      proxy: normalizeV3ProxyPolicy(desktopRaw.proxy, "Desktop proxy"),
    },
    androidEmulation: {
      enabled: androidRaw.enabled === true,
      browserRuntime: ["chrome-installed", "chromium-playwright"].includes(
        String(androidRaw.browserRuntime || ""),
      )
        ? String(androidRaw.browserRuntime)
        : input.browserRuntimeConsistency === true
          ? "chrome-installed"
          : "chromium-playwright",
      profiles: androidProfiles,
      instancesPerProfile: normalizeV3PositiveInt(
        androidRaw.instancesPerProfile ?? 1,
        "Android mobile instances",
      ),
      sessionDurationSeconds: normalizeV3Duration(
        androidRaw.sessionDurationSeconds ?? 60,
        "Android mobile session duration",
      ),
      proxy: normalizeV3ProxyPolicy(androidRaw.proxy, "Android mobile proxy"),
    },
    iosEmulation: {
      enabled: iosRaw.enabled === true,
      browsers: iosBrowsers,
      profiles: iosProfiles,
      instancesPerProfile: normalizeV3PositiveInt(
        iosRaw.instancesPerProfile ?? 1,
        "Local iOS instances",
      ),
      sessionDurationSeconds: normalizeV3Duration(
        iosRaw.sessionDurationSeconds ?? 60,
        "Local iOS session duration",
      ),
      orientation:
        iosRaw.orientation === "landscape" ? "landscape" : "portrait",
      locale: String(iosRaw.locale || "en-US").trim() || "en-US",
      timezoneId: String(iosRaw.timezoneId || "UTC").trim() || "UTC",
      proxy: normalizeV3ProxyPolicy(iosRaw.proxy, "Local iOS proxy"),
    },
    androidAvd: {
      enabled: avdRaw.enabled === true,
      browserRuntime: "android-chrome",
      avdNames: uniqueStrings(avdRaw.avdNames),
      // One emulator process per AVD. Instances beyond 1 require cloned AVDs.
      instancesPerAvd: normalizeV3PositiveInt(
        avdRaw.instancesPerAvd ?? 1,
        "Android AVD instances",
      ),
      sessionDurationSeconds: normalizeV3Duration(
        avdRaw.sessionDurationSeconds ?? 60,
        "Android AVD session duration",
      ),
    },
    realIos: {
      enabled: realRaw.enabled === true,
      browserRuntime: "real-ios-provider",
      selections: realSelections,
      sessionDurationSeconds: normalizeV3Duration(
        realRaw.sessionDurationSeconds ?? 60,
        "Real iOS session duration",
      ),
    },
  };
  if (devices.desktop.enabled && devices.desktop.browsers.length === 0)
    throw new Error("Desktop: select at least one browser");
  if (
    devices.androidEmulation.enabled &&
    devices.androidEmulation.profiles.length === 0
  )
    throw new Error(
      "Android mobile emulation: select at least one mobile profile",
    );
  if (
    devices.iosEmulation.enabled &&
    (devices.iosEmulation.browsers.length === 0 ||
      devices.iosEmulation.profiles.length === 0)
  )
    throw new Error(
      "Local iPhone/iPad Compatibility: select at least one browser and profile",
    );
  if (devices.androidAvd.enabled && devices.androidAvd.avdNames.length === 0)
    throw new Error("Android AVD: select at least one AVD");
  if (devices.realIos.enabled && devices.realIos.selections.length === 0)
    throw new Error("Real iOS Provider: select at least one provider device");
  if (
    ![
      devices.desktop.enabled,
      devices.androidEmulation.enabled,
      devices.iosEmulation.enabled,
      devices.androidAvd.enabled,
      devices.realIos.enabled,
    ].some(Boolean)
  )
    throw new Error("Select at least one device family");

  const proxyMode = input.proxyMode === "per-device" ? "per-device" : "general";
  const generalProxy = normalizeV3ProxyPolicy(
    input.generalProxy,
    "General proxy",
  );
  const concurrency = normalizeMatrixConcurrency(input.concurrency);
  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  if (rawSteps.length > 50) throw new Error("A run can contain up to 50 steps");
  const autoQa = normalizeAutoQaSettings(input.autoQa, rawSteps);
  const privacy = normalizePrivacySettings(input.privacy, "desktop");
  const effectiveSources = [];
  if (proxyMode === "general") effectiveSources.push(generalProxy.source);
  else {
    if (devices.desktop.enabled)
      effectiveSources.push(devices.desktop.proxy.source);
    if (devices.androidEmulation.enabled)
      effectiveSources.push(devices.androidEmulation.proxy.source);
    if (devices.iosEmulation.enabled)
      effectiveSources.push(devices.iosEmulation.proxy.source);
  }
  if (effectiveSources.includes("manual") && !privacy.proxy.enabled)
    throw new Error("Manual proxy source requires proxy settings");
  if (
    autoQa.behaviorMode === "manual" &&
    devices.realIos.enabled &&
    rawSteps.some((step) => step?.type === "smart-interaction")
  ) {
    throw new Error(
      "Smart QA Interaction is not available for Real iOS Device runs yet",
    );
  }
  const steps = rawSteps.map((step, index) => normalizeStep(step, index));
  const executionMode =
    input.executionMode === "background" ? "background" : "visible";
  const headless = resolveRunHeadless(
    input.executionMode,
    input.headless === true,
  );
  return {
    version: 3,
    urlPoolText: rawUrlText,
    urlPool: parsedPool.valid,
    invalidUrlCount: parsedPool.invalid.length,
    duplicateUrlCount: parsedPool.duplicates,
    runSeed: String(input.runSeed || "").trim(),
    devices,
    proxyMode,
    generalProxy,
    concurrency,
    headless,
    executionMode,
    captureScreenshots: input.captureScreenshots !== false,
    interactionIndicator: headless
      ? false
      : input.interactionIndicator !== false,
    browserRuntimeConsistency: input.browserRuntimeConsistency === true,
    privacy,
    autoQa,
    steps,
  };
}

function settingsForWorkUnit(normalized, workUnit) {
  if (!normalized || ![2, 3].includes(normalized.version)) return normalized;
  const kind = workUnit.executionKind;
  let deviceMode = "desktop";
  let browser = workUnit.browser;
  const browserRuntime = browserRuntimeForWorkUnit(
    workUnit.browser,
    kind,
    workUnit.browserRuntime,
  );
  let deviceName;
  let iosBrowser;
  let iosOrientation;
  let locale = workUnit.locale;
  let timezoneId = workUnit.timezoneId;
  if (
    kind === "desktop" &&
    ["chrome-installed", "brave-installed"].includes(browserRuntime)
  ) {
    browser = "chromium";
  } else if (kind === "android-emulation") {
    deviceMode = "android-emulation";
    browser = "chromium";
    deviceName = workUnit.deviceProfile;
  } else if (kind === "android-avd") {
    deviceMode = "android";
    browser = "chromium";
    deviceName = workUnit.androidAvdName;
  } else if (kind === "ios-emulation") {
    deviceMode = "ios-emulation";
    browser = ["chrome-installed", "brave-installed"].includes(browserRuntime)
      ? "chromium"
      : "webkit";
    deviceName = workUnit.deviceProfile;
    iosBrowser =
      browserRuntime === "chrome-installed"
        ? "chrome-ios"
        : browserRuntime === "brave-installed"
          ? "chrome-ios"
          : workUnit.browser;
    iosOrientation = workUnit.orientation || "portrait";
  } else if (kind === "real-ios") {
    deviceMode = "real-ios";
    browser = "webkit";
  }
  return {
    ...normalized,
    targetUrl: workUnit.targetUrl,
    targetUrls: [workUnit.targetUrl],
    deviceMode,
    deviceName,
    browser,
    browserRuntime,
    iosBrowser,
    iosOrientation,
    locale,
    timezoneId,
    realIos: workUnit.realIos,
    sessions: 1,
    sessionDurationSeconds: workUnit.sessionDurationSeconds,
    sessionDurationExplicit: true,
    proxySource: workUnit.proxySource,
    allowSlowProxies: ["rotating", "static", "smart-mix"].includes(
      workUnit.proxySource,
    ),
    // Drives the hardened wording in device-consistency findings.
    // Uses deviceName so it works for both the AVD name and the emulation profile name.
    deviceHardened:
      (kind === "android-avd" || kind === "android-emulation") &&
      Boolean(deviceHardening.findRealDeviceProfile(deviceName)),
  };
}

function normalizeQaRunRequest(input) {
  if (!input || typeof input !== "object")
    throw new Error("Invalid QA run request");
  if (
    Number(input.version) === 3 ||
    Array.isArray(input.urlPool) ||
    typeof input.urlPoolText === "string"
  )
    return normalizeMatrixV3Request(input);
  if (Array.isArray(input.targets)) return normalizeMatrixRequest(input);

  const targetUrls = normalizeRunnerTargets(input);
  const sessionDurationExplicit =
    typeof input.sessionDurationExplicit === "boolean"
      ? input.sessionDurationExplicit
      : input.sessionDurationSeconds != null;
  const sessionDurationSeconds = sessionDurationExplicit
    ? Number(input.sessionDurationSeconds)
    : 60;
  if (
    !Number.isFinite(sessionDurationSeconds) ||
    sessionDurationSeconds < 5 ||
    sessionDurationSeconds > 600
  ) {
    throw new Error(
      "Browser session duration must be between 5 and 600 seconds",
    );
  }

  const browser = String(input.browser || "");
  if (!SUPPORTED_BROWSERS.has(browser))
    throw new Error("Choose a supported browser");

  const deviceMode = String(input.deviceMode || "desktop");
  if (!SUPPORTED_DEVICE_MODES.has(deviceMode))
    throw new Error("Choose a supported target device");
  const deviceName =
    typeof input.deviceName === "string" ? input.deviceName.trim() : "";

  const sessions = Number(input.sessions);
  const concurrency = Number(input.concurrency);
  if (!Number.isInteger(sessions) || sessions < 1) {
    throw new Error("Sessions must be a positive integer");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer");
  }

  let iosBrowser;
  let iosOrientation;
  let locale;
  let timezoneId;
  let realIos;

  if (deviceMode === "android") {
    if (targetUrls.length !== 1)
      throw new Error(
        "Android virtual device runs support exactly 1 target website",
      );
    if (!deviceName) throw new Error("Choose an Android virtual device");
    if (sessions !== 1)
      throw new Error("Android virtual device runs are limited to 1 session");
    if (concurrency !== 1)
      throw new Error("Android virtual device runs use concurrency 1");
  }

  if (deviceMode === "ios-emulation") {
    if (browser !== "webkit")
      throw new Error("Local iOS Compatibility uses the WebKit engine");
    if (!deviceName || !SUPPORTED_IOS_DEVICES.has(deviceName))
      throw new Error("Choose a supported iPhone/iPad profile");

    iosBrowser = String(input.iosBrowser || "safari-ios");
    if (!SUPPORTED_IOS_BROWSERS.has(iosBrowser))
      throw new Error("Choose a supported iOS browser identity");

    iosOrientation = String(input.iosOrientation || "portrait");
    if (!SUPPORTED_IOS_ORIENTATIONS.has(iosOrientation))
      throw new Error("Choose a supported iOS orientation");

    locale = String(input.locale || "en-US").trim() || "en-US";
    timezoneId = String(input.timezoneId || "UTC").trim() || "UTC";
  }

  if (deviceMode === "real-ios") {
    if (targetUrls.length !== 1)
      throw new Error("Real iOS Device runs support exactly 1 target website");
    if (sessions !== 1 || concurrency !== 1)
      throw new Error(
        "Real iOS Device runs use exactly 1 session and concurrency 1",
      );
    const selection =
      input.realIos && typeof input.realIos === "object" ? input.realIos : {};
    const device = String(selection.device || "").trim();
    const iosVersion = String(selection.iosVersion || "").trim();
    const realIosBrowser = String(selection.browser || "");
    if (!device) throw new Error("Choose a real iOS device model");
    if (!iosVersion) throw new Error("Choose a real iOS version");
    if (!["safari", "chrome"].includes(realIosBrowser))
      throw new Error("Choose Safari or Chrome iOS");
    realIos = { device, iosVersion, browser: realIosBrowser };
  }

  const privacy = normalizePrivacySettings(input.privacy, deviceMode);
  const proxySource = String(
    input.proxySource || (privacy.proxy.enabled ? "manual" : "none"),
  );
  const allowSlowProxies = ["rotating", "static", "smart-mix"].includes(
    proxySource,
  );
  if (!SUPPORTED_PROXY_SOURCES.has(proxySource))
    throw new Error("Choose a supported proxy source");
  if (
    ["rotating", "static", "smart-mix"].includes(proxySource) &&
    deviceMode === "android"
  ) {
    throw new Error(
      "Proxy pools are not available for Android AVD runs in v0.6",
    );
  }
  if (
    ["rotating", "static", "smart-mix"].includes(proxySource) &&
    deviceMode === "real-ios"
  ) {
    throw new Error(
      "Proxy pools are not available for Real iOS Device runs in v0.6",
    );
  }
  if (proxySource === "manual" && !privacy.proxy.enabled)
    throw new Error("Manual proxy source requires proxy settings");

  const rawSteps = Array.isArray(input.steps) ? input.steps : [];
  if (rawSteps.length > 50) throw new Error("A run can contain up to 50 steps");

  const steps = rawSteps.map((step, index) => normalizeStep(step, index));
  if (
    deviceMode === "real-ios" &&
    steps.some((step) => step.type === "smart-interaction")
  ) {
    throw new Error(
      "Smart QA Interaction is not available for Real iOS Device runs yet",
    );
  }
  return {
    targetUrls,
    targetUrl: targetUrls[0],
    sessionDurationSeconds,
    sessionDurationExplicit,
    deviceMode,
    deviceName: deviceName || undefined,
    browser,
    iosBrowser,
    iosOrientation,
    locale,
    timezoneId,
    realIos,
    sessions,
    concurrency,
    headless: input.headless !== false,
    captureScreenshots: input.captureScreenshots !== false,
    privacy,
    proxySource,
    allowSlowProxies,
    steps,
    deviceHardened:
      deviceMode === "android" &&
      Boolean(deviceHardening.findRealDeviceProfile(deviceName)),
  };
}

function normalizeStep(step, index) {
  if (!step || typeof step !== "object" || !SUPPORTED_STEPS.has(step.type)) {
    throw new Error(`Invalid step at position ${index + 1}`);
  }
  const id =
    typeof step.id === "string" && step.id
      ? step.id
      : `${step.type}-${index + 1}`;

  switch (step.type) {
    case "wait": {
      const ms = Math.min(Math.max(Number(step.ms) || 0, 0), 30000);
      return { id, type: "wait", ms };
    }
    case "scroll": {
      const direction = step.direction === "up" ? "up" : "down";
      const distance = Math.min(Math.max(Number(step.distance) || 0, 0), 10000);
      return { id, type: "scroll", direction, distance };
    }
    case "click": {
      const selector = String(step.selector || "").trim();
      if (!selector)
        throw new Error(`Click step ${index + 1} needs a selector`);
      return { id, type: "click", selector };
    }
    case "type": {
      const selector = String(step.selector || "").trim();
      if (!selector) throw new Error(`Type step ${index + 1} needs a selector`);
      return { id, type: "type", selector, value: String(step.value ?? "") };
    }
    case "screenshot":
      return { id, type: "screenshot", fullPage: step.fullPage !== false };
    case "smart-interaction":
      return {
        id,
        type: "smart-interaction",
        value: String(step.value ?? "Sample interaction").slice(0, 500),
      };
    default:
      throw new Error(`Unsupported step at position ${index + 1}`);
  }
}

async function runPool(items, concurrency, worker, signal) {
  let cursor = 0;
  const workerCount = Math.min(concurrency, items.length);

  async function consume() {
    while (true) {
      if (signal?.aborted) return;
      const current = cursor;
      cursor += 1;
      if (current >= items.length) return;
      await worker(items[current]);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => consume()));
}

function createEmitter(emit, runId) {
  return (event) =>
    emit({ runId, timestamp: new Date().toISOString(), ...event });
}

const NAVIGATION_RACE_PATTERN =
  /(execution context was destroyed|cannot find context with specified id|frame was detached|most likely because of a navigation)/i;

function isNavigationRaceError(error) {
  return NAVIGATION_RACE_PATTERN.test(String(error?.message || error || ""));
}

async function waitForBehaviorNavigationSettle(page, lifetime) {
  lifetime?.throwIfExpired?.();
  const remaining = Number(lifetime?.remainingMs?.());
  const timeout = Number.isFinite(remaining)
    ? Math.max(250, Math.min(10000, remaining))
    : 10000;

  if (typeof page?.waitForLoadState === "function") {
    await page.waitForLoadState("domcontentloaded", { timeout });
  } else if (typeof page?.waitForTimeout === "function") {
    await page.waitForTimeout(Math.min(250, timeout));
  }
  lifetime?.throwIfExpired?.();
}

async function runNavigationResilientBehavior(
  page,
  stepLabel,
  context,
  operation,
  { retry = false } = {},
) {
  try {
    return await operation();
  } catch (error) {
    if (!isNavigationRaceError(error)) throw error;

    context.emit?.({
      type: "log",
      message: `Page navigated during ${stepLabel}; waiting for the new document`,
    });
    await waitForBehaviorNavigationSettle(page, context.lifetime);

    if (retry) {
      context.emit?.({
        type: "log",
        message: `Resuming ${stepLabel} after page navigation`,
      });
      return operation();
    }

    context.emit?.({
      type: "log",
      message: `Page navigation completed during ${stepLabel}; continuing without repeating ${stepLabel}`,
    });
    return undefined;
  }
}

async function runNavigationResilientProbe(
  page,
  label,
  pushWork,
  lifetime,
  operation,
  { maxAttempts = 3 } = {},
) {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      lifetime?.throwIfExpired?.();
      return await operation();
    } catch (error) {
      if (!isNavigationRaceError(error) || attempt >= Math.max(1, maxAttempts))
        throw error;
      pushWork?.({
        type: "log",
        message: `Page navigation interrupted ${label}; waiting for the replacement document before retrying diagnostics`,
      });
      await waitForBehaviorNavigationSettle(page, lifetime);
      if (typeof page?.waitForLoadState === "function") {
        const remaining = Number(lifetime?.remainingMs?.());
        const timeout = Number.isFinite(remaining)
          ? Math.max(250, Math.min(5000, remaining))
          : 5000;
        await page
          .waitForLoadState("load", { timeout })
          .catch((settleError) => {
            if (
              !isNavigationRaceError(settleError) &&
              !/timeout/i.test(
                String(settleError?.message || settleError || ""),
              )
            )
              throw settleError;
          });
      }
    }
  }
}

async function captureEvidenceScreenshot(page, context) {
  if (context.captureScreenshots === false || !page?.screenshot) return null;
  try {
    const identity = context.workId || `session-${context.sessionId || 1}`;
    const screenshotPath = path.join(
      context.screenshotDir,
      `${identity}-evidence.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: false });
    context.emit?.({
      type: "log",
      message: `Evidence screenshot saved: ${screenshotPath}`,
      screenshotPath,
    });
    return screenshotPath;
  } catch (error) {
    context.emit?.({
      type: "log",
      message: `Evidence screenshot skipped: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

async function executeStep(page, step, context) {
  context.lifetime?.throwIfExpired?.();
  switch (step.type) {
    case "wait":
      if (context.lifetime) await context.lifetime.wait(step.ms);
      else await page.waitForTimeout(step.ms);
      return;
    case "scroll": {
      const delta = step.direction === "up" ? -step.distance : step.distance;
      await runNavigationResilientBehavior(
        page,
        "scroll",
        context,
        async () => {
          await smoothScrollBy(page, delta, {
            lifetime: context.lifetime,
            chunkSize: context.pacing?.scrollChunkPx,
            delayMs: context.pacing?.scrollDelayMs,
          });
        },
        { retry: true },
      );
      return;
    }
    case "click": {
      await runNavigationResilientBehavior(page, "click", context, async () => {
        const target = page.locator(step.selector).first();
        await target.scrollIntoViewIfNeeded();
        context.lifetime?.throwIfExpired?.();
        if (context.indicator?.move)
          await context.indicator.move(page, target, {
            mode: context.indicatorMode,
          });
        await waitBeforePageInteraction({ lifetime: context.lifetime });
        if (context.indicator?.pulse)
          await context.indicator.pulse(page, { mode: context.indicatorMode });
        await target.click({
          timeout: Math.min(
            10000,
            Math.max(250, context.lifetime?.remainingMs?.() || 10000),
          ),
        });
      });
      return;
    }
    case "type": {
      await runNavigationResilientBehavior(page, "type", context, async () => {
        const target = page.locator(step.selector).first();
        context.lifetime?.throwIfExpired?.();
        if (context.indicator?.move)
          await context.indicator.move(page, target, {
            mode: context.indicatorMode,
          });
        await progressiveType(target, step.value, {
          delayMs: context.pacing?.typingDelayMs,
          lifetime: context.lifetime,
        });
      });
      return;
    }
    case "smart-interaction":
      await runNavigationResilientBehavior(
        page,
        "smart interaction",
        context,
        async () => {
          await runSmartInteraction(page, {
            value: step.value,
            lifetime: context.lifetime,
            resolver: context.resolver,
            indicator: context.indicator,
            indicatorMode: context.indicatorMode,
            pacing: context.pacing,
            log: (message) => context.emit({ type: "log", message }),
          });
        },
      );
      return;
    case "screenshot": {
      if (context.captureScreenshots === false) {
        context.emit({
          type: "log",
          message: "Screenshot capture disabled for this run",
        });
        return;
      }
      await runNavigationResilientBehavior(
        page,
        "screenshot",
        context,
        async () => {
          context.lifetime?.throwIfExpired?.();
          const identity = context.workId || `session-${context.sessionId}`;
          const filename = `${identity}-step-${context.stepNumber}.png`;
          const screenshotPath = path.join(context.screenshotDir, filename);
          await page.screenshot({
            path: screenshotPath,
            fullPage: step.fullPage,
          });
          context.emit({
            type: "log",
            message: `Screenshot saved: ${screenshotPath}`,
            screenshotPath,
          });
        },
        { retry: true },
      );
      return;
    }
    default:
      throw new Error(`Unsupported step type: ${step.type}`);
  }
}

function buildTargetNavigationOptions(autoQa, timeoutMs) {
  const referrer = resolveSimulatedReferrer(autoQa || {});
  const options = { waitUntil: "domcontentloaded", timeout: timeoutMs };
  if (referrer.value) options.referer = referrer.value;
  return options;
}

async function executeConfiguredBehavior({
  settings,
  normalized,
  page,
  context,
  workUnit,
  sessionId,
  screenshotDir,
  pushWork,
  lifetime,
  resolver,
  indicator,
  indicatorMode,
  pacing,
  signal,
  verifyAuxiliaryPage,
  runAutoQaImpl = runAutoQa,
  executeStepImpl = executeStep,
}) {
  const behavior =
    settings?.autoQa ||
    normalized?.autoQa ||
    normalizeAutoQaSettings(undefined, normalized?.steps || []);
  if (behavior.behaviorMode === "auto") {
    pushWork?.({ type: "log", message: "AUTO QA starting" });
    const resolvedAuxiliaryVerifier =
      verifyAuxiliaryPage ||
      (async (auxPage) => {
        if (
          typeof auxPage?.context === "function" &&
          context &&
          auxPage.context() !== context
        ) {
          throw new Error("Auxiliary tab escaped the primary BrowserContext");
        }
        await assertStrictPrivacyGuard(
          auxPage,
          settings?.privacy?.strictMode === true,
        );
        pushWork?.({
          type: "log",
          message:
            "Auxiliary tab privacy guard verified in the shared browser context",
        });
        return { ok: true };
      });
    const report = await runAutoQaImpl({
      page,
      context,
      workUnit,
      settings: behavior,
      lifetime,
      log: (message) => pushWork?.({ type: "log", message }),
      interactionIndicator: indicator,
      indicatorMode,
      resolver,
      pacing,
      signal,
      deps: { verifyAuxiliaryPage: resolvedAuxiliaryVerifier },
    });
    if (signal?.aborted || report?.terminalReason === "stopped")
      throw createRunAbortError();
    if (report?.adSummary)
      pushWork?.({
        type: "ad-summary",
        message: `Ad observation ${String(report.adSummary.status || "none").toUpperCase()}`,
        adSummary: report.adSummary,
      });
    pushWork?.({
      type: "log",
      message: `AUTO QA completed${report?.detectedKinds?.length ? ` · ${report.detectedKinds.join(", ")}` : ""}`,
    });
    return report;
  }
  const steps = Array.isArray(normalized?.steps) ? normalized.steps : [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    pushWork?.({
      type: "step",
      stepId: step.id,
      message: `Running ${step.type} step`,
    });
    lifetime?.throwIfExpired?.();
    await executeStepImpl(page, step, {
      sessionId,
      workId: workUnit?.workId,
      stepNumber: index + 1,
      screenshotDir,
      emit: pushWork,
      lifetime,
      resolver,
      indicator,
      indicatorMode,
      pacing,
    });
  }
  return { terminalReason: "manual-complete" };
}

function chromeIosUserAgent(baseUserAgent) {
  const source = String(baseUserAgent || "");
  if (!source) return source;
  if (/\bCriOS\//.test(source)) return source;
  const replaced = source.replace(
    /Version\/[\d.]+\s+Mobile\//,
    "CriOS/153.0.0.0 Mobile/",
  );
  if (replaced !== source) return replaced;
  return source.replace(/\sMobile\//, " CriOS/153.0.0.0 Mobile/");
}

function chromiumMajorFromVersion(browserVersion) {
  const text = String(browserVersion || "");
  const match = text.match(/(?:Chrome|Chromium)?\s*(\d{2,3})(?:\.|$)/i);
  return match ? match[1] : "";
}

function alignAndroidUserAgentWithRuntime(userAgent, browserVersion) {
  const source = String(userAgent || "");
  const major = chromiumMajorFromVersion(browserVersion);
  if (!source || !major || !/Chrome\/\d+/i.test(source)) return source;
  return source.replace(/Chrome\/\d+(?:\.\d+){0,3}/i, `Chrome/${major}.0.0.0`);
}

function swapDimensions(value) {
  if (
    !value ||
    typeof value.width !== "number" ||
    typeof value.height !== "number"
  )
    return value;
  return { width: value.height, height: value.width };
}

const IOS_EMULATION_CONTEXTS = {
  "iPhone 18 Pro": {
    viewport: { width: 402, height: 874 },
    screen: { width: 402, height: 874 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1",
  },
  "iPhone 18 Pro Max": {
    viewport: { width: 440, height: 956 },
    screen: { width: 440, height: 956 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1",
  },
  "iPhone Duo (Closed)": {
    viewport: { width: 466, height: 678 },
    screen: { width: 466, height: 678 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1",
  },
  "iPhone Duo (Open)": {
    viewport: { width: 890, height: 626 },
    screen: { width: 890, height: 626 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1",
  },
  "iPad Pro 11": {
    viewport: { width: 834, height: 1210 },
    screen: { width: 834, height: 1210 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1",
  },
  "iPad Mini": {
    viewport: { width: 744, height: 1133 },
    screen: { width: 744, height: 1133 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1",
  },
};

function resolveIosContextOptions(playwright, settings) {
  const deviceName =
    typeof settings === "string" ? settings : settings?.deviceName;
  const descriptor =
    IOS_EMULATION_CONTEXTS[deviceName] || playwright?.devices?.[deviceName];
  if (!descriptor)
    throw new Error(
      `iPhone/iPad profile is not available in the installed browser runtime: ${deviceName}`,
    );

  const iosBrowser =
    typeof settings === "string"
      ? "safari-ios"
      : settings?.iosBrowser || "safari-ios";
  const iosOrientation =
    typeof settings === "string"
      ? "portrait"
      : settings?.iosOrientation || "portrait";
  const locale =
    typeof settings === "string" ? "en-US" : settings?.locale || "en-US";
  const timezoneId =
    typeof settings === "string" ? "UTC" : settings?.timezoneId || "UTC";

  const options = {
    ...descriptor,
    locale,
    timezoneId,
    permissions: [],
  };

  if (iosBrowser === "chrome-ios") {
    options.userAgent = chromeIosUserAgent(descriptor.userAgent);
  }

  if (iosOrientation === "landscape") {
    options.viewport = swapDimensions(descriptor.viewport);
    if (descriptor.screen) options.screen = swapDimensions(descriptor.screen);
  }

  return options;
}

const ANDROID_EMULATION_CONTEXTS = {
  "Pixel 11": {
    viewport: { width: 412, height: 923 },
    screen: { width: 412, height: 923 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 17; Pixel 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  },
  "Pixel 11 Pro": {
    viewport: { width: 427, height: 952 },
    screen: { width: 427, height: 952 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 17; Pixel 11 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  },
  "Pixel 11 Pro XL": {
    viewport: { width: 448, height: 997 },
    screen: { width: 448, height: 997 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 17; Pixel 11 Pro XL) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  },
  "Galaxy S26": {
    viewport: { width: 360, height: 780 },
    screen: { width: 360, height: 780 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 16; SM-S942B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  },
  "Galaxy S26+": {
    viewport: { width: 384, height: 832 },
    screen: { width: 384, height: 832 },
    deviceScaleFactor: 3.75,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 16; SM-S947B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  },
  "Galaxy S26 Ultra": {
    viewport: { width: 384, height: 832 },
    screen: { width: 384, height: 832 },
    deviceScaleFactor: 3.75,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 16; SM-S948B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  },
  "Galaxy S26 FE": {
    viewport: { width: 360, height: 780 },
    screen: { width: 360, height: 780 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 16; SM-S741B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  },
  "Galaxy Z Flip8": {
    viewport: { width: 360, height: 840 },
    screen: { width: 360, height: 840 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 16; SM-F776B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  },
  "Galaxy Z Fold8 (Open)": {
    viewport: { width: 816, height: 616 },
    screen: { width: 816, height: 616 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 16; SM-F971B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  },
  // Previous profiles remain selectable alongside the latest profiles.
  "Pixel 7": {
    viewport: { width: 412, height: 915 },
    screen: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  },
  "Pixel 5": {
    viewport: { width: 393, height: 851 },
    screen: { width: 393, height: 851 },
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  },
  "Galaxy S23": {
    viewport: { width: 360, height: 780 },
    screen: { width: 360, height: 780 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36",
  },
};

function resolveAndroidEmulationContextOptions(
  playwrightOrSettings,
  maybeSettings,
) {
  const playwright = maybeSettings ? playwrightOrSettings : null;
  const settings = maybeSettings || playwrightOrSettings;
  const verified = ANDROID_EMULATION_CONTEXTS[settings.deviceName];
  const maintained = playwright?.devices?.[settings.deviceName];
  const profile = verified || maintained;
  if (!profile)
    throw new Error(
      `Android mobile profile is unavailable: ${settings.deviceName}`,
    );
  return {
    ...profile,
    locale: settings.locale || "en-US",
    timezoneId: settings.timezoneId || "UTC",
    permissions: [],
  };
}

async function collectIosObservedEnvironment(page) {
  return page.evaluate(async () => {
    const rtc = {
      supported: typeof RTCPeerConnection !== "undefined",
      literalIpCandidateCount: 0,
    };

    if (rtc.supported) {
      try {
        const pc = new RTCPeerConnection({ iceServers: [] });
        const candidates = [];
        pc.createDataChannel("orbitqa-webrtc-check");
        pc.addEventListener("icecandidate", (event) => {
          if (event.candidate?.candidate)
            candidates.push(event.candidate.candidate);
        });
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await Promise.race([
          new Promise((resolve) => {
            if (pc.iceGatheringState === "complete") return resolve();
            pc.addEventListener("icegatheringstatechange", () => {
              if (pc.iceGatheringState === "complete") resolve();
            });
          }),
          new Promise((resolve) => setTimeout(resolve, 900)),
        ]);
        pc.close();

        const ipv4 = /(?:^|\s)(?:\d{1,3}\.){3}\d{1,3}(?:\s|$)/;
        const ipv6 = /(?:^|\s)(?:[0-9a-f]{0,4}:){2,}[0-9a-f]{0,4}(?:\s|$)/i;
        rtc.literalIpCandidateCount = candidates.filter(
          (candidate) => ipv4.test(candidate) || ipv6.test(candidate),
        ).length;
      } catch {
        // Diagnostic only. If WebRTC cannot gather candidates, leave the count at zero.
      }
    }

    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: { width: window.screen.width, height: window.screen.height },
      devicePixelRatio: window.devicePixelRatio,
      locale: navigator.language,
      timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
      webRtcSupported: rtc.supported,
      literalIpCandidateCount: rtc.literalIpCandidateCount,
    };
  });
}

function assessIosDiagnostics(expected, observed) {
  const checks = [];
  const add = (key, label, status, expectedValue, observedValue, detail) => {
    checks.push({
      key,
      label,
      status,
      expected: String(expectedValue),
      observed: String(observedValue),
      detail,
    });
  };

  const wantsChrome = expected.iosBrowser === "chrome-ios";
  const uaMatches = wantsChrome
    ? /\bCriOS\//.test(observed.userAgent)
    : /\bSafari\//.test(observed.userAgent) &&
      !/\bCriOS\//.test(observed.userAgent);
  add(
    "userAgent",
    "Browser identity",
    uaMatches ? "pass" : "warning",
    wantsChrome ? "CriOS token" : "Safari token",
    observed.userAgent,
    wantsChrome
      ? "Chrome iOS compatibility identity over WebKit."
      : "Safari iOS compatibility identity over WebKit.",
  );

  const expectedPlatformToken = expected.family === "iPad" ? "iPad" : "iPhone";
  const platformMatches = String(observed.platform || "")
    .toLowerCase()
    .includes(expectedPlatformToken.toLowerCase());
  add(
    "platform",
    "Navigator platform",
    platformMatches ? "pass" : "warning",
    expectedPlatformToken,
    observed.platform || "Unavailable",
    "OrbitQA reports this value; it does not spoof navigator.platform.",
  );

  add(
    "touch",
    "Touch points",
    observed.maxTouchPoints > 0 ? "pass" : "warning",
    "> 0",
    observed.maxTouchPoints,
    "Mobile QA expects touch-capable input.",
  );

  const viewportMatches =
    observed.viewport?.width === expected.viewport?.width &&
    observed.viewport?.height === expected.viewport?.height;
  add(
    "viewport",
    "Viewport",
    viewportMatches ? "pass" : "warning",
    `${expected.viewport.width}×${expected.viewport.height}`,
    `${observed.viewport?.width}×${observed.viewport?.height}`,
    "CSS viewport exposed to the page.",
  );

  const dprMatches =
    Number(observed.devicePixelRatio) === Number(expected.deviceScaleFactor);
  add(
    "dpr",
    "Device pixel ratio",
    dprMatches ? "pass" : "warning",
    expected.deviceScaleFactor,
    observed.devicePixelRatio,
    "Display scale exposed to the page.",
  );

  add(
    "locale",
    "Locale",
    observed.locale === expected.locale ? "pass" : "warning",
    expected.locale,
    observed.locale,
    "Navigator language consistency check.",
  );
  add(
    "timezone",
    "Timezone",
    observed.timezoneId === expected.timezoneId ? "pass" : "warning",
    expected.timezoneId,
    observed.timezoneId,
    "Intl timezone consistency check.",
  );

  const webRtcStatus =
    observed.literalIpCandidateCount === 0 ? "pass" : "warning";
  add(
    "webrtc",
    "WebRTC exposure",
    webRtcStatus,
    "No literal IP ICE candidates",
    `${observed.literalIpCandidateCount} literal IP candidate(s)`,
    observed.webRtcSupported
      ? "Checks host ICE candidates without using an external STUN server."
      : "WebRTC API is unavailable in this context.",
  );

  return {
    overall: checks.every((check) => check.status === "pass")
      ? "pass"
      : "warning",
    checks,
    observed,
  };
}

function expectedIosDiagnosticProfile(normalized, contextOptions) {
  const family = normalized.deviceName?.startsWith("iPad") ? "iPad" : "iPhone";
  return {
    deviceName: normalized.deviceName,
    family,
    iosBrowser: normalized.iosBrowser,
    iosOrientation: normalized.iosOrientation,
    locale: normalized.locale,
    timezoneId: normalized.timezoneId,
    viewport: contextOptions.viewport,
    deviceScaleFactor: contextOptions.deviceScaleFactor,
  };
}

function shouldRunBehaviorSteps(report) {
  return !report?.blocked;
}

async function createPrivacyReadyPage(context, strictMode) {
  if (typeof context?.clearPermissions === "function")
    await context.clearPermissions();
  await installStrictPrivacyGuard(context, strictMode);
  const page = await context.newPage();
  await assertStrictPrivacyGuard(page, strictMode);
  return page;
}

function expectedPrivacyProfile(normalized, page, contextOptions) {
  if (normalized.deviceMode === "ios-emulation") {
    const family = normalized.deviceName?.startsWith("iPad")
      ? "iPad"
      : "iPhone";
    return {
      userAgentIncludes:
        normalized.iosBrowser === "chrome-ios" ? "CriOS/" : family,
      platformIncludes: "",
      platformMode: "host-info",
      viewport: contextOptions.viewport,
      dpr: contextOptions.deviceScaleFactor,
      locale: normalized.locale,
      timezoneId: normalized.timezoneId,
    };
  }
  const viewport = page.viewportSize() || { width: 1280, height: 720 };
  if (
    normalized.deviceMode === "android" ||
    normalized.deviceMode === "android-emulation"
  ) {
    const emulatedAndroid = normalized.deviceMode === "android-emulation";
    return {
      userAgentIncludes: "Android",
      platformIncludes: emulatedAndroid ? "" : "Linux",
      ...(emulatedAndroid ? { platformMode: "host-info" } : {}),
      touch: true,
      viewport,
      dpr: contextOptions?.deviceScaleFactor || 1,
      locale: normalized.locale || (emulatedAndroid ? "en-US" : ""),
      timezoneId: normalized.timezoneId || (emulatedAndroid ? "UTC" : ""),
    };
  }
  return {
    userAgentIncludes: "",
    viewport,
    dpr: 1,
    locale: normalized.locale || "",
    timezoneId: normalized.timezoneId || "",
  };
}

function safeRunErrorMessage(error, normalized, runtimeProxy) {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message, [
    normalized?.privacy?.proxy?.username,
    normalized?.privacy?.proxy?.password,
    runtimeProxy?.username,
    runtimeProxy?.password,
  ]);
}

function isRetryableRotatingNavigationFailure(error, signal, lifetime) {
  if (signal?.aborted || error?.name === "AbortError") return false;
  if (
    error?.name === "SessionExpiredError" ||
    lifetime?.reason === "duration-elapsed" ||
    lifetime?.expired
  )
    return false;
  return true;
}

async function executeAndroidRun({
  runId,
  normalized,
  push,
  screenshotDir,
  playwright,
  androidService,
  signal,
  runResourceTracker = null,
}) {
  if (!androidService) throw new Error("Android service is unavailable");
  throwIfRunAborted(signal);
  push({
    type: "log",
    message: `Preparing Android virtual device: ${normalized.deviceName}`,
  });
  const launchInfo = await androidService.launchAvd(normalized.deviceName);
  throwIfRunAborted(signal);

  if (!playwright._android)
    throw new Error(
      "The installed browser runtime does not include Android automation support",
    );
  // Fleet-safe: pick the emulator this run just launched by its ADB serial instead of
  // assuming it is the only device attached.
  const device = await findAndroidDeviceBySerial(
    playwright,
    launchInfo?.serial,
  );

  const hardeningProfile = deviceHardening.findRealDeviceProfile(
    normalized.deviceName,
  );
  let context;
  let unregisterDeviceResource =
    runResourceTracker?.register?.(runId, {
      label: "android-device",
      close: () => device.close(),
      forceClose: async () => {
        await device
          .shell?.("am force-stop com.android.chrome")
          .catch(() => undefined);
        await device.close?.().catch(() => undefined);
      },
    }) || null;
  let unregisterContextResource = null;
  const abortResources = () => {
    if (context) void context.close().catch(() => undefined);
    if (device) void device.close().catch(() => undefined);
  };
  signal?.addEventListener("abort", abortResources, { once: true });
  try {
    throwIfRunAborted(signal);
    push({
      type: "session-start",
      sessionId: 1,
      status: "running",
      message: `Android session started on ${normalized.deviceName}`,
    });
    await device
      .shell("am force-stop com.android.chrome")
      .catch(() => undefined);
    context = await device.launchBrowser(
      hardeningProfile
        ? { args: deviceHardening.buildHardeningArgs(hardeningProfile) }
        : {},
    );
    const trackedAndroidContext = context;
    unregisterContextResource =
      runResourceTracker?.register?.(runId, {
        label: "android-context",
        close: () => trackedAndroidContext.close(),
        forceClose: async () => {
          await device
            .shell?.("am force-stop com.android.chrome")
            .catch(() => undefined);
          await trackedAndroidContext.close?.().catch(() => undefined);
        },
      }) || null;
    const page = await createPrivacyReadyPage(
      context,
      normalized.privacy.strictMode,
    );
    if (hardeningProfile)
      await deviceHardening.installDeviceHardening(context, hardeningProfile);
    page.setDefaultTimeout(10000);

    const navigationStarted = Date.now();
    await page.goto(normalized.targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    push({
      type: "log",
      sessionId: 1,
      message: `Loaded target on Android in ${Date.now() - navigationStarted} ms`,
    });

    const proxyResult = assessProxyRoute({
      enabled: false,
      requireVerifiedRoute: false,
    });
    const privacyReport = await runNavigationResilientProbe(
      page,
      "Android privacy diagnostics",
      push,
      null,
      () =>
        collectPrivacyReport({
          page,
          expected: expectedPrivacyProfile(normalized, page),
          proxyChecks: [proxyResult.route, proxyResult.fallback],
          strictMode: normalized.privacy.strictMode,
          proxyRequired: false,
          webRtcPreventionApplied: false,
        }),
    );
    push({
      type: "privacy-diagnostics",
      sessionId: 1,
      message: privacyReport.blocked
        ? "Strict Privacy Mode blocked the session"
        : "Privacy diagnostics completed",
      privacyDiagnostics: privacyReport,
    });
    if (!shouldRunBehaviorSteps(privacyReport)) {
      throw new Error(
        `Strict Privacy Mode blocked the session: ${privacyReport.blockingReasons.join(", ")}`,
      );
    }

    if (hardeningProfile) {
      const hardeningReport = await runNavigationResilientProbe(
        page,
        "Android device hardening diagnostics",
        push,
        null,
        () => deviceHardening.collectHardeningReport(page, hardeningProfile),
      );
      push({
        type: "device-hardening",
        sessionId: 1,
        message: hardeningReport.passed
          ? "Device hardening passed all three checks"
          : `Device hardening incomplete: ${hardeningReport.checks
              .filter((check) => !check.pass)
              .map((check) => check.id)
              .join(", ")}`,
        deviceHardening: hardeningReport,
      });
    }

    for (let index = 0; index < normalized.steps.length; index += 1) {
      const step = normalized.steps[index];
      push({
        type: "step",
        sessionId: 1,
        stepId: step.id,
        message: `Running ${step.type} step`,
      });
      throwIfRunAborted(signal);
      await executeStep(page, step, {
        sessionId: 1,
        stepNumber: index + 1,
        screenshotDir,
        emit: push,
        captureScreenshots: normalized.captureScreenshots !== false,
        pacing: createQaPacing(normalized.targetUrl || "android-single", {
          deviceMode: normalized.deviceMode,
        }),
      });
      throwIfRunAborted(signal);
    }

    push({
      type: "session-complete",
      sessionId: 1,
      status: "completed",
      message: "Android session completed",
    });
    return { completed: 1, failed: 0 };
  } catch (error) {
    if (signal?.aborted) {
      push({
        type: "session-cancelled",
        sessionId: 1,
        status: "cancelled",
        message: "Android session stopped by user",
      });
      throw createRunAbortError();
    }
    push({
      type: "session-error",
      sessionId: 1,
      status: "failed",
      message: safeRunErrorMessage(error, normalized),
    });
    return { completed: 0, failed: 1 };
  } finally {
    signal?.removeEventListener("abort", abortResources);
    if (context) await context.close().catch(() => undefined);
    unregisterContextResource?.();
    await device.close().catch(() => undefined);
    unregisterDeviceResource?.();
  }
}

async function verifyPoolProxyRouteInBrowser({
  page,
  proxyPoolService,
  routeCheckUrl,
  secrets = [],
  directIp: knownDirectIp,
}) {
  // Strict proxy mode: every route check runs inside the already proxy-configured browser.
  // Never use a host/direct request as a fallback. Each public-IP endpoint is checked on an
  // isolated temporary page when the browser context can provide one. This prevents Chrome's
  // chrome-error://chromewebdata/ navigation from a failed endpoint racing the next fallback.
  let directIp = knownDirectIp;
  try {
    if (!directIp && proxyPoolService?.getDirectIp)
      directIp = await proxyPoolService.getDirectIp();
  } catch {}
  const candidates = [
    ...new Set(
      [
        String(routeCheckUrl || "").trim(),
        ...PROXY_ROUTE_CHECK_FALLBACK_URLS,
      ].filter(Boolean),
    ),
  ];
  const failures = [];
  let context = null;
  try {
    context = typeof page?.context === "function" ? page.context() : null;
  } catch {}
  for (const url of candidates) {
    let routePage = page;
    let temporaryPage = null;
    try {
      if (context && typeof context.newPage === "function") {
        temporaryPage = await context.newPage();
        if (temporaryPage) routePage = temporaryPage;
      }
      const response = await routePage.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 7000,
      });
      if (response && typeof response.ok === "function" && !response.ok()) {
        throw new Error(`HTTP ${response.status()}`);
      }
      const proxiedIp = parseObservedIp(await routePage.textContent("body"));
      if (!proxiedIp) throw new Error("invalid IP response");
      return {
        directIp: directIp || undefined,
        proxiedIp,
        error: null,
        proxyOnly: true,
        routeCheckUrl: url,
        attempts: failures.length + 1,
      };
    } catch (cause) {
      const message = redactSecrets(
        cause instanceof Error ? cause.message : String(cause),
        secrets,
      ).split(/\r?\n/)[0];
      failures.push(`${url}: ${message}`);
    } finally {
      if (
        temporaryPage &&
        temporaryPage !== page &&
        typeof temporaryPage.close === "function"
      ) {
        await temporaryPage.close().catch(() => undefined);
      } else if (
        routePage === page &&
        typeof page?.waitForTimeout === "function"
      ) {
        // Mock/legacy contexts may not expose context.newPage(). Give Chrome's internal failed-
        // navigation cleanup a short bounded turn before the next fallback is attempted.
        await page.waitForTimeout(120).catch(() => undefined);
      }
    }
  }
  return {
    directIp: directIp || undefined,
    proxiedIp: undefined,
    error: `All proxy-only route checks failed (${failures.length}): ${failures.join(" | ")}`,
    proxyOnly: true,
    attempts: failures.length,
  };
}

function recordProxyIpObservation({
  proxyIpHistory,
  runId,
  workId,
  proxySource,
  poolAllocation,
  runtimeProxy,
  observation,
  phase,
}) {
  const observedIp = String(observation?.proxiedIp || "").trim();
  if (!isPublicObservedIp(observedIp)) return false;
  return (
    proxyIpHistory?.observe?.({
      runId,
      workId,
      observedAt: new Date().toISOString(),
      proxySource: proxySource || "unknown",
      proxyId: poolAllocation?.proxyId,
      proxyKind: poolAllocation?.proxyKind || proxySource,
      proxyEndpointKey: sanitizeProxyEndpoint(runtimeProxy?.server),
      observedIp,
      countryCode: poolAllocation?.countryCode,
      phase,
    }) === true
  );
}

async function waitForSessionDeadline({ lifetime, resolver, log = () => {} }) {
  while (true) {
    if (lifetime.reason) return lifetime.reason;
    if (resolver && typeof resolver.resolveLoop === "function") {
      try {
        const result = await resolver.resolveLoop(3);
        if (result?.outcome === "human-verification-blocked") {
          log(
            "Human verification blocks automated QA; waiting for the session timer without interacting with the challenge",
          );
        }
      } catch {
        // The page may disappear exactly when the global context timer closes.
      }
    }
    if (lifetime.reason) return lifetime.reason;
    const remaining = Math.max(0, lifetime.remainingMs?.() || 0);
    if (remaining <= 0) return lifetime.waitUntilClosed();
    const tickMs = Math.min(1000, remaining);
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ kind: "tick" }), tickMs);
      lifetime.waitUntilClosed().then((reason) => {
        clearTimeout(timer);
        resolve({ kind: "closed", reason });
      });
    });
    if (result.kind === "closed") return result.reason;
  }
}

function withInteractionRouteCheck(
  report,
  routeObservation,
  routeAssessment,
  strictMode,
) {
  const failed =
    routeAssessment.route.status === "fail" ||
    routeAssessment.fallback.status === "fail";
  const interactionCheck = {
    key: "interaction-route",
    label: "Interaction route verification",
    status: failed ? "fail" : "pass",
    required: true,
    expected: "Proxy route maintained after behavior steps",
    observed: routeObservation?.proxiedIp || "unknown",
    detail: failed
      ? "The browser route could not be verified after the behavior steps, or it matched the direct route."
      : "The browser remained on a verified proxy route after the behavior steps.",
  };
  const checks = [
    ...(report?.checks || []).filter(
      (check) => check.key !== "interaction-route",
    ),
    interactionCheck,
  ];
  const blockingReasons = failed
    ? [...new Set([...(report?.blockingReasons || []), interactionCheck.label])]
    : [...(report?.blockingReasons || [])];
  const blocked = Boolean(report?.blocked) || (strictMode && failed);
  const overall = failed ? "fail" : report?.overall || "pass";
  return {
    ...report,
    overall,
    blocked,
    blockingReasons,
    checks,
    observed: {
      ...(report?.observed || {}),
      finalProxiedIp: routeObservation?.proxiedIp,
    },
  };
}

function emitPrivacyRouteIntegrity({
  pushWork,
  phase,
  deviceMode,
  strictMode,
  proxySource,
  proxyRequired,
  initialRoute,
  finalRoute,
  initialRouteAssessment,
  finalRouteAssessment,
  privacyReport,
  runtimeVerification,
  runtimeLabel,
  identityReport,
}) {
  const report = buildPrivacyRouteIntegrityReport({
    phase,
    deviceMode,
    strictMode,
    proxySource,
    proxyRequired,
    initialRoute,
    finalRoute,
    initialRouteAssessment,
    finalRouteAssessment,
    privacyReport,
    runtimeVerification,
    runtimeLabel,
    identityReport,
    observedAt: new Date().toISOString(),
  });
  pushWork({
    type: "privacy-route-integrity",
    message:
      report.overallStatus === "fail"
        ? "Privacy & Route Integrity failed"
        : report.overallStatus === "not-verified"
          ? "Privacy & Route Integrity could not be fully verified"
          : "Privacy & Route Integrity passed",
    privacyRouteIntegrity: report,
  });
  return report;
}

function privacyRouteFailureSummary(report) {
  const labels = (report?.checks || [])
    .filter((item) => item.status === "fail" || item.status === "not-verified")
    .map((item) => item.label);
  return labels.length > 0
    ? labels.join(", ")
    : report?.overallStatus || "privacy route integrity failure";
}

async function emitSessionIntegrityReport({
  screenshotDir,
  workId,
  pushWork,
  proxySource,
  proxyRequired,
  initialRoute,
  finalRoute,
  privacyReport,
  identityReport,
}) {
  const report = buildSessionIntegrityReport({
    proxySource,
    proxyRequired,
    initialRoute,
    finalRoute,
    privacyReport,
    identityReport,
  });
  const safeWorkId = String(workId || "work-unit").replace(
    /[^a-zA-Z0-9._-]+/g,
    "-",
  );
  const integrityPath = path.join(
    screenshotDir,
    `${safeWorkId}-session-integrity.json`,
  );
  await fs.writeFile(integrityPath, JSON.stringify(report, null, 2), "utf8");
  pushWork({
    type: "session-integrity",
    message: report.blocked
      ? "Session & Network Integrity blocked this work unit"
      : report.overall === "warning"
        ? "Session & Network Integrity completed with warnings"
        : "Session & Network Integrity verified",
    sessionIntegrity: report,
    integrityPath,
  });
  return report;
}

function workUnitDeviceLabel(unit) {
  if (unit.executionKind === "desktop") return "Desktop";
  if (unit.executionKind === "android-emulation")
    return unit.deviceProfile || "Android mobile";
  if (unit.executionKind === "android-avd")
    return `Android AVD ${unit.androidAvdName || ""}`.trim();
  if (unit.executionKind === "ios-emulation")
    return unit.deviceProfile || "iPhone / iPad compatibility";
  return `Real iOS ${unit.realIos?.device || ""}`.trim();
}

function workUnitBrowserLabel(unit) {
  const labels = {
    "chrome-installed": "Google Chrome",
    "brave-installed": "Brave",
    chromium: "Chromium",
    firefox: "Firefox",
    webkit: "WebKit",
    "chrome-android": "Chrome Android",
    "safari-ios": "Safari iOS",
    "chrome-ios": "Chrome iOS",
  };
  return labels[unit.browser] || String(unit.browser || "Browser");
}

async function findAndroidDeviceBySerial(playwright, serial) {
  if (!playwright?._android)
    throw new Error(
      "The installed browser runtime does not include Android automation support",
    );
  const devices = await playwright._android.devices();
  if (devices.length === 0)
    throw new Error(
      "No Android device is available through ADB. Open Device Profiles and launch an AVD first.",
    );
  const wanted = String(serial || "").trim();
  if (wanted) {
    const exact = devices.find((candidate) => {
      try {
        return (
          typeof candidate.serial === "function" &&
          candidate.serial() === wanted
        );
      } catch {
        return false;
      }
    });
    if (exact) return exact;
  }
  if (devices.length === 1) return devices[0];
  throw new Error(
    `${wanted ? `Android AVD ${wanted} is ready but the` : "The"} browser runtime could not identify its matching device connection among ${devices.length} attached devices`,
  );
}

async function executeAndroidAvdMatrixWorkUnit({
  runId,
  settings,
  workUnit,
  sessionId,
  normalized,
  playwright,
  androidService,
  signal,
  sessionLifetimeFactory,
  screenshotDir,
  pushWork,
  pacing,
  runResourceTracker = null,
  cookieStore = null,
}) {
  if (!androidService) throw new Error("Android service is unavailable");
  throwIfRunAborted(signal);
  pushWork({
    type: "log",
    message: `Preparing Android virtual device: ${settings.deviceName}`,
  });
  const launchInfo = await androidService.launchAvd(settings.deviceName);
  const serial = launchInfo?.serial;
  if (!serial)
    throw new Error(
      `Android virtual device ${settings.deviceName} did not return an ADB serial`,
    );
  const hardeningProfile = deviceHardening.findRealDeviceProfile(
    settings.deviceName,
  );
  const device = await findAndroidDeviceBySerial(playwright, serial);
  let context;
  let lifetime;
  let unregisterDeviceResource =
    runResourceTracker?.register?.(runId, {
      label: `android-avd-device:${serial}`,
      close: () => device.close?.(),
      forceClose: async () => {
        await device
          .shell?.("am force-stop com.android.chrome")
          .catch(() => undefined);
        await device.close?.().catch(() => undefined);
      },
    }) || null;
  let unregisterContextResource = null;
  let verificationCompleted = false;
  const abortResources = () => {
    if (lifetime) void lifetime.close("user-stop").catch(() => undefined);
    else if (context) void context.close().catch(() => undefined);
    void device.close?.().catch?.(() => undefined);
  };
  signal?.addEventListener("abort", abortResources, { once: true });
  try {
    throwIfRunAborted(signal);
    await device
      .shell?.("am force-stop com.android.chrome")
      .catch(() => undefined);
    // Hardened AVDs launch Chrome on the guest with the AutomationControlled blink
    // feature disabled. Non-hardened AVDs keep the original bare launch.
    context = await device.launchBrowser(
      hardeningProfile
        ? { args: deviceHardening.buildHardeningArgs(hardeningProfile) }
        : {},
    );
    if (
      workUnit.useCookies === true &&
      cookieStore?.pickAny &&
      typeof context.addCookies === "function"
    ) {
      const selectedCookie = cookieStore.pickAny();
      if (selectedCookie?.cookie) {
        await context.addCookies([selectedCookie.cookie]);
        pushWork({
          type: "log",
          message: `Cookie Manager: applied ${selectedCookie.label || selectedCookie.id} before target navigation`,
        });
      } else {
        pushWork({
          type: "log",
          message:
            "Cookie Manager: Use Cookie enabled, but no enabled non-expired cookie is available",
        });
      }
    }
    const trackedAvdContext = context;
    unregisterContextResource =
      runResourceTracker?.register?.(runId, {
        label: `android-avd-context:${serial}`,
        close: () => trackedAvdContext.close(),
        forceClose: async () => {
          await device
            .shell?.("am force-stop com.android.chrome")
            .catch(() => undefined);
          await trackedAvdContext.close?.().catch(() => undefined);
        },
      }) || null;
    lifetime = sessionLifetimeFactory({
      context,
      durationMs: settings.sessionDurationSeconds * 1000,
      signal,
    });
    lifetime.throwIfExpired?.();
    let page = await createPrivacyReadyPage(
      context,
      settings.privacy.strictMode,
    );
    // Register the hardening init script after the privacy guard so it wins the
    // last-write for navigator.webdriver, UA and WebGL. It applies to the next
    // navigation, which is the target load below.
    if (hardeningProfile)
      await deviceHardening.installDeviceHardening(context, hardeningProfile);
    page.setDefaultTimeout?.(10000);
    let resolver = createBlockingSurfaceResolver({
      page,
      lifetime,
      log: (message) => pushWork({ type: "log", message }),
    });
    const indicatorEnabled =
      normalized.interactionIndicator && !normalized.headless;
    const indicatorMode = "touch";
    const indicator = indicatorEnabled
      ? {
          move: moveInteractionIndicator,
          moveToPoint: moveInteractionIndicatorToPoint,
          pulse: pulseInteractionIndicator,
        }
      : null;
    if (indicatorEnabled)
      await installInteractionIndicator(page, { mode: indicatorMode });

    const navigationStarted = Date.now();
    const referrerResult = await navigateWithReferrerQa({
      page,
      targetUrl: workUnit.targetUrl,
      autoQa: settings.autoQa,
      executionMode: normalized.executionMode,
      timeoutMs: Math.min(
        30000,
        Math.max(500, lifetime.remainingMs?.() || 30000),
      ),
      interactionMode: indicatorMode,
      log: (message) => pushWork({ type: "log", message }),
    });
    if (referrerResult.page && referrerResult.page !== page) {
      page = referrerResult.page;
      resolver = createBlockingSurfaceResolver({
        page,
        lifetime,
        log: (message) => pushWork({ type: "log", message }),
      });
    }
    lifetime.throwIfExpired?.();
    if (indicatorEnabled)
      await installInteractionIndicator(page, { mode: indicatorMode });
    pushWork({
      type: "log",
      message: `Loaded ${settings.autoQa?.referrerMode === "site-referral" ? "referral destination" : "target"} on Android AVD in ${Date.now() - navigationStarted} ms`,
    });

    const proxyResult = assessProxyRoute({
      enabled: false,
      requireVerifiedRoute: false,
    });
    const privacyReport = await runNavigationResilientProbe(
      page,
      "Android AVD privacy diagnostics",
      pushWork,
      lifetime,
      () =>
        collectPrivacyReport({
          page,
          expected: expectedPrivacyProfile(settings, page, {}),
          proxyChecks: [proxyResult.route, proxyResult.fallback],
          strictMode: settings.privacy.strictMode,
          proxyRequired: false,
          webRtcPreventionApplied: false,
        }),
    );
    lifetime.throwIfExpired?.();
    pushWork({
      type: "privacy-diagnostics",
      message: privacyReport.blocked
        ? "Strict Privacy Mode blocked the session"
        : "Privacy diagnostics completed",
      privacyDiagnostics: privacyReport,
    });
    if (!shouldRunBehaviorSteps(privacyReport))
      throw new Error(
        `Strict Privacy Mode blocked the session: ${privacyReport.blockingReasons.join(", ")}`,
      );

    const identityObserved = await runNavigationResilientProbe(
      page,
      "Android AVD identity diagnostics",
      pushWork,
      lifetime,
      () => collectRuntimeIdentity(page),
    );
    const identityContext = {
      viewport: identityObserved.viewport,
      screen: identityObserved.screen,
      deviceScaleFactor: identityObserved.devicePixelRatio,
      hasTouch: true,
      ...(settings.locale ? { locale: settings.locale } : {}),
      ...(settings.timezoneId ? { timezoneId: settings.timezoneId } : {}),
    };
    const identityReport = assessDeviceConsistency(
      buildDeviceExpectation(settings, identityContext),
      identityObserved,
    );
    pushWork({
      type: "identity-diagnostics",
      message: identityReport.blocked
        ? "Device identity consistency blocked this Android AVD work unit"
        : identityReport.overall === "pass"
          ? "Android AVD identity consistency passed"
          : "Android AVD identity consistency found warnings",
      identityDiagnostics: identityReport,
    });
    if (identityReport.blocked)
      throw new Error(
        `Device identity consistency blocked this work unit: ${identityReport.blockingReasons.join(", ")}`,
      );

    if (hardeningProfile) {
      const hardeningReport = await runNavigationResilientProbe(
        page,
        "Android AVD device hardening diagnostics",
        pushWork,
        lifetime,
        () => deviceHardening.collectHardeningReport(page, hardeningProfile),
      );
      const failedChecks = hardeningReport.checks
        .filter((check) => !check.pass)
        .map((check) => check.id);
      pushWork({
        type: deviceHardening.HARDENING_EVENT,
        message: hardeningReport.passed
          ? "Device hardening passed all three checks (automation flag, runtime fingerprint, device identity)"
          : `Device hardening incomplete: ${failedChecks.join(", ")}`,
        deviceHardening: hardeningReport,
      });
    }

    await executeConfiguredBehavior({
      settings,
      normalized,
      page,
      context,
      workUnit,
      sessionId,
      screenshotDir,
      pushWork,
      lifetime,
      resolver,
      indicator,
      indicatorMode,
      pacing,
      signal,
    });

    verificationCompleted = true;
    pushWork({
      type: "log",
      message: `QA behavior complete; this Android AVD work unit remains open until its own ${settings.sessionDurationSeconds}s timer ends`,
    });
    const closedReason = await waitForSessionDeadline({
      lifetime,
      resolver,
      log: (message) => pushWork({ type: "log", message }),
    });
    if (closedReason === "user-stop" || signal?.aborted)
      throw createRunAbortError();
    return { verificationCompleted: true };
  } catch (error) {
    if (!verificationCompleted && lifetime?.reason === "duration-elapsed")
      error.orbitQaIncomplete = true;
    throw error;
  } finally {
    signal?.removeEventListener("abort", abortResources);
    if (lifetime && !lifetime.reason)
      await lifetime.close("cleanup").catch(() => undefined);
    else if (!lifetime && context) await context.close().catch(() => undefined);
    unregisterContextResource?.();
    await device.close?.().catch(() => undefined);
    unregisterDeviceResource?.();
    if (!launchInfo?.alreadyRunning)
      await androidService.stopAvd?.(serial).catch(() => undefined);
  }
}

function buildV3RunActivityMessages(normalized, workUnit = null) {
  if (Number(normalized?.version) !== 3) return { pool: null, assigned: null };
  const valid = Array.isArray(normalized.urlPool)
    ? normalized.urlPool.length
    : Number(normalized?.urlPoolStats?.valid || 0);
  const duplicates = Number(
    normalized.duplicateUrlCount ?? normalized?.urlPoolStats?.duplicates ?? 0,
  );
  const invalid = Number(
    normalized.invalidUrlCount ?? normalized?.urlPoolStats?.invalid ?? 0,
  );
  return {
    pool: `URL pool: ${valid} valid · ${Math.max(0, duplicates)} duplicates removed · ${Math.max(0, invalid)} invalid`,
    assigned: workUnit?.targetUrl
      ? `Assigned shuffled URL: ${workUnit.targetUrl}`
      : null,
  };
}

function* filterWorkUnitsForCheckpoint(source, checkpoint) {
  const terminalWorkIds = new Set(
    Array.isArray(checkpoint?.terminalWorkIds)
      ? checkpoint.terminalWorkIds
      : [],
  );
  for (const unit of source) {
    if (!terminalWorkIds.has(unit.workId)) yield unit;
  }
}

async function executeMatrixQaRun({
  runId,
  normalized,
  screenshotsRoot,
  emit,
  androidService,
  realIosService,
  proxyPoolService,
  proxyIpHistory,
  cookieStore = null,
  playwrightImpl,
  signal,
  sessionLifetimeFactory,
  globalRunScheduler,
  checkpoint,
  runResourceTracker = null,
  chromeRuntimeResolver = resolveInstalledChrome,
}) {
  throwIfRunAborted(signal);
  const push = createEmitter(emit, runId);
  const startedAt = Date.now();
  const screenshotDir = path.join(screenshotsRoot, runId);
  await fs.mkdir(screenshotDir, { recursive: true });
  const playwright = playwrightImpl || require("playwright");
  const launchGate = createLaunchGate(
    startupParallelismForConcurrency(normalized.concurrency),
  );
  const requestedWorkUnits =
    normalized.version === 3
      ? countWorkUnitsV3(normalized)
      : countWorkUnits(normalized);
  const baseWorkUnitSource =
    normalized.version === 3
      ? iterateWorkUnitsV3(normalized)
      : iterateWorkUnits(normalized);
  const terminalCount = new Set(
    Array.isArray(checkpoint?.terminalWorkIds)
      ? checkpoint.terminalWorkIds
      : [],
  ).size;
  const workUnitSource = filterWorkUnitsForCheckpoint(
    baseWorkUnitSource,
    checkpoint,
  );
  const pendingWorkUnits = Math.max(0, requestedWorkUnits - terminalCount);
  let completed = 0;
  let failed = 0;
  let incomplete = 0;
  let cancelled = 0;
  push({
    type: "run-start",
    message: `Starting ${requestedWorkUnits} matrix work unit(s)`,
    summary: {
      total: requestedWorkUnits,
      requested: requestedWorkUnits,
      running: 0,
      queued: requestedWorkUnits,
      completed: 0,
      failed: 0,
      cancelled: 0,
      incomplete: 0,
      durationMs: 0,
    },
  });
  if (normalized.version === 3) {
    const activity = buildV3RunActivityMessages(normalized);
    if (activity.pool) push({ type: "log", message: activity.pool });
  }

  const queueMetrics = await runWorkUnitQueue(
    workUnitSource,
    {
      requestedCount: pendingWorkUnits,
      concurrency: normalized.concurrency,
      onMetrics: (metrics) =>
        push({
          type: "run-metrics",
          message: "Run queue metrics updated",
          metrics,
        }),
      // One emulator process per AVD: work units that share an AVD name serialise,
      // different AVD names run in parallel. This is what lets a 20-AVD fleet run
      // 20 concurrent Android sessions.
      exclusivityKey: (unit) =>
        unit.executionKind === "android-avd"
          ? `avd:${unit.androidAvdName}`
          : null,
    },
    async (workUnit, queueIndex) => {
      const settings = settingsForWorkUnit(normalized, workUnit);
      const sessionId = queueIndex + 1;
      const deviceLabel = workUnitDeviceLabel(workUnit);
      const browserLabel = workUnitBrowserLabel(workUnit);
      const pushWork = (event) =>
        push({
          ...event,
          sessionId,
          workId: workUnit.workId,
          targetId: workUnit.targetId,
          groupId: workUnit.groupId,
          targetUrl: workUnit.targetUrl,
          instanceIndex: workUnit.instanceIndex,
          deviceLabel,
          browserLabel,
        });
      const pacing = createQaPacing(workUnit.workId, {
        deviceMode: settings.deviceMode,
      });
      let browser;
      let context;
      let unregisterBrowserResource = null;
      let unregisterContextResource = null;
      let lifetime;
      let resolver;
      let poolAllocation = null;
      let selectedPoolKind = null;
      let effectiveProxySource = settings.proxySource;
      let runtimeProxy = settings.privacy.proxy;
      let runtimeProxyObservation = null;
      let initialProxyObservation = null;
      let proxyRuntimeSuspect = false;
      let verificationCompleted = false;
      let currentRuntimeVerification = null;
      let outcomeRecorded = false;
      const abortResources = () => {
        if (lifetime) void lifetime.close("user-stop").catch(() => undefined);
        else if (context) void context.close().catch(() => undefined);
        if (browser) void browser.close().catch(() => undefined);
      };
      signal?.addEventListener("abort", abortResources, { once: true });
      try {
        throwIfRunAborted(signal);
        if (normalized.version === 3) {
          const activity = buildV3RunActivityMessages(normalized, workUnit);
          if (activity.assigned)
            pushWork({ type: "log", message: activity.assigned });
        }
        pushWork({
          type: "session-start",
          status: "running",
          message: `${new URL(workUnit.targetUrl).hostname} · ${deviceLabel} · #${workUnit.instanceIndex + 1} started`,
        });

        if (settings.deviceMode === "android") {
          const runtimeVerification = verifyBrowserRuntime({
            runtimeKind: "android-chrome",
            deviceMode: "android-avd",
            packageName: "com.android.chrome",
          });
          pushWork({
            type: "runtime-verification",
            message: `Browser runtime verified: ${runtimeVerification.verificationLabel}`,
            runtimeVerification,
          });
          emitPrivacyRouteIntegrity({
            pushWork,
            phase: "pre-behavior",
            deviceMode: "android-avd",
            strictMode: settings.privacy.strictMode,
            proxySource: "none",
            proxyRequired: false,
            initialRoute: null,
            finalRoute: null,
            initialRouteAssessment: null,
            finalRouteAssessment: null,
            privacyReport: null,
            runtimeVerification,
            runtimeLabel: runtimeVerification.verificationLabel,
            identityReport: null,
          });
          const avdResult = await executeAndroidAvdMatrixWorkUnit({
            runId,
            settings,
            workUnit,
            sessionId,
            normalized,
            playwright,
            androidService,
            signal,
            sessionLifetimeFactory,
            screenshotDir,
            pushWork,
            pacing,
            runResourceTracker,
            cookieStore,
          });
          verificationCompleted = avdResult.verificationCompleted === true;
          completed += 1;
          outcomeRecorded = true;
          pushWork({
            type: "session-complete",
            status: "completed",
            message: `${new URL(workUnit.targetUrl).hostname} · ${deviceLabel} · #${workUnit.instanceIndex + 1} completed`,
          });
          return { status: "completed" };
        }
        if (settings.deviceMode === "real-ios") {
          if (!realIosService?.runWorkUnit)
            throw new Error("Real iOS provider service is unavailable");
          const runtimeVerification = verifyBrowserRuntime({
            runtimeKind: "real-ios-provider",
            deviceMode: "real-ios",
            browserFamily:
              workUnit.realIos?.browser === "chrome"
                ? "Chrome on Real iOS Provider"
                : "Safari on Real iOS Provider",
          });
          pushWork({
            type: "runtime-verification",
            message: `Browser runtime verified: ${runtimeVerification.verificationLabel}`,
            runtimeVerification,
          });
          emitPrivacyRouteIntegrity({
            pushWork,
            phase: "pre-behavior",
            deviceMode: "real-ios",
            strictMode: settings.privacy.strictMode,
            proxySource: "none",
            proxyRequired: false,
            initialRoute: null,
            finalRoute: null,
            initialRouteAssessment: null,
            finalRouteAssessment: null,
            privacyReport: null,
            runtimeVerification,
            runtimeLabel: runtimeVerification.verificationLabel,
            identityReport: null,
          });
          if (settings.autoQa?.behaviorMode === "auto")
            pushWork({
              type: "log",
              message:
                "AUTO QA adaptive DOM behavior is not available through the current Real iOS provider adapter; running provider observation only",
            });
          await realIosService.runWorkUnit({
            runId,
            workUnit,
            steps:
              settings.autoQa?.behaviorMode === "manual"
                ? normalized.steps
                : [],
            push: pushWork,
            screenshotsRoot,
            captureScreenshots: normalized.captureScreenshots !== false,
            signal,
          });
          verificationCompleted = true;
          completed += 1;
          outcomeRecorded = true;
          pushWork({
            type: "session-complete",
            status: "completed",
            message: `${new URL(workUnit.targetUrl).hostname} · ${deviceLabel} · #${workUnit.instanceIndex + 1} completed`,
          });
          return { status: "completed" };
        }

        const runtimeLaunch = resolveBrowserRuntimeLaunch({
          settings,
          playwright,
          chromeRuntimeResolver,
        });
        const launcher = runtimeLaunch.launcher;
        const browserEngine = runtimeLaunch.browserEngine;
        let contextOptions;
        if (settings.deviceMode === "ios-emulation") {
          contextOptions = resolveIosContextOptions(playwright, settings);
        } else if (settings.deviceMode === "android-emulation") {
          contextOptions = resolveAndroidEmulationContextOptions(
            playwright,
            settings,
          );
        } else {
          contextOptions = { permissions: [] };
          if (settings.locale) contextOptions.locale = settings.locale;
          if (settings.timezoneId)
            contextOptions.timezoneId = settings.timezoneId;
        }
        if (!launcher)
          throw new Error(`Browser engine unavailable: ${settings.browser}`);
        const baseContextOptions = {
          ...contextOptions,
          extraHTTPHeaders: { ...(contextOptions.extraHTTPHeaders || {}) },
        };

        const indicatorEnabled =
          normalized.interactionIndicator && !normalized.headless;
        const indicatorMode = indicatorModeForExecutionKind(
          workUnit.executionKind,
        );
        const indicator = indicatorEnabled
          ? {
              move: moveInteractionIndicator,
              moveToPoint: moveInteractionIndicatorToPoint,
              pulse: pulseInteractionIndicator,
            }
          : null;
        let page;
        let activeWorkerGeo = null;
        let activeContextValidation = null;
        let emulationHardening = null;

        const cleanupBrowserAttempt = async (reason = "retry-cleanup") => {
          if (lifetime && !lifetime.reason)
            await lifetime.close(reason).catch(() => undefined);
          else if (!lifetime && context)
            await context.close().catch(() => undefined);
          if (browser) await browser.close().catch(() => undefined);
          unregisterContextResource?.();
          unregisterContextResource = null;
          unregisterBrowserResource?.();
          unregisterBrowserResource = null;
          if (poolAllocation && proxyPoolService)
            await proxyPoolService
              .release(poolAllocation.allocationId)
              .catch(() => undefined);
          browser = null;
          context = null;
          lifetime = null;
          resolver = null;
          page = null;
          poolAllocation = null;
          runtimeProxy = settings.privacy.proxy;
          runtimeProxyObservation = null;
          initialProxyObservation = null;
          emulationHardening = null;
        };

        const webRtcLaunchPolicy = buildWebRtcLaunchPolicy({
          strictMode: settings.privacy.strictMode,
          browserEngine,
          headless: normalized.headless,
        });
        const baseDurationMs = settings.sessionDurationSeconds * 1000;
        const setupDurationMs = Math.max(
          120000,
          Math.min(300000, baseDurationMs * 3),
        );

        const openBrowserAttempt = async ({
          durationMs,
          allocationOwner,
          preflightAttempt = 1,
        }) => {
          if (
            ["rotating", "static", "smart-mix"].includes(settings.proxySource)
          ) {
            if (!proxyPoolService)
              throw new Error("Proxy pool service is unavailable");
            const requestedPoolSource =
              selectedPoolKind || settings.proxySource;
            poolAllocation = await proxyPoolService.allocate(
              requestedPoolSource,
              allocationOwner,
              {
                allowSlow: true,
                selectionPolicy: "healthy-random-cycle",
                rotationScope: "run:static",
              },
            );
            if (settings.proxySource === "smart-mix" && !selectedPoolKind) {
              selectedPoolKind = poolAllocation.proxyKind;
              if (!["rotating", "static"].includes(selectedPoolKind))
                throw new Error(
                  "Smart Mix proxy selection did not return a valid pool kind",
                );
              pushWork({
                type: "proxy-selection",
                message: `Smart Mix selected ${selectedPoolKind === "rotating" ? "Rotating Pool" : "Static Pool"} for this work unit`,
                selectedProxyKind: selectedPoolKind,
              });
            }
            effectiveProxySource =
              poolAllocation.proxyKind ||
              selectedPoolKind ||
              requestedPoolSource;
            runtimeProxy = {
              enabled: true,
              server: poolAllocation.server,
              username: poolAllocation.username || "",
              password: poolAllocation.password || "",
              requireVerifiedRoute: true,
              routeCheckUrl: settings.privacy.proxy.routeCheckUrl,
            };
          }

          const workerContextResolved = buildConsistentWorkerContext({
            profile: baseContextOptions,
            deviceMode: settings.deviceMode,
            browserEngine,
            allocation: runtimeProxy.enabled ? poolAllocation : null,
            fallbackLocale: settings.locale || baseContextOptions.locale || "",
            fallbackTimezoneId:
              settings.timezoneId || baseContextOptions.timezoneId || "",
            base: baseContextOptions,
            exposeProxyGeolocation: false,
          });
          contextOptions = workerContextResolved.options;
          const workerContextValidation = validateWorkerContext({
            profile: baseContextOptions,
            deviceMode: settings.deviceMode,
            contextOptions,
            allocation:
              runtimeProxy.enabled && poolAllocation?.geoVerified === true
                ? poolAllocation
                : null,
            compatibilityMode: settings.deviceMode === "ios-emulation",
          });
          activeWorkerGeo = workerContextResolved.geo;
          activeContextValidation = workerContextValidation;
          if (!workerContextValidation.ok)
            throw new Error(
              `Worker identity is inconsistent: ${workerContextValidation.issues.join(", ")}`,
            );
          pushWork({
            type: "identity-context",
            message: `Worker identity ${workerContextValidation.status.toUpperCase()} ...`,
            workerGeo: workerContextResolved.geo,
            contextValidation: workerContextValidation,
          });

          // Android mobile emulation runs on the host browser, so it needs the same
          // browser-layer hardening as an AVD.
          if (settings.deviceMode === "android-emulation") {
            emulationHardening = deviceHardening.prepareHardening({
              deviceMode: settings.deviceMode,
              deviceName: settings.deviceName,
              contextOptions,
            });
            if (emulationHardening.active)
              Object.assign(contextOptions, emulationHardening.contextOptions);
          }

          // NOTE: the browser has not been launched yet at this point, so the context
          // is created inside the launch gate below, immediately after browser launch.

          const proxyContainmentPolicy = buildProxyContainmentLaunchPolicy({
            proxyRequired: Boolean(runtimeProxy.enabled),
            browserEngine,
            proxyServer: runtimeProxy.server,
          });
          const performancePolicy = buildRuntimePerformanceLaunchPolicy({
            browserEngine,
          });
          // Playwright only honours `args` on launch(), never on newContext(), so the
          // hardening switches have to be merged into the launch options explicitly.
          const hardeningLaunchArgs = emulationHardening?.active
            ? deviceHardening.buildHardeningArgs(emulationHardening.profile)
            : [];
          const launchOptions = { headless: normalized.headless };
          if (
            browserEngine === "chromium" &&
            settings.browserRuntimeConsistency === true
          )
            launchOptions.chromiumSandbox = true;
          if (runtimeLaunch.executablePath)
            launchOptions.executablePath = runtimeLaunch.executablePath;
          if (
            webRtcLaunchPolicy.args.length > 0 ||
            proxyContainmentPolicy.args.length > 0 ||
            performancePolicy.args.length > 0 ||
            hardeningLaunchArgs.length > 0 ||
            (normalized.executionMode === "background" &&
              browserEngine === "chromium")
          )
            launchOptions.args = mergeLaunchArgs(
              webRtcLaunchPolicy.args,
              proxyContainmentPolicy.args,
              performancePolicy.args,
              hardeningLaunchArgs,
              normalized.executionMode === "background" &&
                browserEngine === "chromium"
                ? [
                    "--start-minimized",
                    ...backgroundWindowArgs({
                      browserEngine,
                      executionMode: normalized.executionMode,
                    }),
                  ]
                : [],
            );
          if (runtimeProxy.enabled) {
            launchOptions.proxy = {
              server: runtimeProxy.server,
              username: runtimeProxy.username || undefined,
              password: runtimeProxy.password || undefined,
            };
          }
          const releaseGlobalLaunch = globalRunScheduler
            ? await globalRunScheduler.requestLaunch(runId, signal)
            : () => {};
          try {
            await launchGate.run(async () => {
              browser = await launchBrowserWithAbort(
                launcher,
                launchOptions,
                signal,
              );
              currentRuntimeVerification = verifyBrowserRuntime({
                runtimeKind: runtimeLaunch.runtimeKind,
                deviceMode: settings.deviceMode,
                executablePath: runtimeLaunch.executablePath,
                browserVersion:
                  typeof browser?.version === "function"
                    ? browser.version()
                    : undefined,
              });
              pushWork({
                type: "runtime-verification",
                message: `Browser runtime verified: ${currentRuntimeVerification.verificationLabel}${browserEngine === "chromium" && settings.browserRuntimeConsistency === true ? " · runtime consistency ON · Chromium sandbox ON" : ""}`,
                runtimeVerification: {
                  ...currentRuntimeVerification,
                  chromiumSandbox:
                    browserEngine === "chromium" &&
                    settings.browserRuntimeConsistency === true,
                  browserRuntimeConsistency:
                    settings.browserRuntimeConsistency === true,
                },
              });
              const trackedMatrixBrowser = browser;
              unregisterBrowserResource =
                runResourceTracker?.register?.(runId, {
                  label: `matrix-browser:${workUnit.workId}`,
                  close: () => trackedMatrixBrowser.close(),
                }) || null;
              if (
                settings.browserRuntimeConsistency === true &&
                browserEngine === "chromium" &&
                settings.deviceMode === "android-emulation" &&
                contextOptions?.userAgent
              ) {
                contextOptions.userAgent = alignAndroidUserAgentWithRuntime(
                  contextOptions.userAgent,
                  browser?.version?.(),
                );
              }
              context = await browser.newContext(contextOptions);
              // Register the hardening init script once the context exists and before the
              // first navigation, so it wins the last write for webdriver / UA / WebGL.
              if (emulationHardening?.active)
                await emulationHardening.afterCreate(context);
              if (
                workUnit.useCookies === true &&
                cookieStore?.pickAny &&
                typeof context.addCookies === "function"
              ) {
                const selectedCookie = cookieStore.pickAny();
                if (selectedCookie?.cookie) {
                  await context.addCookies([selectedCookie.cookie]);
                  pushWork({
                    type: "log",
                    message: `Cookie Manager: applied ${selectedCookie.label || selectedCookie.id} before target navigation`,
                  });
                } else {
                  pushWork({
                    type: "log",
                    message:
                      "Cookie Manager: Use Cookie enabled, but no enabled non-expired cookie is available",
                  });
                }
              }
              const trackedMatrixContext = context;
              unregisterContextResource =
                runResourceTracker?.register?.(runId, {
                  label: `matrix-context:${workUnit.workId}`,
                  close: () => trackedMatrixContext.close(),
                }) || null;
              lifetime = sessionLifetimeFactory({
                context,
                durationMs,
                signal,
              });
              lifetime.throwIfExpired?.();
              page = await createPrivacyReadyPage(
                context,
                settings.privacy.strictMode,
              );
              if (
                normalized.executionMode === "background" &&
                browserEngine === "chromium"
              )
                await concealBackgroundWorkerWindow({
                  page,
                  browserEngine,
                  executionMode: normalized.executionMode,
                  log: (message) => pushWork({ type: "log", message }),
                }).catch(() => undefined);
              page.setDefaultTimeout?.(10000);
              resolver = createBlockingSurfaceResolver({
                page,
                lifetime,
                log: (message) => pushWork({ type: "log", message }),
              });
              if (indicatorEnabled)
                await installInteractionIndicator(page, {
                  mode: indicatorMode,
                });
            }, signal);
          } finally {
            releaseGlobalLaunch();
          }

          if (runtimeProxy.enabled) {
            runtimeProxyObservation = await verifyPoolProxyRouteInBrowser({
              page,
              proxyPoolService: poolAllocation ? proxyPoolService : null,
              routeCheckUrl: runtimeProxy.routeCheckUrl,
              secrets: [runtimeProxy.username, runtimeProxy.password],
            });
            lifetime.throwIfExpired?.();
            initialProxyObservation = { ...runtimeProxyObservation };
            if (poolAllocation && runtimeProxyObservation?.proxiedIp) {
              const actualExitIp = String(
                runtimeProxyObservation.proxiedIp || "",
              ).trim();
              const verifiedExitIp = String(
                poolAllocation.observedIp || "",
              ).trim();
              if (
                (verifiedExitIp && verifiedExitIp !== actualExitIp) ||
                (!verifiedExitIp &&
                  browserEngine === "chromium" &&
                  typeof context?.newCDPSession === "function")
              ) {
                const timezoneSync = await synchronizeProxyTimezone({
                  context,
                  browserEngine,
                  proxiedIp: actualExitIp,
                  currentTimezoneId: contextOptions.timezoneId || "",
                });
                if (timezoneSync.status !== "PASS")
                  throw new Error(
                    `Proxy timezone consistency failed: ${timezoneSync.reason || "timezone mismatch"}`,
                  );
                contextOptions.timezoneId = timezoneSync.timezoneId;
                poolAllocation.timezoneId = timezoneSync.timezoneId;
                poolAllocation.observedIp = actualExitIp;
                Object.assign(poolAllocation, timezoneSync.geo || {});
                activeWorkerGeo = {
                  ...(activeWorkerGeo || {}),
                  ...(timezoneSync.geo || {}),
                  timezoneId: timezoneSync.timezoneId,
                };
                pushWork({
                  type: "identity-context",
                  message: `Proxy exit changed; timezone synchronized to ${timezoneSync.timezoneId} from exit IP ${actualExitIp}`,
                });
              }
            }
            recordProxyIpObservation({
              proxyIpHistory,
              runId,
              workId: workUnit.workId,
              proxySource: effectiveProxySource,
              poolAllocation,
              runtimeProxy,
              observation: runtimeProxyObservation,
              phase: preflightAttempt > 1 ? "retry" : "preflight",
            });
            const requireRoute =
              Boolean(poolAllocation) ||
              runtimeProxy.requireVerifiedRoute === true;
            const preflight = assessProxyRoute({
              enabled: true,
              requireVerifiedRoute: requireRoute,
              directIp: runtimeProxyObservation?.directIp,
              proxiedIp: runtimeProxyObservation?.proxiedIp,
              error: runtimeProxyObservation?.error,
            });
            const routeGateReport = emitPrivacyRouteIntegrity({
              pushWork,
              phase: "pre-navigation",
              deviceMode: settings.deviceMode,
              strictMode: settings.privacy.strictMode,
              proxySource: effectiveProxySource,
              proxyRequired: requireRoute,
              initialRoute: initialProxyObservation,
              finalRoute: null,
              initialRouteAssessment: preflight,
              finalRouteAssessment: null,
              privacyReport: null,
              runtimeVerification: currentRuntimeVerification,
              runtimeLabel: workUnitBrowserLabel(workUnit),
              identityReport: null,
            });
            const legacyRouteBlocked =
              requireRoute &&
              (preflight.route.status === "fail" ||
                preflight.fallback.status === "fail");
            if (legacyRouteBlocked) {
              proxyRuntimeSuspect = true;
              if (effectiveProxySource !== "rotating" || preflightAttempt > 1) {
                await emitSessionIntegrityReport({
                  screenshotDir,
                  workId: workUnit.workId,
                  pushWork,
                  proxySource: effectiveProxySource,
                  proxyRequired: true,
                  initialRoute: initialProxyObservation,
                  finalRoute: null,
                  privacyReport: null,
                  identityReport: null,
                });
              }
              throw new Error(
                runtimeProxyObservation?.error ||
                  "Proxy route verification failed inside the browser session",
              );
            }
            if (shouldBlockPrivacyRouteIntegrity(routeGateReport)) {
              proxyRuntimeSuspect = true;
              throw new Error(
                `PRIVACY ROUTE INTEGRITY FAILED: ${privacyRouteFailureSummary(routeGateReport)}`,
              );
            }
            pushWork({
              type: "log",
              message: `Observed browser exit route ${runtimeProxyObservation.proxiedIp || "unknown"} before target navigation`,
              proxyIp: runtimeProxyObservation.proxiedIp,
            });
          }
        };

        let preflightAttempt = 1;
        while (true) {
          try {
            await openBrowserAttempt({
              durationMs: setupDurationMs,
              allocationOwner:
                preflightAttempt === 1
                  ? `${runId}:${workUnit.workId}`
                  : `${runId}:${workUnit.workId}:preflight-retry-${preflightAttempt}`,
              preflightAttempt,
            });
            break;
          } catch (error) {
            const canRetryPreflight =
              effectiveProxySource === "rotating" &&
              preflightAttempt === 1 &&
              !signal?.aborted &&
              !lifetime?.expired;
            if (!canRetryPreflight) throw error;
            const safeMessage = safeRunErrorMessage(
              error,
              settings,
              runtimeProxy,
            );
            pushWork({
              type: "log",
              message:
                "Proxy route check failed on rotating route; retrying once with a fresh browser route",
            });
            pushWork({
              type: "log",
              message: `First proxy route check failed: ${safeMessage}`,
            });
            await cleanupBrowserAttempt("rotating-preflight-retry");
            preflightAttempt += 1;
            proxyRuntimeSuspect = false;
          }
        }

        let navigationAttempt = 1;
        while (true) {
          const navigationStarted = Date.now();
          try {
            const referrerResult = await navigateWithReferrerQa({
              page,
              targetUrl: workUnit.targetUrl,
              autoQa: settings.autoQa,
              executionMode: normalized.executionMode,
              timeoutMs: Math.min(
                30000,
                Math.max(500, lifetime.remainingMs?.() || 30000),
              ),
              interactionMode: indicatorMode,
              log: (message) => pushWork({ type: "log", message }),
            });
            if (referrerResult.page && referrerResult.page !== page) {
              page = referrerResult.page;
              resolver = createBlockingSurfaceResolver({
                page,
                lifetime,
                log: (message) => pushWork({ type: "log", message }),
              });
            }
            lifetime.throwIfExpired?.();
            if (indicatorEnabled)
              await installInteractionIndicator(page, { mode: indicatorMode });
            pushWork({
              type: "log",
              message: `Loaded ${settings.autoQa?.referrerMode === "site-referral" ? "referral destination" : "target"} in ${Date.now() - navigationStarted} ms`,
            });
            break;
          } catch (error) {
            const canRetry =
              effectiveProxySource === "rotating" &&
              navigationAttempt === 1 &&
              runtimeProxy.enabled &&
              isRetryableRotatingNavigationFailure(error, signal, lifetime);
            if (!canRetry) {
              if (effectiveProxySource === "rotating" && runtimeProxy.enabled)
                proxyRuntimeSuspect = true;
              throw error;
            }

            const failedExitIp =
              runtimeProxyObservation?.proxiedIp || "unknown";
            const retryMessage = safeRunErrorMessage(
              error,
              settings,
              runtimeProxy,
            );
            const retryDurationMs = Math.max(
              500,
              Number(lifetime.remainingMs?.() || setupDurationMs),
            );
            pushWork({
              type: "log",
              message: `Target navigation failed on rotating route ${failedExitIp}; retrying once with a fresh browser route`,
            });
            pushWork({
              type: "log",
              message: `First navigation attempt failed: ${retryMessage}`,
            });
            await cleanupBrowserAttempt("rotating-route-retry");
            navigationAttempt += 1;
            proxyRuntimeSuspect = false;
            await openBrowserAttempt({
              durationMs: retryDurationMs,
              allocationOwner: `${runId}:${workUnit.workId}:retry-${navigationAttempt}`,
              preflightAttempt,
            });
          }
        }

        const proxyResult = assessProxyRoute({
          enabled: runtimeProxy.enabled,
          requireVerifiedRoute: runtimeProxy.requireVerifiedRoute,
          directIp: runtimeProxyObservation?.directIp,
          proxiedIp: runtimeProxyObservation?.proxiedIp,
          error: runtimeProxyObservation?.error,
        });
        const proxyRequired =
          Boolean(poolAllocation) || runtimeProxy.requireVerifiedRoute === true;
        const privacyReport = await runNavigationResilientProbe(
          page,
          "privacy diagnostics",
          pushWork,
          lifetime,
          () =>
            collectPrivacyReport({
              page,
              expected: expectedPrivacyProfile(settings, page, contextOptions),
              proxyChecks: [proxyResult.route, proxyResult.fallback],
              strictMode: settings.privacy.strictMode,
              routeObservation: runtimeProxyObservation,
              proxyRequired,
              webRtcPreventionApplied: webRtcLaunchPolicy.preventionApplied,
            }),
        );
        lifetime.throwIfExpired?.();
        pushWork({
          type: "privacy-diagnostics",
          message: privacyReport.blocked
            ? "Strict Privacy Mode blocked the session"
            : "Privacy diagnostics completed",
          privacyDiagnostics: privacyReport,
        });
        const privacyGateIntegrity = emitPrivacyRouteIntegrity({
          pushWork,
          phase: "pre-behavior",
          deviceMode: settings.deviceMode,
          strictMode: settings.privacy.strictMode,
          proxySource: effectiveProxySource,
          proxyRequired,
          initialRoute: initialProxyObservation,
          finalRoute: null,
          initialRouteAssessment: proxyResult,
          finalRouteAssessment: null,
          privacyReport,
          runtimeVerification: currentRuntimeVerification,
          runtimeLabel: workUnitBrowserLabel(workUnit),
          identityReport: null,
        });
        if (!shouldRunBehaviorSteps(privacyReport)) {
          throw new Error(
            `Strict Privacy Mode blocked the session: ${privacyReport.blockingReasons.join(", ")}`,
          );
        }
        if (shouldBlockPrivacyRouteIntegrity(privacyGateIntegrity)) {
          if (runtimeProxy.enabled) proxyRuntimeSuspect = true;
          throw new Error(
            `PRIVACY ROUTE INTEGRITY FAILED: ${privacyRouteFailureSummary(privacyGateIntegrity)}`,
          );
        }

        const identityObserved = await runNavigationResilientProbe(
          page,
          "identity diagnostics",
          pushWork,
          lifetime,
          () => collectRuntimeIdentity(page),
        );
        const functionalIdentity =
          settings.deviceMode === "ios-emulation"
            ? { iosTap: await verifyFunctionalTap(page) }
            : {};
        const identityReport = assessDeviceConsistency(
          buildDeviceExpectation(settings, contextOptions),
          identityObserved,
          functionalIdentity,
        );
        identityReport.workerGeo = activeWorkerGeo;
        identityReport.contextValidation = activeContextValidation;
        pushWork({
          type: "identity-diagnostics",
          message: identityReport.blocked
            ? "Device identity consistency blocked this work unit"
            : identityReport.overall === "pass"
              ? "Device identity consistency passed"
              : "Device identity consistency found warnings",
          identityDiagnostics: identityReport,
        });
        if (emulationHardening?.active) {
          const hardeningReport = await runNavigationResilientProbe(
            page,
            "device hardening diagnostics",
            pushWork,
            lifetime,
            () =>
              deviceHardening.collectHardeningReport(
                page,
                emulationHardening.profile,
              ),
          );
          const failedChecks = hardeningReport.checks
            .filter((check) => !check.pass)
            .map((check) => check.id);
          pushWork({
            type: deviceHardening.HARDENING_EVENT,
            message: hardeningReport.passed
              ? "Device hardening passed all three checks (automation flag, runtime fingerprint, device identity)"
              : `Device hardening incomplete: ${failedChecks.join(", ")}`,
            deviceHardening: hardeningReport,
          });
        }
        const preBehaviorIntegrity = emitPrivacyRouteIntegrity({
          pushWork,
          phase: "pre-behavior",
          deviceMode: settings.deviceMode,
          strictMode: settings.privacy.strictMode,
          proxySource: effectiveProxySource,
          proxyRequired,
          initialRoute: initialProxyObservation,
          finalRoute: null,
          initialRouteAssessment: proxyResult,
          finalRouteAssessment: null,
          privacyReport,
          runtimeVerification: currentRuntimeVerification,
          runtimeLabel: workUnitBrowserLabel(workUnit),
          identityReport,
        });
        if (shouldBlockPrivacyRouteIntegrity(preBehaviorIntegrity)) {
          if (runtimeProxy.enabled) proxyRuntimeSuspect = true;
          throw new Error(
            `PRIVACY ROUTE INTEGRITY FAILED: ${privacyRouteFailureSummary(preBehaviorIntegrity)}`,
          );
        }
        if (identityReport.blocked)
          throw new Error(
            `Device identity consistency blocked this work unit: ${identityReport.blockingReasons.join(", ")}`,
          );

        if (settings.deviceMode === "ios-emulation") {
          const observed = await runNavigationResilientProbe(
            page,
            "Local iOS Compatibility diagnostics",
            pushWork,
            lifetime,
            () => collectIosObservedEnvironment(page),
          );
          const diagnostics = assessIosDiagnostics(
            expectedIosDiagnosticProfile(settings, contextOptions),
            observed,
          );
          pushWork({
            type: "ios-diagnostics",
            message:
              diagnostics.overall === "pass"
                ? "Local iOS Compatibility diagnostics passed"
                : "Local iOS Compatibility diagnostics found compatibility warnings",
            diagnostics,
          });
        }

        lifetime.beginActiveSession?.(baseDurationMs);
        pushWork({
          type: "log",
          message: `Active QA timer started: ${settings.sessionDurationSeconds}s (browser/proxy startup excluded)`,
        });
        await executeConfiguredBehavior({
          settings,
          normalized,
          page,
          context,
          workUnit,
          sessionId,
          screenshotDir,
          pushWork,
          lifetime,
          resolver,
          indicator,
          indicatorMode,
          pacing,
          signal,
        });
        await captureEvidenceScreenshot(page, {
          captureScreenshots: normalized.captureScreenshots !== false,
          screenshotDir,
          workId: workUnit.workId,
          sessionId,
          emit: pushWork,
        });
        const identityAfterBehavior = await collectRuntimeIdentity(page).catch(
          () => null,
        );
        if (identityAfterBehavior) {
          identityReport.graphicsStability = compareGraphicsStability(
            identityObserved,
            identityAfterBehavior,
          );
          pushWork({
            type: "graphics-stability",
            message:
              identityReport.graphicsStability.overall === "pass"
                ? "Canvas/WebGL remained stable for this worker"
                : "Canvas/WebGL changed during this worker session",
            graphicsStability: identityReport.graphicsStability,
          });
        }

        let finalPrivacyReport = privacyReport;
        let finalRouteObservation = runtimeProxyObservation;
        let postIntegrity = null;
        if (runtimeProxy.enabled) {
          let routePage = page;
          try {
            if (typeof context.newPage === "function")
              routePage = (await context.newPage()) || page;
            const observation = await verifyPoolProxyRouteInBrowser({
              page: routePage,
              proxyPoolService: poolAllocation ? proxyPoolService : null,
              routeCheckUrl: runtimeProxy.routeCheckUrl,
              secrets: [runtimeProxy.username, runtimeProxy.password],
              directIp: initialProxyObservation?.directIp,
            });
            recordProxyIpObservation({
              proxyIpHistory,
              runId,
              workId: workUnit.workId,
              proxySource: effectiveProxySource,
              poolAllocation,
              runtimeProxy,
              observation,
              phase: "post-behavior",
            });
            const requireRoute =
              Boolean(poolAllocation) ||
              runtimeProxy.requireVerifiedRoute === true;
            const assessment = assessProxyRoute({
              enabled: true,
              requireVerifiedRoute: requireRoute,
              directIp: observation?.directIp,
              proxiedIp: observation?.proxiedIp,
              error: observation?.error,
            });
            finalPrivacyReport = withInteractionRouteCheck(
              privacyReport,
              observation,
              assessment,
              settings.privacy.strictMode,
            );
            pushWork({
              type: "privacy-diagnostics",
              message:
                assessment.route.status === "pass" &&
                assessment.fallback.status === "pass"
                  ? "Interaction route verified after behavior steps"
                  : "Interaction route verification found a route problem after behavior steps",
              privacyDiagnostics: finalPrivacyReport,
            });
            postIntegrity = emitPrivacyRouteIntegrity({
              pushWork,
              phase: "post-behavior",
              deviceMode: settings.deviceMode,
              strictMode: settings.privacy.strictMode,
              proxySource: effectiveProxySource,
              proxyRequired: requireRoute,
              initialRoute: initialProxyObservation,
              finalRoute: observation,
              initialRouteAssessment: proxyResult,
              finalRouteAssessment: assessment,
              privacyReport: finalPrivacyReport,
              runtimeVerification: currentRuntimeVerification,
              runtimeLabel: workUnitBrowserLabel(workUnit),
              identityReport,
            });
            finalRouteObservation = observation;
            runtimeProxyObservation = observation;
            if (
              shouldBlockPrivacyRouteIntegrity(postIntegrity) &&
              runtimeProxy.enabled
            )
              proxyRuntimeSuspect = true;
            if (
              requireRoute &&
              (assessment.route.status === "fail" ||
                assessment.fallback.status === "fail")
            )
              proxyRuntimeSuspect = true;
            pushWork({
              type: "log",
              message: `Observed browser exit route ${observation.proxiedIp || "unknown"} after behavior steps`,
              proxyIp: observation.proxiedIp,
            });
          } finally {
            if (routePage !== page && typeof routePage?.close === "function")
              await routePage.close().catch(() => undefined);
          }
        }

        const sessionIntegrity = await emitSessionIntegrityReport({
          screenshotDir,
          workId: workUnit.workId,
          pushWork,
          proxySource: effectiveProxySource,
          proxyRequired:
            runtimeProxy.enabled &&
            (Boolean(poolAllocation) ||
              runtimeProxy.requireVerifiedRoute === true),
          initialRoute: initialProxyObservation,
          finalRoute: finalRouteObservation,
          privacyReport: finalPrivacyReport,
          identityReport,
        });
        if (sessionIntegrity.blocked) {
          if (runtimeProxy.enabled) proxyRuntimeSuspect = true;
          throw new Error(
            `Session & Network Integrity blocked this work unit: ${sessionIntegrity.blockingReasons.join(", ")}`,
          );
        }
        if (postIntegrity && shouldBlockPrivacyRouteIntegrity(postIntegrity)) {
          if (runtimeProxy.enabled) proxyRuntimeSuspect = true;
          throw new Error(
            `PRIVACY ROUTE INTEGRITY FAILED: ${privacyRouteFailureSummary(postIntegrity)}`,
          );
        }

        verificationCompleted = true;
        pushWork({
          type: "log",
          message: `QA behavior complete; this work unit remains open until its own ${settings.sessionDurationSeconds}s timer ends`,
        });
        const closedReason = await waitForSessionDeadline({
          lifetime,
          resolver,
          log: (message) => pushWork({ type: "log", message }),
        });
        if (closedReason === "user-stop" || signal?.aborted)
          throw createRunAbortError();
        completed += 1;
        outcomeRecorded = true;
        pushWork({
          type: "session-complete",
          status: "completed",
          message: `${new URL(workUnit.targetUrl).hostname} · ${deviceLabel} · #${workUnit.instanceIndex + 1} completed`,
        });
        return { status: "completed" };
      } catch (error) {
        if (
          signal?.aborted ||
          error?.name === "AbortError" ||
          lifetime?.reason === "user-stop"
        ) {
          cancelled += 1;
          outcomeRecorded = true;
          pushWork({
            type: "session-cancelled",
            status: "cancelled",
            message: `${deviceLabel} stopped by user`,
          });
          return { status: "cancelled" };
        } else if (
          !verificationCompleted &&
          (error?.name === "SessionExpiredError" ||
            lifetime?.reason === "duration-elapsed" ||
            lifetime?.expired)
        ) {
          incomplete += 1;
          outcomeRecorded = true;
          pushWork({
            type: "session-incomplete",
            status: "incomplete",
            message:
              "Work-unit timer elapsed before mandatory verification/behavior completed",
          });
          return { status: "incomplete" };
        } else {
          failed += 1;
          outcomeRecorded = true;
          const safeMessage = safeRunErrorMessage(
            error,
            settings,
            runtimeProxy,
          );
          if (poolAllocation && proxyRuntimeSuspect)
            await proxyPoolService
              ?.reportRuntimeFailure(poolAllocation.proxyId, safeMessage)
              .catch(() => undefined);
          pushWork({
            type: "session-error",
            status: "failed",
            message: safeMessage,
          });
          return { status: "failed" };
        }
      } finally {
        signal?.removeEventListener("abort", abortResources);
        if (lifetime && !lifetime.reason)
          await lifetime
            .close(outcomeRecorded ? "cleanup" : "cleanup-error")
            .catch(() => undefined);
        else if (!lifetime && context)
          await context.close().catch(() => undefined);
        if (browser) await browser.close().catch(() => undefined);
        unregisterContextResource?.();
        unregisterBrowserResource?.();
        if (poolAllocation && proxyPoolService)
          await proxyPoolService
            .release(poolAllocation.allocationId)
            .catch(() => undefined);
      }
    },
    signal,
  );

  if (signal?.aborted) throw createRunAbortError();
  const summary = {
    total: requestedWorkUnits,
    requested: requestedWorkUnits,
    running: 0,
    queued: 0,
    completed: queueMetrics.completed,
    failed: queueMetrics.failed,
    cancelled: queueMetrics.cancelled,
    incomplete: queueMetrics.incomplete,
    durationMs: Date.now() - startedAt,
  };
  push({ type: "run-complete", message: "QA run finished", summary });
  return summary;
}

async function executeQaRun({
  runId,
  request,
  screenshotsRoot,
  emit,
  androidService,
  realIosService,
  proxyPoolService,
  proxyIpHistory = null,
  cookieStore = null,
  playwrightImpl,
  signal,
  sessionLifetimeFactory = createSessionLifetimeController,
  globalRunScheduler = null,
  checkpoint = null,
  runResourceTracker = null,
}) {
  const normalized = normalizeQaRunRequest(request);
  throwIfRunAborted(signal);
  if (normalized.version === 2 || normalized.version === 3) {
    return executeMatrixQaRun({
      runId,
      normalized,
      screenshotsRoot,
      emit,
      androidService,
      realIosService,
      proxyPoolService,
      proxyIpHistory,
      cookieStore,
      playwrightImpl,
      signal,
      sessionLifetimeFactory,
      globalRunScheduler,
      checkpoint,
      runResourceTracker,
    });
  }
  const push = createEmitter(emit, runId);
  const startedAt = Date.now();
  const screenshotDir = path.join(screenshotsRoot, runId);
  await fs.mkdir(screenshotDir, { recursive: true });
  throwIfRunAborted(signal);

  const playwright = playwrightImpl || require("playwright");
  const workUnits =
    normalized.deviceMode === "android"
      ? [
          {
            workId: "target-1-run-1",
            targetIndex: 0,
            targetUrl: normalized.targetUrls[0],
            repetition: 1,
            sessionId: 1,
          },
        ]
      : buildWorkUnits(normalized.targetUrls, normalized.sessions);
  let completed = 0;
  let failed = 0;
  let incomplete = 0;

  let manualProxyObservation = null;

  const modeLabel =
    normalized.deviceMode === "android"
      ? `Android AVD ${normalized.deviceName}`
      : normalized.deviceMode === "ios-emulation"
        ? `${normalized.deviceName} ${normalized.iosBrowser === "chrome-ios" ? "Chrome iOS compatibility" : "Safari iOS compatibility"} QA`
        : normalized.browser;
  push({
    type: "run-start",
    message: `Starting ${workUnits.length} ${modeLabel} work unit(s)`,
  });

  if (normalized.deviceMode === "android") {
    const result = await executeAndroidRun({
      runId,
      normalized,
      push,
      screenshotDir,
      playwright,
      androidService,
      signal,
      runResourceTracker,
    });
    completed = result.completed;
    failed = result.failed;
  } else {
    const launcher =
      normalized.deviceMode === "ios-emulation"
        ? playwright.webkit
        : playwright[normalized.browser];
    if (!launcher)
      throw new Error(`Browser engine unavailable: ${normalized.browser}`);
    let contextOptions =
      normalized.deviceMode === "ios-emulation"
        ? resolveIosContextOptions(playwright, normalized)
        : { permissions: [] };
    if (normalized.locale) contextOptions.locale = normalized.locale;
    if (normalized.timezoneId)
      contextOptions.timezoneId = normalized.timezoneId;

    await runPool(
      workUnits,
      normalized.concurrency,
      async (workUnit) => {
        throwIfRunAborted(signal);
        const sessionId = workUnit.sessionId;
        const pushWork = (event) =>
          push({
            ...event,
            sessionId,
            workId: workUnit.workId,
            targetUrl: workUnit.targetUrl,
            repetition: workUnit.repetition,
          });
        const pacing = createQaPacing(workUnit.workId, {
          deviceMode: normalized.deviceMode,
        });
        let browser;
        let context;
        let unregisterBrowserResource = null;
        let unregisterContextResource = null;
        let lifetime;
        let resolver;
        let legacyIdentityBaseline = null;
        let legacyIdentityReport = null;
        let poolAllocation = null;
        let effectiveProxySource = normalized.proxySource;
        let runtimeProxy = normalized.privacy.proxy;
        let runtimeProxyObservation = manualProxyObservation;
        let initialProxyObservation = null;
        let proxyRuntimeSuspect = false;
        let closeImmediately = false;
        let verificationCompleted = false;
        let outcomeRecorded = false;
        const pages = new Set();
        const abortResources = () => {
          if (lifetime) void lifetime.close("user-stop").catch(() => undefined);
          else if (context) void context.close().catch(() => undefined);
          if (browser) void browser.close().catch(() => undefined);
        };
        signal?.addEventListener("abort", abortResources, { once: true });
        try {
          throwIfRunAborted(signal);
          pushWork({
            type: "session-start",
            status: "running",
            message: `${new URL(workUnit.targetUrl).hostname} · run ${workUnit.repetition} started`,
          });

          if (
            ["rotating", "static", "smart-mix"].includes(normalized.proxySource)
          ) {
            if (!proxyPoolService)
              throw new Error("Proxy pool service is unavailable");
            poolAllocation = await proxyPoolService.allocate(
              normalized.proxySource,
              `${runId}:${workUnit.workId}`,
              {
                allowSlow: true,
                selectionPolicy: "healthy-random-cycle",
                rotationScope: "run:static",
              },
            );
            effectiveProxySource =
              poolAllocation.proxyKind || normalized.proxySource;
            if (normalized.proxySource === "smart-mix") {
              if (!["rotating", "static"].includes(effectiveProxySource))
                throw new Error(
                  "Smart Mix proxy selection did not return a valid pool kind",
                );
              pushWork({
                type: "proxy-selection",
                message: `Smart Mix selected ${effectiveProxySource === "rotating" ? "Rotating Pool" : "Static Pool"} for this work unit`,
                selectedProxyKind: effectiveProxySource,
              });
            }
            runtimeProxy = {
              enabled: true,
              server: poolAllocation.server,
              username: poolAllocation.username || "",
              password: poolAllocation.password || "",
              requireVerifiedRoute: true,
              routeCheckUrl: normalized.privacy.proxy.routeCheckUrl,
            };
          }

          const legacyBrowserEngine =
            normalized.deviceMode === "ios-emulation"
              ? "webkit"
              : normalized.deviceMode === "android-emulation"
                ? "chromium"
                : normalized.browser;
          const webRtcLaunchPolicy = buildWebRtcLaunchPolicy({
            strictMode: normalized.privacy.strictMode,
            browserEngine: legacyBrowserEngine,
            headless: normalized.headless,
          });
          const legacyWorkerContextResolved = buildConsistentWorkerContext({
            profile: contextOptions,
            deviceMode: normalized.deviceMode,
            browserEngine: legacyBrowserEngine,
            allocation: runtimeProxy.enabled ? poolAllocation : null,
            fallbackLocale: contextOptions.locale || "",
            fallbackTimezoneId: contextOptions.timezoneId || "",
            base: contextOptions,
            exposeProxyGeolocation: false,
          });
          contextOptions = legacyWorkerContextResolved.options;
          const legacyContextValidation = validateWorkerContext({
            profile: contextOptions,
            deviceMode: normalized.deviceMode,
            contextOptions,
            allocation:
              runtimeProxy.enabled && poolAllocation?.geoVerified === true
                ? poolAllocation
                : null,
            compatibilityMode: normalized.deviceMode === "ios-emulation",
          });
          if (!legacyContextValidation.ok)
            throw new Error(
              `Worker identity is inconsistent: ${legacyContextValidation.issues.join(", ")}`,
            );
          const proxyContainmentPolicy = buildProxyContainmentLaunchPolicy({
            proxyRequired: Boolean(runtimeProxy.enabled),
            browserEngine: legacyBrowserEngine,
            proxyServer: runtimeProxy.server,
          });
          const performancePolicy = buildRuntimePerformanceLaunchPolicy({
            browserEngine: legacyBrowserEngine,
          });
          const launchOptions = { headless: normalized.headless };
          if (
            webRtcLaunchPolicy.args.length > 0 ||
            proxyContainmentPolicy.args.length > 0 ||
            performancePolicy.args.length > 0 ||
            (normalized.executionMode === "background" &&
              legacyBrowserEngine === "chromium")
          )
            launchOptions.args = mergeLaunchArgs(
              webRtcLaunchPolicy.args,
              proxyContainmentPolicy.args,
              performancePolicy.args,
              normalized.executionMode === "background" &&
                legacyBrowserEngine === "chromium"
                ? [
                    "--start-minimized",
                    ...backgroundWindowArgs({
                      browserEngine: legacyBrowserEngine,
                      executionMode: normalized.executionMode,
                    }),
                  ]
                : [],
            );
          if (runtimeProxy.enabled) {
            launchOptions.proxy = {
              server: runtimeProxy.server,
              username: runtimeProxy.username || undefined,
              password: runtimeProxy.password || undefined,
            };
          }
          try {
            browser = await launchBrowserWithAbort(
              launcher,
              launchOptions,
              signal,
            );
            const trackedLegacyBrowser = browser;
            unregisterBrowserResource =
              runResourceTracker?.register?.(runId, {
                label: "desktop-browser",
                close: () => trackedLegacyBrowser.close(),
              }) || null;
            throwIfRunAborted(signal);
          } catch (error) {
            if (poolAllocation) proxyRuntimeSuspect = true;
            throw error;
          }

          context = await browser.newContext(contextOptions);
          const trackedLegacyContext = context;
          unregisterContextResource =
            runResourceTracker?.register?.(runId, {
              label: "desktop-context",
              close: () => trackedLegacyContext.close(),
            }) || null;
          if (typeof context.on === "function") {
            context.on("page", (newPage) => pages.add(newPage));
          }
          if (typeof context.pages === "function") {
            for (const existingPage of context.pages()) pages.add(existingPage);
          }
          lifetime = sessionLifetimeFactory({
            context,
            durationMs: normalized.sessionDurationSeconds * 1000,
            signal,
          });
          throwIfRunAborted(signal);
          lifetime.throwIfExpired?.();

          const page = await createPrivacyReadyPage(
            context,
            normalized.privacy.strictMode,
          );
          if (
            normalized.executionMode === "background" &&
            legacyBrowserEngine === "chromium"
          )
            await concealBackgroundWorkerWindow({
              page,
              browserEngine: legacyBrowserEngine,
              executionMode: normalized.executionMode,
              log: (message) => pushWork({ type: "log", message }),
            }).catch(() => undefined);
          pages.add(page);
          throwIfRunAborted(signal);
          lifetime.throwIfExpired?.();
          page.setDefaultTimeout(10000);
          resolver = createBlockingSurfaceResolver({
            page,
            lifetime,
            log: (message) => pushWork({ type: "log", message }),
          });

          if (runtimeProxy.enabled) {
            runtimeProxyObservation = await verifyPoolProxyRouteInBrowser({
              page,
              proxyPoolService: poolAllocation ? proxyPoolService : null,
              routeCheckUrl: runtimeProxy.routeCheckUrl,
              secrets: [runtimeProxy.username, runtimeProxy.password],
            });
            lifetime.throwIfExpired?.();
            initialProxyObservation = { ...runtimeProxyObservation };
            if (poolAllocation && runtimeProxyObservation?.proxiedIp) {
              const actualExitIp = String(
                runtimeProxyObservation.proxiedIp || "",
              ).trim();
              const verifiedExitIp = String(
                poolAllocation.observedIp || "",
              ).trim();
              if (
                (verifiedExitIp && verifiedExitIp !== actualExitIp) ||
                (!verifiedExitIp &&
                  legacyBrowserEngine === "chromium" &&
                  typeof context?.newCDPSession === "function")
              ) {
                const timezoneSync = await synchronizeProxyTimezone({
                  context,
                  browserEngine: legacyBrowserEngine,
                  proxiedIp: actualExitIp,
                  currentTimezoneId: contextOptions.timezoneId || "",
                });
                if (timezoneSync.status !== "PASS")
                  throw new Error(
                    `Proxy timezone consistency failed: ${timezoneSync.reason || "timezone mismatch"}`,
                  );
                contextOptions.timezoneId = timezoneSync.timezoneId;
                poolAllocation.timezoneId = timezoneSync.timezoneId;
                poolAllocation.observedIp = actualExitIp;
                Object.assign(poolAllocation, timezoneSync.geo || {});
                pushWork({
                  type: "identity-context",
                  message: `Proxy exit changed; timezone synchronized to ${timezoneSync.timezoneId} from exit IP ${actualExitIp}`,
                });
              }
            }
            recordProxyIpObservation({
              proxyIpHistory,
              runId,
              workId: workUnit.workId,
              proxySource: effectiveProxySource,
              poolAllocation,
              runtimeProxy,
              observation: runtimeProxyObservation,
              phase: "preflight",
            });
            const requireRoute =
              Boolean(poolAllocation) ||
              runtimeProxy.requireVerifiedRoute === true;
            const preflight = assessProxyRoute({
              enabled: true,
              requireVerifiedRoute: requireRoute,
              directIp: runtimeProxyObservation?.directIp,
              proxiedIp: runtimeProxyObservation?.proxiedIp,
              error: runtimeProxyObservation?.error,
            });
            const legacyRouteGate = emitPrivacyRouteIntegrity({
              pushWork,
              phase: "pre-navigation",
              deviceMode: normalized.deviceMode,
              strictMode: normalized.privacy.strictMode,
              proxySource: effectiveProxySource,
              proxyRequired: requireRoute,
              initialRoute: initialProxyObservation,
              finalRoute: null,
              initialRouteAssessment: preflight,
              finalRouteAssessment: null,
              privacyReport: null,
              runtimeVerification: null,
              runtimeLabel: workUnitBrowserLabel(workUnit),
              identityReport: null,
            });
            const legacyRouteBlocked =
              requireRoute &&
              (preflight.route.status === "fail" ||
                preflight.fallback.status === "fail");
            if (legacyRouteBlocked) {
              proxyRuntimeSuspect = true;
              closeImmediately = true;
              await emitSessionIntegrityReport({
                screenshotDir,
                workId: workUnit.workId,
                pushWork,
                proxySource: effectiveProxySource,
                proxyRequired: true,
                initialRoute: initialProxyObservation,
                finalRoute: null,
                privacyReport: null,
                identityReport: null,
              });
              throw new Error(
                runtimeProxyObservation?.error ||
                  "Proxy route verification failed inside the browser session",
              );
            }
            if (shouldBlockPrivacyRouteIntegrity(legacyRouteGate)) {
              proxyRuntimeSuspect = true;
              closeImmediately = true;
              throw new Error(
                `PRIVACY ROUTE INTEGRITY FAILED: ${privacyRouteFailureSummary(legacyRouteGate)}`,
              );
            }
            pushWork({
              type: "log",
              message: `Observed browser exit route ${runtimeProxyObservation.proxiedIp || "unknown"} before target navigation`,
            });
          }

          const navigationStarted = Date.now();
          await page.goto(workUnit.targetUrl, {
            waitUntil: "domcontentloaded",
            timeout: Math.min(
              30000,
              Math.max(500, lifetime.remainingMs?.() || 30000),
            ),
          });
          throwIfRunAborted(signal);
          lifetime.throwIfExpired?.();
          pushWork({
            type: "log",
            message: `Loaded target in ${Date.now() - navigationStarted} ms`,
          });

          const proxyResult = assessProxyRoute({
            enabled: runtimeProxy.enabled,
            requireVerifiedRoute: runtimeProxy.requireVerifiedRoute,
            directIp: runtimeProxyObservation?.directIp,
            proxiedIp: runtimeProxyObservation?.proxiedIp,
            error: runtimeProxyObservation?.error,
          });
          const proxyRequired =
            Boolean(poolAllocation) ||
            runtimeProxy.requireVerifiedRoute === true;
          const privacyReport = await runNavigationResilientProbe(
            page,
            "privacy diagnostics",
            pushWork,
            lifetime,
            () =>
              collectPrivacyReport({
                page,
                expected: expectedPrivacyProfile(
                  normalized,
                  page,
                  contextOptions,
                ),
                proxyChecks: [proxyResult.route, proxyResult.fallback],
                strictMode: normalized.privacy.strictMode,
                routeObservation: runtimeProxyObservation,
                proxyRequired,
                webRtcPreventionApplied: webRtcLaunchPolicy.preventionApplied,
              }),
          );
          lifetime.throwIfExpired?.();
          pushWork({
            type: "privacy-diagnostics",
            message: privacyReport.blocked
              ? "Strict Privacy Mode blocked the session"
              : "Privacy diagnostics completed",
            privacyDiagnostics: privacyReport,
          });
          const legacyPrivacyGate = emitPrivacyRouteIntegrity({
            pushWork,
            phase: "pre-behavior",
            deviceMode: normalized.deviceMode,
            strictMode: normalized.privacy.strictMode,
            proxySource: effectiveProxySource,
            proxyRequired,
            initialRoute: initialProxyObservation,
            finalRoute: null,
            initialRouteAssessment: proxyResult,
            finalRouteAssessment: null,
            privacyReport,
            runtimeVerification: null,
            runtimeLabel: workUnitBrowserLabel(workUnit),
            identityReport: null,
          });
          if (!shouldRunBehaviorSteps(privacyReport)) {
            closeImmediately = true;
            throw new Error(
              `Strict Privacy Mode blocked the session: ${privacyReport.blockingReasons.join(", ")}`,
            );
          }
          if (shouldBlockPrivacyRouteIntegrity(legacyPrivacyGate)) {
            closeImmediately = true;
            if (runtimeProxy.enabled) proxyRuntimeSuspect = true;
            throw new Error(
              `PRIVACY ROUTE INTEGRITY FAILED: ${privacyRouteFailureSummary(legacyPrivacyGate)}`,
            );
          }

          legacyIdentityBaseline = await runNavigationResilientProbe(
            page,
            "identity diagnostics",
            pushWork,
            lifetime,
            () => collectRuntimeIdentity(page),
          );
          legacyIdentityReport = assessDeviceConsistency(
            buildDeviceExpectation(normalized, contextOptions),
            legacyIdentityBaseline,
          );
          pushWork({
            type: "identity-diagnostics",
            message: legacyIdentityReport.blocked
              ? "Device identity consistency blocked this work unit"
              : legacyIdentityReport.overall === "pass"
                ? "Device identity consistency passed"
                : "Device identity consistency found warnings",
            identityDiagnostics: legacyIdentityReport,
          });
          if (legacyIdentityReport.blocked)
            throw new Error(
              `Device identity consistency blocked this work unit: ${legacyIdentityReport.blockingReasons.join(", ")}`,
            );

          if (normalized.deviceMode === "ios-emulation") {
            const observed = await runNavigationResilientProbe(
              page,
              "Local iOS Compatibility diagnostics",
              pushWork,
              lifetime,
              () => collectIosObservedEnvironment(page),
            );
            lifetime.throwIfExpired?.();
            const diagnostics = assessIosDiagnostics(
              expectedIosDiagnosticProfile(normalized, contextOptions),
              observed,
            );
            pushWork({
              type: "ios-diagnostics",
              message:
                diagnostics.overall === "pass"
                  ? "Local iOS Compatibility diagnostics passed"
                  : "Local iOS Compatibility diagnostics found compatibility warnings",
              diagnostics,
            });
          }

          for (let index = 0; index < normalized.steps.length; index += 1) {
            const step = normalized.steps[index];
            pushWork({
              type: "step",
              stepId: step.id,
              message: `Running ${step.type} step`,
            });
            throwIfRunAborted(signal);
            lifetime.throwIfExpired?.();
            await executeStep(page, step, {
              sessionId,
              workId: workUnit.workId,
              stepNumber: index + 1,
              screenshotDir,
              emit: pushWork,
              lifetime,
              resolver,
              pacing,
            });
            throwIfRunAborted(signal);
            lifetime.throwIfExpired?.();
          }

          lifetime.throwIfExpired?.();
          let finalPrivacyReport = privacyReport;
          let finalRouteObservation = runtimeProxyObservation;
          let legacyPostIntegrity = null;
          if (runtimeProxy.enabled) {
            let routePage = page;
            try {
              if (typeof context.newPage === "function") {
                const candidateRoutePage = await context.newPage();
                if (candidateRoutePage) {
                  routePage = candidateRoutePage;
                  pages.add(candidateRoutePage);
                }
              }
              const interactionRouteObservation =
                await verifyPoolProxyRouteInBrowser({
                  page: routePage,
                  proxyPoolService: poolAllocation ? proxyPoolService : null,
                  routeCheckUrl: runtimeProxy.routeCheckUrl,
                  secrets: [runtimeProxy.username, runtimeProxy.password],
                  directIp: initialProxyObservation?.directIp,
                });
              lifetime.throwIfExpired?.();
              recordProxyIpObservation({
                proxyIpHistory,
                runId,
                workId: workUnit.workId,
                proxySource: effectiveProxySource,
                poolAllocation,
                runtimeProxy,
                observation: interactionRouteObservation,
                phase: "post-behavior",
              });
              const requireRoute =
                Boolean(poolAllocation) ||
                runtimeProxy.requireVerifiedRoute === true;
              const interactionRouteAssessment = assessProxyRoute({
                enabled: true,
                requireVerifiedRoute: requireRoute,
                directIp: interactionRouteObservation?.directIp,
                proxiedIp: interactionRouteObservation?.proxiedIp,
                error: interactionRouteObservation?.error,
              });
              finalPrivacyReport = withInteractionRouteCheck(
                privacyReport,
                interactionRouteObservation,
                interactionRouteAssessment,
                normalized.privacy.strictMode,
              );
              pushWork({
                type: "privacy-diagnostics",
                message:
                  interactionRouteAssessment.route.status === "pass" &&
                  interactionRouteAssessment.fallback.status === "pass"
                    ? "Interaction route verified after behavior steps"
                    : "Interaction route verification found a route problem after behavior steps",
                privacyDiagnostics: finalPrivacyReport,
              });
              legacyPostIntegrity = emitPrivacyRouteIntegrity({
                pushWork,
                phase: "post-behavior",
                deviceMode: normalized.deviceMode,
                strictMode: normalized.privacy.strictMode,
                proxySource: effectiveProxySource,
                proxyRequired: requireRoute,
                initialRoute: initialProxyObservation,
                finalRoute: interactionRouteObservation,
                initialRouteAssessment: proxyResult,
                finalRouteAssessment: interactionRouteAssessment,
                privacyReport: finalPrivacyReport,
                runtimeVerification: null,
                runtimeLabel: workUnitBrowserLabel(workUnit),
                identityReport: null,
              });
              finalRouteObservation = interactionRouteObservation;
              runtimeProxyObservation = interactionRouteObservation;
              if (shouldBlockPrivacyRouteIntegrity(legacyPostIntegrity))
                proxyRuntimeSuspect = true;
              if (
                requireRoute &&
                (interactionRouteAssessment.route.status === "fail" ||
                  interactionRouteAssessment.fallback.status === "fail")
              ) {
                proxyRuntimeSuspect = true;
                closeImmediately = true;
              }
              pushWork({
                type: "log",
                message: `Observed browser exit route ${interactionRouteObservation.proxiedIp || "unknown"} after behavior steps`,
              });
            } finally {
              if (
                routePage !== page &&
                typeof routePage?.close === "function"
              ) {
                await routePage.close().catch(() => undefined);
                pages.delete(routePage);
                if (typeof page?.bringToFront === "function")
                  await page.bringToFront().catch(() => undefined);
              }
            }
          }

          if (legacyIdentityBaseline && legacyIdentityReport) {
            const legacyIdentityCurrent = await collectRuntimeIdentity(
              page,
            ).catch(() => null);
            if (legacyIdentityCurrent) {
              legacyIdentityReport.graphicsStability = compareGraphicsStability(
                legacyIdentityBaseline,
                legacyIdentityCurrent,
              );
              pushWork({
                type: "graphics-stability",
                message:
                  legacyIdentityReport.graphicsStability.overall === "pass"
                    ? "Canvas/WebGL remained stable for this worker"
                    : "Canvas/WebGL changed during this worker session",
                graphicsStability: legacyIdentityReport.graphicsStability,
              });
            }
          }
          const sessionIntegrity = await emitSessionIntegrityReport({
            screenshotDir,
            workId: workUnit.workId,
            pushWork,
            proxySource: effectiveProxySource,
            proxyRequired:
              runtimeProxy.enabled &&
              (Boolean(poolAllocation) ||
                runtimeProxy.requireVerifiedRoute === true),
            initialRoute: initialProxyObservation,
            finalRoute: finalRouteObservation,
            privacyReport: finalPrivacyReport,
            identityReport: legacyIdentityReport,
          });
          if (sessionIntegrity.blocked) {
            if (runtimeProxy.enabled) proxyRuntimeSuspect = true;
            closeImmediately = true;
            throw new Error(
              `Session & Network Integrity blocked this work unit: ${sessionIntegrity.blockingReasons.join(", ")}`,
            );
          }
          if (
            legacyPostIntegrity &&
            shouldBlockPrivacyRouteIntegrity(legacyPostIntegrity)
          ) {
            proxyRuntimeSuspect = true;
            closeImmediately = true;
            throw new Error(
              `PRIVACY ROUTE INTEGRITY FAILED: ${privacyRouteFailureSummary(legacyPostIntegrity)}`,
            );
          }

          verificationCompleted = true;
          if (normalized.sessionDurationExplicit) {
            pushWork({
              type: "log",
              message: `QA behavior complete; browser remains open until the ${normalized.sessionDurationSeconds}s session timer ends`,
            });
            const closedReason = await waitForSessionDeadline({
              lifetime,
              resolver,
              log: (message) => pushWork({ type: "log", message }),
            });
            if (closedReason === "user-stop" || signal?.aborted)
              throw createRunAbortError();
          } else {
            await lifetime.close("legacy-complete");
          }

          completed += 1;
          outcomeRecorded = true;
          pushWork({
            type: "session-complete",
            status: "completed",
            message: `${new URL(workUnit.targetUrl).hostname} · run ${workUnit.repetition} completed`,
          });
        } catch (error) {
          if (
            signal?.aborted ||
            error?.name === "AbortError" ||
            lifetime?.reason === "user-stop"
          ) {
            pushWork({
              type: "session-cancelled",
              status: "cancelled",
              message: `${new URL(workUnit.targetUrl).hostname} · run ${workUnit.repetition} stopped by user`,
            });
          } else if (
            !verificationCompleted &&
            (error?.name === "SessionExpiredError" ||
              lifetime?.reason === "duration-elapsed" ||
              lifetime?.expired)
          ) {
            incomplete += 1;
            outcomeRecorded = true;
            pushWork({
              type: "session-incomplete",
              status: "incomplete",
              message:
                "Browser session duration elapsed before final route verification",
            });
          } else {
            failed += 1;
            outcomeRecorded = true;
            const safeMessage = safeRunErrorMessage(
              error,
              normalized,
              runtimeProxy,
            );
            if (poolAllocation && proxyRuntimeSuspect) {
              await proxyPoolService
                .reportRuntimeFailure(poolAllocation.proxyId, safeMessage)
                .catch(() => undefined);
            }
            pushWork({
              type: "session-error",
              status: "failed",
              message: safeMessage,
            });
          }
        } finally {
          signal?.removeEventListener("abort", abortResources);
          if (lifetime && !lifetime.reason) {
            if (
              normalized.sessionDurationExplicit &&
              !signal?.aborted &&
              !closeImmediately &&
              !proxyRuntimeSuspect
            ) {
              await waitForSessionDeadline({
                lifetime,
                resolver,
                log: (message) => pushWork({ type: "log", message }),
              }).catch(() => undefined);
            } else {
              await lifetime
                .close(outcomeRecorded ? "cleanup" : "cleanup-error")
                .catch(() => undefined);
            }
          } else if (!lifetime && context) {
            await context.close().catch(() => undefined);
          }
          if (browser) await browser.close().catch(() => undefined);
          unregisterContextResource?.();
          unregisterBrowserResource?.();
          if (poolAllocation && proxyPoolService)
            await proxyPoolService
              .release(poolAllocation.allocationId)
              .catch(() => undefined);
        }
      },
      signal,
    );
  }

  throwIfRunAborted(signal);
  const summary = {
    total: workUnits.length,
    completed,
    failed,
    incomplete,
    durationMs: Date.now() - startedAt,
  };
  push({ type: "run-complete", message: "QA run finished", summary });
  return summary;
}

module.exports = {
  normalizeQaRunRequest,
  normalizeMatrixRequest,
  normalizeMatrixV3Request,
  buildV3RunActivityMessages,
  normalizeAutoQaSettings,
  settingsForWorkUnit,
  resolveBrowserRuntimeLaunch,
  resolveAndroidEmulationContextOptions,
  chromiumMajorFromVersion,
  alignAndroidUserAgentWithRuntime,
  executeMatrixQaRun,
  filterWorkUnitsForCheckpoint,
  buildWorkUnits,
  resolveIosContextOptions,
  assessIosDiagnostics,
  runPool,
  shouldRunBehaviorSteps,
  createPrivacyReadyPage,
  executeStep,
  verifyPoolProxyRouteInBrowser,
  withInteractionRouteCheck,
  buildSessionIntegrityReport,
  emitPrivacyRouteIntegrity,
  privacyRouteFailureSummary,
  buildWebRtcLaunchPolicy,
  buildRuntimePerformanceLaunchPolicy,
  buildProxyContainmentLaunchPolicy,
  mergeLaunchArgs,
  startupParallelismForConcurrency,
  resolveRunHeadless,
  createLaunchGate,
  executeConfiguredBehavior,
  buildTargetNavigationOptions,
  executeQaRun,
  createRunAbortError,
  throwIfRunAborted,
};
