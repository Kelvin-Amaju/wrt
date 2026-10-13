const test = require('node:test');
const assert = require('node:assert/strict');
let mod = {};
try { mod = require('./behavior-planner.cjs'); } catch {}

const settings = { behaviorMode:'auto', readingPace:'natural', safeFormActions:true, observeNewTabs:true, referrerMode:'direct' };

test('planner browses before interacting and stays browse-only on unknown pages', () => {
  assert.equal(typeof mod.planBehavior, 'function');
  const blog = mod.planBehavior({ analysis:{ kind:'blog-index', sameOriginLinks:[{ text:'Post', href:'https://x.test/post', selectorHint:'[data-x="1"]', articleLike:true }], editableFields:[], safeActions:[] }, remainingMs:60000, settings, seed:'w1', deviceMode:'desktop' });
  assert.equal(blog[0].type, 'observe');
  assert.equal(blog.some((a) => a.type === 'read-scroll'), true);
  assert.equal(blog.some((a) => a.type === 'open-link'), true);

  const tool = mod.planBehavior({ analysis:{ kind:'form-tool', sameOriginLinks:[], editableFields:[{ selectorHint:'#q', type:'text', label:'Query' }], safeActions:[{ selectorHint:'#go', text:'Check', role:'button' }] }, remainingMs:60000, settings, seed:'w2', deviceMode:'desktop' });
  assert.deepEqual(tool.slice(0,2).map((a) => a.type), ['observe','read-scroll']);
  assert.equal(tool.findIndex((a) => a.type === 'fill-field') > 1, true);
  assert.equal(tool.findIndex((a) => a.type === 'activate') > tool.findIndex((a) => a.type === 'fill-field'), true);

  const unknown = mod.planBehavior({ analysis:{ kind:'unknown', sameOriginLinks:[], editableFields:[], safeActions:[] }, remainingMs:60000, settings, seed:'w3', deviceMode:'desktop' });
  assert.equal(unknown.some((a) => ['fill-field','activate','open-link'].includes(a.type)), false);
});

test('planner does not start form or navigation actions near session expiry', () => {
  const plan = mod.planBehavior({ analysis:{ kind:'form-tool', sameOriginLinks:[{ selectorHint:'#a', href:'https://x.test/a', text:'A' }], editableFields:[{ selectorHint:'#q', type:'text', label:'Query' }], safeActions:[{ selectorHint:'#go', text:'Check', role:'button' }] }, remainingMs:4500, settings, seed:'short', deviceMode:'desktop' });
  assert.equal(plan.some((a) => ['fill-field','activate','open-link'].includes(a.type)), false);
});

test('survey planner browses first then chooses a neutral survey control before safe submit', () => {
  const analysis = {
    kind:'survey', sameOriginLinks:[],
    editableFields:[{ selectorHint:'#rating', type:'radio', label:'Overall satisfaction', text:'Satisfied' }],
    safeActions:[{ selectorHint:'#submit', text:'Submit', role:'button' }],
  };
  const plan = mod.planBehavior({ analysis, remainingMs:30000, settings, seed:'survey', deviceMode:'desktop' });
  assert.deepEqual(plan.slice(0,2).map((a) => a.type), ['observe','read-scroll']);
  assert.equal(plan.some((a) => a.type === 'choose-survey-control'), true);
  assert.equal(plan.findIndex((a) => a.type === 'activate') > plan.findIndex((a) => a.type === 'choose-survey-control'), true);
});

test('blog planner prefers a recent/latest article candidate when available', () => {
  const recent = { text:'Latest story', href:'https://x.test/latest', selectorHint:'#latest', articleLike:true, recentLike:true };
  const older = { text:'Older story', href:'https://x.test/older', selectorHint:'#older', articleLike:true };
  const plan = mod.planBehavior({ analysis:{ kind:'blog-index', sameOriginLinks:[older, recent], editableFields:[], safeActions:[] }, remainingMs:60000, settings, seed:'recent', deviceMode:'desktop' });
  const open = plan.find((a) => a.type === 'open-link');
  assert.equal(open.candidate.href, recent.href);
});

test('form planner prefers the safe action associated with the selected field form', () => {
  const analysis = {
    kind:'form-tool', sameOriginLinks:[],
    editableFields:[{ selectorHint:'#q', type:'text', label:'Query', formKey:'form-1' }],
    safeActions:[
      { selectorHint:'#help', text:'Open help', role:'button', formKey:'' },
      { selectorHint:'#check', text:'Check', role:'button', formKey:'form-1' },
    ],
  };
  const plan = mod.planBehavior({ analysis, remainingMs:30000, settings, seed:'related', deviceMode:'desktop' });
  const action = plan.find((item) => item.type === 'activate');
  assert.equal(action.candidate.selectorHint, '#check');
});

