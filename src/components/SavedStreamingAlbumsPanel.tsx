import { useMemo, useState } from 'react';
import type { StreamingCollection, StreamingPlatform } from '../shared/streaming';
import { STREAMING_PLATFORMS } from './StreamingPlatformTabs';

const platformLabel=(platform:StreamingPlatform)=>STREAMING_PLATFORMS.find(item=>item.id===platform)?.label||platform;
const verifiedLabel=(album:StreamingCollection)=>album.verification?.status==='verified'
  ? `Verified ${album.verification.verifiedAt?new Date(album.verification.verifiedAt).toLocaleString():''}`.trim()
  : 'Not verified';

export function SavedStreamingAlbumsPanel({
  albums,
  selectedIds,
  activePlatform,
  verificationSessions,
  onUseForQa,
  onOpen,
  onAddSongs,
  onRename,
  onDelete,
  onVerify,
  onCompleteVerification,
}:{
  albums: StreamingCollection[];
  selectedIds: Set<string>;
  activePlatform: StreamingPlatform;
  verificationSessions: Record<string,string>;
  onUseForQa: (album:StreamingCollection,selected:boolean)=>void;
  onOpen: (album:StreamingCollection)=>void;
  onAddSongs: (album:StreamingCollection)=>void;
  onRename: (album:StreamingCollection,name:string)=>void;
  onDelete: (id:string)=>void;
  onVerify: (album:StreamingCollection)=>void;
  onCompleteVerification: (album:StreamingCollection)=>void;
}) {
  const [filter,setFilter]=useState<'all'|StreamingPlatform>('all');
  const visible=useMemo(()=>filter==='all'?albums:albums.filter(album=>album.platform===filter),[albums,filter]);

  return <section className="panel stream-card saved-streaming-albums">
    <div className="panel__header">
      <div><span className="section-kicker">SAVED MUSIC</span><h3>All imported &amp; manually saved music</h3><p className="stream-muted">Songs, albums, artists, and playlists from every platform live in one library. Verify the exact saved link before you trust it for QA.</p></div>
      <span className="stream-stat-pill">{albums.length} items</span>
    </div>
    <div className="saved-album-filter-row" aria-label="Saved music platform filter">
      <button type="button" className={filter==='all'?'stream-filter-chip stream-filter-chip--active':'stream-filter-chip'} onClick={()=>setFilter('all')}>All platforms</button>
      {STREAMING_PLATFORMS.map(item=><button type="button" key={item.id} className={filter===item.id?'stream-filter-chip stream-filter-chip--active':'stream-filter-chip'} onClick={()=>setFilter(item.id)}>{item.label}</button>)}
    </div>
    {albums.length===0?<div className="empty-state">No saved music yet. Fetch songs when OrbitQA can read the link, or use SAVE LINK MANUALLY when you only want to store and visually verify the exact source.</div>:visible.length===0?<div className="empty-state">No saved music matches this platform filter.</div>:<div className="saved-album-grid">
      {visible.map(album=>{
        const verifyKey=`collection:${album.id}`;
        const pending=Boolean(verificationSessions[verifyKey]);
        const verified=album.verification?.status==='verified';
        const canUseForQa=album.tracks.length>0;
        return <article key={album.id} className={selectedIds.has(album.id)?'saved-album-card saved-album-card--selected':'saved-album-card'}>
          <div className="saved-album-card-topline"><span className={`stream-platform-tag stream-platform-tag--${album.platform}`}>{platformLabel(album.platform)}</span><div className="stream-verification-badges">{album.platform===activePlatform?<span className="saved-album-active-tag">QA platform</span>:null}<span className={verified?'stream-verified-badge':'stream-unverified-badge'}>{verified?'VERIFIED ✓':'UNVERIFIED'}</span></div></div>
          <div className="saved-album-head">
            <label className="saved-album-use"><input type="checkbox" checked={selectedIds.has(album.id)} disabled={!canUseForQa} onChange={event=>onUseForQa(album,event.target.checked)}/><span>{canUseForQa?'Use for QA':'Add songs before QA'}</span></label>
            <div><strong>{album.name}</strong><small>{album.tracks.length} saved song{album.tracks.length===1?'':'s'} · {album.sourceKind||'music link'}</small><small className="stream-saved-source-url" title={album.sourceInput}>{album.sourceInput}</small><small className="stream-verification-meta">{verifiedLabel(album)}{verified&&album.verification?` · ${album.verification.verifiedDeviceProfile}`:''}</small></div>
          </div>
          <div className="saved-album-actions saved-album-verify-actions">
            {!pending?<button type="button" className="secondary-button" onClick={()=>onVerify(album)}>{verified?'RE-VERIFY':'VERIFY'}</button>:<button type="button" className="text-button" disabled>VERIFICATION OPEN</button>}
            <button type="button" className="secondary-button" onClick={()=>onOpen(album)}>OPEN</button>
            <button type="button" className="text-button" onClick={()=>onAddSongs(album)}>ADD SONGS</button>
            <button type="button" className="text-button" onClick={()=>{const name=window.prompt('Rename saved music',album.name)?.trim();if(name&&name!==album.name)onRename(album,name);}}>RENAME</button>
            <button type="button" className="danger-button" onClick={()=>{if(window.confirm(`Delete ${album.name}?`))onDelete(album.id);}}>DELETE</button>
          </div>
          {pending?<div className="stream-verification-confirm-card stream-mixed-device-field">
            <span>LINK OPEN · VISUAL CONFIRMATION</span>
            <div className="stream-mixed-device-card stream-mixed-device-card--selected">
              <div className="stream-verification-confirm-copy"><strong>Confirm {album.name}</strong><small>Check the supported browser window and make sure this exact {album.sourceKind||'music'} link is correct before confirming it in OrbitQA.</small><small title={album.sourceInput}>{album.sourceInput}</small></div>
            </div>
            <div className="stream-verification-confirm-actions"><button type="button" className="primary-button stream-verification-primary" onClick={()=>onCompleteVerification(album)}>MARK VERIFIED ✓</button></div>
          </div>:null}
        </article>;
      })}
    </div>}
  </section>;
}
