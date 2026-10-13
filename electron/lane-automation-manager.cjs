const ACTIVE = new Set(['CREATED','STARTING','RUNNING','PAUSING','PAUSED','RESUMING','STOPPING']);
const TERMINAL = new Set(['COMPLETED','FAILED','STOPPED']);
const MODES = new Set(['completed-only','all-finished']);

function blankAuto(){return {enabled:false,mode:'completed-only',maxConcurrent:1,selected:new Set(),running:new Set(),seenTerminal:new Set()};}
function blankRecovery(){return {enabled:false,timeoutMinutes:5,maxAttempts:3,watch:new Map(),recovering:new Set()};}

function createLaneAutomationManager({listRuns,rerunRun,stopRun,clock}={}){
  if(typeof listRuns!=='function'||typeof rerunRun!=='function'||typeof stopRun!=='function') throw new Error('lane automation requires run accessors');
  const timerApi=clock||{now:()=>Date.now(),setInterval:(fn,ms)=>setInterval(fn,ms),clearInterval:(id)=>clearInterval(id)};
  const lanes={streaming:{auto:blankAuto(),recovery:blankRecovery()},social:{auto:blankAuto(),recovery:blankRecovery()}};
  let ticking=false;
  function lane(kind){const key=String(kind||'');if(!lanes[key])throw new Error('Lane automation supports streaming or social runs');return lanes[key];}
  function runs(kind){return (listRuns()||[]).filter(r=>String(r?.runKind||'')===kind);}
  function getAuto(kind){const a=lane(kind).auto;return {enabled:a.enabled,mode:a.mode,maxConcurrent:a.maxConcurrent,running:a.running.size,queued:0,selectedRunIds:[...a.selected]};}
  function configureAuto(kind,patch={}){const a=lane(kind).auto;if(patch.mode!=null){const m=String(patch.mode);if(!MODES.has(m))throw new Error('Unsupported automatic rerun mode');a.mode=m;}if(patch.maxConcurrent!=null){const n=Math.floor(Number(patch.maxConcurrent));if(!Number.isFinite(n))throw new Error('Max simultaneous reruns must be a number');a.maxConcurrent=Math.max(1,Math.min(10,n));}if(patch.selectedRunIds!=null){if(!Array.isArray(patch.selectedRunIds))throw new Error('Selected automatic rerun tasks must be an array');const valid=new Set(runs(kind).map(r=>String(r.runId)));a.selected=new Set(patch.selectedRunIds.map(String).filter(id=>valid.has(id)));a.seenTerminal=new Set([...a.seenTerminal].filter(sig=>a.selected.has(sig.split('|',1)[0])));}if(patch.enabled!=null)a.enabled=patch.enabled===true;return getAuto(kind);}
  function recoveryCandidate(kind,r){return ACTIVE.has(String(r?.status||''))&&String(r?.runKind||'')===kind;}
  function getRecovery(kind){const rec=lane(kind).recovery;let watching=0;for(const r of runs(kind))if(recoveryCandidate(kind,r))watching++;return {enabled:rec.enabled,timeoutMinutes:rec.timeoutMinutes,maxAttempts:rec.maxAttempts,watching,recovering:rec.recovering.size};}
  function configureRecovery(kind,patch={}){const rec=lane(kind).recovery;if(patch.timeoutMinutes!=null){const n=Number(patch.timeoutMinutes);if(!Number.isFinite(n))throw new Error('Stuck timeout must be a number');rec.timeoutMinutes=Math.max(1,Math.min(120,n));}if(patch.maxAttempts!=null){const n=Math.floor(Number(patch.maxAttempts));if(!Number.isFinite(n))throw new Error('Maximum recovery attempts must be a number');rec.maxAttempts=Math.max(1,Math.min(10,n));}if(patch.enabled!=null){rec.enabled=patch.enabled===true;if(!rec.enabled){rec.watch.clear();rec.recovering.clear();}}return getRecovery(kind);}
  function terminalSignature(r){return `${String(r.runId)}|${Math.max(1,Number(r.attemptCount)||1)}|${String(r.status)}|${String(r.updatedAt||'')}`;}
  async function tickAuto(kind){const a=lane(kind).auto;if(!a.enabled)return;const byId=new Map(runs(kind).map(r=>[String(r.runId),r]));for(const id of [...a.selected]){const r=byId.get(id);if(!r)continue;if(!TERMINAL.has(String(r.status)))continue;if(a.mode==='completed-only'&&String(r.status)!=='COMPLETED')continue;const sig=terminalSignature(r);if(a.seenTerminal.has(sig)||a.running.has(id)||a.running.size>=a.maxConcurrent)continue;a.running.add(id);Promise.resolve(rerunRun(kind,id,{automatic:true})).then(result=>{if(result?.rerun)a.seenTerminal.add(sig);}).catch(()=>undefined).finally(()=>a.running.delete(id));}}
  async function tickRecovery(kind){const rec=lane(kind).recovery;if(!rec.enabled)return;const now=timerApi.now();const present=new Set();for(const r of runs(kind)){const id=String(r.runId);if(!recoveryCandidate(kind,r))continue;present.add(id);const stamp=String(r.updatedAt||'');const prev=rec.watch.get(id);if(!prev||prev.stamp!==stamp){rec.watch.set(id,{stamp,seenAt:now,attempts:prev?.attempts||0});continue;}if(rec.recovering.has(id))continue;if(now-prev.seenAt<rec.timeoutMinutes*60000)continue;if(prev.attempts>=rec.maxAttempts){await stopRun(kind,id).catch(()=>undefined);rec.watch.delete(id);continue;}rec.recovering.add(id);try{await stopRun(kind,id);await rerunRun(kind,id,{recovery:true});rec.watch.set(id,{stamp:'',seenAt:now,attempts:prev.attempts+1});}catch{}finally{rec.recovering.delete(id);}}
    for(const id of [...rec.watch.keys()])if(!present.has(id))rec.watch.delete(id);
  }
  async function tick(){if(ticking)return;ticking=true;try{await Promise.all(['streaming','social'].flatMap(kind=>[tickAuto(kind),tickRecovery(kind)]));}finally{ticking=false;}}
  const timer=timerApi.setInterval(()=>{tick().catch(()=>undefined);},1000);timer?.unref?.();
  function stop(){timerApi.clearInterval(timer);}
  function isSelected(kind,id){return lane(kind).auto.selected.has(String(id));}
  return {getAuto,configureAuto,getRecovery,configureRecovery,tick,stop,isSelected};
}
module.exports={createLaneAutomationManager};
