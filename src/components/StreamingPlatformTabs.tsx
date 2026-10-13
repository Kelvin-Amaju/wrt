import type { StreamingPlatform } from '../shared/streaming';

export const STREAMING_PLATFORMS: Array<{ id: StreamingPlatform; label: string; mark: string }> = [
  { id: 'spotify', label: 'Spotify', mark: '●' },
  { id: 'apple-music', label: 'Apple Music', mark: '♪' },
  { id: 'youtube-music', label: 'YouTube Music', mark: '▶' },
  { id: 'soundcloud', label: 'SoundCloud', mark: '◒' },
  { id: 'deezer', label: 'Deezer', mark: '▥' },
  { id: 'tidal', label: 'TIDAL', mark: '◆' },
  { id: 'audiomack', label: 'Audiomack', mark: '△' },
  { id: 'pandora', label: 'Pandora', mark: 'P' },
];

export function StreamingPlatformTabs({ value, onChange }: { value: StreamingPlatform; onChange: (value: StreamingPlatform) => void }) {
  return <div className="stream-platform-tabs" role="tablist" aria-label="Streaming platform">
    {STREAMING_PLATFORMS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={value === item.id} className={value === item.id ? 'stream-platform-tab stream-platform-tab--active' : 'stream-platform-tab'} onClick={() => onChange(item.id)}><span>{item.mark}</span><strong>{item.label}</strong></button>)}
  </div>;
}
