import type { StreamingPlatform } from './streaming';

function hostMatches(hostname:string, expected:string[]) {
  const host=hostname.toLowerCase().replace(/^www\./,'');
  return expected.some(value=>host===value||host.endsWith(`.${value}`));
}

export function detectStreamingPlatformFromInput(input:string):StreamingPlatform|null {
  let url:URL;
  try { url=new URL(String(input||'').trim()); } catch { return null; }
  const host=url.hostname.toLowerCase().replace(/^www\./,'');
  if(hostMatches(host,['spotify.com'])) return 'spotify';
  if(hostMatches(host,['music.apple.com'])) return 'apple-music';
  if(hostMatches(host,['music.youtube.com','youtube.com','youtu.be'])) return 'youtube-music';
  if(hostMatches(host,['soundcloud.com','on.soundcloud.com'])) return 'soundcloud';
  if(hostMatches(host,['deezer.com','link.deezer.com','deezer.page.link'])) return 'deezer';
  if(hostMatches(host,['tidal.com','listen.tidal.com','tidal.link'])) return 'tidal';
  if(hostMatches(host,['audiomack.com','amk.to'])) return 'audiomack';
  if(hostMatches(host,['pandora.com','pandora.app.link'])) return 'pandora';
  return null;
}
