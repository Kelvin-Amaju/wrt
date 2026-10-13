const test = require('node:test');
const assert = require('node:assert/strict');
const { smoothScrollBy, runSmartInteraction, dismissSafeBlockingOverlay, clickWebsiteAction } = require('./smart-interaction.cjs');

test('smoothScrollBy breaks a long scroll into small deterministic increments', async () => {
  const deltas = [];
  const waits = [];
  const page = {
    evaluate: async (_fn, delta) => { deltas.push(delta); },
    waitForTimeout: async (ms) => { waits.push(ms); },
  };

  await smoothScrollBy(page, 250, { chunkSize: 100, delayMs: 12 });

  assert.deepEqual(deltas, [100, 100, 50]);
  assert.deepEqual(waits, [12, 12]);
});


function fakeElement(attrs = {}) {
  const events = [];
  return {
    attrs,
    events,
    async isVisible() { return typeof attrs.visible === 'function' ? attrs.visible() : attrs.visible !== false; },
    async isEnabled() { return attrs.enabled !== false; },
    async getAttribute(name) { return attrs[name] ?? null; },
    async textContent() { return attrs.text ?? ''; },
    async evaluate() { return attrs.promotionalOverlay === true; },
    async scrollIntoViewIfNeeded() { events.push(['scroll-into-view']); },
    async fill(value) { events.push(['fill', value]); },
    async pressSequentially(value, options) { events.push(['type', value, options?.delay]); if (typeof attrs.onType === 'function') attrs.onType(value); },
    async click() { events.push(['click']); if (typeof attrs.onClick === 'function') return attrs.onClick(); },
  };
}

function fakeList(items) {
  return {
    async count() { return items.length; },
    nth(index) { return items[index]; },
  };
}

test('smart interaction avoids sensitive fields, types progressively, and clicks a safe action', async () => {
  const password = fakeElement({ type: 'password', name: 'password' });
  const search = fakeElement({ type: 'search', name: 'q', placeholder: 'Search' });
  const buy = fakeElement({ text: 'Buy now' });
  const searchButton = fakeElement({ text: 'Search' });
  const scrollDeltas = [];
  const logs = [];
  const page = {
    locator(selector) {
      if (selector.includes('textarea')) return fakeList([password, search]);
      if (selector.includes('button')) return fakeList([buy, searchButton]);
      throw new Error(`Unexpected selector: ${selector}`);
    },
    async evaluate(_fn, delta) { scrollDeltas.push(delta); },
    async waitForTimeout() {},
  };

  const result = await runSmartInteraction(page, {
    value: 'OrbitQA proxy test',
    log: (message) => logs.push(message),
  });

  assert.equal(result.inputFound, true);
  assert.equal(result.actionClicked, true);
  assert.deepEqual(password.events, []);
  assert.deepEqual(search.events.filter((event) => event[0] === 'type'), [['type', 'OrbitQA proxy test', 65]]);
  assert.deepEqual(buy.events, []);
  assert.deepEqual(searchButton.events.filter((event) => event[0] === 'click'), [['click']]);
  assert.equal(scrollDeltas.some((delta) => delta > 0), true);
  assert.equal(scrollDeltas.some((delta) => delta < 0), true);
  assert.equal(logs.some((message) => /Found safe input/i.test(message)), true);
  assert.equal(logs.some((message) => /Clicked safe action: Search/i.test(message)), true);
});

