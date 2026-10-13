import { useMemo, useState } from 'react';
import type { ProxyPublicRecord, ProxySource } from '../shared/proxy';
import type { StreamingAccountPublic, StreamingAccountVerificationSession, StreamingAuthMode, StreamingBrowserRuntime, StreamingDeviceFamily, StreamingPlatform } from '../shared/streaming';

const PLATFORMS:Array<{id:StreamingPlatform;label:string}>=[
  {id:'spotify',label:'Spotify'},
  {id:'youtube-music',label:'YouTube Music'},
  {id:'soundcloud',label:'SoundCloud'},
  {id:'deezer',label:'Deezer'},
  {id:'tidal',label:'TIDAL'},
  {id:'audiomack',label:'Audiomack'},
  {id:'pandora',label:'Pandora'},
];
const platformLabel=(id:StreamingPlatform)=>PLATFORMS.find(item=>item.id===id)?.label||id;
const proxyOptions:Array<{id:ProxySource;label:string}>=[
  {id:'none',label:'Direct / No proxy'},
  {id:'rotating',label:'Rotating Pool'},
  {id:'static',label:'Static Pool'},
  {id:'smart-mix',label:'Smart Mix'},
];
const DEVICE_LABELS:Record<StreamingDeviceFamily,string>={desktop:'Desktop',android:'Android',ios:'iOS'};

export type StreamingAccountSaveRequest={id?:string;platform:StreamingPlatform;label:string;username:string;authMode:StreamingAuthMode;password?:string;sessionSecret?:string;proxySource:ProxySource;defaultBrowserRuntime?:StreamingBrowserRuntime;defaultDeviceMode?:StreamingDeviceFamily;defaultDeviceProfile?:string;staticProxyMode?:'auto'|'manual';staticProxyId?:string;status?:'unverified'|'ready'|'needs-verification'|'warning'|'failed';lastVerifiedAt?:string;lastVerificationReason?:string;lastVerificationBrowser?:string;lastVerificationDeviceMode?:StreamingDeviceFamily;lastVerificationDeviceProfile?:string;lastVerificationProxySource?:ProxySource;proxyId?:string;};
export type StreamingAccountVerificationRequest={proxySource:ProxySource;deviceMode:StreamingDeviceFamily;deviceProfile:string};

