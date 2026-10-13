const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEDULE_TYPES = new Set(['once','daily','weekdays','weekly','monthly','interval']);

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}
function parseClock(value='09:00') {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value));
  if (!match) return {hour:9,minute:0};
  return {hour:Math.max(0,Math.min(23,Number(match[1]))),minute:Math.max(0,Math.min(59,Number(match[2])))};
}
function atClock(date, clock) {
  const d = new Date(date); const {hour,minute}=parseClock(clock);
  d.setHours(hour,minute,0,0); return d;
}
function nextScheduledAt(schedule, from = new Date()) {
  const base = asDate(from) || new Date();
  const type = SCHEDULE_TYPES.has(schedule?.type) ? schedule.type : 'once';
  if (type === 'once') {
    const d=asDate(schedule?.startAt); return d && d > base ? d.toISOString() : null;
  }
  if (type === 'interval') {
    const minutes=Math.max(1,Math.min(43200,Number(schedule?.intervalMinutes)||60));
    return new Date(base.getTime()+minutes*60000).toISOString();
  }
  if (type === 'daily') {
    let d=atClock(base,schedule?.time); if(d<=base)d.setDate(d.getDate()+1); return d.toISOString();
  }
  if (type === 'weekdays') {
    let d=atClock(base,schedule?.time);
    for(let i=0;i<8;i++){if(d>base&&d.getDay()>=1&&d.getDay()<=5)return d.toISOString();d.setDate(d.getDate()+1);d=atClock(d,schedule?.time);} return null;
  }
  if (type === 'weekly') {
    const days=[...new Set((Array.isArray(schedule?.daysOfWeek)?schedule.daysOfWeek:[base.getDay()]).map(Number).filter(x=>x>=0&&x<=6))];
    let d=atClock(base,schedule?.time);
    for(let i=0;i<14;i++){if(d>base&&days.includes(d.getDay()))return d.toISOString();d.setDate(d.getDate()+1);d=atClock(d,schedule?.time);} return null;
  }
  if (type === 'monthly') {
    const day=Math.max(1,Math.min(31,Number(schedule?.dayOfMonth)||1));
    for(let add=0;add<14;add++){
      const d=new Date(base.getFullYear(),base.getMonth()+add,1); const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
      d.setDate(Math.min(day,last)); const candidate=atClock(d,schedule?.time); if(candidate>base)return candidate.toISOString();
    }
  }
  return null;
}
function normalizeSchedule(schedule={}) {
  const type=SCHEDULE_TYPES.has(schedule.type)?schedule.type:'once';
  return {type,startAt:schedule.startAt||null,time:String(schedule.time||'09:00'),daysOfWeek:Array.isArray(schedule.daysOfWeek)?schedule.daysOfWeek.map(Number):[],dayOfMonth:Math.max(1,Math.min(31,Number(schedule.dayOfMonth)||1)),intervalMinutes:Math.max(1,Math.min(43200,Number(schedule.intervalMinutes)||60))};
}
function createSchedulerManager({baseDir, executeTask, now=()=>new Date(), pollMs=15000}) {
  const filePath=path.join(baseDir,'scheduler-tasks.json'); let timer=null; let running=false;
  const read=()=>{try{const v=JSON.parse(fs.readFileSync(filePath,'utf8'));return Array.isArray(v)?v:[]}catch{return[]}};
  const write=(rows)=>{fs.mkdirSync(path.dirname(filePath),{recursive:true});const tmp=`${filePath}.tmp`;fs.writeFileSync(tmp,JSON.stringify(rows,null,2));fs.renameSync(tmp,filePath);};
  const list=()=>read().sort((a,b)=>String(a.nextRunAt||'9999').localeCompare(String(b.nextRunAt||'9999')));
  function save(request={}) {
    const rows=read(); const existing=rows.find(x=>x.id===request.id); const timestamp=now().toISOString(); const schedule=normalizeSchedule(request.schedule||existing?.schedule||{});
    const base={...existing,...request,id:existing?.id||String(request.id||crypto.randomUUID()),name:String(request.name||existing?.name||'Scheduled task').trim(),module:String(request.module||existing?.module||'qa'),action:String(request.action||existing?.action||''),targetId:request.targetId==null?(existing?.targetId||null):String(request.targetId),targetLabel:request.targetLabel==null?(existing?.targetLabel||''):String(request.targetLabel),enabled:request.enabled!==false,schedule,updatedAt:timestamp,createdAt:existing?.createdAt||timestamp};
    if(!base.action)throw new Error('Choose a scheduler action');
    if(!existing || request.schedule) base.nextRunAt=nextScheduledAt(schedule,now());
    if(schedule.type==='once'&&!base.nextRunAt)throw new Error('One-time schedule must be in the future');
    const next=rows.filter(x=>x.id!==base.id);next.push(base);write(next);return base;
  }
  function remove(id){const rows=read(),next=rows.filter(x=>x.id!==String(id));write(next);return {id:String(id),deleted:next.length!==rows.length};}
  function setEnabled(id,enabled){const rows=read();const row=rows.find(x=>x.id===String(id));if(!row)throw new Error('Scheduled task not found');row.enabled=enabled===true;row.updatedAt=now().toISOString();if(row.enabled&&!row.nextRunAt)row.nextRunAt=nextScheduledAt(row.schedule,now());write(rows);return row;}
  async function execute(row,{manual=false}={}) {
    const started=now(); let status='success',message='Completed';
    try{const result=await executeTask(row);message=result?.message||'Completed successfully';}
    catch(error){status='failed';message=error instanceof Error?error.message:String(error);}
    const rows=read();const current=rows.find(x=>x.id===row.id);if(!current)return {status,message};
    current.lastRunAt=started.toISOString();current.lastStatus=status;current.lastMessage=message;current.runCount=Math.max(0,Number(current.runCount)||0)+1;current.updatedAt=now().toISOString();
    if(!manual){const next=nextScheduledAt(current.schedule,new Date(started.getTime()+1000));current.nextRunAt=next;if(!next)current.enabled=false;}
    write(rows);return {status,message,task:current};
  }
  async function runNow(id){const row=read().find(x=>x.id===String(id));if(!row)throw new Error('Scheduled task not found');return execute(row,{manual:true});}
  async function tick(){if(running)return;running=true;try{const stamp=now();const due=read().filter(x=>x.enabled&&x.nextRunAt&&new Date(x.nextRunAt)<=stamp);for(const row of due)await execute(row);}finally{running=false;}}
  function start(){if(timer)return;timer=setInterval(()=>void tick(),pollMs);timer.unref?.();void tick();}
  function stop(){if(timer){clearInterval(timer);timer=null;}}
  return {list,save,remove,setEnabled,runNow,tick,start,stop};
}
module.exports={createSchedulerManager,nextScheduledAt,normalizeSchedule};
