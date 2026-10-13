const test = require('node:test');
const assert = require('node:assert/strict');
const { createSessionBudget } = require('./session-budget.cjs');

test('session budget always reserves final integrity and a primary action', () => {
  for (const duration of [15000, 30000, 60000, 120000]) {
    const budget = createSessionBudget(duration);
    assert.ok(budget.finalIntegrityMs >= 3500);
    assert.ok(budget.primaryActionMs >= 3000);
    assert.ok(budget.readingMs >= 0);
    assert.ok(budget.finalIntegrityMs + budget.primaryActionMs + budget.adObservationMs + budget.followUpMs + budget.readingMs <= duration);
  }
});

test('longer sessions allocate at least as much reading and ad observation time as shorter sessions', () => {
  const short = createSessionBudget(20000);
  const medium = createSessionBudget(60000);
  const long = createSessionBudget(120000);
  assert.ok(medium.readingMs >= short.readingMs);
  assert.ok(long.readingMs >= medium.readingMs);
  assert.ok(medium.adObservationMs >= short.adObservationMs);
  assert.ok(long.adObservationMs >= medium.adObservationMs);
  assert.equal(short.pace, 'fast');
  assert.equal(medium.pace, 'natural');
  assert.equal(long.pace, 'slow');
});
