const TOKEN_ATTR = 'data-orbitqa-resolver-token';
const CLOSE_TEXT_PATTERN = /^(close|cancel|dismiss|skip|no\s*,?\s*thanks|not\s+now|maybe\s+later|×|x)$/i;
const CLOSE_METADATA_PATTERN = /(close|dismiss|cancel|modal-close|popup-close|overlay-close|btn-close)/i;
const DANGEROUS_CONTROL_PATTERN = /(continue|install|update|download|sponsored|offer|open|verify|robot|captcha|recaptcha|hcaptcha|turnstile|allow|purchase|checkout|buy|pay)/i;
const HUMAN_VERIFICATION_PATTERN = /(i['’]?m\s+not\s+a\s+robot|not\s+a\s+robot|captcha|recaptcha|hcaptcha|turnstile|human\s+verification|verify\s+you\s+are\s+human|click\s+the\s+button\s+if\s+you\s+are\s+not\s+a\s+robot)/i;

const DIRECT_CLOSE_LABELS = ['Close', 'Cancel', 'Dismiss', 'No thanks', 'No, thanks', 'Not now', 'Maybe later', '×', 'x'];

async function isLikelyBlockingDismissControl(locator, isChildScope = false) {
  if (!locator) return false;
  try {
    if (typeof locator.isVisible === 'function' && !(await locator.isVisible())) return false;
  } catch {
    return false;
  }
  if (isChildScope) return true;
  if (typeof locator.evaluate !== 'function') return false;
  try {
    return Boolean(await locator.evaluate((element) => {
      if (!(element instanceof Element)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0.02 || rect.width <= 1 || rect.height <= 1) return false;
      const overlayPattern = /(modal|popup|overlay|backdrop|lightbox|interstitial|dialog|advert|promo|vignette|consent|cmp)/i;
      let node = element;
      for (let depth = 0; node && depth < 10; depth += 1, node = node.parentElement) {
        const nodeStyle = getComputedStyle(node);
        const nodeRect = node.getBoundingClientRect();
        const role = String(node.getAttribute?.('role') || '').toLowerCase();
        const metadata = `${node.id || ''} ${node.className || ''} ${role}`;
        const zRaw = Number.parseInt(nodeStyle.zIndex, 10);
        const z = Number.isFinite(zRaw) ? zRaw : 0;
        const positioned = ['fixed','sticky','absolute'].includes(String(nodeStyle.position || '').toLowerCase());
        const substantial = nodeRect.width >= Math.min(260, innerWidth * 0.22) && nodeRect.height >= Math.min(120, innerHeight * 0.12);
        if (node.tagName === 'DIALOG' || role === 'dialog' || node.getAttribute?.('aria-modal') === 'true') return true;
        if (overlayPattern.test(metadata) && (positioned || substantial)) return true;
        if (positioned && z >= 10 && substantial) return true;
      }
      const bodyStyle = getComputedStyle(document.body);
      const rootStyle = getComputedStyle(document.documentElement);
      if (['hidden','clip'].includes(bodyStyle.overflow) || ['hidden','clip'].includes(rootStyle.overflow)) return true;
      return false;
    }));
  } catch {
    return false;
  }
}

async function findDirectSafeCloseControl(entries, options = {}) {
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const { scope } = entries[entryIndex];
    if (!scope) continue;
    for (const label of DIRECT_CLOSE_LABELS) {
      if (typeof scope.getByRole === 'function') {
        for (const role of ['button', 'link']) {
          try {
            const locator = scope.getByRole(role, { name: label, exact: true });
            const count = typeof locator?.count === 'function' ? await locator.count() : 0;
            if (count > 0) {
              const candidate = typeof locator.first === 'function' ? locator.first() : locator;
              if (options.requireBlockingContext !== true || await isLikelyBlockingDismissControl(candidate, entryIndex > 0)) {
                return { scope, locator: candidate, label, standaloneBlocking: options.requireBlockingContext === true };
              }
            }
          } catch {
            // Detached/cross-origin frames may disappear while the overlay is changing.
          }
        }
      }

      // Some ad SDKs render the visible Close label inside a roleless DIV/SPAN.
      // Exact text matching is deliberately restricted to the safe-dismiss list,
      // so promotional CTAs such as Continue/Open/Download are never selected.
      if (typeof scope.getByText === 'function') {
        try {
          const locator = scope.getByText(label, { exact: true });
          const count = typeof locator?.count === 'function' ? await locator.count() : 0;
          if (count > 0) {
            const candidate = typeof locator.first === 'function' ? locator.first() : locator;
            if (options.requireBlockingContext !== true || await isLikelyBlockingDismissControl(candidate, entryIndex > 0)) {
              return { scope, locator: candidate, label, standaloneBlocking: options.requireBlockingContext === true };
            }
          }
        } catch {
          // Dynamic ad DOM can detach while the monitor is inspecting it.
        }
      }
    }
  }
  return null;
}

function scoreBlockingSurface(surface) {
  if (!surface || !surface.rect) return -1;
  const overlap = Number(surface.overlapRatio) || 0;
  const hits = Number(surface.topmostHits) || 0;
  const semantic = surface.semantic === true;
  const pattern = surface.pattern === true;
  const positioned = ['fixed', 'sticky', 'absolute'].includes(String(surface.position || '').toLowerCase());
  const zIndex = Number(surface.zIndex) || 0;
  const material = overlap >= 0.15 && hits >= 1 && (positioned || pattern);
  const dominant = overlap >= 0.35 && hits >= 2 && zIndex >= 10;
  if (!semantic && !material && !dominant) return -1;
  return Math.round(overlap * 100) + (hits * 20) + (semantic ? 35 : 0) + (pattern ? 15 : 0) + (positioned ? 10 : 0) + Math.min(20, Math.max(0, Math.log10(Math.max(1, zIndex)) * 5));
}

function rectCenterDistanceToUpperRight(controlRect, surfaceRect) {
  if (!controlRect || !surfaceRect) return Number.POSITIVE_INFINITY;
  const cx = Number(controlRect.x) + (Number(controlRect.width) / 2);
  const cy = Number(controlRect.y) + (Number(controlRect.height) / 2);
  const sx = Number(surfaceRect.x) + Number(surfaceRect.width);
  const sy = Number(surfaceRect.y);
  return Math.hypot(cx - sx, cy - sy);
}

function chooseSafeDismissal(snapshot) {
  const surfaces = Array.isArray(snapshot?.surfaces) ? snapshot.surfaces : [];
  const controls = Array.isArray(snapshot?.controls) ? snapshot.controls : [];
  const ranked = surfaces
    .map((surface) => ({ surface, score: scoreBlockingSurface(surface) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return { kind: 'none' };

  const blocker = ranked[0].surface;
  const closeControls = controls
    .filter((candidate) => candidate && (candidate.closeSemantic === true || candidate.upperRightCandidate === true || candidate.viewportUpperRightCandidate === true) && candidate.dangerous !== true)
    .map((candidate) => {
      const inside = candidate.surfaceToken === blocker.token;
      const distance = rectCenterDistanceToUpperRight(candidate.rect, blocker.rect);
      const adjacent = !inside && distance <= 180;
      if (!inside && !adjacent) return null;
      const metadataBoost = CLOSE_METADATA_PATTERN.test(String(candidate.metadata || '')) ? 20 : 0;
      const exactBoost = CLOSE_TEXT_PATTERN.test(String(candidate.label || '').trim()) ? 20 : 0;
      const geometryBoost = candidate.upperRightCandidate === true ? 10 : candidate.viewportUpperRightCandidate === true ? 8 : 0;
      return { candidate, rank: (inside ? 100 : 70) + metadataBoost + exactBoost + geometryBoost - Math.min(40, distance / 10) };
    })
    .filter(Boolean)
    .sort((a, b) => b.rank - a.rank);

  if (closeControls.length > 0) {
    const selected = closeControls[0].candidate;
    return { kind: 'control', token: selected.token, label: selected.label || selected.metadata || (selected.upperRightCandidate || selected.viewportUpperRightCandidate ? 'upper-right close control' : 'Close') };
  }

  // Never use backdrop/Escape against a human-verification challenge. Only
  // a separate verified Close/X/Cancel control (selected above) may dismiss it.
  if (blocker.humanVerification === true) return { kind: 'human-verification-blocked', surfaceToken: blocker.token };

  if (Array.isArray(blocker.safeBackdropPoints) && blocker.safeBackdropPoints.length > 0) {
    return { kind: 'backdrop', surfaceToken: blocker.token, point: blocker.safeBackdropPoints[0] };
  }

  if (blocker.semantic === true || blocker.pattern === true) return { kind: 'escape', surfaceToken: blocker.token };
  return { kind: 'none' };
}


function chooseExplicitSafeCloseControl(snapshot) {
  const controls = Array.isArray(snapshot?.controls) ? snapshot.controls : [];
  const candidates = controls
    .filter((candidate) => candidate && candidate.dangerous !== true && candidate.closeSemantic === true)
    .filter((candidate) => CLOSE_TEXT_PATTERN.test(String(candidate.label || '').trim()) || CLOSE_METADATA_PATTERN.test(String(candidate.metadata || '')))
    .map((candidate) => {
      const exactText = CLOSE_TEXT_PATTERN.test(String(candidate.label || '').trim()) ? 30 : 0;
      const metadata = CLOSE_METADATA_PATTERN.test(String(candidate.metadata || '')) ? 20 : 0;
      return { candidate, rank: exactText + metadata };
    })
    .sort((a, b) => b.rank - a.rank);
  if (!candidates.length) return { kind:'none' };
  const selected = candidates[0].candidate;
  return { kind:'control', token:selected.token, label:selected.label || selected.metadata || 'Close', crossScope:true };
}

function interactiveScopes(page) {
  const scopes = [page];
  if (typeof page?.frames !== 'function') return scopes;
  try {
    for (const frame of page.frames()) {
      if (frame && frame !== page && !scopes.includes(frame)) scopes.push(frame);
    }
  } catch {
    // Cross-origin/provider lightweight doubles may not enumerate frames.
  }
  return scopes;
}

async function collectSnapshot(scope) {
  if (!scope || typeof scope.evaluate !== 'function') return { surfaces: [], controls: [] };
  try {
    return await scope.evaluate(() => {
      /* ORBITQA_BLOCKING_SURFACE_SNAPSHOT */
      const TOKEN_ATTR = 'data-orbitqa-resolver-token';
      const INDICATOR_SELECTOR = '[data-orbitqa-indicator]';
      const closeTextPattern = /^(close|cancel|dismiss|skip|no\s*,?\s*thanks|not\s+now|maybe\s+later|×|x)$/i;
      const closeMetadataPattern = /(close|dismiss|cancel|modal-close|popup-close|overlay-close|btn-close)/i;
      const dangerousPattern = /(continue|install|update|download|sponsored|offer|open|verify|robot|captcha|recaptcha|hcaptcha|turnstile|allow|purchase|checkout|buy|pay)/i;
      const humanPattern = /(i['’]?m\s+not\s+a\s+robot|not\s+a\s+robot|captcha|recaptcha|hcaptcha|turnstile|human\s+verification|verify\s+you\s+are\s+human|click\s+the\s+button\s+if\s+you\s+are\s+not\s+a\s+robot)/i;
      const overlayPattern = /(modal|popup|overlay|backdrop|lightbox|interstitial|dialog|advert|promo)/i;
      const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
      const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
      const viewportArea = viewportWidth * viewportHeight;
      const samplePoints = [
        [viewportWidth * 0.5, viewportHeight * 0.5],
        [viewportWidth * 0.25, viewportHeight * 0.25],
        [viewportWidth * 0.75, viewportHeight * 0.25],
        [viewportWidth * 0.25, viewportHeight * 0.75],
        [viewportWidth * 0.75, viewportHeight * 0.75],
      ];
      let tokenCounter = 0;
      const tokenFor = (element, prefix) => {
        let token = element.getAttribute(TOKEN_ATTR);
        if (!token) {
          token = `${prefix}-${Date.now()}-${++tokenCounter}`;
          element.setAttribute(TOKEN_ATTR, token);
        }
        return token;
      };
      const rectData = (rect) => ({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
      const visible = (element, style, rect) => style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.02 && rect.width > 1 && rect.height > 1;
      const overlapRatio = (rect) => {
        const left = Math.max(0, rect.left);
        const top = Math.max(0, rect.top);
        const right = Math.min(viewportWidth, rect.right);
        const bottom = Math.min(viewportHeight, rect.bottom);
        return Math.max(0, right - left) * Math.max(0, bottom - top) / viewportArea;
      };
      const topHits = (element) => samplePoints.reduce((hits, [x, y]) => {
        const stack = document.elementsFromPoint?.(x, y) || [];
        const top = stack[0];
        return hits + (top && (top === element || element.contains(top)) ? 1 : 0);
      }, 0);

      document.querySelectorAll(`[${TOKEN_ATTR}]`).forEach((element) => element.removeAttribute(TOKEN_ATTR));

      const elements = Array.from(document.querySelectorAll('body *')).filter((element) => !element.matches?.(INDICATOR_SELECTOR) && !element.closest?.(INDICATOR_SELECTOR)).slice(0, 3000);
      const surfaceEntries = [];
      for (const element of elements) {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (!visible(element, style, rect)) continue;
        const role = String(element.getAttribute('role') || '').toLowerCase();
        const semantic = element.tagName === 'DIALOG' || role === 'dialog' || element.getAttribute('aria-modal') === 'true';
        const metadata = `${element.id || ''} ${element.className || ''} ${role}`;
        const pattern = overlayPattern.test(metadata);
        const overlap = overlapRatio(rect);
        const position = String(style.position || '').toLowerCase();
        const zRaw = Number.parseInt(style.zIndex, 10);
        const zIndex = Number.isFinite(zRaw) ? zRaw : 0;
        const hits = topHits(element);
        const material = overlap >= 0.15 && hits >= 1 && (['fixed', 'sticky', 'absolute'].includes(position) || pattern);
        const dominant = overlap >= 0.35 && hits >= 2 && zIndex >= 10;
        if (!semantic && !material && !dominant) continue;
        const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
        const token = tokenFor(element, 'surface');
        const humanVerification = humanPattern.test(`${text} ${metadata}`);
        const safeBackdropPoints = [];
        const candidatePoints = [
          [Math.max(rect.left + 8, 8), Math.max(rect.top + 8, 8)],
          [Math.min(rect.right - 8, viewportWidth - 8), Math.max(rect.top + 8, 8)],
          [Math.max(rect.left + 8, 8), Math.min(rect.bottom - 8, viewportHeight - 8)],
          [Math.min(rect.right - 8, viewportWidth - 8), Math.min(rect.bottom - 8, viewportHeight - 8)],
        ];
        const unsafeTag = /^(A|BUTTON|IFRAME|INPUT|SELECT|TEXTAREA|FORM)$/i.test(element.tagName);
        if (!unsafeTag) {
          for (const [x, y] of candidatePoints) {
            if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > viewportWidth || y > viewportHeight) continue;
            const target = document.elementFromPoint?.(x, y);
            if (target === element) safeBackdropPoints.push({ x: x - rect.left, y: y - rect.top });
          }
        }
        surfaceEntries.push({ element, token, semantic, pattern, position, zIndex, overlapRatio: overlap, topmostHits: hits, humanVerification, text, rect: rectData(rect), safeBackdropPoints });
      }

      const controls = [];
      const seenControls = new Set();
      for (const element of elements) {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (!visible(element, style, rect)) continue;
        const text = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const metadata = [element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('data-close'), element.getAttribute('data-dismiss'), element.id, element.className, element.getAttribute('name')].filter(Boolean).join(' ').slice(0, 300);
        const label = text || String(element.getAttribute('aria-label') || element.getAttribute('title') || '').trim();
        const closeSemantic = closeTextPattern.test(label) || closeMetadataPattern.test(metadata);
        if (!closeSemantic) continue;
        const clickTarget = element.closest?.('button,a,[role="button"],[onclick],[tabindex],input') || element;
        if (seenControls.has(clickTarget)) continue;
        seenControls.add(clickTarget);
        const targetStyle = getComputedStyle(clickTarget);
        const targetRect = clickTarget.getBoundingClientRect();
        if (!visible(clickTarget, targetStyle, targetRect)) continue;
        const targetText = String(clickTarget.innerText || clickTarget.textContent || label || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const targetMetadata = [clickTarget.getAttribute('aria-label'), clickTarget.getAttribute('title'), clickTarget.getAttribute('data-close'), clickTarget.getAttribute('data-dismiss'), clickTarget.id, clickTarget.className, clickTarget.getAttribute('name')].filter(Boolean).join(' ').slice(0, 300);
        const dangerous = dangerousPattern.test(`${targetText} ${targetMetadata}`) && !closeTextPattern.test(targetText) && !closeMetadataPattern.test(targetMetadata);
        let surfaceToken = null;
        for (const entry of surfaceEntries) {
          if (entry.element.contains(clickTarget)) {
            surfaceToken = entry.token;
            break;
          }
        }
        controls.push({
          token: tokenFor(clickTarget, 'control'),
          surfaceToken,
          label: targetText || label,
          metadata: targetMetadata || metadata,
          closeSemantic: true,
          dangerous,
          rect: rectData(targetRect),
        });
      }

      // Geometry-only close candidates cover custom/pseudo-looking X controls that
      // have no useful text/ARIA metadata. They must be small, actually topmost,
      // clickable, and sit at the upper-right edge of a detected blocking surface.
      for (const element of elements) {
        const tag = String(element.tagName || '').toUpperCase();
        const role = String(element.getAttribute('role') || '').toLowerCase();
        const style = getComputedStyle(element);
        const pointerStyle = String(style.cursor || '').toLowerCase() === 'pointer';
        const clickable = tag === 'BUTTON' || role === 'button' || element.hasAttribute('onclick') || element.tabIndex >= 0 || pointerStyle;
        if (!clickable || tag === 'A' || tag === 'INPUT') continue;
        const rect = element.getBoundingClientRect();
        if (!visible(element, style, rect)) continue;
        if (rect.width < 8 || rect.height < 8 || rect.width > 80 || rect.height > 80) continue;
        const cx = rect.left + (rect.width / 2);
        const cy = rect.top + (rect.height / 2);
        const top = document.elementFromPoint?.(cx, cy);
        if (top && top !== element && !element.contains(top)) continue;
        const label = String(element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        const metadata = [element.getAttribute('aria-label'), element.getAttribute('title'), element.id, element.className, element.getAttribute('name')].filter(Boolean).join(' ').slice(0, 300);
        const dangerous = dangerousPattern.test(`${label} ${metadata}`);
        if (dangerous) continue;
        for (const entry of surfaceEntries) {
          const sx = entry.rect.x + entry.rect.width;
          const sy = entry.rect.y;
          const distance = Math.hypot(cx - sx, cy - sy);
          const inside = entry.element.contains(element);
          if (distance > 120 || (!inside && distance > 70)) continue;
          if (seenControls.has(element)) break;
          seenControls.add(element);
          const viewportUpperRightCandidate = entry.overlapRatio >= 0.55 && cx >= viewportWidth - 140 && cy <= 140;
          controls.push({
            token: tokenFor(element, 'control'),
            surfaceToken: inside ? entry.token : null,
            label,
            metadata,
            closeSemantic: false,
            upperRightCandidate: true,
            viewportUpperRightCandidate,
            dangerous: false,
            rect: rectData(rect),
          });
          break;
        }
      }

      return {
        surfaces: surfaceEntries.map(({ element, ...entry }) => entry),
        controls,
      };
    });
  } catch {
    return { surfaces: [], controls: [] };
  }
}

async function cleanupScopeMarkers(scope) {
  if (!scope || typeof scope.evaluate !== 'function') return;
  try {
    await scope.evaluate(() => {
      document.querySelectorAll('[data-orbitqa-resolver-token]').forEach((element) => element.removeAttribute('data-orbitqa-resolver-token'));
    });
  } catch {
    // Detached/navigation scopes clean themselves up.
  }
}

async function resolverWait(page, lifetime, ms) {
  if (lifetime && typeof lifetime.wait === 'function') return lifetime.wait(ms);
  if (page && typeof page.waitForTimeout === 'function') return page.waitForTimeout(ms);
}

function isSafeDismissActivationRetry(error) {
  const message = String(error?.message || error || '');
  return /(intercepts pointer events|another element would receive the click|not stable|timeout|timed out)/i.test(message);
}

async function activateExplicitDismissControl(locator) {
  try {
    return await locator.click({ timeout:2500 });
  } catch (error) {
    if (!isSafeDismissActivationRetry(error)) throw error;
    return locator.click({ timeout:2500, force:true });
  }
}

async function verifyDismissControlGone(locator, page, lifetime) {
  if (!locator || typeof locator.isVisible !== 'function') return true;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let visible = false;
    try { visible = await locator.isVisible(); } catch { return true; }
    if (!visible) return true;
    await resolverWait(page, lifetime, 140 + (attempt * 80));
  }
  return false;
}

async function performDismissalWithPopupCleanup(page, lifetime, log, action, options = {}) {
  let popupPromise = null;
  if (page && typeof page.waitForEvent === 'function') {
    const timeout = Math.min(700, Math.max(100, lifetime?.remainingMs?.() || 700));
    popupPromise = page.waitForEvent('popup', { timeout }).catch(() => null);
  }
  await action();
  await resolverWait(page, lifetime, 120);
  const popup = popupPromise ? await popupPromise : null;
  if (popup) {
    try {
      const timeout = Math.min(1500, Math.max(100, lifetime?.remainingMs?.() || 1500));
      if (typeof popup.waitForLoadState === 'function') {
        await popup.waitForLoadState('domcontentloaded', { timeout }).catch(() => undefined);
      }
      if (options.preservePopup === true) {
        log('Preserved popup opened by blocker dismissal for supervised observation');
      } else {
        if (typeof popup.close === 'function') await popup.close().catch(() => undefined);
        log('Closed popup opened by blocker dismissal');
      }
    } finally {
      if (typeof page?.bringToFront === 'function') await page.bringToFront().catch(() => undefined);
    }
  }
  return popup;
}

function createBlockingSurfaceResolver({ page, lifetime = null, log = () => {} }) {
  async function inspect() {
    const surfaces = [];
    const entries = [];
    let humanVerification = false;
    for (const scope of interactiveScopes(page)) {
      const snapshot = await collectSnapshot(scope);
      entries.push({ scope, snapshot });
      for (const surface of snapshot.surfaces || []) {
        surfaces.push(surface);
        if (surface.humanVerification) humanVerification = true;
      }
    }
    const surfaceBlocked = surfaces.some((surface) => scoreBlockingSurface(surface) >= 0);
    const standaloneClose = surfaceBlocked ? null : await findDirectSafeCloseControl(entries, { requireBlockingContext:true });
    for (const { scope } of entries) await cleanupScopeMarkers(scope);
    return { blocked: surfaceBlocked || Boolean(standaloneClose), humanVerification, surfaces, standaloneClose:Boolean(standaloneClose) };
  }

  async function resolveOnce(options = {}) {
    const entries = [];
    let humanBlocked = false;
    try {
      for (const scope of interactiveScopes(page)) {
        const snapshot = await collectSnapshot(scope);
        entries.push({ scope, snapshot });
        if ((snapshot.surfaces || []).some((surface) => surface.humanVerification === true && scoreBlockingSurface(surface) >= 0)) {
          humanBlocked = true;
        }
      }

      const blockingEntries = entries.filter(({ snapshot }) =>
        (snapshot.surfaces || []).some((surface) => scoreBlockingSurface(surface) >= 0));

      // Always prefer an explicit safe close control, including one hosted in a
      // child frame, before trying backdrop or Escape fallbacks.
      let selected = null;
      for (const entry of entries) {
        const choice = chooseSafeDismissal(entry.snapshot);
        if (choice.kind === 'control') {
          selected = { ...entry, choice };
          break;
        }
      }
      if (!selected && blockingEntries.length > 0) {
        for (const entry of entries) {
          const choice = chooseExplicitSafeCloseControl(entry.snapshot);
          if (choice.kind === 'control') {
            selected = { ...entry, choice };
            break;
          }
        }
      }

      if (selected) {
        const { scope, choice } = selected;
        const locator = scope.locator?.(`[${TOKEN_ATTR}="${choice.token}"]`);
        if (locator) {
          const count = typeof locator.count === 'function' ? await locator.count() : 1;
          if (count > 0) {
            const candidate = typeof locator.first === 'function' ? locator.first() : locator;
            if (typeof options.beforeDismiss === 'function') {
              await options.beforeDismiss({ locator:candidate, method:'control', label:choice.label || 'Close' });
            }
            const popup = await performDismissalWithPopupCleanup(page, lifetime, log, () => activateExplicitDismissControl(candidate), options);
            const disappeared = await verifyDismissControlGone(candidate, page, lifetime);
            if (!disappeared) {
              log(`Dismiss control remained visible after activation: ${choice.label || 'Close'}`);
              return { outcome:'none', attemptedDismissal:true, method:'control', label:choice.label || 'Close', popup:popup || undefined };
            }
            log(`Dismissed blocking surface: ${choice.label || 'Close'}`);
            await resolverWait(page, lifetime, 80);
            return { outcome:'dismissed', method:'control', label:choice.label || 'Close', popup:popup || undefined };
          }
        }
      }

      // Snapshot discovery can miss controls rendered in an open shadow root or
      // a rapidly changing third-party iframe. Only when a real blocker exists,
      // search every frame for an exact, explicit dismiss button. Exact matching
      // prevents promotional CTA labels such as Continue/Open/Download from being
      // treated as a close action.
      if (blockingEntries.length > 0) {
        const directClose = await findDirectSafeCloseControl(entries);
        if (directClose?.locator) {
          if (typeof options.beforeDismiss === 'function') {
            await options.beforeDismiss({ locator:directClose.locator, method:'control', label:directClose.label });
          }
          const popup = await performDismissalWithPopupCleanup(page, lifetime, log, () => activateExplicitDismissControl(directClose.locator), options);
          const disappeared = await verifyDismissControlGone(directClose.locator, page, lifetime);
          if (!disappeared) {
            log(`Dismiss control remained visible after activation: ${directClose.label}`);
            return { outcome:'none', attemptedDismissal:true, method:'control', label:directClose.label, popup:popup || undefined, crossScope:true };
          }
          log(`Dismissed blocking surface: ${directClose.label}`);
          await resolverWait(page, lifetime, 80);
          return { outcome:'dismissed', method:'control', label:directClose.label, popup:popup || undefined, crossScope:true };
        }
      }

      // Some third-party overlays (notably ad-vignette and consent SDKs) render
      // the dimming/backdrop outside the DOM tree visible to the current frame. In that
      // case no blocker surface is discoverable, but an exact Close/X control is still
      // visible inside a child frame or a modal-positioned top-level container. Treat only
      // that strongly contextual safe dismiss control as a blocker; never promotional CTAs.
      if (blockingEntries.length === 0) {
        const standaloneClose = await findDirectSafeCloseControl(entries, { requireBlockingContext:true });
        if (standaloneClose?.locator) {
          if (typeof options.beforeDismiss === 'function') {
            await options.beforeDismiss({ locator:standaloneClose.locator, method:'control', label:standaloneClose.label });
          }
          const popup = await performDismissalWithPopupCleanup(page, lifetime, log, () => standaloneClose.locator.click({ timeout:2500 }), options);
          const disappeared = await verifyDismissControlGone(standaloneClose.locator, page, lifetime);
          if (!disappeared) {
            log(`Dismiss control remained visible after activation: ${standaloneClose.label}`);
            return { outcome:'none', attemptedDismissal:true, method:'control', label:standaloneClose.label, popup:popup || undefined, standaloneBlocking:true };
          }
          log(`Dismissed blocking surface: ${standaloneClose.label}`);
          await resolverWait(page, lifetime, 80);
          return { outcome:'dismissed', method:'control', label:standaloneClose.label, popup:popup || undefined, standaloneBlocking:true };
        }
      }

      if (options.controlOnly === true) {
        return humanBlocked ? { outcome:'human-verification-blocked' } : { outcome:'none' };
      }

      // Only when no explicit safe close control exists do we consider the
      // older non-navigational fallbacks on a scope that actually contains a blocker.
      for (const { scope, snapshot } of blockingEntries) {
        const choice = chooseSafeDismissal(snapshot);
        if (choice.kind === 'backdrop') {
          const locator = scope.locator?.(`[${TOKEN_ATTR}="${choice.surfaceToken}"]`);
          if (locator) {
            const count = typeof locator.count === 'function' ? await locator.count() : 1;
            if (count > 0) {
              const blocker = typeof locator.first === 'function' ? locator.first() : locator;
              if (typeof options.beforeDismiss === 'function') {
                await options.beforeDismiss({ locator:blocker, method:'backdrop', label:'safe backdrop', point:choice.point });
              }
              const popup = await performDismissalWithPopupCleanup(page, lifetime, log, () => blocker.click({ position:choice.point, timeout:2500 }), options);
              log('Dismissed blocking surface: safe backdrop');
              await resolverWait(page, lifetime, 80);
              return { outcome:'dismissed', method:'backdrop', label:'safe backdrop', popup:popup || undefined };
            }
          }
        }
        if (choice.kind === 'escape' && page?.keyboard && typeof page.keyboard.press === 'function') {
          await page.keyboard.press('Escape');
          await resolverWait(page, lifetime, 150);
          const after = await collectSnapshot(scope);
          const stillBlocked = (after.surfaces || []).some((surface) => scoreBlockingSurface(surface) >= 0);
          if (!stillBlocked) {
            log('Dismissed blocking surface: Escape');
            return { outcome:'dismissed', method:'escape', label:'Escape' };
          }
        }
        if (choice.kind === 'human-verification-blocked') humanBlocked = true;
      }

      if (humanBlocked) return { outcome:'human-verification-blocked' };
      return { outcome:'none' };
    } catch {
      return humanBlocked ? { outcome:'human-verification-blocked' } : { outcome:'none' };
    } finally {
      for (const { scope } of entries) await cleanupScopeMarkers(scope);
    }
  }

  async function resolveLoop(maxDismissals = 5) {
    const cap = Math.max(1, Math.min(Number(maxDismissals) || 5, 10));
    let count = 0;
    for (let attempt = 0; attempt < cap; attempt += 1) {
      const result = await resolveOnce();
      if (result.outcome === 'dismissed') {
        count += 1;
        continue;
      }
      return { ...result, count };
    }
    return { outcome: count > 0 ? 'dismissed' : 'none', count };
  }

  return { inspect, resolveOnce, resolveLoop };
}

module.exports = {
  scoreBlockingSurface,
  activateExplicitDismissControl,
  chooseSafeDismissal,
  createBlockingSurfaceResolver,
};
