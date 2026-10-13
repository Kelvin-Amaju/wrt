const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const forbidden = [
  /Test Runs/i,
  /Test Accounts/i,
  /Test Social Accounts/i,
  /START QA TEST/i,
  /STOP QA TEST/i,
  /OrbitQA QA test/i,
  /test-run:static/i,
  /\bkind\s*:\s*['"]test['"]/i,
  /\bpage\s*===\s*['"]tests['"]/i,
  /\btestProxy\b/,
  /\btestProxies\b/,
  /\bretestDeadProxies\b/,
  /\btestRealIosProvider\b/,
];

test('v0.21.69 operational terminology is Run/Check and target-facing fallback is neutral', () => {
  const runtimeSources = [
    'src/App.tsx','src/components/Sidebar.tsx','src/pages/Run.tsx','src/pages/RunCenter.tsx',
    'src/components/StreamingAccountsPanel.tsx','src/components/SocialAccountsPanel.tsx',
    'src/pages/StreamingHub.tsx','src/pages/SocialHub.tsx','src/pages/ProxyManager.tsx',
    'src/pages/Scheduler.tsx','src/pages/Settings.tsx','src/shared/run.ts','src/vite-env.d.ts',
    'electron/main.cjs','electron/preload.cjs','electron/scheduler-actions.cjs','electron/qa-runner.cjs',
    'dist/assets/index-manual.js'
  ].map(read).join('\n');
  for (const pattern of forbidden) assert.doesNotMatch(runtimeSources, pattern);
  assert.match(read('src/components/Sidebar.tsx'), /label: 'Run'/);
  assert.match(read('src/pages/Run.tsx'), /START RUN/);
  assert.match(read('src/shared/run.ts'), /Sample interaction/);
  assert.match(read('electron/preload.cjs'), /checkProxy/);
});
