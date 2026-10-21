const { app, BrowserWindow, ipcMain, safeStorage, shell, dialog, powerSaveBlocker } = require('electron');
const path = require('node:path');
const { executeQaRun, normalizeQaRunRequest } = require('./qa-runner.cjs');
const { createAndroidService } = require('./android-service.cjs');
const { createAndroidSetup } = require('./android-setup.cjs');
const { createRealIosProvider } = require('./real-ios-provider.cjs');
const { createRealIosService } = require('./real-ios-service.cjs');
const { createProxyStore } = require('./proxy-store.cjs');
const { createCookieStore } = require('./cookie-store.cjs');
const { createProxyHealthChecker } = require('./proxy-health.cjs');
const { createProxyPoolService } = require('./proxy-pool-service.cjs');
const { createProxyIpHistoryStore } = require('./proxy-ip-history-store.cjs');
const { createIpCountryResolver } = require('./ip-country-resolver.cjs');
const { redactSecrets } = require('./proxy-diagnostics.cjs');
const { createGuardedFetch, assertDirectNetworkAllowed } = require('./network-route-guard.cjs');
const { resolveInstalledChrome, resolveInstalledBrave } = require('./chrome-runtime-resolver.cjs');
const { createRunStore } = require('./run-store.cjs');
const { createRunRegistry } = require('./run-registry.cjs');
const { createLaneAutomationManager } = require('./lane-automation-manager.cjs');
const { createRunResourceTracker } = require('./run-resource-tracker.cjs');
const { createGlobalRunScheduler } = require('./global-run-scheduler.cjs');
const { createCollectionStore } = require('./streaming/collection-store.cjs');
const { createStreamingAccountStore } = require('./streaming/account-store.cjs');
const { createCatalogService } = require('./streaming/catalog-service.cjs');
const { executeStreamingRun } = require('./streaming/streaming-runner.cjs');
const { createStreamingBrowserFactory, streamingDeviceProfile } = require('./streaming/streaming-browser-factory.cjs');
const { createLinkVerificationManager } = require('./streaming/link-verification-manager.cjs');
const { createStreamingVerificationBrowserLauncher } = require('./streaming/system-verification-browser.cjs');
const { createSupportedCatalogBrowserLauncher } = require('./streaming/supported-catalog-browser.cjs');
const { getPlatformAdapter, resolveCatalogInputWithHints, detectPlatformFromInput, cleanResolvedMusicUrl } = require('./streaming/platform-adapter.cjs');
const { resolveShareRedirect, preferredCatalogNavigationUrl, tryYouTubeFeedCatalog } = require('./streaming/service-catalog-resolver.cjs');
const { findStreamingDuplicate } = require('./streaming/duplicate-detector.cjs');
const { verifyStreamingSavedAccount } = require('./streaming/account-verifier.cjs');
const { createAccountVerificationManager } = require('./streaming/account-verification-manager.cjs');
const { createSpotifyCatalogAuth } = require('./streaming/spotify-catalog-auth.cjs');
const { createSpotifyCatalogClient } = require('./streaming/spotify-catalog-client.cjs');
const { createStreamingSourceInspector } = require('./streaming/streaming-source-inspector.cjs');
const { createStreamingArtistService } = require('./streaming/streaming-artist-service.cjs');
const { createSavedArtistStore } = require('./streaming/saved-artist-store.cjs');
const { listSocialPlatforms } = require('./social/platforms.cjs');
const { createSocialAccountStore } = require('./social/account-store.cjs');
const { createSocialTargetStore } = require('./social/target-store.cjs');
const { createSocialRunStore } = require('./social/run-store.cjs');
const { createSocialAccountVerificationManager } = require('./social/account-verification-manager.cjs');
const { createSocialRunner } = require('./social/social-runner.cjs');
const { createSocialGroupStore } = require('./social/group-store.cjs');
const { resolveMany: resolveSocialTargets } = require('./social/target-resolver.cjs');
const { createStreamingRunPreparer, sanitizeStreamingRunRequest } = require('./streaming/streaming-run-preparer.cjs');
const { createContentIntelligenceStore } = require('./content-intelligence-store.cjs');
const { createSchedulerManager } = require('./scheduler-manager.cjs');
const { createSchedulerTaskExecutor } = require('./scheduler-actions.cjs');

let realIosService = null;
let proxyPoolService = null;
let cookieStore = null;
let proxyIpHistory = null;
let runRegistry = null;
let streamingCollectionStore = null;
let streamingAccountStore = null;
let streamingCatalogService = null;
let streamingBrowserFactory = null;
let spotifyCatalogAuth = null;
let spotifyCatalogClient = null;
let streamingSourceInspector = null;
let streamingArtistService = null;
let savedArtistStore = null;
let streamingRunPreparer = null;
let linkVerificationManager = null;
let accountVerificationManager = null;
let socialAccountStore = null;
let socialTargetStore = null;
let socialGroupStore = null;
let socialRunStore = null;
let socialBrowserFactory = null;
let socialAccountVerificationManager = null;
let socialRunner = null;
let contentIntelligenceStore = null;
let laneAutomationManager = null;
let schedulerManager = null;
const catalogOperationControllers = new Map();
const catalogFetchCache = new Map();
let quittingAfterPause = false;
const androidService = createAndroidService();
const androidSetup = createAndroidSetup({ scriptPath: app.isPackaged
  ? path.join(process.resourcesPath, 'android-setup', 'setup-android.ps1')
  : path.join(__dirname, '..', 'tools', 'setup-android.ps1') });
const guardedFetch = createGuardedFetch(global.fetch);

function getBrowserRuntimeStatus() {
  const chrome = resolveInstalledChrome();
  const brave = resolveInstalledBrave();
  const primary = chrome.found ? chrome : brave;
  return { found:Boolean(primary?.found), executablePath:primary?.executablePath, source:primary?.source, chromeFound:Boolean(chrome.found), chromeExecutablePath:chrome.executablePath, braveFound:Boolean(brave.found), braveExecutablePath:brave.executablePath };
}

let orbitQaPowerSaveBlockerId = null;

function ensureRuntimePerformanceMode() {
  try {
    if (orbitQaPowerSaveBlockerId == null || !powerSaveBlocker.isStarted(orbitQaPowerSaveBlockerId)) {
      orbitQaPowerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
  } catch {}
}

async function lookupIpCountry(_ip) {
  // Strict proxy fail-closed mode: never enrich proxy history by making a host-direct
  // Internet request. Pool allocations already carry countryCode when known; for
  // other proxy sources we keep the value Unknown rather than exposing the host route.
  return 'Unknown';
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 700,
    backgroundColor: '#080b14',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

function broadcastQaEvent(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('qa:event', payload);
  }
}

function broadcastSocialEvent(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('social:event', payload);
  }
}

