const test=require('node:test'); const assert=require('node:assert/strict'); const {shouldRest}=require('./rest-policy.cjs');
test('rest threshold is respected',()=>{assert.equal(shouldRest({tracksSinceRest:4,restAfterTracks:5}),false); assert.equal(shouldRest({tracksSinceRest:5,restAfterTracks:5}),true); assert.equal(shouldRest({tracksSinceRest:10,restAfterTracks:0}),false);});
