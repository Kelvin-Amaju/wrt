const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('Proxy Manager exposes the approved pool controls and table columns', () => {
  const text = source('src/pages/ProxyManager.tsx');
  for (const label of [
    'Rotating Pool', 'Static Pool', 'Test All', 'Test Selected', 'Retest Dead',
    'Export Safe List', 'aria-label="Filter proxies"', '<th>Protocol</th>', '<th>Endpoint</th>', '<th>Exit IP</th>',
    '<th>Country</th>', '<th>Latency</th>', '<th>Health</th>', '<th>Failures</th>',
    '<th>Last Check</th>', '<th>Next Check</th>', '<th>Enabled</th>', '<th>Actions</th>',
  ]) {
    assert.match(text, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('v0.8 target groups select proxy source by pool name and never ask renderer for pool passwords', () => {
  const editor = source('src/components/TargetPlanEditor.tsx');
  const page = source('src/pages/Run.tsx');
  assert.match(editor, /proxy source/);
  assert.match(editor, /value="rotating"/);
  assert.match(editor, /value="static"/);
  assert.match(editor, /Rotating.*Pool/);
  assert.match(editor, /Static.*Pool/);
  assert.doesNotMatch(editor + page, /getRuntimeProxy|decryptPassword/);
});

test('pool proxy sources no longer expose a verified-slow opt-in because slow fallback is automatic', () => {
  const editor = source('src/components/TargetPlanEditor.tsx');
  const runs = source('src/pages/Run.tsx');
  assert.doesNotMatch(editor, /allow verified slow proxies/i);
  assert.doesNotMatch(runs, /allow verified slow proxies/i);
  assert.match(editor, /allowSlowProxies:\s*\['rotating', 'static', 'smart-mix'\]\.includes/);
});

test('fetched-free proxy mode is fully removed from renderer and shared contracts', () => {
  const manager = source('src/pages/ProxyManager.tsx');
  const runs = source('src/pages/Run.tsx');
  const proxyTypes = source('src/shared/proxy.ts');
  const preload = source('electron/preload.cjs');
  const main = source('electron/main.cjs');
  for (const text of [manager, runs, proxyTypes, preload, main]) {
    assert.doesNotMatch(text, /fetched-free|Fetched Free|free proxies|refreshFetchedFree/i);
  }
});

test('Test Runs exposes Smart Mix rotating plus static as a proxy source', () => {
  const runs = source('src/pages/Run.tsx');
  const editor = source('src/components/TargetPlanEditor.tsx');
  assert.match(runs, /value="smart-mix"/);
  assert.match(runs, /Smart Mix/i);
  assert.match(editor, /value="smart-mix"/);
  assert.match(editor, /Smart Mix/i);
});
