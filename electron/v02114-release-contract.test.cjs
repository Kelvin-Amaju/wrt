const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
test('v0.21.14 UI exposes Execution mode in Streaming and Social without changing test-run control',()=>{
  const streaming=read('src/components/StreamingPlaybackPanel.tsx');const social=read('src/pages/SocialHub.tsx');const testRuns=read('src/pages/Run.tsx');
  assert.match(streaming,/Execution mode/);assert.match(streaming,/Visible Activity/);assert.match(streaming,/Background Activity/);
  assert.match(social,/Social execution mode/);assert.match(social,/executionMode/);assert.match(testRuns,/aria-label="Execution mode"/);
});
test('v0.21.14 exposes optional browser audio mute and Repair Profile only in streaming account controls',()=>{
  assert.match(read('src/components/StreamingPlaybackPanel.tsx'),/Mute browser audio/);
  assert.match(read('src/components/StreamingAccountsPanel.tsx'),/REPAIR PROFILE/);
  assert.match(read('electron/preload.cjs'),/streaming:repairAccountProfile/);
});
test('Run Center acknowledges live actions immediately instead of waiting for refresh',()=>{
  const ui=read('src/pages/RunCenter.tsx');assert.match(ui,/acknowledgeRunAction/);assert.match(ui,/STOPPING/);assert.match(ui,/void refresh\(\)/);
});
test('automatic rerun marks a terminal signature only after rerun is accepted',()=>{
  const source=read('electron/lane-automation-manager.cjs');assert.match(source,/if\(result\?\.rerun\)a\.seenTerminal\.add\(sig\)/);
});
