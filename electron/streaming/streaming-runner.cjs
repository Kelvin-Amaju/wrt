const { createTrackDeck, nextTrack, assignInitialTracks } = require('./playback-planner.cjs');
const { runPersistentAccountStreamingSession } = require('./streaming-session-worker.cjs');
const path = require('node:path');
const fs = require('node:fs');

function abortError(){ const e=new Error('Streaming run stopped'); e.name='AbortError'; return e; }
function throwIfAborted(signal){ if(signal?.aborted) throw abortError(); }
function abortableDelay(ms,signal){return new Promise((resolve,reject)=>{throwIfAborted(signal);const timer=setTimeout(()=>{signal?.removeEventListener?.('abort',onAbort);resolve();},ms);const onAbort=()=>{clearTimeout(timer);signal?.removeEventListener?.('abort',onAbort);reject(abortError());};signal?.addEventListener?.('abort',onAbort,{once:true});});}
function accountLaunchRampMs(workerIndex=1){return Math.min(2500,Math.max(0,(Math.max(1,Number(workerIndex)||1)-1)*180));}
function buildTrackSet(request, collectionStore){
  const byId=new Map();
  for(const id of request.collectionIds||[]){ const c=collectionStore?.get?.(id); for(const t of c?.tracks||[]) if(t?.id) byId.set(String(t.id),t); }
  if(Array.isArray(request.inlineTracks)) for(const t of request.inlineTracks) if(t?.id) byId.set(String(t.id),t);
  const selected=Array.isArray(request.trackIds)&&request.trackIds.length ? request.trackIds.map(id=>byId.get(String(id))).filter(Boolean) : [...byId.values()];
  return selected.filter(track=>!track?.platform||String(track.platform)===String(request.platform));
}

function buildMusicSelections(request,collectionStore,tracks=[]){
  const selectedIds=new Set((tracks||[]).map(track=>String(track?.id||track?.url||'')).filter(Boolean));
  const out=[];
  for(const id of request.collectionIds||[]){
    const collection=collectionStore?.get?.(id);
    if(!collection)continue;
    if(collection.platform&&String(collection.platform)!==String(request.platform))continue;
    const collectionTracks=(collection.tracks||[]).filter(track=>{
      if(track?.platform&&String(track.platform)!==String(request.platform))return false;
      const key=String(track?.id||track?.url||'');
      return !selectedIds.size||selectedIds.has(key);
    });
    if(!collectionTracks.length)continue;
    out.push({
      id:String(collection.id||id),
      name:String(collection.name||'Saved music'),
      platform:String(collection.platform||request.platform),
      sourceKind:String(collection.sourceKind||'track'),
      sourceInput:String(collection.sourceInput||collection.canonicalSourceInput||collectionTracks[0]?.url||''),
      canonicalSourceInput:String(collection.canonicalSourceInput||collection.sourceInput||collectionTracks[0]?.url||''),
      tracks:collectionTracks,
    });
  }
  return out;
}


function redactActivityText(value){
  return String(value??'')
    .replace(/((?:password|passwd|token|authorization|cookie|sessionsecret|secret)\s*[:=]\s*)[^\s,;]+/gi,'$1[REDACTED]')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi,'$1[REDACTED]');
}
function sanitizeActivityUrl(value){
  const raw=String(value||'').trim();
  if(!raw)return '';
  try{
    const parsed=new URL(raw);
    parsed.search='';
    parsed.hash='';
    return parsed.toString();
  }catch{return redactActivityText(raw);}
}
function sanitizeActivityMeta(meta={}){
  const out={};
  for(const [key,value] of Object.entries(meta||{})){
    if(['password','sessionSecret','cookies','cookie','token','secret','authorization','type'].includes(key))continue;
    if(['url','currentUrl','sourceUrl','sourceInput'].includes(key))out[key==='url'?'currentUrl':key]=sanitizeActivityUrl(value);
    else if(typeof value==='string')out[key]=redactActivityText(value);
    else out[key]=value;
  }
  return out;
}
function inferActivitySeverity(message,meta={}){
  if(meta.severity)return meta.severity;
  const text=String(message||'').toLowerCase();
  if(/error|failed|failure|crash|unable|blocked/.test(text))return 'error';
  if(/retry|warning|attention|recovery|not started|outside/.test(text))return 'warning';
  if(/confirmed|ready|completed|opened/.test(text))return 'success';
  return 'info';
}

