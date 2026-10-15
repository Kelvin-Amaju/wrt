'use strict';

const test = require('node:test');
const assert = require('node:assert');
const hardening = require('./device-hardening.cjs');

test('resolves profiles by avd name, model and codename', () => {
  assert.ok(hardening.findRealDeviceProfile('OrbitQA_Pixel_7_Real'));
  assert.ok(hardening.findRealDeviceProfile('pixel 7'));
  assert.ok(hardening.findRealDeviceProfile('panther'));
  assert.equal(hardening.findRealDeviceProfile('OrbitQA_API_34'), null);
});

test('every profile covers all three gates', () => {
  for (const profile of Object.values(hardening.REAL_DEVICE_PROFILES)) {
    for (const field of ['model', 'platform', 'hardwareConcurrency', 'deviceMemory',
      'maxTouchPoints', 'webglVendor', 'webglRenderer', 'buildFingerprint']) {
      assert.ok(profile[field] !== undefined, `${profile.id} missing ${field}`);
    }
  }
});

test('args disable the AutomationControlled blink feature', () => {
  const args = hardening.buildHardeningArgs('OrbitQA_Pixel_7_Real');
  assert.ok(args.includes('--disable-blink-features=AutomationControlled'));
});

test('props emit a retail fingerprint with no sdk_gphone token', () => {
  const props = hardening.buildHardeningProps('OrbitQA_Pixel_7_Real');
  const fp = props.find((p) => p.startsWith('ro.build.fingerprint='));
  assert.ok(fp && !/sdk_gphone|generic/.test(fp));
  assert.ok(props.some((p) => p === 'ro.build.tags=release-keys'));
  assert.ok(props.some((p) => p === 'ro.build.type=user'));
});

test('user agent rewrite keeps the live Chrome version', () => {
  const base = 'Mozilla/5.0 (Linux; Android 14; sdk_gphone64_x86_64 Build/UE1A.230829.036) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
  const ua = hardening.buildHardeningUserAgent('OrbitQA_Pixel_7_Real', base);
  assert.ok(ua.includes('Chrome/131.0.0.0'));
  assert.ok(ua.includes('Pixel 7'));
  assert.ok(!ua.includes('sdk_gphone'));
});

test('init source is serialisable and patches the key tells', () => {
  const src = hardening.hardeningInitSource('OrbitQA_Pixel_7_Real');
  assert.ok(src.includes('webdriver'));
  assert.ok(src.includes('37445'));
  assert.ok(src.includes('userAgentData'));
  assert.ok(src.includes('cdc_'));
});