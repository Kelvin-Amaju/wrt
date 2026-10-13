const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function tempFile() { return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orbitqa-ip-history-')), 'proxy-ip-history.json'); }

test('aggregates same-run repeats and lifetime repeats across runs', async () => {
  const { createProxyIpHistoryStore } = require('./proxy-ip-history-store.cjs');
  const store = createProxyIpHistoryStore({ filePath:tempFile(), debounceMs:1 });
  store.observe({ runId:'r1', workId:'w1', proxySource:'manual', proxyEndpointKey:'proxy.example:8000', observedIp:'8.8.4.4', phase:'preflight', observedAt:'2026-09-19T10:00:00Z' });
  store.observe({ runId:'r1', workId:'w1', proxySource:'manual', proxyEndpointKey:'proxy.example:8000', observedIp:'8.8.4.4', phase:'post-behavior', observedAt:'2026-09-19T10:01:00Z' });
  let run = store.getRunSummary('r1');
  assert.equal(run.rows[0].seenInRunCount, 2);
  assert.equal(run.rows[0].repeatedInRun, true);
  assert.deepEqual(run.rows[0].phasesSeen.sort(), ['post-behavior','preflight']);
  store.observe({ runId:'r2', workId:'w2', proxySource:'manual', proxyEndpointKey:'proxy.example:8000', observedIp:'8.8.4.4', phase:'preflight', observedAt:'2026-09-19T11:00:00Z' });
  const lifetime = store.list({ page:1, pageSize:100 }).rows[0];
  assert.equal(lifetime.totalSeenCount, 3);
  assert.equal(lifetime.runsSeenCount, 2);
  assert.equal(lifetime.historicallyRepeated, true);
  await store.flush();
});

test('strips proxy credentials from persisted data and CSV export', async () => {
  const { createProxyIpHistoryStore } = require('./proxy-ip-history-store.cjs');
  let persisted = '';
  const store = createProxyIpHistoryStore({ filePath:'ignored.json', debounceMs:1, writeFile:async (_path, data) => { persisted = String(data); } });
  store.observe({ runId:'r1', proxySource:'manual', proxyEndpointKey:'http://username:password@proxy.example:8000', observedIp:'1.1.1.1', phase:'preflight', observedAt:'2026-09-19T10:00:00Z' });
  await store.flush();
  const csv = store.exportCsv({});
  assert.doesNotMatch(persisted, /username|password|username:password@/i);
  assert.doesNotMatch(csv, /username|password|username:password@/i);
  assert.match(persisted, /proxy\.example:8000/);
});

test('paginates aggregate history and filters repeated-in-run rows', () => {
  const { createProxyIpHistoryStore } = require('./proxy-ip-history-store.cjs');
  const store = createProxyIpHistoryStore({ filePath:tempFile(), debounceMs:10000 });
  for (let i=1; i<=250; i += 1) {
    const a = Math.floor((i - 1) / 250) + 1;
    const b = ((i - 1) % 250) + 1;
    store.observe({ runId:'bulk', proxySource:'rotating', proxyId:`p${i}`, observedIp:`8.${a}.${Math.floor(b / 255)}.${(b % 254) + 1}`, phase:'preflight', observedAt:`2026-09-19T10:${String(i % 60).padStart(2,'0')}:00Z` });
  }
  const first = store.list({ page:1, pageSize:100 });
  assert.equal(first.rows.length, 100);
  assert.equal(first.total, 250);
  assert.equal(first.totalPages, 3);
  store.observe({ runId:'bulk', proxySource:'rotating', proxyId:'p1', observedIp:'8.1.0.2', phase:'post-behavior', observedAt:'2026-09-19T12:00:00Z' });
  const repeated = store.list({ page:1, pageSize:100, runId:'bulk', repeatFilter:'repeated-in-run' });
  assert.equal(repeated.rows.length, 1);
  assert.equal(repeated.rows[0].seenInRunCount, 2);
});

test('rejects invalid and private IP observations', () => {
  const { createProxyIpHistoryStore } = require('./proxy-ip-history-store.cjs');
  const store = createProxyIpHistoryStore({ filePath:tempFile() });
  for (const observedIp of ['not-an-ip','127.0.0.1','10.0.0.3','192.168.1.4','169.254.1.1','192.0.2.1','198.51.100.9','203.0.113.8','::1','fe80::1','fc00::1','2001:db8::1']) {
    assert.equal(store.observe({ runId:'r1', proxySource:'manual', proxyEndpointKey:'proxy.test:80', observedIp, phase:'preflight', observedAt:new Date().toISOString() }), false);
  }
  assert.equal(store.list({page:1,pageSize:100}).total, 0);
});

test('list returns lightweight summary aggregates for the filtered result set without expanding the page', () => {
  const { createProxyIpHistoryStore } = require('./proxy-ip-history-store.cjs');
  const store = createProxyIpHistoryStore({ filePath:tempFile(), debounceMs:10000 });
  store.observe({ runId:'r1', proxySource:'rotating', proxyId:'p1', observedIp:'8.8.4.4', countryCode:'NG', phase:'preflight', observedAt:'2026-09-19T10:00:00Z' });
  store.observe({ runId:'r1', proxySource:'rotating', proxyId:'p1', observedIp:'8.8.4.4', countryCode:'NG', phase:'post-behavior', observedAt:'2026-09-19T10:01:00Z' });
  store.observe({ runId:'r1', proxySource:'rotating', proxyId:'p2', observedIp:'9.9.9.9', countryCode:'DE', phase:'preflight', observedAt:'2026-09-19T10:02:00Z' });
  const page = store.list({ page:1, pageSize:1 });
  assert.equal(page.rows.length, 1);
  assert.deepEqual(page.summary, { uniqueIps:2, repeatedIps:1, countries:2, totalObservations:3 });
});

test('history listing does not rescan every per-run row for every lifetime row', () => {
  const source = fs.readFileSync(path.join(__dirname, 'proxy-ip-history-store.cjs'), 'utf8');
  assert.doesNotMatch(source, /const matchingRuns = \[\.\.\.perRun\.values\(\)\]\.filter/);
});

test('CSV export includes the full filtered aggregate set rather than only the first page', () => {
  const { createProxyIpHistoryStore } = require('./proxy-ip-history-store.cjs');
  const store = createProxyIpHistoryStore({ filePath:tempFile(), debounceMs:10000 });
  for (let i=1; i<=105; i += 1) {
    const third = Math.floor((i - 1) / 250) + 1;
    const fourth = ((i - 1) % 250) + 1;
    store.observe({ runId:'csv', proxySource:'rotating', proxyId:`csv-${i}`, observedIp:`8.8.${third}.${fourth}`, phase:'preflight', observedAt:'2026-09-19T10:00:00Z' });
  }
  const lines = store.exportCsv({}).trim().split(/\r?\n/);
  assert.equal(lines.length, 106);
});

test('Proxy IP History defaults recording ACTIVE and INACTIVE short-circuits all observation work', async () => {
  const { createProxyIpHistoryStore } = require('./proxy-ip-history-store.cjs');
  const writes = [];
  const countryLookups = [];
  const store = createProxyIpHistoryStore({
    filePath:'/tmp/proxy-history.json',
    readFile:() => { throw new Error('missing'); },
    writeFile:async (_path, data) => { writes.push(JSON.parse(data)); },
    debounceMs:0,
    countryResolver:{ resolve:async (ip) => { countryLookups.push(ip); return 'NG'; } },
  });

  assert.deepEqual(store.getRecordingState(), { recordingEnabled:true });
  await store.setRecordingState(false);
  const writeCountAfterSetting = writes.length;

  assert.equal(store.observe({ runId:'r-disabled', proxySource:'rotating', proxyId:'p1', observedIp:'8.8.8.8', phase:'preflight' }), false);
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(store.getRunSummary('r-disabled').observationCount, 0);
  assert.equal(countryLookups.length, 0);
  assert.equal(writes.length, writeCountAfterSetting);
});

test('clearing history preserves recording state', async () => {
  const { createProxyIpHistoryStore } = require('./proxy-ip-history-store.cjs');
  const store = createProxyIpHistoryStore({ filePath:'/tmp/history.json', readFile:() => { throw new Error('missing'); }, writeFile:async () => {}, debounceMs:0 });
  await store.setRecordingState(false);
  store.clear();
  assert.deepEqual(store.getRecordingState(), { recordingEnabled:false });
});

test('recording state persists across restart', async () => {
  const { createProxyIpHistoryStore } = require('./proxy-ip-history-store.cjs');
  let saved = '';
  const first = createProxyIpHistoryStore({ filePath:'/tmp/history.json', readFile:() => { throw new Error('missing'); }, writeFile:async (_path, data) => { saved = data; }, debounceMs:0 });
  await first.setRecordingState(false);
  const second = createProxyIpHistoryStore({ filePath:'/tmp/history.json', readFile:() => saved, writeFile:async (_path, data) => { saved = data; }, debounceMs:0 });
  assert.deepEqual(second.getRecordingState(), { recordingEnabled:false });
});

test('re-enabling history records only future observations', async () => {
  const { createProxyIpHistoryStore } = require('./proxy-ip-history-store.cjs');
  const store = createProxyIpHistoryStore({ filePath:'/tmp/history.json', readFile:() => { throw new Error('missing'); }, writeFile:async () => {}, debounceMs:0 });
  await store.setRecordingState(false);
  store.observe({ runId:'r1', proxySource:'rotating', proxyId:'p1', observedIp:'8.8.8.8', phase:'preflight' });
  await store.setRecordingState(true);
  store.observe({ runId:'r1', proxySource:'rotating', proxyId:'p1', observedIp:'8.8.8.8', phase:'post-behavior' });
  assert.equal(store.getRunSummary('r1').observationCount, 1);
});

test('recording state rolls back when persistence fails', async () => {
  const { createProxyIpHistoryStore } = require('./proxy-ip-history-store.cjs');
  let fail = false;
  let saved = '';
  const store = createProxyIpHistoryStore({
    filePath:'/tmp/history.json',
    readFile:() => { if (!saved) throw new Error('missing'); return saved; },
    writeFile:async (_path, data) => { if (fail) throw new Error('disk full'); saved = data; },
    debounceMs:0,
  });
  await store.setRecordingState(false);
  fail = true;
  await assert.rejects(() => store.setRecordingState(true), /disk full|could not be saved/i);
  assert.deepEqual(store.getRecordingState(), { recordingEnabled:false });
});
