import { describe, expect, test } from 'vitest';
import { podFingerprint } from './podFingerprints';

describe('pod fingerprints', () => {
  test('are deterministic and complete for each supported country and device type', () => {
    for (const device of ['desktop', 'android', 'ios'] as const) for (const country of ['US', 'GB', 'CA', 'AU', 'NG', 'IN'] as const) {
      const first = podFingerprint(device, country, 4);
      expect(JSON.stringify(first)).toBe(JSON.stringify(podFingerprint(device, country, 4)));
      expect(first.userAgent).toBeTruthy(); expect(first.platform).toBeTruthy();
      expect(first.viewport.width).toBeGreaterThan(0); expect(first.viewport.height).toBeGreaterThan(0);
      expect(first.screen.colorDepth).toBeGreaterThan(0); expect(first.deviceScaleFactor).toBeGreaterThan(0);
      expect(first.locale).toBeTruthy(); expect(first.timezoneId).toBeTruthy(); expect(first.browserFamily).toBeTruthy();
    }
  });
});
