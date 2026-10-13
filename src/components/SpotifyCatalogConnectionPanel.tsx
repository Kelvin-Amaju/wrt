import { useEffect, useState } from 'react';
import type { SpotifyCatalogConnectionStatus } from '../shared/streaming';

export function SpotifyCatalogConnectionPanel({status,busy=false,onConnect,onDisconnect}:{status:SpotifyCatalogConnectionStatus;busy?:boolean;onConnect:(clientId:string)=>void;onDisconnect:()=>void}){
  const [clientId,setClientId]=useState(status.clientId||'');
  useEffect(()=>{if(status.clientId) setClientId(status.clientId);},[status.clientId]);
  return <section className="panel stream-card spotify-catalog-connection">
    <div className="panel__header"><div><span className="section-kicker">SPOTIFY CATALOG</span><h3>Complete catalog connection</h3></div><span className={status.connected?'stream-status stream-status--ok':'stream-status'}>{status.connected?'CONNECTED':'NOT CONNECTED'}</span></div>
    {status.connected ? <div className="spotify-connection-ready"><div><strong>{status.accountLabel||'Spotify Catalog connected'}</strong><small>{status.expiresAt?`Token refresh managed securely · ${new Date(status.expiresAt).toLocaleString()}`:'OAuth PKCE connection active'}</small></div><div className="stream-inline-actions"><button type="button" className="secondary-button" disabled={busy} onClick={()=>onConnect(status.clientId||clientId)}>Reconnect</button><button type="button" className="text-button" disabled={busy} onClick={onDisconnect}>Disconnect</button></div></div> : <div className="spotify-connection-setup"><label className="field field--full"><span>Spotify application Client ID</span><input value={clientId} onChange={e=>setClientId(e.target.value)} placeholder="Paste your Spotify Client ID" /></label><button type="button" className="primary-button" disabled={busy||!clientId.trim()} onClick={()=>onConnect(clientId.trim())}>{busy?'CONNECTING…':'Connect Spotify Catalog'}</button><p>Before connecting, register <code>http://127.0.0.1/callback</code> as a Spotify Redirect URI. OrbitQA uses a temporary dynamic loopback port during PKCE. Catalog tokens stay in the Electron main process and are never returned to this page.</p></div>}
  </section>;
}