const DEFAULT_MIXED_STREAMING_PROFILES={
  desktop:'Desktop 1280x720',
  android:'Pixel 11',
  ios:'iPhone 18 Pro',
};
function mixedStreamingDevicesForRequest(request={}){
  const requested=Array.isArray(request.mixedDeviceModes)?request.mixedDeviceModes.map(String):[];
  const modes=[...new Set(requested.filter(mode=>['desktop','android','ios'].includes(mode)))];
  const selected=modes.length?modes:['desktop','android','ios'];
  const profiles=request.mixedDeviceProfiles&&typeof request.mixedDeviceProfiles==='object'?request.mixedDeviceProfiles:{};
  return selected.map(deviceMode=>({deviceMode,deviceProfile:String(profiles[deviceMode]||DEFAULT_MIXED_STREAMING_PROFILES[deviceMode])}));
}
function mixedStreamingDeviceForIndex(index=0,request={}){
  const devices=mixedStreamingDevicesForRequest(request);
  return devices[Math.abs(Number(index)||0)%devices.length];
}
function deviceForIndex(index,request={}){
  if(request.deviceMode==='mixed') return mixedStreamingDeviceForIndex(index,request);
  const deviceMode=['android','ios'].includes(request.deviceMode)?request.deviceMode:'desktop';
  const deviceProfile=String(request.deviceProfile||'')||(deviceMode==='android'?'Pixel 11':deviceMode==='ios'?'iPhone 18 Pro':'Desktop 1280x720');
  return {deviceMode,deviceProfile};
}

// Retained for compatibility with source checks that inspect finite device rotation.
function makeWorkUnits(request, tracks){
  const units=[]; let mixedIndex=0;
  for(const accountId of request.accountIds||[]){
    const deck=createTrackDeck({tracks,mode:request.queueMode||'sequential',seed:`${request.runSeed||'stream'}:${accountId}`});
    let state=deck; let ordinal=0;
    while(true){
      const n=nextTrack(state); state=n.state; if(!n.track) break; const track=n.track;
      const device=request.deviceMode==='mixed'?mixedStreamingDeviceForIndex(mixedIndex++,request):deviceForIndex(0,request);
      units.push({workId:`stream:${accountId}:${track.id}`,accountId:String(accountId),track,ordinal:ordinal++,executionMode:request.executionMode === 'background' ? 'background' : 'visible',muteAudio:Boolean(request.muteAudio),contentIntelligence:request.contentIntelligence||null,...device});
      if(request.queueMode==='loop' && ordinal>=tracks.length) break;
    }
  }
  return units;
}

