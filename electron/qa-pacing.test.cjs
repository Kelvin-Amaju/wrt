const test = require('node:test');
const assert = require('node:assert/strict');
const { createQaPacing } = require('./qa-pacing.cjs');

function inRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

test('QA pacing is deterministic per work-unit seed and stays inside professional manual-QA bounds', () => {
  const first = createQaPacing('target-a-group-b-instance-1');
  const second = createQaPacing('target-a-group-b-instance-1');
  assert.deepEqual(first, second);

  assert.equal(inRange(first.observeMs, 900, 1800), true);
  assert.equal(inRange(first.betweenScrollMs, 450, 1100), true);
  assert.equal(inRange(first.typingDelayMs, 45, 95), true);
  assert.equal(inRange(first.preActionMs, 180, 520), true);
  assert.equal(inRange(first.postActionMs, 500, 1200), true);
  assert.equal(inRange(first.scrollChunkPx, 42, 78), true);
  assert.equal(inRange(first.scrollDelayMs, 45, 95), true);
});

test('different work-unit seeds do not all receive an identical pacing profile', () => {
  const profiles = [1, 2, 3, 4, 5].map((index) => createQaPacing(`work-${index}`));
  assert.equal(new Set(profiles.map((profile) => JSON.stringify(profile))).size > 1, true);
});

test('QA pacing uses distinct bounded desktop, Android, and iOS compatibility profiles', () => {
  const desktop = createQaPacing('same-work-unit', { deviceMode: 'desktop' });
  const android = createQaPacing('same-work-unit', { deviceMode: 'android-emulation' });
  const ios = createQaPacing('same-work-unit', { deviceMode: 'ios-emulation' });

  assert.equal(desktop.deviceClass, 'desktop');
  assert.equal(android.deviceClass, 'mobile');
  assert.equal(ios.deviceClass, 'mobile');
  assert.equal(desktop.interactionMode, 'cursor');
  assert.equal(android.interactionMode, 'touch');
  assert.equal(ios.interactionMode, 'touch');
  assert.notDeepEqual(desktop, android);
  assert.notDeepEqual(android, ios);

  assert.equal(inRange(desktop.typingDelayMs, 45, 95), true);
  assert.equal(inRange(android.typingDelayMs, 65, 125), true);
  assert.equal(inRange(ios.typingDelayMs, 70, 135), true);

  for (const [profile, minStep, maxStep] of [
    [desktop, 55, 135],
    [android, 90, 210],
    [ios, 85, 195],
  ]) {
    assert.equal(Array.isArray(profile.scrollStepPatternPx), true);
    assert.equal(profile.scrollStepPatternPx.length >= 6, true);
    assert.equal(profile.scrollStepPatternPx.every((value) => inRange(value, minStep, maxStep)), true);
    assert.equal(new Set(profile.scrollStepPatternPx).size > 1, true);
    assert.equal(profile.scrollDownTargetRatio >= 0.72 && profile.scrollDownTargetRatio <= 0.98, true);
    assert.equal(profile.scrollUpTargetRatio >= 0 && profile.scrollUpTargetRatio <= 0.18, true);
    assert.equal(inRange(profile.scrollPauseEverySteps, 3, 6), true);
    assert.equal(profile.scrollPauseMs >= 180 && profile.scrollPauseMs <= 850, true);
    assert.equal(inRange(profile.scrollLogEverySteps, 2, 4), true);
  }
});

test('device-specific pacing remains deterministic for the same work unit and mode', () => {
  const first = createQaPacing('work-7', { deviceMode: 'android-emulation' });
  const second = createQaPacing('work-7', { deviceMode: 'android-emulation' });
  assert.deepEqual(first, second);
});

test('QA runner passes each work-unit device mode into pacing generation', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, 'qa-runner.cjs'), 'utf8');
  assert.match(source, /createQaPacing\(workUnit\.workId,\s*\{\s*deviceMode:\s*settings\.deviceMode\s*\}\)/);
});
