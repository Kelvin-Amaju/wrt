const test = require('node:test');
const assert = require('node:assert/strict');
const { comparableUrl, scoreCandidate } = require('./referrer-navigation.cjs');

test('comparableUrl normalizes ordinary referral URLs', () => {
  assert.equal(comparableUrl('https://Example.com/path/'), 'https://example.com/path');
});

test('site referral prefers exact requested destination', () => {
  const current='https://referrer.example/start';
  assert.equal(scoreCandidate({visible:true,download:false,href:'https://target.example/page',text:'Visit target'}, current, 'https://target.example/page'), 1000);
  assert.equal(scoreCandidate({visible:true,download:false,href:'https://other.example/page',text:'Other'}, current, 'https://target.example/page'), -Infinity);
});

test('site referral rejects sponsored, destructive, download and non-http targets', () => {
  const current='https://referrer.example/start';
  assert.equal(scoreCandidate({visible:true,download:false,href:'https://target.example/',text:'Sponsored result'}, current, ''), -Infinity);
  assert.equal(scoreCandidate({visible:true,download:true,href:'https://target.example/file',text:'File'}, current, ''), -Infinity);
  assert.equal(scoreCandidate({visible:true,download:false,href:'javascript:void(0)',text:'Continue'}, current, ''), -Infinity);
  assert.equal(scoreCandidate({visible:true,download:false,href:'https://referrer.example/logout',text:'Log out'}, current, ''), -Infinity);
});

test('site referral prefers safe outbound links when no exact target is supplied', () => {
  const current='https://referrer.example/start';
  const outbound=scoreCandidate({visible:true,download:false,href:'https://destination.example/article',text:'Read more'}, current, '');
  const internal=scoreCandidate({visible:true,download:false,href:'https://referrer.example/about',text:'About'}, current, '');
  assert.ok(outbound > internal);
});
