const test=require('node:test');const assert=require('node:assert/strict');
const {recoverSocialSessionWithCredentials}=require('./credential-recovery.cjs');
function loc({visible=true}={}){return {first(){return this;},async isVisible(){return visible;},async fill(){},async click(){},async press(){},async type(){},async innerText(){return '';}};}
test('social credential recovery fills saved credentials and returns PASS when account controls become visible',async()=>{
  let url='https://www.instagram.com/accounts/login/';let verified=false;
  const page={
    url:()=>url,
    async goto(next){url=next;},
    locator(selector){if(selector==='body')return {async innerText(){return '';}};if(/username|type="text"/.test(selector))return loc();if(/password/.test(selector))return loc();if(/recaptcha|hcaptcha|one-time-code/.test(selector))return loc({visible:false});if(/direct\/inbox|Home|accounts\/edit/.test(selector))return loc({visible:verified});return loc({visible:false});},
    getByRole(role,{name}={}){return {first(){return this;},async isVisible(){return /log in|sign in/i.test(String(name))||name instanceof RegExp;},async boundingBox(){return {x:10,y:10,width:20,height:20};}};},
    mouse:{async move(){},async click(){verified=true;url='https://www.instagram.com/';}},
    async evaluate(){},
  };
  const out=await recoverSocialSessionWithCredentials({page,account:{platform:'instagram',username:'qa',password:'pw'},interactionMode:'cursor'});
  assert.equal(out.status,'PASS');assert.equal(out.autoRecovered,true);
});

test('social credential recovery stops at CAPTCHA/MFA instead of bypassing it',async()=>{
  const page={url:()=> 'https://www.facebook.com/login/',async goto(){},locator(selector){if(selector==='body')return {async innerText(){return 'Verify you are human';}};return loc({visible:false});}};
  const out=await recoverSocialSessionWithCredentials({page,account:{platform:'facebook',username:'qa',password:'pw'}});
  assert.equal(out.status,'NEEDS_VERIFICATION');assert.equal(out.challenge,true);
});
