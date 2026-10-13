const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs');
test('preload exposes streaming APIs on namespaced IPC channels',()=>{const s=fs.readFileSync('electron/preload.cjs','utf8'); const pairs=[['listStreamingPlatforms','streaming:listPlatforms'],['resolveStreamingCatalog','streaming:resolveCatalog'],['listStreamingCollections','streaming:listCollections'],['checkStreamingDuplicate','streaming:checkDuplicate'],['saveStreamingCollection','streaming:saveCollection'],['deleteStreamingCollection','streaming:deleteCollection'],['listStreamingAccounts','streaming:listAccounts'],['saveStreamingAccount','streaming:saveAccount'],['deleteStreamingAccount','streaming:deleteAccount'],['verifyStreamingAccount','streaming:verifyAccount'],['startStreamingRun','streaming:startRun'],['startStreamingLinkVerification','streaming:startLinkVerification'],['completeStreamingLinkVerification','streaming:completeLinkVerification']]; for(const [fn,ch] of pairs){assert.match(s,new RegExp(fn)); assert.match(s,new RegExp(ch.replace(':','\\:')));}});
test('main wires streaming handlers and safe storage codec',()=>{const s=fs.readFileSync('electron/main.cjs','utf8'); for(const ch of ['streaming:listPlatforms','streaming:resolveCatalog','streaming:listCollections','streaming:checkDuplicate','streaming:saveCollection','streaming:listAccounts','streaming:saveAccount','streaming:startRun','streaming:startLinkVerification','streaming:completeLinkVerification']) assert.match(s,new RegExp(ch.replace(':','\\:'))); assert.match(s,/createStreamingAccountStore/); assert.match(s,/safeStorage/);});

test('managed artist catalog IPC is explicit and token-safe at the preload boundary',()=>{
  const preload=fs.readFileSync('electron/preload.cjs','utf8');
  const main=fs.readFileSync('electron/main.cjs','utf8');
  const pairs=[
    ['getSpotifyCatalogConnectionStatus','streaming:getCatalogConnectionStatus'],
    ['configureSpotifyCatalogClientId','streaming:configureCatalogClientId'],
    ['connectSpotifyCatalog','streaming:connectCatalog'],
    ['disconnectSpotifyCatalog','streaming:disconnectCatalog'],
    ['inspectStreamingSource','streaming:inspectSource'],
    ['fetchStreamingArtistCatalog','streaming:fetchArtistCatalog'],
    ['cancelStreamingCatalogOperation','streaming:cancelCatalogOperation'],
    ['listSavedStreamingArtists','streaming:listSavedArtists'],
    ['getSavedStreamingArtist','streaming:getSavedArtist'],
    ['saveStreamingArtistSelection','streaming:saveArtistSelection'],
    ['refreshSavedStreamingArtist','streaming:refreshSavedArtist'],
    ['setSavedStreamingArtistAutoRefresh','streaming:setArtistAutoRefresh'],
    ['deleteSavedStreamingArtist','streaming:deleteSavedArtist'],
    ['listLegacyStreamingCollections','streaming:listLegacyCollections'],
    ['convertLegacyStreamingCollection','streaming:convertLegacyCollection'],
    ['refreshStaleSavedStreamingArtists','streaming:refreshStaleSavedArtists'],
  ];
  for(const [fn,ch] of pairs){assert.match(preload,new RegExp(fn)); assert.match(preload,new RegExp(ch.replace(':','\\:'))); assert.match(main,new RegExp(ch.replace(':','\\:')));}
  assert.match(preload,/streaming:catalogProgress/);
  assert.doesNotMatch(preload,/access_token|refresh_token|pkceVerifier|codeVerifier/);
});
test('catalog navigation uses the browser final URL after redirects before extraction',()=>{const s=fs.readFileSync('electron/main.cjs','utf8'); assert.match(s,/resolveCatalogInputWithHints/); assert.match(s,/resolveCatalogInputWithHints\(input,\s*page\.url/);});
test('catalog IPC resolves share-page canonical hints and supplies service JSON fallback',()=>{const s=fs.readFileSync('electron/main.cjs','utf8'); assert.match(s,/resolveCatalogInputWithHints/); assert.match(s,/fetchJson/); assert.match(s,/rel=.canonical|canonical/i);});
test('catalog IPC resolves known short/share links over HTTP before browser navigation',()=>{const s=fs.readFileSync('electron/main.cjs','utf8'); assert.match(s,/resolveShareRedirect/); assert.match(s,/await\s+resolveShareRedirect\(/); assert.match(s,/page\.goto\(navigationInput/);});

test('direct-track catalog IPC bypasses browser navigation before launching Playwright',()=>{const s=fs.readFileSync('electron/main.cjs','utf8'); const handler=s.slice(s.indexOf("ipcMain.handle('streaming:resolveCatalog'"),s.indexOf("ipcMain.handle('streaming:listCollections'")); const direct=handler.indexOf("classifyInput?.(input) === 'track'"); const launch=handler.indexOf("require('playwright')"); assert.ok(direct>=0); assert.ok(launch>direct); assert.match(handler,/page:null/);});

test('catalog IPC prefers ordinary YouTube channel navigation for YouTube Music artist/channel links',()=>{
  const s=fs.readFileSync('electron/main.cjs','utf8');
  const handler=s.slice(s.indexOf("ipcMain.handle('streaming:resolveCatalog'"),s.indexOf("ipcMain.handle('streaming:listCollections'"));
  assert.match(handler,/preferredCatalogNavigationUrl/);
});


test('YouTube Music channel and playlist public-feed preflight runs before Playwright browser launch',()=>{
  const source=fs.readFileSync('electron/main.cjs','utf8');
  const handler=source.slice(source.indexOf("ipcMain.handle('streaming:resolveCatalog'"),source.indexOf("ipcMain.handle('streaming:listCollections'"));
  const preflightIndex=handler.indexOf('tryYouTubeFeedCatalog');
  const browserIndex=handler.indexOf("require('playwright')");
  assert.ok(preflightIndex>=0,'resolveCatalog should call tryYouTubeFeedCatalog');
  assert.ok(browserIndex>=0,'resolveCatalog should still keep browser fallback');
  assert.ok(preflightIndex<browserIndex,'public feed must be attempted before Playwright launch');
});

test('preload exposes start complete and cancel account verification IPC instead of one-shot verification only',()=>{
  const preload=fs.readFileSync('electron/preload.cjs','utf8');
  const main=fs.readFileSync('electron/main.cjs','utf8');
  const pairs=[
    ['startStreamingAccountVerification','streaming:startAccountVerification'],
    ['completeStreamingAccountVerification','streaming:completeAccountVerification'],
    ['cancelStreamingAccountVerification','streaming:cancelAccountVerification'],
  ];
  for(const [fn,ch] of pairs){assert.match(preload,new RegExp(fn));assert.match(preload,new RegExp(ch.replace(':','\\:')));assert.match(main,new RegExp(ch.replace(':','\\:')));}
  assert.match(main,/createAccountVerificationManager/);
});

test('main routes music verification through the shared streaming browser factory policy',()=>{
  const main=fs.readFileSync('electron/main.cjs','utf8');
  assert.match(main,/createStreamingVerificationBrowserLauncher/);
  assert.match(main,/verificationBrowserLauncher:createStreamingVerificationBrowserLauncher\(\{browserFactory:streamingBrowserFactory\}\)/);
});
