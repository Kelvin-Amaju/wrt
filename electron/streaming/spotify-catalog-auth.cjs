const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const http=require('node:http');

function base64url(value){return Buffer.from(value).toString('base64').replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
function makePkce(randomBytes=crypto.randomBytes){const verifier=base64url(randomBytes(64)); const challenge=base64url(crypto.createHash('sha256').update(verifier).digest()); return {verifier,challenge};}
function atomicWrite(file,value){const tmp=`${file}.tmp`; fs.writeFileSync(tmp,JSON.stringify(value,null,2),'utf8'); fs.renameSync(tmp,file);}
function defaultCodec(){return {encode:v=>Buffer.from(String(v),'utf8').toString('base64'),decode:v=>Buffer.from(String(v),'base64').toString('utf8')}};

function createSpotifyCatalogAuth({baseDir,secretCodec=defaultCodec(),openExternal=async()=>{},fetchImpl=global.fetch,now=()=>new Date(),randomBytes=crypto.randomBytes,oauthCallbackProvider}={}){
  if(!baseDir) throw new Error('baseDir is required');
  if(typeof fetchImpl!=='function') throw new Error('fetch implementation is required');
  const dir=path.join(baseDir,'streaming-catalog'); fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'spotify.json');
  const read=()=>{try{return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};}catch{return {};}};
  const write=record=>atomicWrite(file,record);
  const publicStatus=()=>{const r=read(); return {configured:Boolean(r.clientId),connected:Boolean(r.accessTokenBlob&&r.refreshTokenBlob),...(r.clientId?{clientId:r.clientId}:{}),...(r.expiresAt?{expiresAt:r.expiresAt}:{}),...(r.accountLabel?{accountLabel:r.accountLabel}:{})};};
  function configureClientId(clientId){const clean=String(clientId||'').trim(); if(!clean) throw new Error('Spotify Client ID is required'); const r=read(); write({...r,clientId:clean,updatedAt:now().toISOString()}); return publicStatus();}
  async function tokenRequest(params){const response=await fetchImpl('https://accounts.spotify.com/api/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params).toString()}); if(!response?.ok) throw new Error(`Spotify token exchange failed (${response?.status||'network'})`); const json=await response.json(); if(!json?.access_token) throw new Error('Spotify token exchange returned no access token'); return json;}
  async function builtinCallback({clientId,state,challenge,verifier,timeoutMs}){
    return await new Promise((resolve,reject)=>{
      const server=http.createServer((req,res)=>{
        try{
          const u=new URL(req.url||'/','http://127.0.0.1');
          if(u.pathname!=='/callback'){res.statusCode=404; res.end('Not found'); return;}
          const code=u.searchParams.get('code'); const returnedState=u.searchParams.get('state'); const error=u.searchParams.get('error');
          res.statusCode=200; res.setHeader('content-type','text/plain; charset=utf-8'); res.end(error?'OrbitQA Spotify connection failed. You may close this window.':'OrbitQA Spotify Catalog connected. You may close this window.');
          clearTimeout(timer); server.close();
          if(error) reject(new Error(`Spotify authorization failed: ${error}`)); else resolve({code, state:returnedState});
        }catch(err){clearTimeout(timer); server.close(); reject(err);}
      });
      const timer=setTimeout(()=>{server.close(); reject(new Error('Spotify authorization timed out'));},timeoutMs);
      server.listen(0,'127.0.0.1',async()=>{
        const address=server.address(); const port=typeof address==='object'&&address?address.port:0;
        const redirectUri=`http://127.0.0.1:${port}/callback`;
        const authorizationUrl=new URL('https://accounts.spotify.com/authorize');
        authorizationUrl.search=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:redirectUri,code_challenge_method:'S256',code_challenge:challenge,state,scope:'user-read-private'}).toString();
        try{await openExternal(authorizationUrl.toString());}catch(err){clearTimeout(timer); server.close(); reject(err);}
      });
    });
  }
  async function connect({timeoutMs=120000}={}){
    const r=read(); if(!r.clientId) throw new Error('Configure Spotify Client ID before connecting');
    const {verifier,challenge}=makePkce(randomBytes); const state=base64url(randomBytes(24));
    let callback; let redirectUri;
    if(oauthCallbackProvider){
      redirectUri='http://127.0.0.1/callback';
      const authorizationUrl=new URL('https://accounts.spotify.com/authorize');
      authorizationUrl.search=new URLSearchParams({client_id:r.clientId,response_type:'code',redirect_uri:redirectUri,code_challenge_method:'S256',code_challenge:challenge,state,scope:'user-read-private'}).toString();
      callback=await oauthCallbackProvider({authorizationUrl:authorizationUrl.toString(),state,redirectUri,verifier,challenge,timeoutMs});
    }else{
      // Create a one-shot loopback server here so the exact ephemeral redirect URI is used for exchange.
      callback=await new Promise((resolve,reject)=>{
        const server=http.createServer((req,res)=>{
          try{const u=new URL(req.url||'/','http://127.0.0.1'); if(u.pathname!=='/callback'){res.statusCode=404;res.end('Not found');return;} const code=u.searchParams.get('code'); const returnedState=u.searchParams.get('state'); const error=u.searchParams.get('error'); res.statusCode=200; res.setHeader('content-type','text/plain; charset=utf-8'); res.end(error?'OrbitQA Spotify connection failed. You may close this window.':'OrbitQA Spotify Catalog connected. You may close this window.'); clearTimeout(timer); server.close(); if(error) reject(new Error(`Spotify authorization failed: ${error}`)); else resolve({code,state:returnedState});}catch(err){clearTimeout(timer);server.close();reject(err);}
        });
        const timer=setTimeout(()=>{server.close(); reject(new Error('Spotify authorization timed out'));},timeoutMs);
        server.listen(0,'127.0.0.1',async()=>{
          const address=server.address(); const port=typeof address==='object'&&address?address.port:0; redirectUri=`http://127.0.0.1:${port}/callback`;
          const authorizationUrl=new URL('https://accounts.spotify.com/authorize'); authorizationUrl.search=new URLSearchParams({client_id:r.clientId,response_type:'code',redirect_uri:redirectUri,code_challenge_method:'S256',code_challenge:challenge,state,scope:'user-read-private'}).toString();
          try{await openExternal(authorizationUrl.toString());}catch(err){clearTimeout(timer);server.close();reject(err);}
        });
      });
    }
    if(!callback?.code) throw new Error('Spotify authorization returned no code');
    if(callback.state!==state) throw new Error('Spotify authorization state mismatch');
    const token=await tokenRequest({grant_type:'authorization_code',code:callback.code,redirect_uri:redirectUri,client_id:r.clientId,code_verifier:verifier});
    const expiresAt=new Date(now().getTime()+Math.max(1,Number(token.expires_in)||3600)*1000).toISOString();
    write({...r,accessTokenBlob:secretCodec.encode(token.access_token),refreshTokenBlob:token.refresh_token?secretCodec.encode(token.refresh_token):r.refreshTokenBlob,expiresAt,updatedAt:now().toISOString()});
    return publicStatus();
  }
  async function refreshToken(r){if(!r.refreshTokenBlob) throw new Error('Spotify Catalog is not connected'); const refresh=secretCodec.decode(r.refreshTokenBlob); const token=await tokenRequest({grant_type:'refresh_token',refresh_token:refresh,client_id:r.clientId}); const expiresAt=new Date(now().getTime()+Math.max(1,Number(token.expires_in)||3600)*1000).toISOString(); const next={...r,accessTokenBlob:secretCodec.encode(token.access_token),refreshTokenBlob:token.refresh_token?secretCodec.encode(token.refresh_token):r.refreshTokenBlob,expiresAt,updatedAt:now().toISOString()}; write(next); return next;}
  async function getValidAccessToken(){let r=read(); if(!r.accessTokenBlob) throw new Error('Spotify Catalog is not connected'); const expires=Date.parse(r.expiresAt||''); if(!Number.isFinite(expires)||expires-now().getTime()<=30_000) r=await refreshToken(r); return secretCodec.decode(r.accessTokenBlob);}
  function disconnect(){const r=read(); const next={clientId:r.clientId,updatedAt:now().toISOString()}; write(next); return publicStatus();}
  return {dir,file,getPublicStatus:publicStatus,configureClientId,connect,getValidAccessToken,disconnect};
}

module.exports={createSpotifyCatalogAuth,makePkce};
