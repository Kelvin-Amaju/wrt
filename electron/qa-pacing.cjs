function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value || 'orbitqa')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function integerBetween(random, min, max) {
  return Math.floor(random() * (max - min + 1)) + min;
}

function ratioBetween(random, min, max) {
  const value = min + (random() * (max - min));
  return Math.round(value * 100) / 100;
}

function pacingBounds(deviceMode) {
  if (deviceMode === 'android-emulation' || deviceMode === 'android') {
    return {
      deviceClass: 'mobile', interactionMode: 'touch',
      observe: [1100, 2200], betweenScroll: [600, 1400], typing: [65, 125], preAction: [260, 720], postAction: [650, 1500],
      step: [90, 210], scrollDelay: [85, 180], pauseEvery: [3, 6], pauseMs: [260, 850], logEvery: [2, 4], downTarget: [0.72, 0.96], upTarget: [0, 0.15],
    };
  }
  if (deviceMode === 'ios-emulation' || deviceMode === 'real-ios') {
    return {
      deviceClass: 'mobile', interactionMode: 'touch',
      observe: [1200, 2400], betweenScroll: [650, 1500], typing: [70, 135], preAction: [280, 760], postAction: [700, 1550],
      step: [85, 195], scrollDelay: [90, 190], pauseEvery: [3, 6], pauseMs: [280, 850], logEvery: [2, 4], downTarget: [0.72, 0.95], upTarget: [0, 0.16],
    };
  }
  return {
    deviceClass: 'desktop', interactionMode: 'cursor',
    observe: [900, 1800], betweenScroll: [450, 1100], typing: [45, 95], preAction: [180, 520], postAction: [500, 1200],
    step: [55, 135], scrollDelay: [45, 95], pauseEvery: [3, 6], pauseMs: [180, 620], logEvery: [2, 4], downTarget: [0.78, 0.98], upTarget: [0, 0.18],
  };
}

function createQaPacing(seed, options = {}) {
  const deviceMode = String(options.deviceMode || 'desktop');
  const bounds = pacingBounds(deviceMode);
  const random = mulberry32(hashSeed(`${seed || 'orbitqa'}|${deviceMode}`));
  const scrollStepPatternPx = Array.from({ length: 7 }, () => integerBetween(random, bounds.step[0], bounds.step[1]));

  return {
    deviceMode,
    deviceClass: bounds.deviceClass,
    interactionMode: bounds.interactionMode,
    observeMs: integerBetween(random, bounds.observe[0], bounds.observe[1]),
    betweenScrollMs: integerBetween(random, bounds.betweenScroll[0], bounds.betweenScroll[1]),
    typingDelayMs: integerBetween(random, bounds.typing[0], bounds.typing[1]),
    preActionMs: integerBetween(random, bounds.preAction[0], bounds.preAction[1]),
    postActionMs: integerBetween(random, bounds.postAction[0], bounds.postAction[1]),
    // Retained for older callers and validation; Smart Interaction uses the varied pattern below.
    scrollChunkPx: integerBetween(random, 42, 78),
    scrollDelayMs: integerBetween(random, bounds.scrollDelay[0], bounds.scrollDelay[1]),
    scrollStepPatternPx,
    scrollDownTargetRatio: ratioBetween(random, bounds.downTarget[0], bounds.downTarget[1]),
    scrollUpTargetRatio: ratioBetween(random, bounds.upTarget[0], bounds.upTarget[1]),
    scrollPauseEverySteps: integerBetween(random, bounds.pauseEvery[0], bounds.pauseEvery[1]),
    scrollPauseMs: integerBetween(random, bounds.pauseMs[0], bounds.pauseMs[1]),
    scrollLogEverySteps: integerBetween(random, bounds.logEvery[0], bounds.logEvery[1]),
  };
}

module.exports = { createQaPacing };
