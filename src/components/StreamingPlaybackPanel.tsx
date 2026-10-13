import type { RunExecutionMode } from '../shared/runCenter';
import type { StreamingBrowserRuntime, StreamingDeviceFamily, StreamingDeviceMode, StreamingQueueMode } from '../shared/streaming';

export type StreamingPlaybackState = {
  minSeconds: number;
  maxSeconds: number;
  queueMode: StreamingQueueMode;
  slots: number;
  playbackSpeed: number;
  restEnabled: boolean;
  restAfterTracks: number;
  restMinutes: number;
  restAndReplay: boolean;
  executionMode: RunExecutionMode;
  muteAudio: boolean;
  captureScreenshots: boolean;
  browserRuntime: StreamingBrowserRuntime;
  deviceMode: StreamingDeviceMode;
  deviceProfile: string;
  mixedDeviceModes: StreamingDeviceFamily[];
  mixedDeviceProfiles: Record<StreamingDeviceFamily,string>;
};

const DESKTOP_PROFILES=['Desktop 1280x720'];
const ANDROID_PROFILES=['Pixel 11','Pixel 11 Pro','Pixel 11 Pro XL','Galaxy S26','Galaxy S26+','Galaxy S26 Ultra','Galaxy S26 FE','Galaxy Z Flip8','Galaxy Z Fold8 (Open)','Pixel 7','Pixel 5','Galaxy S23'];
const IOS_PROFILES=['iPhone 18 Pro','iPhone 18 Pro Max','iPhone Duo (Closed)','iPhone Duo (Open)','iPhone 13','iPhone 13 Pro','iPhone 13 Pro Max','iPhone 13 Mini','iPad Pro 11','iPad Mini'];
const FAMILY_LABELS:Record<StreamingDeviceFamily,string>={desktop:'Desktop',android:'Android',ios:'iOS'};
const FAMILY_PROFILES:Record<StreamingDeviceFamily,string[]>={desktop:DESKTOP_PROFILES,android:ANDROID_PROFILES,ios:IOS_PROFILES};

