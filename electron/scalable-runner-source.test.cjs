const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'qa-runner.cjs'), 'utf8');

test('matrix browser setup uses a separate watchdog and begins the requested QA timer only after initial diagnostics', () => {
  assert.match(source, /const setupDurationMs = Math\.max\(120000,/);
  assert.match(source, /durationMs: setupDurationMs/);
  const activeTimer = source.indexOf('lifetime.beginActiveSession?.(baseDurationMs)');
  const behavior = source.indexOf('await executeConfiguredBehavior({ settings, normalized, page, context, workUnit', activeTimer);
  assert.ok(activeTimer > 0, 'active QA timer activation must be wired into matrix execution');
  assert.ok(behavior > activeTimer, 'active QA timer must begin before configured behavior');
});
