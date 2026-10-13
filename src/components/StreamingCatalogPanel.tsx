import { useEffect, useState } from 'react';
import type { StreamingCollection, StreamingTrack } from '../shared/streaming';

export function StreamingCatalogPanel({
  input, setInput, tracks, selected, setSelected, loading, onFetch, collectionName, setCollectionName, onSaveCollection, collections, onLoadCollection, onDeleteCollection,
}: {
  input: string; setInput: (v: string) => void; tracks: StreamingTrack[]; selected: Set<string>; setSelected: (next: Set<string>) => void; loading: boolean; onFetch: () => void;
  collectionName: string; setCollectionName: (v: string) => void; onSaveCollection: () => void; collections: StreamingCollection[]; onLoadCollection: (c: StreamingCollection) => void; onDeleteCollection: (id: string) => void;
}) {
  const [visibleLimit, setVisibleLimit] = useState(80);
  useEffect(() => { setVisibleLimit((current) => Math.min(Math.max(80, current), Math.max(80, tracks.length))); }, [tracks.length]);
  const visibleTracks = tracks.slice(0, visibleLimit);
  const allSelected = tracks.length > 0 && tracks.every((t) => selected.has(t.id));
  const toggle = (id: string) => { const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); setSelected(next); };
  return <section className="panel stream-card stream-catalog-card">
    <div className="panel__header"><div><span className="section-kicker">CATALOG LIBRARY</span><h3>Artists, albums, playlists &amp; tracks</h3></div><span className="stream-stat-pill">{tracks.length} loaded</span></div>
    <div className="stream-catalog-input-row"><label className="field field--full"><span>Artist / Album / Playlist / Track URL or Search Query</span><input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Paste a supported URL or enter a search query" /></label><button type="button" className="primary-button" disabled={loading || !input.trim()} onClick={onFetch}>{loading ? 'FETCHING…' : 'FETCH CATALOG'}</button></div>
    <div className="stream-catalog-toolbar"><button type="button" className="text-button" onClick={() => setSelected(new Set(tracks.map(t => t.id)))} disabled={!tracks.length}>Select All</button><button type="button" className="text-button" onClick={() => setSelected(new Set())} disabled={!selected.size}>Clear</button><span>{selected.size} selected</span></div>
    <div className="stream-track-list" aria-label="Catalog tracks">
      {tracks.length === 0 ? <div className="empty-state">Fetch a supported catalog source to build a QA track set.</div> : visibleTracks.map((track) => <label key={track.id} className={selected.has(track.id) ? 'stream-track-row stream-track-row--selected' : 'stream-track-row'}><input type="checkbox" checked={selected.has(track.id)} onChange={() => toggle(track.id)} /><span><strong>{track.title}</strong><small>{[track.artist, track.album].filter(Boolean).join(' · ') || track.platform}</small></span><em>{track.platform}</em></label>)}
    </div>
    {visibleTracks.length < tracks.length ? <button type="button" className="text-button stream-load-more" onClick={() => setVisibleLimit((value) => Math.min(tracks.length, value + 80))}>Load more tracks ({tracks.length - visibleTracks.length} remaining)</button> : null}
    <div className="stream-save-row"><label className="field"><span>Collection name</span><input value={collectionName} onChange={(e) => setCollectionName(e.target.value)} placeholder="e.g. Release regression set" /></label><button type="button" className="secondary-button" disabled={!selected.size || !collectionName.trim()} onClick={onSaveCollection}>Save Selected</button></div>
    <div className="stream-collection-list">
      {collections.map((c) => <div className="stream-collection-chip" key={c.id}><button type="button" onClick={() => onLoadCollection(c)}><strong>{c.name}</strong><span>{c.tracks.length} tracks</span></button><button type="button" aria-label={`Delete ${c.name}`} onClick={() => onDeleteCollection(c.id)}>×</button></div>)}
    </div>
    {allSelected && tracks.length > 0 ? <small className="stream-muted">All loaded tracks are selected.</small> : null}
  </section>;
}
