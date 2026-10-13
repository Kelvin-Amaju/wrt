const test=require('node:test');
const assert=require('node:assert/strict');
const {_test}=require('./social-runner.cjs');
function loc(visible=false){return {first(){return this;},async isVisible(){return visible;},async getAttribute(){return '';},async innerText(){return '';},async evaluate(fn){return fn({error:null,readyState:4,networkState:1,paused:false,ended:false,currentTime:1,duration:30,src:'x'});}};}
function badPage(){return {async evaluate(){return {playabilityStatus:'ERROR',playabilityReason:'player init failed',playerState:-1,playerClass:'playback-error',media:null};},locator(sel){if(sel==='body')return {...loc(true),async innerText(){return 'Something went wrong. Refresh or try again later.';}};return loc(false);},async reload(){},async goto(){},async close(){}};}
function goodPage(){return {async evaluate(){return {playabilityStatus:'OK',playabilityReason:'',playerState:1,playerClass:'playing-mode',media:{readyState:4,networkState:1,paused:false,ended:false,currentTime:1,duration:30,errorCode:null,errorMessage:'',src:'https://googlevideo.test/v'}};},locator(sel){if(sel==='body')return {...loc(true),async innerText(){return 'Healthy';}};if(sel==='video,audio')return loc(true);return loc(false);},async goto(){},async close(){}};}
test('v0.21.29 YouTube recovery restarts only the failing saved profile after tab recovery fails',async()=>{
  const bad=badPage();let restarted=0;
  const session={page:bad,context:{newPage:async()=>bad,newCDPSession:async()=>({send:async()=>{},detach:async()=>{}})}};
  const healthy={page:goodPage(),context:{}};
  const out=await _test.recoverTargetMedia(session,{platform:'youtube',targetUrl:'https://www.youtube.com/watch?v=x',random:()=>0,signal:new AbortController().signal,restartSession:async()=>{restarted++;return healthy;}});
  assert.equal(restarted,1);assert.equal(out.healthy,true);assert.equal(out.replacedSession,true);assert.equal(out.attempt,6);assert.equal(out.session,healthy);
});
