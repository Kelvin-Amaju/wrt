const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
function atomicWrite(file,payload){const tmp=`${file}.${process.pid}.${randomUUID()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(payload,null,2),'utf8');fs.renameSync(tmp,file);}
function createSocialRunStore({baseDir}={}){if(!baseDir)throw new Error('baseDir is required');const dir=path.join(baseDir,'social-hub');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,'runs.json');
  function read(){if(!fs.existsSync(file))return [];try{const v=JSON.parse(fs.readFileSync(file,'utf8'));return Array.isArray(v)?v:[];}catch{return [];}}
  function list(){return read().slice(0,100);}
  function get(runId){return read().find(x=>x.runId===String(runId))||null;}
  function upsert(run){const items=read().filter(x=>x.runId!==run.runId);items.unshift(run);if(items.length>100)items.length=100;atomicWrite(file,items);return run;}
  function del(runId){const items=read();const next=items.filter(x=>x.runId!==String(runId));atomicWrite(file,next);return {runId:String(runId),deleted:next.length!==items.length};}
  function clear(){atomicWrite(file,[]);return {cleared:true};}
  return {list,get,upsert,delete:del,clear};
}
module.exports={createSocialRunStore};
