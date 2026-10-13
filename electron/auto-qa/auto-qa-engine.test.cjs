const test = require('node:test');
const assert = require('node:assert/strict');
let mod = {};
try { mod = require('./auto-qa-engine.cjs'); } catch {}

function fakeLifetime(ms = 60000) {
  let remaining = ms;
  return {
    remainingMs: () => remaining,
    throwIfExpired() { if (remaining <= 0) { const e = new Error('expired'); e.name = 'SessionExpiredError'; throw e; } },
    async wait(value) { remaining -= Number(value || 0); },
  };
}

test('Auto QA re-analyzes after blog navigation and never uses a stale plan', async () => {
  assert.equal(typeof mod.runAutoQa, 'function');
  const analyses = [
    { kind:'blog-index', confidence:.9, sameOriginLinks:[{ selectorHint:'#post', text:'Post', href:'https://example.org/post', articleLike:true }], editableFields:[], safeActions:[], blockers:[], adLikeElements:[], riskFlags:[] },
    { kind:'article', confidence:.9, sameOriginLinks:[], editableFields:[], safeActions:[], blockers:[], adLikeElements:[], riskFlags:[] },
  ];
  let analyzeCalls = 0;
  let plannedKinds = [];
  let clicked = 0;
  const target = { async scrollIntoViewIfNeeded(){}, async click(){ clicked += 1; } };
  const page = { url:()=> clicked ? 'https://example.org/post' : 'https://example.org/', locator:()=>({ first:()=>target }), async waitForLoadState(){}, async bringToFront(){} };
  const context = { pages:()=>[page] };
  const report = await mod.runAutoQa({ page, context, workUnit:{ workId:'w1', executionKind:'desktop' }, settings:{ behaviorMode:'auto', readingPace:'natural', safeFormActions:true, observeNewTabs:true }, lifetime:fakeLifetime(), log:()=>{}, signal:null, deps:{
    analyzeSite:async()=> analyses[Math.min(analyzeCalls++, analyses.length-1)],
    planBehavior:({analysis})=>{ plannedKinds.push(analysis.kind); return analysis.kind === 'blog-index' ? [{type:'open-link', candidate:analyses[0].sameOriginLinks[0]}] : [{type:'observe', durationMs:10}]; },
    performReadingScroll:async()=>{},
    performFullPageObservation:async()=>({completedRoundTrip:true,reachedBottom:true,reachedTop:true}),
    createBlockerObserver:()=>({ inspectAndResolve:async()=>({detected:false,dismissed:false}) }),
  }});
  assert.equal(clicked, 1);
  assert.deepEqual(plannedKinds.slice(0,2), ['blog-index','article']);
  assert.equal(report.navigationCount >= 1, true);
});

test('Auto QA browses before a safe form action and skips protected candidates', async () => {
  const order = [];
  const input = { async scrollIntoViewIfNeeded(){}, async fill(){ order.push('fill'); }, async pressSequentially(){ order.push('type'); } };
  const button = { async scrollIntoViewIfNeeded(){}, async click(){ order.push('click'); } };
  const page = { url:()=> 'https://example.org/tool', locator:(s)=>({ first:()=> s === '#q' ? input : button }), async waitForLoadState(){}, async bringToFront(){} };
  const context = { pages:()=>[page] };
  const analysis = { kind:'form-tool', confidence:.9, sameOriginLinks:[], editableFields:[{selectorHint:'#q',type:'text',label:'Query'}], safeActions:[{selectorHint:'#go',text:'Check',role:'button'}], blockers:[], adLikeElements:[], riskFlags:[] };
  await mod.runAutoQa({ page, context, workUnit:{ workId:'w2', executionKind:'desktop' }, settings:{ behaviorMode:'auto', readingPace:'natural', safeFormActions:true, observeNewTabs:true }, lifetime:fakeLifetime(12000), log:(m)=>order.push(m), pacing:{typingDelayMs:0}, deps:{
    analyzeSite:async()=>analysis,
    planBehavior:()=>[{type:'observe',durationMs:1},{type:'read-scroll',seed:'r'},{type:'fill-field',candidate:analysis.editableFields[0]},{type:'activate',candidate:analysis.safeActions[0]}],
    performReadingScroll:async()=>{order.push('scroll');},
    performFullPageObservation:async()=>({completedRoundTrip:true,reachedBottom:true,reachedTop:true}),
    createBlockerObserver:()=>({inspectAndResolve:async()=>({detected:false,dismissed:false})}),
  }});
  assert.equal(order.indexOf('scroll') < order.indexOf('type'), true);
  assert.equal(order.includes('click'), true);
});