ipcMain.handle('app:getInfo', () => ({ name: 'OrbitQA Desktop', version: app.getVersion(), platform: process.platform }));
ipcMain.handle('mobile:getStatus', () => androidService.getStatus());
ipcMain.handle('mobile:startSetup', () => androidSetup.start());
ipcMain.handle('mobile:getSetupState', () => androidSetup.getState());
ipcMain.handle('mobile:listAvds', () => androidService.listAvds());
ipcMain.handle('mobile:launchAvd', (_event, name) => androidService.launchAvd(String(name || '')));
ipcMain.handle('mobile:stopAvd', (_event, serial) => androidService.stopAvd(serial ? String(serial) : undefined));
ipcMain.handle('realIos:getConfig', () => realIosService.getPublicConfig());
ipcMain.handle('realIos:saveConfig', (_event, request) => realIosService.saveConfig(request));
ipcMain.handle('realIos:checkConnection', () => realIosService.checkConnection());

function requireProxyPoolService() { if (!proxyPoolService) throw new Error('Proxy Manager is still starting'); return proxyPoolService; }
async function safeProxyIpc(action) { try { return await action(); } catch (error) { throw new Error(redactSecrets(error instanceof Error ? error.message : String(error))); } }
ipcMain.handle('cookie:list', () => cookieStore?.list?.() || []);
ipcMain.handle('cookie:add', (_event, request) => cookieStore.add(request || {}));
ipcMain.handle('cookie:importJson', (_event, json) => cookieStore.importJson(json));
ipcMain.handle('cookie:delete', (_event, ids) => cookieStore.remove(Array.isArray(ids) ? ids : []));
ipcMain.handle('cookie:setEnabled', (_event, ids, enabled) => cookieStore.setEnabled(Array.isArray(ids) ? ids : [], enabled === true));
ipcMain.handle('proxy:list', (_event, kind) => safeProxyIpc(() => requireProxyPoolService().list(kind || undefined)));
ipcMain.handle('proxy:import', (_event, request) => safeProxyIpc(() => requireProxyPoolService().importText(request || {})));
ipcMain.handle('proxy:update', (_event, id, patch) => safeProxyIpc(() => requireProxyPoolService().update(String(id || ''), patch || {})));
ipcMain.handle('proxy:delete', (_event, ids) => safeProxyIpc(() => requireProxyPoolService().remove(Array.isArray(ids) ? ids : [])));
ipcMain.handle('proxy:setEnabled', (_event, ids, enabled) => safeProxyIpc(() => requireProxyPoolService().setEnabled(Array.isArray(ids) ? ids : [], enabled === true)));
ipcMain.handle('proxy:check', (_event, id) => safeProxyIpc(() => requireProxyPoolService().check(String(id || ''))));
ipcMain.handle('proxy:checkMany', (_event, ids) => safeProxyIpc(() => requireProxyPoolService().checkMany(Array.isArray(ids) ? ids : [])));
ipcMain.handle('proxy:recheckDead', () => safeProxyIpc(() => requireProxyPoolService().recheckDead()));
ipcMain.handle('proxy:summary', () => safeProxyIpc(() => requireProxyPoolService().getSummary()));
ipcMain.handle('proxy:activity', () => safeProxyIpc(() => requireProxyPoolService().getActivity()));
ipcMain.handle('proxy:exportSafe', (_event, options) => safeProxyIpc(() => requireProxyPoolService().exportSafe(options || {})));
ipcMain.handle('proxy:acceptStaticIp', (_event, id) => safeProxyIpc(() => requireProxyPoolService().acceptStaticIp(String(id || ''))));

