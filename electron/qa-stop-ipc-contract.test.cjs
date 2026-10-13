const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname);

test('preload exposes run-scoped stop/pause/resume APIs and main registers them', () => {
  const preload = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  assert.match(preload, /stopQaRun:\s*\(runId\).*qa:stopRun/s);
  assert.match(preload, /pauseQaRun:\s*\(runId\).*qa:pauseRun/s);
  assert.match(preload, /resumeQaRun:\s*\(runId\).*qa:resumeRun/s);
  assert.match(preload, /stopAllQaRuns:.*qa:stopAllRuns/s);
  assert.match(main, /ipcMain\.handle\('qa:stopRun'/);
  assert.match(main, /ipcMain\.handle\('qa:pauseRun'/);
  assert.match(main, /ipcMain\.handle\('qa:resumeRun'/);
  assert.match(main, /ipcMain\.handle\('qa:stopAllRuns'/);
  assert.match(main, /runRegistry/);
  assert.doesNotMatch(main, /waitForStartSlot/);
});
