const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
function read(rel){ return fs.existsSync(path.join(__dirname,'..',rel)) ? fs.readFileSync(path.join(__dirname,'..',rel),'utf8') : ''; }
const app=read('src/App.tsx');
const sidebar=read('src/components/Sidebar.tsx');
const page=read('src/pages/ProxyIpHistory.tsx');
const runCenter=read('src/pages/RunCenter.tsx');
const runCenterTypes=read('src/shared/runCenter.ts');
const styles=read('src/styles.css');

test('app and sidebar expose a dedicated Proxy IP History page',()=>{
  assert.match(sidebar,/proxy-ip-history/);
  assert.match(sidebar,/Proxy IP History/);
  assert.match(app,/ProxyIpHistory/);
  assert.match(app,/page === 'proxy-ip-history'/);
});

test('Proxy IP History page is bounded, filterable, exportable, and shows repeat truth',()=>{
  assert.match(page,/listProxyIpHistory/);
  assert.match(page,/pageSize:\s*100/);
  assert.match(page,/Unique IPs/);
  assert.match(page,/Repeated IPs/);
  assert.match(page,/Countries/);
  assert.match(page,/Total Observations/);
  assert.match(page,/REPEATED IN RUN/);
  assert.match(page,/HISTORICALLY REPEATED/);
  assert.match(page,/NEW/);
  assert.match(page,/Clear History/);
  assert.match(page,/Confirm clear/);
  assert.match(page,/exportProxyIpHistoryCsv/);
  assert.match(page,/Previous/);
  assert.match(page,/Next/);
  assert.doesNotMatch(page,/setInterval\([^)]*,\s*(?:[0-9]{1,3}|1[0-9]{3})\s*\)/);
});

test('Run Detail requests per-run IP aggregates and renders real browser runtime truth',()=>{
  assert.match(runCenter,/getRunProxyIpSummary/);
  assert.match(runCenter,/Proxy \/ IP Summary/);
  assert.match(runCenter,/Proxy observations/);
  assert.match(runCenter,/Unique IPs/);
  assert.match(runCenter,/Repeated observations/);
  assert.match(runCenter,/Seen .*in this run/s);
  assert.match(runCenter,/runtimeVerification/);
  assert.match(runCenter,/verificationLabel/);
  assert.match(runCenter,/browserVersion/);
  assert.match(runCenterTypes,/runtimeVerifications/);
  assert.match(styles,/proxy-ip-history/);
});

test('Proxy IP History page exposes confirmed ACTIVE/INACTIVE recording control without hiding existing history actions',()=>{
  assert.match(page,/getProxyIpHistoryRecordingState/);
  assert.match(page,/setProxyIpHistoryRecordingState/);
  assert.match(page,/Set Proxy IP History recording ACTIVE/);
  assert.match(page,/Set Proxy IP History recording INACTIVE/);
  assert.match(page,/ACTIVE/);
  assert.match(page,/INACTIVE/);
  assert.match(page,/History is view-only/);
  assert.match(page,/Export CSV/);
  assert.match(page,/Clear History/);
});