function requireRunRegistry() { if (!runRegistry) throw new Error('Run Center is still starting'); return runRegistry; }
function socialRunCenterSummary(run){
  if(!run)return null;
  const requested=Math.max(Number(run.plannedTasks)||0,(Array.isArray(run.accountIds)?run.accountIds.length:0)*(Array.isArray(run.targetIds)?run.targetIds.length:0),Number(run.completedTasks)||0);
  const failed=Array.isArray(run.results)?run.results.filter(x=>x?.status==='FAILED').length:Number(run.failedChecks)||0;
  const completed=Math.max(0,(Number(run.completedTasks)||0)-failed);
  const terminal=['COMPLETED','FAILED','STOPPED'].includes(String(run.status));
  const remaining=Math.max(0,requested-(Number(run.completedTasks)||0));
  return {runId:String(run.runId),runKind:'social',attemptCount:Math.max(1,Number(run.attemptCount)||1),autoRerunSelected:Boolean(laneAutomationManager?.isSelected?.('social',String(run.runId))),createdAt:String(run.createdAt||new Date().toISOString()),updatedAt:String(run.updatedAt||run.createdAt||new Date().toISOString()),status:String(run.status||'FAILED'),executionMode:String(run.executionMode||run.requestSnapshot?.executionMode||'visible')==='background'?'background':'visible',requestedConcurrency:1,targetSummary:`${String(run.platform||'Social')} Social QA · ${Array.isArray(run.targetIds)?run.targetIds.length:0} targets`,deviceFamilies:[String(run.deviceProfile||'Desktop 1280x720')],counters:{requested,running:run.status==='RUNNING'?1:0,queued:run.status==='RUNNING'?remaining:0,completed,failed,cancelled:run.status==='STOPPED'?remaining:0,incomplete:terminal?0:remaining},socialMeta:{platform:String(run.platform||''),accounts:Array.isArray(run.accountIds)?run.accountIds.length:0,targets:Array.isArray(run.targetIds)?run.targetIds.length:0,groups:Number(run.groupCount)||0}};
}
function socialRunCenterDetail(run){
  const summary=socialRunCenterSummary(run);if(!summary)return null;
  return {...summary,config:run.requestSnapshot||{platform:run.platform,accountIds:run.accountIds,targetIds:run.targetIds,groupIds:run.groupIds,deviceMode:run.deviceMode,deviceProfile:run.deviceProfile,checks:run.checks,mediaObservationMinSeconds:run.mediaObservationMinSeconds,mediaObservationMaxSeconds:run.mediaObservationMaxSeconds,commentDraft:run.commentDraft},logs:[],socialSummary:{platform:run.platform,accounts:Array.isArray(run.accountIds)?run.accountIds.length:0,targets:Array.isArray(run.targetIds)?run.targetIds.length:0,groups:Number(run.groupCount)||0,completedTasks:Number(run.completedTasks)||0,passedChecks:Number(run.passedChecks)||0,warnings:Number(run.warnings)||0,failedChecks:Number(run.failedChecks)||0},socialResults:Array.isArray(run.results)?run.results:[],resourceMessage:run.error||undefined};
}
function getSocialRunForCenter(runId){return socialRunStore?.get?.(String(runId||''))||null;}
async function rerunSocialForCenter(runId,{automatic=false,recovery=false}={}){
  const id=String(runId||'');const previous=getSocialRunForCenter(id);if(!previous)return {runId:id,rerun:false,reason:'not-found'};
  if(!['COMPLETED','FAILED','STOPPED'].includes(String(previous.status||'')))return {runId:id,rerun:false,reason:'run-is-active'};
  const snapshot=previous.requestSnapshot||{platform:previous.platform,accountIds:previous.accountIds,targetIds:previous.targetIds,checks:previous.checks,mediaObservationMinSeconds:previous.mediaObservationMinSeconds,mediaObservationMaxSeconds:previous.mediaObservationMaxSeconds,deviceMode:previous.deviceMode,deviceProfile:previous.deviceProfile,commentDraft:previous.commentDraft};
  const attemptCount=Math.max(1,Number(previous.attemptCount)||1)+1;
  void socialRunner.execute({...snapshot,runId:id,attemptCount,automatic,recovery});
  return {runId:id,rerun:true,sourceRunId:id};
}
function listAllRunCenterSummaries(){const base=requireRunRegistry().listRuns().map(r=>r.runKind==='streaming'?{...r,autoRerunSelected:Boolean(laneAutomationManager?.isSelected?.('streaming',r.runId))}:r);const social=socialRunStore?.list?.().map(socialRunCenterSummary).filter(Boolean)||[];return [...base,...social].sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));}
ipcMain.handle('qa:createRun', async (_event, request) => requireRunRegistry().createRun(normalizeQaRunRequest(request)));
ipcMain.handle('qa:startRun', async (_event, request) => requireRunRegistry().createRun(normalizeQaRunRequest(request)));
ipcMain.handle('qa:listRuns', () => listAllRunCenterSummaries());
ipcMain.handle('qa:getRun', (_event, runId) => { const id=String(runId||''); const social=getSocialRunForCenter(id); return social?socialRunCenterDetail(social):requireRunRegistry().getRun(id); });
ipcMain.handle('qa:stopRun', (_event, runId) => { const id=String(runId||''); if(getSocialRunForCenter(id)) return socialRunner?.stop?.(id)||{runId:id,stopped:false}; return requireRunRegistry().stopRun(id); });
ipcMain.handle('qa:pauseRun', (_event, runId) => requireRunRegistry().pauseRun(String(runId || '')));
ipcMain.handle('qa:resumeRun', (_event, runId) => requireRunRegistry().resumeRun(String(runId || '')));
ipcMain.handle('qa:rerunRun', (_event, runId) => { const id=String(runId||''); if(getSocialRunForCenter(id)) return rerunSocialForCenter(id); return requireRunRegistry().rerunRun(id); });
ipcMain.handle('qa:deleteRun', (_event, runId) => { const id=String(runId||''); if(getSocialRunForCenter(id)) return socialRunStore?.delete?.(id)||{runId:id,deleted:false}; return requireRunRegistry().deleteRun(id); });
ipcMain.handle('qa:bulkDeleteRuns', async (_event, scope, runKind) => {
  const normalizedScope=String(scope||''); const kind=String(runKind||'');
  if(!['completed','failed','stopped','all-finished'].includes(normalizedScope)) throw new Error('Unsupported bulk delete scope');
  const terminalForScope=(status)=>normalizedScope==='all-finished'?['COMPLETED','FAILED','STOPPED'].includes(status):status===(normalizedScope==='completed'?'COMPLETED':normalizedScope==='failed'?'FAILED':'STOPPED');
  if(kind==='social'){
    const rows=socialRunStore?.list?.()||[]; const ids=rows.filter(r=>terminalForScope(String(r.status||''))).map(r=>String(r.runId)); const deleted=[];
    for(const id of ids){const result=socialRunStore?.delete?.(id);if(result?.deleted)deleted.push(id);} return {scope:normalizedScope,deleted:deleted.length,runIds:deleted};
  }
  if(kind==='run'||kind==='streaming'){
    const expected=kind==='streaming'?'streaming':'qa'; const rows=requireRunRegistry().listRuns().filter(r=>(r.runKind||'qa')===expected&&terminalForScope(String(r.status||''))); const deleted=[];
    for(const row of rows){const result=await requireRunRegistry().deleteRun(row.runId);if(result?.deleted)deleted.push(row.runId);} return {scope:normalizedScope,deleted:deleted.length,runIds:deleted};
  }
  return requireRunRegistry().bulkDeleteRuns(normalizedScope);
});
ipcMain.handle('qa:getAutoRerunState', (_event, runKind) => { const kind=String(runKind||'run'); return kind==='run'?requireRunRegistry().getAutoRerunState():laneAutomationManager?.getAuto?.(kind); });
ipcMain.handle('qa:configureAutoRerun', (_event, request, runKind) => { const kind=String(runKind||'run'); return kind==='run'?requireRunRegistry().configureAutoRerun(request||{}):laneAutomationManager?.configureAuto?.(kind,request||{}); });
ipcMain.handle('qa:getStuckRunRecoveryState', (_event, runKind) => { const kind=String(runKind||'run'); return kind==='run'?requireRunRegistry().getStuckRunRecoveryState():laneAutomationManager?.getRecovery?.(kind); });
ipcMain.handle('qa:configureStuckRunRecovery', (_event, request, runKind) => { const kind=String(runKind||'run'); return kind==='run'?requireRunRegistry().configureStuckRunRecovery(request||{}):laneAutomationManager?.configureRecovery?.(kind,request||{}); });
ipcMain.handle('qa:stopAllRuns', async (_event, runKind) => {
  const kind=String(runKind||'');
  if(kind==='social'){
    const active=new Set(['CREATED','STARTING','RUNNING','PAUSING','PAUSED','RESUMING','STOPPING']); const ids=(socialRunStore?.list?.()||[]).filter(r=>active.has(String(r.status||''))).map(r=>String(r.runId));
    for(const id of ids) socialRunner?.stop?.(id); return {stopped:ids.length,runIds:ids};
  }
  if(kind==='run'||kind==='streaming'){
    const expected=kind==='streaming'?'streaming':'qa'; const active=new Set(['CREATED','STARTING','RUNNING','PAUSING','PAUSED','RESUMING','STOPPING']); const ids=requireRunRegistry().listRuns().filter(r=>(r.runKind||'qa')===expected&&active.has(String(r.status||''))).map(r=>r.runId);
    await Promise.all(ids.map(id=>requireRunRegistry().stopRun(id))); return {stopped:ids.length,runIds:ids};
  }
  return requireRunRegistry().stopAllRuns();
});
ipcMain.handle('qa:getBrowserRuntimeStatus', () => getBrowserRuntimeStatus());
ipcMain.handle('qa:listProxyIpHistory', (_event, query) => proxyIpHistory.list(query || {}));
ipcMain.handle('qa:getRunProxyIpSummary', (_event, runId) => proxyIpHistory.getRunSummary(String(runId || '')));
ipcMain.handle('qa:clearProxyIpHistory', () => proxyIpHistory.clear());
ipcMain.handle('qa:exportProxyIpHistoryCsv', (_event, query) => proxyIpHistory.exportCsv(query || {}));
ipcMain.handle('qa:getProxyIpHistoryRecordingState', () => proxyIpHistory.getRecordingState());
ipcMain.handle('qa:setProxyIpHistoryRecordingState', (_event, enabled) => proxyIpHistory.setRecordingState(Boolean(enabled)));

