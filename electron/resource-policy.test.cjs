const test = require('node:test');
const assert = require('node:assert/strict');
const { computeAutoConcurrency, isLaunchPaused, isLaunchResumable } = require('./resource-policy.cjs');

test('auto concurrency reserves CPU capacity and respects memory budget', () => {
  assert.equal(computeAutoConcurrency({ logicalCpuCount: 8, totalMemoryBytes: 16e9, freeMemoryBytes: 12e9, cpuLoadFraction: 0.2 }), 3);
  assert.equal(computeAutoConcurrency({ logicalCpuCount: 16, totalMemoryBytes: 16e9, freeMemoryBytes: 2e9, cpuLoadFraction: 0.2 }), 2);
});

test('high pressure pauses and lower pressure resumes launches', () => {
  assert.equal(isLaunchPaused({ logicalCpuCount: 8, totalMemoryBytes: 16e9, freeMemoryBytes: 1e9, cpuLoadFraction: 0.93 }), true);
  assert.equal(isLaunchPaused({ logicalCpuCount: 8, totalMemoryBytes: 16e9, freeMemoryBytes: 8e9, cpuLoadFraction: 0.40 }), false);
  assert.equal(isLaunchResumable({ logicalCpuCount: 8, totalMemoryBytes: 16e9, freeMemoryBytes: 6e9, cpuLoadFraction: 0.55 }), true);
  assert.equal(isLaunchResumable({ logicalCpuCount: 8, totalMemoryBytes: 16e9, freeMemoryBytes: 2e9, cpuLoadFraction: 0.85 }), false);
});