test('smart interaction observes, dismisses a safe blocking overlay, browses to page bottom and back, then handles a new tab', async () => {
  const overlayClose = fakeElement({ text: 'Close' });
  const search = fakeElement({ type: 'search', name: 'q', placeholder: 'Search' });
  const searchButton = fakeElement({ text: 'Search' });
  const logs = [];
  const waits = [];
  const scrolls = [];
  let scrollY = 0;
  const originalPage = { close: async () => {} };
  let newPageClosed = false;
  const newPage = { close: async () => { newPageClosed = true; } };
  let pages = [originalPage];
  searchButton.click = async () => { searchButton.events.push(['click']); pages = [originalPage, newPage]; };

  const context = { pages: () => pages };
  const page = {
    context: () => context,
    locator(selector) {
      if (selector.includes('textarea')) return fakeList([search]);
      if (selector.includes('button')) return fakeList([overlayClose, searchButton]);
      throw new Error(`Unexpected selector: ${selector}`);
    },
    async evaluate(fn, arg) {
      const source = String(fn);
      if (source.includes('scrollHeight')) return { scrollY, maxScroll: 600 };
      if (source.includes('window.scrollBy')) { scrollY = Math.max(0, Math.min(600, scrollY + arg)); scrolls.push(arg); return; }
      return null;
    },
    async waitForTimeout(ms) { waits.push(ms); },
  };
  originalPage.context = () => context;

  const result = await runSmartInteraction(page, { value: 'OrbitQA proxy test', log: (message) => logs.push(message) });

  assert.equal(result.inputFound, true);
  assert.equal(result.actionClicked, true);
  assert.equal(newPageClosed, true);
  assert.equal(waits.reduce((total, ms) => total + ms, 0) >= 1000, true);
  assert.equal(scrolls.some((delta) => delta > 0), true);
  assert.equal(scrolls.some((delta) => delta < 0), true);
  assert.equal(logs.some((message) => /Observed page/i.test(message)), true);
  assert.equal(logs.some((message) => /Dismissed blocking overlay: Close/i.test(message)), true);
  assert.equal(logs.some((message) => /Reached page bottom/i.test(message)), true);
  assert.equal(logs.some((message) => /Closed QA-created tab/i.test(message)), true);
});

test('dismisses a safe blocking overlay inside a child frame', async () => {
  const close = fakeElement({ text: 'Close' });
  const frame = {
    locator(selector) {
      if (selector.includes('button')) return fakeList([close]);
      throw new Error(`Unexpected selector: ${selector}`);
    },
  };
  const logs = [];
  const page = {
    locator(selector) {
      if (selector.includes('button')) return fakeList([]);
      throw new Error(`Unexpected selector: ${selector}`);
    },
    frames: () => [frame],
    async waitForTimeout() {},
  };

  const label = await dismissSafeBlockingOverlay(page, (message) => logs.push(message));

  assert.equal(label, 'Close');
  assert.deepEqual(close.events.filter((event) => event[0] === 'click'), [['click']]);
  assert.equal(logs.some((message) => /Dismissed blocking overlay: Close/i.test(message)), true);
});

test('smart interaction prefers a safe action associated with the field over an unrelated page action', async () => {
  const download = fakeElement({ text: 'Download' });
  const searchButton = fakeElement({ text: 'Search' });
  const input = fakeElement({ type: 'url', name: 'video-url', placeholder: 'Paste video URL' });
  const formRoot = {
    async count() { return 1; },
    locator(selector) {
      if (selector.includes('button')) return fakeList([download]);
      throw new Error(`Unexpected selector: ${selector}`);
    },
  };
  input.locator = (selector) => {
    if (selector.includes('ancestor::form')) return formRoot;
    throw new Error(`Unexpected input selector: ${selector}`);
  };
  const page = {
    locator(selector) {
      if (selector.includes('textarea')) return fakeList([input]);
      if (selector.includes('button')) return fakeList([searchButton, download]);
      throw new Error(`Unexpected selector: ${selector}`);
    },
    async evaluate(fn, arg) {
      const source = String(fn);
      if (source.includes('scrollHeight')) return { scrollY: 0, maxScroll: 0 };
      if (source.includes('window.scrollBy')) return arg;
      return null;
    },
    async waitForTimeout() {},
  };
  const logs = [];

  const result = await runSmartInteraction(page, { value: 'https://example.com/video', log: (message) => logs.push(message) });

  assert.equal(result.actionLabel, 'Download');
  assert.deepEqual(download.events.filter((event) => event[0] === 'click'), [['click']]);
  assert.deepEqual(searchButton.events.filter((event) => event[0] === 'click'), []);
  assert.equal(logs.some((message) => /associated action: Download/i.test(message)), true);
});

