const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs');
test('Streaming Hub is wired into navigation and exposes seven platforms',()=>{
  const app=fs.readFileSync('src/App.tsx','utf8'); const side=fs.readFileSync('src/components/Sidebar.tsx','utf8');
  assert.match(side,/Streaming Hub/); assert.match(app,/StreamingHub/); assert.match(app,/page === 'streaming'/);
  const page=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
  for(const label of ['Spotify','YouTube Music','SoundCloud','Deezer','TIDAL','Audiomack','Pandora']) assert.match(page,new RegExp(label));
  assert.doesNotMatch(page,/Auto[- ]?Follow|Auto[- ]?Favorite|Subscribe/i);
  assert.match(page,/START STREAMING QA/);
});
test('Streaming Hub exposes simple import, saved albums, playback, account and safe check panels',()=>{
  for(const f of ['src/components/StreamingPlatformTabs.tsx','src/components/SimpleStreamingImporter.tsx','src/components/SavedStreamingAlbumsPanel.tsx','src/components/StreamingPlaybackPanel.tsx','src/components/StreamingAccountsPanel.tsx','src/components/StreamingChecksPanel.tsx']) assert.ok(fs.existsSync(f),f);
});

test('simple importer limits initial track rows and exposes lazy load control',()=>{const s=fs.readFileSync('src/components/SimpleStreamingImporter.tsx','utf8'); assert.match(s,/visibleLimit/); assert.match(s,/Load more tracks/);});

test('persistent Streaming QA keeps observation range but removes Slots and sizes work to selected accounts',()=>{
  const panel=fs.readFileSync('src/components/StreamingPlaybackPanel.tsx','utf8');
  const hub=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
  assert.match(panel,/Min observation \(seconds\)/);
  assert.match(panel,/Max observation \(seconds\)/);
  assert.doesNotMatch(panel,/<span>Slots<\/span>/);
  assert.match(panel,/browser stays open until/i);
  assert.match(hub,/requestedWorkUnits:eligibleAccountIds\.length/);
  assert.match(hub,/slots:eligibleAccountIds\.length/);
  assert.match(hub,/value:eligibleAccountIds\.length/);
});

test('STREAM UI makes playback a required core action rather than an optional checkbox',()=>{
  const panel=fs.readFileSync('src/components/StreamingChecksPanel.tsx','utf8');
  const hub=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
  assert.match(panel,/Playback starts automatically/i);
  assert.match(panel,/disabled=\{o\.id==='playback'\}/);
  assert.match(hub,/const runChecks:StreamingQaCheck\[\]=checks\.includes\('playback'\)\?checks:\['playback',\.\.\.checks\]/);
  assert.match(hub,/const request:StreamingRunConfig=\{/);
  assert.match(hub,/checks:runChecks/);
});


test('pause resume and volume actions are optional and configured explicitly in Streaming Hub',()=>{
  const checks=fs.readFileSync('src/components/StreamingChecksPanel.tsx','utf8');
  const hub=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
  assert.match(checks,/Pause duration \(seconds\)/);
  assert.match(checks,/min="0\.5" max="3"/);
  assert.match(checks,/Reduce volume/);
  assert.match(checks,/Increase volume/);
  assert.match(hub,/pauseResumeSeconds/);
  assert.match(hub,/volumeDirection/);
  assert.doesNotMatch(hub,/DEFAULT_CHECKS[^\n]*pause-resume/);
  assert.doesNotMatch(hub,/DEFAULT_CHECKS[^\n]*volume-control/);
});

test('account groups are configured in Streaming Hub rather than Test Accounts',()=>{
  const hub=fs.readFileSync('src/pages/StreamingHub.tsx','utf8');
  const groups=fs.readFileSync('src/components/StreamingGroupPlanPanel.tsx','utf8');
  const accounts=fs.readFileSync('src/components/StreamingAccountsPanel.tsx','utf8');
  assert.match(hub,/StreamingGroupPlanPanel/);
  assert.match(groups,/ACCOUNT GROUPS/);
  assert.match(groups,/Create groups here in Streaming Hub/);
  assert.match(groups,/toggleAccount/);
  assert.doesNotMatch(accounts,/qaGroup/);
  assert.match(accounts,/grouping is configured separately in Streaming Hub/i);
});
