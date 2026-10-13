const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'qa-runner.cjs'),'utf8');
test('Test Run static allocations request healthy randomized cycle policy',()=>{
  const hits=source.match(/selectionPolicy:'healthy-random-cycle'/g)||[];
  assert.ok(hits.length>=2);
  assert.match(source,/rotationScope:'test-run:static'/);
});