test('smart interaction dismisses a late blocker and retries the intended website action once', async () => {
  let overlayVisible = false;
  let attempts = 0;
  const close = fakeElement({
    text: 'Close',
    visible: () => overlayVisible,
    onClick: () => { overlayVisible = false; },
  });
  const input = fakeElement({ type: 'url', name: 'video-url', placeholder: 'Paste video URL' });
  const download = fakeElement({ text: 'Download' });
  download.click = async () => {
    download.events.push(['click']);
    attempts += 1;
    if (attempts === 1) {
      overlayVisible = true;
      throw new Error('locator.click: element is intercepted by overlay');
    }
  };
  const formRoot = {
    async count() { return 1; },
    locator(selector) {
      if (selector.includes('button')) return fakeList([download]);
      throw new Error(`Unexpected selector: ${selector}`);
    },
  };
  input.locator = (selector) => {
    if (selector.includes('ancestor::form')) return formRoot;
    throw new Error(`Unexpected input selector: ${selector}`);
  };
  const logs = [];
  const page = {
    locator(selector) {
      if (selector.includes('textarea')) return fakeList([input]);
      if (selector.includes('button')) return fakeList([close, download]);
      throw new Error(`Unexpected selector: ${selector}`);
    },
    async evaluate(fn, arg) {
      const source = String(fn);
      if (source.includes('scrollHeight')) return { scrollY: 0, maxScroll: 0 };
      if (source.includes('window.scrollBy')) return arg;
      return null;
    },
    async waitForTimeout() {},
  };

  const result = await runSmartInteraction(page, { value: 'https://example.com/video', log: (message) => logs.push(message) });

  assert.equal(result.actionClicked, true);
  assert.equal(attempts, 2);
  assert.deepEqual(close.events.filter((event) => event[0] === 'click'), [['click']]);
  assert.equal(logs.some((message) => /retrying website action/i.test(message)), true);
});

test('blocked website action is skipped safely when an undismissable ad keeps intercepting the click', async () => {
  const clickTimeouts = [];
  const action = {
    label: 'Download',
    locator: {
      async scrollIntoViewIfNeeded() {},
      async click(options = {}) {
        clickTimeouts.push(options.timeout);
        throw new Error('locator.click: Timeout 10000ms exceeded; <iframe class="ad-layer"> intercepts pointer events');
      },
    },
  };
  const logs = [];
  const page = {
    context() { return { pages: () => [page] }; },
    async waitForTimeout() {},
  };
  const resolver = {
    async resolveLoop() { return { dismissed: [], humanVerification: false }; },
  };

  const clicked = await clickWebsiteAction(page, action, (message) => logs.push(message), { resolver });

  assert.equal(clicked, false);
  assert.equal(clickTimeouts.length, 1);
  assert.equal(clickTimeouts[0] <= 2500, true);
  assert.equal(logs.some((message) => /remained blocked.*skipping/i.test(message)), true);
});

test('smart interaction does not treat a promotional overlay Continue button as the website action', async () => {
  const adContinue = fakeElement({ text: 'Continue', promotionalOverlay: true });
  const pageNext = fakeElement({ text: 'Next' });
  const page = {
    locator(selector) {
      if (selector.includes('textarea')) return fakeList([]);
      if (selector.includes('button')) return fakeList([adContinue, pageNext]);
      throw new Error(`Unexpected selector: ${selector}`);
    },
    async evaluate(fn, arg) {
      const source = String(fn);
      if (source.includes('scrollHeight')) return { scrollY: 0, maxScroll: 0 };
      if (source.includes('window.scrollBy')) return arg;
      return null;
    },
    async waitForTimeout() {},
  };

  const result = await runSmartInteraction(page, { log: () => {} });

  assert.equal(result.actionLabel, 'Next');
  assert.deepEqual(adContinue.events.filter((event) => event[0] === 'click'), []);
  assert.deepEqual(pageNext.events.filter((event) => event[0] === 'click'), [['click']]);
});

test('dismisses a roleless X close control in an ad frame', async () => {
  const close = fakeElement({ text: '×', class: 'ad-close' });
  const frame = {
    locator(selector) {
      if (selector.includes('[class*="close"')) return fakeList([close]);
      return fakeList([]);
    },
  };
  const logs = [];
  const page = {
    locator() { return fakeList([]); },
    frames: () => [frame],
    async waitForTimeout() {},
  };

  const label = await dismissSafeBlockingOverlay(page, (message) => logs.push(message));

  assert.equal(label, '×');
  assert.deepEqual(close.events.filter((event) => event[0] === 'click'), [['click']]);
  assert.equal(logs.some((message) => /Dismissed blocking overlay: ×/i.test(message)), true);
});

