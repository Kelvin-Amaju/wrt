const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
function atomicWrite(file,payload){const tmp=`${file}.tmp`;fs.writeFileSync(tmp,JSON.stringify(payload,null,2),'utf8');fs.renameSync(tmp,file);}
function uniqueStrings(values){return [...new Set((Array.isArray(values)?values:[]).map(v=>String(v||'').trim()).filter(Boolean))];}
function createSocialGroupStore({baseDir}={}){
  if(!baseDir)throw new Error('baseDir is required');
  const dir=path.join(baseDir,'social-hub');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'groups.json');
  function read(){if(!fs.existsSync(file))return [];try{const value=JSON.parse(fs.readFileSync(file,'utf8'));return Array.isArray(value)?value:[];}catch{return [];}}
  function write(items){atomicWrite(file,items);return items;}
  function list(){return read().sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0)||String(a.name).localeCompare(String(b.name)));}
  function save(input={}){
    const items=read();const now=new Date().toISOString();const id=String(input.id||randomUUID());const index=items.findIndex(x=>x.id===id);const existing=index>=0?items[index]:null;
    const targetMode=['all','count','specific'].includes(String(input.targetMode))?String(input.targetMode):String(existing?.targetMode||'specific');
    const minSeconds=Math.max(1,Math.floor(Number(input.mediaObservationMinSeconds??existing?.mediaObservationMinSeconds??60)||60));
    const maxSeconds=Math.max(minSeconds,Math.floor(Number(input.mediaObservationMaxSeconds??existing?.mediaObservationMaxSeconds??100)||100));
    const item={schemaVersion:2,id,name:String(input.name||existing?.name||`Group ${items.length+1}`).trim()||`Group ${items.length+1}`,platform:String(input.platform||existing?.platform||'youtube'),order:Math.max(1,Math.floor(Number(input.order??existing?.order??items.length+1)||1)),accountIds:uniqueStrings(input.accountIds??existing?.accountIds),targetIds:uniqueStrings(input.targetIds??existing?.targetIds),targetMode,targetCount:Math.max(1,Math.floor(Number(input.targetCount??existing?.targetCount??1)||1)),checks:uniqueStrings(input.checks??existing?.checks),mediaObservationMinSeconds:minSeconds,mediaObservationMaxSeconds:maxSeconds,restAndReplay:Boolean(input.restAndReplay??existing?.restAndReplay),browserRuntime:['chrome-installed','brave-installed'].includes(String(input.browserRuntime??existing?.browserRuntime))?String(input.browserRuntime??existing?.browserRuntime):'chrome-installed',deviceMode:['android','ios'].includes(String(input.deviceMode??existing?.deviceMode))?String(input.deviceMode??existing?.deviceMode):'desktop',deviceProfile:String(input.deviceProfile??existing?.deviceProfile??'Desktop 1280x720'),commentDraft:String(input.commentDraft??existing?.commentDraft??'').slice(0,1200),contentIntelligence:(input.contentIntelligence??existing?.contentIntelligence) ? {...(input.contentIntelligence??existing?.contentIntelligence)} : undefined,createdAt:existing?.createdAt||now,updatedAt:now};
    if(index>=0)items[index]=item;else items.push(item);write(items);return item;
  }
  function del(id){const items=read();const next=items.filter(x=>x.id!==String(id));write(next);return {id:String(id),deleted:next.length!==items.length};}
  function get(id){return read().find(x=>x.id===String(id))||null;}
  return {list,get,save,delete:del};
}
module.exports={createSocialGroupStore};
