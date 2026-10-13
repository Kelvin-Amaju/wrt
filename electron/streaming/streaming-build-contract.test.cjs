const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function atLeast(actual,minimum){const a=String(actual).split('.').map(Number),b=String(minimum).split('.').map(Number);for(let i=0;i<3;i++){if((a[i]||0)>(b[i]||0))return true;if((a[i]||0)<(b[i]||0))return false;}return true;}

test('v0.18.8 build contract preserves worker-aware live diagnostics, Spotify result readiness, guarded persistent profiles, DRM-capable Chrome launch, selected-track playback and durable sessions through renderer, preload, registry and tests',()=>{
  const pkg=JSON.parse(read('package.json'));
  const app=read('src/App.tsx');
  const sidebar=read('src/components/Sidebar.tsx');
  const preload=read('electron/preload.cjs');
  const main=read('electron/main.cjs');
  const shared=read('src/shared/streaming.ts');
  const browserFactory=read('electron/streaming/streaming-browser-factory.cjs');
  const accountVerification=read('electron/streaming/account-verification-manager.cjs');
  const adapterFactory=read('electron/streaming/adapters/_factory.cjs');
  const runner=read('electron/streaming/streaming-runner.cjs');
  const worker=read('electron/streaming/streaming-session-worker.cjs');
  const accountsPanel=read('src/components/StreamingAccountsPanel.tsx');
  const playbackPanel=read('src/components/StreamingPlaybackPanel.tsx');
  assert.match(browserFactory,/parseAuthorizedSessionState/);
  assert.match(browserFactory,/storageState/);
  assert.match(browserFactory,/ignoreStoredSession/);
  assert.match(browserFactory,/launchPersistentContext/);
  assert.match(browserFactory,/persistentProfileDir/);
  assert.match(browserFactory,/existingPages/);
  assert.match(browserFactory,/await installStrictPrivacyGuard\(context,true\)/);
  assert.match(browserFactory,/page=await context\.newPage\(\)/);
  assert.match(browserFactory,/ignoreDefaultArgs=\['--disable-component-update'\]/);
  assert.match(main,/streaming-browser-profiles/);
  assert.match(adapterFactory,/activatePlayLocator/);
  assert.match(adapterFactory,/protectedMediaReadiness/);
  assert.match(adapterFactory,/\.tap\(/);
  assert.match(adapterFactory,/keyboard.*press/s);
  assert.match(adapterFactory,/data-orbitqa-selected-track-play/);
  assert.match(adapterFactory,/waitForSpotifySelectedPlayControl/);
  assert.match(adapterFactory,/requireEnabled:true/);
  assert.match(worker,/spotify-search-resolved/);
  assert.match(worker,/playbackControls\(\{page,signal,track/);
  assert.match(worker,/attachStreamingPageDiagnostics/);
  assert.match(worker,/playback-attempt/);
  assert.match(runner,/accountLabel/);
  assert.match(runner,/workerLabel/);
  assert.match(runner,/workerIndex/);
  assert.match(runner,/sanitizeActivityMeta/);
  assert.match(accountVerification,/captureAuthorizedSession/);
  assert.match(accountVerification,/ignoreStoredSession/);
  assert.match(runner,/makePersistentAccountPlans/);
  assert.match(runner,/stream-account:/);
  assert.match(worker,/runPersistentAccountStreamingSession/);
  assert.match(worker,/trackForCurrentUrl/);
  assert.match(accountsPanel,/accountSearch/);
  assert.doesNotMatch(playbackPanel,/<span>Slots<\/span>/);
  assert.ok(atLeast(pkg.version,'0.18.9'),`expected package version >= 0.18.9, got ${pkg.version}`);
  assert.match(app,/StreamingHub/);
  assert.match(sidebar,/Streaming Hub/);
  assert.match(sidebar,/Music Library/);
  assert.match(sidebar,/Test Accounts/);
  assert.match(app,/streaming-accounts/);
  assert.match(app,/streaming-library/);
  for(const api of ['resolveStreamingCatalog','listStreamingCollections','checkStreamingDuplicate','saveStreamingCollection','deleteStreamingCollection','startStreamingLinkVerification','completeStreamingLinkVerification','saveStreamingAccount','startStreamingAccountVerification','completeStreamingAccountVerification','cancelStreamingAccountVerification','startStreamingRun']) assert.match(preload,new RegExp(api));
  assert.match(main,/streaming:startRun/);
  assert.match(shared,/inlineTracks\?: StreamingTrack\[\]/);
  assert.match(pkg.scripts.test,/electron\/streaming\/streaming-runner\.test\.cjs/);
  assert.match(pkg.scripts.test,/electron\/streaming\/simple-import-ui-contract\.test\.cjs/);
  assert.match(pkg.scripts.test,/electron\/streaming\/multiplatform-importer\.test\.cjs/);
  assert.match(pkg.scripts.test,/electron\/streaming\/duplicate-detector\.test\.cjs/);
  assert.match(pkg.scripts.test,/electron\/streaming\/platform-auth\.test\.cjs/);
  assert.match(pkg.scripts.test,/electron\/streaming\/streaming-accounts-page-contract\.test\.cjs/);
  assert.match(pkg.scripts.test,/electron\/streaming\/supported-browser-policy\.test\.cjs/);
  assert.match(pkg.scripts.test,/electron\/streaming\/supported-catalog-browser\.test\.cjs/);
  assert.match(pkg.scripts.test,/electron\/streaming\/account-verification-manager\.test\.cjs/);
  assert.match(pkg.scripts.test,/electron\/streaming\/authorized-session\.test\.cjs/);
  assert.match(pkg.scripts.test,/electron\/streaming\/durable-account-session\.test\.cjs/);
  assert.match(pkg.scripts.test,/electron\/streaming\/streaming-live-log\.test\.cjs/);
});

test('Streaming Hub exposes only explicit saved-account favorite/follow QA actions and no stream-inflation controls',()=>{
  const hub=read('src/pages/StreamingHub.tsx');
  const checks=read('src/components/StreamingChecksPanel.tsx');
  const adapter=read('electron/streaming/adapters/_factory.cjs');
  assert.doesNotMatch(hub,/fake listener|stream inflation/i);
  assert.match(checks,/favorite-track/); assert.match(checks,/follow-artist/);
  assert.match(adapter,/favoriteTrack/); assert.match(adapter,/followArtist/);
});

test('simple importer is platform-wide and stores exact fetched track links inside saved albums',()=>{
  const hub=read('src/pages/StreamingHub.tsx');
  const importer=read('src/components/SimpleStreamingImporter.tsx');
  const albums=read('src/components/SavedStreamingAlbumsPanel.tsx');
  assert.match(hub,/resolveStreamingCatalog/);
  assert.match(hub,/saveStreamingCollection/);
  assert.match(hub,/inlineTracks:runTracks/);
  assert.doesNotMatch(hub,/platform==='spotify'.*SimpleStreamingImporter/s);
  assert.match(importer,/track\.url/);
  for(const label of ['FETCH SONGS','Album name','SAVE ALBUM','Clear Workspace']) assert.match(importer,new RegExp(label,'i'));
  for(const label of ['Use for QA','OPEN','ADD SONGS','RENAME','DELETE']) assert.match(albums,new RegExp(label,'i'));
});

test('v0.15 managed artist backend remains available for compatibility but is not required by the renderer',()=>{
  const shared=read('src/shared/streaming.ts');
  const env=read('src/vite-env.d.ts');
  const hub=read('src/pages/StreamingHub.tsx');
  assert.match(shared,/interface SavedStreamingArtist/);
  assert.match(env,/listSavedStreamingArtists/);
  assert.doesNotMatch(hub,/SavedStreamingArtistsPanel|SpotifyCatalogConnectionPanel/);
});

test('Streaming Hub uses the shared account verification request type so every ProxySource compiles',()=>{
  const hub=read('src/pages/StreamingHub.tsx');
  assert.match(hub,/type StreamingAccountVerificationRequest/);
  assert.match(hub,/startAccountVerification\(id:string,request:StreamingAccountVerificationRequest\)/);
  assert.doesNotMatch(hub,/proxySource:'none'\|'rotating'\|'static'\|'smart-mix'/);
});


test('Streaming Hub exposes a direct QA music allowlist from the saved Music Library',()=>{const hub=read('src/pages/StreamingHub.tsx');const selector=read('src/components/StreamingRunLibraryPanel.tsx');assert.match(hub,/StreamingRunLibraryPanel/);assert.match(selector,/QA MUSIC SELECTION/);assert.match(selector,/Only checked songs are placed in the run allowlist/i);assert.match(selector,/stops or corrects navigation before playback/i);});
