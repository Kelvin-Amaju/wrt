const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('simple link importer reports a useful error when a link returns zero songs',()=>{
  const source=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
  assert.match(source,/No songs were found/i);
  assert.match(source,/fetched\.length/);
  assert.doesNotMatch(source,/try Test Login/i);
});
