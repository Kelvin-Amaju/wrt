const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {sanitizeStreamingAccount}=require('./secret-sanitizer.cjs');

function defaultCodec(){return {encode:v=>Buffer.from(String(v),'utf8').toString('base64'),decode:v=>Buffer.from(String(v),'base64').toString('utf8')}};
function atomicWrite(file,payload){const tmp=`${file}.tmp`;fs.writeFileSync(tmp,JSON.stringify(payload,null,2),'utf8');fs.renameSync(tmp,file);}
function keepString(input,existing,key){return input[key]!==undefined?String(input[key]||''):String(existing?.[key]||'');}

function createStreamingAccountStore({baseDir,secretCodec=defaultCodec()}){
  if(!baseDir) throw new Error('baseDir is required');
  const dir=path.join(baseDir,'streaming-accounts');
  fs.mkdirSync(dir,{recursive:true});
  const fileFor=id=>path.join(dir,`${id}.json`);

  function readRaw(id){const file=fileFor(String(id));if(!fs.existsSync(file))return null;try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
  function publicOf(raw){if(!raw)return null;return sanitizeStreamingAccount({...raw,hasPassword:Boolean(raw.passwordBlob),hasSessionSecret:Boolean(raw.sessionBlob)});}
  function list(){return fs.readdirSync(dir).filter(name=>name.endsWith('.json')).map(name=>{try{return publicOf(JSON.parse(fs.readFileSync(path.join(dir,name),'utf8')))}catch{return null;}}).filter(Boolean).sort((a,b)=>String(a.label).localeCompare(String(b.label)));}
  function get(id){return publicOf(readRaw(id));}
  function getInternal(id){const raw=readRaw(id);if(!raw)return null;return {...publicOf(raw),password:raw.passwordBlob?secretCodec.decode(raw.passwordBlob):'',sessionSecret:raw.sessionBlob?secretCodec.decode(raw.sessionBlob):''};}
  function save(input={}){
    const existing=input.id?readRaw(input.id):null;
    const now=new Date().toISOString();
    const id=String(input.id||randomUUID());
    const authMode=['session','oauth','credentials'].includes(String(input.authMode||existing?.authMode))?String(input.authMode||existing?.authMode):((input.sessionSecret||existing?.sessionBlob)?'session':'credentials');
    const secretChanged=Boolean(existing&&(input.password||input.sessionSecret||input.cookies||input.token));
    const resetVerification=secretChanged&&input.status===undefined;
    const raw={
      schemaVersion:1,
      id,
      platform:String(input.platform||existing?.platform||'spotify'),
      label:String(input.label||existing?.label||'Streaming account'),
      username:String(input.username??existing?.username??''),
      authMode,
      proxySource:String(input.proxySource||existing?.proxySource||'none'),
      defaultBrowserRuntime:String(input.defaultBrowserRuntime||existing?.defaultBrowserRuntime||'chrome-installed'),
      proxyId:input.proxyId??existing?.proxyId,
      staticProxyId: input.proxySource!==undefined&&String(input.proxySource)!=='static' ? undefined : (input.staticProxyId!==undefined ? (String(input.staticProxyId||'')||undefined) : existing?.staticProxyId),
      staticProxyMode: input.proxySource!==undefined&&String(input.proxySource)!=='static' ? undefined : (input.staticProxyMode!==undefined ? (String(input.staticProxyMode)==='manual'?'manual':'auto') : (existing?.staticProxyMode||'auto')),
      qaGroup:String(input.qaGroup??existing?.qaGroup??'Group 1').trim()||'Group 1',
      createdAt:existing?.createdAt||now,
      updatedAt:now,
      status:resetVerification?'unverified':(input.status||existing?.status||'unverified'),
      lastVerifiedAt:resetVerification?undefined:(input.lastVerifiedAt||existing?.lastVerifiedAt),
      lastVerificationReason:resetVerification?'':keepString(input,existing,'lastVerificationReason'),
      lastVerificationBrowser:resetVerification?'':keepString(input,existing,'lastVerificationBrowser'),
      lastVerificationDeviceMode:resetVerification?'':keepString(input,existing,'lastVerificationDeviceMode'),
      lastVerificationDeviceProfile:resetVerification?'':keepString(input,existing,'lastVerificationDeviceProfile'),
      lastVerificationProxySource:resetVerification?'':keepString(input,existing,'lastVerificationProxySource'),
      passwordBlob:input.password?secretCodec.encode(input.password):existing?.passwordBlob,
      sessionBlob:(input.sessionSecret||input.cookies||input.token)?secretCodec.encode(input.sessionSecret||input.cookies||input.token):existing?.sessionBlob,
    };
    atomicWrite(fileFor(id),raw);
    return publicOf(raw);
  }
  function del(id){const file=fileFor(String(id));if(fs.existsSync(file))fs.unlinkSync(file);return {id:String(id),deleted:true};}
  return {dir,list,get,getInternal,save,delete:del};
}

module.exports={createStreamingAccountStore};
