const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const CONFIG_FILENAME = 'real-ios-provider.json';

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/([?&](?:token|key|secret|password|accessKey)=)[^&\s]*/gi, '$1[REDACTED]')
    .replace(/\b(token|key|secret|password|accessKey)\s*[=:]\s*[^\s&]+/gi, '$1=[REDACTED]');
}

function normalizeProviderUrl(value) {
  const parsed = new URL(String(value || '').trim());
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new Error('Provider endpoint must use HTTPS');
  }
  return parsed.toString().replace(/\/$/, '');
}

function validateSaveRequest(request) {
  if (!request || typeof request !== 'object') throw new Error('Enter valid provider settings');
  if (!String(request.providerName || '').trim()) throw new Error('Enter a provider name');
  let remoteUrl;
  try {
    remoteUrl = normalizeProviderUrl(request.remoteUrl);
  } catch {
    throw new Error('Enter a valid HTTPS provider endpoint');
  }
  if (!String(request.defaultDevice || '').trim()) throw new Error('Enter a default iOS device model');
  if (!String(request.defaultIosVersion || '').trim()) throw new Error('Enter a default iOS version');
  if (!['safari', 'chrome'].includes(request.defaultBrowser)) throw new Error('Choose Safari or Chrome iOS');
  return {
    providerName: String(request.providerName).trim(),
    remoteUrl,
    username: String(request.username || '').trim(),
    accessKey: String(request.accessKey || ''),
    defaultDevice: String(request.defaultDevice).trim(),
    defaultIosVersion: String(request.defaultIosVersion).trim(),
    defaultBrowser: request.defaultBrowser,
  };
}

function observedEnvironmentScript() {
  return `return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: window.screen.width, height: window.screen.height },
    devicePixelRatio: window.devicePixelRatio || 1,
    locale: navigator.language || '',
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    webRtcSupported: typeof RTCPeerConnection !== 'undefined',
    literalIpCandidates: []
  };`;
}

function observedEnvironmentAsyncScript() {
  return `var done = arguments[arguments.length - 1];
  (async function () {
    var result = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      screen: { width: window.screen.width, height: window.screen.height },
      devicePixelRatio: window.devicePixelRatio || 1,
      locale: navigator.language || '',
      timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      webRtcSupported: typeof RTCPeerConnection !== 'undefined',
      literalIpCandidates: []
    };
    if (!result.webRtcSupported) return done(result);
    try {
      var pc = new RTCPeerConnection({ iceServers: [] });
      var candidates = [];
      pc.createDataChannel('orbitqa-webrtc-check');
      pc.onicecandidate = function (event) {
        if (event.candidate && event.candidate.candidate) candidates.push(event.candidate.candidate);
      };
      var offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await Promise.race([
        new Promise(function (resolve) {
          if (pc.iceGatheringState === 'complete') return resolve();
          pc.addEventListener('icegatheringstatechange', function () {
            if (pc.iceGatheringState === 'complete') resolve();
          });
        }),
        new Promise(function (resolve) { setTimeout(resolve, 1200); })
      ]);
      pc.close();
      var ipv4 = /(?:^|\\s)(?:\\d{1,3}\\.){3}\\d{1,3}(?:\\s|$)/;
      var ipv6 = /(?:^|\\s)(?:[0-9a-f]{0,4}:){2,}[0-9a-f]{0,4}(?:\\s|$)/i;
      result.literalIpCandidates = candidates.filter(function (candidate) { return ipv4.test(candidate) || ipv6.test(candidate); });
    } catch (error) {}
    done(result);
  })();`;
}

