const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const AUTH_NAME_RE=/(session|sessid|jsessionid|auth|token|jwt|bearer|oauth|login|credential|access[_-]?token|refresh[_-]?token|remember|logged[_-]?in|sid|ssid|cf_clearance|asp\.net.*session)/i;
function normalizeDomain(value){return String(value||'').trim().toLowerCase().replace(/^https?:\/\//,'').split('/')[0].replace(/^\./,'');}
function mask(value){const s=String(value||''); if(!s)return ''; if(s.length<=6)return '••••••'; return `${s.slice(0,2)}••••${s.slice(-2)}`;}
function isSensitiveName(name){const n=String(name||'').trim();return /^__host-|^__secure-/i.test(n)||AUTH_NAME_RE.test(n);}
function domainMatches(host,domain){host=String(host||'').toLowerCase();domain=normalizeDomain(domain);return Boolean(domain&&(host===domain||host.endsWith(`.${domain}`)));}

function normalizeSameSite(value){
  const text=String(value||'').trim().toLowerCase();
  if(text==='strict')return 'Strict';
  if(text==='none'||text==='no_restriction'||text==='no restriction')return 'None';
  return 'Lax';
}
function normalizeExpires(value){
  if(value===undefined||value===null||value==='')return undefined;
  const numeric=Number(value);
  if(Number.isFinite(numeric))return numeric>1e12?numeric/1000:numeric;
  const parsed=Date.parse(String(value));
  return Number.isFinite(parsed)?parsed/1000:undefined;
}
function cookieDraftsFromJson(input){
  let parsed;
  try{parsed=typeof input==='string'?JSON.parse(input):input}catch{throw new Error('Cookie JSON is invalid')}
  const source=Array.isArray(parsed)?parsed:Array.isArray(parsed?.cookies)?parsed.cookies:(parsed&&typeof parsed==='object'?[parsed]:[]);
  if(!source.length)throw new Error('Cookie JSON must contain a cookie object, an array of cookies, or an object with a cookies array');
  return source.map((row,index)=>{
    const domain=normalizeDomain(row?.domain||row?.host||row?.url);
    return {
      label:String(row?.label||row?.name||`Cookie ${index+1}`),
      name:String(row?.name||''),
      value:String(row?.value??''),
      domain,
      path:String(row?.path||'/'),
      secure:row?.secure===true,
      sameSite:normalizeSameSite(row?.sameSite||row?.same_site),
      expires:normalizeExpires(row?.expirationDate??row?.expires??row?.expiry),
      enabled:row?.enabled!==false,
    };
  });
}

function createCookieStore({userDataPath,safeStorage}){
  const file=path.join(userDataPath,'qa-cookies.json');
  const cycles=new Map();
  const read=()=>{try{const data=JSON.parse(fs.readFileSync(file,'utf8'));return Array.isArray(data)?data:[]}catch{return[]}};
  const write=(rows)=>{fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp`;fs.writeFileSync(tmp,JSON.stringify(rows,null,2));fs.renameSync(tmp,file);};
  const enc=(v)=>safeStorage?.isEncryptionAvailable?.()?safeStorage.encryptString(String(v)).toString('base64'):Buffer.from(String(v),'utf8').toString('base64');
  const dec=(v)=>safeStorage?.isEncryptionAvailable?.()?safeStorage.decryptString(Buffer.from(String(v),'base64')):Buffer.from(String(v),'base64').toString('utf8');
  const nowSeconds=()=>Date.now()/1000;
  const isExpired=(r,now=nowSeconds())=>Number.isFinite(Number(r?.expires))&&Number(r.expires)>0&&Number(r.expires)<=now;
  const publicRow=(r)=>({id:r.id,label:r.label,name:r.name,valueMasked:mask(dec(r.valueEnc||'')),domain:r.domain,path:r.path||'/',secure:r.secure===true,sameSite:r.sameSite||'Lax',expires:r.expires,enabled:r.enabled!==false,status:isExpired(r)?'expired':(r.enabled===false?'disabled':'active'),createdAt:r.createdAt,lastUsedAt:r.lastUsedAt});
  const pruneExpired=()=>{const rows=read();const now=nowSeconds();const next=rows.filter(r=>!isExpired(r,now));const deleted=rows.length-next.length;if(deleted){write(next);cycles.clear();}return {rows:next,deleted};};
  const validate=(draft)=>{
    const name=String(draft?.name||'').trim(); const value=String(draft?.value||''); const domain=normalizeDomain(draft?.domain);
    if(!name||!value||!domain)throw new Error('Cookie name, value, and domain are required');
    if(isSensitiveName(name))throw new Error('Authentication/session cookies are not allowed in Cookie Manager. Use the account/profile system for signed-in sessions.');
    if(name.length>256||value.length>4096)throw new Error('Cookie is too large');
    if(!/^[a-z0-9.-]+$/i.test(domain)||!domain.includes('.'))throw new Error('Enter a valid cookie domain such as example.com');
    const sameSite=['Lax','Strict','None'].includes(draft.sameSite)?draft.sameSite:'Lax';
    const secure=draft.secure===true||sameSite==='None';
    return {name,value,domain,path:String(draft.path||'/').startsWith('/')?String(draft.path||'/'):'/',secure,sameSite,expires:Number.isFinite(Number(draft.expires))?Number(draft.expires):undefined};
  };
  pruneExpired();
  return {
    list(){return pruneExpired().rows.map(publicRow)},
    add(draft){const v=validate(draft);const rows=pruneExpired().rows;const now=new Date().toISOString();const row={id:`cookie-${crypto.randomUUID()}`,label:String(draft.label||v.name).trim().slice(0,120)||v.name,name:v.name,valueEnc:enc(v.value),domain:v.domain,path:v.path,secure:v.secure,sameSite:v.sameSite,expires:v.expires,enabled:draft.enabled!==false,createdAt:now};rows.push(row);write(rows);cycles.clear();return publicRow(row)},
    importJson(input){const drafts=cookieDraftsFromJson(input);const rows=pruneExpired().rows;const now=new Date().toISOString();let imported=0;let skipped=0;const errors=[];for(const draft of drafts){try{const v=validate(draft);if(isExpired(v)){skipped+=1;continue;}const row={id:`cookie-${crypto.randomUUID()}`,label:String(draft.label||v.name).trim().slice(0,120)||v.name,name:v.name,valueEnc:enc(v.value),domain:v.domain,path:v.path,secure:v.secure,sameSite:v.sameSite,expires:v.expires,enabled:draft.enabled!==false,createdAt:now};rows.push(row);imported+=1;}catch(error){skipped+=1;errors.push(String(error?.message||error));}}if(imported)write(rows);cycles.clear();if(!imported&&errors.length)throw new Error(`No cookies imported. ${errors[0]}`);return {imported,skipped,total:drafts.length,errors:errors.slice(0,5)}},
    remove(ids){const set=new Set((ids||[]).map(String));const rows=pruneExpired().rows;const next=rows.filter(r=>!set.has(r.id));write(next);cycles.clear();return {deleted:rows.length-next.length}},
    setEnabled(ids,enabled){const set=new Set((ids||[]).map(String));const rows=pruneExpired().rows.map(r=>set.has(r.id)?{...r,enabled:enabled===true}:r);write(rows);cycles.clear();return rows.map(publicRow)},
    pickAny(random=Math.random){const rows=pruneExpired().rows.filter(r=>r.enabled!==false);if(!rows.length)return null;const key='__global__';let bag=cycles.get(key)||[];const eligibleIds=new Set(rows.map(r=>r.id));bag=bag.filter(id=>eligibleIds.has(id));if(!bag.length){bag=rows.map(r=>r.id);for(let i=bag.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}}const id=bag.shift();cycles.set(key,bag);const row=rows.find(r=>r.id===id)||rows[0];const all=read();const idx=all.findIndex(r=>r.id===row.id);if(idx>=0){all[idx]={...all[idx],lastUsedAt:new Date().toISOString()};write(all);}return {id:row.id,label:row.label,cookie:{name:row.name,value:dec(row.valueEnc||''),domain:row.domain,path:row.path||'/',secure:row.secure===true,sameSite:row.sameSite||'Lax',...(row.expires?{expires:row.expires}:{})}};},
    pickForUrl(targetUrl,random=Math.random){let url;try{url=new URL(String(targetUrl))}catch{return null}const host=url.hostname.toLowerCase();const rows=pruneExpired().rows.filter(r=>r.enabled!==false&&domainMatches(host,r.domain));if(!rows.length)return null;const key=`host:${host}`;let bag=cycles.get(key)||[];const eligibleIds=new Set(rows.map(r=>r.id));bag=bag.filter(id=>eligibleIds.has(id));if(!bag.length){bag=rows.map(r=>r.id);for(let i=bag.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}}const id=bag.shift();cycles.set(key,bag);const row=rows.find(r=>r.id===id)||rows[0];const all=read();const idx=all.findIndex(r=>r.id===row.id);if(idx>=0){all[idx]={...all[idx],lastUsedAt:new Date().toISOString()};write(all);}return {id:row.id,label:row.label,cookie:{name:row.name,value:dec(row.valueEnc||''),domain:row.domain,path:row.path||'/',secure:row.secure===true,sameSite:row.sameSite||'Lax',...(row.expires?{expires:row.expires}:{})}};},
    pruneExpired(){return pruneExpired().deleted},
    _test:{isSensitiveName,domainMatches,isExpired,cookieDraftsFromJson,normalizeExpires,normalizeSameSite}
  };
}
module.exports={createCookieStore};
