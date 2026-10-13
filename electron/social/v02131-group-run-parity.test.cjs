const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createSocialRunner,_test}=require('./social-runner.cjs');
const PLATFORMS=['youtube','facebook','instagram','x','pinterest','tiktok','linkedin','reddit'];

function stores(platform,accountCount=2,targetCount=4){
  const accounts={};const targets={};
  for(let i=1;i<=accountCount;i++)accounts[`a${i}`]={id:`a${i}`,platform,label:`A${i}`,proxySource:'none',status:'ready'};
  for(let i=1;i<=targetCount;i++)targets[`t${i}`]={id:`t${i}`,platform,url:`https://example.test/${platform}/${i}`,title:`T${i}`};
  return {accounts,targets,accountStore:{getInternal:id=>accounts[id]||null},targetStore:{get:id=>targets[id]||null,update(){return null}}};
}
function groupRequest(platform,{intelligence=false}={}){
  return {platform,accountIds:['a1','a2'],targetIds:['t1','t2','t3','t4'],groups:[{id:'g1',name:'Group 1',order:1,platform,accountIds:['a1','a2'],targetIds:['t1','t2','t3','t4'],targetMode:'specific',targetCount:4,checks:intelligence?[]:['visit'],mediaObservationMinSeconds:2,mediaObservationMaxSeconds:5,deviceMode:'desktop',deviceProfile:'Desktop 1280x720',contentIntelligence:intelligence?{enabled:true,decisionMode:'auto',socialLikeAllowed:false,socialFollowAllowed:false,socialCommentAllowed:false}:undefined}]};
}

test('Group Run expands 2 accounts x 4 targets to 8 QA jobs on every Social Hub platform',()=>{
  for(const platform of PLATFORMS){
    const st=stores(platform);const out=_test.buildPlan({request:groupRequest(platform),accountStore:st.accountStore,targetStore:st.targetStore});
    assert.equal(out.plan.length,8,`${platform} planned jobs`);
    assert.equal(out.workload.length,1);assert.equal(out.workload[0].workerCount,2);assert.equal(out.workload[0].plannedTasks,8);
    for(const accountId of ['a1','a2'])assert.deepEqual(new Set(out.plan.filter(x=>x.account.id===accountId).map(x=>x.target.id)),new Set(['t1','t2','t3','t4']),`${platform} ${accountId} full coverage`);
  }
});

test('Group Run Content Intelligence uses the same full account-target worker model on every platform',()=>{
  for(const platform of PLATFORMS){
    const st=stores(platform);const out=_test.buildPlan({request:groupRequest(platform,{intelligence:true}),accountStore:st.accountStore,targetStore:st.targetStore});
    assert.equal(out.plan.length,8,`${platform} intelligence jobs`);assert.equal(out.workload[0].mode,'account-target-matrix');
  }
});

test('Quick Run and Group Run use the same 2x4 matrix for read-only QA',()=>{
  const platform='x',st=stores(platform);
  const quick=_test.buildPlan({request:{platform,accountIds:['a1','a2'],targetIds:['t1','t2','t3','t4'],checks:['visit'],mediaObservationMinSeconds:2,mediaObservationMaxSeconds:5},accountStore:st.accountStore,targetStore:st.targetStore});
  const group=_test.buildPlan({request:groupRequest(platform),accountStore:st.accountStore,targetStore:st.targetStore});
  assert.equal(quick.plan.length,8);assert.equal(group.plan.length,8);
  assert.deepEqual(new Set(quick.plan.map(x=>`${x.account.id}:${x.target.id}`)),new Set(group.plan.map(x=>`${x.account.id}:${x.target.id}`)));
});

test('Group Run start preview reports real worker and task counts rather than one platform run',()=>{
  const platform='x',st=stores(platform);const runStore={rows:[],upsert(v){this.rows=[v];return v},list(){return this.rows},get(){return this.rows[0]||null}};
  const runner=createSocialRunner({accountStore:st.accountStore,targetStore:st.targetStore,browserFactory:{async open(){throw new Error('preview-only')}} ,runStore});
  const started=runner.start(groupRequest(platform));
  assert.equal(started.workerCount,2);assert.equal(started.plannedTasks,8);assert.equal(started.groupWorkload[0].plannedTasks,8);
});

test('Group Run UI exposes effective worker x target workload before launch',()=>{
  const root=path.resolve(__dirname,'../..');const panel=fs.readFileSync(path.join(root,'src/components/SocialGroupPlanPanel.tsx'),'utf8');const page=fs.readFileSync(path.join(root,'src/pages/SocialHub.tsx'),'utf8');
  assert.match(panel,/QA job/);assert.match(panel,/independent parallel worker/);assert.match(page,/Group Run started:/);assert.match(page,/planned QA task/);assert.match(page,/workerCount/);
});

function mockPage(urlRef){
  const hidden={first(){return this},async isVisible(){return false},async count(){return 0},async innerText(){return ''},async getAttribute(){return ''},async evaluate(){return null}};
  const body={...hidden,async innerText(){return 'Healthy social page'}};
  return {url:()=>urlRef.value,locator(sel){return sel==='body'?body:hidden},async goto(url){urlRef.value=url},async title(){return 'Target'},async evaluate(){return null}};
}

test('Group Run executor launches both saved account profiles in parallel and keeps four targets sequential inside each account',async()=>{
  const platform='x',st=stores(platform);const opens={a1:[],a2:[]};const closes={a1:[],a2:[]};let firstOpenCount=0;let releaseFirst;const firstBarrier=new Promise(resolve=>{releaseFirst=resolve});
  const browserFactory={async open({account,workUnit,usePersistentProfile,executionMode}){
    assert.equal(usePersistentProfile,true);assert.equal(executionMode,'visible');
    const targetId=String(workUnit.workId).split(':').pop();opens[account.id].push(targetId);
    if(opens[account.id].length===1){firstOpenCount++;if(firstOpenCount===2)releaseFirst();await firstBarrier;}else assert.equal(closes[account.id].at(-1),opens[account.id].at(-2),`${account.id} must close its previous target before opening the next`);
    const ref={value:st.targets[targetId].url};return {page:mockPage(ref),context:{},persistentProfile:true,profileDir:`C:/profiles/${platform}/${account.id}`,async close(){closes[account.id].push(targetId)}};
  }};
  const runStore={last:null,upsert(v){this.last=JSON.parse(JSON.stringify(v));return v},list(){return this.last?[this.last]:[]},get(){return this.last}};
  const runner=createSocialRunner({accountStore:st.accountStore,targetStore:st.targetStore,browserFactory,runStore,random:()=>0});
  const out=await runner.execute({...groupRequest(platform),executionMode:'visible'});
  assert.equal(out.status,'COMPLETED');assert.equal(out.workerCount,2);assert.equal(out.plannedTasks,8);assert.equal(out.completedTasks,8);
  assert.deepEqual(new Set(opens.a1),new Set(['t1','t2','t3','t4']));assert.deepEqual(new Set(opens.a2),new Set(['t1','t2','t3','t4']));assert.notEqual(opens.a1[0],opens.a2[0]);
});
