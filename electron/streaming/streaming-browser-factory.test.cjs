const test=require('node:test'); const assert=require('node:assert/strict'); const {createStreamingBrowserFactory}=require('./streaming-browser-factory.cjs');
const testBrowserPolicyResolver=({deviceMode:mode})=>({engine:'chromium',browserFamily:'chrome',browserLabel:mode==='android'?'Google Chrome · Android compatibility':mode==='ios'?'Google Chrome · iOS mobile compatibility':'Google Chrome',executablePath:'C:/Chrome/chrome.exe',compatibilityMode:mode!=='desktop'});

test('browser factory allocates configured proxy before launching and releases it',async()=>{
  const order=[];
  const page={goto:async()=>{},evaluate:async()=>({userAgent:'UA',platform:'Win32',maxTouchPoints:0,viewport:{width:1280,height:720},devicePixelRatio:1,locale:'en-US',timezoneId:'UTC'}),textContent:async()=> '2.2.2.2'};
  const context={addInitScript:async()=>{},newPage:async()=>page,close:async()=>order.push('context-close')};
  const browser={newContext:async()=>{order.push('context');return context},close:async()=>order.push('browser-close')};
  const chromium={launch:async(opts)=>{order.push(opts.proxy?'launch-proxy':'launch-direct');return browser}};
  const proxyPoolService={allocate:async()=>{order.push('allocate');return {allocationId:'al',proxyKind:'static',server:'http://p:1',username:'u',password:'p'}},release:async()=>order.push('release'),getDirectIp:async()=> '1.1.1.1'};
  const factory=createStreamingBrowserFactory({chromium,browserPolicyResolver:testBrowserPolicyResolver,proxyPoolService,verifyRoute:async()=>({directIp:'1.1.1.1',proxiedIp:'2.2.2.2'}),collectPrivacy:async()=>({overall:'pass',blocked:false,observed:{literalIpCandidates:[],locale:'en-US',timezoneId:'UTC'}})});
  const s=await factory.open({runId:'r',workUnit:{workId:'w'},account:{proxySource:'static'},executionMode:'background'});
  assert.deepEqual(order.slice(0,3),['allocate','launch-proxy','context']);
  const integrity=await s.finalIntegrity(); assert.equal(integrity.blocked,false);
  await s.close(); assert.ok(order.includes('release'));
});

test('browser factory blocks a required proxy that matches direct route',async()=>{
  const page={}; const context={addInitScript:async()=>{},newPage:async()=>page,close:async()=>{}}; const browser={newContext:async()=>context,close:async()=>{}};
  const factory=createStreamingBrowserFactory({chromium:{launch:async()=>browser},browserPolicyResolver:testBrowserPolicyResolver,proxyPoolService:{allocate:async()=>({allocationId:'a',proxyKind:'rotating',server:'http://p'}),release:async()=>{},getDirectIp:async()=> '1.1.1.1'},verifyRoute:async()=>({directIp:'1.1.1.1',proxiedIp:'1.1.1.1'}),collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}})});
  await assert.rejects(()=>factory.open({runId:'r',workUnit:{workId:'w'},account:{proxySource:'rotating'}}),/direct route|Proxy route/i);
});

test('browser factory imports an authorized saved cookie session before platform navigation without exposing secret values',async()=>{
  const imported=[]; const secret='super-secret-cookie-value';
  const page={};
  const context={addInitScript:async()=>{},addCookies:async cookies=>imported.push(...cookies),newPage:async()=>page,close:async()=>{}};
  const browser={newContext:async()=>context,close:async()=>{}};
  const factory=createStreamingBrowserFactory({chromium:{launch:async()=>browser},browserPolicyResolver:testBrowserPolicyResolver,collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}})});
  const session=await factory.open({runId:'r',workUnit:{workId:'w'},account:{proxySource:'none',sessionSecret:JSON.stringify([{name:'sp_dc',value:secret,domain:'.spotify.com',path:'/',secure:true,httpOnly:true}])}});
  assert.equal(imported.length,1);
  assert.equal(imported[0].name,'sp_dc');
  assert.equal(imported[0].value,secret);
  assert.equal(JSON.stringify(session.privacyReport).includes(secret),false);
  await session.close();
});

