const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const social=fs.readFileSync(require.resolve('./social/social-runner.cjs'),'utf8');
const hub=fs.readFileSync(require.resolve('../src/pages/SocialHub.tsx'),'utf8');
const stream=fs.readFileSync(require.resolve('../src/pages/StreamingHub.tsx'),'utf8');
const layer=fs.readFileSync(require.resolve('../dist/intelligence-layer.js'),'utf8');
test('intelligence social runs ignore normal QA checks and force in-platform search',()=>{assert.match(social,/const checks=intelligence\.enabled\?\[\]:group\.checks/);assert.match(social,/if\(intelligence\.enabled\|\|checks\.includes\('search-before-open'\)\)/);});
test('UI supports Intelligence takeover for direct runs and independent per-group enablement',()=>{assert.match(hub,/contentIntelligence\.enabled\?\[\]:\[\.\.\.checks\]/);assert.match(stream,/groupPlansForRun/);assert.match(stream,/contentIntelligence:\{\.\.\.DEFAULT_CONTENT_INTELLIGENCE/);assert.match(layer,/Use Independent Content Observation for this group/i);});
test('intelligence UI removes public-action suggestion queue and documents mandatory pre-target browsing',()=>{assert.doesNotMatch(layer,/Queue public-action suggestions for approval/);assert.match(layer,/Mandatory pre-target path/i);assert.match(layer,/Public posting\/reaction actions remain explicit/i);});
