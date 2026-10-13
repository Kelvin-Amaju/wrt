const test = require('node:test');
const assert = require('node:assert/strict');
const { filterWorkUnitsForCheckpoint } = require('./qa-runner.cjs');

test('resume skips terminal work but restarts unfinished in-flight work', () => {
  const source = [{workId:'done-1'},{workId:'active-1'},{workId:'queued-1'}];
  const out = [...filterWorkUnitsForCheckpoint(source, { terminalWorkIds:['done-1'], inFlightWorkIds:['active-1'] })];
  assert.deepEqual(out.map((x)=>x.workId), ['active-1','queued-1']);
});