function createRealIosService({ userDataPath, safeStorage, provider, now = Date.now, randomId = randomUUID, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (!userDataPath) throw new Error('userDataPath is required');
  if (!provider) throw new Error('provider is required');
  const configPath = path.join(userDataPath, CONFIG_FILENAME);

  async function readStoredConfig() {
    try {
      return JSON.parse(await fs.readFile(configPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function loadPrivateConfig() {
    const stored = await readStoredConfig();
    if (!stored) return null;
    let accessKey = '';
    if (stored.accessKeyEncrypted) {
      if (!safeStorage?.isEncryptionAvailable?.()) {
        throw new Error('Secure credential storage is unavailable on this system');
      }
      accessKey = safeStorage.decryptString(Buffer.from(stored.accessKeyEncrypted, 'base64'));
    }
    return {
      providerName: stored.providerName,
      remoteUrl: stored.remoteUrl,
      username: stored.username || '',
      accessKey,
      defaultDevice: stored.defaultDevice,
      defaultIosVersion: stored.defaultIosVersion,
      defaultBrowser: stored.defaultBrowser,
    };
  }

  async function getPublicConfig() {
    const stored = await readStoredConfig();
    if (!stored) return null;
    return {
      providerName: stored.providerName,
      remoteUrl: stored.remoteUrl,
      username: stored.username || '',
      defaultDevice: stored.defaultDevice,
      defaultIosVersion: stored.defaultIosVersion,
      defaultBrowser: stored.defaultBrowser,
      credentialsSaved: Boolean(stored.accessKeyEncrypted),
    };
  }

  async function saveConfig(request) {
    const normalized = validateSaveRequest(request);
    const existing = await readStoredConfig();
    let accessKeyEncrypted = existing?.accessKeyEncrypted || '';
    if (normalized.accessKey) {
      if (!safeStorage?.isEncryptionAvailable?.()) {
        throw new Error('Secure credential storage is unavailable on this system');
      }
      accessKeyEncrypted = safeStorage.encryptString(normalized.accessKey).toString('base64');
    }
    await fs.mkdir(userDataPath, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      providerName: normalized.providerName,
      remoteUrl: normalized.remoteUrl,
      username: normalized.username,
      accessKeyEncrypted,
      defaultDevice: normalized.defaultDevice,
      defaultIosVersion: normalized.defaultIosVersion,
      defaultBrowser: normalized.defaultBrowser,
    }, null, 2), 'utf8');
    return getPublicConfig();
  }

  async function checkConnection() {
    const config = await loadPrivateConfig();
    if (!config) {
      return {
        configured: false,
        reachable: false,
        authenticated: false,
        safariSupported: false,
        chromeSupported: false,
        message: 'Real iOS provider is not configured',
      };
    }
    try {
      const status = await provider.checkConnection(config);
      return { configured: true, ...status };
    } catch (error) {
      const authRejected = error?.status === 401 || error?.status === 403;
      return {
        configured: true,
        reachable: authRejected,
        authenticated: false,
        safariSupported: false,
        chromeSupported: false,
        message: authRejected ? 'Provider authentication rejected' : redactSensitiveText(error?.message || String(error)),
      };
    }
  }

  function pushFactory(emit, runId) {
    return (event) => emit({ runId, timestamp: new Date(now()).toISOString(), ...event });
  }

  async function writeScreenshot({ screenshotsRoot, runId, filename, base64 }) {
    const dir = path.join(screenshotsRoot, runId);
    await fs.mkdir(dir, { recursive: true });
    const screenshotPath = path.join(dir, filename);
    await fs.writeFile(screenshotPath, Buffer.from(base64, 'base64'));
    return screenshotPath;
  }

  async function executeStep(config, sessionId, step, index, context) {
    context.push({ type: 'step', sessionId: 1, stepId: step.id, message: `Running ${step.type} step` });
    switch (step.type) {
      case 'wait':
        await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(Number(step.ms) || 0, 30000))));
        return undefined;
      case 'scroll':
        await provider.scroll(config, sessionId, step.direction, Number(step.distance) || 0);
        return undefined;
      case 'click':
        await provider.click(config, sessionId, step.selector);
        return undefined;
      case 'type':
        await provider.type(config, sessionId, step.selector, step.value);
        return undefined;
      case 'screenshot': {
        const base64 = await provider.screenshot(config, sessionId);
        const screenshotPath = await writeScreenshot({
          screenshotsRoot: context.screenshotsRoot,
          runId: context.runId,
          filename: `${context.filenamePrefix || 'real-ios'}-step-${index + 1}.png`,
          base64,
        });
        context.push({ type: 'log', sessionId: 1, message: `Screenshot saved: ${screenshotPath}`, screenshotPath });
        return screenshotPath;
      }
      default:
        throw new Error(`Unsupported step type: ${step.type}`);
    }
  }

  async function collectDiagnostics(config, sessionId) {
    let observed;
    if (typeof provider.executeAsyncScript === 'function') {
      observed = await provider.executeAsyncScript(config, sessionId, observedEnvironmentAsyncScript(), []);
    } else {
      observed = await provider.executeScript(config, sessionId, observedEnvironmentScript(), []);
    }
    return { observed: observed || {} };
  }


  function abortError() {
    const error = new Error('QA run stopped by user');
    error.name = 'AbortError';
    return error;
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
  }

  async function sleepUntilDeadline(ms, signal) {
    if (ms <= 0) return;
    throwIfAborted(signal);
    if (!signal) return sleep(ms);
    let onAbort;
    const abortPromise = new Promise((_, reject) => {
      onAbort = () => reject(abortError());
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await Promise.race([sleep(ms), abortPromise]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  async function runWorkUnit({ runId = randomId(), workUnit, steps = [], push = () => {}, screenshotsRoot, captureScreenshots = true, signal }) {
    const config = await loadPrivateConfig();
    if (!config) throw new Error('Real iOS provider is not configured');
    const selection = workUnit?.realIos || {};
    if (!String(selection.device || '').trim()) throw new Error('Choose a real iOS device model');
    if (!String(selection.iosVersion || '').trim()) throw new Error('Choose a real iOS version');
    if (!['safari', 'chrome'].includes(selection.browser)) throw new Error('Choose Safari or Chrome iOS');
    if ((steps || []).some((step) => step?.type === 'smart-interaction')) {
      throw new Error('Smart QA Interaction is not available for Real iOS Device runs');
    }
    const durationMs = Math.max(5000, Math.min(600000, Number(workUnit?.sessionDurationSeconds || 60) * 1000));

    const status = await checkConnection();
    if (!status.reachable) throw new Error(status.message || 'Provider unreachable');
    if (!status.authenticated) throw new Error(status.message || 'Provider authentication rejected');
    if (selection.browser === 'safari' && !status.safariSupported) throw new Error('Safari iOS is not supported by this provider');
    if (selection.browser === 'chrome' && !status.chromeSupported) throw new Error('Chrome iOS is not supported by this provider');

    let sessionId = null;
    let cleaned = false;
    let cleanupError = null;
    const cleanup = async () => {
      if (!sessionId || cleaned) return;
      cleaned = true;
      try {
        await provider.deleteSession(config, sessionId);
      } catch (error) {
        cleanupError = new Error(redactSensitiveText(error?.message || String(error)));
      }
    };
    const abortCleanup = () => { void cleanup(); };
    signal?.addEventListener('abort', abortCleanup, { once: true });
    try {
      throwIfAborted(signal);
      const created = await provider.createSession(config, selection);
      sessionId = created.sessionId;
      const startedAt = now();
      const deadlineAt = startedAt + durationMs;
      push({ type: 'log', message: `Real iOS work-unit timer started (${Math.round(durationMs / 1000)}s)` });

      const ensureBeforeDeadline = () => {
        throwIfAborted(signal);
        if (now() >= deadlineAt) {
          const error = new Error('Real iOS work-unit timer elapsed before mandatory behavior completed');
          error.name = 'SessionExpiredError';
          error.orbitQaIncomplete = true;
          throw error;
        }
      };

      ensureBeforeDeadline();
      await provider.navigate(config, sessionId, workUnit.targetUrl);
      ensureBeforeDeadline();
      push({ type: 'log', message: `Loaded ${workUnit.targetUrl} on Real iOS` });

      let screenshotPath;
      for (let index = 0; index < (steps || []).length; index += 1) {
        ensureBeforeDeadline();
        if (steps[index]?.type === 'screenshot' && !captureScreenshots) {
          push({ type: 'log', message: 'Screenshot capture disabled for this run' });
          continue;
        }
        const stepResult = await executeStep(config, sessionId, steps[index], index, {
          push,
          screenshotsRoot,
          runId,
          filenamePrefix: `real-ios-${workUnit.workId}`,
        });
        if (stepResult) screenshotPath = stepResult;
        ensureBeforeDeadline();
      }

      const diagnostics = await collectDiagnostics(config, sessionId);
      ensureBeforeDeadline();
      push({ type: 'ios-diagnostics', message: 'Observed real iOS environment collected', diagnostics });

      if (captureScreenshots) {
        const finalBase64 = await provider.screenshot(config, sessionId);
        screenshotPath = await writeScreenshot({
          screenshotsRoot,
          runId,
          filename: `real-ios-${workUnit.workId}-final.png`,
          base64: finalBase64,
        });
        ensureBeforeDeadline();
        push({ type: 'log', message: `Final screenshot saved: ${screenshotPath}`, screenshotPath });
      }

      const remainingMs = Math.max(0, deadlineAt - now());
      push({ type: 'log', message: `Real iOS QA behavior complete; waiting for this work unit's timer (${Math.ceil(remainingMs / 1000)}s remaining)` });
      await sleepUntilDeadline(remainingMs, signal);
      throwIfAborted(signal);
      push({ type: 'log', message: 'Real iOS work-unit timer elapsed; closing its remote session' });
      return {
        sessionId,
        providerName: config.providerName,
        device: selection.device,
        iosVersion: selection.iosVersion,
        browser: selection.browser,
        durationMs: Math.max(0, now() - startedAt),
        screenshotPath,
        diagnostics,
      };
    } catch (error) {
      const sanitized = new Error(redactSensitiveText(error?.message || String(error)));
      sanitized.name = error?.name || 'Error';
      if (error?.orbitQaIncomplete) sanitized.orbitQaIncomplete = true;
      throw sanitized;
    } finally {
      signal?.removeEventListener('abort', abortCleanup);
      await cleanup();
      if (cleanupError) throw cleanupError;
    }
  }

  async function run({ runId = randomId(), request, emit = () => {}, screenshotsRoot }) {
    const config = await loadPrivateConfig();
    if (!config) throw new Error('Real iOS provider is not configured');
    if (!request?.realIos?.device?.trim()) throw new Error('Choose a real iOS device model');
    if (!request?.realIos?.iosVersion?.trim()) throw new Error('Choose a real iOS version');
    if (!['safari', 'chrome'].includes(request?.realIos?.browser)) throw new Error('Choose Safari or Chrome iOS');
    if (request.sessions !== 1 || request.concurrency !== 1) throw new Error('Real iOS Device runs use exactly 1 session and concurrency 1');

    const status = await checkConnection();
    if (!status.reachable) throw new Error(status.message || 'Provider unreachable');
    if (!status.authenticated) throw new Error(status.message || 'Provider authentication rejected');
    if (request.realIos.browser === 'safari' && !status.safariSupported) throw new Error('Safari iOS is not supported by this provider');
    if (request.realIos.browser === 'chrome' && !status.chromeSupported) throw new Error('Chrome iOS is not supported by this provider');

    const startedAt = now();
    const push = pushFactory(emit, runId);
    let sessionId = null;
    let primaryError = null;
    let screenshotPath;
    let completedResult = null;
    try {
      push({ type: 'run-start', message: `Starting real iOS ${request.realIos.browser} session` });
      const created = await provider.createSession(config, request.realIos);
      sessionId = created.sessionId;
      push({ type: 'session-start', sessionId: 1, status: 'running', message: `Remote iOS session started (${sessionId})` });
      await provider.navigate(config, sessionId, request.targetUrl);
      push({ type: 'log', sessionId: 1, message: `Loaded ${request.targetUrl}` });

      for (let index = 0; index < (request.steps || []).length; index += 1) {
        if (request.steps[index]?.type === 'screenshot' && request.captureScreenshots === false) {
          push({ type: 'log', sessionId: 1, message: 'Screenshot capture disabled for this run' });
          continue;
        }
        const stepResult = await executeStep(config, sessionId, request.steps[index], index, { push, screenshotsRoot, runId });
        if (stepResult) screenshotPath = stepResult;
      }

      const diagnostics = await collectDiagnostics(config, sessionId);
      push({ type: 'ios-diagnostics', sessionId: 1, message: 'Observed real iOS environment collected', diagnostics });

      if (request.captureScreenshots !== false) {
        const finalBase64 = await provider.screenshot(config, sessionId);
        screenshotPath = await writeScreenshot({ screenshotsRoot, runId, filename: 'real-ios-final.png', base64: finalBase64 });
        push({ type: 'log', sessionId: 1, message: `Final screenshot saved: ${screenshotPath}`, screenshotPath });
      }

      const durationMs = Math.max(0, now() - startedAt);
      completedResult = {
        sessionId,
        providerName: config.providerName,
        device: request.realIos.device,
        iosVersion: request.realIos.iosVersion,
        browser: request.realIos.browser,
        durationMs,
        screenshotPath,
        diagnostics,
      };
    } catch (error) {
      const sanitizedMessage = redactSensitiveText(error?.message || String(error));
      const sanitizedError = new Error(sanitizedMessage);
      primaryError = sanitizedError;
      push({ type: 'session-error', sessionId: 1, status: 'failed', message: sanitizedMessage });
      throw sanitizedError;
    } finally {
      if (sessionId) {
        try {
          await provider.deleteSession(config, sessionId);
        } catch (cleanupError) {
          const sanitizedCleanupMessage = redactSensitiveText(cleanupError?.message || String(cleanupError));
          push({ type: 'log', sessionId: 1, message: `Cleanup warning: ${sanitizedCleanupMessage}` });
          if (!primaryError) throw new Error(sanitizedCleanupMessage);
        }
      }
    }

    const durationMs = completedResult.durationMs;
    push({ type: 'session-complete', sessionId: 1, status: 'completed', message: 'Real iOS session completed' });
    push({ type: 'run-complete', message: 'Real iOS QA run finished', summary: { total: 1, completed: 1, failed: 0, durationMs } });
    return completedResult;
  }

  return { getPublicConfig, saveConfig, checkConnection, run, runWorkUnit };
}

module.exports = { createRealIosService };
