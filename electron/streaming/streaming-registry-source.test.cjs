const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs');
test('run registry dispatches streaming run kind',()=>{const s=fs.readFileSync('electron/run-registry.cjs','utf8'); assert.match(s,/executeStreamingRun/); assert.match(s,/runKind/); assert.match(s,/streaming/);});
