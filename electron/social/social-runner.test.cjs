const test=require('node:test');const assert=require('node:assert/strict');
const {createSocialRunner,_test}=require('./social-runner.cjs');
function locator({text='',count=0,visible=false,attrs={}}={}){return {first(){return this},nth(){return this},async isVisible(){return visible},async count(){return count},async innerText(){return text},async getAttribute(name){return attrs[name]||''},async evaluate(fn){return fn({paused:false,ended:false,readyState:4,currentTime:1,muted:false,play(){return Promise.resolve()}})}};}
function page(){return {url:()=> 'https://www.youtube.com/watch?v=abc',async goto(){},async reload(){},async title(){return 'Video title'},async waitForTimeout(){},locator(sel){if(sel==='body')return locator({text:'normal page',count:1,visible:true});if(sel==='video,audio')return locator({count:1,visible:true});if(sel.includes('ytd-channel-name'))return locator({text:'Creator',count:1,visible:true,attrs:{href:'/@creator'}});if(sel.includes('#comments'))return locator({text:'Great video',count:1,visible:true});if(sel.includes('#placeholder-area'))return locator({count:1,visible:true});if(sel.includes('avatar'))return locator({count:1,visible:true});return locator({count:0,visible:false});},getByRole(_role,{name}={}){const label=String(name||'');if(/subscribe/i.test(label))return locator({text:'Subscribe',count:1,visible:true});return locator({count:0,visible:false});}};}
test('social runner records read-only QA checks and closes browser',async()=>{let closed=0;const account={id:'a1',platform:'youtube',label:'YT',proxySource:'none',status:'ready'};const target={id:'t1',platform:'youtube',url:'https://www.youtube.com/watch?v=abc'};const runStore={last:null,upsert(v){this.last=JSON.parse(JSON.stringify(v));return v},list(){return this.last?[this.last]:[]},get(){return this.last}};const runner=createSocialRunner({accountStore:{getInternal:id=>id==='a1'?account:null},targetStore:{get:id=>id==='t1'?target:null,update(){return target}},browserFactory:{async open(){return {page:page(),context:{},browserPolicy:{},async close(){closed++}}}},runStore});const out=await runner.execute({accountIds:['a1'],targetIds:['t1'],platform:'youtube',deviceMode:'desktop',deviceProfile:'Desktop 1280x720',checks:['visit','resolve-creator','media-playback','comments-present','read-comments','comment-composer'],mediaObservationMinSeconds:1,mediaObservationMaxSeconds:1});assert.equal(out.status,'COMPLETED');assert.equal(out.completedTasks,1);assert.ok(out.passedChecks>=4);assert.equal(closed,1);});
test('social runner executes selected comment, like and follow actions in the active task browser',async()=>{let clicks=0,typed='';const visible=(text='')=>({first(){return this},nth(){return this},async isVisible(){return true},async count(){return 1},async innerText(){return text},async getAttribute(){return ''},async evaluate(fn){return fn({paused:false,ended:false,readyState:4,currentTime:1,muted:false,play(){return Promise.resolve()}})},async click(){clicks++},async fill(v){typed=String(v||'')},async type(v){typed+=String(v||'')},async press(){},async scrollIntoViewIfNeeded(){}});const hidden={first(){return this},nth(){return this},async isVisible(){return false},async count(){return 0},async innerText(){return ''},async getAttribute(){return ''}};const p={url:()=> 'https://www.youtube.com/watch?v=abc',async goto(){},async reload(){},async title(){return 'Video title'},locator(sel){if(sel==='body')return visible('normal page');if(sel.includes('avatar'))return visible('Account');if(sel.includes('#placeholder-area'))return visible('Comment');if(sel.includes('contenteditable-root'))return visible('Comment box');if(sel.includes('#comments'))return visible('Comments');if(sel.includes('#submit-button'))return visible('Comment');if(sel.includes('like this video'))return visible('Like this video');if(sel.includes('ytd-channel-name'))return visible('Creator');return hidden;},getByRole(_role,{name}={}){if(name instanceof RegExp&&name.test('Subscribe'))return visible('Subscribe');return hidden;}};const account={id:'a1',platform:'youtube',label:'YT',proxySource:'none',status:'ready'};const target={id:'t1',platform:'youtube',url:'https://www.youtube.com/watch?v=abc',title:'Video title'};const runStore={upsert(v){this.last=JSON.parse(JSON.stringify(v));return v},list(){return this.last?[this.last]:[]},get(){return this.last}};const runner=createSocialRunner({accountStore:{getInternal:()=>account},targetStore:{get:()=>target,update(){return target}},browserFactory:{async open(){return {page:p,async close(){}}}},runStore});const out=await runner.execute({platform:'youtube',accountIds:['a1'],targetIds:['t1'],checks:['comment-submit','like-action','follow-toggle'],commentDraft:'QA comment',mediaObservationMinSeconds:1,mediaObservationMaxSeconds:1});assert.equal(out.status,'COMPLETED');assert.ok(clicks>=3);assert.match(typed,/QA comment/);assert.equal(out.pendingActions,0);assert.ok(out.results[0].checks.some(x=>x.name==='comment-submit'&&x.status==='PASS'));assert.ok(out.results[0].checks.some(x=>x.name==='like-action'&&x.status==='PASS'));assert.ok(out.results[0].checks.some(x=>x.name==='follow-toggle'&&x.status==='PASS'));});

