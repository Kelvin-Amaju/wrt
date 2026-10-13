import { describe, expect, it } from 'vitest';
import { mergeSelectedStreamingCatalogTracks, normalizeObservationRange, normalizeStreamingQueueMode, type SavedStreamingArtist } from './streaming';
import { normalizeRunKind } from './runCenter';

describe('streaming domain', () => {
  it('normalizes queue mode', () => {
    expect(normalizeStreamingQueueMode('shuffle')).toBe('shuffle');
    expect(normalizeStreamingQueueMode('garbage')).toBe('sequential');
  });
  it('normalizes reversed observation range', () => {
    expect(normalizeObservationRange({ minSeconds: 110, maxSeconds: 60 })).toEqual({ minSeconds: 60, maxSeconds: 110 });
  });

  it('merges only selected canonical tracks from saved artists without duplicates', () => {
    const base = { schemaVersion:2 as const, platform:'spotify' as const, artistName:'Artist', artistUrl:'https://open.spotify.com/artist/a', artworkUrl:undefined, sourceOrigins:[], autoRefreshEnabled:true, lastFetchStatus:'complete' as const, createdAt:'2026-09-17T00:00:00.000Z', updatedAt:'2026-09-17T00:00:00.000Z' };
    const track = { id:'t1', spotifyTrackId:'t1', platform:'spotify' as const, title:'One', url:'https://open.spotify.com/track/t1', creditedArtistIds:['a'], creditedArtistNames:['Artist'] };
    const artists: SavedStreamingArtist[] = [
      { ...base, id:'s1', platformArtistId:'a', catalogTracks:[track], selectedTrackIds:['t1'] },
      { ...base, id:'s2', platformArtistId:'b', catalogTracks:[track], selectedTrackIds:['t1'] },
    ];
    expect(mergeSelectedStreamingCatalogTracks(artists)).toHaveLength(1);
    expect(mergeSelectedStreamingCatalogTracks(artists, ['s2'])).toEqual([track]);
  });

  it('normalizes run kind', () => {
    expect(normalizeRunKind(undefined)).toBe('qa');
    expect(normalizeRunKind('streaming')).toBe('streaming');
  });
});