test('browser factory applies Android viewport and touch emulation while preserving installed Chromium media identity',async()=>{
  let contextOptions=null;
  const page={};
  const context={addInitScript:async()=>{},newPage:async()=>page,close:async()=>{}};
  const browser={newContext:async options=>{contextOptions=options;return context;},close:async()=>{}};
  const factory=createStreamingBrowserFactory({chromium:{launch:async()=>browser},browserPolicyResolver:testBrowserPolicyResolver,collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}})});
  const session=await factory.open({runId:'r',workUnit:{workId:'w',deviceMode:'android',deviceProfile:'Pixel 7'},account:{proxySource:'none'}});
  assert.equal(contextOptions.isMobile,true);
  assert.equal(contextOptions.hasTouch,true);
  assert.equal(contextOptions.viewport.width,412);
  assert.equal(contextOptions.userAgent,undefined,'mobile QA keeps the installed Chromium user agent for media compatibility');
  await session.close();
});

test('browser factory uses installed Chromium with iPhone viewport and touch emulation for iOS compatibility mode',async()=>{
  const launches=[]; let contextOptions=null;
  const page={};
  const context={addInitScript:async()=>{},newPage:async()=>page,close:async()=>{}};
  const browser={version:()=> '153.0.8012.10',newContext:async options=>{contextOptions=options;return context;},close:async()=>{}};
  const chromium={launch:async()=>{launches.push('chromium');return browser}};
  const devices={'iPhone 13':{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile Safari/604.1',viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,defaultBrowserType:'webkit'}};
  const factory=createStreamingBrowserFactory({chromium,devices,browserPolicyResolver:testBrowserPolicyResolver,collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}})});
  const session=await factory.open({runId:'r',workUnit:{workId:'w',deviceMode:'ios',deviceProfile:'iPhone 13'},account:{proxySource:'none'}});
  assert.deepEqual(launches,['chromium']);
  assert.equal(contextOptions.isMobile,true);
  assert.equal(contextOptions.hasTouch,true);
  assert.equal(contextOptions.viewport.width,390);
  assert.equal(contextOptions.userAgent,undefined,'iOS compatibility mode keeps the installed Chromium user agent for protected-media compatibility');
  await session.close();
});

test('browser factory launches installed Chrome for desktop streaming sessions',async()=>{
  let launchOptions=null;
  const page={};
  const context={addInitScript:async()=>{},newPage:async()=>page,close:async()=>{}};
  const browser={version:()=> '153.0.8012.10',newContext:async()=>context,close:async()=>{}};
  const chromium={launch:async options=>{launchOptions=options;return browser}};
  const factory=createStreamingBrowserFactory({
    chromium,
    browserPolicyResolver:()=>({engine:'chromium',browserFamily:'chrome',browserLabel:'Google Chrome',executablePath:'C:/Chrome/chrome.exe',compatibilityMode:false}),
    collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}}),
  });
  const session=await factory.open({runId:'r',workUnit:{workId:'w',deviceMode:'desktop'},account:{proxySource:'none'}});
  assert.equal(launchOptions.executablePath,'C:/Chrome/chrome.exe');
  assert.equal(session.browserPolicy.browserLabel,'Google Chrome');
  await session.close();
});

test('Android compatibility does not spoof a mobile UA that can break protected web playback',async()=>{
  let contextOptions=null;
  const page={};
  const context={addInitScript:async()=>{},newPage:async()=>page,close:async()=>{}};
  const browser={version:()=> '153.0.8012.10',newContext:async options=>{contextOptions=options;return context;},close:async()=>{}};
  const chromium={launch:async()=>browser};
  const factory=createStreamingBrowserFactory({
    chromium,
    browserPolicyResolver:()=>({engine:'chromium',browserFamily:'chrome',browserLabel:'Google Chrome · Android compatibility',executablePath:'C:/Chrome/chrome.exe',compatibilityMode:true}),
    collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}}),
  });
  const session=await factory.open({runId:'r',workUnit:{workId:'w',deviceMode:'android',deviceProfile:'Pixel 7'},account:{proxySource:'none'}});
  assert.equal(contextOptions.userAgent,undefined);
  assert.equal(contextOptions.isMobile,true);
  assert.equal(contextOptions.hasTouch,true);
  await session.close();
});

