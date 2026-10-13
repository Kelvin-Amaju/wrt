const test=require('node:test');
const assert=require('node:assert/strict');
const {MIN_INTERACTION_DELAY_MS,MAX_INTERACTION_DELAY_MS,randomInteractionDelayMs,waitBeforePageInteraction}=require('./mandatory-interaction-delay.cjs');

test('mandatory interaction delay is always 2 to 5 seconds',()=>{
  for(let i=0;i<500;i++){
    const value=randomInteractionDelayMs();
    assert.ok(value>=MIN_INTERACTION_DELAY_MS);
    assert.ok(value<=MAX_INTERACTION_DELAY_MS);
  }
});

test('mandatory interaction delay delegates the chosen wait before action',async()=>{
  let seen=0;
  const value=await waitBeforePageInteraction({wait:async(ms)=>{seen=ms;}});
  assert.equal(value,seen);
  assert.ok(seen>=2000&&seen<=5000);
});
