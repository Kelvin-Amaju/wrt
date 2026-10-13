const test=require('node:test');
const assert=require('node:assert/strict');
const {validTimezoneId,resolveProxyTimezoneFromExitIp,synchronizeProxyTimezone}=require('./proxy-timezone-consistency.cjs');

test('validTimezoneId accepts IANA zones and rejects junk',()=>{assert.equal(validTimezoneId('America/New_York'),'America/New_York');assert.equal(validTimezoneId('not/a-zone'),'');});

test('resolves exact timezone from proxy exit IP through browser context',async()=>{
  const page={goto:async()=>({text:async()=>JSON.stringify({success:true,country:'United States',country_code:'US',region:'California',city:'Los Angeles',latitude:34.05,longitude:-118.24,timezone:{id:'America/Los_Angeles'}})}),close:async()=>{}};
  const context={newPage:async()=>page};
  const geo=await resolveProxyTimezoneFromExitIp({context,proxiedIp:'203.0.113.10'});
  assert.equal(geo.timezoneId,'America/Los_Angeles');assert.equal(geo.city,'Los Angeles');
});

test('Chromium synchronization applies actual proxy timezone and hooks pages',async()=>{
  const sends=[];const listeners={};
  const first={isClosed:()=>false,goto:async()=>({text:async()=>JSON.stringify({success:true,country:'Germany',country_code:'DE',region:'Berlin',city:'Berlin',latitude:52.5,longitude:13.4,timezone:{id:'Europe/Berlin'}})}),close:async()=>{}};
  const context={
    pages:()=>[first],newPage:async()=>first,on:(name,fn)=>{listeners[name]=fn;},
    newCDPSession:async()=>({send:async(method,payload)=>sends.push([method,payload]),detach:async()=>{}}),
  };
  const result=await synchronizeProxyTimezone({context,browserEngine:'chromium',proxiedIp:'198.51.100.7',currentTimezoneId:'UTC'});
  assert.equal(result.status,'PASS');assert.equal(result.timezoneId,'Europe/Berlin');assert.equal(result.changed,true);
  assert.ok(sends.some(([,p])=>p.timezoneId==='Europe/Berlin'));assert.equal(typeof listeners.page,'function');
});