test('iOS compatibility keeps selected viewport/touch without applying Safari identity to Chromium',async()=>{
  let contextOptions=null;
  const page={};
  const context={addInitScript:async()=>{},newPage:async()=>page,close:async()=>{}};
  const browser={newContext:async options=>{contextOptions=options;return context;},close:async()=>{}};
  const devices={'iPhone 13':{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile Safari/604.1',viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,defaultBrowserType:'webkit'}};
  const factory=createStreamingBrowserFactory({chromium:{launch:async()=>browser},devices,browserPolicyResolver:testBrowserPolicyResolver,collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}})});
  const session=await factory.open({runId:'r',workUnit:{workId:'w',deviceMode:'ios',deviceProfile:'iPhone 13'},account:{proxySource:'none'}});
  assert.equal(contextOptions.viewport.width,390);
  assert.equal(contextOptions.isMobile,true);
  assert.equal(contextOptions.hasTouch,true);
  assert.equal(contextOptions.userAgent,undefined);
  await session.close();
});

test('mobile streaming reuses the durable account-specific profile without overwriting it from a stale saved snapshot',async()=>{
  let persistentCalls=0,launchCalls=0,launchDir='',launchOptions=null,restoredState=null;
  const initialPage={close:async()=>{}};
  const page={};
  const browser={version:()=> '153.0.8012.10'};
  const context={browser:()=>browser,pages:()=>[initialPage],addInitScript:async()=>{},newPage:async()=>page,setStorageState:async state=>{restoredState=state;},addCookies:async()=>{},close:async()=>{}};
  const chromium={launchPersistentContext:async(dir,options)=>{persistentCalls++;launchDir=dir;launchOptions=options;return context;},launch:async()=>{launchCalls++;throw new Error('mobile persistent QA must not use an ephemeral browser');}};
  const snapshot={cookies:[{name:'sid',value:'abc',domain:'.spotify.com',path:'/'}],origins:[]};
  const saved=JSON.stringify({version:2,kind:'playwright-storage-state',storageState:snapshot});
  const factory=createStreamingBrowserFactory({chromium,browserPolicyResolver:testBrowserPolicyResolver,profileBaseDir:'C:/OrbitQA/profiles',collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}})});
  const session=await factory.open({runId:'r',workUnit:{workId:'w',deviceMode:'android',deviceProfile:'Pixel 7'},account:{id:'a1',platform:'spotify',proxySource:'none',sessionSecret:saved},usePersistentProfile:true});
  assert.equal(persistentCalls,1);
  assert.equal(launchCalls,0);
  assert.match(launchDir,/spotify[\/]a1$/);
  assert.equal(launchOptions.viewport.width,412);
  assert.equal(launchOptions.isMobile,true);
  assert.equal(launchOptions.hasTouch,true);
  assert.equal(launchOptions.userAgent,undefined);
  assert.equal(restoredState,null);
  assert.equal(session.persistentProfile,true);
  await session.close();
});

test('mobile persistent account profile receives the account configured proxy',async()=>{
  let launchOptions=null;
  const initialPage={close:async()=>{}}; const page={}; const browser={version:()=> '153.0.8012.10'};
  const context={browser:()=>browser,pages:()=>[initialPage],addInitScript:async()=>{},newPage:async()=>page,addCookies:async()=>{},close:async()=>{}};
  const chromium={launchPersistentContext:async(_dir,options)=>{launchOptions=options;return context;}};
  const factory=createStreamingBrowserFactory({
    chromium,profileBaseDir:'C:/OrbitQA/profiles',browserPolicyResolver:testBrowserPolicyResolver,
    proxyPoolService:{allocate:async()=>({allocationId:'p1',proxyKind:'rotating',server:'http://127.0.0.1:9100',username:'u',password:'p',countryCode:'NG'}),release:async()=>{}},
    verifyRoute:async()=>({directIp:'1.1.1.1',proxiedIp:'2.2.2.2'}),collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}}),
  });
  const session=await factory.open({runId:'r',workUnit:{workId:'w',deviceMode:'ios',deviceProfile:'iPhone 13'},account:{id:'a1',platform:'spotify',proxySource:'rotating'},usePersistentProfile:true});
  assert.deepEqual(launchOptions.proxy,{server:'http://127.0.0.1:9100',username:'u',password:'p'});
  assert.ok((launchOptions.args||[]).includes('--disable-quic'));
  assert.ok((launchOptions.args||[]).includes('--disable-background-networking'));
  assert.ok((launchOptions.args||[]).some(arg=>String(arg).includes('disable_non_proxied_udp')));
  assert.equal((launchOptions.args||[]).some(arg=>String(arg).startsWith('--host-resolver-rules=')), false);
  assert.equal(launchOptions.locale,'en-NG');
  assert.equal(launchOptions.timezoneId,'Africa/Lagos');
  assert.equal(launchOptions.extraHTTPHeaders['Accept-Language'],'en-NG,en;q=0.9');
  assert.equal(launchOptions.viewport.width,390);
  assert.equal(session.persistentProfile,true);
  await session.close();
});

