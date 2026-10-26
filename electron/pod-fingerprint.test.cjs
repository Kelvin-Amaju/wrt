const test = require('node:test');
const assert = require('node:assert/strict');
const { fingerprintFor } = require('./pod-store.cjs');

test('fingerprints stay deterministic and complete for every device and country combination', () => {
  for (const device of ['desktop', 'android', 'ios']) for (const country of ['US', 'GB', 'CA', 'AU', 'NG', 'IN']) {
    const a = fingerprintFor(device, country, 7); const b = fingerprintFor(device, country, 7);
    assert.deepEqual(a, b); assert.ok(a.userAgent); assert.ok(a.platform); assert.ok(a.viewport.width && a.viewport.height);
    assert.ok(a.screen.width && a.screen.height && a.deviceScaleFactor); assert.ok(a.locale && a.timezoneId && a.browserFamily);
  }
});