test('social runner passes requested background execution mode to the shared browser factory',async()=>{
  let mode='';const account={id:'a1',platform:'youtube',label:'YT',proxySource:'none',status:'ready'};const target={id:'t1',platform:'youtube',url:'https://www.youtube.com/watch?v=abc'};
  const runStore={upsert(v){this.last=v;return v},list(){return []},get(){return null}};
  const p={url:()=>target.url,async goto(){},locator(sel){return {first(){return this},async isVisible(){return sel==='body'},async innerText(){return 'normal page'},async count(){return 0}}},async title(){return 'Video'}};
  const runner=createSocialRunner({accountStore:{getInternal:()=>account},targetStore:{get:()=>target,update(){return target}},browserFactory:{async open(args){mode=args.executionMode;return {page:p,async close(){}}}},runStore});
  await runner.execute({platform:'youtube',accountIds:['a1'],targetIds:['t1'],checks:['visit'],executionMode:'background',mediaObservationMinSeconds:1,mediaObservationMaxSeconds:1});
  assert.equal(mode,'background');assert.equal(runStore.last.executionMode,'background');
});

test('social runner reconciles stale persisted LIVE WORK and Stop clears an orphaned active row immediately',async()=>{
  const rows=[{runId:'stale-1',runKind:'social',status:'RUNNING',updatedAt:new Date().toISOString(),plannedTasks:1,completedTasks:0}];
  const runStore={list(){return rows.map(x=>({...x}))},get(id){return rows.find(x=>x.runId===id)||null},upsert(v){const i=rows.findIndex(x=>x.runId===v.runId);if(i>=0)rows[i]=JSON.parse(JSON.stringify(v));else rows.unshift(JSON.parse(JSON.stringify(v)));return v}};
  const runner=createSocialRunner({accountStore:{getInternal(){return null}},targetStore:{get(){return null}},browserFactory:{},runStore});
  assert.equal(runStore.get('stale-1').status,'STOPPED');
  runStore.upsert({runId:'orphan-2',runKind:'social',status:'RUNNING',updatedAt:new Date().toISOString(),plannedTasks:1,completedTasks:0});
  const result=runner.stop('orphan-2');
  assert.equal(result.stopped,true);
  assert.equal(runStore.get('orphan-2').status,'STOPPED');
});