test('Auto QA stops between actions when STOP is signaled', async () => {
  const controller = new AbortController();
  let actions = 0;
  const page = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){} };
  const context = { pages:()=>[page] };
  const lifetime = fakeLifetime();
  const report = await mod.runAutoQa({ page, context, workUnit:{workId:'w3',executionKind:'desktop'}, settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true}, lifetime, log:()=>{}, signal:controller.signal, deps:{
    analyzeSite:async()=>({kind:'unknown',sameOriginLinks:[],editableFields:[],safeActions:[],blockers:[],adLikeElements:[],riskFlags:[]}),
    planBehavior:()=>[{type:'observe',durationMs:1},{type:'read-scroll',seed:'x'}],
    performReadingScroll:async()=>{actions += 1;},
    performFullPageObservation:async()=>({completedRoundTrip:true,reachedBottom:true,reachedTop:true}),
    createBlockerObserver:()=>({inspectAndResolve:async()=>{ controller.abort(); return {detected:false,dismissed:false}; }}),
  }});
  assert.equal(actions, 0);
  assert.equal(report.terminalReason, 'stopped');
});

test('Auto QA supervises a popup preserved by safe blocker dismissal and retains it until session end', async () => {
  let popupVisible = false;
  let popupClosed = 0;
  let auxiliaryReads = 0;
  const primary = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){} };
  const popup = { url:()=> 'https://example.org/info', async title(){ return 'More information'; }, async waitForLoadState(){}, async close(){ popupClosed += 1; } };
  const context = { pages:()=> popupVisible ? [primary, popup] : [primary] };
  await mod.runAutoQa({
    page:primary, context, workUnit:{workId:'w4',executionKind:'desktop'},
    settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true},
    lifetime:fakeLifetime(15000), log:()=>{}, signal:null,
    deps:{
      analyzeSite:async(page)=> page === popup
        ? {kind:'generic',sameOriginLinks:[],editableFields:[],safeActions:[],blockers:[],adLikeElements:[],riskFlags:[]}
        : {kind:'unknown',sameOriginLinks:[],editableFields:[],safeActions:[],blockers:[],adLikeElements:[],riskFlags:[]},
      planBehavior:()=>[{type:'observe',durationMs:1}],
      performReadingScroll:async()=>{},
      performFullPageObservation:async(page)=>{ if (page === popup) auxiliaryReads += 1; return {completedRoundTrip:true,reachedBottom:true,reachedTop:true}; },
      createBlockerObserver:()=>({inspectAndResolve:async()=>{ popupVisible = true; return {detected:true,dismissed:true,popup}; }}),
    },
  });
  assert.equal(auxiliaryReads, 1);
  assert.equal(popupClosed, 0);
});

test('Auto QA can choose a neutral survey control after browsing and then activate a safe submit', async () => {
  const order = [];
  const radio = { async scrollIntoViewIfNeeded(){}, async check(){ order.push('check'); } };
  const submit = { async scrollIntoViewIfNeeded(){}, async click(){ order.push('submit'); } };
  const page = { url:()=> 'https://example.org/survey', locator:(s)=>({ first:()=> s === '#rating' ? radio : submit }), async waitForLoadState(){}, async bringToFront(){} };
  const context = { pages:()=>[page] };
  const analysis = { kind:'survey', confidence:.9, sameOriginLinks:[], editableFields:[{selectorHint:'#rating',type:'radio',label:'Overall satisfaction',text:'Satisfied'}], safeActions:[{selectorHint:'#submit',text:'Submit',role:'button'}], blockers:[], adLikeElements:[], riskFlags:[] };
  await mod.runAutoQa({ page, context, workUnit:{workId:'survey-1',executionKind:'desktop'}, settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true}, lifetime:fakeLifetime(15000), log:()=>{}, deps:{
    analyzeSite:async()=>analysis,
    planBehavior:()=>[{type:'read-scroll',seed:'r'},{type:'choose-survey-control',candidate:analysis.editableFields[0]},{type:'activate',candidate:analysis.safeActions[0]}],
    performReadingScroll:async()=>{order.push('scroll');},
    performFullPageObservation:async()=>({completedRoundTrip:true,reachedBottom:true,reachedTop:true}),
    createBlockerObserver:()=>({inspectAndResolve:async()=>({detected:false,dismissed:false})}),
  }});
  assert.deepEqual(order, ['scroll','check','submit']);
});

