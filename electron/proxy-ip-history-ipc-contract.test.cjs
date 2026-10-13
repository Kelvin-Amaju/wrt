const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(rel) { return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8'); }

const main = read('electron/main.cjs');
const preload = read('electron/preload.cjs');
const viteEnv = read('src/vite-env.d.ts');
const sharedPath = path.join(__dirname, '..', 'src', 'shared', 'proxyIpHistory.ts');
const shared = fs.existsSync(sharedPath) ? fs.readFileSync(sharedPath, 'utf8') : '';

const channels = [
  'qa:getBrowserRuntimeStatus',
  'qa:listProxyIpHistory',
  'qa:getRunProxyIpSummary',
  'qa:clearProxyIpHistory',
  'qa:exportProxyIpHistoryCsv',
  'qa:getProxyIpHistoryRecordingState',
  'qa:setProxyIpHistoryRecordingState',
];
const preloadApis = [
  'getBrowserRuntimeStatus',
  'listProxyIpHistory',
  'getRunProxyIpSummary',
  'clearProxyIpHistory',
  'exportProxyIpHistoryCsv',
  'getProxyIpHistoryRecordingState',
  'setProxyIpHistoryRecordingState',
];

test('main registers Chrome runtime status and bounded proxy IP history IPC handlers', () => {
  for (const channel of channels) assert.match(main, new RegExp(channel.replace(':', '\\:')));
  assert.match(main, /qa:listProxyIpHistory[^\n]*proxyIpHistory\.list\(query \|\| \{\}\)/s);
  assert.match(main, /qa:getRunProxyIpSummary[^\n]*proxyIpHistory\.getRunSummary\(String\(runId \|\| ''\)\)/s);
  assert.match(main, /qa:clearProxyIpHistory[^\n]*proxyIpHistory\.clear\(\)/s);
  assert.match(main, /qa:exportProxyIpHistoryCsv[^\n]*proxyIpHistory\.exportCsv\(query \|\| \{\}\)/s);
  assert.match(main, /qa:getProxyIpHistoryRecordingState[\s\S]*proxyIpHistory\.getRecordingState\(\)/);
  assert.match(main, /qa:setProxyIpHistoryRecordingState[\s\S]*proxyIpHistory\.setRecordingState\(Boolean\(enabled\)\)/);
  assert.match(main, /function getBrowserRuntimeStatus\(\)[\s\S]*resolveInstalledChrome\(\)[\s\S]*executablePath/);
  assert.match(main, /dependencies:\s*\{[\s\S]*proxyIpHistory/);
});

test('preload exposes the exact local renderer methods without a raw history-store escape hatch', () => {
  for (const api of preloadApis) assert.match(preload, new RegExp(api));
  for (const channel of channels) assert.match(preload, new RegExp(channel.replace(':', '\\:')));
  assert.doesNotMatch(preload, /getRawProxyIpHistory|proxyIpHistoryStore/);
});

test('renderer declarations expose typed paginated history and Chrome status only', () => {
  assert.match(viteEnv, /ProxyIpHistoryQuery/);
  assert.match(viteEnv, /ProxyIpHistoryPage/);
  assert.match(viteEnv, /RunProxyIpSummary/);
  assert.match(viteEnv, /BrowserRuntimeStatus/);
  for (const api of preloadApis) assert.match(viteEnv, new RegExp(api));
  assert.match(shared, /export interface ProxyIpHistoryRecordingState/);
  assert.match(shared, /recordingEnabled: boolean/);
  assert.match(shared, /export interface ProxyIpHistoryQuery/);
  assert.match(shared, /pageSize\?: number/);
  assert.match(shared, /seenInRunCount/);
  assert.match(shared, /repeatedInRun/);
  assert.match(shared, /totalSeenCount/);
  assert.match(shared, /runsSeenCount/);
  assert.doesNotMatch(shared, /username\??:|password\??:/);
});
