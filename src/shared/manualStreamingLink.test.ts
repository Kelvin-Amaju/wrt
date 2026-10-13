import { describe, expect, it } from 'vitest';
import { inferManualStreamingKind } from './manualStreamingLink';

describe('inferManualStreamingKind',()=>{
  it.each([
    ['https://music.youtube.com/watch?v=abc&si=share','track'],
    ['https://music.youtube.com/playlist?list=OLAK5uy_x','playlist'],
    ['https://music.youtube.com/channel/UC123','artist'],
    ['https://open.spotify.com/album/123','album'],
    ['https://open.spotify.com/track/123','track'],
    ['https://soundcloud.com/artist/sets/mix','playlist'],
    ['https://soundcloud.com/artist/song','track'],
    ['https://www.deezer.com/album/123','album'],
    ['https://tidal.com/browse/playlist/123','playlist'],
    ['https://audiomack.com/name/song/title','track'],
    ['https://www.pandora.com/artist/name/song/TRabc123','track'],
  ])('%s -> %s',(url,kind)=>expect(inferManualStreamingKind(url)).toBe(kind));
});