test('Auto QA completes a full down-and-up observation before analyzing or acting on a page', async () => {
  const order = [];
  const target = { async scrollIntoViewIfNeeded(){}, async click(){ order.push('click'); } };
  const page = { url:()=> 'https://example.org/', locator:()=>({first:()=>target}), async waitForLoadState(){}, async bringToFront(){} };
  const context = { pages:()=>[page] };
  const analysis = { kind:'blog-index', sameOriginLinks:[{selectorHint:'#post',text:'Post',href:'https://example.org/post',articleLike:true}], editableFields:[], safeActions:[], blockers:[], adLikeElements:[], riskFlags:[] };
  await mod.runAutoQa({ page, context, workUnit:{workId:'preobserve',executionKind:'desktop'}, settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true}, lifetime:fakeLifetime(12000), log:()=>{}, deps:{
    performFullPageObservation:async()=>{ order.push('full-observation'); return {completedRoundTrip:true,reachedBottom:true,reachedTop:true}; },
    analyzeSite:async()=>{ order.push('analyze'); return analysis; },
    planBehavior:()=>[{type:'open-link',candidate:analysis.sameOriginLinks[0]}],
    performReadingScroll:async()=>{},
    createBlockerObserver:()=>({inspectAndResolve:async()=>({detected:false,dismissed:false})}),
  }});
  assert.deepEqual(order.slice(0,3), ['full-observation','analyze','click']);
});

test('Auto QA gives a newly opened article its own full reading round trip', async () => {
  const observedUrls = [];
  let current = 'https://example.org/';
  const target = { async scrollIntoViewIfNeeded(){}, async click(){ current = 'https://example.org/post'; } };
  const page = { url:()=>current, locator:()=>({first:()=>target}), async waitForLoadState(){}, async bringToFront(){} };
  const context = { pages:()=>[page] };
  let analyses = 0;
  await mod.runAutoQa({ page, context, workUnit:{workId:'article-read',executionKind:'desktop'}, settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true}, lifetime:fakeLifetime(22000), log:()=>{}, deps:{
    performFullPageObservation:async(p)=>{ observedUrls.push(p.url()); return {completedRoundTrip:true,reachedBottom:true,reachedTop:true}; },
    analyzeSite:async()=> analyses++ === 0
      ? {kind:'blog-index',sameOriginLinks:[{selectorHint:'#post',text:'Post',href:'https://example.org/post',articleLike:true}],editableFields:[],safeActions:[],blockers:[],adLikeElements:[],riskFlags:[]}
      : {kind:'article',sameOriginLinks:[],editableFields:[],safeActions:[],blockers:[],adLikeElements:[],riskFlags:[]},
    planBehavior:({analysis})=> analysis.kind === 'blog-index' ? [{type:'open-link',candidate:analysis.sameOriginLinks[0]}] : [{type:'browse-only'}],
    performReadingScroll:async()=>{},
    createBlockerObserver:()=>({inspectAndResolve:async()=>({detected:false,dismissed:false})}),
  }});
  assert.equal(observedUrls.includes('https://example.org/'), true);
  assert.equal(observedUrls.includes('https://example.org/post'), true);
});

