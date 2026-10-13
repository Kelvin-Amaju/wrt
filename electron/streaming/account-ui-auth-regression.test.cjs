const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

test('account form defaults to credential login when username/password is the expected path',()=>{
  const source=fs.readFileSync('src/components/StreamingAccountsPanel.tsx','utf8');
  assert.match(source,/useState<StreamingAuthMode>\('credentials'\)/);
});
