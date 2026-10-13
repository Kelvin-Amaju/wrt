# Runtime Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make blocking overlays continuously supervised, auxiliary tabs close only after confirmed complete load plus observation, and v3 device scheduling fair across selected families while preserving truthful automation diagnostics.

**Architecture:** Extend the existing blocker observer with serialized periodic polling and improve close-control geometry for top-right DOM dismissers. Strengthen navigation-supervisor readiness gating so incomplete auxiliary documents remain open. Replace grouped v3 generation with lazy fair family interleaving. Do not modify navigator.webdriver or other automation/runtime identity signals.

**Tech Stack:** Electron, Node.js, Playwright, React, TypeScript.

**Spec:** Pasted continuation brief plus 2026-09-17 user runtime findings.

## Global Constraints
- TDD: failing regression first, then minimal production change.
- Never click ads/promotional CTAs or CAPTCHA/human-verification controls.
- Preserve same BrowserContext/proxy/privacy policy for auxiliary tabs.
- Do not fake navigator.webdriver/platform/hardware identity.
- Keep v3 generation lazy for huge runs.

---

### Task 1: Continuous blocker supervision
- Test: blocker observer continuously rechecks and dismisses newly appearing blocker.
- Test: top-right pointer-style DOM X adjacent to a dominant viewport blocker is a safe geometry candidate.
- Implement serialized monitor start/stop and safe geometry expansion.

### Task 2: Auxiliary-tab complete-load gate
- Test: auxiliary tab with load/readyState timeout is observed but not closed.
- Test: fully loaded tab receives minimum scroll/dwell before close.
- Implement explicit fullyLoaded result and close gate.

### Task 3: Fair mixed-device lazy scheduling
- Test: first 10 units from 10 desktop/5 Android/9 iOS include all families and a balanced 4/3/3 split.
- Test: once a family exhausts, remaining slots are filled from families with work left.
- Implement deterministic seeded family interleaving without materializing all WorkUnits.

### Task 4: Automation-label audit
- Test source does not inject a custom Playwright badge/title/overlay into tested webpages.
- Preserve truthful webdriver/host diagnostics; do not implement stealth/anti-detection changes.

### Task 5: Verification and packaging
- Run all Node tests available in sandbox.
- Run syntax checks.
- Run frontend/build/browser-health if dependencies are available; report any environment blocker exactly.
- Package only after fresh verification.
