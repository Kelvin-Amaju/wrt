const test=require('node:test');
const assert=require('node:assert/strict');
const {detectSocialPlatform,listSocialPlatforms}=require('./platforms.cjs');
test('detects every configured social platform',()=>{
  const cases={youtube:'https://www.youtube.com/watch?v=abc',facebook:'https://www.facebook.com/example/posts/1',instagram:'https://www.instagram.com/p/abc/',x:'https://x.com/example/status/1',pinterest:'https://www.pinterest.com/pin/1/',tiktok:'https://www.tiktok.com/@example/video/1',linkedin:'https://www.linkedin.com/posts/example_1',reddit:'https://www.reddit.com/r/test/comments/1'};
  for(const [id,url] of Object.entries(cases))assert.equal(detectSocialPlatform(url),id);
  assert.equal(listSocialPlatforms().length,8);
});