test('browser factory accepts a raw cookie header for the saved platform and installs it before login',async()=>{
  const imported=[];
  const page={};
  const context={addInitScript:async()=>{},addCookies:async cookies=>imported.push(...cookies),newPage:async()=>page,close:async()=>{}};
  const browser={newContext:async()=>context,close:async()=>{}};
  const factory=createStreamingBrowserFactory({chromium:{launch:async()=>browser},browserPolicyResolver:testBrowserPolicyResolver,collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}})});
  const session=await factory.open({runId:'r',workUnit:{workId:'w'},account:{platform:'spotify',proxySource:'none',sessionSecret:'sp_dc=abc123; sp_key=def456'}});
  assert.deepEqual(imported.map(row=>[row.name,row.value]),[['sp_dc','abc123'],['sp_key','def456']]);
  assert.ok(imported.every(row=>row.url==='https://open.spotify.com/'));
  await session.close();
});

test('browser factory restores a Smart Login v2 Playwright storage-state envelope at context creation',async()=>{
  let contextOptions=null;
  const page={};
  const context={addInitScript:async()=>{},newPage:async()=>page,close:async()=>{}};
  const browser={newContext:async options=>{contextOptions=options;return context;},close:async()=>{}};
  const snapshot={cookies:[{name:'sid',value:'abc',domain:'.spotify.com',path:'/'}],origins:[{origin:'https://open.spotify.com',localStorage:[{name:'theme',value:'dark'}]}]};
  const envelope=JSON.stringify({version:2,kind:'playwright-storage-state',capturedAt:'2026-09-18T14:00:00.000Z',storageState:snapshot});
  const factory=createStreamingBrowserFactory({chromium:{launch:async()=>browser},browserPolicyResolver:testBrowserPolicyResolver,collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}})});
  const session=await factory.open({runId:'r',workUnit:{workId:'w'},account:{platform:'spotify',proxySource:'none',sessionSecret:envelope}});
  assert.deepEqual(contextOptions.storageState,snapshot);
  await session.close();
});

test('browser factory can ignore a saved session to create a clean credential-login context',async()=>{
  let contextOptions=null;
  const page={};
  const context={addInitScript:async()=>{},addCookies:async()=>{throw new Error('legacy cookies must not be installed')},newPage:async()=>page,close:async()=>{}};
  const browser={newContext:async options=>{contextOptions=options;return context;},close:async()=>{}};
  const snapshot={cookies:[{name:'sid',value:'abc',domain:'.spotify.com',path:'/'}],origins:[{origin:'https://open.spotify.com',localStorage:[{name:'x',value:'1'}]}]};
  const envelope=JSON.stringify({version:2,kind:'playwright-storage-state',storageState:snapshot});
  const factory=createStreamingBrowserFactory({chromium:{launch:async()=>browser},browserPolicyResolver:testBrowserPolicyResolver,collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}})});
  const session=await factory.open({runId:'r',workUnit:{workId:'w'},account:{platform:'spotify',proxySource:'none',sessionSecret:envelope},ignoreStoredSession:true});
  assert.equal(contextOptions.storageState,undefined);
  await session.close();
});