export function StreamingPlaybackPanel({ value, onChange, contentIntelligenceEnabled=false }: { value: StreamingPlaybackState; onChange: (next: StreamingPlaybackState) => void; contentIntelligenceEnabled?: boolean }) {
  const patch = (next: Partial<StreamingPlaybackState>) => onChange({ ...value, ...next });
  const deviceProfiles=value.deviceMode==='android'?ANDROID_PROFILES:value.deviceMode==='ios'?IOS_PROFILES:[];

  function changeDeviceMode(deviceMode:StreamingDeviceMode){
    patch({
      deviceMode,
      deviceProfile:deviceMode==='android'?'Pixel 11':deviceMode==='ios'?'iPhone 18 Pro':'Desktop 1280x720',
      mixedDeviceModes:value.mixedDeviceModes.length?value.mixedDeviceModes:['desktop','android','ios'],
    });
  }
  function toggleMixedFamily(family:StreamingDeviceFamily){
    const has=value.mixedDeviceModes.includes(family);
    if(has && value.mixedDeviceModes.length===1) return;
    patch({mixedDeviceModes:has?value.mixedDeviceModes.filter(item=>item!==family):[...value.mixedDeviceModes,family]});
  }
  function setMixedProfile(family:StreamingDeviceFamily,profile:string){
    patch({mixedDeviceProfiles:{...value.mixedDeviceProfiles,[family]:profile}});
  }

  const profileField=value.deviceMode==='mixed'
    ? <div className="field field--full stream-mixed-device-field">
        <span>Mix these device families</span>
        <div className="stream-mixed-device-grid" aria-label="Mixed streaming device families">
          {(['desktop','android','ios'] as StreamingDeviceFamily[]).map(family=>{
            const selected=value.mixedDeviceModes.includes(family);
            return <div className={selected?'stream-mixed-device-card stream-mixed-device-card--selected':'stream-mixed-device-card'} key={family}>
              <label className="stream-mixed-device-choice"><input type="checkbox" checked={selected} onChange={()=>toggleMixedFamily(family)} /><span><strong>{FAMILY_LABELS[family]}</strong><small>{selected?'Included in rotation':'Not used'}</small></span></label>
              <select aria-label={`${FAMILY_LABELS[family]} mixed device profile`} value={value.mixedDeviceProfiles[family]} onChange={e=>setMixedProfile(family,e.target.value)} disabled={!selected}>{FAMILY_PROFILES[family].map(profile=><option key={profile} value={profile}>{profile}</option>)}</select>
            </div>;
          })}
        </div>
        <small>Select any combination. OrbitQA rotates only through the checked families.</small>
      </div>
    : deviceProfiles.length
      ? <label className="field"><span>Device profile</span><select aria-label="Streaming device profile" value={value.deviceProfile} onChange={(e)=>patch({deviceProfile:e.target.value})}>{deviceProfiles.map(profile=><option key={profile} value={profile}>{profile}</option>)}</select></label>
      : <label className="field"><span>Device profile</span><input value="Desktop 1280 × 720" readOnly /></label>;

  return <section className="panel stream-card">
    <div className="panel__header"><div><span className="section-kicker">PLAYBACK ENGINE</span><h3>Timing, device &amp; queue behavior</h3></div><span className="stream-stat-pill">QA only</span></div>
    <div className="stream-form-grid">
      <label className="field"><span>Browser</span><select aria-label="Streaming browser" value={value.browserRuntime} onChange={(e)=>patch({browserRuntime:e.target.value as StreamingBrowserRuntime})}><option value="chrome-installed">Google Chrome</option><option value="brave-installed">Brave</option></select><small>Used for Desktop, Android compatibility and iOS compatibility browser workers.</small></label>
      <label className="field"><span>Device type</span><select aria-label="Streaming device type" value={value.deviceMode} onChange={(e)=>changeDeviceMode(e.target.value as StreamingDeviceMode)}><option value="desktop">Desktop</option><option value="android">Android Mobile</option><option value="ios">iOS Mobile</option><option value="mixed">Mixed Devices</option></select><small>Use one device family, or choose exactly which families to mix.</small></label>
      {profileField}
      {contentIntelligenceEnabled?<div className="field"><span>Observation timing</span><strong>Controlled by Content Intelligence</strong><small>The maximum task time is set in Content Intelligence. There is no fixed minimum.</small></div>:<><label className="field"><span>Min observation (seconds)</span><input type="number" min="1" max="3600" value={value.minSeconds} onChange={(e) => patch({ minSeconds: Number(e.target.value) })} /></label><label className="field"><span>Max observation (seconds)</span><input type="number" min="1" max="3600" value={value.maxSeconds} onChange={(e) => patch({ maxSeconds: Number(e.target.value) })} /></label></>}
      <div className="field stream-persistent-playback-note"><span>Persistent account browsers</span><strong>All selected accounts stay open</strong><small>Each selected account gets one browser. The browser stays open until you close it manually or stop Streaming QA. Min/Max observation only controls when that account changes to another selected song.</small></div>
      <label className="field"><span>Playback speed</span><select value={value.playbackSpeed} onChange={(e) => patch({ playbackSpeed: Number(e.target.value) })}><option value={1}>1.0× Normal</option></select><small>Only platform-supported QA speeds are exposed.</small></label>
      <label className="field"><span>Execution mode</span><select aria-label="Streaming execution mode" value={value.executionMode} onChange={(e) => patch({ executionMode: e.target.value as RunExecutionMode })}><option value="visible">Visible Activity</option><option value="background">Background Activity</option></select><small>Visible opens the browser normally. Background uses the same real browser renderer, starts minimized, and keeps full-speed anti-throttling protections active.</small></label>
      <label className="toggle-row stream-audio-toggle"><input type="checkbox" checked={value.muteAudio} onChange={(e)=>patch({muteAudio:e.target.checked})}/><span><strong>Mute browser audio</strong><small>Optional. Leave OFF to hear streaming audio.</small></span></label>
    </div>
    <label className="toggle-row"><input type="checkbox" checked={value.restEnabled} onChange={(e) => patch({ restEnabled: e.target.checked })} /><span><strong>Session rest periods</strong><small>Pause QA sessions after a configured number of observed tracks.</small></span></label>
    {value.restEnabled ? <div className="stream-form-grid stream-rest-grid"><label className="field"><span>Rest after tracks</span><input type="number" min="1" value={value.restAfterTracks} onChange={(e) => patch({ restAfterTracks: Number(e.target.value) })} /></label><label className="field"><span>Rest length (minutes)</span><input type="number" min="1" value={value.restMinutes} onChange={(e) => patch({ restMinutes: Number(e.target.value) })} /></label></div> : null}
    <label className="toggle-row"><input type="checkbox" checked={value.restAndReplay} onChange={(e)=>patch({restAndReplay:e.target.checked})}/><span><strong>Rest &amp; Replay</strong><small>When this account finishes all assigned songs, stop media, wait a random Min/Max observation duration, then restart from the first assigned song until you stop the run.</small></span></label>
    <label className="toggle-row"><input type="checkbox" checked={value.captureScreenshots} onChange={(e) => patch({ captureScreenshots: e.target.checked })} /><span><strong>Capture QA screenshots</strong><small>Capture safe playback checkpoints without exposing login secrets.</small></span></label>
  </section>;
}
