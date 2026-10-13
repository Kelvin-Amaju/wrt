const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyBrowserRuntime } = require('./browser-runtime-verifier.cjs');

test('labels installed Google Chrome truthfully', () => {
  const result = verifyBrowserRuntime({ runtimeKind:'chrome-installed', browserVersion:'153.0.1', executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', deviceMode:'desktop' });
  assert.equal(result.browserFamily, 'Google Chrome');
  assert.equal(result.verificationStatus, 'verified');
  assert.equal(result.verificationLabel, 'REAL INSTALLED GOOGLE CHROME');
  assert.equal(result.isRealChrome, true);
});

test('labels Playwright compatibility engines without calling them Chrome', () => {
  assert.equal(verifyBrowserRuntime({ runtimeKind:'chromium-playwright', browserVersion:'153', deviceMode:'android-emulation' }).verificationLabel, 'PLAYWRIGHT BUNDLED CHROMIUM');
  assert.equal(verifyBrowserRuntime({ runtimeKind:'webkit-playwright', browserVersion:'18', deviceMode:'ios-emulation' }).browserFamily, 'WebKit');
  assert.equal(verifyBrowserRuntime({ runtimeKind:'firefox-playwright', browserVersion:'142', deviceMode:'desktop' }).browserFamily, 'Firefox');
});

test('verifies Android AVD Chrome only for com.android.chrome', () => {
  const result = verifyBrowserRuntime({ runtimeKind:'android-chrome', browserVersion:'153', deviceMode:'android-avd', packageName:'com.android.chrome' });
  assert.equal(result.browserFamily, 'Google Chrome Android');
  assert.equal(result.verificationLabel, 'REAL CHROME APP');
  assert.equal(result.isRealChrome, true);
});

test('does not pretend iPhone Chrome emulation is a physical iOS Chrome app', () => {
  const result = verifyBrowserRuntime({ runtimeKind:'chrome-installed', browserVersion:'153', executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', deviceMode:'ios-emulation' });
  assert.equal(result.verificationLabel, 'REAL INSTALLED GOOGLE CHROME');
  assert.equal(result.deviceMode, 'ios-emulation');
  assert.equal(result.isPhysicalDevice, false);
});
