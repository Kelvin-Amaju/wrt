const test = require('node:test');
const assert = require('node:assert/strict');
let analyzer = {};
try { analyzer = require('./site-analyzer.cjs'); } catch {}

const base = { title:'', bodyText:'', url:'https://example.org/', articleCount:0, headingCount:1, mainPresent:true, formCount:0, radioCount:0, checkboxCount:0, selectCount:0, sameOriginLinks:[], editableFields:[], actions:[], blockers:[], adLikeElements:[], riskFlags:[] };

test('site analyzer classifies representative safe QA page types conservatively', () => {
  assert.equal(typeof analyzer.classifySiteSnapshot, 'function');
  assert.equal(analyzer.classifySiteSnapshot({ ...base, title:'Story', articleCount:1, bodyText:'A '.repeat(1200), sameOriginLinks:[{ text:'Home', href:'https://example.org/' }] }).kind, 'article');
  assert.equal(analyzer.classifySiteSnapshot({ ...base, title:'Latest posts', articleCount:4, bodyText:'Latest articles', sameOriginLinks:[{ text:'Post one', href:'https://example.org/1', articleLike:true },{ text:'Post two', href:'https://example.org/2', articleLike:true }] }).kind, 'blog-index');
  assert.equal(analyzer.classifySiteSnapshot({ ...base, bodyText:'Paste a URL and download video', formCount:1, editableFields:[{ type:'url', label:'Video URL' }], actions:[{ text:'Download', role:'button' }] }).kind, 'downloader');
  assert.equal(analyzer.classifySiteSnapshot({ ...base, bodyText:'Generate an image from a prompt', formCount:1, editableFields:[{ type:'text', label:'Prompt' }], actions:[{ text:'Generate', role:'button' }] }).kind, 'generator');
  assert.equal(analyzer.classifySiteSnapshot({ ...base, bodyText:'Customer survey questionnaire', formCount:1, radioCount:4, actions:[{ text:'Submit', role:'button' }] }).kind, 'survey');
  assert.equal(analyzer.classifySiteSnapshot({ ...base, bodyText:'', mainPresent:false, headingCount:0 }).kind, 'unknown');
});

test('site analyzer never promotes ad-like actions to safe actions', () => {
  const result = analyzer.classifySiteSnapshot({ ...base, bodyText:'Tool', formCount:1, editableFields:[{ type:'text', label:'Query' }], actions:[{ text:'Sponsored offer', href:'https://ads.example', role:'link' }, { text:'Check', role:'button' }], adLikeElements:[{ text:'Sponsored offer', href:'https://ads.example' }] });
  assert.equal(result.safeActions.some((item) => /sponsored/i.test(item.text || '')), false);
});

test('site analyzer excludes unrelated external-link actions from automatic safe actions', () => {
  const result = analyzer.classifySiteSnapshot({
    ...base,
    bodyText:'Check this tool', formCount:1,
    editableFields:[{ type:'text', label:'Query' }],
    actions:[
      { text:'Open partner', href:'https://partner.example/', role:'link', sameOrigin:false },
      { text:'Check', role:'button' },
    ],
  });
  assert.deepEqual(result.safeActions.map((item) => item.text), ['Check']);
});

test('site analyzer preserves neutral survey controls for conservative survey QA', () => {
  const control = { selectorHint:'#rating', type:'radio', label:'Overall satisfaction', text:'Satisfied' };
  const result = analyzer.classifySiteSnapshot({
    ...base,
    bodyText:'Customer survey questionnaire', formCount:1, radioCount:4,
    editableFields:[control], actions:[{ text:'Submit', role:'button' }],
  });
  assert.equal(result.kind, 'survey');
  assert.equal(result.editableFields.some((item) => item.selectorHint === '#rating'), true);
});

test('news/blog homepages with many article cards are classified as blog-index, not as a single article page', () => {
  const result = analyzer.classifySiteSnapshot({
    ...base,
    title:'Daily News - Latest Headlines',
    bodyText:'Latest news '.repeat(300),
    articleCount:8,
    sameOriginLinks:[
      { text:'Headline one', href:'https://example.org/story-1', articleLike:true, domOrder:1 },
      { text:'Headline two', href:'https://example.org/story-2', articleLike:true, domOrder:2 },
      { text:'Headline three', href:'https://example.org/story-3', articleLike:true, domOrder:3 },
    ],
  });
  assert.equal(result.kind, 'blog-index');
});

