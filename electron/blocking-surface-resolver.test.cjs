const test = require('node:test');
const assert = require('node:assert/strict');
const {
  scoreBlockingSurface,
  chooseSafeDismissal,
  createBlockingSurfaceResolver,
} = require('./blocking-surface-resolver.cjs');

function surface(overrides = {}) {
  return {
    token: 'surface-1',
    overlapRatio: 0.72,
    topmostHits: 3,
    semantic: false,
    pattern: true,
    position: 'fixed',
    zIndex: 1000,
    humanVerification: false,
    rect: { x: 100, y: 100, width: 800, height: 500 },
    safeBackdropPoints: [],
    ...overrides,
  };
}

function control(overrides = {}) {
  return {
    token: 'control-1',
    surfaceToken: 'surface-1',
    label: 'Close',
    metadata: 'close',
    closeSemantic: true,
    dangerous: false,
    rect: { x: 850, y: 110, width: 30, height: 30 },
    ...overrides,
  };
}

test('scores a custom fixed DIV as blocking when it materially covers and intercepts the viewport', () => {
  assert.equal(scoreBlockingSurface(surface()) > 0, true);
  assert.equal(scoreBlockingSurface(surface({ overlapRatio: 0.02, topmostHits: 0, pattern: false, position: 'static', zIndex: 1 })), -1);
});

test('chooses explicit custom Close control even when it is a roleless element', () => {
  const result = chooseSafeDismissal({ surfaces: [surface()], controls: [control({ clickable: false })] });
  assert.equal(result.kind, 'control');
  assert.equal(result.token, 'control-1');
});

test('chooses an external X near the blocker upper-right edge', () => {
  const result = chooseSafeDismissal({
    surfaces: [surface()],
    controls: [control({ token: 'external-x', surfaceToken: null, label: '×', metadata: 'ad-close', rect: { x: 885, y: 90, width: 24, height: 24 } })],
  });
  assert.equal(result.kind, 'control');
  assert.equal(result.token, 'external-x');
});

test('uses only verified non-navigational backdrop points and never random actions', () => {
  const result = chooseSafeDismissal({
    surfaces: [surface({ safeBackdropPoints: [{ x: 12, y: 12 }] })],
    controls: [control({ label: 'Continue', metadata: 'sponsored offer', closeSemantic: false, dangerous: true })],
  });
  assert.deepEqual(result, { kind: 'backdrop', surfaceToken: 'surface-1', point: { x: 12, y: 12 } });
});

test('never selects human-verification control but allows an independent safe X', () => {
  const blocked = surface({ humanVerification: true, semantic: true });
  const challenge = control({ token: 'captcha', label: "I'm not a robot", metadata: 'recaptcha verify', closeSemantic: false, dangerous: true });
  const blockedChoice = chooseSafeDismissal({ surfaces: [blocked], controls: [challenge] });
  assert.equal(blockedChoice.kind, 'human-verification-blocked');

  const dismiss = control({ token: 'safe-x', label: '×', metadata: 'close', closeSemantic: true, dangerous: false });
  const dismissChoice = chooseSafeDismissal({ surfaces: [blocked], controls: [challenge, dismiss] });
  assert.equal(dismissChoice.kind, 'control');
  assert.equal(dismissChoice.token, 'safe-x');
});

test('resolver clicks selected safe control and logs dismissal', async () => {
  const clicks = [];
  const logs = [];
  const scope = {
    async evaluate(fn) {
      const source = String(fn);
      if (source.includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) {
        return { surfaces: [surface()], controls: [control()] };
      }
      return null;
    },
    locator(selector) {
      return {
        async count() { return 1; },
        first() { return this; },
        async click() { clicks.push(selector); },
      };
    },
  };
  const page = {
    ...scope,
    frames: () => [],
    keyboard: { async press() {} },
    async waitForTimeout() {},
  };

  const resolver = createBlockingSurfaceResolver({ page, log: (message) => logs.push(message) });
  const result = await resolver.resolveOnce();
  assert.equal(result.outcome, 'dismissed');
  assert.equal(clicks.length, 1);
  assert.equal(logs.some((message) => /Dismissed blocking surface: Close/i.test(message)), true);
});

