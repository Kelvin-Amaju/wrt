const test=require('node:test');
const assert=require('node:assert/strict');
const {navigateWithReferrerQa}=require('./referrer-navigation.cjs');

test('v0.21.58 Google Search Referrer QA opens Google, searches target, finds result, and clicks through', async()=>{
  let current='about:blank';
  let query='';
  let clicked=0;
  const target='https://target.example/path';
  const search={
    first(){return this}, async waitFor(){}, async fill(v){query=v}, async press(k){assert.equal(k,'Enter');current='https://www.google.com/search?q='+encodeURIComponent(query)}
  };
  const resultLocator={
    async evaluate(){return {href:target,text:'Target Example',aria:'',title:'',download:false,visible:true}},
    async scrollIntoViewIfNeeded(){},
    async boundingBox(){return {x:10,y:10,width:100,height:30}},
    async click(){clicked+=1;current=target},
  };
  const emptyLocator={async evaluate(){return {href:'https://www.google.com/preferences',text:'Preferences',aria:'',title:'',download:false,visible:true}}};
  const anchors={async count(){return 2},nth(i){return i===0?emptyLocator:resultLocator}};
  const page={
    async goto(url){current=url}, url(){return current},
    locator(sel){return sel.includes('name="q"')?search:anchors},
    async waitForTimeout(){}, async waitForLoadState(){},
    async evaluate(){return false}, context(){return context},
    async mouse(){},
  };
  const context={pages:()=>[page]};
  const out=await navigateWithReferrerQa({page,targetUrl:target,autoQa:{referrerMode:'google-simulated'},timeoutMs:3000,interactionMode:'cursor',log:()=>{}});
  assert.equal(query,target);
  assert.equal(clicked,1);
  assert.equal(out.finalUrl,target);
});
