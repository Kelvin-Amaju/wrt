const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Test Runs uses a distinct activity work label instead of truncating the shared work-id prefix', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'Run.tsx'), 'utf8');
  assert.match(source, /activityWorkLabel\(event\)/);
  assert.doesNotMatch(source, /event\.workId\.slice\(0,\s*14\)/);
});
