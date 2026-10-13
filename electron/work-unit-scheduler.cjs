function assertRequest(request) {
  if (!request || !Array.isArray(request.targets)) throw new Error('QA matrix targets are required');
}

function countWorkUnits(request) {
  assertRequest(request);
  return request.targets.reduce((total, target) => {
    const groups = Array.isArray(target.groups) ? target.groups : [];
    return total + groups.reduce((sum, group) => sum + Math.max(0, Number(group.instances) || 0), 0);
  }, 0);
}

function validateAvdRequest(request) {
  assertRequest(request);
  const seen = new Set();
  for (const target of request.targets) {
    const groups = Array.isArray(target.groups) ? target.groups : [];
    for (const group of groups) {
      if (group.executionKind !== 'android-avd') continue;
      const name = String(group.androidAvdName || '').trim();
      if (!name) continue;
      const instances = Math.max(0, Number(group.instances) || 0);
      if (instances > 1 || seen.has(name)) {
        throw new Error(`The same Android AVD cannot be used by multiple work units: ${name}`);
      }
      if (instances === 1) seen.add(name);
    }
  }
}

function browserRuntimeForWorkUnit(browser, executionKind, explicitRuntime) {
  if (executionKind === 'android-emulation') {
    return explicitRuntime === 'chrome-installed' ? 'chrome-installed' : 'chromium-playwright';
  }
  if (executionKind === 'android-avd') return 'android-chrome';
  if (executionKind === 'real-ios') return 'real-ios-provider';
  if (executionKind === 'ios-emulation') return browser === 'chrome-installed' ? 'chrome-installed' : 'webkit-playwright';
  if (browser === 'chrome-installed') return 'chrome-installed';
  if (browser === 'firefox') return 'firefox-playwright';
  if (browser === 'webkit') return 'webkit-playwright';
  return 'chromium-playwright';
}

function* iterateWorkUnits(request) {
  assertRequest(request);
  validateAvdRequest(request);
  for (let targetIndex = 0; targetIndex < request.targets.length; targetIndex += 1) {
    const target = request.targets[targetIndex];
    const groups = Array.isArray(target.groups) ? target.groups : [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      const instances = Math.max(0, Number(group.instances) || 0);
      for (let instanceIndex = 0; instanceIndex < instances; instanceIndex += 1) {
        yield Object.freeze({
          workId: `${target.id}-${group.id}-instance-${instanceIndex + 1}`,
          targetId: target.id,
          targetIndex,
          targetUrl: target.targetUrl,
          groupId: group.id,
          groupIndex,
          instanceIndex,
          executionKind: group.executionKind,
          browser: group.browser,
          browserRuntime: browserRuntimeForWorkUnit(group.browser, group.executionKind, group.browserRuntime),
          deviceProfile: group.deviceProfile,
          androidAvdName: group.androidAvdName,
          realIos: group.realIos,
          orientation: group.orientation,
          locale: group.locale,
          timezoneId: group.timezoneId,
          sessionDurationSeconds: group.sessionDurationSeconds,
          proxySource: group.proxySource,
          allowSlowProxies: group.allowSlowProxies === true,
        });
      }
    }
  }
}

function expandWorkUnits(request) {
  const units = Array.from(iterateWorkUnits(request));
  validateAvdConcurrency(units);
  return units;
}

function validateAvdConcurrency(units) {
  const seen = new Set();
  for (const unit of units || []) {
    if (unit.executionKind !== 'android-avd') continue;
    const name = String(unit.androidAvdName || '').trim();
    if (!name) continue;
    if (seen.has(name)) throw new Error(`The same Android AVD cannot be used by multiple work units: ${name}`);
    seen.add(name);
  }
}



function assertV3Request(request) {
  if (!request || Number(request.version) !== 3) throw new Error('QA v3 request is required');
  if (!Array.isArray(request.urlPool) || request.urlPool.length === 0) throw new Error('QA v3 URL pool is required');
  if (!request.devices || typeof request.devices !== 'object') throw new Error('QA v3 device matrix is required');
}

function countWorkUnitsV3(request) {
  assertV3Request(request);
  const devices = request.devices;
  let total = 0;
  if (devices.desktop?.enabled) total += (devices.desktop.browsers?.length || 0) * Math.max(0, Number(devices.desktop.instancesPerBrowser) || 0);
  if (devices.androidEmulation?.enabled) total += (devices.androidEmulation.profiles?.length || 0) * Math.max(0, Number(devices.androidEmulation.instancesPerProfile) || 0);
  if (devices.iosEmulation?.enabled) total += (devices.iosEmulation.browsers?.length || 0) * (devices.iosEmulation.profiles?.length || 0) * Math.max(0, Number(devices.iosEmulation.instancesPerProfile) || 0);
  if (devices.androidAvd?.enabled) total += devices.androidAvd.avdNames?.length || 0;
  if (devices.realIos?.enabled) total += devices.realIos.selections?.length || 0;
  return total;
}