test('article planning prefers a same-origin Read More continuation before returning home when time remains', () => {
  assert.equal(typeof mod.planBehavior, 'function');
  const plan = mod.planBehavior({
    analysis:{
      kind:'article',
      sameOriginLinks:[
        {selectorHint:'#more',text:'Read More',href:'https://example.org/post/2',articleLike:true,readMoreLike:true},
        {selectorHint:'#home',text:'Home',href:'https://example.org/',homeLike:true},
      ],
      editableFields:[], safeActions:[],
    },
    remainingMs:30000, settings:{readingPace:'natural'}, seed:'read-more', deviceMode:'desktop',
  });
  const nav = plan.find((item)=>item.type === 'open-link' && item.candidate?.readMoreLike);
  assert.ok(nav);
});

test('blog planner opens the first recent article in page order rather than randomizing among recent posts', () => {
  const firstRecent = { text:'Newest headline', href:'https://x.test/newest', selectorHint:'#newest', articleLike:true, recentLike:true, domOrder:4 };
  const secondRecent = { text:'Another recent headline', href:'https://x.test/recent-2', selectorHint:'#recent-2', articleLike:true, recentLike:true, domOrder:7 };
  const older = { text:'Older headline', href:'https://x.test/older', selectorHint:'#older', articleLike:true, domOrder:1 };
  const plan = mod.planBehavior({ analysis:{ kind:'blog-index', sameOriginLinks:[older, secondRecent, firstRecent], editableFields:[], safeActions:[] }, remainingMs:60000, settings, seed:'random-seed-that-must-not-matter', deviceMode:'desktop' });
  const open = plan.find((a) => a.type === 'open-link');
  assert.equal(open.candidate.href, firstRecent.href);
});

test('shortlink and downloader planners fill the URL field then activate the matching legitimate action', () => {
  for (const kind of ['shortlink','downloader']) {
    const plan = mod.planBehavior({
      analysis:{
        kind,
        sameOriginLinks:[],
        editableFields:[{ selectorHint:'#url', type:'url', label:'URL', formKey:'f1' }],
        safeActions:[
          { selectorHint:'#secondary', text:'Help', role:'button', formKey:'' },
          { selectorHint:'#submit', text:kind === 'shortlink' ? 'Shorten URL' : 'Download', role:'button', formKey:'f1', actionIntent:kind === 'shortlink' ? 'shorten' : 'download' },
        ],
        preferredSafeActions:[],
      },
      remainingMs:30000, settings, seed:`${kind}-plan`, deviceMode:'desktop',
    });
    const fillIndex = plan.findIndex((a) => a.type === 'fill-field');
    const activate = plan.find((a) => a.type === 'activate');
    assert.ok(fillIndex >= 0);
    assert.ok(activate);
    assert.equal(activate.candidate.selectorHint, '#submit');
  }
});

test('temporary-mail planner prefers a legitimate Copy/Refresh/Get Mail action', () => {
  const plan = mod.planBehavior({
    analysis:{
      kind:'temp-mail', sameOriginLinks:[], editableFields:[],
      safeActions:[
        { selectorHint:'#settings', text:'Settings', role:'button', actionIntent:'generic' },
        { selectorHint:'#refresh', text:'Refresh inbox', role:'button', actionIntent:'refresh' },
        { selectorHint:'#copy', text:'Copy email', role:'button', actionIntent:'copy' },
      ],
      preferredSafeActions:[
        { selectorHint:'#copy', text:'Copy email', role:'button', actionIntent:'copy' },
        { selectorHint:'#refresh', text:'Refresh inbox', role:'button', actionIntent:'refresh' },
      ],
    },
    remainingMs:30000, settings, seed:'mail', deviceMode:'desktop',
  });
  const activate = plan.find((a) => a.type === 'activate');
  assert.ok(activate);
  assert.equal(activate.candidate.selectorHint, '#copy');
});

test('generic planner uses a benign same-origin action when available and otherwise records no-safe-action', () => {
  const withLink = mod.planBehavior({
    analysis:{ kind:'generic', sameOriginLinks:[{ selectorHint:'#about', text:'About', href:'https://x.test/about', role:'link' }], editableFields:[], safeActions:[] },
    remainingMs:30000, settings, seed:'generic-link', deviceMode:'desktop',
  });
  assert.equal(withLink.some((a) => a.type === 'open-link'), true);

  const none = mod.planBehavior({
    analysis:{ kind:'unknown', sameOriginLinks:[], editableFields:[], safeActions:[] },
    remainingMs:30000, settings, seed:'none', deviceMode:'desktop',
  });
  assert.equal(none.some((a) => a.type === 'no-safe-action'), true);
});