test('Auto QA re-checks blockers on the primary page after observing an auxiliary tab', async () => {
  const logs = [];
  let popupVisible = false;
  const primary = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){} };
  const popup = { url:()=> 'https://example.org/info', async title(){ return 'Info'; }, async waitForLoadState(){}, async waitForFunction(){}, async close(){ popupVisible = false; } };
  const context = { pages:()=> popupVisible ? [primary, popup] : [primary] };
  let blockerCalls = 0;
  await mod.runAutoQa({
    page:primary, context, workUnit:{workId:'return-blocker',executionKind:'desktop'},
    settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true},
    lifetime:fakeLifetime(18000), log:(m)=>logs.push(m),
    deps:{
      analyzeSite:async()=>({kind:'unknown',sameOriginLinks:[],editableFields:[],safeActions:[],blockers:[],adLikeElements:[],riskFlags:[]}),
      planBehavior:()=>[{type:'observe',durationMs:1}],
      performReadingScroll:async()=>{},
      performFullPageObservation:async()=>({completedRoundTrip:true,reachedBottom:true,reachedTop:true}),
      createBlockerObserver:()=>({inspectAndResolve:async()=>{
        blockerCalls += 1;
        if (blockerCalls === 1) { popupVisible = true; return {detected:true,dismissed:true}; }
        return {detected:false,dismissed:false};
      }}),
    },
  });
  assert.equal(logs.some((m)=>/re-checking primary page blockers after returning from auxiliary tab/i.test(m)), true);
});

test('Auto QA forwards the auxiliary-page verification hook before secondary-tab browsing', async () => {
  let popupVisible = false;
  let verified = 0;
  let browsed = 0;
  const primary = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){} };
  const popup = { url:()=> 'https://external.example/', async title(){ return 'External'; }, async waitForLoadState(){}, async waitForFunction(){}, async close(){ popupVisible = false; } };
  const context = { pages:()=> popupVisible ? [primary, popup] : [primary] };
  await mod.runAutoQa({
    page:primary, context, workUnit:{workId:'aux-verify',executionKind:'desktop'},
    settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true}, lifetime:fakeLifetime(16000), log:()=>{},
    deps:{
      analyzeSite:async()=>({kind:'unknown',sameOriginLinks:[],editableFields:[],safeActions:[],blockers:[],adLikeElements:[],riskFlags:[]}),
      planBehavior:()=>[{type:'observe',durationMs:1}],
      performReadingScroll:async()=>{},
      performFullPageObservation:async(page)=>{ if (page === popup) browsed += 1; return {completedRoundTrip:true,reachedBottom:true,reachedTop:true}; },
      verifyAuxiliaryPage:async(page)=>{ if (page === popup) verified += 1; },
      createBlockerObserver:()=>({inspectAndResolve:async()=>{ if (!popupVisible) { popupVisible = true; return {detected:true,dismissed:true}; } return {detected:false,dismissed:false}; }}),
    },
  });
  assert.equal(verified, 1);
  assert.equal(browsed, 1);
});

test('Auto QA logs the session timer budget before the first full-page observation', async () => {
  const logs = [];
  const page = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){} };
  const context = { pages:()=>[page] };
  await mod.runAutoQa({
    page,
    context,
    workUnit:{workId:'budget-log',executionKind:'desktop'},
    settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true,finalVerificationReserveMs:5000},
    lifetime:fakeLifetime(60000),
    log:(message)=>logs.push(message),
    deps:{
      analyzeSite:async()=>({kind:'unknown',sameOriginLinks:[],editableFields:[],safeActions:[],blockers:[],adLikeElements:[],riskFlags:[]}),
      planBehavior:()=>[{type:'browse-only'}],
      performReadingScroll:async()=>{},
      performFullPageObservation:async()=>({completedRoundTrip:true,reachedBottom:true,reachedTop:true}),
      createBlockerObserver:()=>({inspectAndResolve:async()=>({detected:false,dismissed:false})}),
    },
  });
  const budgetIndex = logs.findIndex((message)=>/^Timer budget:/.test(message));
  const observeIndex = logs.findIndex((message)=>/Site type detected after full-page observation/.test(message));
  assert.ok(budgetIndex >= 0, 'expected a Timer budget activity-log entry');
  assert.ok(observeIndex > budgetIndex, 'timer budget must be logged before page classification');
  assert.match(logs[budgetIndex], /reserved for final integrity/i);
});