function resolveV3ProxyPolicy(request, family, config) {
  if (family === 'android-avd' || family === 'real-ios') return { source: 'none', allowSlowProxies: false };
  const raw = request.proxyMode === 'per-device' ? config?.proxy : request.generalProxy;
  return {
    source: String(raw?.source || 'none'),
    allowSlowProxies: raw?.allowSlowProxies === true,
  };
}

function deviceSeedHash(value) {
  let h = 2166136261 >>> 0;
  for (const char of String(value ?? '')) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function deviceSeededRandom(seed) {
  let state = deviceSeedHash(seed) || 0x9e3779b9;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledDeviceFamilies(values, seed) {
  const random = deviceSeededRandom(seed);
  const copy = values.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function* iterateWorkUnitsV3(request) {
  assertV3Request(request);
  const { createUrlDeck } = require('./url-pool.cjs');
  const deck = createUrlDeck(request.urlPool, request.runSeed || '');
  const devices = request.devices;
  let workIndex = 0;
  let groupIndex = 0;

  const makeUnit = (details) => {
    const targetUrl = deck.next();
    const instanceIndex = details.instanceIndex || 0;
    workIndex += 1;
    return Object.freeze({
      workId: `pool-${details.groupId}-instance-${instanceIndex + 1}-work-${workIndex}`,
      targetId: 'url-pool',
      targetIndex: workIndex - 1,
      targetUrl,
      groupId: details.groupId,
      groupIndex: details.groupIndex,
      instanceIndex,
      executionKind: details.executionKind,
      browser: details.browser,
      browserRuntime: browserRuntimeForWorkUnit(details.browser, details.executionKind, details.browserRuntime),
      deviceProfile: details.deviceProfile,
      androidAvdName: details.androidAvdName,
      realIos: details.realIos,
      orientation: details.orientation,
      locale: details.locale,
      timezoneId: details.timezoneId,
      sessionDurationSeconds: details.sessionDurationSeconds,
      proxySource: details.proxy.source,
      allowSlowProxies: details.proxy.allowSlowProxies,
      useCookies: details.useCookies === true,
    });
  };

  const families = [];

  if (devices.desktop?.enabled) {
    const config = devices.desktop;
    const proxy = resolveV3ProxyPolicy(request, 'desktop', config);
    families.push({
      key:'desktop',
      iterator:(function* desktopUnits() {
        for (const browser of config.browsers || []) {
          const currentGroupIndex = groupIndex++;
          const groupId = `desktop-${browser}`;
          for (let instanceIndex = 0; instanceIndex < Math.max(0, Number(config.instancesPerBrowser) || 0); instanceIndex += 1) {
            yield makeUnit({ groupId, groupIndex:currentGroupIndex, instanceIndex, executionKind:'desktop', browser, sessionDurationSeconds:config.sessionDurationSeconds, proxy, useCookies:config.useCookies });
          }
        }
      })(),
    });
  }

  if (devices.androidEmulation?.enabled) {
    const config = devices.androidEmulation;
    const proxy = resolveV3ProxyPolicy(request, 'android-emulation', config);
    families.push({
      key:'android-emulation',
      iterator:(function* androidUnits() {
        for (const profile of config.profiles || []) {
          const currentGroupIndex = groupIndex++;
          const groupId = `android-emulation-${String(profile).replace(/\s+/g, '-').toLowerCase()}`;
          for (let instanceIndex = 0; instanceIndex < Math.max(0, Number(config.instancesPerProfile) || 0); instanceIndex += 1) {
            yield makeUnit({ groupId, groupIndex:currentGroupIndex, instanceIndex, executionKind:'android-emulation', browser:'chrome-android', browserRuntime:config.browserRuntime, deviceProfile:profile, sessionDurationSeconds:config.sessionDurationSeconds, proxy, useCookies:config.useCookies });
          }
        }
      })(),
    });
  }

  if (devices.iosEmulation?.enabled) {
    const config = devices.iosEmulation;
    const proxy = resolveV3ProxyPolicy(request, 'ios-emulation', config);
    families.push({
      key:'ios-emulation',
      iterator:(function* iosUnits() {
        for (const browser of config.browsers || []) {
          for (const profile of config.profiles || []) {
            const currentGroupIndex = groupIndex++;
            const groupId = `ios-emulation-${browser}-${String(profile).replace(/\s+/g, '-').toLowerCase()}`;
            for (let instanceIndex = 0; instanceIndex < Math.max(0, Number(config.instancesPerProfile) || 0); instanceIndex += 1) {
              yield makeUnit({
                groupId, groupIndex:currentGroupIndex, instanceIndex, executionKind:'ios-emulation', browser, deviceProfile:profile,
                orientation:config.orientation || 'portrait', locale:config.locale, timezoneId:config.timezoneId,
                sessionDurationSeconds:config.sessionDurationSeconds, proxy, useCookies:config.useCookies,
              });
            }
          }
        }
      })(),
    });
  }

  if (devices.androidAvd?.enabled) {
    const config = devices.androidAvd;
    const proxy = resolveV3ProxyPolicy(request, 'android-avd', config);
    families.push({
      key:'android-avd',
      iterator:(function* avdUnits() {
        for (const avdName of config.avdNames || []) {
          const currentGroupIndex = groupIndex++;
          const groupId = `android-avd-${String(avdName).replace(/\s+/g, '-').toLowerCase()}`;
          yield makeUnit({ groupId, groupIndex:currentGroupIndex, instanceIndex:0, executionKind:'android-avd', browser:'chrome-android', androidAvdName:avdName, sessionDurationSeconds:config.sessionDurationSeconds, proxy, useCookies:config.useCookies });
        }
      })(),
    });
  }

  if (devices.realIos?.enabled) {
    const config = devices.realIos;
    const proxy = resolveV3ProxyPolicy(request, 'real-ios', config);
    families.push({
      key:'real-ios',
      iterator:(function* realIosUnits() {
        for (const selection of config.selections || []) {
          const currentGroupIndex = groupIndex++;
          const browser = selection.browser === 'chrome' ? 'chrome-ios' : 'safari-ios';
          const groupId = `real-ios-${browser}-${String(selection.device).replace(/\s+/g, '-').toLowerCase()}`;
          yield makeUnit({ groupId, groupIndex:currentGroupIndex, instanceIndex:0, executionKind:'real-ios', browser, realIos:selection, sessionDurationSeconds:config.sessionDurationSeconds, proxy, useCookies:config.useCookies });
        }
      })(),
    });
  }

  let active = shuffledDeviceFamilies(families, `${request.runSeed || ''}:device-families:0`);
  while (active.length > 0) {
    const nextActive = [];
    for (const family of active) {
      const next = family.iterator.next();
      if (!next.done) {
        yield next.value;
        nextActive.push(family);
      }
    }
    active = nextActive;
  }
}

function normalizeQueueOptions(source, optionsOrConcurrency) {
  if (typeof optionsOrConcurrency === 'number') {
    return {
      requestedCount: Array.isArray(source) ? source.length : 0,
      concurrency: { mode: 'manual', value: Math.max(1, Number(optionsOrConcurrency) || 1) },
      resourceProvider: null,
      onMetrics: null,
      exclusivityKey: null,
      pollIntervalMs: 25,
    };
  }
  const options = optionsOrConcurrency || {};
  const concurrency = options.concurrency && typeof options.concurrency === 'object'
    ? options.concurrency
    : { mode: 'manual', value: Math.max(1, Number(options.concurrency) || 1) };
  return {
    requestedCount: Math.max(0, Number(options.requestedCount) || (Array.isArray(source) ? source.length : 0)),
    concurrency,
    resourceProvider: options.resourceProvider === undefined ? require('./resource-policy.cjs') : options.resourceProvider,
    onMetrics: typeof options.onMetrics === 'function' ? options.onMetrics : null,
    exclusivityKey: typeof options.exclusivityKey === 'function' ? options.exclusivityKey : null,
    pollIntervalMs: Math.max(1, Number(options.pollIntervalMs) || 25),
  };
}

function copyMetrics(metrics) {
  return { ...metrics };
}

function delay(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener?.('abort', done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener?.('abort', done, { once: true });
  });
}

function workerLimit(concurrency, snapshot) {
  const requested = Math.max(1, Number(concurrency?.value) || 1);
  const { computeAutoConcurrency } = require('./resource-policy.cjs');
  if (concurrency?.mode === 'auto') {
    return Math.max(1, computeAutoConcurrency(snapshot || {}));
  }
  return requested;
}

function classifyWorkerResult(metrics, result) {
  const status = result?.status;
  if (status === 'failed') metrics.failed += 1;
  else if (status === 'cancelled') metrics.cancelled += 1;
  else if (status === 'incomplete') metrics.incomplete += 1;
  else metrics.completed += 1;
}

async function runWorkUnitQueue(source, optionsOrConcurrency, worker, signal) {
  const options = normalizeQueueOptions(source, optionsOrConcurrency);
  const iterator = Array.isArray(source)
    ? source[Symbol.iterator]()
    : (source && typeof source.next === 'function' ? source : source?.[Symbol.iterator]?.());
  if (!iterator) throw new Error('Work-unit queue source must be iterable');

  const metrics = {
    requested: options.requestedCount,
    running: 0,
    queued: options.requestedCount,
    completed: 0,
    failed: 0,
    cancelled: 0,
    incomplete: 0,
  };
  const emitMetrics = () => options.onMetrics?.(copyMetrics(metrics));
  const active = new Set();
  const activeKeys = new Set();
  let nextIndex = 0;
  let iteratorDone = false;
  let pending = null;
  let pressurePaused = false;
  let fatalError = null;
  emitMetrics();

  const launch = (value, index, key) => {
    if (key) activeKeys.add(key);
    metrics.running += 1;
    metrics.queued = Math.max(0, metrics.queued - 1);
    emitMetrics();
    let task;
    task = Promise.resolve()
      .then(() => worker(value, index))
      .then((result) => classifyWorkerResult(metrics, result))
      .catch((error) => {
        metrics.failed += 1;
        if (!fatalError) fatalError = error;
      })
      .finally(() => {
        metrics.running = Math.max(0, metrics.running - 1);
        if (key) activeKeys.delete(key);
        active.delete(task);
        emitMetrics();
      });
    active.add(task);
  };

  while (true) {
    if (signal?.aborted) {
      metrics.cancelled += Math.max(0, metrics.queued);
      metrics.queued = 0;
      emitMetrics();
      break;
    }
    if (fatalError) break;
    if (iteratorDone && !pending && active.size === 0) break;

    let snapshot = null;
    if (options.resourceProvider) {
      snapshot = await Promise.resolve(options.resourceProvider.getResourceSnapshot());
      if (options.concurrency?.mode === 'auto') {
        const { isLaunchPaused, isLaunchResumable } = require('./resource-policy.cjs');
        if (pressurePaused) {
          if (isLaunchResumable(snapshot)) pressurePaused = false;
          else {
            await delay(options.pollIntervalMs, signal);
            continue;
          }
        } else if (isLaunchPaused(snapshot)) {
          pressurePaused = true;
          await delay(options.pollIntervalMs, signal);
          continue;
        }
      }
    } else if (options.concurrency?.mode === 'auto') {
      snapshot = require('./resource-policy.cjs').getResourceSnapshot();
    }

    const limit = Math.max(1, Math.min(workerLimit(options.concurrency, snapshot), Math.max(1, metrics.requested || 1)));
    let launchedAny = false;
    while (!signal?.aborted && !fatalError && active.size < limit && (!iteratorDone || pending)) {
      if (!pending) {
        const next = iterator.next();
        if (next.done) {
          iteratorDone = true;
          break;
        }
        pending = { value: next.value, index: nextIndex };
        nextIndex += 1;
      }
      const key = options.exclusivityKey?.(pending.value) || null;
      if (key && activeKeys.has(key)) break;
      const current = pending;
      pending = null;
      launch(current.value, current.index, key);
      launchedAny = true;

      if (options.resourceProvider && options.concurrency?.mode === 'auto' && active.size < limit) {
        snapshot = await Promise.resolve(options.resourceProvider.getResourceSnapshot());
        const { isLaunchPaused } = require('./resource-policy.cjs');
        if (isLaunchPaused(snapshot)) {
          pressurePaused = true;
          break;
        }
      }
    }

    if (signal?.aborted) continue;
    if (active.size > 0) {
      await Promise.race(active);
    } else if (!iteratorDone || pending) {
      await delay(launchedAny ? 1 : options.pollIntervalMs, signal);
    }
  }

  if (active.size > 0) await Promise.allSettled([...active]);
  if (fatalError) throw fatalError;
  return copyMetrics(metrics);
}

module.exports = {
  expandWorkUnits,
  countWorkUnits,
  iterateWorkUnits,
  validateAvdRequest,
  validateAvdConcurrency,
  runWorkUnitQueue,
  countWorkUnitsV3,
  iterateWorkUnitsV3,
};
