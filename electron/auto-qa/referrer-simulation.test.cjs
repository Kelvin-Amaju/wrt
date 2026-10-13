const test = require('node:test');
const assert = require('node:assert/strict');
let mod = {};
try { mod = require('./referrer-simulation.cjs'); } catch {}

test('referrer simulation uses explicit QA labels and never requires third-party browsing', () => {
  assert.equal(typeof mod.resolveSimulatedReferrer, 'function');
  assert.deepEqual(mod.resolveSimulatedReferrer({ referrerMode:'direct' }), { mode:'direct', value:undefined, label:'Direct', applicable:true, simulated:false });
  const google = mod.resolveSimulatedReferrer({ referrerMode:'google-simulated' });
  assert.equal(google.value, 'https://www.google.com/');
  assert.match(google.label, /Simulated Google/);
  assert.equal(google.simulated, true);
  assert.throws(() => mod.resolveSimulatedReferrer({ referrerMode:'custom-simulated', customReferrer:'http://bad.test/' }), /https/i);
});