export function StreamingAccountsPanel({
  accounts,verificationSessions,onSave,onDelete,onStartVerification,onCheckSavedSession,onRepairProfile,onCompleteVerification,onCancelVerification,onAssignStickyProxy,
}:{
  accounts:StreamingAccountPublic[];
  verificationSessions:Record<string,StreamingAccountVerificationSession>;
  onSave:(value:StreamingAccountSaveRequest)=>Promise<StreamingAccountPublic>;
  onDelete:(id:string)=>Promise<void>;
  onStartVerification:(id:string,request:StreamingAccountVerificationRequest)=>Promise<void>;
  onCheckSavedSession:(id:string)=>Promise<void>;
  onRepairProfile:(id:string)=>Promise<void>;
  onCompleteVerification:(id:string)=>Promise<void>;
  onCancelVerification:(id:string)=>Promise<void>;
  onAssignStickyProxy:(id:string,request:{mode:'auto'|'manual';proxyId?:string})=>Promise<void>;
}){
  const [selectedPlatforms,setSelectedPlatforms]=useState<StreamingPlatform[]>(['spotify']);
  const [editingId,setEditingId]=useState<string|null>(null);
  const [label,setLabel]=useState('');
  const [username,setUsername]=useState('');
  const [authMode,setAuthMode]=useState<StreamingAuthMode>('credentials');
  const [password,setPassword]=useState('');
  const [sessionSecret,setSessionSecret]=useState('');
  const [proxySource,setProxySource]=useState<ProxySource>('none');
  const [saving,setSaving]=useState(false);
  const [checkingIds,setCheckingIds]=useState<Set<string>>(new Set());
  const [sessionCheckingIds,setSessionCheckingIds]=useState<Set<string>>(new Set());
  const [filter,setFilter]=useState<'all'|StreamingPlatform>('all');
  const [accountSearch,setAccountSearch]=useState('');
  const [staticProxies,setStaticProxies]=useState<ProxyPublicRecord[]>([]);
  const [proxyAssignAccountId,setProxyAssignAccountId]=useState<string|null>(null);
  const [proxyAssignValue,setProxyAssignValue]=useState('auto');
  const availableStaticProxies=useMemo(()=>staticProxies.filter(p=>p.enabled&&(p.health==='live'||p.health==='slow')&&!p.staticIpChangePending),[staticProxies]);
  const stickyProxyLabel=(proxy:ProxyPublicRecord)=>`${proxy.observedIp||proxy.expectedStaticIp||proxy.hostname}:${proxy.port}${proxy.countryCode?` · ${proxy.countryCode}`:''} · ${proxy.health}`;
  async function openProxyAssignment(account:StreamingAccountPublic){setProxyAssignAccountId(account.id);setProxyAssignValue(account.staticProxyMode==='manual'&&account.staticProxyId?`manual:${account.staticProxyId}`:'auto');try{const rows=await window.orbitqa?.listProxies?.('static');setStaticProxies(rows||[]);}catch{setStaticProxies([]);}}
  async function applyProxyAssignment(accountId:string){const value=proxyAssignValue;if(value==='auto')await onAssignStickyProxy(accountId,{mode:'auto'});else await onAssignStickyProxy(accountId,{mode:'manual',proxyId:value.replace(/^manual:/,'')});setProxyAssignAccountId(null);}
  const visible=useMemo(()=>{
    const query=accountSearch.trim().toLowerCase();
    return accounts.filter(account=>(filter==='all'||account.platform===filter)&&(!query||`${account.label} ${account.username||''} ${platformLabel(account.platform)}`.toLowerCase().includes(query)));
  },[accounts,filter,accountSearch]);
  const editing=accounts.find(account=>account.id===editingId)||null;

  function togglePlatform(platform:StreamingPlatform){
    if(editingId)return;
    setSelectedPlatforms(current=>current.includes(platform)?(current.length===1?current:current.filter(item=>item!==platform)):[...current,platform]);
  }
  function resetForm(){setEditingId(null);setSelectedPlatforms(['spotify']);setLabel('');setUsername('');setAuthMode('credentials');setPassword('');setSessionSecret('');setProxySource('none');}
  function beginEdit(account:StreamingAccountPublic){
    setEditingId(account.id);setSelectedPlatforms([account.platform]);setLabel(account.label);setUsername(account.username||'');setAuthMode(account.authMode||'credentials');setPassword('');setSessionSecret('');setProxySource(account.proxySource||'none');
    window.scrollTo?.({top:0,behavior:'smooth'});
  }
  async function save(){
    setSaving(true);
    try{
      const platforms=editing?[editing.platform]:selectedPlatforms;
      for(const platform of platforms){
        await onSave({
          ...(editing?{id:editing.id}:{}),platform,label:label.trim()||`${platformLabel(platform)} QA account`,username:username.trim(),authMode,
          ...(password?{password}:{}),...(sessionSecret.trim()?{sessionSecret:sessionSecret.trim()}:{}),proxySource,
        });
      }
      resetForm();
    }finally{setSaving(false);}
  }
  async function switchProxy(account:StreamingAccountPublic,next:ProxySource){
    await onSave({id:account.id,platform:account.platform,label:account.label,username:account.username||'',authMode:account.authMode||'credentials',proxySource:next});
  }
  const canSave=authMode==='credentials'?Boolean(username.trim()):authMode==='session'?Boolean(sessionSecret.trim()||editing?.hasSessionSecret):Boolean(username.trim()||sessionSecret.trim()||editing?.hasSessionSecret);

  async function loginManually(account:StreamingAccountPublic){
    setCheckingIds(current=>new Set(current).add(account.id));
    try{
      await onStartVerification(account.id,{proxySource:'none',deviceMode:'desktop',deviceProfile:'Desktop 1280x720'});
    }finally{setCheckingIds(current=>{const next=new Set(current);next.delete(account.id);return next;});}
  }
  async function checkSavedSession(account:StreamingAccountPublic){
    setSessionCheckingIds(current=>new Set(current).add(account.id));
    try{await onCheckSavedSession(account.id);}
    finally{setSessionCheckingIds(current=>{const next=new Set(current);next.delete(account.id);return next;});}
  }

  return <div className="streaming-accounts-page-layout">
    <section className="panel stream-card stream-account-editor">
      <div className="panel__header"><div><span className="section-kicker">{editing?'EDIT ACCOUNT':'ADD ACCOUNTS'}</span><h3>{editing?editing.label:'One setup, one or many platforms'}</h3><p className="stream-muted">Use only accounts you are authorized to use. Secrets stay local and encrypted. LOGIN MANUALLY opens the dedicated normal Chrome/Brave/Edge profile saved for that account; OrbitQA does not type your password into the streaming website. Imported sessions can be checked separately with CHECK SAVED SESSION. Account grouping is configured separately in Streaming Hub.</p></div>{editing?<button type="button" className="text-button" onClick={resetForm}>CANCEL EDIT</button>:null}</div>
      <div className="stream-account-platform-grid" aria-label="Streaming account platforms">
        {PLATFORMS.map(item=><label key={item.id} className={selectedPlatforms.includes(item.id)?'stream-account-platform-choice stream-account-platform-choice--selected':'stream-account-platform-choice'}><input type="checkbox" checked={selectedPlatforms.includes(item.id)} disabled={Boolean(editingId)&&item.id!==editing?.platform} onChange={()=>togglePlatform(item.id)}/><span>{item.label}</span></label>)}
      </div>
      <div className="stream-form-grid">
        <label className="field"><span>Account label</span><input value={label} onChange={e=>setLabel(e.target.value)} placeholder="Primary QA account" /></label>
        <label className="field"><span>Username / email</span><input value={username} onChange={e=>setUsername(e.target.value)} placeholder="tester@example.com" autoComplete="off" /></label>
        <label className="field"><span>Authentication</span><select value={authMode} onChange={e=>setAuthMode(e.target.value as StreamingAuthMode)}><option value="credentials">Manual browser login</option><option value="session">Imported cookie/session</option><option value="oauth">Existing authorized/OAuth session</option></select></label>
        <label className="field"><span>Password (optional; never auto-entered) {editing?.hasPassword?'(stored — leave blank to keep)':''}</span><input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="new-password" placeholder={editing?.hasPassword?'Stored password will be kept':'Stored locally using OS encryption'} /></label>
        <label className="field field--full"><span>Cookie / session {editing?.hasSessionSecret?'(stored — leave blank to keep)':'(optional)'}</span><textarea value={sessionSecret} onChange={e=>setSessionSecret(e.target.value)} placeholder="Paste authorized cookie JSON or a raw cookie string such as name=value; name2=value2" rows={3}/><small>Secrets are never displayed again or written to logs.</small></label>
        <label className="field"><span>Default proxy</span><select value={proxySource} onChange={e=>setProxySource(e.target.value as ProxySource)}>{proxyOptions.map(item=><option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <div className="field stream-account-add"><span>&nbsp;</span><button type="button" className="secondary-button" disabled={saving||!selectedPlatforms.length||!canSave} onClick={()=>void save()}>{saving?'SAVING…':editing?'SAVE CHANGES':`ADD TO ${selectedPlatforms.length} PLATFORM${selectedPlatforms.length===1?'':'S'}`}</button></div>
      </div>
    </section>

    <section className="panel stream-card stream-account-library">
      <div className="panel__header"><div><span className="section-kicker">ACCOUNTS</span><h3>Authorized sessions &amp; login health</h3><p className="stream-muted">Manage and verify each authorized account here. Choose groups and which accounts participate in a run from Streaming Hub.</p></div><div className="stream-account-library-counts"><span className="stream-stat-pill">{accounts.length} saved</span></div></div>
      <div className="stream-account-library-toolbar"><label className="field stream-account-search"><span>Search accounts</span><input aria-label="Search accounts" value={accountSearch} onChange={e=>setAccountSearch(e.target.value)} placeholder="Search accounts by label, email or platform" /></label></div>
      <div className="saved-album-filter-row" aria-label="Account platform filter"><button type="button" className={filter==='all'?'stream-filter-chip stream-filter-chip--active':'stream-filter-chip'} onClick={()=>setFilter('all')}>All platforms</button>{PLATFORMS.map(item=><button type="button" key={item.id} className={filter===item.id?'stream-filter-chip stream-filter-chip--active':'stream-filter-chip'} onClick={()=>setFilter(item.id)}>{item.label}</button>)}</div>
      {visible.length===0?<div className="empty-state">No accounts saved for this view.</div>:<div className="stream-account-card-grid">{visible.map(account=>{
        const pending=verificationSessions[account.id];
        return <article className="stream-account-card stream-account-card--compact" key={account.id}>
          <div className="stream-account-card__top"><span className={`stream-platform-tag stream-platform-tag--${account.platform}`}>{platformLabel(account.platform)}</span></div>
          <div className="stream-account-card__identity"><strong>{account.label}</strong><small>{account.username||'Session/cookie account'} · {account.authMode||'credentials'}</small></div>
          <div className="stream-account-health"><span className={`status-dot status-dot--${(account.status||'unverified') as any}`}>{String(account.status||'unverified').replace('-',' ')}</span><small>{account.lastVerifiedAt?`Last verified ${new Date(account.lastVerifiedAt).toLocaleString()}`:'Not verified yet'}</small>{account.lastVerificationReason?<p>{account.lastVerificationReason}</p>:null}{account.lastVerificationBrowser?<small>{account.lastVerificationBrowser} · {account.lastVerificationDeviceProfile||account.lastVerificationDeviceMode} · {proxyOptions.find(item=>item.id===account.lastVerificationProxySource)?.label||account.lastVerificationProxySource}</small>:null}<label className="field"><span>Default browser</span><select value={account.defaultBrowserRuntime||'chrome-installed'} onChange={e=>void             onSave({...account,username:account.username||'',authMode:account.authMode||'credentials',defaultBrowserRuntime:e.target.value as StreamingBrowserRuntime})}><option value="chrome-installed">Google Chrome</option><option value="brave-installed">Brave</option></select></label><small><strong>Sticky static proxy:</strong> {(()=>{const proxy=staticProxies.find(p=>p.id===account.staticProxyId);if(account.staticProxyMode==='manual')return proxy?`${proxy.observedIp||proxy.expectedStaticIp||proxy.hostname}:${proxy.port} · manual`:'Manual proxy unavailable';if(proxy)return `${proxy.observedIp||proxy.expectedStaticIp||proxy.hostname}:${proxy.port} · auto`;return 'Default / Auto allocation';})()}</small><button type="button" className="mini-button" onClick={()=>void openProxyAssignment(account)}>ASSIGN STICKY PROXY</button>{proxyAssignAccountId===account.id?<div className="account-proxy-picker"><label><span>Proxy assignment</span><select value={proxyAssignValue} onChange={e=>setProxyAssignValue(e.target.value)}><option value="auto">Default / Auto allocation</option>{availableStaticProxies.map(proxy=><option key={proxy.id} value={`manual:${proxy.id}`}>{stickyProxyLabel(proxy)}</option>)}</select></label><div><button type="button" className="mini-button" onClick={()=>void applyProxyAssignment(account.id)}>APPLY</button><button type="button" className="text-button" onClick={()=>setProxyAssignAccountId(null)}>CANCEL</button></div><small>Manual assignment can reuse the same static IP on multiple accounts.</small></div>:null}</div>

          <details className="stream-account-advanced">
            <summary>ACCOUNT / QA SETTINGS</summary>
            <div className="stream-account-network-grid">
              <label className="field stream-account-proxy"><span>Default QA proxy</span><select aria-label={`Proxy for ${account.label}`} value={account.proxySource||'none'} onChange={e=>void switchProxy(account,e.target.value as ProxySource)}>{proxyOptions.map(item=><option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
              <div className="field"><span>Manual login network</span><strong>Direct / No proxy</strong><small>Manual sign-in always reuses this account's dedicated normal desktop Chrome/Brave/Edge profile. If it was already verified, it opens the main signed-in account page. Your QA proxy applies later during QA runs.</small></div>
            </div>
          </details>

          {pending?<div className="stream-verification-confirm-card stream-mixed-device-field">
            <span>MANUAL LOGIN OPEN · ACCOUNT-SPECIFIC PROFILE</span>
            <div className="stream-mixed-device-card stream-mixed-device-card--selected">
              <div className="stream-verification-confirm-copy"><strong>{pending.browserLabel}</strong><small>{DEVICE_LABELS[pending.deviceMode]} · {pending.deviceProfile} · {proxyOptions.find(item=>item.id===pending.proxySource)?.label||pending.proxySource}</small><p>{pending.reason||'Check the browser and confirm this account is signed in.'}</p></div>
              <div className="stream-verification-confirm-actions"><button type="button" className="primary-button stream-verification-primary" onClick={()=>void onCompleteVerification(account.id)}>MARK VERIFIED</button><button type="button" className="text-button" onClick={()=>void onCancelVerification(account.id)}>CANCEL VERIFICATION</button></div>
            </div>
            <small>Complete the sign-in yourself in the normal browser. OrbitQA saves and reuses this dedicated account profile after you click MARK VERIFIED; it never auto-enters the website password.</small>
          </div>:<div className="stream-account-card__actions"><button type="button" className="text-button" onClick={()=>beginEdit(account)}>EDIT</button><button type="button" className="secondary-button" disabled={checkingIds.has(account.id)} onClick={()=>void loginManually(account)}>{checkingIds.has(account.id)?'OPENING NORMAL BROWSER…':'LOGIN MANUALLY'}</button>{account.hasSessionSecret?<button type="button" className="text-button" disabled={sessionCheckingIds.has(account.id)} onClick={()=>void checkSavedSession(account)}>{sessionCheckingIds.has(account.id)?'CHECKING SESSION…':'CHECK SAVED SESSION'}</button>:null}<button type="button" className="text-button" onClick={()=>void onRepairProfile(account.id)}>REPAIR PROFILE</button><button type="button" className="danger-button danger-button--compact" onClick={()=>void onDelete(account.id)}>DELETE</button></div>}
        </article>;
      })}</div>}
    </section>
  </div>;
}