test('Auto QA dismisses a newly appeared blocking iframe and retries a safe click once after pointer interception', async () => {
  const logs = [];
  let obstructionVisible = false;
  let clickAttempts = 0;
  let dismissalAttempts = 0;
  const target = {
    async scrollIntoViewIfNeeded(){},
    async click(){
      clickAttempts += 1;
      if (clickAttempts === 1) {
        obstructionVisible = true;
        throw new Error('locator.click: Timeout 10000ms exceeded. <iframe></iframe> intercepts pointer events');
      }
    },
  };
  const page = {
    url:()=> 'https://example.org/tool',
    locator:()=>({ first:()=>target }),
    async waitForLoadState(){},
    async bringToFront(){},
  };
  const context = { pages:()=>[page] };
  const analysis = {
    kind:'form-tool',
    sameOriginLinks:[],
    editableFields:[],
    safeActions:[{selectorHint:'#paste',text:'Paste',role:'button'}],
    blockers:[],
    adLikeElements:[],
    riskFlags:[],
  };

  await mod.runAutoQa({
    page,
    context,
    workUnit:{workId:'iframe-intercept',executionKind:'desktop'},
    settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true},
    lifetime:fakeLifetime(18000),
    log:(message)=>logs.push(message),
    deps:{
      analyzeSite:async()=>analysis,
      planBehavior:()=>[{type:'activate',candidate:analysis.safeActions[0]}],
      performReadingScroll:async()=>{},
      performFullPageObservation:async()=>({completedRoundTrip:true,reachedBottom:true,reachedTop:true}),
      createBlockerObserver:()=>({
        inspectAndResolve:async()=>{
          if (!obstructionVisible) return {detected:false,dismissed:false};
          dismissalAttempts += 1;
          obstructionVisible = false;
          return {detected:true,dismissed:true,method:'control',label:'Close',promotional:true};
        },
      }),
    },
  });

  assert.equal(dismissalAttempts, 1);
  assert.equal(clickAttempts, 2);
  assert.equal(logs.some((message)=>/blocked safe action.*retrying once/i.test(message)), true);
  assert.equal(logs.some((message)=>/Activated safe action: Paste/.test(message)), true);
});

test('Auto QA does not attempt a safe site action while a detected blocker cannot be safely dismissed', async () => {
  const logs = [];
  let clicks = 0;
  const target = { async scrollIntoViewIfNeeded(){}, async click(){ clicks += 1; } };
  const page = { url:()=> 'https://example.org/tool', locator:()=>({ first:()=>target }), async waitForLoadState(){}, async bringToFront(){} };
  const context = { pages:()=>[page] };
  const analysis = {kind:'form-tool',sameOriginLinks:[],editableFields:[],safeActions:[{selectorHint:'#paste',text:'Paste',role:'button'}],blockers:[],adLikeElements:[],riskFlags:[]};
  let blockerChecks = 0;
  await mod.runAutoQa({
    page, context, workUnit:{workId:'undismissed-blocker',executionKind:'desktop'},
    settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true},
    lifetime:fakeLifetime(18000), log:(message)=>logs.push(message),
    deps:{
      analyzeSite:async()=>analysis,
      planBehavior:()=>[{type:'activate',candidate:analysis.safeActions[0]}],
      performReadingScroll:async()=>{},
      performFullPageObservation:async()=>({completedRoundTrip:true,reachedBottom:true,reachedTop:true}),
      createBlockerObserver:()=>({inspectAndResolve:async()=>{
        blockerChecks += 1;
        return blockerChecks >= 3
          ? {detected:true,dismissed:false,promotional:true,skippedReason:'no safe promotional close control'}
          : {detected:false,dismissed:false};
      }}),
    },
  });
  assert.equal(clicks, 0);
  assert.equal(logs.some((message)=>/safe action skipped because a blocking overlay remains/i.test(message)), true);
});

