import { useEffect, useState } from 'react';
import type { StreamingCollection, StreamingInputKind, StreamingPlatform, StreamingTrack } from '../shared/streaming';
import { inferManualStreamingKind } from '../shared/manualStreamingLink';
import { STREAMING_PLATFORMS } from './StreamingPlatformTabs';

type ManualKind='auto'|StreamingInputKind;

export function SimpleStreamingImporter({
  platform,
  detectedPlatform,
  input,
  setInput,
  albumName,
  setAlbumName,
  manualLabel,
  setManualLabel,
  manualKind,
  setManualKind,
  tracks,
  selected,
  setSelected,
  busy,
  editingAlbum,
  verificationSessions,
  onFetch,
  onSave,
  onManualSave,
  onClearWorkspace,
  onVerifyTrack,
  onCompleteTrackVerification,
  duplicateNotice,
}:{
  platform: StreamingPlatform;
  detectedPlatform: StreamingPlatform|null;
  input: string;
  setInput: (value:string)=>void;
  albumName: string;
  setAlbumName: (value:string)=>void;
  manualLabel: string;
  setManualLabel: (value:string)=>void;
  manualKind: ManualKind;
  setManualKind: (value:ManualKind)=>void;
  tracks: StreamingTrack[];
  selected: Set<string>;
  setSelected: (next:Set<string>)=>void;
  busy: boolean;
  editingAlbum: StreamingCollection|null;
  verificationSessions: Record<string,string>;
  onFetch: ()=>void;
  onSave: ()=>void;
  onManualSave: ()=>void;
  onClearWorkspace: ()=>void;
  onVerifyTrack: (track:StreamingTrack)=>void;
  onCompleteTrackVerification: (track:StreamingTrack)=>void;
  duplicateNotice?: { kind?: string; collectionName?: string; message: string } | null;
}) {
  const [visibleLimit,setVisibleLimit]=useState(100);
  useEffect(()=>setVisibleLimit(100),[platform,input]);

  const platformLabel=STREAMING_PLATFORMS.find(item=>item.id===platform)?.label||platform;
  const detectedLabel=detectedPlatform?STREAMING_PLATFORMS.find(item=>item.id===detectedPlatform)?.label||detectedPlatform:null;
  const visible=tracks.slice(0,visibleLimit);
  const keyFor=(track:StreamingTrack)=>String(track.id||track.url);
  const toggle=(track:StreamingTrack)=>{
    const key=keyFor(track);
    const next=new Set(selected);
    next.has(key)?next.delete(key):next.add(key);
    setSelected(next);
  };
  const selectAll=()=>setSelected(new Set(tracks.map(keyFor).filter(Boolean)));
  const inferredKind=inferManualStreamingKind(input);

  return <section className="panel stream-card simple-streaming-importer">
    <div className="panel__header">
      <div>
        <span className="section-kicker">LINK IMPORTER</span>
        <h3>{editingAlbum?`Edit ${editingAlbum.name}`:`Import or manually save music`}</h3>
      </div>
      <span className="stream-stat-pill">{tracks.length} songs found</span>
    </div>

    <p className="stream-muted">Paste any supported song, album, artist, or playlist link. Use FETCH SONGS when OrbitQA can read the catalog. If fetching fails, SAVE LINK MANUALLY keeps the exact link so you can visually verify it yourself.</p>{detectedLabel?<div className="stream-detected-platform">Detected service: <strong>{detectedLabel}</strong></div>:null}{duplicateNotice?<div className="stream-duplicate-notice" role="status"><strong>Already saved</strong><span>{duplicateNotice.message}</span></div>:null}

    <div className="stream-catalog-input-row stream-catalog-input-row--manual">
      <label className="field field--full">
        <span>Music link</span>
        <input
          value={input}
          onChange={event=>setInput(event.target.value)}
          placeholder="Paste Spotify, YouTube Music, SoundCloud, Deezer, TIDAL, Audiomack, or Pandora link"
          disabled={busy}
        />
      </label>
      <button type="button" className="primary-button" onClick={onFetch} disabled={busy||!input.trim()||Boolean(duplicateNotice)}>{busy?'WORKING…':'FETCH SONGS'}</button>
    </div>

    <div className="stream-manual-save-box">
      <div className="stream-manual-save-copy"><strong>Manual link save</strong><span>Use this when catalog fetching does not work. OrbitQA stores the exact link without guessing the tracks.</span></div>
      <div className="stream-manual-save-grid">
        <label className="field field--full"><span>Name / label</span><input value={manualLabel} onChange={event=>setManualLabel(event.target.value)} placeholder={editingAlbum?'Song title or label':'Song, album, artist, or playlist name'} disabled={busy}/></label>
        <label className="field"><span>Save as</span><select value={manualKind} onChange={event=>setManualKind(event.target.value as ManualKind)} disabled={busy}><option value="auto">Auto ({inferredKind==='search'?'choose type':inferredKind})</option><option value="track">Song</option><option value="album">Album</option><option value="artist">Artist</option><option value="playlist">Playlist</option></select></label>
        <button type="button" className="secondary-button stream-manual-save-button" onClick={onManualSave} disabled={busy||!input.trim()||!manualLabel.trim()||Boolean(duplicateNotice)}>SAVE LINK MANUALLY</button>
      </div>
      {editingAlbum?<small>When editing saved music, manual save adds a direct song link to this item. Choose Song if auto-detection is uncertain.</small>:<small>Albums, artists, and playlists can be saved with zero fetched songs and verified visually. They cannot be used for QA until songs are added.</small>}
    </div>

    {tracks.length?<>
      <div className="stream-catalog-toolbar">
        <button type="button" className="text-button" onClick={selectAll}>Select All</button>
        <button type="button" className="text-button" disabled={!selected.size} onClick={()=>setSelected(new Set())}>Clear Selection</button>
        <button type="button" className="text-button" onClick={onClearWorkspace}>Clear Workspace</button>
        <span>{tracks.length} songs found · {selected.size} selected</span>
      </div>

      <div className="stream-track-list" aria-label="Fetched songs">
        {visible.map(track=>{
          const key=keyFor(track);
          const verificationKey=editingAlbum?`track:${editingAlbum.id}:${key}`:'';
          const pending=Boolean(verificationKey&&verificationSessions[verificationKey]);
          const verified=track.verification?.status==='verified';
          return <div key={key} className={selected.has(key)?'stream-track-row stream-track-row--selected':'stream-track-row'}>
            <input aria-label={`Select ${track.title}`} type="checkbox" checked={selected.has(key)} onChange={()=>toggle(track)}/>
            <span>
              <strong>{track.title}</strong>
              <small>{[track.artist,track.album].filter(Boolean).join(' · ')||platformLabel}</small>
              <small className="stream-track-url" title={track.url}>{track.url}</small>
              {verified?<small className="stream-track-verified">VERIFIED ✓ · {track.verification?.verifiedDeviceProfile}</small>:null}
            </span>
            <div className="stream-track-actions">
              <em>{track.durationSeconds?`${Math.floor(track.durationSeconds/60)}:${String(track.durationSeconds%60).padStart(2,'0')}`:platformLabel}</em>
              {editingAlbum&&!pending?<button type="button" className="mini-button" onClick={()=>onVerifyTrack(track)}>{verified?'RE-VERIFY':'VERIFY'}</button>:null}
              {editingAlbum&&pending?<span className="stream-track-verified">VERIFICATION OPEN</span>:null}
            </div>
            {editingAlbum&&pending?<div className="stream-verification-confirm-card stream-mixed-device-field stream-track-verification-card">
              <span>SONG OPEN · VISUAL CONFIRMATION</span>
              <div className="stream-mixed-device-card stream-mixed-device-card--selected"><div className="stream-verification-confirm-copy"><strong>{track.title}</strong><small>Check the supported browser window and confirm this exact saved song link.</small><small title={track.url}>{track.url}</small></div></div>
              <div className="stream-verification-confirm-actions"><button type="button" className="primary-button stream-verification-primary" onClick={()=>onCompleteTrackVerification(track)}>MARK VERIFIED ✓</button></div>
            </div>:null}
          </div>;
        })}
      </div>
      {visible.length<tracks.length?<button type="button" className="text-button stream-load-more" onClick={()=>setVisibleLimit(value=>Math.min(tracks.length,value+100))}>Load more tracks ({tracks.length-visible.length} remaining)</button>:null}

      <div className="stream-simple-save-row">
        <label className="field field--full">
          <span>Album name</span>
          <input value={albumName} onChange={event=>setAlbumName(event.target.value)} placeholder="Give this album a name" disabled={busy}/>
        </label>
        <button type="button" className="secondary-button" onClick={onSave} disabled={busy||!albumName.trim()||!selected.size||Boolean(duplicateNotice)}>{editingAlbum?'SAVE CHANGES':'SAVE ALBUM'}</button>
      </div>
    </>:<div className="empty-state">Fetch songs when possible, or use <strong>SAVE LINK MANUALLY</strong> to store the exact source for visual verification.</div>}

    {!tracks.length&&(input||albumName||manualLabel)?<button type="button" className="text-button stream-clear-workspace" onClick={onClearWorkspace}>Clear Workspace</button>:null}
  </section>;
}