test('smart interaction dismisses a blocker while scrolling instead of waiting until the bottom', async () => {
  const timeline = [];
  let overlayVisible = false;
  let scrollY = 0;
  const close = fakeElement({
    text: 'Close',
    visible: () => overlayVisible,
    onClick: () => { timeline.push('close'); overlayVisible = false; },
  });
  const page = {
    locator(selector) {
      if (selector.includes('textarea')) return fakeList([]);
      if (selector.includes('button')) return fakeList([close]);
      return fakeList([]);
    },
    async evaluate(fn, arg) {
      const source = String(fn);
      if (source.includes('scrollHeight')) return { scrollY, maxScroll: 330 };
      if (source.includes('window.scrollBy')) {
        scrollY = Math.max(0, Math.min(330, scrollY + arg));
        timeline.push(arg > 0 ? `down:${scrollY}` : `up:${scrollY}`);
        if (arg > 0 && scrollY >= 110 && !timeline.includes('close')) overlayVisible = true;
        return;
      }
      return null;
    },
    async waitForTimeout() {},
  };

  await runSmartInteraction(page, { log: () => {} });

  const closeIndex = timeline.indexOf('close');
  const lastDownIndex = timeline.reduce((last, item, index) => String(item).startsWith('down:') ? index : last, -1);
  assert.notEqual(closeIndex, -1);
  assert.equal(closeIndex < lastDownIndex, true, `expected overlay close during downward scrolling, got ${timeline.join(' | ')}`);
});

test('dismisses a custom roleless Close control by exact visible text when selector scan misses it', async () => {
  const close = fakeElement({ text: 'Close' });
  const logs = [];
  const page = {
    locator() { return fakeList([]); },
    getByText(text, options) {
      assert.equal(text, 'Close');
      assert.equal(options?.exact, true);
      return fakeList([close]);
    },
    frames: () => [],
    async waitForTimeout() {},
  };

  const label = await dismissSafeBlockingOverlay(page, (message) => logs.push(message));

  assert.equal(label, 'Close');
  assert.deepEqual(close.events.filter((event) => event[0] === 'click'), [['click']]);
  assert.equal(logs.some((message) => /Dismissed blocking overlay: Close/i.test(message)), true);
});

test('uses Escape as a last safe fallback when a matched Close control cannot be clicked', async () => {
  const close = fakeElement({ text: 'Close' });
  close.click = async () => { throw new Error('element is covered by ad chrome'); };
  const pressed = [];
  const logs = [];
  const page = {
    locator() { return fakeList([]); },
    getByText(text, options) {
      if (text === 'Close' && options?.exact === true) return fakeList([close]);
      return fakeList([]);
    },
    frames: () => [],
    keyboard: { press: async (key) => { pressed.push(key); } },
    async waitForTimeout() {},
  };

  const label = await dismissSafeBlockingOverlay(page, (message) => logs.push(message));

  assert.equal(label, 'Escape');
  assert.deepEqual(pressed, ['Escape']);
  assert.equal(logs.some((message) => /Escape fallback/i.test(message)), true);
});

test('smart interaction waits for manual human verification to disappear and then resumes without clicking it', async () => {
  const page = {
    locator(selector) {
      if (selector.includes('textarea')) return fakeList([]);
      if (selector.includes('button')) return fakeList([]);
      return fakeList([]);
    },
    async evaluate(fn, arg) {
      const source = String(fn);
      if (source.includes('scrollHeight')) return { scrollY: 0, maxScroll: 0 };
      if (source.includes('window.scrollBy')) return arg;
      return null;
    },
    async waitForTimeout() {},
  };
  let calls = 0;
  const resolver = {
    async resolveLoop() {
      calls += 1;
      if (calls <= 2) return { outcome: 'human-verification-blocked', count: 0 };
      return { outcome: 'none', count: 0 };
    },
  };
  let waits = 0;
  const lifetime = {
    remainingMs: () => 5000,
    throwIfExpired() {},
    async wait() { waits += 1; },
  };
  const logs = [];

  const result = await runSmartInteraction(page, {
    resolver,
    lifetime,
    observeMs: 500,
    scrollDriver: async () => ({ kind:'window', maxScroll:0, currentScroll:0 }),
    log: (message) => logs.push(message),
  });

  assert.deepEqual(result, { inputFound:false, actionClicked:false, actionLabel:undefined });
  assert.equal(waits > 0, true);
  assert.equal(logs.some((message) => /manual action/i.test(message)), true);
  assert.equal(logs.some((message) => /resuming/i.test(message)), true);
});