function shortAccountRef(value){
  const clean=String(value||'').replace(/[^a-z0-9]/gi,'');
  return clean.slice(-6)||'account';
}
function workerIdentity(plan={}){
  const workerIndex=Math.max(1,Number(plan.workerIndex)||Number(plan.ordinal)+1||1);
  return {workerIndex,workerLabel:`Worker #${workerIndex} / acct:${shortAccountRef(plan.accountId)}`};
}
function makePersistentAccountPlans(request={},tracks=[]){
  const accountIds=(request.accountIds||[]).map(String);
  const assignments=assignInitialTracks({accountIds,tracks,seed:request.runSeed||'stream'});
  return assignments.map((assignment,index)=>({
    workId:`stream-account:${assignment.accountId}`,
    accountId:assignment.accountId,
    groupId:String(request.groupId||'Group 1'),
    initialTrack:assignment.track,
    ordinal:index,
    workerIndex:index+1,
    executionMode:request.executionMode === 'background' ? 'background' : 'visible',
    muteAudio:Boolean(request.muteAudio),
    contentIntelligence:request.contentIntelligence||null,
    browserRuntime:request.browserRuntime||'chrome-installed',
    ...deviceForIndex(index,request),
  }));
}
function normalizeGroupPlans(request={},tracks=[]){
  const allAccountIds=[...new Set((request.accountIds||[]).map(String).filter(Boolean))];
  const allowed=new Set(allAccountIds);
  const raw=Array.isArray(request.groupPlans)?request.groupPlans:[];
  const seen=new Set();
  const groups=[];
  for(let index=0;index<raw.length;index++){
    const row=raw[index]||{};
    const accountIds=[...new Set((row.accountIds||[]).map(String).filter(id=>allowed.has(id)&&!seen.has(id)))];
    if(!accountIds.length)continue;
    for(const id of accountIds)seen.add(id);
    const trackMode=row.trackMode==='count'?'count':'all';
    const requestedCount=Math.max(1,Math.floor(Number(row.trackCount)||1));
    const storedGroupIntelligence=request?.contentIntelligence?.groupConfigs?.[index];const groupIntelligence=row.contentIntelligence&&typeof row.contentIntelligence==='object'?{...row.contentIntelligence,enabled:row.contentIntelligence.enabled===true}:storedGroupIntelligence&&typeof storedGroupIntelligence==='object'?{...request.contentIntelligence,...storedGroupIntelligence,enabled:storedGroupIntelligence.enabled===true}:{...(request.contentIntelligence||{}),enabled:request.contentIntelligence?.enabled===true};
    const configuredRepeat=groupIntelligence.enabled?groupIntelligence?.groupRepeatCounts?.[index]:undefined;
    const repeatCount=Math.max(1,Math.min(100,Math.floor(Number(row.repeatCount??configuredRepeat)||1)));
    const fallbackNormal={observation:request.observation||{minSeconds:60,maxSeconds:110},queueMode:request.queueMode||'sequential',playbackSpeed:Number(request.playbackSpeed)||1,restAfterTracks:Math.max(0,Number(request.restAfterTracks)||0),restMinutes:Math.max(0,Number(request.restMinutes)||0),restAndReplay:Boolean(request.restAndReplay),checks:Array.isArray(request.checks)?request.checks:['playback','session-verification'],pauseResumeSeconds:request.pauseResumeSeconds,volumeDirection:request.volumeDirection,executionMode:request.executionMode,muteAudio:Boolean(request.muteAudio),captureScreenshots:Boolean(request.captureScreenshots),deviceMode:request.deviceMode,deviceProfile:request.deviceProfile,mixedDeviceModes:request.mixedDeviceModes,mixedDeviceProfiles:request.mixedDeviceProfiles,browserRuntime:request.browserRuntime||'chrome-installed'};
    const normalQa=row.normalQa&&typeof row.normalQa==='object'?{...fallbackNormal,...row.normalQa,observation:{...fallbackNormal.observation,...(row.normalQa.observation||{})},checks:Array.isArray(row.normalQa.checks)?row.normalQa.checks:fallbackNormal.checks}:fallbackNormal;
    groups.push({groupId:String(row.groupId||`Group ${groups.length+1}`).trim()||`Group ${groups.length+1}`,accountIds,trackMode,trackCount:trackMode==='count'?Math.min(requestedCount,Math.max(1,tracks.length)):tracks.length,repeatCount,contentIntelligence:groupIntelligence,normalQa});
  }
  const remaining=allAccountIds.filter(id=>!seen.has(id));
  if(remaining.length)groups.push({groupId:groups.length?'Ungrouped':'Group 1',accountIds:remaining,trackMode:'all',trackCount:tracks.length,repeatCount:1,contentIntelligence:{...(request.contentIntelligence||{}),enabled:request.contentIntelligence?.enabled===true},normalQa:{observation:request.observation||{minSeconds:60,maxSeconds:110},queueMode:request.queueMode||'sequential',playbackSpeed:Number(request.playbackSpeed)||1,restAfterTracks:Math.max(0,Number(request.restAfterTracks)||0),restMinutes:Math.max(0,Number(request.restMinutes)||0),restAndReplay:Boolean(request.restAndReplay),checks:Array.isArray(request.checks)?request.checks:['playback','session-verification'],pauseResumeSeconds:request.pauseResumeSeconds,volumeDirection:request.volumeDirection,executionMode:request.executionMode,muteAudio:Boolean(request.muteAudio),captureScreenshots:Boolean(request.captureScreenshots),deviceMode:request.deviceMode,deviceProfile:request.deviceProfile,mixedDeviceModes:request.mixedDeviceModes,mixedDeviceProfiles:request.mixedDeviceProfiles,browserRuntime:request.browserRuntime||'chrome-installed'}});
  return groups;
}
function reservationTrackKey(track){return String(track?.id||track?.url||'');}
function createTrackReservationCoordinator({tracks=[],accountCount=1,signal}={}){
  const active=new Set();
  const enforceNoDuplicate=(tracks||[]).length>=Math.max(1,Number(accountCount)||1);
  async function acquire({preferredTrack,alternatives=[]}={}){
    const pool=[];const seen=new Set();
    for(const track of [preferredTrack,...(alternatives||[]),(tracks||[])[0]].filter(Boolean)){
      const key=reservationTrackKey(track);if(!key||seen.has(key))continue;seen.add(key);pool.push(track);
    }
    if(!pool.length)throw new Error('No selected QA track is available for this account');
    if(!enforceNoDuplicate)return {track:pool[0],release:()=>{}};
    while(true){
      throwIfAborted(signal);
      const free=pool.find(track=>!active.has(reservationTrackKey(track)));
      if(free){const key=reservationTrackKey(free);active.add(key);let released=false;return {track:free,release:()=>{if(released)return;released=true;active.delete(key);}};}
      await abortableDelay(100,signal);
    }
  }
  return {enforceNoDuplicate,acquire,activeCount:()=>active.size};
}


