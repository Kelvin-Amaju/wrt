const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('v0.21.47 persistent Chromium launches suppress crash restore and normalize saved profile shutdown state',()=>{
  const runner=read('qa-runner.cjs');
  const factory=read('streaming/streaming-browser-factory.cjs');
  assert.match(runner,/--hide-crash-restore-bubble/);
  assert.match(runner,/--disable-session-crashed-bubble/);
  assert.match(factory,/normalizeChromeProfileShutdownState\(profileDir\)/);
  assert.match(factory,/launchPersistentContext\(profileDir/);
});

test('v0.21.47 desktop Social and Streaming actions use the visible coordinate mouse driver',()=>{
  const indicator=read('interaction-indicator.cjs');
  const social=read('social/social-runner.cjs');
  const search=read('social/search-navigator.cjs');
  const factory=read('streaming/adapters/_factory.cjs');
  const spotify=read('streaming/adapters/spotify.cjs');
  assert.match(indicator,/page\.mouse\.move/);
  assert.match(indicator,/page\.mouse\.click/);
  assert.match(social,/clickWithInteractionIndicator/);
  assert.match(search,/clickWithInteractionIndicator/);
  assert.match(factory,/clickWithInteractionIndicator/);
  assert.match(spotify,/clickWithInteractionIndicator/);
});