function requireStreamingServices() {
  if (!streamingCollectionStore || !streamingAccountStore || !streamingCatalogService || !savedArtistStore || !spotifyCatalogAuth || !spotifyCatalogClient || !streamingSourceInspector || !streamingArtistService) throw new Error('Streaming Hub is still starting');
  return { streamingCollectionStore, streamingAccountStore, streamingCatalogService, savedArtistStore, spotifyCatalogAuth, spotifyCatalogClient, streamingSourceInspector, streamingArtistService };
}
function startCatalogOperation(event, operationId) {
  const id=String(operationId||'').trim(); if(!id) throw new Error('operationId is required');
  catalogOperationControllers.get(id)?.abort();
  const controller=new AbortController(); catalogOperationControllers.set(id,controller);
  const progress=(payload)=>{try{event?.sender?.send?.('streaming:catalogProgress',{operationId:id,...payload});}catch{}};
  return {id,controller,progress,finish:()=>catalogOperationControllers.delete(id)};
}
ipcMain.handle('streaming:getCatalogConnectionStatus', () => requireStreamingServices().spotifyCatalogAuth.getPublicStatus());
ipcMain.handle('streaming:configureCatalogClientId', (_event, clientId) => requireStreamingServices().spotifyCatalogAuth.configureClientId(String(clientId||'')));
ipcMain.handle('streaming:connectCatalog', async (_event, request) => { const auth=requireStreamingServices().spotifyCatalogAuth; if(request?.clientId) auth.configureClientId(String(request.clientId)); return auth.connect({timeoutMs:Number(request?.timeoutMs)||120000}); });
ipcMain.handle('streaming:disconnectCatalog', () => requireStreamingServices().spotifyCatalogAuth.disconnect());
ipcMain.handle('streaming:inspectSource', async (event, request) => { const services=requireStreamingServices(); const op=startCatalogOperation(event,request?.operationId); try{op.progress({stage:'inspecting',message:'Inspecting Spotify source'}); const result=await services.streamingSourceInspector.inspect({input:String(request?.input||''),signal:op.controller.signal}); op.progress({stage:'complete',message:'Source inspection complete'}); return result;} finally{op.finish();} });
ipcMain.handle('streaming:fetchArtistCatalog', async (event, request) => { const services=requireStreamingServices(); const op=startCatalogOperation(event,request?.operationId); try{const previous=request?.previousSavedArtistId?services.savedArtistStore.get(String(request.previousSavedArtistId)):services.savedArtistStore.getByPlatformArtistId(String(request?.platformArtistId||'')); const result=await services.streamingArtistService.fetchCatalog({platformArtistId:String(request?.platformArtistId||''),previousArtist:previous||undefined,signal:op.controller.signal,onProgress:(p)=>op.progress(p)}); catalogFetchCache.set(String(request?.platformArtistId||''),result); return result;} finally{op.finish();} });
ipcMain.handle('streaming:cancelCatalogOperation', (_event, operationId) => { const id=String(operationId||''); const controller=catalogOperationControllers.get(id); if(controller) controller.abort(); catalogOperationControllers.delete(id); return {operationId:id,cancelled:Boolean(controller)}; });
ipcMain.handle('streaming:listSavedArtists', () => requireStreamingServices().savedArtistStore.list());
ipcMain.handle('streaming:getSavedArtist', (_event, id) => requireStreamingServices().savedArtistStore.get(String(id||'')));
ipcMain.handle('streaming:saveArtistSelection', (_event, request) => { const services=requireStreamingServices(); if(request?.savedArtistId) return services.savedArtistStore.saveSelection(String(request.savedArtistId),Array.isArray(request.selectedTrackIds)?request.selectedTrackIds:[]); const artistId=String(request?.platformArtistId||''); const result=catalogFetchCache.get(artistId); if(!result) throw new Error('Fetch the complete artist catalog before saving'); return services.savedArtistStore.upsertArtist({result,selectedTrackIds:Array.isArray(request?.selectedTrackIds)?request.selectedTrackIds:[],sourceOrigin:request?.sourceOrigin||null}); });
ipcMain.handle('streaming:refreshSavedArtist', async (event, request) => { const services=requireStreamingServices(); const id=String(request?.savedArtistId||''); const previous=services.savedArtistStore.get(id); if(!previous) throw new Error('Saved artist not found'); const op=startCatalogOperation(event,request?.operationId); try{const result=await services.streamingArtistService.fetchCatalog({platformArtistId:previous.platformArtistId,previousArtist:previous,signal:op.controller.signal,onProgress:p=>op.progress(p)}); catalogFetchCache.set(previous.platformArtistId,result); return services.savedArtistStore.upsertArtist({result,sourceOrigin:null});} finally{op.finish();} });
ipcMain.handle('streaming:setArtistAutoRefresh', (_event, id, enabled) => requireStreamingServices().savedArtistStore.setAutoRefresh(String(id||''),enabled===true));
ipcMain.handle('streaming:deleteSavedArtist', (_event, id) => requireStreamingServices().savedArtistStore.delete(String(id||'')));
ipcMain.handle('streaming:listLegacyCollections', () => requireStreamingServices().streamingCollectionStore.list());
ipcMain.handle('streaming:convertLegacyCollection', (_event, request) => { const services=requireStreamingServices(); const id=String(request?.id||request||''); const legacy=services.streamingCollectionStore.get(id); if(!legacy) return {converted:false,reason:'Legacy collection not found'}; let artistResult=null; if(request?.platformArtistId) artistResult=catalogFetchCache.get(String(request.platformArtistId)); if(!artistResult){for(const a of services.savedArtistStore.list()){const ids=new Set((a.catalogTracks||[]).map(t=>String(t.spotifyTrackId||t.id))); const urls=new Set((a.catalogTracks||[]).map(t=>String(t.url||''))); if((legacy.tracks||[]).every(t=>ids.has(String(t.id||''))||urls.has(String(t.url||'')))){artistResult={status:a.lastFetchStatus==='partial'?'partial':'complete',artist:{platformArtistId:a.platformArtistId,artistName:a.artistName,artistUrl:a.artistUrl,artworkUrl:a.artworkUrl},tracks:a.catalogTracks,completeness:{}}; break;}}} return services.streamingCollectionStore.convertLegacy(id,{artistResult,savedArtistStore:services.savedArtistStore}); });
ipcMain.handle('streaming:refreshStaleSavedArtists', async (event, request) => { if(!streamingRunPreparer) return {refreshedArtistIds:[],warnings:[]}; const opId=request?.operationId||`stale-${Date.now()}`; const op=startCatalogOperation(event,opId); try{return await streamingRunPreparer.refreshStaleSavedArtists({reason:request?.reason==='pre-run'?'pre-run':'hub-open',signal:op.controller.signal,onProgress:p=>op.progress(p)});} finally{op.finish();} });
ipcMain.handle('streaming:listPlatforms', () => requireStreamingServices().streamingCatalogService.listPlatforms());
ipcMain.handle('streaming:resolveCatalog', async (_event, request) => {
  const services = requireStreamingServices();
  const input = String(request?.input || '').trim();
  const detectedPlatform = detectPlatformFromInput(input);
  const directAdapter = getPlatformAdapter(detectedPlatform || request?.platform);
  if (/^https?:\/\//i.test(input) && directAdapter?.classifyInput?.(input) === 'track') {
    const canonicalInput = cleanResolvedMusicUrl(input);
    return await services.streamingCatalogService.resolve({ ...(request || {}), platform:detectedPlatform || request?.platform, input:canonicalInput, page:null, networkJson:[] });
  }

  const fetchTextPreflight = async (url) => {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const response=await guardedFetch(url,{headers:{accept:'application/xml,text/xml,text/plain,*/*','user-agent':'Mozilla/5.0 OrbitQA/0.16.7'},redirect:'follow',signal:controller.signal});
      if(!response.ok) throw new Error(`Catalog text request failed (${response.status})`);
      return await response.text();
    } finally { clearTimeout(timer); }
  };
  const feedPreflight=await tryYouTubeFeedCatalog({platform:detectedPlatform || request?.platform,input,fetchText:fetchTextPreflight});
  const feedFallbackResult=()=>{
    if(!feedPreflight?.tracks?.length) return null;
    const youtubeAdapter=getPlatformAdapter('youtube-music');
    return {platform:'youtube-music',kind:feedPreflight.kind,input,tracks:feedPreflight.tracks.map(row=>youtubeAdapter.normalizeTrack(row))};
  };

  assertDirectNetworkAllowed('Direct catalog browser navigation');
  let chromium;
  try{ ({chromium}=require('playwright')); }
  catch(error){ const fallback=feedFallbackResult(); if(fallback) return fallback; throw error; }
  const { createCatalogResponseCapture } = require('./streaming/adapters/_factory.cjs');
  let browser;
  try{ ({browser}=await createSupportedCatalogBrowserLauncher({chromium}).launch({headless:true})); }
  catch(error){ const fallback=feedFallbackResult(); if(fallback) return fallback; throw error; }
  let capture = null;
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout?.(10000);
    capture = createCatalogResponseCapture(page);
    const redirectedInput = /^https?:\/\//i.test(input) ? await resolveShareRedirect(input,{fetchImpl:guardedFetch}) : input;
    const navigationInput = preferredCatalogNavigationUrl(detectedPlatform || request?.platform, redirectedInput);
    if (/^https?:\/\//i.test(navigationInput)) {
      try{ await page.goto(navigationInput, { waitUntil: 'domcontentloaded', timeout: 30000 }); }catch(error){
        if((detectedPlatform || request?.platform)!=='youtube-music') throw error;
      }
    } else {
      const adapter = getPlatformAdapter(request?.platform);
      const searchUrl = adapter?.buildSearchUrl?.(input);
      if (searchUrl) await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    await page.waitForTimeout?.(700);
    const pageHints = await page.evaluate(() => {
      const values=[];
      const canonical=document.querySelector('link[rel="canonical"]')?.getAttribute('href');
      const ogUrl=document.querySelector('meta[property="og:url"]')?.getAttribute('content');
      if(canonical) values.push(canonical);
      if(ogUrl) values.push(ogUrl);
      for(const anchor of document.querySelectorAll('a[href]')){
        if(values.length>=40) break;
        const href=anchor.href;
        if(href) values.push(href);
      }
      return values;
    }).catch(()=>[]);
    const resolvedInput = resolveCatalogInputWithHints(input, page.url?.() || '', [navigationInput,...pageHints]);
    const fetchJson = async (url) => {
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),12000);
      try{
        const response=await guardedFetch(url,{headers:{accept:'application/json','user-agent':'Mozilla/5.0 OrbitQA/0.16.7'},redirect:'follow',signal:controller.signal});
        if(!response.ok) throw new Error(`Catalog data request failed (${response.status})`);
        return await response.json();
      } finally { clearTimeout(timer); }
    };
    const fetchText = async (url) => {
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),12000);
      try{
        const response=await guardedFetch(url,{headers:{accept:'application/xml,text/xml,text/plain,*/*','user-agent':'Mozilla/5.0 OrbitQA/0.16.7'},redirect:'follow',signal:controller.signal});
        if(!response.ok) throw new Error(`Catalog text request failed (${response.status})`);
        return await response.text();
      } finally { clearTimeout(timer); }
    };
    return await services.streamingCatalogService.resolve({ ...(request || {}), input:resolvedInput, page, networkJson:capture.json, fetchJson, fetchText });
  } finally { capture?.stop?.(); await browser?.close?.().catch(() => undefined); }
});
ipcMain.handle('streaming:listCollections', () => requireStreamingServices().streamingCollectionStore.list());
ipcMain.handle('streaming:checkDuplicate', (_event, request) => { const store=requireStreamingServices().streamingCollectionStore; return findStreamingDuplicate({input:String(request?.input||''),collections:store.list(),ignoreCollectionId:String(request?.ignoreCollectionId||'')}); });
ipcMain.handle('streaming:saveCollection', (_event, request) => { const store=requireStreamingServices().streamingCollectionStore; const duplicate=findStreamingDuplicate({input:String(request?.canonicalSourceInput||request?.sourceInput||''),collections:store.list(),ignoreCollectionId:String(request?.id||'')}); if(duplicate) throw new Error(duplicate.message); return store.save(request || {}); });
ipcMain.handle('streaming:deleteCollection', (_event, id) => requireStreamingServices().streamingCollectionStore.delete(String(id || '')));
ipcMain.handle('streaming:startLinkVerification', async (_event, request) => {
  if(!linkVerificationManager) throw new Error('Link verification is still starting');
  const store=requireStreamingServices().streamingCollectionStore;
  const collection=store.get(String(request?.collectionId||''));
  if(!collection) throw new Error('Saved music item not found');
  const trackId=String(request?.trackId||'').trim();
  let url=String(collection.sourceInput||collection.canonicalSourceInput||'').trim();
  let targetKey=`collection:${collection.id}`;
  if(trackId){
    const track=(collection.tracks||[]).find(item=>String(item?.id||'')===trackId || String(item?.url||'')===trackId);
    if(!track) throw new Error('Saved song not found');
    url=String(track.url||'').trim();
    targetKey=`track:${collection.id}:${String(track.id||track.url)}`;
  }
  return linkVerificationManager.start({
    targetKey,
    url,
    deviceMode:String(request?.deviceMode||'desktop'),
    deviceProfile:String(request?.deviceProfile||'Desktop 1280x720'),
  });
});
ipcMain.handle('streaming:completeLinkVerification', async (_event, request) => {
  if(!linkVerificationManager) throw new Error('Link verification is still starting');
  const verification=await linkVerificationManager.complete(String(request?.sessionId||''));
  const store=requireStreamingServices().streamingCollectionStore;
  return store.markVerified(String(request?.collectionId||''),{
    trackId:String(request?.trackId||'').trim()||undefined,
    url:verification.verifiedUrl,
    deviceMode:verification.verifiedDeviceMode,
    deviceProfile:verification.verifiedDeviceProfile,
    verifiedAt:verification.verifiedAt,
  });
});
ipcMain.handle('streaming:listAccounts', () => requireStreamingServices().streamingAccountStore.list());
ipcMain.handle('streaming:saveAccount', (_event, request) => requireStreamingServices().streamingAccountStore.save(request || {}));
ipcMain.handle('streaming:assignStickyProxy', (_event, id, request) => assignStickyProxyToAccount('streaming',id,request));
ipcMain.handle('streaming:deleteAccount', (_event, id) => requireStreamingServices().streamingAccountStore.delete(String(id || '')));
ipcMain.handle('streaming:verifyAccount', async (_event, id) => {
  const services = requireStreamingServices();
  return verifyStreamingSavedAccount({ accountId:String(id||''), accountStore:services.streamingAccountStore, adapterRegistry:{get:getPlatformAdapter}, browserFactory:streamingBrowserFactory });
});
ipcMain.handle('streaming:repairAccountProfile', (_event, id) => {
  const services=requireStreamingServices();
  const account=services.streamingAccountStore.getInternal(String(id||''));
  if(!account)throw new Error('Streaming account was not found');
  const result=streamingBrowserFactory.repairAccountProfile(account);
  services.streamingAccountStore.save({
    id:account.id,
    status:'unverified',
    lastVerifiedAt:'',
    lastVerificationReason:'Browser profile repaired. Sign in again and verify this account.',
    lastVerificationBrowser:'',
    lastVerificationDeviceMode:'',
    lastVerificationDeviceProfile:'',
    lastVerificationProxySource:'',
  });
  return result;
});
ipcMain.handle('streaming:startAccountVerification', async (_event, request) => {
  if(!accountVerificationManager) throw new Error('Account verification is still starting');
  return accountVerificationManager.start(request||{});
});
ipcMain.handle('streaming:completeAccountVerification', async (_event, request) => {
  if(!accountVerificationManager) throw new Error('Account verification is still starting');
  return accountVerificationManager.complete(String(request?.sessionId||''));
});
ipcMain.handle('streaming:cancelAccountVerification', async (_event, request) => {
  if(!accountVerificationManager) throw new Error('Account verification is still starting');
  return accountVerificationManager.cancel(String(request?.sessionId||''));
});
ipcMain.handle('streaming:getContentIntelligence',()=>contentIntelligenceStore?.get('streaming')||{});
ipcMain.handle('streaming:setContentIntelligence',(_event,value)=>contentIntelligenceStore?.set('streaming',value||{})||{});
ipcMain.handle('social:getContentIntelligence',()=>contentIntelligenceStore?.get('social')||{});
ipcMain.handle('social:setContentIntelligence',(_event,value)=>contentIntelligenceStore?.set('social',value||{})||{});
ipcMain.handle('streaming:startRun', async (_event, request) => {
  const storedStreamingIntelligence=contentIntelligenceStore?.get('streaming')||{};let preparedRequest=sanitizeStreamingRunRequest({...request,contentIntelligence:{...storedStreamingIntelligence,...(request?.contentIntelligence||{}),groupConfigs:storedStreamingIntelligence?.groupConfigs||request?.contentIntelligence?.groupConfigs}});
  const selection=request?.savedArtistSelection;
  const savedIds=Array.isArray(selection?.artistIds)?selection.artistIds:(Array.isArray(request?.savedArtistIds)?request.savedArtistIds:[]);
  if(streamingRunPreparer && (selection || savedIds.length)){
    const mode=selection?.mode==='all'?'all':'selected';
    const prepared=await streamingRunPreparer.prepare({savedArtistIds:savedIds,mode});
    if(!prepared.tracks.length) throw new Error('Saved Artists contain no selected tracks for this Streaming QA run');
    preparedRequest={...preparedRequest,savedArtistIds:savedIds,trackIds:prepared.tracks.map(t=>String(t.spotifyTrackId||t.id)),inlineTracks:prepared.tracks};
  }
  return requireRunRegistry().createRun(preparedRequest);
});