test('normal streaming opens isolated browser contexts per account and applies only that account session',async()=>{
  const contexts=[];
  const browser={
    version:()=> '153.0.8012.10',
    newContext:async options=>{const context={options,addInitScript:async()=>{},addCookies:async()=>{},newPage:async()=>({}),close:async()=>{}};contexts.push(context);return context;},
    close:async()=>{},
  };
  const launches=[];
  const chromium={launch:async options=>{launches.push(options);return browser;},launchPersistentContext:async()=>{throw new Error('streaming run must not share a persistent browser profile');}};
  const sessionA=JSON.stringify({version:2,kind:'playwright-storage-state',storageState:{cookies:[{name:'sid',value:'A',domain:'.spotify.com',path:'/'}],origins:[]}});
  const sessionB=JSON.stringify({version:2,kind:'playwright-storage-state',storageState:{cookies:[{name:'sid',value:'B',domain:'.spotify.com',path:'/'}],origins:[]}});
  const factory=createStreamingBrowserFactory({chromium,profileBaseDir:'/orbitqa/profiles',browserPolicyResolver:testBrowserPolicyResolver,collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}})});
  const a=await factory.open({runId:'r',workUnit:{workId:'wa'},account:{id:'a1',platform:'spotify',proxySource:'none',sessionSecret:sessionA}});
  const b=await factory.open({runId:'r',workUnit:{workId:'wb'},account:{id:'a2',platform:'spotify',proxySource:'none',sessionSecret:sessionB}});
  assert.equal(launches.length,2);
  assert.equal(contexts.length,2);
  assert.equal(contexts[0].options.storageState.cookies[0].value,'A');
  assert.equal(contexts[1].options.storageState.cookies[0].value,'B');
  assert.notEqual(contexts[0],contexts[1]);
  assert.equal(a.persistentProfile,false);
  assert.equal(b.persistentProfile,false);
  await a.close();await b.close();
});

test('visible Chromium streaming uses the durable persistent account profile as the session source of truth',async()=>{
  let launchedDir=''; let launchOptions=null; let restoredState=null; let normalLaunchCalled=false;
  const page={};
  const browser={version:()=> '153.0.8012.10'};
  const context={
    browser:()=>browser,
    pages:()=>[page],
    addInitScript:async()=>{},
    setStorageState:async state=>{restoredState=state;},
    addCookies:async()=>{},
    close:async()=>{},
  };
  const chromium={
    launch:async()=>{normalLaunchCalled=true;throw new Error('ephemeral launch must not be used');},
    launchPersistentContext:async(dir,options)=>{launchedDir=dir;launchOptions=options;return context;},
  };
  const snapshot={cookies:[{name:'sid',value:'abc',domain:'.spotify.com',path:'/'}],origins:[{origin:'https://open.spotify.com',localStorage:[{name:'device',value:'ready'}]}]};
  const envelope=JSON.stringify({version:2,kind:'playwright-storage-state',storageState:snapshot});
  const factory=createStreamingBrowserFactory({
    chromium,
    profileBaseDir:'/orbitqa/profiles',
    browserPolicyResolver:()=>({engine:'chromium',browserFamily:'chrome',browserLabel:'Google Chrome',executablePath:'C:/Chrome/chrome.exe',compatibilityMode:false}),
    collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}}),
  });
  const session=await factory.open({runId:'r',workUnit:{workId:'w',deviceMode:'desktop'},account:{id:'acct/one',platform:'spotify',proxySource:'none',sessionSecret:envelope},executionMode:'visible',usePersistentProfile:true});
  assert.equal(normalLaunchCalled,false);
  assert.match(launchedDir,/spotify[\\/]acct_one$/);
  assert.equal(launchOptions.executablePath,'C:/Chrome/chrome.exe');
  assert.equal(launchOptions.serviceWorkers,'allow');
  assert.equal(restoredState,null);
  assert.equal(session.persistentProfile,true);
  assert.equal(session.profileDir,launchedDir);
  await session.close();
});