function manualAttentionStreamingError(error){
  const code=String(error?.code||'');
  const text=String(error?.message||error||'');
  return code==='ORBITQA_STREAMING_AUTH_REQUIRED'||/captcha|mfa|2fa|verification code|security challenge|invalid (?:username|password|credentials)|incorrect password/i.test(text);
}
function recoverableStreamingWorkerError(error){
  if(!error||error?.name==='AbortError'||manualAttentionStreamingError(error))return false;
  const code=String(error?.code||'');
  if(['ORBITQA_STREAMING_PLAYBACK_START_FAILED','ORBITQA_STREAMING_RETRYABLE'].includes(code))return true;
  const text=String(error?.message||error||'');
  return /playback did not start|player|device loss|stalled|frozen|timeout|timed out|temporary|temporarily|socket|network|connection|ERR_|page.*error|navigation|session.*could not be confirmed|saved .* session.*stale|try again|reload/i.test(text);
}
function streamingRecoveryAccount(account,recoveryAttempt=0){
  if(!account||recoveryAttempt<1)return account;
  if(String(account.proxySource)==='static'&&account.staticProxyMode!=='manual')return {...account,staticProxyId:''};
  return {...account};
}

async function executeStreamingRun({
  runId,
  request,
  emit=()=>{},
  signal,
  collectionStore,
  accountStore,
  adapterRegistry,
  runSession=runPersistentAccountStreamingSession,
  browserFactory,
  screenshotPolicy,
  screenshotsRoot,
  globalRunScheduler,
  checkpoint={terminalWorkIds:[]},
  runSleep=abortableDelay,
}){
  void runSleep;
  const tracks=buildTrackSet(request,collectionStore);
  const musicSelections=buildMusicSelections(request,collectionStore,tracks);
  if (!screenshotPolicy && request.captureScreenshots && screenshotsRoot) {
    const dir=path.join(screenshotsRoot,String(runId)); fs.mkdirSync(dir,{recursive:true});
    screenshotPolicy={enabled:true,pathFor:(workId,stage)=>path.join(dir,`${String(workId).replace(/[^a-z0-9_-]/gi,'_')}-${String(stage).replace(/[^a-z0-9_-]/gi,'_')}.png`)};
  }
  if(!tracks.length) throw new Error('Streaming QA requires at least one selected track');
  if(!Array.isArray(request.accountIds)||!request.accountIds.length) throw new Error('Streaming QA requires at least one saved account');
  const adapter=adapterRegistry?.get?.(request.platform);
  if(!adapter) throw new Error(`Streaming platform adapter unavailable: ${request.platform}`);
  const groups=normalizeGroupPlans(request,tracks);
  const intelligenceCycles=Math.max(1,...groups.filter(group=>group.contentIntelligence?.enabled).map(group=>Math.max(1,Math.min(100,Math.floor(Number(group.contentIntelligence?.repeatAllGroupCycles)||1)))));
  const allPlans=[];
  for(let allGroupCycle=0;allGroupCycle<intelligenceCycles;allGroupCycle++){
    groups.forEach((group,groupIndex)=>{
      const repeatCount=Math.max(1,Math.min(100,Number(group.repeatCount)||1));
      for(let groupCycle=0;groupCycle<repeatCount;groupCycle++){
        const groupRuntime=group.contentIntelligence?.enabled?request:{...request,...(group.normalQa||{}),observation:group.normalQa?.observation||request.observation,checks:group.normalQa?.checks||request.checks};
        const basePlans=makePersistentAccountPlans({...groupRuntime,...group,groupId:group.groupId,runSeed:`${request.runSeed||runId}:all:${allGroupCycle}:group:${groupIndex}:cycle:${groupCycle}`},tracks);
        for(const plan of basePlans){const repeated=intelligenceCycles>1||repeatCount>1;allPlans.push({...plan,workId:repeated?`${plan.workId}:all:${allGroupCycle+1}:group-cycle:${groupCycle+1}`:plan.workId,groupIndex,groupCycle,allGroupCycle,trackLimit:group.trackCount});}
      }
    });
  }
  const terminal=new Set(checkpoint?.terminalWorkIds||[]);
  let completed=allPlans.filter(plan=>terminal.has(plan.workId)).length, failed=0, activeCount=0, validQaPlaybacks=0, invalidQaPlaybacks=0;
  const playsByAccount={};
  const requestedPlaybackChecks=groups.reduce((sum,group)=>sum+(group.accountIds.length*Math.max(0,Number(group.trackCount)||0)*Math.max(1,Number(group.repeatCount)||1)),0)*intelligenceCycles;
  const metrics=()=>({requested:allPlans.length,running:activeCount,queued:Math.max(0,allPlans.length-completed-failed-activeCount),completed,failed,cancelled:0,incomplete:0});
  const streamingSummary=()=>({platform:request.platform,slots:Math.max(0,...groups.map(group=>group.accountIds.length)),accounts:allPlans.length,tracks:tracks.length,musicSelections:musicSelections.length,groups:groups.length,groupSequenceCycles:intelligenceCycles,queueMode:'grouped-selected-pool',observation:request.observation||{minSeconds:60,maxSeconds:110},requestedPlaybackChecks,playCount:validQaPlaybacks,playsByAccount:{...playsByAccount},validQaPlaybacks,invalidQaPlaybacks,playbackCompletions:validQaPlaybacks});
  emit({type:'streaming-summary',message:'Grouped Streaming QA plan prepared',streamingSummary:streamingSummary(),metrics:metrics()});

  async function runAccountPlan(plan,group,trackCoordinator){
    throwIfAborted(signal);
    if(terminal.has(plan.workId))return;
    const worker=workerIdentity(plan);
    const account=accountStore?.getInternal?.(plan.accountId);
    if(!account){
      failed++;
      emit({type:'session-error',workId:plan.workId,...worker,groupId:group.groupId,status:'failed',message:'Saved streaming account is unavailable',metrics:metrics()});
      return;
    }
    if(account.platform&&String(account.platform)!==String(request.platform)){
      failed++;
      emit({type:'session-error',workId:plan.workId,...worker,groupId:group.groupId,status:'failed',message:`Selected account belongs to ${account.platform}, not ${request.platform}. OrbitQA will not open the wrong platform for this account.`,metrics:metrics()});
      return;
    }
    const recoveryAttempt=Math.max(0,Number(plan.recoveryAttempt)||0);
    const completedTrackIds=new Set(Array.isArray(plan.recoveryCompletedTrackIds)?plan.recoveryCompletedTrackIds:[]);
    const remainingTracks=tracks.filter(track=>!completedTrackIds.has(String(track?.id||track?.url||'')));
    const resumeTrack=recoveryAttempt>0?(remainingTracks.find(track=>String(track?.id||track?.url||'')===String(plan.recoveryResumeTrackId||''))||remainingTracks[0]||plan.initialTrack):(plan.initialTrack||remainingTracks[0]);
    const runtimeAccount=streamingRecoveryAccount(account,recoveryAttempt);
    activeCount++;
    emit({type:'session-start',workId:plan.workId,...worker,groupId:group.groupId,status:'running',severity:'info',stage:'browser',accountId:account.id,accountLabel:account.label||account.id,platform:request.platform,message:`${group.groupId} · ${request.platform} · ${account.label||account.id} QA browser started`,metrics:metrics()});
    let release=()=>{};
    try{
      const rampMs=globalRunScheduler?accountLaunchRampMs(worker.workerIndex):0;
      if(rampMs){
        emit({type:'log',activityType:'browser-launch-ramp',severity:'info',stage:'browser',workId:plan.workId,...worker,groupId:group.groupId,accountId:account.id,accountLabel:account.label||account.id,platform:request.platform,message:`Account browser launch queued for ${rampMs}ms startup ramp to reduce simultaneous Chrome profile contention`,launchDelayMs:rampMs,metrics:metrics()});
        await abortableDelay(rampMs,signal);
      }
      if(globalRunScheduler) release=await globalRunScheduler.requestLaunch(runId,signal);
      const result=await runSession({
        runId,
        workUnit:plan,
        account:runtimeAccount,
        tracks:remainingTracks.length?remainingTracks:tracks,
        musicSelections,
        initialTrack:resumeTrack,
        observation:plan.contentIntelligence?.enabled?(request.observation||{minSeconds:60,maxSeconds:110}):(group.normalQa?.observation||request.observation||{minSeconds:60,maxSeconds:110}),
        queueMode:plan.contentIntelligence?.enabled?(request.queueMode||'sequential'):(group.normalQa?.queueMode||request.queueMode||'sequential'),
        checks:plan.contentIntelligence?.enabled?['playback']:(group.normalQa?.checks||request.checks||['playback','session-verification']),
        pauseResumeSeconds:plan.contentIntelligence?.enabled?request.pauseResumeSeconds:(group.normalQa?.pauseResumeSeconds??request.pauseResumeSeconds),
        volumeDirection:plan.contentIntelligence?.enabled?request.volumeDirection:(group.normalQa?.volumeDirection||request.volumeDirection),
        adapter,
        browserFactory,
        screenshotPolicy:screenshotPolicy||{enabled:Boolean(plan.contentIntelligence?.enabled?request.captureScreenshots:(group.normalQa?.captureScreenshots??request.captureScreenshots))},
        signal,
        restAfterTracks:plan.contentIntelligence?.enabled?request.restAfterTracks:(group.normalQa?.restAfterTracks??request.restAfterTracks),
        restMinutes:plan.contentIntelligence?.enabled?request.restMinutes:(group.normalQa?.restMinutes??request.restMinutes),
        restAndReplay:Boolean(plan.contentIntelligence?.enabled?request.restAndReplay:(group.normalQa?.restAndReplay??request.restAndReplay)),
        maxTrackVisits:Math.max(1,Math.min(Math.max(1,(Number(plan.trackLimit)||tracks.length)-completedTrackIds.size),remainingTracks.length||tracks.length)),
        trackCoordinator,
        log:(message,meta={})=>{
          const clean=sanitizeActivityMeta(meta);
          const originalType=String(meta?.type||'');
          emit({
            type:originalType==='proxy-selection'?'proxy-selection':'log',
            activityType:originalType&&originalType!=='proxy-selection'?originalType:clean.activityType,
            workId:plan.workId,
            ...worker,
            groupId:group.groupId,
            accountId:account.id,
            accountLabel:account.label||account.id,
            platform:request.platform,
            severity:inferActivitySeverity(message,clean),
            stage:clean.stage||'streaming',
            message:redactActivityText(message),
            ...clean,
          });
        },
        onTrackStart:async({track,visit,observationSeconds,assignedProxy,currentExitIp,proxyKind})=>{plan.recoveryResumeTrackId=String(track?.id||track?.url||'');emit({type:'log',activityType:'track-start',severity:'info',stage:'playback',workId:plan.workId,...worker,groupId:group.groupId,accountId:account.id,accountLabel:account.label||account.id,platform:request.platform,message:`QA song ${visit}/${plan.trackLimit}: ${track?.title||track?.id} · observation ${observationSeconds}s`,trackId:track?.id,trackTitle:track?.title,observationSeconds,assignedProxy,currentExitIp,proxyKind});},
        onTrackComplete:async({track,visit,activePlaybackMs,observationSeconds})=>{const completedKey=String(track?.id||track?.url||'');const replayEnabled=Boolean(plan.contentIntelligence?.enabled?request.restAndReplay:(group.normalQa?.restAndReplay??request.restAndReplay));if(completedKey&&!replayEnabled)completedTrackIds.add(completedKey);plan.recoveryCompletedTrackIds=replayEnabled?[]:[...completedTrackIds];plan.recoveryResumeTrackId='';validQaPlaybacks++;playsByAccount[account.id]=(playsByAccount[account.id]||0)+1;emit({type:'log',activityType:'valid-playback',severity:'success',stage:'observation',workId:plan.workId,...worker,groupId:group.groupId,accountId:account.id,accountLabel:account.label||account.id,platform:request.platform,message:`COMPLETED PLAY ${validQaPlaybacks}/${requestedPlaybackChecks}: ${track?.title||track?.id} · ${Math.round((Number(activePlaybackMs)||0)/1000)}s active`,trackId:track?.id,trackTitle:track?.title,playCount:validQaPlaybacks,accountPlayCount:playsByAccount[account.id],validQaPlaybacks,invalidQaPlaybacks,requestedPlaybackChecks,observationSeconds});emit({type:'streaming-summary',message:'Completed play count updated',streamingSummary:streamingSummary(),metrics:metrics()});},
        onTrackInvalid:async({track,reason,activePlaybackMs,observationSeconds})=>{invalidQaPlaybacks++;emit({type:'log',activityType:'invalid-playback',severity:'warning',stage:'observation',workId:plan.workId,...worker,groupId:group.groupId,accountId:account.id,accountLabel:account.label||account.id,platform:request.platform,message:`QA playback NOT counted: ${track?.title||track?.id} · ${Math.round((Number(activePlaybackMs)||0)/1000)}s / ${observationSeconds}s active`,trackId:track?.id,trackTitle:track?.title,validQaPlaybacks,invalidQaPlaybacks,requestedPlaybackChecks,reason});emit({type:'streaming-summary',message:'Invalid/short QA playback recorded',streamingSummary:streamingSummary(),metrics:metrics()});},
        persistAuthorizedSession:async(sessionSecret)=>{
          if(!sessionSecret)return;
          account.sessionSecret=sessionSecret;
          account.hasSessionSecret=true;
          accountStore?.save?.({id:account.id,sessionSecret,status:account.status||'unverified'});
        },
      });
      activeCount=Math.max(0,activeCount-1); completed++;
      emit({type:'session-complete',workId:plan.workId,...worker,groupId:group.groupId,status:'completed',severity:'success',stage:'session',accountId:account.id,accountLabel:account.label||account.id,platform:request.platform,message:`${group.groupId} · ${account.label||account.id} QA browser ended: ${result?.reason||'closed'}`,streamingResult:result,metrics:metrics()});
    }catch(error){
      activeCount=Math.max(0,activeCount-1);
      if(signal?.aborted || error?.name==='AbortError'){
        emit({type:'session-cancelled',workId:plan.workId,...worker,groupId:group.groupId,status:'cancelled',severity:'info',stage:'session',accountId:account.id,accountLabel:account.label||account.id,platform:request.platform,message:'Grouped streaming account session stopped',metrics:metrics()});
        throw error;
      }
      const canRecover=recoverableStreamingWorkerError(error)&&recoveryAttempt<2;
      if(canRecover){
        const reason=redactActivityText(error instanceof Error?error.message:String(error));
        emit({type:'session-recovering',workId:plan.workId,...worker,groupId:group.groupId,status:'RECOVERING',severity:'warning',stage:'recovery',accountId:account.id,accountLabel:account.label||account.id,platform:request.platform,message:`${account.label||account.id} entered RECOVERING (${recoveryAttempt+1}/2): ${reason}`,recoveryAttempt:recoveryAttempt+1,resumeTrackId:plan.recoveryResumeTrackId||'',completedTrackIds:[...completedTrackIds],metrics:metrics()});
        try{release();}catch{} release=()=>{};
        return await runAccountPlan({...plan,recoveryAttempt:recoveryAttempt+1,recoveryCompletedTrackIds:[...completedTrackIds],recoveryResumeTrackId:plan.recoveryResumeTrackId||''},group,trackCoordinator);
      }
      failed++;
      if(error?.code==='ORBITQA_STREAMING_AUTH_REQUIRED'||manualAttentionStreamingError(error)){
        const reason=redactActivityText(error instanceof Error?error.message:String(error));
        account.status='needs-verification';
        account.lastVerificationReason=reason;
        accountStore?.save?.({id:account.id,status:'needs-verification',lastVerifiedAt:new Date().toISOString(),lastVerificationReason:reason});
      }
      const manualAttention=manualAttentionStreamingError(error);
      emit({type:'session-error',workId:plan.workId,...worker,groupId:group.groupId,status:manualAttention?'MANUAL_ATTENTION_REQUIRED':'failed',severity:'error',stage:manualAttention?'manual-attention':'session',accountId:account.id,accountLabel:account.label||account.id,platform:request.platform,message:redactActivityText(error instanceof Error?error.message:String(error)),metrics:metrics()});
    }finally{release();}
  }

  for(let allGroupCycle=0;allGroupCycle<intelligenceCycles;allGroupCycle++){
    if(intelligenceCycles>1)emit({type:'log',activityType:'group-sequence-cycle',severity:'info',stage:'group',message:`Group sequence cycle ${allGroupCycle+1}/${intelligenceCycles} started`,metrics:metrics()});
    for(let groupIndex=0;groupIndex<groups.length;groupIndex++){
      throwIfAborted(signal);
      const group=groups[groupIndex];
      const repeatCount=Math.max(1,Number(group.repeatCount)||1);
      for(let groupCycle=0;groupCycle<repeatCount;groupCycle++){
        const groupPlans=allPlans.filter(plan=>plan.groupIndex===groupIndex&&plan.groupCycle===groupCycle&&plan.allGroupCycle===allGroupCycle&&!terminal.has(plan.workId));
        if(!groupPlans.length)continue;
        const coordinator=createTrackReservationCoordinator({tracks,accountCount:groupPlans.length,signal});
        emit({type:'log',activityType:'group-start',severity:'info',stage:'group',groupId:group.groupId,message:`${group.groupId} cycle ${groupCycle+1}/${repeatCount} started · ${groupPlans.length} account${groupPlans.length===1?'':'s'} · ${group.trackCount} selected QA song${group.trackCount===1?'':'s'} per account · duplicate-song collision protection ${coordinator.enforceNoDuplicate?'ON':'LIMITED (fewer songs than accounts)'}`,metrics:metrics()});
        await Promise.all(groupPlans.map(plan=>runAccountPlan(plan,group,coordinator)));
        emit({type:'log',activityType:'group-complete',severity:'success',stage:'group',groupId:group.groupId,message:`${group.groupId} cycle ${groupCycle+1}/${repeatCount} completed. All browsers for this group cycle are closed before continuing.`,metrics:metrics()});
      }
    }
  }
  const finalStreamingSummary={...streamingSummary(),completed,failed};
  const summary={total:allPlans.length,completed,failed,incomplete:0,durationMs:0,...finalStreamingSummary};
  emit({type:'streaming-summary',message:'Grouped Streaming QA run finished',streamingSummary:finalStreamingSummary,metrics:metrics()});
  return summary;
}
module.exports={executeStreamingRun,buildTrackSet,buildMusicSelections,makeWorkUnits,makePersistentAccountPlans,normalizeGroupPlans,createTrackReservationCoordinator,mixedStreamingDeviceForIndex,mixedStreamingDevicesForRequest,accountLaunchRampMs,_test:{recoverableStreamingWorkerError,manualAttentionStreamingError,streamingRecoveryAccount}};
