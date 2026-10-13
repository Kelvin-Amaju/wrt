const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
function defaultCodec(){return {encode:v=>Buffer.from(String(v),'utf8').toString('base64'),decode:v=>Buffer.from(String(v),'base64').toString('utf8')}};
function atomicWrite(file,payload){const tmp=`${file}.tmp`;fs.writeFileSync(tmp,JSON.stringify(payload,null,2),'utf8');fs.renameSync(tmp,file);}
function createSocialAccountStore({baseDir,secretCodec=defaultCodec()}={}){
  if(!baseDir)throw new Error('baseDir is required');
  const dir=path.join(baseDir,'social-accounts');fs.mkdirSync(dir,{recursive:true});
  const fileFor=id=>path.join(dir,`${id}.json`);
  function readRaw(id){const file=fileFor(String(id));if(!fs.existsSync(file))return null;try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
  function publicOf(raw){if(!raw)return null;const {sessionBlob,passwordBlob,...safe}=raw;return {...safe,hasSessionSecret:Boolean(raw.sessionBlob),hasPassword:Boolean(raw.passwordBlob)};}
  function list(){return fs.readdirSync(dir).filter(n=>n.endsWith('.json')).map(n=>{try{return publicOf(JSON.parse(fs.readFileSync(path.join(dir,n),'utf8')))}catch{return null;}}).filter(Boolean).sort((a,b)=>String(a.label).localeCompare(String(b.label)));}
  function get(id){return publicOf(readRaw(id));}
  function getInternal(id){const raw=readRaw(id);if(!raw)return null;return {...publicOf(raw),password:raw.passwordBlob?secretCodec.decode(raw.passwordBlob):'',sessionSecret:raw.sessionBlob?secretCodec.decode(raw.sessionBlob):''};}
  function save(input={}){
    const existing=input.id?readRaw(input.id):null;const now=new Date().toISOString();const id=String(input.id||randomUUID());
    const sessionChanged=Boolean(input.sessionSecret&&String(input.sessionSecret).trim());
    const passwordChanged=Boolean(input.password&&String(input.password).trim());
    const secretChanged=sessionChanged||passwordChanged;
    const raw={schemaVersion:1,id,platform:String(input.platform||existing?.platform||'youtube'),label:String(input.label||existing?.label||'Social QA account'),username:String(input.username??existing?.username??''),proxySource:String(input.proxySource||existing?.proxySource||'none'),staticProxyId:input.proxySource!==undefined&&String(input.proxySource)!=='static'?undefined:(input.staticProxyId!==undefined?(String(input.staticProxyId||'')||undefined):existing?.staticProxyId),staticProxyMode:input.proxySource!==undefined&&String(input.proxySource)!=='static'?undefined:(input.staticProxyMode!==undefined?(String(input.staticProxyMode)==='manual'?'manual':'auto'):(existing?.staticProxyMode||'auto')),defaultDeviceMode:String(input.defaultDeviceMode||existing?.defaultDeviceMode||'desktop'),defaultDeviceProfile:String(input.defaultDeviceProfile||existing?.defaultDeviceProfile||'Desktop 1280x720'),defaultBrowserRuntime:String(input.defaultBrowserRuntime||existing?.defaultBrowserRuntime||'chrome-installed'),createdAt:existing?.createdAt||now,updatedAt:now,status:secretChanged&&input.status===undefined?'unverified':String(input.status||existing?.status||'unverified'),lastVerifiedAt:secretChanged?undefined:(input.lastVerifiedAt||existing?.lastVerifiedAt),lastVerificationReason:secretChanged?'':String(input.lastVerificationReason??existing?.lastVerificationReason??''),lastVerificationBrowser:String(input.lastVerificationBrowser??existing?.lastVerificationBrowser??''),passwordBlob:passwordChanged?secretCodec.encode(String(input.password).trim()):existing?.passwordBlob,sessionBlob:sessionChanged?secretCodec.encode(String(input.sessionSecret).trim()):existing?.sessionBlob};
    atomicWrite(fileFor(id),raw);return publicOf(raw);
  }
  function del(id){const file=fileFor(String(id));if(fs.existsSync(file))fs.unlinkSync(file);return {id:String(id),deleted:true};}
  return {dir,list,get,getInternal,save,delete:del};
}
module.exports={createSocialAccountStore};
