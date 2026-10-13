const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {_test}=require('./social-runner.cjs');
const PLATFORMS=['youtube','facebook','instagram','x','pinterest','tiktok','linkedin','reddit'];

function stores(platform,accountCount=3,targetCount=5){
  const accounts={};const targets={};
  for(let i=1;i<=accountCount;i++)accounts[`a${i}`]={id:`a${i}`,platform,label:`A${i}`,proxySource:'none',status:'ready'};
  for(let i=1;i<=targetCount;i++)targets[`t${i}`]={id:`t${i}`,platform,url:`https://example.test/${platform}/${i}`,title:`T${i}`};
  return {accountStore:{getInternal:id=>accounts[id]||null},targetStore:{get:id=>targets[id]||null}};
}
function req(platform,targetMode,targetCount=1,intelligence=false){
  return {platform,accountIds:['a1','a2','a3'],targetIds:['t1','t2','t3','t4','t5'],groups:[{id:'g1',name:'G1',order:1,platform,accountIds:['a1','a2','a3'],targetIds:['t1','t2','t3','t4','t5'],targetMode,targetCount,checks:intelligence?[]:['visit','media-playback'],mediaObservationMinSeconds:20,mediaObservationMaxSeconds:40,deviceMode:'desktop',deviceProfile:'Desktop 1280x720',contentIntelligence:intelligence?{enabled:true,decisionMode:'auto',socialLikeAllowed:false,socialFollowAllowed:false,socialCommentAllowed:false}:undefined}]};
}

for(const mode of ['all','specific'])test(`${mode}: every account receives every selected/assigned target on every Social Hub platform`,()=>{
  for(const platform of PLATFORMS){const st=stores(platform);const out=_test.buildPlan({request:req(platform,mode,5),accountStore:st.accountStore,targetStore:st.targetStore,random:()=>0.25});
    assert.equal(out.plan.length,15,`${platform} total jobs`);assert.equal(out.workload[0].targets,5);assert.equal(out.workload[0].plannedTasks,15);
    for(const id of ['a1','a2','a3'])assert.deepEqual(new Set(out.plan.filter(x=>x.account.id===id).map(x=>x.target.id)),new Set(['t1','t2','t3','t4','t5']),`${platform} ${id}`);
  }
});

test('Certain number N is per-account, not one global group slice, on every platform',()=>{
  for(const platform of PLATFORMS){for(const n of [1,2,4,5]){const st=stores(platform);let seed=0;const rand=()=>((seed++*37)%97)/97;const out=_test.buildPlan({request:req(platform,'count',n),accountStore:st.accountStore,targetStore:st.targetStore,random:rand});
    assert.equal(out.plan.length,3*n,`${platform} N=${n} total`);assert.equal(out.workload[0].targets,n);assert.equal(out.workload[0].plannedTasks,3*n);assert.equal(out.workload[0].mode,'per-account-random-count');
    for(const id of ['a1','a2','a3']){const rows=out.plan.filter(x=>x.account.id===id);assert.equal(rows.length,n,`${platform} ${id} N=${n}`);assert.equal(new Set(rows.map(x=>x.target.id)).size,n,`${platform} ${id} unique`);}
  }}
});

test('Certain number 1 diversifies account choices when the target pool allows it',()=>{
  const st=stores('youtube',3,5);const out=_test.buildPlan({request:req('youtube','count',1),accountStore:st.accountStore,targetStore:st.targetStore,random:()=>0});
  const firsts=['a1','a2','a3'].map(id=>out.plan.find(x=>x.account.id===id)?.target.id);assert.equal(new Set(firsts).size,3);
});

test('Content Intelligence uses the same target mode semantics',()=>{
  for(const platform of PLATFORMS){const st=stores(platform);const all=_test.buildPlan({request:req(platform,'all',5,true),accountStore:st.accountStore,targetStore:st.targetStore,random:()=>0.1});assert.equal(all.plan.length,15);const count=_test.buildPlan({request:req(platform,'count',2,true),accountStore:st.accountStore,targetStore:st.targetStore,random:()=>0.1});assert.equal(count.plan.length,6);}
});

test('Social Hub UI exposes SELECT ALL, UNSELECT ALL, DELETE ALL and target-mode semantics',()=>{
  const page=fs.readFileSync(path.join(__dirname,'../../src/pages/SocialHub.tsx'),'utf8');const panel=fs.readFileSync(path.join(__dirname,'../../src/components/SocialGroupPlanPanel.tsx'),'utf8');
  assert.match(page,/>SELECT ALL</);assert.match(page,/>UNSELECT ALL</);assert.match(page,/>DELETE ALL</);assert.match(page,/currentSelected/);assert.match(page,/saveSocialGroup/);assert.match(panel,/All assigned targets/);assert.match(panel,/Certain number/);assert.match(panel,/independently picks/);assert.match(panel,/automatic error\/stall watchdog/);
});
