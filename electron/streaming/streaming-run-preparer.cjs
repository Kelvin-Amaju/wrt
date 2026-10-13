const DEFAULT_STREAMING_ARTIST_FRESHNESS_MS=6*60*60*1000;

function sanitizeTrack(track){
  if(!track||typeof track!=='object') return null;
  const out={};
  for(const key of ['id','platform','title','artist','album','url','durationSeconds','artworkUrl','spotifyTrackId','creditedArtistIds','creditedArtistNames','releaseId','releaseName','releaseDate','isrc','alternateReleaseIds','unavailable','discoveredAt','isNew']) if(track[key]!==undefined) out[key]=track[key];
  return out;
}

function sanitizeGroupNormalQa(value={}){
  const observation={minSeconds:Math.max(1,Math.min(3600,Number(value?.observation?.minSeconds)||60)),maxSeconds:Math.max(1,Math.min(3600,Number(value?.observation?.maxSeconds)||110))};
  if(observation.maxSeconds<observation.minSeconds)observation.maxSeconds=observation.minSeconds;
  const deviceMode=['android','ios','mixed'].includes(value?.deviceMode)?value.deviceMode:'desktop';
  return {
    observation,
    queueMode:['shuffle','loop'].includes(value?.queueMode)?value.queueMode:'sequential',
    playbackSpeed:1,
    restAfterTracks:Math.max(0,Math.floor(Number(value?.restAfterTracks)||0)),
    restMinutes:Math.max(0,Math.floor(Number(value?.restMinutes)||0)),
    checks:Array.isArray(value?.checks)?[...new Set(['playback',...value.checks.map(String)])]:['playback','session-verification'],
    pauseResumeSeconds:Math.max(.5,Math.min(3,Number(value?.pauseResumeSeconds)||3)),
    volumeDirection:value?.volumeDirection==='increase'?'increase':'decrease',
    executionMode:value?.executionMode==='background'?'background':'visible',
    muteAudio:Boolean(value?.muteAudio),captureScreenshots:Boolean(value?.captureScreenshots),deviceMode,
    deviceProfile:String(value?.deviceProfile||'Desktop 1280x720').trim(),
    mixedDeviceModes:Array.isArray(value?.mixedDeviceModes)?[...new Set(value.mixedDeviceModes.map(String).filter(item=>['desktop','android','ios'].includes(item)))]:['desktop','android','ios'],
    mixedDeviceProfiles:value?.mixedDeviceProfiles&&typeof value.mixedDeviceProfiles==='object'?{desktop:String(value.mixedDeviceProfiles.desktop||'Desktop 1280x720'),android:String(value.mixedDeviceProfiles.android||'Pixel 11'),ios:String(value.mixedDeviceProfiles.ios||'iPhone 18 Pro')}:{desktop:'Desktop 1280x720',android:'Pixel 11',ios:'iPhone 18 Pro'},
  };
}
function sanitizeStreamingRunRequest(request={}){
  const selection=request.savedArtistSelection&&typeof request.savedArtistSelection==='object'?{mode:request.savedArtistSelection.mode==='all'?'all':'selected',artistIds:Array.isArray(request.savedArtistSelection.artistIds)?request.savedArtistSelection.artistIds.map(String):[]}:undefined;
  return {
    runKind:'streaming',
    platform:request.platform,
    deviceMode:['android','ios','mixed'].includes(request.deviceMode)?request.deviceMode:'desktop',
    deviceProfile:String(request.deviceProfile||'').trim(),
    mixedDeviceModes:Array.isArray(request.mixedDeviceModes)?[...new Set(request.mixedDeviceModes.map(String).filter(value=>['desktop','android','ios'].includes(value)))]:[],
    mixedDeviceProfiles:request.mixedDeviceProfiles&&typeof request.mixedDeviceProfiles==='object'?{
      desktop:String(request.mixedDeviceProfiles.desktop||'').trim(),
      android:String(request.mixedDeviceProfiles.android||'').trim(),
      ios:String(request.mixedDeviceProfiles.ios||'').trim(),
    }:{},
    collectionIds:Array.isArray(request.collectionIds)?request.collectionIds.map(String):[],
    ...(Array.isArray(request.savedArtistIds)?{savedArtistIds:request.savedArtistIds.map(String)}:{}),
    ...(selection?{savedArtistSelection:selection}:{}),
    trackIds:Array.isArray(request.trackIds)?request.trackIds.map(String):[],
    ...(Array.isArray(request.inlineTracks)?{inlineTracks:request.inlineTracks.map(sanitizeTrack).filter(Boolean)}:{}),
    accountIds:Array.isArray(request.accountIds)?request.accountIds.map(String):[],
    groupPlans:Array.isArray(request.groupPlans)?request.groupPlans.map((group,index)=>({
      groupId:String(group?.groupId||`Group ${index+1}`).trim()||`Group ${index+1}`,
      accountIds:Array.isArray(group?.accountIds)?[...new Set(group.accountIds.map(String))]:[],
      trackMode:group?.trackMode==='count'?'count':'all',
      ...(group?.trackMode==='count'?{trackCount:Math.max(1,Math.floor(Number(group?.trackCount)||1))}:{}),
      repeatCount:Math.max(1,Math.min(100,Math.floor(Number(group?.repeatCount)||1))),
      ...(group?.contentIntelligence&&typeof group.contentIntelligence==='object'?{contentIntelligence:{...group.contentIntelligence,enabled:group.contentIntelligence.enabled===true}}:{}),
      ...(group?.normalQa&&typeof group.normalQa==='object'?{normalQa:sanitizeGroupNormalQa(group.normalQa)}:{}),
    })).filter(group=>group.accountIds.length):[],
    slots:request.slots,
    observation:{minSeconds:request.observation?.minSeconds,maxSeconds:request.observation?.maxSeconds},
    queueMode:request.queueMode,
    playbackSpeed:request.playbackSpeed,
    restAfterTracks:request.restAfterTracks,
    restMinutes:request.restMinutes,
    checks:Array.isArray(request.checks)?request.checks.map(String):[],
    pauseResumeSeconds:Math.max(0.5,Math.min(3,Number(request.pauseResumeSeconds)||3)),
    volumeDirection:request.volumeDirection==='increase'?'increase':'decrease',
    executionMode:request.executionMode,
    captureScreenshots:Boolean(request.captureScreenshots),
    ...(request.contentIntelligence&&typeof request.contentIntelligence==='object'?{contentIntelligence:{...request.contentIntelligence}}:{}),
    ...(request.requestedWorkUnits!==undefined?{requestedWorkUnits:request.requestedWorkUnits}:{}),
    ...(request.concurrency&&typeof request.concurrency==='object'?{concurrency:{mode:'manual',value:request.concurrency.value}}:{}),
  };
}
function isStale(artist,nowMs,freshnessMs){const at=Date.parse(artist?.lastFetchedAt||''); return !Number.isFinite(at)||nowMs-at>=freshnessMs;}
function selectedTracks(artists){const map=new Map(); for(const artist of artists){const selected=new Set(artist.selectedTrackIds||[]); for(const track of artist.catalogTracks||[]){const id=String(track.spotifyTrackId||track.id||''); if(!id||!selected.has(id)||track.unavailable) continue; if(!map.has(id)) map.set(id,track);}} return [...map.values()];}
function createStreamingRunPreparer({savedArtistStore,artistService,freshnessMs=DEFAULT_STREAMING_ARTIST_FRESHNESS_MS,now=()=>new Date()}={}){
  if(!savedArtistStore?.list) throw new Error('savedArtistStore is required');
  async function refreshOne(artist,{signal,onProgress=()=>{}}={}){if(signal?.aborted) throw new Error('Streaming catalog request cancelled'); if(!artist?.autoRefreshEnabled||!isStale(artist,now().getTime(),freshnessMs)||!artistService?.refreshSavedArtist) return {refreshed:false,artist}; try{const updated=await artistService.refreshSavedArtist({savedArtistId:artist.id,signal,onProgress}); return {refreshed:true,artist:updated};}catch(error){return {refreshed:false,artist,warning:`${artist.artistName}: ${error instanceof Error?error.message:String(error)}`};}}
  async function refreshStaleSavedArtists({reason='hub-open',signal,onProgress=()=>{}}={}){const refreshedArtistIds=[]; const warnings=[]; const rows=savedArtistStore.list(); for(const artist of rows){if(signal?.aborted) throw new Error('Streaming catalog request cancelled'); const result=await refreshOne(artist,{signal,onProgress:p=>onProgress({...p,message:p.message||`${reason}: refreshing ${artist.artistName}`})}); if(result.refreshed) refreshedArtistIds.push(artist.id); if(result.warning) warnings.push(result.warning);} return {refreshedArtistIds,warnings};}
  async function prepare({savedArtistIds=[],mode='all',signal,onProgress=()=>{}}={}){let rows=savedArtistStore.list(); const allowed=mode==='selected'?new Set((savedArtistIds||[]).map(String)):null; let targets=rows.filter(a=>(!allowed||allowed.has(String(a.id)))&&(a.selectedTrackIds||[]).length>0); const refreshedArtistIds=[]; const warnings=[]; for(const artist of targets){const result=await refreshOne(artist,{signal,onProgress}); if(result.refreshed) refreshedArtistIds.push(artist.id); if(result.warning) warnings.push(result.warning);} if(refreshedArtistIds.length) rows=savedArtistStore.list(); targets=rows.filter(a=>(!allowed||allowed.has(String(a.id)))&&(a.selectedTrackIds||[]).length>0); return {tracks:selectedTracks(targets),refreshedArtistIds,warnings};}
  return {prepare,refreshStaleSavedArtists};
}
module.exports={createStreamingRunPreparer,DEFAULT_STREAMING_ARTIST_FRESHNESS_MS,isStale,selectedTracks,sanitizeStreamingRunRequest,sanitizeGroupNormalQa};