test('saved read-only social groups build one task for every selected account and target',()=>{
  const accounts={a1:{id:'a1',platform:'youtube'},a2:{id:'a2',platform:'youtube'},a3:{id:'a3',platform:'youtube'},a4:{id:'a4',platform:'youtube'}};
  const targets={t1:{id:'t1',platform:'youtube'},t2:{id:'t2',platform:'youtube'},t3:{id:'t3',platform:'youtube'},t4:{id:'t4',platform:'youtube'}};
  const accountStore={getInternal:id=>accounts[id]||null};const targetStore={get:id=>targets[id]||null};
  const make=(accountIds,targetIds)=>_test.buildPlan({request:{platform:'youtube',groups:[{id:'g1',name:'G1',platform:'youtube',accountIds,targetIds,targetMode:'specific',targetCount:targetIds.length,checks:['visit'],mediaObservationMinSeconds:1,mediaObservationMaxSeconds:1,deviceMode:'desktop',deviceProfile:'Desktop 1280x720'}]},accountStore,targetStore}).plan;
  assert.equal(make(['a1'],['t1','t2','t3','t4']).length,4);
  assert.equal(make(['a1','a2','a3','a4'],['t1']).length,4);
  const matrix=make(['a1','a2','a3','a4'],['t1','t2','t3','t4']);
  assert.equal(matrix.length,16);
  for(const accountId of ['a1','a2','a3','a4'])assert.deepEqual(new Set(matrix.filter(x=>x.account.id===accountId).map(x=>x.target.id)),new Set(['t1','t2','t3','t4']));
});

test('saved Content Intelligence observation groups use the full account-target matrix when public actions are disabled',()=>{
  const accounts={a1:{id:'a1',platform:'instagram'},a2:{id:'a2',platform:'instagram'}};
  const targets={t1:{id:'t1',platform:'instagram'},t2:{id:'t2',platform:'instagram'},t3:{id:'t3',platform:'instagram'}};
  const plan=_test.buildPlan({request:{platform:'instagram',groups:[{id:'g1',name:'Intel',platform:'instagram',accountIds:['a1','a2'],targetIds:['t1','t2','t3'],targetMode:'specific',targetCount:3,checks:[],mediaObservationMinSeconds:1,mediaObservationMaxSeconds:1,deviceMode:'desktop',deviceProfile:'Desktop 1280x720',contentIntelligence:{enabled:true,decisionMode:'auto',socialLikeAllowed:false,socialFollowAllowed:false,socialCommentAllowed:false}}]},accountStore:{getInternal:id=>accounts[id]},targetStore:{get:id=>targets[id]}}).plan;
  assert.equal(plan.length,6);
  assert.deepEqual(plan.map(x=>`${x.account.id}:${x.target.id}`),['a1:t1','a1:t2','a1:t3','a2:t1','a2:t2','a2:t3']);
});

test('saved groups with public engagement actions keep the existing non-amplifying assignment',()=>{
  const accounts={a1:{id:'a1',platform:'youtube'},a2:{id:'a2',platform:'youtube'}};
  const targets={t1:{id:'t1',platform:'youtube'},t2:{id:'t2',platform:'youtube'},t3:{id:'t3',platform:'youtube'}};
  const plan=_test.buildPlan({request:{platform:'youtube',groups:[{id:'g1',name:'Actions',platform:'youtube',accountIds:['a1','a2'],targetIds:['t1','t2','t3'],targetMode:'specific',targetCount:3,checks:['visit','like-action'],mediaObservationMinSeconds:1,mediaObservationMaxSeconds:1,deviceMode:'desktop',deviceProfile:'Desktop 1280x720'}]},accountStore:{getInternal:id=>accounts[id]},targetStore:{get:id=>targets[id]}}).plan;
  assert.equal(plan.length,3);
  assert.deepEqual(plan.map(x=>`${x.account.id}:${x.target.id}`),['a1:t1','a2:t2','a1:t3']);
});

