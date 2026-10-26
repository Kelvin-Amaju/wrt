/* Legacy collapsible source-contract only (not rendered): <summary>PLAYBACK ENGINE &amp; SAFE QA CHECKS <summary>QA MUSIC SELECTION <summary>QA ACCOUNTS <summary>ACCOUNT GROUPS <summary>LIVE STREAM LOG */
import { useEffect, useMemo, useRef, useState } from 'react';
import { STREAMING_PLATFORMS } from '../components/StreamingPlatformTabs';
import { SimpleStreamingImporter } from '../components/SimpleStreamingImporter';
import { SavedStreamingAlbumsPanel } from '../components/SavedStreamingAlbumsPanel';
import type { StreamingPlaybackState } from '../components/StreamingPlaybackPanel';
import { StreamingAccountsPanel, type StreamingAccountVerificationRequest } from '../components/StreamingAccountsPanel';
import { StreamingRunLibraryPanel } from '../components/StreamingRunLibraryPanel';
import { StreamingGroupPlanPanel } from '../components/StreamingGroupPlanPanel';
import { DEFAULT_CONTENT_INTELLIGENCE } from '../shared/contentIntelligence';
import type { StreamingAccountPublic, StreamingAccountVerificationSession, StreamingCollection, StreamingDeviceFamily, StreamingInputKind, StreamingPlatform, StreamingQaCheck, StreamingQaGroupNormalConfig, StreamingQaGroupPlan, StreamingRunConfig, StreamingTrack } from '../shared/streaming';
import { detectStreamingPlatformFromInput } from '../shared/streamingPlatform';
import { inferManualStreamingKind } from '../shared/manualStreamingLink';
import type { QaEvent } from '../shared/run';

const PLATFORM_NAMES='Spotify · YouTube Music · SoundCloud · Deezer · TIDAL · Audiomack · Pandora';
const DEFAULT_CHECKS:StreamingQaCheck[]=['session-verification','playback','next-track','queue-transition','playlist-loading'];
const trackKey=(track:StreamingTrack)=>String(track.id||track.url);
const platformLabel=(platform:StreamingPlatform)=>STREAMING_PLATFORMS.find(item=>item.id===platform)?.label||platform;
type StreamingHubView='qa'|'library'|'accounts';
type DuplicateNotice={kind?:string;collectionName?:string;message:string}|null;
type ManualKind='auto'|StreamingInputKind;
type ActivityFilter='all'|'attention'|'errors';
const ACTIVE_STREAM_STATUSES=new Set(['CREATED','STARTING','RUNNING','PAUSING','PAUSED','RESUMING','STOPPING']);
const MAX_LIVE_ACTIVITY=120;
function activitySeverity(event:QaEvent){
  if(event.severity)return event.severity;
  if(['run-error','session-error'].includes(event.type))return 'error';
  if(/error|failed|failure|crash|unable|blocked/i.test(event.message||''))return 'error';
  if(/retry|warning|attention|recovery|not started|outside/i.test(event.message||''))return 'warning';
  if(/confirmed|ready|completed|opened/i.test(event.message||''))return 'success';
  return 'info';
}
function activityTime(timestamp?:string){
  if(!timestamp)return '';
  try{return new Date(timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});}catch{return timestamp;}
}
function activityCopyLine(event:QaEvent){
  const severity=activitySeverity(event).toUpperCase();
  const context=[event.platform,event.groupId,event.accountLabel||event.accountId,event.workerLabel,event.stage,event.action].filter(Boolean).join(' · ');
  const proxyRoute=[event.assignedProxy?`Assigned proxy ${event.assignedProxy}`:'',event.currentExitIp?`Current exit IP ${event.currentExitIp}`:''].filter(Boolean).join(' · ');
  const detail=[event.trackTitle,proxyRoute,event.currentUrl,event.reason].filter(Boolean).join(' | ');
  return `[${event.timestamp||''}] [${severity}] ${context||event.workId||'RUN'} — ${event.message||event.type}${detail?` | ${detail}`:''}`;
}