test('smart interaction uses scroll driver and visible indicator before typing and clicking', async () => {
  const input = fakeElement({ type:'search', name:'q', placeholder:'Search' });
  input.boundingBox = async () => ({ x:10, y:20, width:120, height:30 });
  const searchButton = fakeElement({ text:'Search' });
  searchButton.boundingBox = async () => ({ x:150, y:20, width:80, height:30 });
  const formRoot = { async count(){ return 1; }, locator(){ return fakeList([searchButton]); } };
  input.locator = () => formRoot;
  const page = {
    locator(selector) {
      if (selector.includes('textarea')) return fakeList([input]);
      if (selector.includes('button')) return fakeList([searchButton]);
      return fakeList([]);
    },
    async waitForTimeout() {},
  };
  const scrollCalls = [];
  const indicatorCalls = [];
  const scrollDriver = async (_page, options) => { scrollCalls.push(options.direction); return { kind:'window' }; };
  const indicator = {
    move: async (_page, target) => indicatorCalls.push(target === input ? 'input' : 'action'),
    pulse: async () => indicatorCalls.push('pulse'),
  };
  const result = await runSmartInteraction(page, {
    value:'OrbitQA test',
    resolver:{ resolveLoop: async () => ({ outcome:'none' }) },
    scrollDriver,
    indicator,
    indicatorMode:'cursor',
    observeMs:500,
  });
  assert.deepEqual(scrollCalls, ['down','up']);
  assert.deepEqual(indicatorCalls, ['input','action','pulse']);
  assert.equal(result.actionClicked, true);
});

test('smart interaction can use safe Refresh, Load more, or Play actions when no input is available', async () => {
  const refresh = fakeElement({ text: 'Refresh' });
  const page = {
    locator(selector) {
      if (selector.includes('textarea')) return fakeList([]);
      if (selector.includes('button')) return fakeList([refresh]);
      throw new Error(`Unexpected selector: ${selector}`);
    },
    async evaluate(fn, arg) {
      const source = String(fn);
      if (source.includes('scrollHeight')) return { scrollY: 0, maxScroll: 0 };
      if (source.includes('window.scrollBy')) return arg;
      return null;
    },
    async waitForTimeout() {},
  };
  const result = await runSmartInteraction(page, { log: () => {} });
  assert.equal(result.actionLabel, 'Refresh');
  assert.equal(result.actionClicked, true);
});

test('smart interaction honors a supplied per-work-unit pacing profile without changing safety selection', async () => {
  const input = fakeElement({ type: 'search', name: 'q', placeholder: 'Search' });
  const searchButton = fakeElement({ text: 'Search' });
  const scrollTimings = [];
  const waits = [];
  const page = {
    locator(selector) {
      if (selector.includes('textarea')) return fakeList([input]);
      if (selector.includes('button')) return fakeList([searchButton]);
      throw new Error(`Unexpected selector: ${selector}`);
    },
    async waitForTimeout(ms) { waits.push(ms); },
  };
  const pacing = {
    observeMs: 1111,
    betweenScrollMs: 777,
    typingDelayMs: 82,
    preActionMs: 333,
    postActionMs: 888,
    scrollChunkPx: 57,
    scrollDelayMs: 73,
  };
  const scrollDriver = async (_page, options) => {
    scrollTimings.push(options.timing);
    return { kind: 'window', token: null, maxScroll: 100 };
  };

  const result = await runSmartInteraction(page, {
    value: 'OrbitQA paced QA',
    pacing,
    scrollDriver,
    log: () => {},
  });

  assert.equal(result.inputFound, true);
  assert.equal(result.actionClicked, true);
  assert.deepEqual(input.events.filter((event) => event[0] === 'type'), [['type', 'OrbitQA paced QA', 82]]);
  assert.equal(scrollTimings.length, 2);
  assert.deepEqual(scrollTimings[0], { stepPx: 57, delayMs: 73 });
  assert.deepEqual(scrollTimings[1], { stepPx: 57, delayMs: 73 });
  assert.equal(waits.reduce((total, value) => total + value, 0) >= 1111 + 777 + 333 + 888, true);
});

