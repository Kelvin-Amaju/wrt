const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {detectSocialPlatform}=require('./platforms.cjs');
function atomicWrite(file,payload){const tmp=`${file}.tmp`;fs.writeFileSync(tmp,JSON.stringify(payload,null,2),'utf8');fs.renameSync(tmp,file);}
function normalizeUrl(value){const raw=String(value||'').trim();if(!raw)return '';try{const u=new URL(raw);u.hash='';return u.toString();}catch{return '';}}

function classifySocialTarget(url,platform){
  let pathname='';let search='';try{const u=new URL(url);pathname=u.pathname.toLowerCase();search=u.search.toLowerCase();}catch{return 'unknown';}
  if(platform==='youtube'){if(pathname==='/watch'&&search.includes('v='))return 'video';if(pathname.startsWith('/shorts/'))return 'video';if(pathname.startsWith('/@')||pathname.startsWith('/channel/')||pathname.startsWith('/c/')||pathname.startsWith('/user/'))return 'channel';return 'page';}
  if(platform==='facebook'){if(pathname.includes('/reel/')||pathname.includes('/videos/')||pathname==='/watch/')return 'video';if(pathname.includes('/posts/')||pathname.includes('/permalink.php'))return 'post';return 'page/profile';}
  if(platform==='instagram'){if(pathname.startsWith('/reel/'))return 'reel';if(pathname.startsWith('/p/'))return 'post';return 'profile';}
  if(platform==='x'){return pathname.includes('/status/')?'post':'profile';}
  if(platform==='pinterest'){return pathname.includes('/pin/')?'pin':'profile';}
  if(platform==='tiktok'){return pathname.includes('/video/')?'video':'profile';}
  if(platform==='linkedin'){return pathname.includes('/posts/')?'post':pathname.includes('/company/')?'page':'profile';}
  if(platform==='reddit'){return pathname.includes('/comments/')?'post':pathname.startsWith('/r/')?'community':pathname.startsWith('/user/')?'profile':'page';}
  return 'unknown';
}
function createSocialTargetStore({baseDir}={}){
  if(!baseDir)throw new Error('baseDir is required');const dir=path.join(baseDir,'social-hub');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'targets.json');
  function read(){if(!fs.existsSync(file))return [];try{const v=JSON.parse(fs.readFileSync(file,'utf8'));return Array.isArray(v)?v:[];}catch{return [];}}
  function write(items){atomicWrite(file,items);return items;}
  function list(){return read().sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));}
  function addMany(inputs=[]){const items=read();const byUrl=new Map(items.map(x=>[normalizeUrl(x.url),x]));const added=[];const duplicates=[];const invalid=[];const now=new Date().toISOString();
    for(const value of inputs){const url=normalizeUrl(value);if(!url){invalid.push(String(value||''));continue;}const platform=detectSocialPlatform(url);if(!platform){invalid.push(url);continue;}if(byUrl.has(url)){duplicates.push(url);continue;}const targetType=classifySocialTarget(url,platform);const item={schemaVersion:2,id:randomUUID(),platform,url,canonicalUrl:url,label:'',targetType,creatorName:'',creatorUrl:['channel','profile','page','page/profile','community'].includes(targetType)?url:'',title:'',resolutionStatus:'pending',resolutionReason:'Waiting for metadata lookup',resolvedAt:'',createdAt:now,updatedAt:now};items.push(item);byUrl.set(url,item);added.push(item);}
    write(items);return {added,duplicates,invalid};
  }
  function update(id,patch={}){const items=read();const index=items.findIndex(x=>x.id===String(id));if(index<0)throw new Error('Social target not found');items[index]={...items[index],...patch,id:items[index].id,url:items[index].url,updatedAt:new Date().toISOString()};write(items);return items[index];}
  function del(id){const items=read();const next=items.filter(x=>x.id!==String(id));write(next);return {id:String(id),deleted:next.length!==items.length};}
  function get(id){return read().find(x=>x.id===String(id))||null;}
  return {list,addMany,update,delete:del,get};
}
module.exports={createSocialTargetStore,normalizeUrl,classifySocialTarget};
