// Verify the mandatory interaction-delay runtime is retained for packaged Spotify adapters.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const factory = path.join(__dirname, 'streaming', 'adapters', '_factory.cjs');
const target = path.resolve(path.dirname(factory), '../../mandatory-interaction-delay.cjs');
assert.ok(fs.existsSync(target), `Missing mandatory interaction delay: ${target}`);
assert.match(fs.readFileSync(factory,'utf8'), /require\(['"]\.\.\/\.\.\/mandatory-interaction-delay\.cjs['"]\)/);
require(target);
console.log('Mandatory interaction delay source resolution OK');