function requireSocialServices() {
  if (!socialAccountStore || !socialTargetStore || !socialGroupStore || !socialRunner || !socialAccountVerificationManager) throw new Error('Social Hub is still starting');
  return { socialAccountStore, socialTargetStore, socialGroupStore, socialRunner, socialAccountVerificationManager };
}
ipcMain.handle('social:listPlatforms', () => listSocialPlatforms());
function staticProxyPlatformScope(account){
  const platform=String(account?.platform||'').trim().toLowerCase();
  return platform?`platform:${platform}`:`account:${String(account?.id||'unknown')}`;
}
function staticProxyExclusionsForAccount(kind,account){
  const id=String(account?.id||'');
  const platform=String(account?.platform||'').trim().toLowerCase();
  const entries=[
    ...(streamingAccountStore?.list?.()||[]).map(a=>({kind:'streaming',account:a})),
    ...(socialAccountStore?.list?.()||[]).map(a=>({kind:'social',account:a})),
  ];
  return entries
    .filter(({kind:entryKind,account:other})=>{
      if(entryKind===kind&&String(other?.id||'')===id)return false;
      if(!other?.staticProxyId)return false;
      return String(other?.platform||'').trim().toLowerCase()===platform;
    })
    .map(({account:other})=>String(other.staticProxyId));
}
async function assignStickyProxyToAccount(kind,accountId,request={}){
  const id=String(accountId||'');
  const store=kind==='social'?socialAccountStore:streamingAccountStore;
  const account=store?.get?.(id);if(!account)throw new Error('Saved account was not found');
  if(!proxyPoolService)throw new Error('Proxy Manager is still starting');
  const mode=String(request?.mode||'auto')==='manual'?'manual':'auto';
  if(mode==='auto'){
    // Default keeps OrbitQA's automatic static-pool allocation. Clear any manual pin so the
    // normal allocator can choose a healthy static proxy and pin it for this account on use.
    return store.save({id,proxySource:'static',staticProxyMode:'auto',staticProxyId:''});
  }
  const proxyId=String(request?.proxyId||'').trim();
  if(!proxyId)throw new Error('Choose a static proxy to assign to this account');
  const allStatic=await proxyPoolService.list('static');
  const chosen=allStatic.find(p=>String(p.id)===proxyId);
  if(!chosen)throw new Error('The selected static proxy was not found');
  if(!chosen.enabled)throw new Error('The selected static proxy is disabled');
  if(!['live','slow'].includes(String(chosen.health)))throw new Error('The selected static proxy is not healthy. Check it in Proxy Manager first.');
  if(chosen.staticIpChangePending)throw new Error('The selected static proxy has a pending IP change. Accept or resolve it in Proxy Manager first.');
  // Manual assignment intentionally allows the same static IP/proxy on multiple accounts.
  return store.save({id,proxySource:'static',staticProxyMode:'manual',staticProxyId:chosen.id});
}
ipcMain.handle('social:listAccounts', () => requireSocialServices().socialAccountStore.list());
ipcMain.handle('social:saveAccount', (_event, request) => requireSocialServices().socialAccountStore.save(request || {}));
ipcMain.handle('social:assignStickyProxy', (_event, id, request) => assignStickyProxyToAccount('social',id,request));
ipcMain.handle('social:deleteAccount', (_event, id) => requireSocialServices().socialAccountStore.delete(String(id || '')));
ipcMain.handle('social:startAccountVerification', (_event, request) => requireSocialServices().socialAccountVerificationManager.start(request || {}));
ipcMain.handle('social:completeAccountVerification', (_event, request) => requireSocialServices().socialAccountVerificationManager.complete(String(request?.sessionId || '')));
ipcMain.handle('social:cancelAccountVerification', (_event, request) => requireSocialServices().socialAccountVerificationManager.cancel(String(request?.sessionId || '')));
ipcMain.handle('social:verifyAccount', (_event, id) => requireSocialServices().socialAccountVerificationManager.verifySaved(String(id || '')));
ipcMain.handle('social:listTargets', () => requireSocialServices().socialTargetStore.list());
ipcMain.handle('social:addTargets', async (_event, request) => {
  const services=requireSocialServices();const result=services.socialTargetStore.addMany(Array.isArray(request?.urls)?request.urls:[]);
  const resolved=await resolveSocialTargets(result.added,{fetchImpl:guardedFetch});
  result.added=resolved.map(item=>services.socialTargetStore.update(item.id,item));
  return result;
});
ipcMain.handle('social:updateTarget', (_event, id, patch) => requireSocialServices().socialTargetStore.update(String(id || ''), patch || {}));
ipcMain.handle('social:deleteTarget', (_event, id) => requireSocialServices().socialTargetStore.delete(String(id || '')));
ipcMain.handle('social:listGroups', () => requireSocialServices().socialGroupStore.list());
ipcMain.handle('social:saveGroup', (_event, request) => requireSocialServices().socialGroupStore.save(request || {}));
ipcMain.handle('social:deleteGroup', (_event, id) => requireSocialServices().socialGroupStore.delete(String(id || '')));
ipcMain.handle('social:startRun', (_event, request) => {const storedSocialIntelligence=contentIntelligenceStore?.get('social')||{};return requireSocialServices().socialRunner.start({...request,contentIntelligence:{...storedSocialIntelligence,...(request?.contentIntelligence||{}),groupConfigs:storedSocialIntelligence?.groupConfigs||request?.contentIntelligence?.groupConfigs}});});
ipcMain.handle('social:stopRun', (_event, runId) => requireSocialServices().socialRunner.stop(String(runId || '')));
ipcMain.handle('social:listRuns', () => requireSocialServices().socialRunner.listRuns());
ipcMain.handle('social:getRun', (_event, runId) => requireSocialServices().socialRunner.getRun(String(runId || '')));
ipcMain.handle('social:clearRuns', () => socialRunStore?.clear?.() || {cleared:false});

