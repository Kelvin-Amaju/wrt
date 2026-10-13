import { useEffect, useMemo, useState } from 'react';
import type { QaCookieRecord } from '../shared/cookies';

export function CookieManager(){
  const [rows,setRows]=useState<QaCookieRecord[]>([]);
  const [jsonDraft,setJsonDraft]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [filter,setFilter]=useState('');
  const refresh=async()=>{try{setRows(await window.orbitqa?.listQaCookies?.()||[]);setError('')}catch(e){setError(e instanceof Error?e.message:String(e))}};
  useEffect(()=>{void refresh()},[]);
  const visible=useMemo(()=>{const q=filter.trim().toLowerCase();return q?rows.filter(r=>[r.label,r.name,r.domain].some(x=>x.toLowerCase().includes(q))):rows},[rows,filter]);
  const importJson=async()=>{setError('');setNotice('');try{
    if(!window.orbitqa?.importQaCookiesJson)throw new Error('Cookie Manager JSON import bridge is unavailable');
    if(!jsonDraft.trim())throw new Error('Paste cookie JSON first');
    const result=await window.orbitqa.importQaCookiesJson(jsonDraft);
    setJsonDraft('');
    setNotice(`Imported ${result.imported} cookie${result.imported===1?'':'s'}${result.skipped?` · ${result.skipped} skipped`:''}.`);
    await refresh();
  }catch(e){setError(e instanceof Error?e.message:String(e))}};
  const remove=async(id:string)=>{await window.orbitqa?.deleteQaCookies?.([id]);await refresh()};
  const toggle=async(r:QaCookieRecord)=>{await window.orbitqa?.setQaCookiesEnabled?.([r.id],!r.enabled);await refresh()};
  return <div className="page-stack cookie-manager-page">
    <section className="panel"><div className="section-heading"><div><span className="section-kicker">COOKIE JSON POOL</span><h2>Cookie Manager</h2><p>Paste browser cookie JSON here. OrbitQA stores the cookies in the Cookie Manager pool and can preload a random enabled, non-expired saved cookie before a Run regardless of the target website. Browser domain rules still apply to the cookie itself.</p></div></div>{error&&<p className="editor-message editor-message--warning">{error}</p>}{notice&&<p className="editor-message">{notice}</p>}
      <label className="field field--full"><span>Cookie JSON</span><textarea aria-label="Cookie JSON" rows={12} value={jsonDraft} onChange={e=>setJsonDraft(e.target.value)} placeholder={'Paste a JSON cookie object, an array of cookies, or an object containing a cookies array.\n\nExample:\n[{"name":"qa_variant","value":"A","domain":"example.com","path":"/","secure":true,"sameSite":"Lax","expirationDate":1893456000}]'} /></label>
      <div className="button-row"><button className="primary-button" onClick={()=>void importJson()}>IMPORT JSON COOKIES</button></div>
      <p className="editor-message">Common browser-export fields are accepted, including <code>name</code>, <code>value</code>, <code>domain</code>, <code>path</code>, <code>secure</code>, <code>sameSite</code>, <code>expirationDate</code> or <code>expires</code>. Expired cookies are removed automatically and are never selected for a Run.</p>
    </section>
    <section className="panel"><div className="section-heading"><div><span className="section-kicker">SAVED COOKIE POOL</span><h3>{rows.length} saved cookie{rows.length===1?'':'s'}</h3></div><input aria-label="Filter cookies" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filter by label, name or domain"/></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Status</th><th>Label</th><th>Domain</th><th>Name</th><th>Value</th><th>SameSite</th><th>Expires</th><th>Last used</th><th>Actions</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}><td><span className={`cookie-health cookie-health--${r.status||(!r.enabled?'disabled':'active')}`}>{r.status==='expired'?'EXPIRED':r.enabled?'ACTIVE':'DISABLED'}</span></td><td>{r.label}</td><td>{r.domain}</td><td>{r.name}</td><td>{r.valueMasked}</td><td>{r.sameSite}{r.secure?' · Secure':''}</td><td>{r.expires?new Date(r.expires*1000).toLocaleString():'Session'}</td><td>{r.lastUsedAt?new Date(r.lastUsedAt).toLocaleString():'Never'}</td><td><div className="button-row"><button className="mini-button" onClick={()=>void toggle(r)}>{r.enabled?'DISABLE':'ENABLE'}</button><button className="mini-button" onClick={()=>void remove(r.id)}>DELETE</button></div></td></tr>)}</tbody></table>{!visible.length&&<div className="empty-state">No saved cookies match this view.</div>}</div>
    </section>
  </div>;
}