test('a short but usable session still reserves enough time to open a recent blog article', () => {
  const recent = { text:'Recent story', href:'https://x.test/recent', selectorHint:'#recent', articleLike:true, recentLike:true };
  const plan = mod.planBehavior({ analysis:{ kind:'blog-index', sameOriginLinks:[recent], editableFields:[], safeActions:[] }, remainingMs:8000, settings, seed:'short-blog', deviceMode:'desktop' });
  assert.equal(plan.some((a) => a.type === 'open-link'), true);
});

test('landing redirect planner uses a benign same-origin navigation when available', () => {
  const plan = mod.planBehavior({
    analysis:{ kind:'landing-redirect', sameOriginLinks:[{ selectorHint:'#continue', text:'Continue', href:'https://x.test/next', role:'link' }], editableFields:[], safeActions:[] },
    remainingMs:30000, settings, seed:'landing', deviceMode:'desktop',
  });
  assert.equal(plan.some((a) => a.type === 'open-link' && a.candidate?.selectorHint === '#continue'), true);
});

test('shortlink planner prefers the URL-like field by name even when it is a text input among multiple fields', () => {
  const plan = mod.planBehavior({
    analysis:{
      kind:'shortlink', sameOriginLinks:[],
      editableFields:[
        { selectorHint:'#title', type:'text', name:'title', label:'Title', formKey:'f1' },
        { selectorHint:'#long-url', type:'text', name:'destination_url', label:'', placeholder:'Paste long link', formKey:'f1' },
      ],
      safeActions:[{ selectorHint:'#shorten', text:'Create Short Link', role:'button', formKey:'f1', actionIntent:'shorten' }],
      preferredSafeActions:[],
    },
    remainingMs:30000, settings, seed:'shortlink-url-name', deviceMode:'desktop',
  });
  const fill = plan.find((a) => a.type === 'fill-field');
  const activate = plan.find((a) => a.type === 'activate');
  assert.equal(fill?.candidate?.selectorHint, '#long-url');
  assert.equal(activate?.candidate?.selectorHint, '#shorten');
});

test('generic planner prefers a benign safe button over a passive navigation link', () => {
  const plan = mod.planBehavior({
    analysis:{
      kind:'generic',
      sameOriginLinks:[{ selectorHint:'#about', text:'About', href:'https://x.test/about', role:'link' }],
      editableFields:[],
      safeActions:[
        { selectorHint:'#refresh', text:'Refresh', role:'button', actionIntent:'refresh' },
        { selectorHint:'#details', text:'Show details', role:'button', actionIntent:'generic' },
      ],
      preferredSafeActions:[{ selectorHint:'#refresh', text:'Refresh', role:'button', actionIntent:'refresh' }],
    },
    remainingMs:30000, settings, seed:'generic-button', deviceMode:'desktop',
  });
  const activate = plan.find((a) => a.type === 'activate');
  assert.ok(activate);
  assert.equal(['#refresh','#details'].includes(activate.candidate.selectorHint), true);
  assert.equal(plan.some((a) => a.type === 'open-link'), false);
});

test('generic planner does not mistake a safe link action for the requested random site button when a real safe button exists', () => {
  const plan = mod.planBehavior({
    analysis:{
      kind:'generic', sameOriginLinks:[], editableFields:[],
      safeActions:[
        { selectorHint:'#about-link', text:'About', role:'link', href:'https://x.test/about', actionIntent:'generic' },
        { selectorHint:'#refresh-button', text:'Refresh', role:'button', actionIntent:'refresh' },
      ],
      preferredSafeActions:[
        { selectorHint:'#refresh-button', text:'Refresh', role:'button', actionIntent:'refresh' },
      ],
    },
    remainingMs:30000, settings, seed:'generic-real-button', deviceMode:'desktop',
  });
  const activate = plan.find((a) => a.type === 'activate');
  assert.equal(activate?.candidate?.selectorHint, '#refresh-button');
});

test('generic planner prefers a real safe button over link-shaped safe actions even without a preferred intent', () => {
  const plan = mod.planBehavior({
    analysis:{
      kind:'generic', sameOriginLinks:[], editableFields:[], preferredSafeActions:[],
      safeActions:[
        { selectorHint:'#about-link', text:'About', role:'link', href:'https://x.test/about', actionIntent:'generic' },
        { selectorHint:'#details-button', text:'Show details', role:'button', actionIntent:'generic' },
      ],
    },
    remainingMs:30000, settings, seed:'generic-button-over-link', deviceMode:'desktop',
  });
  const activate = plan.find((a) => a.type === 'activate');
  assert.equal(activate?.candidate?.selectorHint, '#details-button');
});
