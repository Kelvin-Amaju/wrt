const {waitBeforePageInteraction}=require('./mandatory-interaction-delay.cjs');
const INDICATOR_ATTR = 'data-orbitqa-indicator';

function indicatorModeForExecutionKind(kind) {
  return kind === 'desktop' ? 'cursor' : 'touch';
}

async function indicatorBridge(page, payload) {
  if (!page || typeof page.evaluate !== 'function') return false;
  try {
    return await page.evaluate(({ command, mode, x, y }) => {
      const attr = 'data-orbitqa-indicator';
      let root = document.querySelector(`[${attr}="root"]`);
      const ensure = () => {
        if (root) return root;
        root = document.createElement('div');
        root.setAttribute(attr, 'root');
        root.setAttribute('aria-hidden', 'true');
        Object.assign(root.style, {
          position: 'fixed', left: '0px', top: '0px', width: '20px', height: '20px',
          zIndex: '2147483647', pointerEvents: 'none', userSelect: 'none',
          transform: 'translate(-50%, -50%)', transition: 'left 160ms linear, top 160ms linear, transform 90ms ease',
          boxSizing: 'border-box', opacity: '0.92',
        });
        document.documentElement.appendChild(root);
        return root;
      };
      if (command === 'remove') {
        root?.remove();
        return true;
      }
      root = ensure();
      root.dataset.mode = mode || 'cursor';
      if (mode === 'touch') {
        Object.assign(root.style, {
          width: '28px', height: '28px', borderRadius: '50%', border: '3px solid rgba(30,30,30,.8)',
          background: 'rgba(255,255,255,.45)', boxShadow: '0 0 0 2px rgba(255,255,255,.75)',
          clipPath: 'none',
        });
      } else {
        Object.assign(root.style, {
          width: '18px', height: '24px', borderRadius: '2px 12px 12px 12px', border: '2px solid white',
          background: 'rgba(20,20,20,.92)', boxShadow: '0 1px 4px rgba(0,0,0,.45)',
          clipPath: 'polygon(0 0, 0 100%, 34% 70%, 55% 100%, 70% 91%, 49% 62%, 100% 60%)',
        });
      }
      if (command === 'move') {
        root.style.left = `${Math.max(0, Number(x) || 0)}px`;
        root.style.top = `${Math.max(0, Number(y) || 0)}px`;
      }
      if (command === 'pulse') {
        root.animate?.([
          { transform:'translate(-50%, -50%) scale(1)' },
          { transform:'translate(-50%, -50%) scale(.72)' },
          { transform:'translate(-50%, -50%) scale(1)' },
        ], { duration:180, easing:'ease-out' });
      }
      return true;
    }, payload);
  } catch {
    return false;
  }
}

async function installInteractionIndicator(page, options = {}) {
  return indicatorBridge(page, { command:'install', mode:options.mode === 'touch' ? 'touch' : 'cursor' });
}

async function moveInteractionIndicator(page, target, options = {}) {
  if (!target || typeof target.boundingBox !== 'function') return false;
  let box;
  try { box = await target.boundingBox(); } catch { box = null; }
  if (!box) return false;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  return indicatorBridge(page, { command:'move', mode:options.mode === 'touch' ? 'touch' : 'cursor', x, y });
}


async function moveInteractionIndicatorToPoint(page, point = {}, options = {}) {
  const x = Math.max(0, Number(point.x) || 0);
  const y = Math.max(0, Number(point.y) || 0);
  return indicatorBridge(page, { command:'move', mode:options.mode === 'touch' ? 'touch' : 'cursor', x, y });
}

async function pulseInteractionIndicator(page, options = {}) {
  return indicatorBridge(page, { command:'pulse', mode:options.mode === 'touch' ? 'touch' : 'cursor' });
}

async function clickWithInteractionIndicator(page, target, options = {}) {
  if (!target) throw new Error('Click target is required');
  const requestedMode=options.mode || page?.__orbitqaInteractionMode || 'cursor';
  const mode = requestedMode === 'touch' ? 'touch' : 'cursor';
  const timeout = Math.max(250, Number(options.timeout) || 7000);
  const force = Boolean(options.force);
  try { await target.scrollIntoViewIfNeeded?.(); } catch {}
  await installInteractionIndicator(page, { mode }).catch(() => undefined);

  if (mode === 'cursor' && page?.mouse && typeof page.mouse.move === 'function' && typeof page.mouse.click === 'function' && typeof target.boundingBox === 'function') {
    let box = null;
    try { box = await target.boundingBox(); } catch {}
    if (box && box.width > 0 && box.height > 0) {
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await moveInteractionIndicatorToPoint(page, { x, y }, { mode:'cursor' }).catch(() => undefined);
      try { await page.mouse.move(x, y, { steps:Math.max(4, Number(options.steps) || 10) }); } catch { await page.mouse.move(x, y); }
      await waitBeforePageInteraction({signal:options.signal,lifetime:options.lifetime,wait:options.wait});
      await pulseInteractionIndicator(page, { mode:'cursor' }).catch(() => undefined);
      await page.mouse.click(x, y, { delay:Math.max(20, Number(options.delay) || 70) });
      return true;
    }
  }

  await moveInteractionIndicator(page, target, { mode }).catch(() => undefined);
  await waitBeforePageInteraction({signal:options.signal,lifetime:options.lifetime,wait:options.wait});
  await pulseInteractionIndicator(page, { mode }).catch(() => undefined);
  if (mode === 'touch' && typeof target.tap === 'function') {
    try { await target.tap({ timeout }); return true; } catch {}
  }
  if (typeof target.click !== 'function') throw new Error('Click target does not expose click()');
  await target.click({ timeout, ...(force ? { force:true } : {}) });
  return true;
}

async function removeInteractionIndicator(page) {
  return indicatorBridge(page, { command:'remove', mode:'cursor' });
}

module.exports = {
  INDICATOR_ATTR,
  indicatorModeForExecutionKind,
  installInteractionIndicator,
  moveInteractionIndicator,
  moveInteractionIndicatorToPoint,
  pulseInteractionIndicator,
  clickWithInteractionIndicator,
  removeInteractionIndicator,
};