test('all supported social platforms build the same full read-only account-target matrix',()=>{
  const platforms=['youtube','facebook','instagram','x','pinterest','tiktok','linkedin','reddit'];
  for(const platform of platforms){
    const accounts={a1:{id:'a1',platform,label:'A1'},a2:{id:'a2',platform,label:'A2'}};
    const targets={t1:{id:'t1',platform,url:`https://example.com/${platform}/1`},t2:{id:'t2',platform,url:`https://example.com/${platform}/2`}};
    const plan=_test.buildPlan({request:{platform,accountIds:['a1','a2'],targetIds:['t1','t2'],checks:['visit'],mediaObservationMinSeconds:1,mediaObservationMaxSeconds:1},accountStore:{getInternal:id=>accounts[id]},targetStore:{get:id=>targets[id]}}).plan;
    assert.deepEqual(plan.map(x=>`${x.account.id}:${x.target.id}`),['a1:t1','a1:t2','a2:t1','a2:t2'],`${platform} matrix`);
  }
});

test('selected social accounts run in parallel with different starting targets while each account remains sequential',async()=>{
  const accounts={a1:{id:'a1',platform:'youtube',label:'A1',proxySource:'none',status:'ready'},a2:{id:'a2',platform:'youtube',label:'A2',proxySource:'none',status:'ready'}};
  const targets={t1:{id:'t1',platform:'youtube',url:'https://www.youtube.com/watch?v=one',title:'One'},t2:{id:'t2',platform:'youtube',url:'https://www.youtube.com/watch?v=two',title:'Two'}};
  const events=[];const opensByAccount=new Map();const closedByAccount=new Map();
  const runStore={last:null,upsert(v){this.last=JSON.parse(JSON.stringify(v));return v},list(){return this.last?[this.last]:[]},get(){return this.last}};
  let openedFirst=0;let release;const barrier=new Promise(resolve=>{release=resolve});
  const browserFactory={async open({account,workUnit,usePersistentProfile}){
    const targetId=String(workUnit.workId).split(':').pop();const opened=opensByAccount.get(account.id)||[];opened.push(targetId);opensByAccount.set(account.id,opened);events.push(`open:${account.id}:${targetId}:${usePersistentProfile?'persistent':'ephemeral'}`);
    if(opened.length===1){openedFirst++;if(openedFirst===2)release();}
    else assert.equal(closedByAccount.get(account.id),opened[opened.length-2],`${account.id} started a second target before its first target closed`);
    const p=page();const originalGoto=p.goto;p.goto=async(...args)=>{if(opened.length===1)await barrier;return originalGoto.apply(p,args);};p.url=()=>targets[targetId].url;
    return {page:p,context:{},async close(){events.push(`close:${account.id}:${targetId}`);closedByAccount.set(account.id,targetId);}};
  }};
  const runner=createSocialRunner({accountStore:{getInternal:id=>accounts[id]},targetStore:{get:id=>targets[id],update(){return null}},browserFactory,runStore,random:()=>0});
  const out=await Promise.race([
    runner.execute({platform:'youtube',accountIds:['a1','a2'],targetIds:['t1','t2'],checks:['visit'],mediaObservationMinSeconds:2,mediaObservationMaxSeconds:4}),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('parallel account workers did not launch together')),1500)),
  ]);
  assert.equal(out.status,'COMPLETED');assert.equal(out.completedTasks,4);
  assert.notEqual(opensByAccount.get('a1')[0],opensByAccount.get('a2')[0],'parallel accounts should start on different targets when enough targets exist');
  assert.deepEqual(new Set(opensByAccount.get('a1')),new Set(['t1','t2']));assert.deepEqual(new Set(opensByAccount.get('a2')),new Set(['t1','t2']));
  assert.ok(events.findIndex(x=>x.startsWith('open:a2:'))<events.findIndex(x=>x.startsWith('close:a1:')),'account 2 should launch before account 1 finishes its first target');
  const firstByAccount=new Map();for(const row of out.results)if(!firstByAccount.has(row.accountId))firstByAccount.set(row.accountId,row.observationSeconds);assert.equal(firstByAccount.size,2);assert.equal(new Set(firstByAccount.values()).size,2,'parallel workers should use distinct observation durations when the range allows it');
});