test('smart interaction sends direction-specific varied scroll timing from the work-unit pacing profile', async () => {
  const page = {
    locator(selector) {
      if (selector.includes('textarea')) return fakeList([]);
      if (selector.includes('button')) return fakeList([]);
      return fakeList([]);
    },
    async waitForTimeout() {},
  };
  const scrollTimings = [];
  const pacing = {
    observeMs: 900,
    betweenScrollMs: 500,
    typingDelayMs: 80,
    preActionMs: 300,
    postActionMs: 700,
    scrollDelayMs: 100,
    scrollStepPatternPx: [110, 160, 95, 140, 125, 175],
    scrollDownTargetRatio: 0.86,
    scrollUpTargetRatio: 0.08,
    scrollPauseEverySteps: 4,
    scrollPauseMs: 360,
    scrollLogEverySteps: 3,
    interactionMode: 'touch',
  };
  const scrollDriver = async (_page, options) => {
    scrollTimings.push({ direction: options.direction, timing: options.timing });
    return { kind:'window', token:null, maxScroll:1000 };
  };

  await runSmartInteraction(page, {
    pacing,
    scrollDriver,
    resolver:{ resolveLoop: async () => ({ outcome:'none' }) },
    log:() => {},
  });

  assert.equal(scrollTimings.length, 2);
  assert.deepEqual(scrollTimings[0], {
    direction:'down',
    timing:{
      stepPatternPx:pacing.scrollStepPatternPx,
      delayMs:100,
      pauseEverySteps:4,
      pauseMs:360,
      targetRatio:0.86,
      logEverySteps:3,
    },
  });
  assert.deepEqual(scrollTimings[1], {
    direction:'up',
    timing:{
      stepPatternPx:pacing.scrollStepPatternPx,
      delayMs:100,
      pauseEverySteps:4,
      pauseMs:360,
      targetRatio:0.08,
      logEverySteps:3,
    },
  });
});

test('mobile safe actions prefer a tap and log a single touch action', async () => {
  const events = [];
  const logs = [];
  const action = {
    label:'Submit',
    locator:{
      async scrollIntoViewIfNeeded() {},
      async tap(options = {}) { events.push(['tap', options.timeout]); },
      async click(options = {}) { events.push(['click', options.timeout]); },
    },
  };
  const page = {
    context() { return { pages:() => [page] }; },
    async waitForTimeout() {},
  };
  const resolver = { async resolveLoop() { return { outcome:'none', count:0 }; } };

  const clicked = await clickWebsiteAction(page, action, (message) => logs.push(message), {
    resolver,
    postActionMs:0,
    interactionMode:'touch',
  });

  assert.equal(clicked, true);
  assert.deepEqual(events, [['tap', 2500]]);
  assert.equal(logs.filter((message) => /safe action: Submit/i.test(message)).length, 1);
  assert.equal(logs.some((message) => /Tapped safe action: Submit/i.test(message)), true);
});

test('fallback document scrolling also honors varied bounded manual-QA pacing', async () => {
  const deltas = [];
  const waits = [];
  const logs = [];
  let scrollY = 0;
  const page = {
    async evaluate(fn, arg) {
      const source = String(fn);
      if (source.includes('scrollHeight')) return { scrollY, maxScroll: 1000 };
      if (source.includes('window.scrollBy')) {
        scrollY = Math.max(0, Math.min(1000, scrollY + arg));
        deltas.push(Math.abs(arg));
        return;
      }
      return null;
    },
    async waitForTimeout(ms) { waits.push(ms); },
  };

  const { smoothScrollDocument } = require('./smart-interaction.cjs');
  await smoothScrollDocument(page, 'down', {
    log:(message) => logs.push(message),
    stepPatternPx:[120, 175, 95, 150],
    targetRatio:0.81,
    delayMs:0,
    pauseEverySteps:2,
    pauseMs:220,
    logEverySteps:2,
  });

  assert.equal(scrollY >= 790 && scrollY <= 820, true, `expected bounded target near 81%, got ${scrollY}`);
  assert.equal(new Set(deltas).size > 1, true);
  assert.equal(waits.includes(220), true);
  assert.equal(logs.some((message) => /Browsing scroll down: \d+%/i.test(message)), true);
  assert.equal(logs.some((message) => /Browsing scroll down: 20%/i.test(message)), false);
});