test('chooses a small unlabeled clickable control at the blocker upper-right edge', () => {
  const result = chooseSafeDismissal({
    surfaces: [surface()],
    controls: [control({
      token: 'geometry-x',
      label: '',
      metadata: '',
      closeSemantic: false,
      upperRightCandidate: true,
      dangerous: false,
      rect: { x: 864, y: 105, width: 28, height: 28 },
    })],
  });
  assert.equal(result.kind, 'control');
  assert.equal(result.token, 'geometry-x');
});

test('safe dismissal closes only the popup opened by that dismissal and restores the primary page', async () => {
  let popupClosed = false;
  let restored = false;
  const popup = {
    async waitForLoadState() {},
    async close() { popupClosed = true; },
  };
  const scope = {
    async evaluate(fn) {
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) {
        return { surfaces: [surface()], controls: [control()] };
      }
      return null;
    },
    locator() {
      return { async count() { return 1; }, first() { return this; }, async click() {} };
    },
  };
  const page = {
    ...scope,
    frames: () => [],
    keyboard: { async press() {} },
    async waitForTimeout() {},
    async waitForEvent(name) {
      assert.equal(name, 'popup');
      return popup;
    },
    async bringToFront() { restored = true; },
  };

  const resolver = createBlockingSurfaceResolver({ page });
  const result = await resolver.resolveOnce();
  assert.equal(result.outcome, 'dismissed');
  assert.equal(popupClosed, true);
  assert.equal(restored, true);
});

test('snapshot ignores OrbitQA visual interaction indicators', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, 'blocking-surface-resolver.cjs'), 'utf8');
  assert.match(source, /data-orbitqa-indicator/);
});

test('Auto QA can preserve a popup from safe blocker dismissal for supervised observation', async () => {
  let popupClosed = 0;
  const popup = {
    async waitForLoadState() {},
    async close() { popupClosed += 1; },
  };
  const scope = {
    async evaluate(fn) {
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) {
        return { surfaces: [surface()], controls: [control()] };
      }
      return null;
    },
    locator() {
      return { async count() { return 1; }, first() { return this; }, async click() {} };
    },
  };
  const page = {
    ...scope,
    frames: () => [],
    keyboard: { async press() {} },
    async waitForTimeout() {},
    async waitForEvent() { return popup; },
    async bringToFront() {},
  };
  const resolver = createBlockingSurfaceResolver({ page, log:() => {} });
  const result = await resolver.resolveOnce({ preservePopup:true });
  assert.equal(result.outcome, 'dismissed');
  assert.equal(result.popup, popup);
  assert.equal(popupClosed, 0);
});

test('controlOnly dismissal never falls back to backdrop or Escape', async () => {
  let backdropClicks = 0;
  let escapePresses = 0;
  const scope = {
    async evaluate(fn) {
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) {
        return { surfaces:[surface({ safeBackdropPoints:[{x:10,y:10}] })], controls:[] };
      }
      return null;
    },
    locator() {
      return { async count(){ return 1; }, first(){ return this; }, async click(){ backdropClicks += 1; } };
    },
  };
  const page = { ...scope, frames:()=>[], keyboard:{ async press(){ escapePresses += 1; } }, async waitForTimeout(){} };
  const resolver = createBlockingSurfaceResolver({ page });
  const result = await resolver.resolveOnce({ controlOnly:true });
  assert.equal(result.outcome, 'none');
  assert.equal(backdropClicks, 0);
  assert.equal(escapePresses, 0);
});

test('resolver can use an explicit safe Close control inside a child frame for a blocking parent overlay', async () => {
  let frameClicks = 0;
  const mainScope = {
    async evaluate(fn) {
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) return { surfaces:[surface()], controls:[] };
      return null;
    },
    locator() { return { async count(){ return 0; }, first(){ return this; }, async click(){} }; },
  };
  const frame = {
    async evaluate(fn) {
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) {
        return { surfaces:[], controls:[control({ token:'frame-close', surfaceToken:null, label:'Close', metadata:'close', closeSemantic:true, dangerous:false })] };
      }
      return null;
    },
    locator(selector) {
      return { async count(){ return selector.includes('frame-close') ? 1 : 0; }, first(){ return this; }, async click(){ frameClicks += 1; } };
    },
  };
  const page = {
    ...mainScope,
    frames:()=>[frame],
    keyboard:{ async press(){} },
    async waitForTimeout(){},
  };
  const resolver = createBlockingSurfaceResolver({ page, log:()=>{} });
  const result = await resolver.resolveOnce({ controlOnly:true, preservePopup:true });
  assert.equal(result.outcome, 'dismissed');
  assert.equal(result.label, 'Close');
  assert.equal(frameClicks, 1);
});