test('independent account queue rotation gives different first targets and full coverage',()=>{
  const mk=(a,t)=>({groupId:'direct',account:{id:a},target:{id:t},group:{}});
  const queues=_test.buildIndependentAccountQueues([mk('a1','t1'),mk('a1','t2'),mk('a1','t3'),mk('a2','t1'),mk('a2','t2'),mk('a2','t3')],()=>0);
  assert.notEqual(queues.get('a1')[0].target.id,queues.get('a2')[0].target.id);
  assert.deepEqual(new Set(queues.get('a1').map(x=>x.target.id)),new Set(['t1','t2','t3']));
  assert.deepEqual(new Set(queues.get('a2').map(x=>x.target.id)),new Set(['t1','t2','t3']));
});

test('distinct worker durations avoid matching values while range capacity remains',()=>{
  const used=new Set();const a=_test.distinctWorkerDuration(10,12,()=>0,used);const b=_test.distinctWorkerDuration(10,12,()=>0,used);const c=_test.distinctWorkerDuration(10,12,()=>0,used);
  assert.deepEqual(new Set([a,b,c]),new Set([10,11,12]));
});

test('temporary service error recovery reloads until the page is healthy',async()=>{
  let reloads=0;let bad=true;const body={async innerText(){return bad?'Something went wrong. Refresh or try again later.':'Healthy page';}};
  const page={locator(){return body},async reload(){reloads++;bad=false},async waitForTimeout(){}};
  const session={page,context:{}};const out=await _test.recoverTemporaryServicePage(session,'https://www.youtube.com/watch?v=x',new AbortController().signal,()=>0);
  assert.equal(out.recovered,true);assert.equal(reloads,1);
});

test('YouTube player-level error is recovered before observation begins',async()=>{
  let bad=true,reloads=0;
  const mk=(kind)=>({first(){return this},async isVisible(){if(kind==='error')return bad;if(kind==='media')return !bad;return true},async innerText(){return bad?'Something went wrong. Refresh or try again later.':'Healthy page'},async getAttribute(name){return name==='class'&&bad?'html5-video-player playback-error':''},async evaluate(fn){return fn({error:null,readyState:4,paused:false,ended:false})}});
  const p={locator(sel){if(sel==='video,audio')return mk('media');if(sel==='body')return mk('body');if(sel==='#movie_player'||String(sel).includes('ytp-error')||String(sel).includes('playback-error'))return mk('error');return mk('other')},async reload(){reloads++;bad=false},async goto(){},async waitForTimeout(){}};
  const session={page:p,context:{}};const out=await _test.recoverTargetMedia(session,{platform:'youtube',targetUrl:'https://www.youtube.com/watch?v=x',signal:new AbortController().signal,random:()=>0});
  assert.equal(out.recovered,true);assert.equal(out.healthy,true);assert.equal(reloads,1);
});

test('media observation watchdog reloads a stalled player without extending the allocated observation window',async()=>{
  let reloads=0;let recoveredAt=0;
  const hidden={first(){return this},async isVisible(){return false},async count(){return 0},async innerText(){return ''},async getAttribute(){return ''}};
  const body={first(){return this},async isVisible(){return true},async innerText(){return 'Healthy page'}};
  const media={first(){return this},async isVisible(){return true},async evaluate(fn){const elapsed=recoveredAt?Math.max(0,(Date.now()-recoveredAt)/1000):0;return fn({paused:false,ended:false,readyState:4,currentTime:recoveredAt?1+elapsed:1,error:null,volume:.5,duration:120,play(){return Promise.resolve()},pause(){}});}};
  const p={
    locator(sel){if(sel==='video,audio')return media;if(sel==='body')return body;return hidden;},
    async reload(){reloads++;recoveredAt=Date.now();},
  };
  const started=Date.now();
  const out=await _test.mediaQa(p,2,new AbortController().signal,{platform:'youtube'});
  const wall=(Date.now()-started)/1000;
  assert.equal(out.status,'PASS');
  assert.ok(reloads>=1,'stalled media should trigger an automatic page refresh');
  assert.ok(out.recoveries>=1);
  assert.ok(out.elapsedSeconds>=1.8&&out.elapsedSeconds<=2.05,`elapsed=${out.elapsedSeconds}`);
  assert.ok(wall<3.2,`observation should not restart after recovery; wall=${wall}`);
});