function requireSchedulerManager(){ if(!schedulerManager) throw new Error('Scheduler is still starting'); return schedulerManager; }
ipcMain.handle('scheduler:list', () => requireSchedulerManager().list());
ipcMain.handle('scheduler:save', (_event, request) => requireSchedulerManager().save(request || {}));
ipcMain.handle('scheduler:delete', (_event, id) => requireSchedulerManager().remove(String(id || '')));
ipcMain.handle('scheduler:setEnabled', (_event, id, enabled) => requireSchedulerManager().setEnabled(String(id || ''), enabled === true));
ipcMain.handle('scheduler:runNow', (_event, id) => requireSchedulerManager().runNow(String(id || '')));

ipcMain.handle('qa:getRunState', () => {
  const runs = runRegistry?.listRuns?.() || [];
  const active = runs.filter((r) => ['CREATED','STARTING','RUNNING','PAUSING','RESUMING','STOPPING'].includes(r.status));
  return { phase: active.length ? 'running' : 'idle', runId: active[0]?.runId || null, activeCount: active.length };
});

app.whenReady().then(async () => {
  ensureRuntimePerformanceMode();
  const userDataPath = app.getPath('userData');
  contentIntelligenceStore = createContentIntelligenceStore({userDataPath});
  realIosService = createRealIosService({ userDataPath, safeStorage, provider: createRealIosProvider({fetchImpl:guardedFetch}) });
  const { chromium, webkit, devices } = require('playwright');
  const proxyStore = createProxyStore({ userDataPath, safeStorage });
  cookieStore = createCookieStore({ userDataPath, safeStorage });
  const routeCheckUrl = 'https://api64.ipify.org?format=json';
  const proxyHealthChecker = createProxyHealthChecker({ chromium, routeCheckUrl });
  proxyPoolService = createProxyPoolService({ store: proxyStore, healthChecker: proxyHealthChecker });
  proxyPoolService.start();
  const ipCountryResolver = createIpCountryResolver({ lookup:lookupIpCountry, concurrency:1 });
  proxyIpHistory = createProxyIpHistoryStore({
    filePath:path.join(userDataPath, 'proxy-ip-history.json'),
    debounceMs:1000,
    countryResolver:ipCountryResolver,
  });
  streamingBrowserFactory = createStreamingBrowserFactory({ chromium, webkit, devices, proxyPoolService, routeCheckUrl, profileBaseDir:path.join(app.getPath('userData'),'streaming-browser-profiles'), onStaticProxyAssigned:async(id,proxyId)=>{if(streamingAccountStore)streamingAccountStore.save({id,staticProxyId:proxyId});}, getStaticProxyExclusions:async(account)=>staticProxyExclusionsForAccount('streaming',account) });
  socialBrowserFactory = createStreamingBrowserFactory({ chromium, webkit, devices, proxyPoolService, routeCheckUrl, profileBaseDir:path.join(app.getPath('userData'),'social-browser-profiles'), onStaticProxyAssigned:async(id,proxyId)=>{if(socialAccountStore)socialAccountStore.save({id,staticProxyId:proxyId});}, getStaticProxyExclusions:async(account)=>staticProxyExclusionsForAccount('social',account) });
  linkVerificationManager = createLinkVerificationManager({ BrowserWindow, deviceProfileResolver:streamingDeviceProfile, verificationBrowserLauncher:createStreamingVerificationBrowserLauncher({browserFactory:streamingBrowserFactory}) });

  const secretCodec = {
    encode: (value) => safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(String(value)).toString('base64') : Buffer.from(String(value),'utf8').toString('base64'),
    decode: (value) => safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(String(value),'base64')) : Buffer.from(String(value),'base64').toString('utf8'),
  };
  streamingCollectionStore = createCollectionStore({ baseDir:userDataPath });
  streamingAccountStore = createStreamingAccountStore({ baseDir:userDataPath, secretCodec });
  accountVerificationManager = createAccountVerificationManager({ accountStore:streamingAccountStore, adapterRegistry:{get:getPlatformAdapter}, browserFactory:streamingBrowserFactory });
  socialAccountStore = createSocialAccountStore({ baseDir:userDataPath, secretCodec });
  socialTargetStore = createSocialTargetStore({ baseDir:userDataPath });
  socialGroupStore = createSocialGroupStore({ baseDir:userDataPath });
  socialRunStore = createSocialRunStore({ baseDir:userDataPath });
  socialAccountVerificationManager = createSocialAccountVerificationManager({ accountStore:socialAccountStore, browserFactory:socialBrowserFactory });
  socialRunner = createSocialRunner({ accountStore:socialAccountStore, targetStore:socialTargetStore, browserFactory:socialBrowserFactory, runStore:socialRunStore, onEvent:broadcastSocialEvent });
  streamingCatalogService = createCatalogService();
  savedArtistStore = createSavedArtistStore({ baseDir:userDataPath });
  spotifyCatalogAuth = createSpotifyCatalogAuth({ baseDir:userDataPath, secretCodec, openExternal: (url) => { assertDirectNetworkAllowed('External browser navigation'); return shell.openExternal(url); }, fetchImpl: guardedFetch });
  spotifyCatalogClient = createSpotifyCatalogClient({ auth: spotifyCatalogAuth, fetchImpl: guardedFetch });
  streamingSourceInspector = createStreamingSourceInspector({ spotifyClient: spotifyCatalogClient });
  streamingArtistService = createStreamingArtistService({ spotifyClient: spotifyCatalogClient, savedArtistStore });
  streamingRunPreparer = createStreamingRunPreparer({ savedArtistStore, artistService: streamingArtistService });

  const configuredBrowserSessionLimit=Math.max(8,Math.min(64,Number(process.env.ORBITQA_BROWSER_SESSION_LIMIT)||32));
  const globalRunScheduler = createGlobalRunScheduler({ startupLimit: configuredBrowserSessionLimit });
  const runStore = createRunStore({ userDataPath });
  const runResourceTracker = createRunResourceTracker({ cleanupTimeoutMs:1500, forceTimeoutMs:1500 });
  runRegistry = createRunRegistry({
    runStore,
    executeRun: executeQaRun,
    executeStreamingRun,
    globalRunScheduler,
    screenshotsRootProvider: () => path.join(userDataPath, 'runs'),
    dependencies: {
      androidService, realIosService, proxyPoolService, proxyIpHistory, cookieStore,
      collectionStore:streamingCollectionStore, accountStore:streamingAccountStore,
      adapterRegistry:{ get:getPlatformAdapter }, browserFactory:streamingBrowserFactory,
      runResourceTracker,
      forceStopRunResources:(runId) => runResourceTracker.forceCleanup(runId),
    },
  });
  runRegistry.subscribe(broadcastQaEvent);
  laneAutomationManager = createLaneAutomationManager({
    listRuns:listAllRunCenterSummaries,
    rerunRun:async(kind,id,opts)=>kind==='social'?rerunSocialForCenter(id,opts):requireRunRegistry().rerunRun(id,opts),
    stopRun:async(kind,id)=>kind==='social'?(socialRunner?.stop?.(id)||{runId:id,stopped:false}):requireRunRegistry().stopRun(id),
  });
  const executeScheduledTask = createSchedulerTaskExecutor({
    getRunRegistry:requireRunRegistry,
    getProxyPoolService:requireProxyPoolService,
    streamingAccountStore,
    verifyStreamingSavedAccount,
    streamingAdapterRegistry:{get:getPlatformAdapter},
    streamingBrowserFactory,
    streamingRunPreparer,
    socialAccountStore,
    socialAccountVerificationManager,
    androidService,
    realIosService,
    getBrowserRuntimeStatus,
  });
  schedulerManager = createSchedulerManager({baseDir:userDataPath,executeTask:executeScheduledTask});
  schedulerManager.start();

  createMainWindow();
  await runRegistry.resumePersistedRuns();

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
}).catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error('OrbitQA startup failed:', error);
  try { dialog.showErrorBox('OrbitQA could not start', `OrbitQA hit a startup error.

${message}`); } catch {}
  app.quit();
});

app.on('before-quit', (event) => {
  if (quittingAfterPause || !runRegistry) { linkVerificationManager?.closeAll?.(); accountVerificationManager?.closeAll?.(); socialAccountVerificationManager?.closeAll?.(); laneAutomationManager?.stop?.(); schedulerManager?.stop?.(); proxyPoolService?.stop(); return; }
  event.preventDefault();
  quittingAfterPause = true;
  Promise.resolve(runRegistry.pauseAllForShutdown())
    .then(() => proxyIpHistory?.flush?.())
    .catch(() => undefined)
    .finally(() => { linkVerificationManager?.closeAll?.(); accountVerificationManager?.closeAll?.(); socialAccountVerificationManager?.closeAll?.(); laneAutomationManager?.stop?.(); schedulerManager?.stop?.(); proxyPoolService?.stop(); app.quit(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