test('persistent account profile receives the assigned proxy at browser launch',async()=>{
  let launchOptions=null;
  const page={}; const browser={version:()=> '153.0.8012.10'};
  const context={browser:()=>browser,pages:()=>[page],addInitScript:async()=>{},addCookies:async()=>{},close:async()=>{}};
  const chromium={launchPersistentContext:async(_dir,options)=>{launchOptions=options;return context;}};
  const factory=createStreamingBrowserFactory({
    chromium,
    profileBaseDir:'/orbitqa/profiles',
    browserPolicyResolver:()=>({engine:'chromium',browserFamily:'chrome',browserLabel:'Google Chrome',executablePath:'C:/Chrome/chrome.exe',compatibilityMode:false}),
    proxyPoolService:{allocate:async()=>({allocationId:'p1',proxyKind:'static',server:'http://127.0.0.1:9000',username:'u',password:'p'}),release:async()=>{}},
    verifyRoute:async()=>({directIp:'1.1.1.1',proxiedIp:'2.2.2.2'}),
    collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}}),
  });
  const session=await factory.open({runId:'r',workUnit:{workId:'w',deviceMode:'desktop'},account:{id:'a1',platform:'spotify',proxySource:'static'},executionMode:'visible',usePersistentProfile:true});
  assert.deepEqual(launchOptions.proxy,{server:'http://127.0.0.1:9000',username:'u',password:'p'});
  await session.close();
});

test('ignoreStoredSession skips injecting saved storage into a persistent capture profile',async()=>{
  let clearedState=null;
  const page={}; const browser={version:()=> '153.0.8012.10'};
  const context={browser:()=>browser,pages:()=>[page],addInitScript:async()=>{},setStorageState:async state=>{clearedState=state;},close:async()=>{}};
  const chromium={launchPersistentContext:async()=>context};
  const snapshot={cookies:[{name:'sid',value:'stale',domain:'.spotify.com',path:'/'}],origins:[{origin:'https://open.spotify.com',localStorage:[{name:'old',value:'1'}]}]};
  const envelope=JSON.stringify({version:2,kind:'playwright-storage-state',storageState:snapshot});
  const factory=createStreamingBrowserFactory({
    chromium,profileBaseDir:'/orbitqa/profiles',
    browserPolicyResolver:()=>({engine:'chromium',browserFamily:'chrome',browserLabel:'Google Chrome',executablePath:'C:/Chrome/chrome.exe',compatibilityMode:false}),
    collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}}),
  });
  const session=await factory.open({runId:'r',workUnit:{workId:'w',deviceMode:'desktop'},account:{id:'a1',platform:'spotify',proxySource:'none',sessionSecret:envelope},ignoreStoredSession:true,usePersistentProfile:true});
  assert.equal(clearedState,null);
  await session.close();
});

test('persistent account profile creates a fresh page after installing Strict Privacy guard before privacy preflight',async()=>{
  const steps=[];
  const initialPage={kind:'initial',close:async()=>steps.push('close-initial')};
  const guardedPage={kind:'guarded'};
  const browser={version:()=> '153.0.8012.10'};
  let guardInstalled=false;
  const context={
    browser:()=>browser,
    pages:()=>[initialPage],
    addInitScript:async()=>{guardInstalled=true;steps.push('guard-installed');},
    newPage:async()=>{steps.push('new-page');assert.equal(guardInstalled,true);return guardedPage;},
    addCookies:async()=>{},
    close:async()=>{},
  };
  const chromium={launchPersistentContext:async()=>context};
  const factory=createStreamingBrowserFactory({
    chromium,profileBaseDir:'/orbitqa/profiles',
    browserPolicyResolver:()=>({engine:'chromium',browserFamily:'chrome',browserLabel:'Google Chrome',executablePath:'C:/Chrome/chrome.exe',compatibilityMode:false}),
    collectPrivacy:async({page})=>{
      steps.push(`privacy-${page?.kind||'unknown'}`);
      assert.equal(page,guardedPage,'privacy preflight must run on a page created after addInitScript');
      return {blocked:false,observed:{literalIpCandidates:[],permissionStates:{camera:'denied',microphone:'denied',geolocation:'denied',notifications:'denied'}}};
    },
  });
  const session=await factory.open({runId:'r',workUnit:{workId:'w',deviceMode:'desktop'},account:{id:'a1',platform:'spotify',proxySource:'none'},executionMode:'visible',usePersistentProfile:true});
  assert.equal(session.page,guardedPage);
  assert.deepEqual(steps.slice(0,4),['guard-installed','new-page','close-initial','privacy-guarded']);
  await session.close();
});

