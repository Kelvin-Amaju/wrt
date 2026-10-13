const test=require('node:test');
const assert=require('node:assert/strict');

test('paginates until next is null and sends bearer token', async()=>{
  const {createSpotifyCatalogClient}=require('./spotify-catalog-client.cjs');
  const calls=[];
  const pages=[
    {items:[{id:'1'}],next:'https://api.spotify.com/v1/next?page=2'},
    {items:[{id:'2'}],next:null},
  ];
  const client=createSpotifyCatalogClient({auth:{getValidAccessToken:async()=> 'TOKEN'},fetchImpl:async(url,opts)=>{calls.push({url:String(url),opts}); return {ok:true,status:200,json:async()=>pages[calls.length-1]};},sleep:async()=>{}});
  const items=await client.paginate('/artists/a/albums?limit=1');
  assert.deepEqual(items,[{id:'1'},{id:'2'}]);
  assert.equal(calls.length,2);
  assert.equal(calls[0].opts.headers.Authorization,'Bearer TOKEN');
  assert.equal(calls[1].url,'https://api.spotify.com/v1/next?page=2');
});

test('retries 429 with Retry-After and 5xx with bounded backoff', async()=>{
  const {createSpotifyCatalogClient}=require('./spotify-catalog-client.cjs');
  const sleeps=[]; let count=0;
  const responses=[
    {ok:false,status:429,headers:{get:k=>k.toLowerCase()==='retry-after'?'2':null},text:async()=> 'rate'},
    {ok:false,status:502,headers:{get:()=>null},text:async()=> 'bad gateway'},
    {ok:true,status:200,headers:{get:()=>null},json:async()=>({ok:true})},
  ];
  const client=createSpotifyCatalogClient({auth:{getValidAccessToken:async()=> 'SECRET'},fetchImpl:async()=>responses[count++],sleep:async ms=>sleeps.push(ms),maxRetries:3});
  assert.deepEqual(await client.requestJson('/me'),{ok:true});
  assert.deepEqual(sleeps,[2000,500]);
});

test('does not retry non-transient 400 and redacts token from errors', async()=>{
  const {createSpotifyCatalogClient}=require('./spotify-catalog-client.cjs');
  let count=0;
  const client=createSpotifyCatalogClient({auth:{getValidAccessToken:async()=> 'SUPER-SECRET'},fetchImpl:async()=>{count++; return {ok:false,status:400,headers:{get:()=>null},text:async()=>'{"token":"SUPER-SECRET"}'};},sleep:async()=>{}});
  await assert.rejects(()=>client.requestJson('/bad'),err=>{assert.doesNotMatch(err.message,/SUPER-SECRET/); assert.match(err.message,/400/); return true;});
  assert.equal(count,1);
});

test('aborts before and during pagination', async()=>{
  const {createSpotifyCatalogClient}=require('./spotify-catalog-client.cjs');
  const controller=new AbortController(); controller.abort();
  const client=createSpotifyCatalogClient({auth:{getValidAccessToken:async()=> 'T'},fetchImpl:async()=>{throw new Error('must not call')},sleep:async()=>{}});
  await assert.rejects(()=>client.paginate('/x',{signal:controller.signal}),/cancelled|aborted/i);
});

test('entity helpers use complete pagination for artist releases and release tracks', async()=>{
  const {createSpotifyCatalogClient}=require('./spotify-catalog-client.cjs');
  const seen=[];
  const client=createSpotifyCatalogClient({auth:{getValidAccessToken:async()=> 'T'},fetchImpl:async(url)=>{seen.push(String(url)); return {ok:true,status:200,json:async()=>({items:[],next:null})};},sleep:async()=>{}});
  await client.getArtistReleases('artist-1');
  await client.getReleaseTracks('album-1');
  assert.match(seen[0],/artists\/artist-1\/albums/);
  assert.match(seen[0],/include_groups=album%2Csingle%2Cappears_on%2Ccompilation/);
  assert.match(seen[1],/albums\/album-1\/tracks/);
});