test('site analyzer distinguishes shortlink and temporary-mail tools', () => {
  const shortlink = analyzer.classifySiteSnapshot({
    ...base,
    title:'URL Shortener', bodyText:'Shorten a long URL and create a short link', formCount:1,
    editableFields:[{ type:'url', label:'Paste long URL' }],
    actions:[{ text:'Shorten URL', role:'button', actionIntent:'shorten' }],
  });
  assert.equal(shortlink.kind, 'shortlink');

  const tempMail = analyzer.classifySiteSnapshot({
    ...base,
    title:'Temporary Email', bodyText:'Temporary mail inbox. Copy email, refresh inbox, get new mail',
    actions:[
      { text:'Copy email', role:'button', actionIntent:'copy' },
      { text:'Refresh inbox', role:'button', actionIntent:'refresh' },
    ],
  });
  assert.equal(tempMail.kind, 'temp-mail');
  assert.equal(tempMail.preferredSafeActions.some((item) => item.actionIntent === 'copy'), true);
});

test('site analyzer exposes semantic safe action intents for common QA controls', () => {
  const result = analyzer.classifySiteSnapshot({
    ...base,
    bodyText:'Temporary mail utility',
    actions:[
      { text:'Copy', role:'button', actionIntent:'copy' },
      { text:'Refresh', role:'button', actionIntent:'refresh' },
      { text:'Sponsored offer', role:'button', actionIntent:'open' },
    ],
  });
  assert.deepEqual(result.preferredSafeActions.map((item) => item.actionIntent), ['copy','refresh']);
});

test('site analyzer classifies redirect/landing pages instead of leaving actionable landing pages unknown', () => {
  const result = analyzer.classifySiteSnapshot({
    ...base,
    url:'https://landing.example/offer',
    title:'Continue to destination',
    bodyText:'Continue to destination or visit our home page',
    mainPresent:true,
    sameOriginLinks:[{ text:'Continue', href:'https://landing.example/next', sameOrigin:true, domOrder:1 }],
    actions:[],
  });
  assert.equal(result.kind, 'landing-redirect');
});

test('analyzeSite exposes the final inspected URL for redirect-aware planning', async () => {
  const page = {
    evaluate: async () => ({ ...base, url:'https://final.example/path', title:'Final page', bodyText:'Final page content with a safe internal link', sameOriginLinks:[{ text:'About', href:'https://final.example/about', sameOrigin:true }] }),
  };
  const result = await analyzer.analyzeSite(page);
  assert.equal(result.finalUrl, 'https://final.example/path');
});

test('recognizes cross-frame advertising evidence for banner/network ad reporting', () => {
  assert.equal(analyzer.isAdFrameEvidence({ url:'https://googleads.g.doubleclick.net/pagead/ads', title:'', bodyText:'' }), true);
  assert.equal(analyzer.isAdFrameEvidence({ url:'https://cdn.example.com/widget', title:'Sponsored', bodyText:'Advertisement' }), true);
  assert.equal(analyzer.isAdFrameEvidence({ url:'https://example.com/embed', title:'Video', bodyText:'Hello' }), false);
});

test('redirect/ad-network landing URLs are classified as landing-redirect even when the final document is sparse', () => {
  const result = analyzer.classifySiteSnapshot({ ...base, url:'https://www.profitableratecpmnetwork.com/abc?key=123', title:'', bodyText:'', mainPresent:false, headingCount:0, sameOriginLinks:[] });
  assert.equal(result.kind, 'landing-redirect');
});

test('site analyzer recognizes shorteners and downloaders from their legitimate action plus a URL-like field even when marketing copy is sparse', () => {
  const shortlink = analyzer.classifySiteSnapshot({
    ...base,
    title:'Link Tool', bodyText:'Paste your destination below', formCount:1,
    editableFields:[{ type:'text', name:'destination_url', placeholder:'Paste link here' }],
    actions:[{ text:'Create', role:'button', actionIntent:'shorten' }],
  });
  assert.equal(shortlink.kind, 'shortlink');

  const downloader = analyzer.classifySiteSnapshot({
    ...base,
    title:'Media Tool', bodyText:'Enter a link', formCount:1,
    editableFields:[{ type:'text', name:'media_link', placeholder:'Video link' }],
    actions:[{ text:'Go', role:'button', actionIntent:'download' }],
  });
  assert.equal(downloader.kind, 'downloader');
});