test('cross-frame explicit Close is preferred over parent backdrop dismissal', async () => {
  let frameClicks = 0;
  let backdropClicks = 0;
  const mainScope = {
    async evaluate(fn) {
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) {
        return { surfaces:[surface({ safeBackdropPoints:[{x:12,y:12}] })], controls:[] };
      }
      return null;
    },
    locator() { return { async count(){ return 1; }, first(){ return this; }, async click(){ backdropClicks += 1; } }; },
  };
  const frame = {
    async evaluate(fn) {
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) {
        return { surfaces:[], controls:[control({ token:'frame-close-priority', surfaceToken:null, label:'Close', metadata:'close', closeSemantic:true, dangerous:false })] };
      }
      return null;
    },
    locator(selector) { return { async count(){ return selector.includes('frame-close-priority') ? 1 : 0; }, first(){ return this; }, async click(){ frameClicks += 1; } }; },
  };
  const page = { ...mainScope, frames:()=>[frame], keyboard:{async press(){}}, async waitForTimeout(){} };
  const resolver = createBlockingSurfaceResolver({ page });
  const result = await resolver.resolveOnce({ preservePopup:true });
  assert.equal(result.outcome, 'dismissed');
  assert.equal(result.method, 'control');
  assert.equal(frameClicks, 1);
  assert.equal(backdropClicks, 0);
});

test('resolver finds an exact safe Close button in a child frame even when DOM snapshot tokenization misses it', async () => {
  let closeClicks = 0;
  let continueClicks = 0;
  const mainScope = {
    async evaluate(fn) {
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) return { surfaces:[surface({ text:'', semantic:false, pattern:true })], controls:[] };
      return null;
    },
    locator() { return { async count(){ return 0; }, first(){ return this; }, async click(){} }; },
  };
  const closeLocator = { async count(){ return 1; }, first(){ return this; }, async click(){ closeClicks += 1; } };
  const emptyLocator = { async count(){ return 0; }, first(){ return this; }, async click(){} };
  const frame = {
    async evaluate(fn) {
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) return { surfaces:[], controls:[] };
      return null;
    },
    locator(selector) {
      if (/continue/i.test(String(selector))) return { async count(){ return 1; }, first(){ return this; }, async click(){ continueClicks += 1; } };
      return emptyLocator;
    },
    getByRole(role, options) {
      if (role === 'button' && /^close$/i.test(String(options?.name || ''))) return closeLocator;
      return emptyLocator;
    },
  };
  const page = { ...mainScope, frames:()=>[frame], keyboard:{async press(){}}, async waitForTimeout(){} };
  const resolver = createBlockingSurfaceResolver({ page });
  const result = await resolver.resolveOnce({ controlOnly:true, preservePopup:true });
  assert.equal(result.outcome, 'dismissed');
  assert.equal(result.label, 'Close');
  assert.equal(closeClicks, 1);
  assert.equal(continueClicks, 0);
});

test('direct cross-frame fallback never clicks Continue when no explicit dismiss control exists', async () => {
  let continueClicks = 0;
  const mainScope = {
    async evaluate(fn) {
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) return { surfaces:[surface({ text:'', pattern:true })], controls:[] };
      return null;
    },
    locator() { return { async count(){ return 0; }, first(){ return this; }, async click(){} }; },
  };
  const emptyLocator = { async count(){ return 0; }, first(){ return this; }, async click(){} };
  const frame = {
    async evaluate(fn) {
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) return { surfaces:[], controls:[] };
      return null;
    },
    getByRole(role, options) {
      if (role === 'button' && /^continue$/i.test(String(options?.name || ''))) {
        return { async count(){ return 1; }, first(){ return this; }, async click(){ continueClicks += 1; } };
      }
      return emptyLocator;
    },
    locator() { return emptyLocator; },
  };
  const page = { ...mainScope, frames:()=>[frame], keyboard:{async press(){}}, async waitForTimeout(){} };
  const resolver = createBlockingSurfaceResolver({ page });
  const result = await resolver.resolveOnce({ controlOnly:true, preservePopup:true });
  assert.equal(result.outcome, 'none');
  assert.equal(continueClicks, 0);
});

