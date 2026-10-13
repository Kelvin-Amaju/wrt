const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {createContentIntelligenceStore}=require('./content-intelligence-store.cjs');
const {createSocialRunner}=require('./social/social-runner.cjs');
const {makePersistentAccountPlans}=require('./streaming/streaming-runner.cjs');

test('content intelligence settings persist independently for streaming and social',()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oq-intel-'));const store=createContentIntelligenceStore({userDataPath:dir});store.set('social',{enabled:true,feedSampleCount:1,interestKeywords:'video'});store.set('streaming',{enabled:true,adaptiveObservation:true,interestKeywords:'music'});const reopened=createContentIntelligenceStore({userDataPath:dir});assert.equal(reopened.get('social').feedSampleCount,1);assert.equal(reopened.get('streaming').enabled,true);assert.equal(reopened.get('streaming').interestKeywords[0],'music');fs.rmSync(dir,{recursive:true,force:true});});

test('streaming account plan carries optional content intelligence configuration',()=>{const cfg={enabled:true,adaptiveObservation:true,interestKeywords:['music']};const plans=makePersistentAccountPlans({accountIds:['a1'],executionMode:'visible',deviceMode:'desktop',contentIntelligence:cfg},[{id:'t1'}]);assert.equal(plans[0].contentIntelligence,cfg);});

test('social intelligence opens random feed content before search, scores target and adapts observation',async()=>{
 let clicked=0,current='https://www.youtube.com/';
 const visible=(text='',href='')=>({first(){return this},nth(){return this},async isVisible(){return true},async count(){return 1},async innerText(){return text},async getAttribute(name){return name==='href'?href:''},async evaluate(fn){return fn({paused:false,ended:false,readyState:4,play(){return Promise.resolve()}})},async click(){clicked++;current=new URL(href||'/watch?v=random',current).toString()},async scrollIntoViewIfNeeded(){}});
 const hidden={first(){return this},nth(){return this},async isVisible(){return false},async count(){return 0},async innerText(){return ''},async getAttribute(){return ''}};
 const page={url:()=>current,async goto(url){current=url},async goBack(){current='https://www.youtube.com/'},async waitForLoadState(){},async reload(){},async title(){return 'Amazing AI music video'},async evaluate(){},locator(sel){if(sel==='body')return visible('Amazing AI music tutorial from Creator');if(sel.includes('thumbnail'))return visible('Random video','/watch?v=random');if(sel.includes('/watch'))return visible(current.includes('/results?')?'Amazing AI music video':'Random video',current.includes('/results?')?'/watch?v=abc':'/watch?v=random');if(sel==='video')return hidden;if(sel.includes('avatar'))return visible('Account');if(sel.includes('ytd-channel-name'))return visible('Creator');return hidden},getByRole(){return hidden}};
 const account={id:'a1',platform:'youtube',label:'YT',proxySource:'none',status:'ready'};const target={id:'t1',platform:'youtube',url:'https://www.youtube.com/watch?v=abc',title:'Amazing AI music video',creatorName:'Creator'};
 const runStore={upsert(v){this.last=JSON.parse(JSON.stringify(v));return v},list(){return this.last?[this.last]:[]},get(){return this.last}};
 const runner=createSocialRunner({accountStore:{getInternal:()=>account},targetStore:{get:()=>target,update(){return target}},browserFactory:{async open(){return {page,context:{},async close(){}}}},runStore,random:()=>0});
 const out=await runner.execute({platform:'youtube',accountIds:['a1'],targetIds:['t1'],checks:['visit'],contentIntelligence:{enabled:true,maxSessionSeconds:10,interestKeywords:'ai,music'}});
 const result=out.results[0];assert.ok(result.checks.some(x=>x.name==='intelligence-feed-sampling'));assert.ok(result.checks.some(x=>x.name==='content-intelligence'));assert.ok(result.observationSeconds>=1&&result.observationSeconds<=10);assert.ok(clicked>=1);
});
