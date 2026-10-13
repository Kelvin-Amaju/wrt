const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRunHeadless, normalizeMatrixV3Request } = require('./qa-runner.cjs');

function request(mode) {
  return {
    version:3, urlPoolText:'https://example.com', runSeed:'x', executionMode:mode,
    devices:{ desktop:{enabled:true,browsers:['chromium'],instancesPerBrowser:1,sessionDurationSeconds:60,proxy:{source:'none',allowSlowProxies:false}}, androidEmulation:{enabled:false,profiles:['Pixel 7'],instancesPerProfile:1,sessionDurationSeconds:60,proxy:{source:'none',allowSlowProxies:false}}, iosEmulation:{enabled:false,browsers:['safari-ios'],profiles:['iPhone 13'],instancesPerProfile:1,sessionDurationSeconds:60,orientation:'portrait',locale:'en-US',timezoneId:'UTC',proxy:{source:'none',allowSlowProxies:false}}, androidAvd:{enabled:false,avdNames:[],sessionDurationSeconds:60}, realIos:{enabled:false,selections:[],sessionDurationSeconds:60}},
    proxyMode:'general', generalProxy:{source:'none',allowSlowProxies:false}, concurrency:{mode:'manual',value:1}, interactionIndicator:true,
    autoQa:{behaviorMode:'auto',readingPace:'natural',safeFormActions:true,observeNewTabs:true,referrerMode:'direct'}, steps:[],
    privacy:{strictMode:true,proxy:{enabled:false,server:'',username:'',password:'',requireVerifiedRoute:false,routeCheckUrl:'https://api64.ipify.org?format=json'}},
  };
}

test('visible and background execution map only browser visibility', () => {
  assert.equal(resolveRunHeadless('visible', false), false);
  assert.equal(resolveRunHeadless('background', false), false);
  assert.equal(resolveRunHeadless(undefined, true), true);
});

test('v3 background mode keeps a real headed renderer without reducing Auto-QA settings', () => {
  const normalized = normalizeMatrixV3Request(request('background'));
  assert.equal(normalized.executionMode, 'background');
  assert.equal(normalized.headless, false);
  assert.equal(normalized.autoQa.behaviorMode, 'auto');
  assert.equal(normalized.autoQa.observeNewTabs, true);
});

test('v3 visible mode keeps headed browser', () => {
  const normalized = normalizeMatrixV3Request(request('visible'));
  assert.equal(normalized.executionMode, 'visible');
  assert.equal(normalized.headless, false);
});
