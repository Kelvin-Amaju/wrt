const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const preload = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
const main = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8');
const channels = ['proxy:list','proxy:import','proxy:update','proxy:delete','proxy:setEnabled','proxy:test','proxy:checkMany','proxy:recheckDead','proxy:summary','proxy:activity','proxy:exportSafe','proxy:acceptStaticIp'];

test('preload exposes the allowed proxy manager IPC channels only', () => {
  for (const channel of channels) assert.match(preload, new RegExp(channel.replace(':','\\:')));
  assert.doesNotMatch(preload, /proxy:getPassword/);
  assert.doesNotMatch(preload, /getProxyPassword/);
});

test('main registers every proxy manager channel and injects the shared pool into the multi-run registry', () => {
  for (const channel of channels) assert.match(main, new RegExp(channel.replace(':','\\:')));
  assert.match(main, /createRunRegistry/);
  assert.match(main, /dependencies:\s*\{[^}]*proxyPoolService/s);
  assert.match(main, /executeRun:\s*executeQaRun/);
});