test('resolver does not report verified dismissal when the explicit Close control remains visibly present', async () => {
  let clicks = 0;
  const stickyClose = {
    async count(){ return 1; }, first(){ return this; }, async click(){ clicks += 1; }, async isVisible(){ return true; },
  };
  const empty = { async count(){ return 0; }, first(){ return this; }, async click(){} };
  const main = {
    async evaluate(fn){ if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) return { surfaces:[surface({pattern:true})], controls:[] }; return null; },
    locator(){ return empty; },
  };
  const frame = {
    async evaluate(fn){ if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) return { surfaces:[], controls:[] }; return null; },
    getByRole(role, options){ return role === 'button' && /^close$/i.test(String(options?.name || '')) ? stickyClose : empty; },
    locator(){ return empty; },
  };
  const page = { ...main, frames:()=>[frame], keyboard:{async press(){}}, async waitForTimeout(){} };
  const resolver = createBlockingSurfaceResolver({ page });
  const result = await resolver.resolveOnce({ controlOnly:true, preservePopup:true });
  assert.equal(clicks, 1);
  assert.equal(result.outcome, 'none');
  assert.equal(result.attemptedDismissal, true);
});

test('resolver can dismiss an exact Close link inside a child frame when a promotional iframe blocks the page', async () => {
  let linkClicks = 0;
  const emptyLocator = { async count(){ return 0; }, first(){ return this; }, async click(){} };
  const mainScope = {
    async evaluate(fn) {
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) return { surfaces:[surface({ text:'Sponsored advertisement popup', pattern:true })], controls:[] };
      return null;
    },
    locator(){ return emptyLocator; },
    getByRole(){ return emptyLocator; },
  };
  const closeLink = { async count(){ return 1; }, first(){ return this; }, async click(){ linkClicks += 1; }, async isVisible(){ return false; } };
  const frame = {
    async evaluate(fn) {
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) return { surfaces:[], controls:[] };
      return null;
    },
    locator(){ return emptyLocator; },
    getByRole(role, options) {
      if (role === 'link' && /^close$/i.test(String(options?.name || ''))) return closeLink;
      return emptyLocator;
    },
  };
  const page = { ...mainScope, frames:()=>[frame], keyboard:{async press(){}}, async waitForTimeout(){} };
  const resolver = createBlockingSurfaceResolver({ page, log:()=>{} });
  const result = await resolver.resolveOnce({ controlOnly:true, preservePopup:true });
  assert.equal(result.outcome, 'dismissed');
  assert.equal(result.label, 'Close');
  assert.equal(linkClicks, 1);
});

test('dominant viewport blocker may use a small pointer-style upper-right DOM X candidate', () => {
  const snapshot = {
    surfaces:[surface({ token:'full', rect:{x:0,y:0,width:1200,height:800}, overlapRatio:0.95, topmostHits:5, zIndex:9999, pattern:true })],
    controls:[control({ token:'corner-x', surfaceToken:null, label:'', metadata:'', closeSemantic:false, dangerous:false, rect:{x:1168,y:10,width:24,height:24}, viewportUpperRightCandidate:true })],
  };
  const choice = require('./blocking-surface-resolver.cjs').chooseSafeDismissal(snapshot);
  assert.equal(choice.kind, 'control');
  assert.equal(choice.token, 'corner-x');
});

test('human-verification surface never uses backdrop or Escape when no separate safe close control exists', () => {
  const blocked = surface({ humanVerification: true, semantic: true, safeBackdropPoints: [{ x: 10, y: 10 }] });
  const choice = chooseSafeDismissal({ surfaces: [blocked], controls: [] });
  assert.equal(choice.kind, 'human-verification-blocked');
});

test('resolver finds an exact visible Close text control even when the ad uses a custom roleless element', async () => {
  let closeClicks = 0;
  let continueClicks = 0;
  const empty = { async count(){ return 0; }, first(){ return this; }, async click(){} };
  const closeText = { async count(){ return 1; }, first(){ return this; }, async click(){ closeClicks += 1; }, async isVisible(){ return false; } };
  const continueText = { async count(){ return 1; }, first(){ return this; }, async click(){ continueClicks += 1; } };
  const page = {
    async evaluate(fn){
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) {
        return { surfaces:[surface({ text:'Final step available Resume download Close Continue', pattern:true })], controls:[] };
      }
      return null;
    },
    frames:()=>[],
    locator(){ return empty; },
    getByRole(){ return empty; },
    getByText(label, options){
      if (options?.exact === true && /^close$/i.test(String(label))) return closeText;
      if (options?.exact === true && /^continue$/i.test(String(label))) return continueText;
      return empty;
    },
    keyboard:{ async press(){} },
    async waitForTimeout(){},
  };
  const resolver = createBlockingSurfaceResolver({ page, log:()=>{} });
  const result = await resolver.resolveOnce({ controlOnly:true, preservePopup:true });
  assert.equal(result.outcome, 'dismissed');
  assert.equal(result.label, 'Close');
  assert.equal(closeClicks, 1);
  assert.equal(continueClicks, 0);
});

