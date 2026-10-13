import { useMemo, useState } from 'react';
import type { StreamingCollection, StreamingPlatform, StreamingTrack } from '../shared/streaming';
import { STREAMING_PLATFORMS } from './StreamingPlatformTabs';

const trackKey=(track:StreamingTrack)=>String(track.id||track.url);
const platformLabel=(platform:StreamingPlatform)=>STREAMING_PLATFORMS.find(item=>item.id===platform)?.label||platform;
const formatDuration=(seconds?:number)=>Number.isFinite(seconds)?`${Math.floor(Number(seconds)/60)}:${String(Math.round(Number(seconds)%60)).padStart(2,'0')}`:'—';

export function StreamingRunLibraryPanel({
  collections,platform,selectedCollectionIds,selectedTrackIds,onPlatformChange,onCollectionsChange,onTracksChange,
}:{
  collections:StreamingCollection[];
  platform:StreamingPlatform;
  selectedCollectionIds:Set<string>;
  selectedTrackIds:Set<string>;
  onPlatformChange:(platform:StreamingPlatform)=>void;
  onCollectionsChange:(next:Set<string>)=>void;
  onTracksChange:(next:Set<string>)=>void;
}){
  const [query,setQuery]=useState('');
  const [listOpen,setListOpen]=useState(false);
  const [expandedCollections,setExpandedCollections]=useState<Set<string>>(new Set());
  const platformCollections=collections.filter(collection=>collection.platform===platform);
  const filteredCollections=useMemo(()=>{
    const q=query.trim().toLowerCase();
    if(!q)return platformCollections;
    return platformCollections.map(collection=>{
      const collectionMatch=`${collection.name} ${collection.sourceKind}`.toLowerCase().includes(q);
      const tracks=collectionMatch?(collection.tracks||[]):(collection.tracks||[]).filter(track=>`${track.title} ${track.artist||''} ${track.album||''}`.toLowerCase().includes(q));
      return {...collection,tracks};
    }).filter(collection=>(collection.tracks||[]).length||`${collection.name} ${collection.sourceKind}`.toLowerCase().includes(q));
  },[platformCollections,query]);
  function setAlbum(collection:StreamingCollection,enabled:boolean){
    const collectionsNext=new Set(selectedCollectionIds);
    const tracksNext=new Set(selectedTrackIds);
    if(enabled){collectionsNext.add(collection.id);for(const track of collection.tracks||[])tracksNext.add(trackKey(track));}
    else{collectionsNext.delete(collection.id);for(const track of collection.tracks||[])tracksNext.delete(trackKey(track));}
    onCollectionsChange(collectionsNext);onTracksChange(tracksNext);
  }
  function setTrack(collection:StreamingCollection,track:StreamingTrack,enabled:boolean){
    const tracksNext=new Set(selectedTrackIds),collectionsNext=new Set(selectedCollectionIds),key=trackKey(track);
    if(enabled){tracksNext.add(key);collectionsNext.add(collection.id);}else tracksNext.delete(key);
    if(!(collection.tracks||[]).some(candidate=>tracksNext.has(trackKey(candidate))))collectionsNext.delete(collection.id);
    onCollectionsChange(collectionsNext);onTracksChange(tracksNext);
  }
  function selectAll(){
    const collectionIds=new Set(selectedCollectionIds),trackIds=new Set(selectedTrackIds);
    for(const collection of platformCollections){collectionIds.add(collection.id);for(const track of collection.tracks||[])trackIds.add(trackKey(track));}
    onCollectionsChange(collectionIds);onTracksChange(trackIds);
  }
  function clearPlatform(){
    const collectionIds=new Set(selectedCollectionIds),trackIds=new Set(selectedTrackIds);
    for(const collection of platformCollections){collectionIds.delete(collection.id);for(const track of collection.tracks||[])trackIds.delete(trackKey(track));}
    onCollectionsChange(collectionIds);onTracksChange(trackIds);
  }
  function toggleCollection(id:string){
    setExpandedCollections(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});
  }
  const selectedCount=platformCollections.reduce((count,collection)=>count+(collection.tracks||[]).filter(track=>selectedTrackIds.has(trackKey(track))).length,0);
  const totalTracks=platformCollections.reduce((count,collection)=>count+(collection.tracks||[]).length,0);
  const selectedCollections=platformCollections.filter(collection=>(collection.tracks||[]).some(track=>selectedTrackIds.has(trackKey(track))));
  return <section className="panel stream-card stream-run-library stream-run-library--clean">
    <div className="panel__header stream-run-library-heading"><div><span className="section-kicker">QA MUSIC SELECTION</span><h3>Choose exactly what this QA run may open</h3><p className="stream-muted">The song list stays collapsed until you need it. Only checked songs are placed in the run allowlist. OrbitQA stops or corrects navigation before playback if the platform leaves that list.</p></div><div className="stream-run-library-header-actions"><div className="stream-run-library-stats"><span className="stream-stat-pill">{selectedCount} selected</span><span className="stream-stat-pill">{totalTracks} total</span></div><button type="button" className="secondary-button stream-run-library-toggle" aria-expanded={listOpen} onClick={()=>setListOpen(open=>!open)}>{listOpen?'HIDE SONG LIST':'SHOW SONG LIST'}</button></div></div>
    {!listOpen?<div className="stream-run-library-collapsed-summary"><strong>{selectedCount?`${selectedCount} selected song${selectedCount===1?'':'s'}`:'No songs selected yet'}</strong><span>{selectedCollections.length?selectedCollections.slice(0,4).map(collection=>collection.name).join(' · '):`Open the list to choose saved ${platformLabel(platform)} music.`}{selectedCollections.length>4?` · +${selectedCollections.length-4} more`:''}</span></div>:<>
      <div className="stream-run-library-toolbar">
        <div className="saved-album-filter-row" aria-label="Streaming platform for QA">{STREAMING_PLATFORMS.map(item=><button type="button" key={item.id} className={platform===item.id?'stream-filter-chip stream-filter-chip--active':'stream-filter-chip'} onClick={()=>{onPlatformChange(item.id);setQuery('');setExpandedCollections(new Set());}}>{item.label}</button>)}</div>
        <label className="field stream-run-library-search"><span>Find music</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search title, artist or album" /></label>
      </div>
      <div className="stream-account-bulk-actions stream-run-library-actions"><button type="button" className="secondary-button" disabled={!platformCollections.length} onClick={selectAll}>SELECT ALL {platformLabel(platform).toUpperCase()}</button><button type="button" className="text-button" disabled={!selectedCount} onClick={clearPlatform}>CLEAR SELECTION</button></div>
      {!platformCollections.length?<div className="empty-state">No saved {platformLabel(platform)} music yet. Add it in Music Library first.</div>:!filteredCollections.length?<div className="empty-state">No saved music matches “{query}”.</div>:<div className="stream-run-library-list">{filteredCollections.map(collection=>{
        const fullCollection=platformCollections.find(item=>item.id===collection.id)||collection;
        const tracks=collection.tracks||[];
        const allTracks=fullCollection.tracks||[];
        const selectedForCollection=allTracks.filter(track=>selectedTrackIds.has(trackKey(track))).length;
        const allSelected=Boolean(allTracks.length)&&selectedForCollection===allTracks.length;
        const expanded=Boolean(query.trim())||expandedCollections.has(collection.id);
        return <article className="stream-run-library-album" key={collection.id}>
          <header className="stream-run-library-album__header"><label className="stream-run-library-master"><input type="checkbox" checked={allSelected} onChange={event=>setAlbum(fullCollection,event.target.checked)}/><span><strong>{collection.name}</strong><small>{selectedForCollection}/{allTracks.length} selected · {collection.sourceKind}</small></span></label><button type="button" className="text-button stream-run-library-album-toggle" aria-expanded={expanded} onClick={()=>toggleCollection(collection.id)}>{expanded?'COLLAPSE':'SHOW SONGS'}</button></header>
          {expanded?<div className="stream-run-track-table" role="list">{tracks.length?tracks.map((track,index)=><label className={selectedTrackIds.has(trackKey(track))?'stream-run-track stream-run-track--selected':'stream-run-track'} key={trackKey(track)} role="listitem"><input type="checkbox" checked={selectedTrackIds.has(trackKey(track))} onChange={event=>setTrack(fullCollection,track,event.target.checked)}/><span className="stream-run-track__index">{String(index+1).padStart(2,'0')}</span><span className="stream-run-track__main"><strong>{track.title}</strong><small>{track.artist||'Unknown artist'}{track.album?` · ${track.album}`:''}</small></span><span className="stream-run-track__duration">{formatDuration(track.durationSeconds)}</span></label>):<div className="empty-state">This saved item has no individual songs yet.</div>}</div>:null}
        </article>;
      })}</div>}
    </>}
  </section>;
}