test('Auto QA starts continuous blocker monitoring while page activity is running', async () => {
  let monitorStarts = 0;
  const page = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){} };
  const context = { pages:()=>[page] };
  await mod.runAutoQa({
    page, context, workUnit:{workId:'continuous-monitor',executionKind:'desktop'},
    settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true},
    lifetime:fakeLifetime(12000), log:()=>{},
    deps:{
      analyzeSite:async()=>({kind:'unknown',sameOriginLinks:[],editableFields:[],safeActions:[],blockers:[],adLikeElements:[],riskFlags:[]}),
      planBehavior:()=>[{type:'browse-only'}],
      performReadingScroll:async()=>{},
      performFullPageObservation:async()=>({completedRoundTrip:true,reachedBottom:true,reachedTop:true}),
      createBlockerObserver:()=>({
        inspectAndResolve:async()=>({detected:false,dismissed:false}),
        startContinuousMonitor(){ monitorStarts += 1; return () => {}; },
      }),
    },
  });
  assert.equal(monitorStarts, 1);
});

test('Auto QA returns aggregate ad summary with type counts for the latest result', async () => {
  const page = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){} };
  const context = { pages:()=>[page] };
  const report = await mod.runAutoQa({
    page, context, workUnit:{workId:'ads-summary',executionKind:'desktop'},
    settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true},
    lifetime:fakeLifetime(14000), log:()=>{},
    deps:{
      analyzeSite:async()=>({kind:'unknown',sameOriginLinks:[],editableFields:[],safeActions:[],blockers:[],riskFlags:[],adLikeElements:[
        {selectorHint:'#a',kind:'container',rect:{x:0,y:0,width:728,height:90},text:'Advertisement banner'},
        {selectorHint:'#b',kind:'iframe',rect:{x:0,y:200,width:300,height:250},text:'Advertisement'},
      ]}),
      planBehavior:()=>[{type:'browse-only'}],
      performReadingScroll:async()=>{},
      performFullPageObservation:async()=>({completedRoundTrip:true,reachedBottom:true,reachedTop:true}),
      createBlockerObserver:()=>({inspectAndResolve:async()=>({detected:false,dismissed:false})}),
    },
  });
  assert.equal(report.adSummary.total, 2);
  assert.equal(report.adSummary.observed, 2);
  assert.equal(report.adSummary.byType.banner, 1);
  assert.equal(report.adSummary.byType.iframeNetwork, 1);
});

test('Auto QA retries a required safe action after a temporary blocker is dismissed', async () => {
  const logs = [];
  let clicks = 0;
  let checks = 0;
  const target = { async scrollIntoViewIfNeeded(){}, async click(){ clicks += 1; } };
  const page = { url:()=> 'https://example.org/shortener', locator:()=>({ first:()=>target }), async waitForLoadState(){}, async bringToFront(){}, async waitForTimeout(){} };
  const context = { pages:()=>[page] };
  const action = { selectorHint:'#shorten', text:'Shorten URL', role:'button', actionIntent:'shorten' };
  await mod.runAutoQa({
    page, context, workUnit:{workId:'retry-required-action',executionKind:'desktop'},
    settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true},
    lifetime:fakeLifetime(22000), log:(message)=>logs.push(message),
    deps:{
      analyzeSite:async()=>({kind:'shortlink',sameOriginLinks:[],editableFields:[],safeActions:[action],preferredSafeActions:[action],blockers:[],adLikeElements:[],riskFlags:[]}),
      planBehavior:()=>[{type:'activate',candidate:action}],
      performReadingScroll:async()=>{},
      performFullPageObservation:async()=>({completedRoundTrip:true,reachedBottom:true,reachedTop:true}),
      createBlockerObserver:()=>({
        inspectAndResolve:async()=>{
          checks += 1;
          if (checks === 3) return {detected:true,dismissed:false,promotional:true};
          if (checks === 4) return {detected:true,dismissed:true,promotional:true,label:'Close'};
          return {detected:false,dismissed:false};
        },
        startContinuousMonitor(){ return () => {}; },
      }),
    },
  });
  assert.equal(clicks, 1);
  assert.equal(logs.some((message)=>/retrying required safe action/i.test(message)), true);
});