test('standalone exact Close control in a child ad frame is treated as a blocker even when snapshot surface detection misses the overlay', async () => {
  let closeClicks = 0;
  const empty = { async count(){ return 0; }, first(){ return this; }, async click(){}, async isVisible(){ return false; } };
  const closeLocator = {
    async count(){ return 1; }, first(){ return this; },
    async isVisible(){ return closeClicks === 0; },
    async click(){ closeClicks += 1; },
    async evaluate(){ return true; },
  };
  const main = {
    async evaluate(fn){ if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) return { surfaces:[], controls:[] }; return null; },
    locator(){ return empty; }, getByRole(){ return empty; }, getByText(){ return empty; },
  };
  const frame = {
    async evaluate(fn){ if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) return { surfaces:[], controls:[] }; return null; },
    locator(){ return empty; },
    getByRole(role, options){ return role === 'button' && /^close$/i.test(String(options?.name || '')) ? closeLocator : empty; },
    getByText(){ return empty; },
  };
  const page = { ...main, frames:()=>[frame], async waitForTimeout(){}, keyboard:{async press(){}} };
  const resolver = createBlockingSurfaceResolver({ page, log:()=>{} });
  const before = await resolver.inspect();
  assert.equal(before.blocked, true);
  const result = await resolver.resolveOnce({ controlOnly:true, preservePopup:true });
  assert.equal(result.outcome, 'dismissed');
  assert.equal(result.label, 'Close');
  assert.equal(closeClicks, 1);
});

test('standalone normal page Close text is not treated as a blocker without blocking visual context', async () => {
  const empty = { async count(){ return 0; }, first(){ return this; }, async click(){}, async isVisible(){ return false; } };
  const harmlessClose = {
    async count(){ return 1; }, first(){ return this; }, async isVisible(){ return true; }, async click(){ throw new Error('must not click'); },
    async evaluate(){ return false; },
  };
  const page = {
    async evaluate(fn){ if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) return { surfaces:[], controls:[] }; return null; },
    frames:()=>[], locator(){ return empty; },
    getByRole(role, options){ return role === 'button' && /^close$/i.test(String(options?.name || '')) ? harmlessClose : empty; },
    getByText(){ return empty; }, async waitForTimeout(){}, keyboard:{async press(){}} ,
  };
  const resolver = createBlockingSurfaceResolver({ page, log:()=>{} });
  const state = await resolver.inspect();
  assert.equal(state.blocked, false);
  const result = await resolver.resolveOnce({ controlOnly:true, preservePopup:true });
  assert.equal(result.outcome, 'none');
});

test('verified explicit Close may use force fallback when a blocker intercepts the normal click', async () => {
  const calls = [];
  const empty = { async count(){ return 0; }, first(){ return this; }, async click(){}, async isVisible(){ return false; } };
  let closed = false;
  const closeLocator = {
    async count(){ return 1; }, first(){ return this; },
    async isVisible(){ return !closed; },
    async click(options = {}) {
      calls.push(options);
      if (!options.force) throw new Error('iframe intercepts pointer events');
      closed = true;
    },
    async evaluate(){ return true; },
  };
  const page = {
    async evaluate(fn){
      if (String(fn).includes('ORBITQA_BLOCKING_SURFACE_SNAPSHOT')) {
        return closed ? { surfaces:[], controls:[] } : { surfaces:[surface({ text:'Ad popup Close Continue', pattern:true })], controls:[] };
      }
      return null;
    },
    frames:()=>[], locator(){ return empty; }, getByRole(){ return empty; },
    getByText(label, options){ return options?.exact === true && /^close$/i.test(String(label)) ? closeLocator : empty; },
    keyboard:{ async press(){} }, async waitForTimeout(){},
  };
  const resolver = createBlockingSurfaceResolver({ page, log:()=>{} });
  const result = await resolver.resolveOnce({ controlOnly:true, preservePopup:true });
  assert.equal(result.outcome, 'dismissed');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].force, true);
});
