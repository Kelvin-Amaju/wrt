const test=require('node:test');
const assert=require('node:assert/strict');
const {beginProxyAllocation,endProxyAllocation,createGuardedFetch,_test}=require('./network-route-guard.cjs');
const {createProxyPoolService}=require('./proxy-pool-service.cjs');

test('backend direct fetch is blocked while a proxied allocation is active and restored after release',async()=>{
  _test.resetForTests(); let calls=0;
  const fetchImpl=async()=>{calls++;return {ok:true}};
  const guarded=createGuardedFetch(fetchImpl);
  await guarded('https://example.test');
  beginProxyAllocation('alloc-1',{kind:'static'});
  await assert.rejects(()=>guarded('https://example.test'),/direct-route fallback is disabled/i);
  assert.equal(calls,1);
  endProxyAllocation('alloc-1');
  await guarded('https://example.test');
  assert.equal(calls,2);
  _test.resetForTests();
});

test('proxy allocation fails closed when verified country/timezone metadata cannot be obtained',async()=>{
  _test.resetForTests();
  const row={id:'p1',kind:'static',protocol:'http',hostname:'proxy.test',port:8080,enabled:true,health:'live',source:'manual',failureCount:0,lastCheckedAt:new Date(0).toISOString()};
  const store={
    async list(kind){return !kind||kind===row.kind?[{...row}]:[]},
    async get(){return {...row}},
    async getRuntimeProxy(){return {...row,password:''}},
    async saveHealth(_id,result){Object.assign(row,result);return {...row}},
    async markUsed(){},
    async update(_id,patch){Object.assign(row,patch);return {...row}},
  };
  const svc=createProxyPoolService({store,healthChecker:{async checkProxy(){return {health:'live',latencyMs:50,observedIp:'203.0.113.8',failureCount:0,checkedAt:new Date().toISOString(),nextCheckAt:new Date(Date.now()+60000).toISOString()}}},now:Date.now,setTimer:()=>0,clearTimer:()=>{}});
  await assert.rejects(()=>svc.allocate('static','acct'),/No eligible static proxy/i);
  _test.resetForTests();
});

test('proxy allocation carries verified country and timezone and activates guard until release',async()=>{
  _test.resetForTests();
  const now=Date.now();
  const row={id:'p1',kind:'static',protocol:'http',hostname:'proxy.test',port:8080,enabled:true,health:'live',source:'manual',failureCount:0,lastCheckedAt:new Date(now).toISOString(),countryCode:'GB',timezoneId:'Europe/London'};
  const store={
    async list(kind){return !kind||kind===row.kind?[{...row}]:[]}, async get(){return {...row}}, async getRuntimeProxy(){return {...row,password:''}},
    async saveHealth(_id,result){Object.assign(row,result);return {...row}}, async markUsed(){}, async update(_id,patch){Object.assign(row,patch);return {...row}},
  };
  const svc=createProxyPoolService({store,healthChecker:{async checkProxy(){throw new Error('should not retest fresh geo')}} ,now:()=>now,setTimer:()=>0,clearTimer:()=>{}});
  const a=await svc.allocate('static','acct');
  assert.equal(a.geoVerified,true); assert.equal(a.countryCode,'GB'); assert.equal(a.timezoneId,'Europe/London');
  const guarded=createGuardedFetch(async()=>({ok:true}));
  await assert.rejects(()=>guarded('https://example.test'),/blocked while proxied QA sessions are active/i);
  await svc.release(a.allocationId);
  await guarded('https://example.test');
  _test.resetForTests();
});
