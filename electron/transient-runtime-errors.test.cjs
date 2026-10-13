const test=require('node:test');
const assert=require('node:assert/strict');
const {classifyTransientRuntimeError}=require('./transient-runtime-errors.cjs');
for(const [text,kind] of [
  ['No such device.','player-device-lost'],
  ['In-flight timeout exceeded','in-flight-timeout'],
  ['Timed out.','page-timeout'],
  ['page.goto: Timeout 20000ms exceeded','page-timeout'],
  ['net::ERR_SOCKET_NOT_CONNECTED','socket-not-connected'],
  ['net::ERR_CONNECTION_CLOSED','connection-interrupted'],
  ['AbortError: signal is aborted without reason','internal-abort'],
]) test(`classifies ${kind}`,()=>assert.equal(classifyTransientRuntimeError(text)?.kind,kind));
test('does not hide definitive errors',()=>assert.equal(classifyTransientRuntimeError('Invalid username or password'),null));