test('persistent Chromium streaming leaves component updates enabled so Spotify Widevine DRM can initialize',async()=>{
  let launchOptions=null;
  const initialPage={close:async()=>{}};
  const guardedPage={};
  const browser={version:()=> '153.0.8012.10'};
  const context={
    browser:()=>browser,
    pages:()=>[initialPage],
    addInitScript:async()=>{},
    newPage:async()=>guardedPage,
    addCookies:async()=>{},
    close:async()=>{},
  };
  const chromium={launchPersistentContext:async(_dir,options)=>{launchOptions=options;return context;}};
  const factory=createStreamingBrowserFactory({
    chromium,profileBaseDir:'/orbitqa/profiles',
    browserPolicyResolver:()=>({engine:'chromium',browserFamily:'chrome',browserLabel:'Google Chrome',executablePath:'C:/Chrome/chrome.exe',compatibilityMode:false}),
    collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}}),
  });
  const session=await factory.open({runId:'r',workUnit:{workId:'w',deviceMode:'desktop'},account:{id:'a1',platform:'spotify',proxySource:'none'},executionMode:'visible',usePersistentProfile:true});
  assert.ok(Array.isArray(launchOptions.ignoreDefaultArgs));
  assert.ok(launchOptions.ignoreDefaultArgs.includes('--disable-component-update'));
  await session.close();
});

test('manual login launches ordinary installed Chrome with the durable account-specific profile and without automation flags',async()=>{
  const spawns=[];
  const child={once:()=>{},kill:()=>{}};
  const browserPolicyResolver=()=>({engine:'chromium',browserLabel:'Google Chrome',executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
  const factory=createStreamingBrowserFactory({
    chromium:{launch:async()=>({version:()=> '154.0.0.0',newContext:async()=>({newPage:async()=>({}),close:async()=>{}}),close:async()=>{}}),launchPersistentContext:async()=>({})},
    proxyPoolService:null,
    browserPolicyResolver,
    profileBaseDir:'C:\\OrbitQA\\profiles',
    spawnImpl:(exe,args,options)=>{spawns.push({exe,args,options});return child;},
  });
  const handle=await factory.openManualLogin({account:{id:'a1',platform:'spotify',proxySource:'none'},url:'https://accounts.spotify.com/en/login',profileToken:'login-1'});
  assert.equal(handle.browserLabel,'Google Chrome');
  assert.equal(spawns.length,1);
  assert.equal(spawns[0].exe,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.ok(spawns[0].args.includes('https://accounts.spotify.com/en/login'));
  const userDirArg=spawns[0].args.find(arg=>arg.startsWith('--user-data-dir='));
  assert.ok(userDirArg);
  assert.match(userDirArg,/profiles[\\/]spotify[\\/]a1/i);
  assert.doesNotMatch(userDirArg,/manual-login/i);
  assert.equal(spawns[0].args.includes('--no-sandbox'),false);
  assert.equal(spawns[0].args.some(arg=>arg.includes('remote-debugging')),false);
});

test('persistent profile blocks a second simultaneous launch and reports a simple profile-lock message',async()=>{
  const page={};const browser={version:()=> '153.0.8012.10'};
  const context={browser:()=>browser,pages:()=>[],addInitScript:async()=>{},newPage:async()=>page,close:async()=>{}};
  const factory=createStreamingBrowserFactory({chromium:{launchPersistentContext:async()=>context},profileBaseDir:'/orbitqa/profiles',browserPolicyResolver:testBrowserPolicyResolver,collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}})});
  const first=await factory.open({runId:'r1',workUnit:{workId:'w1'},account:{id:'a1',platform:'spotify',proxySource:'none'},usePersistentProfile:true});
  await assert.rejects(()=>factory.open({runId:'r2',workUnit:{workId:'w2'},account:{id:'a1',platform:'spotify',proxySource:'none'},usePersistentProfile:true}),/spotify profile is locked by another browser session/i);
  await first.close();
});

