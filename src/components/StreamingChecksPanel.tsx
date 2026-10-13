import type { StreamingQaCheck } from '../shared/streaming';
const OPTIONS: Array<{ id: StreamingQaCheck; label: string; detail: string }> = [
  { id:'session-verification', label:'Verify account session', detail:'Confirm the authorized session is available.' },
  { id:'playback', label:'Playback starts automatically', detail:'Required core STREAM behavior. OrbitQA opens a selected song and starts playback in the account browser.' },
  { id:'favorite-track', label:'Like / favorite selected song', detail:'If the current selected song is not already liked/favorited, use the platform control to save it.' },
  { id:'follow-artist', label:'Follow / favorite artist', detail:'If the artist is not already followed/favorited, use the available platform artist control.' },
  { id:'pause-resume', label:'Random pause then resume', detail:'Optional. OrbitQA chooses one random assigned song per account, pauses it briefly, then resumes that same song.' },
  { id:'next-track', label:'Verify next selected song', detail:'Transition only to another song selected in OrbitQA; native platform skip is not used.' },
  { id:'previous-track', label:'Verify previous selected song', detail:'Return only to the previous OrbitQA-selected song.' },
  { id:'queue-transition', label:'Verify selected queue transition', detail:'Confirm every transition stays inside the selected OrbitQA song list.' },
  { id:'volume-control', label:'Adjust player volume', detail:'Optional. Choose whether OrbitQA increases or reduces volume when a safe player control is available.' },
  { id:'artist-navigation', label:'Verify artist navigation', detail:'Open an artist link from selected content, then return to the selected song.' },
  { id:'album-navigation', label:'Verify album navigation', detail:'Open an album link from selected content, then return to the selected song.' },
  { id:'playlist-loading', label:'Verify selected playlist loading', detail:'Load the selected Music Library playlist and return to the selected song.' },
];
export function StreamingChecksPanel({ value, onChange, pauseSeconds, onPauseSecondsChange, volumeDirection, onVolumeDirectionChange }: { value: StreamingQaCheck[]; onChange: (value: StreamingQaCheck[]) => void; pauseSeconds:number; onPauseSecondsChange:(seconds:number)=>void; volumeDirection:'increase'|'decrease'; onVolumeDirectionChange:(direction:'increase'|'decrease')=>void }) {
  const toggle=(id:StreamingQaCheck)=>{if(id==='playback')return;onChange(value.includes(id)?value.filter(x=>x!==id):[...value,id]);};
  const pauseEnabled=value.includes('pause-resume');
  const volumeEnabled=value.includes('volume-control');
  return <section className="panel stream-card"><div className="panel__header"><div><span className="section-kicker">SAFE QA CHECKS</span><h3>Playback &amp; navigation verification</h3></div><span className="stream-stat-pill">{value.length} enabled</span></div><div className="stream-check-grid">{OPTIONS.map(o=><label key={o.id} className={value.includes(o.id)?'stream-check stream-check--active':'stream-check'}><input type="checkbox" checked={o.id==='playback'||value.includes(o.id)} disabled={o.id==='playback'} onChange={()=>toggle(o.id)} /><span><strong>{o.label}</strong><small>{o.detail}</small></span></label>)}</div>
    {(pauseEnabled||volumeEnabled)?<div className="stream-form-grid stream-check-options">
      {pauseEnabled?<label className="field"><span>Pause duration (seconds)</span><input aria-label="Pause duration seconds" type="number" min="0.5" max="3" step="0.5" value={pauseSeconds} onChange={event=>onPauseSecondsChange(Math.max(0.5,Math.min(3,Number(event.target.value)||0.5)))}/><small>Used once on a random assigned song per account. OrbitQA resumes at the configured timer deadline, then continues counting only active playback time.</small></label>:null}
      {volumeEnabled?<label className="field"><span>Volume action</span><select aria-label="Volume action" value={volumeDirection} onChange={event=>onVolumeDirectionChange(event.target.value as 'increase'|'decrease')}><option value="decrease">Reduce volume</option><option value="increase">Increase volume</option></select><small>Only the selected direction is checked.</small></label>:null}
    </div>:null}
  </section>;
}
