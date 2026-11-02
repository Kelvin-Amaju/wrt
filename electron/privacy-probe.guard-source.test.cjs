const test=require('node:test');
const assert=require('node:assert');
const vm=require('node:vm');
const { strictPrivacyGuardSource }=require('./privacy-probe.cjs');

// Runs the init script the way Playwright does: function source only, in a fresh global with
// no access to the module scope it was declared in. Any free identifier shows up as a
// ReferenceError here exactly as it would in the page.
function runGuardSource(options={}){
  class FakeNavigator{}
  Object.defineProperty(FakeNavigator.prototype,'mediaDevices',{configurable:true,get(){return this._mediaDevices;}});
  Object.defineProperty(FakeNavigator.prototype,'geolocation',{configurable:true,get(){return this._geolocation;}});
  Object.defineProperty(FakeNavigator.prototype,'permissions',{configurable:true,get(){return this._permissions;}});

  const navigator=new FakeNavigator();
  navigator._mediaDevices={getUserMedia(){return Promise.resolve({});}};
  navigator._geolocation={getCurrentPosition(){},watchPosition(){return 1;}};
  navigator._permissions={query(){return Promise.resolve({state:'prompt'});}};

  const timers=[];
  const listeners=[];
  const sandbox={
    navigator,
    document:{addEventListener:(name,fn)=>listeners.push([name,fn])},
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},
    clearTimeout:()=>{},
    DOMException:class DOMException extends Error{constructor(message,name){super(message);this.name=name;}},
  };
  vm.createContext(sandbox);
  const source=`(${strictPrivacyGuardSource.toString()})(${JSON.stringify(options)})`;
  vm.runInContext(source,sandbox);
  return {sandbox,navigator,timers,listeners};
}

test('the init script runs with no module scope available',()=>{
  assert.doesNotThrow(()=>runGuardSource());
});

test('the guard publishes its version flag',()=>{
  const {sandbox}=runGuardSource();
  const flag=sandbox.__orbitqaStrictGuardBlocked;
  assert.ok(flag,'guard flag object was never created');
  assert.equal(flag.version,5);
  assert.equal(flag.camera,true);
  assert.equal(flag.microphone,true);
  assert.equal(flag.geolocation,true);
});

test('getUserMedia is actually blocked with NotAllowedError',async()=>{
  const {navigator}=runGuardSource();
  await assert.rejects(()=>navigator.mediaDevices.getUserMedia({video:true}),/Blocked by OrbitQA Strict Privacy Mode/);
});

test('geolocation is blocked rather than prompted',()=>{
  const {navigator}=runGuardSource();
  let code=null;
  navigator.geolocation.getCurrentPosition(()=>{},(error)=>{code=error.code;});
  assert.equal(code,1);
});

test('the full re-assert delay table is scheduled',()=>{
  const {timers}=runGuardSource();
  const delays=timers.map((timer)=>timer.ms);
  for(const expected of [0,16,50,120,300,700,1500,3000,6000])assert.ok(delays.includes(expected),`missing re-assert at ${expected}ms`);
});

test('late document events also re-assert',()=>{
  const {listeners}=runGuardSource();
  const names=listeners.map(([name])=>name);
  for(const expected of ['readystatechange','DOMContentLoaded','load'])assert.ok(names.includes(expected));
});

test('a spoofer answers geolocation with the configured coordinates',()=>{
  const {navigator}=runGuardSource({geolocation:{latitude:51.5074,longitude:-0.1278}});
  let position=null;
  navigator.geolocation.getCurrentPosition((value)=>{position=value;},()=>{});
  assert.equal(position.coords.latitude,51.5074);
  assert.equal(position.coords.longitude,-0.1278);
});

test('permissions.query reports denied for guarded names',async()=>{
  const {navigator}=runGuardSource();
  const status=await navigator.permissions.query({name:'camera'});
  assert.equal(status.state,'denied');
});