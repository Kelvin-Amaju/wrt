const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {normalizeContentIntelligence}=require('./content-intelligence.cjs');
function createContentIntelligenceStore({userDataPath}={}){
 if(!userDataPath)throw new Error('userDataPath is required');
 const file=path.join(userDataPath,'content-intelligence.json');
 let state={streaming:normalizeContentIntelligence({}),social:normalizeContentIntelligence({})};
 try{if(fs.existsSync(file)){const parsed=JSON.parse(fs.readFileSync(file,'utf8'));state={streaming:normalizeContentIntelligence(parsed.streaming||{}),social:normalizeContentIntelligence(parsed.social||{})};}}catch{}
 function persist(){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.${process.pid}.${randomUUID()}.tmp`;fs.writeFileSync(tmp,JSON.stringify(state,null,2),'utf8');fs.renameSync(tmp,file);}
 function get(scope){const key=scope==='social'?'social':'streaming';return {...state[key]};}
 function set(scope,value){const key=scope==='social'?'social':'streaming';state[key]=normalizeContentIntelligence(value||{});persist();return get(key);}
 return {get,set,file};
}
module.exports={createContentIntelligenceStore};