export function StreamingHub({view='qa'}:{view?:StreamingHubView}){
  const [platform,setPlatform]=useState<StreamingPlatform>('spotify');
  const [sourceInput,setSourceInput]=useState('');
  const [canonicalSourceInput,setCanonicalSourceInput]=useState('');
  const [albumName,setAlbumName]=useState('');
  const [manualLabel,setManualLabel]=useState('');
  const [manualKind,setManualKind]=useState<ManualKind>('auto');
  const [sourceKind,setSourceKind]=useState<StreamingInputKind>('search');
  const [workspaceTracks,setWorkspaceTracks]=useState<StreamingTrack[]>([]);
  const [selectedTracks,setSelectedTracks]=useState<Set<string>>(new Set());
  const [editingAlbumId,setEditingAlbumId]=useState<string|null>(null);
  const [duplicateNotice,setDuplicateNotice]=useState<DuplicateNotice>(null);
  const [collections,setCollections]=useState<StreamingCollection[]>([]);
  const [selectedCollectionIds,setSelectedCollectionIds]=useState<Set<string>>(new Set());
  const [selectedRunTrackIds,setSelectedRunTrackIds]=useState<Set<string>>(new Set());
  const [groupPlans,setGroupPlans]=useState<StreamingQaGroupPlan[]>([{groupId:'Group 1',accountIds:[],trackMode:'all'}]);
  const [accounts,setAccounts]=useState<StreamingAccountPublic[]>([]);
  const [checks,setChecks]=useState<StreamingQaCheck[]>(DEFAULT_CHECKS);
  const [pauseResumeSeconds,setPauseResumeSeconds]=useState(3);
  const [volumeDirection,setVolumeDirection]=useState<'increase'|'decrease'>('decrease');
  const [contentIntelligence,setContentIntelligence]=useState({...DEFAULT_CONTENT_INTELLIGENCE});
  const [playback,setPlayback]=useState<StreamingPlaybackState>({minSeconds:60,maxSeconds:110,queueMode:'sequential',slots:1,playbackSpeed:1,restEnabled:false,restAfterTracks:5,restMinutes:5,restAndReplay:false,executionMode:'visible',muteAudio:false,captureScreenshots:false,browserRuntime:'chrome-installed',deviceMode:'desktop',deviceProfile:'Desktop 1280x720',mixedDeviceModes:['desktop','android','ios'],mixedDeviceProfiles:{desktop:'Desktop 1280x720',android:'Pixel 11',ios:'iPhone 18 Pro'}});
  const [catalogBusy,setCatalogBusy]=useState(false);
  const [starting,setStarting]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [verificationSessions,setVerificationSessions]=useState<Record<string,string>>({});
  const [accountVerificationSessions,setAccountVerificationSessions]=useState<Record<string,StreamingAccountVerificationSession>>({});
  const [verificationMixedFamily,setVerificationMixedFamily]=useState<StreamingDeviceFamily>('desktop');
  const [activityRunId,setActivityRunId]=useState<string|null>(null);
  const activityRunIdRef=useRef<string|null>(null);
  const [activityEvents,setActivityEvents]=useState<QaEvent[]>([]);
  const [activityFilter,setActivityFilter]=useState<ActivityFilter>('all');
  const [activityFollowLatest,setActivityFollowLatest]=useState(true);
  const activityViewportRef=useRef<HTMLDivElement|null>(null);

  const detectedInputPlatform=useMemo(()=>detectStreamingPlatformFromInput(sourceInput),[sourceInput]);
  const editingAlbum=useMemo(()=>collections.find(collection=>collection.id===editingAlbumId)||null,[collections,editingAlbumId]);
  const platformAccounts=useMemo(()=>accounts.filter(account=>account.platform===platform),[accounts,platform]);
  const eligibleAccountIds=useMemo(()=>[...new Set(groupPlans.flatMap(plan=>plan.accountIds||[]))].filter(id=>platformAccounts.some(account=>account.id===id)),[groupPlans,platformAccounts]);
  const selectedAlbums=useMemo(()=>collections.filter(album=>album.platform===platform&&selectedCollectionIds.has(album.id)),[collections,platform,selectedCollectionIds]);
  const runTracks=useMemo(()=>{
    const byKey=new Map<string,StreamingTrack>();
    for(const album of selectedAlbums)for(const track of album.tracks){const key=trackKey(track);if(key&&selectedRunTrackIds.has(key)&&!byKey.has(key))byKey.set(key,track);}
    return [...byKey.values()];
  },[selectedAlbums,selectedRunTrackIds]);
  const eligibleAccounts=useMemo(()=>platformAccounts.filter(account=>eligibleAccountIds.includes(account.id)),[platformAccounts,eligibleAccountIds]);
  const qaGroups=useMemo(()=>groupPlans.map((plan,index)=>({...plan,groupId:String(plan.groupId||`Group ${index+1}`).trim()||`Group ${index+1}`,accountIds:(plan.accountIds||[]).filter(id=>platformAccounts.some(account=>account.id===id))})).filter(plan=>plan.accountIds.length),[groupPlans,platformAccounts]);
  const runTrackCount=runTracks.length;
  const normalQaDefaults=useMemo<StreamingQaGroupNormalConfig>(()=>({
    observation:{minSeconds:Math.max(1,playback.minSeconds),maxSeconds:Math.max(Math.max(1,playback.minSeconds),playback.maxSeconds)},
    queueMode:playback.queueMode,playbackSpeed:playback.playbackSpeed,restAfterTracks:playback.restEnabled?Math.max(1,playback.restAfterTracks):0,restMinutes:playback.restEnabled?Math.max(1,playback.restMinutes):0,restAndReplay:Boolean(playback.restAndReplay),
    checks:checks.includes('playback')?[...checks]:['playback',...checks],pauseResumeSeconds:Math.max(.5,Math.min(3,pauseResumeSeconds||3)),volumeDirection,executionMode:playback.executionMode,muteAudio:playback.muteAudio,captureScreenshots:playback.captureScreenshots,
    browserRuntime:playback.browserRuntime,deviceMode:playback.deviceMode,deviceProfile:playback.deviceProfile,mixedDeviceModes:[...playback.mixedDeviceModes],mixedDeviceProfiles:{...playback.mixedDeviceProfiles},
  }),[playback,checks,pauseResumeSeconds,volumeDirection]);
  const verificationDeviceMode:StreamingDeviceFamily=playback.deviceMode==='mixed'
    ? (playback.mixedDeviceModes.includes(verificationMixedFamily)?verificationMixedFamily:(playback.mixedDeviceModes[0]||'desktop'))
    : playback.deviceMode;
  const verificationDeviceProfile=playback.deviceMode==='mixed'?playback.mixedDeviceProfiles[verificationDeviceMode]:playback.deviceProfile;
  const filteredActivityEvents=useMemo(()=>activityEvents.filter(event=>{
    const severity=activitySeverity(event);
    if(activityFilter==='errors')return severity==='error';
    if(activityFilter==='attention')return severity==='warning'||severity==='error';
    return true;
  }),[activityEvents,activityFilter]);
  const activityCounts=useMemo(()=>activityEvents.reduce((counts,event)=>{
    const severity=activitySeverity(event);
    if(severity==='error')counts.errors++;
    if(severity==='warning')counts.warnings++;
    if(event.activityType==='valid-playback'||/^COMPLETED PLAY\b/.test(event.message||'')||/^VALID QA PLAYBACK\b/.test(event.message||''))counts.validQaPlaybacks++;
    if(event.activityType==='invalid-playback'||/^QA playback NOT counted\b/.test(event.message||''))counts.invalidQaPlaybacks++;
    return counts;
  },{errors:0,warnings:0,validQaPlaybacks:0,invalidQaPlaybacks:0}),[activityEvents]);

  async function refreshAll(){
    const [nextCollections,nextAccounts]=await Promise.all([
      window.orbitqa?.listStreamingCollections?.()??Promise.resolve([]),
      window.orbitqa?.listStreamingAccounts?.()??Promise.resolve([]),
    ]);
    setCollections(nextCollections||[]);
    setAccounts(nextAccounts||[]);
  }

  async function loadActivityRun(runId:string){
    activityRunIdRef.current=runId;
    setActivityRunId(runId);
    try{
      const detail=await window.orbitqa?.getQaRun?.(runId);
      if(detail?.logs) setActivityEvents((detail.logs as QaEvent[]).slice(-MAX_LIVE_ACTIVITY));
    }catch{/* live events will still continue */}
  }
  async function copyActivityLog(){
    if(!filteredActivityEvents.length){setMessage('There are no visible log entries to copy yet.');return;}
    const text=filteredActivityEvents.map(activityCopyLine).join('\n');
    try{
      if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else{
        const field=document.createElement('textarea');field.value=text;field.style.position='fixed';field.style.opacity='0';document.body.appendChild(field);field.select();document.execCommand('copy');field.remove();
      }
      setMessage(`Copied ${filteredActivityEvents.length} live log entr${filteredActivityEvents.length===1?'y':'ies'}.`);
    }catch(reason){setError(`Could not copy the live log: ${reason instanceof Error?reason.message:String(reason)}`);}
  }

  useEffect(()=>{void refreshAll().catch(reason=>setError(reason instanceof Error?reason.message:String(reason)));},[]);
  useEffect(()=>{
    activityRunIdRef.current=activityRunId;
  },[activityRunId]);
  useEffect(()=>{
    if(view!=='qa')return;
    let cancelled=false;
    void window.orbitqa?.listQaRuns?.().then(runs=>{
      if(cancelled||activityRunIdRef.current)return;
      const active=(runs||[]).filter(run=>run.runKind==='streaming'&&ACTIVE_STREAM_STATUSES.has(run.status)).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
      if(active)void loadActivityRun(active.runId);
    }).catch(()=>undefined);
    const detachQaEvents=window.orbitqa?.onQaEvent?.((event:QaEvent)=>{
      if(!activityRunIdRef.current||event.runId!==activityRunIdRef.current)return;
      if(event.type==='run-metrics')return;
      setActivityEvents(current=>[...current,event].slice(-MAX_LIVE_ACTIVITY));
    });
    return()=>{cancelled=true;detachQaEvents?.();};
  },[view]);
  useEffect(()=>{
    if(!activityFollowLatest)return;
    const viewport=activityViewportRef.current;
    if(viewport)viewport.scrollTop=viewport.scrollHeight;
  },[activityEvents.length,activityFilter,activityFollowLatest]);
  useEffect(()=>{
    setGroupPlans(current=>{
      const allowed=new Set(accounts.filter(account=>account.platform===platform).map(account=>account.id));
      let changed=false;
      const seen=new Set<string>();
      const next=current.map((plan,index)=>{
        const accountIds=(plan.accountIds||[]).filter(id=>allowed.has(id)&&!seen.has(id));
        accountIds.forEach(id=>seen.add(id));
        const trackMode=plan.trackMode==='count'?'count' as const:'all' as const;
        const trackCount=trackMode==='count'?Math.max(1,Math.min(Number(plan.trackCount)||1,Math.max(1,runTrackCount||1))):undefined;
        if(accountIds.length!==(plan.accountIds||[]).length||trackMode!==plan.trackMode||trackCount!==plan.trackCount)changed=true;
        const repeatCount=Math.max(1,Math.min(100,Math.floor(Number(plan.repeatCount)||1)));if(repeatCount!==plan.repeatCount)changed=true;return {...plan,groupId:String(plan.groupId||`Group ${index+1}`),accountIds,trackMode,repeatCount,...(trackMode==='count'?{trackCount}:{trackCount:undefined})};
      });
      return changed?next:current;
    });
  },[accounts,platform,runTrackCount]);
  useEffect(()=>{
    const input=sourceInput.trim();
    if(!input||editingAlbumId){setDuplicateNotice(null);return;}
    let cancelled=false;
    const timer=window.setTimeout(()=>{
      void window.orbitqa?.checkStreamingDuplicate?.({input}).then(result=>{if(!cancelled)setDuplicateNotice(result?{kind:result.kind,collectionName:result.collectionName,message:result.message}:null);}).catch(()=>{if(!cancelled)setDuplicateNotice(null);});
    },220);
    return()=>{cancelled=true;window.clearTimeout(timer);};
  },[sourceInput,editingAlbumId,collections]);

  function resetWorkspace(){
    setSourceInput('');
    setCanonicalSourceInput('');
    setAlbumName('');
    setManualLabel('');
    setManualKind('auto');
    setSourceKind('search');
    setWorkspaceTracks([]);
    setSelectedTracks(new Set());
    setEditingAlbumId(null);
    setDuplicateNotice(null);
  }
  function clearWorkspace(preserveMessage=false){resetWorkspace();setError('');if(!preserveMessage)setMessage('');}
  function updateSourceInput(value:string){
    setSourceInput(value);
    setCanonicalSourceInput('');
    setDuplicateNotice(null);
    const detected=detectStreamingPlatformFromInput(value);
    if(!detected||detected===platform||editingAlbumId)return;
    setPlatform(detected);
    setWorkspaceTracks([]);
    setSelectedTracks(new Set());
    setSourceKind('search');
    setError('');
    setMessage(`Detected ${platformLabel(detected)} from the pasted link.`);
  }

  async function checkDuplicate(input:string,ignoreCollectionId?:string){
    if(!input.trim())return null;
    return await (window.orbitqa?.checkStreamingDuplicate?.({input:input.trim(),...(ignoreCollectionId?{ignoreCollectionId}:{})})??Promise.resolve(null));
  }

  async function fetchSongs(){
    if(!sourceInput.trim())return;
    setCatalogBusy(true);setError('');setMessage('');
    try{
      const preDuplicate=await checkDuplicate(sourceInput,editingAlbumId||undefined);
      if(preDuplicate){setDuplicateNotice({kind:preDuplicate.kind,collectionName:preDuplicate.collectionName,message:preDuplicate.message});return;}
      const result=await window.orbitqa?.resolveStreamingCatalog?.({platform,input:sourceInput.trim()});
      if(!result)throw new Error('OrbitQA did not receive a catalog result');
      const resolvedPlatform=result.platform as StreamingPlatform;
      if(editingAlbum&&resolvedPlatform!==editingAlbum.platform)throw new Error(`This saved album is for ${platformLabel(editingAlbum.platform)}. Paste a link from that same service to add songs.`);
      if(resolvedPlatform!==platform)setPlatform(resolvedPlatform);
      const resolvedInput=String(result.input||sourceInput.trim());
      setCanonicalSourceInput(resolvedInput);
      const postDuplicate=await checkDuplicate(resolvedInput,editingAlbumId||undefined);
      if(postDuplicate){setDuplicateNotice({kind:postDuplicate.kind,collectionName:postDuplicate.collectionName,message:postDuplicate.message});return;}
      setDuplicateNotice(null);
      const fetched=Array.isArray(result.tracks)?result.tracks:[];
      const existing=editingAlbumId?workspaceTracks:[];
      const byKey=new Map<string,StreamingTrack>();
      for(const track of [...existing,...fetched]){const key=trackKey(track);if(key&&!byKey.has(key))byKey.set(key,track);}
      setWorkspaceTracks([...byKey.values()]);
      if(!editingAlbumId)setSelectedTracks(new Set());
      const allowedKinds:StreamingInputKind[]=['artist','album','playlist','track','search'];
      const nextKind=allowedKinds.includes(result.kind as StreamingInputKind)?result.kind as StreamingInputKind:'search';
      setSourceKind(nextKind);
      if(!fetched.length)setError(`No songs were found on that ${platformLabel(resolvedPlatform)} link. Try a direct album, playlist, artist, or track page.`);
      else setMessage(`Fetched ${fetched.length} song${fetched.length===1?'':'s'} from this ${nextKind}. Select what you want to keep.`);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setCatalogBusy(false);}
  }

  async function saveAlbum(){
    if(!albumName.trim()||!selectedTracks.size||duplicateNotice)return;
    const chosen=workspaceTracks.filter(track=>selectedTracks.has(trackKey(track)));
    if(!chosen.length)return;
    setCatalogBusy(true);setError('');
    try{
      const existing=editingAlbumId?collections.find(collection=>collection.id===editingAlbumId):null;
      const inputForDuplicate=canonicalSourceInput||sourceInput||existing?.canonicalSourceInput||existing?.sourceInput||'';
      const duplicate=await checkDuplicate(inputForDuplicate,existing?.id);
      if(duplicate){setDuplicateNotice({kind:duplicate.kind,collectionName:duplicate.collectionName,message:duplicate.message});return;}
      const saved=await window.orbitqa?.saveStreamingCollection?.({
        ...(existing?{id:existing.id,createdAt:existing.createdAt}:{}),
        name:albumName.trim(),
        platform,
        sourceInput:sourceInput.trim()||existing?.sourceInput||inputForDuplicate,
        canonicalSourceInput:canonicalSourceInput||existing?.canonicalSourceInput||inputForDuplicate,
        sourceKind,
        tracks:chosen,
      });
      if(!saved)throw new Error('Album could not be saved');
      const nextCollections=await (window.orbitqa?.listStreamingCollections?.()??Promise.resolve([]));
      setCollections(nextCollections||[]);
      setSelectedCollectionIds(current=>new Set([...current,saved.id]));
      setSelectedRunTrackIds(current=>new Set([...current,...chosen.map(trackKey)]));
      setMessage(`Saved ${chosen.length} song${chosen.length===1?'':'s'} as ${saved.name}.`);
      clearWorkspace(true);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setCatalogBusy(false);}
  }


  async function saveManualLink(){
    const input=sourceInput.trim();
    const label=manualLabel.trim();
    if(!input||!label||duplicateNotice)return;
    const detected=detectStreamingPlatformFromInput(input);
    if(!detected){setError('OrbitQA could not identify a supported streaming platform from this link.');return;}
    const inferred=manualKind==='auto'?inferManualStreamingKind(input):manualKind;
    if(inferred==='search'){setError('Choose whether this manual link is a Song, Album, Artist, or Playlist.');return;}
    setCatalogBusy(true);setError('');setMessage('');
    try{
      const existing=editingAlbumId?collections.find(collection=>collection.id===editingAlbumId):null;
      if(existing){
        if(inferred!=='track')throw new Error('When editing saved music, manual save can add a direct Song link only.');
        if(detected!==existing.platform)throw new Error(`This saved item is for ${platformLabel(existing.platform)}. Add a song link from the same service.`);
        const duplicate=await checkDuplicate(input);
        if(duplicate){setDuplicateNotice({kind:duplicate.kind,collectionName:duplicate.collectionName,message:duplicate.message});return;}
        const newTrack:StreamingTrack={id:input,platform:existing.platform,title:label,url:input};
        const saved=await window.orbitqa?.saveStreamingCollection?.({...existing,tracks:[...(existing.tracks||[]),newTrack]});
        if(!saved)throw new Error('The song link could not be saved');
        setCollections(current=>current.map(item=>item.id===saved.id?saved:item));
        setWorkspaceTracks(saved.tracks||[]);
        setSelectedTracks(new Set((saved.tracks||[]).map(trackKey)));
        setSourceInput('');setCanonicalSourceInput('');setManualLabel('');setManualKind('auto');setDuplicateNotice(null);
        setMessage(`Saved ${label} directly in ${saved.name}. Use VERIFY to open the exact link.`);
        return;
      }
      const duplicate=await checkDuplicate(input);
      if(duplicate){setDuplicateNotice({kind:duplicate.kind,collectionName:duplicate.collectionName,message:duplicate.message});return;}
      const tracks:StreamingTrack[]=inferred==='track'?[{id:input,platform:detected,title:label,url:input}]:[];
      const saved=await window.orbitqa?.saveStreamingCollection?.({name:label,platform:detected,sourceInput:input,canonicalSourceInput:input,sourceKind:inferred,tracks});
      if(!saved)throw new Error('The music link could not be saved');
      const nextCollections=await (window.orbitqa?.listStreamingCollections?.()??Promise.resolve([]));
      setCollections(nextCollections||[]);
      if(saved.tracks.length){setSelectedCollectionIds(current=>new Set([...current,saved.id]));setSelectedRunTrackIds(current=>new Set([...current,...saved.tracks.map(trackKey)]));}
      setPlatform(detected);
      clearWorkspace(true);
      setMessage(`Saved ${label} manually as ${inferred}. Use VERIFY to check the exact link before relying on it.`);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setCatalogBusy(false);}
  }

  function verificationKey(album:StreamingCollection,track?:StreamingTrack){return track?`track:${album.id}:${trackKey(track)}`:`collection:${album.id}`;}
  async function startLinkVerification(album:StreamingCollection,track?:StreamingTrack){
    setError('');setMessage('');
    try{
      const session=await window.orbitqa?.startStreamingLinkVerification?.({collectionId:album.id,...(track?{trackId:trackKey(track)}:{}),deviceMode:verificationDeviceMode,deviceProfile:verificationDeviceProfile});
      if(!session?.sessionId)throw new Error('Verification window could not be opened');
      const key=verificationKey(album,track);
      setVerificationSessions(current=>({...current,[key]:session.sessionId}));
      setMessage(`Verification is open on ${verificationDeviceProfile}. Check the exact page, then click MARK VERIFIED. The verification window stays open until you confirm.`);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  }
  async function completeLinkVerification(album:StreamingCollection,track?:StreamingTrack){
    const key=verificationKey(album,track);
    const sessionId=verificationSessions[key];
    if(!sessionId)return;
    setError('');
    try{
      const saved=await window.orbitqa?.completeStreamingLinkVerification?.({sessionId,collectionId:album.id,...(track?{trackId:trackKey(track)}:{})});
      if(!saved)throw new Error('Verification could not be saved');
      setCollections(current=>current.map(item=>item.id===saved.id?saved:item));
      if(editingAlbumId===saved.id){setWorkspaceTracks(saved.tracks||[]);setSelectedTracks(new Set((saved.tracks||[]).map(trackKey)));}
      setVerificationSessions(current=>{const next={...current};delete next[key];return next;});
      setMessage(`${track?track.title:saved.name} is VERIFIED. The verification window is now closed.`);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  }

  function loadAlbum(album:StreamingCollection,addSongs=false){
    setPlatform(album.platform);
    setEditingAlbumId(album.id);
    setAlbumName(album.name);
    setSourceInput(addSongs?'':album.sourceInput||'');
    setCanonicalSourceInput(addSongs?'':album.canonicalSourceInput||album.sourceInput||'');
    setSourceKind(album.sourceKind||'search');
    setManualLabel('');setManualKind('auto');
    setWorkspaceTracks(album.tracks||[]);
    setSelectedTracks(new Set((album.tracks||[]).map(trackKey)));
    setDuplicateNotice(null);
    setError('');
    setMessage(addSongs?`Add another ${platformLabel(album.platform)} link to ${album.name}. Existing songs stay selected.`:`Opened ${album.name}. You can rename it, change the selection, or fetch another link to add songs.`);
  }

  function useAlbumForQa(album:StreamingCollection,selected:boolean){
    if(selected&&!album.tracks.length){setError('This saved link has no songs yet. Add or fetch songs before using it for QA.');return;}
    if(selected){
      if(album.platform!==platform){
        setPlatform(album.platform);
        setSelectedCollectionIds(new Set([album.id]));
        setSelectedRunTrackIds(new Set((album.tracks||[]).map(trackKey)));
        setMessage(`QA platform switched to ${platformLabel(album.platform)} for ${album.name}.`);
      }else{
        setSelectedCollectionIds(current=>new Set([...current,album.id]));
        setSelectedRunTrackIds(current=>new Set([...current,...(album.tracks||[]).map(trackKey)]));
      }
    }else{
      setSelectedCollectionIds(current=>{const next=new Set(current);next.delete(album.id);return next;});
      setSelectedRunTrackIds(current=>{const next=new Set(current);for(const track of album.tracks||[])next.delete(trackKey(track));return next;});
    }
  }

  async function renameAlbum(album:StreamingCollection,name:string){
    try{
      await window.orbitqa?.saveStreamingCollection?.({...album,name});
      const next=await (window.orbitqa?.listStreamingCollections?.()??Promise.resolve([]));
      setCollections(next||[]);
      if(editingAlbumId===album.id)setAlbumName(name);
      setMessage(`Renamed album to ${name}.`);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  }

  async function deleteAlbum(id:string){
    try{
      await window.orbitqa?.deleteStreamingCollection?.(id);
      setCollections(current=>current.filter(collection=>collection.id!==id));
      const removed=collections.find(collection=>collection.id===id);
      setSelectedCollectionIds(current=>{const next=new Set(current);next.delete(id);return next;});
      if(removed)setSelectedRunTrackIds(current=>{const next=new Set(current);for(const track of removed.tracks||[])next.delete(trackKey(track));return next;});
      if(editingAlbumId===id)clearWorkspace();
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  }

  async function saveAccount(value:Parameters<NonNullable<typeof window.orbitqa>['saveStreamingAccount']>[0]){
    const saved=await window.orbitqa?.saveStreamingAccount?.(value);
    if(!saved)throw new Error('Streaming account could not be saved');
    if(value.authMode==='session'&&value.sessionSecret){
      const verified=await window.orbitqa?.verifyStreamingAccount?.(saved.id);
      await refreshAll();
      if(verified?.ok){setMessage('Imported cookie/session was stored securely and verified without leaving OrbitQA.');return verified.account||saved;}
      setMessage(`Imported cookie/session was stored securely. Verification needs attention: ${verified?.reason||'session could not be confirmed yet'}`);
      return verified?.account||saved;
    }
    await refreshAll();
    return saved;
  }
  async function deleteAccount(id:string){
    const pending=accountVerificationSessions[id];
    if(pending)await window.orbitqa?.cancelStreamingAccountVerification?.({sessionId:pending.sessionId}).catch(()=>undefined);
    setAccountVerificationSessions(current=>{const next={...current};delete next[id];return next;});
    await window.orbitqa?.deleteStreamingAccount?.(id);
    setGroupPlans(current=>current.map(plan=>({...plan,accountIds:(plan.accountIds||[]).filter(item=>item!==id)})));
    await refreshAll();
  }
  async function startAccountVerification(id:string,request:StreamingAccountVerificationRequest){
    setError('');setMessage('');
    try{
      const session=await window.orbitqa?.startStreamingAccountVerification?.({accountId:id,...request});
      if(!session)throw new Error('OrbitQA could not open the manual login browser');
      setAccountVerificationSessions(current=>({...current,[id]:session}));
      setMessage('A fresh account-specific normal Chrome/Edge window is open. Sign in yourself, complete any CAPTCHA/MFA, confirm the correct account is open, then click MARK VERIFIED.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  }
  async function repairAccountProfile(id:string){
    setError('');setMessage('');
    try{
      const result=await window.orbitqa?.repairStreamingAccountProfile?.(id);
      if(!result?.repaired)throw new Error('OrbitQA could not repair this account profile');
      setMessage(result.backupDir?'Profile repaired. The previous profile was backed up. Use LOGIN MANUALLY to sign in again.':'Fresh profile created. Use LOGIN MANUALLY to sign in again.');
      await refreshAll();
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  }

  async function assignStickyProxy(id:string,request:{mode:'auto'|'manual';proxyId?:string}){setError('');try{const account=await window.orbitqa?.assignStreamingStickyProxy?.(id,request);await refreshAll();setMessage(account?.staticProxyMode==='manual'?'Manual sticky proxy assigned to this account. The same proxy may also be used by other accounts.':'Sticky proxy set to Default / Auto allocation.');}catch(reason){setError(reason instanceof Error?reason.message:String(reason));}}

  async function testSavedAccountSession(id:string){
    setError('');setMessage('');
    try{
      const result=await window.orbitqa?.verifyStreamingAccount?.(id);
      await refreshAll();
      if(result?.ok){setMessage('Saved authorized session is active and was refreshed.');return;}
      setError(result?.reason||'The saved session is not active. Use LOGIN MANUALLY to create a fresh authorized session.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  }
  async function completeAccountVerification(id:string){
    const session=accountVerificationSessions[id];
    if(!session)return;
    setError('');setMessage('');
    try{
      const result=await window.orbitqa?.completeStreamingAccountVerification?.({sessionId:session.sessionId});
      if(!result?.ok){
        setAccountVerificationSessions(current=>({...current,[id]:{...session,reason:result?.reason||session.reason}}));
        setError(result?.reason||'OrbitQA could not confirm that this account is signed in yet. The login browser remains open.');
        return;
      }
      setAccountVerificationSessions(current=>{const next={...current};delete next[id];return next;});
      await refreshAll();
      setMessage('Account is VERIFIED. The login browser is now closed and the refreshed session was saved.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  }
  async function cancelAccountVerification(id:string){
    const session=accountVerificationSessions[id];
    if(!session)return;
    setError('');
    try{
      await window.orbitqa?.cancelStreamingAccountVerification?.({sessionId:session.sessionId});
      setAccountVerificationSessions(current=>{const next={...current};delete next[id];return next;});
      setMessage('Login verification cancelled. The account was not marked verified.');
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
  }

  async function startRun(){
    setError('');setMessage('');
    if(!selectedAlbums.length)return setError('Select at least one saved album using “Use for QA” in Music Library.');
    if(!runTrackCount)return setError('The selected album has no saved songs.');
    if(!eligibleAccountIds.length)return setError(`Assign at least one ${platformLabel(platform)} account to an Account Group in Streaming Hub.`);
    const min=Math.max(1,Math.min(playback.minSeconds,playback.maxSeconds));
    const max=Math.max(min,Math.max(playback.minSeconds,playback.maxSeconds));
    setStarting(true);
    try{
      const runChecks:StreamingQaCheck[]=checks.includes('playback')?checks:['playback',...checks];
      const groupPlansForRun:StreamingQaGroupPlan[]=qaGroups.map((group,index)=>({groupId:String(group.groupId||`Group ${index+1}`),accountIds:[...group.accountIds],trackMode:group.trackMode==='count'?'count':'all',repeatCount:Math.max(1,Math.min(100,Math.floor(Number(group.repeatCount)||1))),contentIntelligence:{...DEFAULT_CONTENT_INTELLIGENCE,...contentIntelligence,...(group.contentIntelligence||{}),enabled:Boolean(group.contentIntelligence?.enabled)},normalQa:{...normalQaDefaults,...(group.normalQa||{}),observation:{...normalQaDefaults.observation,...(group.normalQa?.observation||{})},checks:[...(group.normalQa?.checks||normalQaDefaults.checks)],mixedDeviceModes:[...(group.normalQa?.mixedDeviceModes||normalQaDefaults.mixedDeviceModes||[])],mixedDeviceProfiles:{...(normalQaDefaults.mixedDeviceProfiles||{}),...(group.normalQa?.mixedDeviceProfiles||{})}},...(group.trackMode==='count'?{trackCount:Math.max(1,Math.min(group.trackCount||1,runTrackCount))}:{})}));
      const request:StreamingRunConfig={
        runKind:'streaming' as const,
        platform,
        deviceMode:playback.deviceMode,
        deviceProfile:playback.deviceProfile,
        mixedDeviceModes:playback.mixedDeviceModes,
        mixedDeviceProfiles:playback.mixedDeviceProfiles,
        collectionIds:selectedAlbums.map(album=>album.id),
        trackIds:runTracks.map(track=>trackKey(track)),
        inlineTracks:runTracks,
        accountIds:eligibleAccountIds,
        groupPlans:groupPlansForRun,
        slots:eligibleAccountIds.length,
        observation:{minSeconds:min,maxSeconds:max},
        queueMode:playback.queueMode,
        playbackSpeed:playback.playbackSpeed,
        restAfterTracks:playback.restEnabled?Math.max(1,playback.restAfterTracks):0,
        restMinutes:playback.restEnabled?Math.max(1,playback.restMinutes):0,restAndReplay:Boolean(playback.restAndReplay),
        checks:runChecks,
        pauseResumeSeconds:Math.max(0.5,Math.min(3,pauseResumeSeconds||3)),
        volumeDirection,
        executionMode:playback.executionMode,
        muteAudio:playback.muteAudio,
        contentIntelligence,
        captureScreenshots:playback.captureScreenshots,
        requestedWorkUnits: (()=>{
          try {
            let total = 0;
            for (const g of groupPlansForRun as any[]) {
              const acc = Array.isArray(g?.accountIds) ? g.accountIds.length : 0;
              if (!acc) continue;
              const rep = Math.max(1, Number(g?.repeatCount)||1);
              const t = g?.trackMode === 'count' ? Math.max(1, Number(g?.trackCount)||Math.max(1, runTracks.length)) : Math.max(1, runTracks.length);
              total += acc * rep * t;
            }
            return total > 0 ? total : eligibleAccountIds.length * Math.max(1, runTracks.length);
          } catch { return eligibleAccountIds.length * Math.max(1, runTracks.length); }
        })(),
        concurrency:{mode:'manual' as const,value:eligibleAccountIds.length},
      };
      const created=await window.orbitqa?.startStreamingRun?.(request);
      if(!created?.runId)throw new Error('Streaming QA could not be started');
      setActivityEvents([]);
      setActivityFilter('all');
      await loadActivityRun(created.runId);
      setMessage(`Streaming QA started as ${created.runId}. Live activity is shown below and retained in Run Center.`);
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setStarting(false);}
  }

  if(view==='library')return <div className="streaming-hub-page streaming-library-page">
    <section className="hero streaming-library-hero"><div><span className="section-kicker">STREAMING MUSIC LIBRARY</span><h2>Link Importer, Manual Save &amp; Verification</h2><p>Fetch when OrbitQA can read the service, or save the exact link manually. Every saved song, album, artist, or playlist can be opened in a locked verification window and marked verified only after you visually confirm it.</p></div><div className="stream-engine-badge"><span/> VISUAL VERIFY</div></section>
    {error?<div role="alert" className="form-error">{error}</div>:null}
    {message?<div className="stream-message">{message}</div>:null}
    <section className="stream-verification-device-bar"><div><span className="section-kicker">VERIFICATION VIEW</span><strong>{verificationDeviceProfile}</strong><small>VERIFY opens the exact saved link here and locks that window open until you click MARK VERIFIED.</small></div>{playback.deviceMode==='mixed'?<label className="field"><span>Verify on</span><select value={verificationDeviceMode} onChange={event=>setVerificationMixedFamily(event.target.value as StreamingDeviceFamily)}>{playback.mixedDeviceModes.map(mode=><option key={mode} value={mode}>{mode==='desktop'?'Desktop Web':mode==='android'?'Android Mobile':'iOS Mobile'} · {playback.mixedDeviceProfiles[mode]}</option>)}</select></label>:<span className="stream-stat-pill">{verificationDeviceMode==='desktop'?'Desktop Web':verificationDeviceMode==='android'?'Android Mobile':'iOS Mobile'}</span>}</section>
    <div className="stream-library-layout">
      <SimpleStreamingImporter platform={platform} detectedPlatform={detectedInputPlatform} input={sourceInput} setInput={updateSourceInput} albumName={albumName} setAlbumName={setAlbumName} manualLabel={manualLabel} setManualLabel={setManualLabel} manualKind={manualKind} setManualKind={setManualKind} tracks={workspaceTracks} selected={selectedTracks} setSelected={setSelectedTracks} busy={catalogBusy} editingAlbum={editingAlbum} verificationSessions={verificationSessions} duplicateNotice={duplicateNotice} onFetch={()=>void fetchSongs()} onSave={()=>void saveAlbum()} onManualSave={()=>void saveManualLink()} onClearWorkspace={()=>clearWorkspace()} onVerifyTrack={track=>{if(editingAlbum)void startLinkVerification(editingAlbum,track);}} onCompleteTrackVerification={track=>{if(editingAlbum)void completeLinkVerification(editingAlbum,track);}}/>
      <SavedStreamingAlbumsPanel albums={collections} selectedIds={selectedCollectionIds} activePlatform={platform} verificationSessions={verificationSessions} onUseForQa={useAlbumForQa} onOpen={album=>loadAlbum(album,false)} onAddSongs={album=>loadAlbum(album,true)} onRename={(album,name)=>void renameAlbum(album,name)} onDelete={id=>void deleteAlbum(id)} onVerify={album=>void startLinkVerification(album)} onCompleteVerification={album=>void completeLinkVerification(album)}/>
    </div>
  </div>;

  if(view==='accounts')return <div className="streaming-hub-page streaming-accounts-page">
    <section className="hero streaming-accounts-hero"><div><span className="section-kicker">STREAMING ACCOUNTS</span><h2>Accounts, Login Health &amp; Proxy</h2><p>Add authorized accounts once, choose one or more platforms, keep cookies/credentials encrypted locally, open a real login browser with the proxy and device you choose, and mark the account verified only after you visually confirm the signed-in session.</p></div><div className="stream-engine-badge"><span/> AUTH QA</div></section>
    {error?<div role="alert" className="form-error">{error}</div>:null}
    {message?<div className="stream-message">{message}</div>:null}
    <StreamingAccountsPanel accounts={accounts} verificationSessions={accountVerificationSessions} onSave={saveAccount} onDelete={deleteAccount} onStartVerification={startAccountVerification} onCheckSavedSession={testSavedAccountSession} onRepairProfile={repairAccountProfile} onCompleteVerification={completeAccountVerification} onCancelVerification={cancelAccountVerification} onAssignStickyProxy={assignStickyProxy}/>
  </div>;

  return <div className="streaming-hub-page">
    <section className="hero streaming-hero"><div><span className="section-kicker">STREAMING QA STUDIO</span><h2>Streaming Hub</h2><p>Run authorized playback/navigation QA across {PLATFORM_NAMES}. Import and organize music from the separate Music Library page.</p></div><div className="stream-engine-badge"><span/> STREAM QA READY</div></section>
    {error?<div role="alert" className="form-error">{error}</div>:null}
    {message?<div className="stream-message">{message}</div>:null}
    <details className="stream-section-collapse"><summary>QA MUSIC SELECTION</summary><div className="stream-section-collapse__body"><StreamingRunLibraryPanel collections={collections} platform={platform} selectedCollectionIds={selectedCollectionIds} selectedTrackIds={selectedRunTrackIds} onPlatformChange={setPlatform} onCollectionsChange={setSelectedCollectionIds} onTracksChange={setSelectedRunTrackIds}/></div></details>
    <details className="stream-section-collapse"><summary>QA ACCOUNTS</summary><div className="stream-section-collapse__body"><section className="panel stream-card stream-account-summary"><div className="panel__header"><div><span className="section-kicker">QA ACCOUNTS</span><h3>{eligibleAccountIds.length?`${eligibleAccountIds.length} ${platformLabel(platform)} account${eligibleAccountIds.length===1?'':'s'} assigned to groups`:'Assign accounts to groups below'}</h3><p className="stream-muted">Accounts only stores and verifies accounts. Which accounts run, and in which order, is controlled by the Account Groups section in Streaming Hub.</p></div><span className="stream-stat-pill">{platformLabel(platform)}</span></div>{eligibleAccountIds.length?<div className="stream-selected-album-chips">{eligibleAccounts.map(account=><span key={account.id} className={`stream-platform-tag stream-platform-tag--${account.platform}`}>{account.label} · {account.status||'unverified'}</span>)}</div>:<div className="empty-state">Add and verify authorized {platformLabel(platform)} accounts in <strong>Accounts</strong>, then assign them to Group 1, Group 2, and so on below.</div>}</section></div></details>
    <details className="stream-section-collapse"><summary>ACCOUNT GROUPS</summary><div className="stream-section-collapse__body"><StreamingGroupPlanPanel accounts={platformAccounts} plans={groupPlans} onPlansChange={setGroupPlans} selectedTrackCount={runTrackCount} intelligenceDefaults={contentIntelligence} normalQaDefaults={normalQaDefaults}/></div></details>
    <div className="stream-start-bar"><div><strong>{runTrackCount}</strong><span>saved songs</span><strong>{selectedAlbums.length}</strong><span>albums</span><strong>{eligibleAccountIds.length}</strong><span>accounts</span><strong>{qaGroups.length}</strong><span>sequential groups</span></div><button type="button" className="primary-button stream-start-button" onClick={()=>void startRun()} disabled={starting||!runTrackCount||!eligibleAccountIds.length}>{starting?'STARTING STREAMING QA…':'▶ START STREAMING QA'}</button></div>
    <details className="stream-section-collapse" open><summary>LIVE STREAM QA LOG</summary><div className="stream-section-collapse__body"><section className="panel stream-card stream-live-log">
      <div className="stream-live-log__header">
        <div><span className="section-kicker">LIVE STREAM QA LOG</span><h3>Recent activity</h3><p className="stream-muted">{activityRunId?`Active diagnostics · ${activityRunId} · each playing song shows its allocated QA timer below`:'Start Streaming QA to see account activity and each selected song timer in real time.'}</p></div>
        <div className="stream-live-log__counts"><span>{activityCounts.validQaPlaybacks} completed plays (QA)</span><span>{activityCounts.invalidQaPlaybacks} not counted</span><span>{activityEvents.length} events</span><span className="stream-live-log__warning-count">{activityCounts.warnings} warnings</span><span className="stream-live-log__error-count">{activityCounts.errors} errors</span></div>
      </div>
      <div className="stream-live-log__toolbar" aria-label="Live log controls">
        <button type="button" className={activityFilter==='all'?'text-button is-active':'text-button'} onClick={()=>setActivityFilter('all')}>All activity</button>
        <button type="button" className={activityFilter==='attention'?'text-button is-active':'text-button'} onClick={()=>setActivityFilter('attention')}>Warnings + Errors</button>
        <button type="button" className={activityFilter==='errors'?'text-button is-active':'text-button'} onClick={()=>setActivityFilter('errors')}>Errors only</button>
        <label className="stream-live-log__follow"><input type="checkbox" checked={activityFollowLatest} onChange={event=>setActivityFollowLatest(event.target.checked)}/> Follow latest</label>
        <button type="button" className="text-button" onClick={()=>void copyActivityLog()}>Copy Log</button>
        <button type="button" className="text-button" onClick={()=>setActivityEvents([])}>Clear View</button>
      </div>
      <div className="stream-live-log__viewport" role="log" aria-live="polite" ref={activityViewportRef}>
        {!filteredActivityEvents.length?<div className="empty-state">{activityRunId?'No entries match this filter yet.':'Start Streaming QA to see every account/browser/playback step here.'}</div>:filteredActivityEvents.map((event,index)=>{
          const severity=activitySeverity(event);
          const context=[event.platform,event.groupId,event.accountLabel||event.accountId||event.workId,event.workerLabel,event.stage].filter(Boolean).join(' · ');
          const allocatedTimer=Number(event.observationSeconds)>0?`Allocated timer ${Math.round(Number(event.observationSeconds))}s`:'';
          const assignedProxy=event.assignedProxy?`Assigned proxy ${event.assignedProxy}`:'';
          const currentExitIp=event.currentExitIp?`Current exit IP ${event.currentExitIp}`:'';
          const detail=[event.trackTitle,allocatedTimer,assignedProxy,currentExitIp,event.action,event.currentUrl].filter(Boolean).join(' · ');
          return <div className={`stream-live-log__row stream-live-log__row--${severity}`} key={`${event.timestamp||'event'}-${index}`}>
            <time>{activityTime(event.timestamp)}</time><span className={`stream-live-log__severity stream-live-log__severity--${severity}`}>{severity.toUpperCase()}</span><strong>{context||'RUN'}</strong><p>{event.message||event.type}</p>{detail?<small title={event.currentUrl||undefined}>{detail}</small>:null}
          </div>;
        })}
      </div>
      <small className="stream-live-log__retention">Clear View only clears this panel. Run Center keeps a compact persisted run history (up to 600 recent events per run). Sensitive session/password/token fields are not written to this log.</small>
    </section></div></details>
    <small className="stream-safety-note">Streaming Hub is for authorized playback/navigation QA. Social-engagement, ad-click, and artificial-engagement actions are intentionally unavailable.</small>
  </div>;
}

export { STREAMING_PLATFORMS };