test('Auto QA still performs the primary action after a time-budget reading pass returns safely to the top', async () => {
  let clicks = 0;
  const target = { async scrollIntoViewIfNeeded(){}, async click(){ clicks += 1; } };
  const page = { url:()=> 'https://example.org/tool', locator:()=>({ first:()=>target }), async waitForLoadState(){}, async bringToFront(){} };
  const context = { pages:()=>[page] };
  const action = { selectorHint:'#download', text:'Download', role:'button', actionIntent:'download' };
  await mod.runAutoQa({
    page, context, workUnit:{workId:'partial-reading-action',executionKind:'android-mobile'},
    settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true},
    lifetime:fakeLifetime(16000), log:()=>{},
    deps:{
      analyzeSite:async()=>({kind:'downloader',sameOriginLinks:[],editableFields:[],safeActions:[action],preferredSafeActions:[action],blockers:[],adLikeElements:[],riskFlags:[]}),
      planBehavior:()=>[{type:'activate',candidate:action}],
      performReadingScroll:async()=>{},
      performFullPageObservation:async()=>({completedRoundTrip:false,reachedBottom:false,reachedTop:true,reason:'time-reserve'}),
      createBlockerObserver:()=>({inspectAndResolve:async()=>({detected:false,dismissed:false}),startContinuousMonitor(){return()=>{};}}),
    },
  });
  assert.equal(clicks, 1);
});

test('Auto QA records a dismissed promotional blocker as an observed interstitial ad in the result summary', async () => {
  let checks = 0;
  const page = { url:()=> 'https://example.org/', async waitForLoadState(){}, async bringToFront(){} };
  const context = { pages:()=>[page] };
  const report = await mod.runAutoQa({
    page, context, workUnit:{workId:'promo-overlay-ad',executionKind:'desktop'},
    settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true},
    lifetime:fakeLifetime(14000), log:()=>{},
    deps:{
      analyzeSite:async()=>({kind:'unknown',sameOriginLinks:[],editableFields:[],safeActions:[],blockers:[],riskFlags:[],adLikeElements:[]}),
      planBehavior:()=>[{type:'browse-only'}],
      performReadingScroll:async()=>{},
      performFullPageObservation:async()=>({completedRoundTrip:true,reachedBottom:true,reachedTop:true}),
      createBlockerObserver:()=>({
        inspectAndResolve:async()=>{
          checks += 1;
          if (checks === 1) return {detected:true,dismissed:true,promotional:true,label:'Close'};
          return {detected:false,dismissed:false};
        },
        startContinuousMonitor(){return()=>{};},
      }),
    },
  });
  assert.equal(report.adSummary.total, 1);
  assert.equal(report.adSummary.observed, 1);
  assert.equal(report.adSummary.byType.interstitialVignette, 1);
  assert.equal(report.adSummary.status, 'pass');
});

test('v0.21.58 general Auto QA falls back to another safe interactive control when the first click has no response', async()=>{
  const clicks=[];
  let state='same';
  const first={async scrollIntoViewIfNeeded(){},async click(){clicks.push('first')}};
  const second={async scrollIntoViewIfNeeded(){},async click(){clicks.push('second');state='changed'}};
  const page={
    url:()=> 'https://example.org/',
    locator:(selector)=>({first:()=>selector==='#first'?first:second}),
    async evaluate(){return state}, async waitForLoadState(){}, async bringToFront(){}
  };
  const context={pages:()=>[page]};
  const analysis={kind:'generic',sameOriginLinks:[],editableFields:[],safeActions:[{selectorHint:'#first',text:'First',role:'button'},{selectorHint:'#second',text:'Second',role:'button'}],preferredSafeActions:[],blockers:[],adLikeElements:[],riskFlags:[]};
  const logs=[];
  const report=await mod.runAutoQa({page,context,workUnit:{workId:'fallback-click',executionKind:'desktop'},settings:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true},lifetime:fakeLifetime(12000),log:(m)=>logs.push(m),deps:{
    analyzeSite:async()=>analysis,
    planBehavior:()=>[{type:'activate',candidate:analysis.safeActions[0]}],
    performReadingScroll:async()=>{},
    performFullPageObservation:async()=>({completedRoundTrip:true,reachedBottom:true,reachedTop:true}),
    createBlockerObserver:()=>({inspectAndResolve:async()=>({detected:false,dismissed:false})}),
  }});
  assert.deepEqual(clicks,['first','second']);
  assert.equal(report.completed>=1,true);
  assert.equal(logs.some((m)=>/trying another safe interactive control/i.test(m)),true);
});
