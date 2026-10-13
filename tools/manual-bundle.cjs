const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const entry=path.join(root,'src','main.tsx');
const modules=[];const byFile=new Map();
function resolveRequest(from,request){
  if(request.endsWith('.css')) return {kind:'css',file:path.resolve(path.dirname(from),request)};
  if(request.startsWith('.')||request.startsWith('/')){
    const base=path.resolve(path.dirname(from),request);
    const candidates=[base,base+'.ts',base+'.tsx',base+'.js',base+'.jsx',base+'.cjs',base+'.json',path.join(base,'index.ts'),path.join(base,'index.tsx'),path.join(base,'index.js')];
    for(const c of candidates)if(fs.existsSync(c)&&fs.statSync(c).isFile())return {kind:path.extname(c)==='.json'?'json':'code',file:c};
    throw new Error(`Cannot resolve ${request} from ${from}`);
  }
  const file=require.resolve(request,{paths:[path.dirname(from),root]});
  return {kind:path.extname(file)==='.json'?'json':'code',file};
}
function transpile(file,source){
  if(/\.(ts|tsx)$/.test(file))return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,allowSyntheticDefaultImports:true,resolveJsonModule:true}}).outputText;
  return source;
}
function add(file,kind='code'){
  const key=kind+':'+file;if(byFile.has(key))return byFile.get(key);
  const id=modules.length;byFile.set(key,id);modules.push(null);
  if(kind==='css'){modules[id]={id,file,code:'module.exports={};',deps:{}};return id;}
  if(kind==='json'){modules[id]={id,file,code:'module.exports='+fs.readFileSync(file,'utf8')+';',deps:{}};return id;}
  const raw=fs.readFileSync(file,'utf8');let code=transpile(file,raw);const deps={};
  const re=/require\((['"])([^'"]+)\1\)/g;let m;const requests=[];while((m=re.exec(code)))if(!requests.includes(m[2]))requests.push(m[2]);
  for(const request of requests){
    if(['fs','path','node:fs','node:path','electron'].includes(request))throw new Error(`Browser bundle unexpectedly requires ${request} in ${file}`);
    const r=resolveRequest(file,request);deps[request]=add(r.file,r.kind);
  }
  modules[id]={id,file,code,deps};return id;
}
const entryId=add(entry);
let out='/* OrbitQA manual browser bundle */\n';
out+='const process={env:{NODE_ENV:"production"}};\n';
out+='const __mods={\n';
for(const mod of modules){out+=JSON.stringify(mod.id)+':function(module,exports,require){\n'+mod.code+'\n},\n';}
out+='};\nconst __maps='+JSON.stringify(Object.fromEntries(modules.map(m=>[m.id,m.deps])))+';\n';
out+='const __cache={};function __require(id){if(__cache[id])return __cache[id].exports;const module={exports:{}};__cache[id]=module;const local=(name)=>{const dep=__maps[id]&&__maps[id][name];if(dep===undefined)throw new Error("Missing bundled dependency "+name+" from "+id);return __require(dep)};__mods[id](module,module.exports,local);return module.exports;}\n';
out+='__require('+entryId+');\n';
const outDir=path.join(root,'dist','assets');fs.mkdirSync(outDir,{recursive:true});fs.writeFileSync(path.join(outDir,'index-manual.js'),out);fs.copyFileSync(path.join(root,'src','styles.css'),path.join(outDir,'index-manual.css'));
fs.writeFileSync(path.join(root,'dist','index.html'),'<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>OrbitQA Desktop</title><script defer src="./assets/index-manual.js"></script><link rel="stylesheet" href="./assets/index-manual.css"></head><body><div id="root"></div></body></html>\n');
console.log(`Bundled ${modules.length} modules -> dist/assets/index-manual.js (${Math.round(out.length/1024)} KiB)`);