test('persistent Chrome startup retries exactly once and then succeeds',async()=>{
  let attempts=0;const page={};const browser={version:()=> '153.0.8012.10'};
  const context={browser:()=>browser,pages:()=>[],addInitScript:async()=>{},newPage:async()=>page,close:async()=>{}};
  const factory=createStreamingBrowserFactory({chromium:{launchPersistentContext:async()=>{attempts++;if(attempts===1)throw new Error('process did exit before attachment');return context;}},profileBaseDir:'/orbitqa/profiles',browserPolicyResolver:testBrowserPolicyResolver,collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}})});
  const session=await factory.open({runId:'r',workUnit:{workId:'w'},account:{id:'a1',platform:'spotify',proxySource:'none'},usePersistentProfile:true});
  assert.equal(attempts,2);await session.close();
});

test('background persistent streaming uses a real minimized Chromium renderer and audio mute is optional',async()=>{
  const calls=[];const page={};const browser={version:()=> '153.0.8012.10'};
  const makeContext=()=>({browser:()=>browser,pages:()=>[],addInitScript:async()=>{},newPage:async()=>page,close:async()=>{}});
  const factory=createStreamingBrowserFactory({chromium:{launchPersistentContext:async(_dir,opts)=>{calls.push(opts);return makeContext();}},profileBaseDir:'/orbitqa/profiles',browserPolicyResolver:testBrowserPolicyResolver,collectPrivacy:async()=>({blocked:false,observed:{literalIpCandidates:[]}})});
  const a=await factory.open({runId:'r1',workUnit:{workId:'w1'},account:{id:'a1',platform:'spotify',proxySource:'none'},executionMode:'background',usePersistentProfile:true,muteAudio:false});await a.close();
  const b=await factory.open({runId:'r2',workUnit:{workId:'w2'},account:{id:'a2',platform:'spotify',proxySource:'none'},executionMode:'visible',usePersistentProfile:true,muteAudio:true});await b.close();
  assert.equal(calls[0].headless,false);assert.ok((calls[0].args||[]).includes('--start-minimized'));assert.equal((calls[0].args||[]).includes('--mute-audio'),false);
  assert.equal(calls[1].headless,false);assert.equal((calls[1].args||[]).includes('--start-minimized'),false);assert.equal((calls[1].args||[]).includes('--mute-audio'),true);
});

test('proxied manual login uses the account proxy in installed Chrome and never spawns a direct browser',async()=>{
  const spawns=[];let launchOptions=null;let released=0;let closed=0;
  const page={goto:async()=>({ok:()=>true}),textContent:async()=>'{"ip":"203.0.113.50"}'};
  const context={pages:()=>[page],addInitScript:async()=>{},close:async()=>{closed++;}};
  const chromium={launchPersistentContext:async(_dir,options)=>{launchOptions=options;return context;}};
  const proxyPoolService={
    allocate:async()=>({allocationId:'manual-a1',proxyId:'p1',proxyKind:'static',server:'http://45.58.228.246:5918',username:'user',password:'pass'}),
    release:async()=>{released++;},
  };
  const factory=createStreamingBrowserFactory({
    chromium,
    proxyPoolService,
    profileBaseDir:'C:\\OrbitQA\\profiles',
    browserPolicyResolver:()=>({engine:'chromium',browserLabel:'Google Chrome',executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'}),
    verifyRoute:async()=>({directIp:undefined,proxiedIp:'203.0.113.50',proxyOnly:true}),
    spawnImpl:(...args)=>{spawns.push(args);throw new Error('direct spawn must not happen');},
  });
  const handle=await factory.openManualLogin({account:{id:'a1',platform:'spotify',proxySource:'static',staticProxyId:'p1'},url:'https://accounts.spotify.com/en/login'});
  assert.equal(spawns.length,0);
  assert.equal(handle.proxySource,'static');
  assert.equal(handle.proxyExitIp,'203.0.113.50');
  assert.equal(launchOptions.proxy.server,'http://45.58.228.246:5918');
  assert.equal(launchOptions.proxy.username,'user');
  assert.equal(launchOptions.proxy.password,'pass');
  assert.equal(launchOptions.executablePath,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
  assert.ok((launchOptions.args||[]).includes('--disable-quic'));
  assert.ok((launchOptions.args||[]).includes('--disable-background-networking'));
  assert.ok((launchOptions.args||[]).some(arg=>String(arg).includes('disable_non_proxied_udp')));
  await handle.close();
  assert.equal(closed,1);
  assert.equal(released,1);
});
