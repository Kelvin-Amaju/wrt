const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');

test('shared click/tap layer requires mandatory wait',()=>{
  const src=read('interaction-indicator.cjs');
  assert.match(src,/mandatory-interaction-delay\.cjs/);
  assert.match(src,/waitBeforePageInteraction\(\{signal:options\.signal,lifetime:options\.lifetime,wait:options\.wait\}\)/);
});

test('Run direct click and typing paths require mandatory wait',()=>{
  const runner=read('qa-runner.cjs');
  const smart=read('smart-interaction.cjs');
  assert.match(runner,/waitBeforePageInteraction\(\{lifetime:context\.lifetime\}\)/);
  assert.match(smart,/async function progressiveType[\s\S]*waitBeforePageInteraction/);
  assert.match(smart,/const activate = async \(\) => \{\s*await waitBeforePageInteraction/);
});

test('Social comment typing and fallback submit use mandatory wait',()=>{
  const src=read('social/social-runner.cjs');
  assert.match(src,/async function typeVisible[\s\S]*waitBeforePageInteraction\(\{signal,wait:sleep\}\)/);
  assert.match(src,/waitBeforePageInteraction\(\{signal,wait:sleep\}\);await composer\.press\('Control\+Enter'\)/);
});

test('Streaming fallback tap and keyboard actions use mandatory wait',()=>{
  const src=read('streaming/adapters/_factory.cjs');
  assert.match(src,/touch tap[\s\S]*waitBeforePageInteraction\(\)[\s\S]*item\.tap/);
  assert.match(src,/keyboard Enter[\s\S]*waitBeforePageInteraction\(\)[\s\S]*keyboard\.press\('Enter'\)/);
  assert.match(src,/keyboard Space[\s\S]*waitBeforePageInteraction\(\)[\s\S]*keyboard\.press\('Space'\)/);
});
