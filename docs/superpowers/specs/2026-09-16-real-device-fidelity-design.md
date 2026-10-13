# OrbitQA Real Device Fidelity & Android Reliability Design

## Goal
Make OrbitQA clearly distinguish compatibility emulation from native mobile runtimes, improve Android AVD launch/recovery reliability on Windows, and surface device-fidelity diagnostics without spoofing platform or automation signals.

## Scope
- Keep Desktop, Android mobile emulation, Android AVD, Local iOS Compatibility, and Real iOS Provider as separate execution modes.
- Add an explicit runtime-fidelity classification to every device identity report.
- Classify expected host limitations separately from true identity contradictions.
- Improve Android AVD startup to recover from common ADB offline/server states and verify boot + Chrome readiness.
- Preserve existing privacy checks, proxy routing, timers, STOP behavior, and Smart Interaction safety rules.
- Do not modify or hide navigator.webdriver, navigator.platform, CPU/GPU/memory/sensor values, or other browser/runtime signals for anti-detection purposes.

## Fidelity Model
Each identity report exposes one of:
- `desktop-automation`: desktop browser automation runtime.
- `compatibility-emulation`: Playwright mobile compatibility profile on the host OS.
- `native-android-runtime`: Chrome running inside an ADB-connected Android virtual device.
- `real-ios-provider`: provider-backed iPhone/iPad browser runtime.

The report includes `level`, `label`, `description`, and `limitations`.

## Diagnostic Severity
Checks gain a `classification` field:
- `consistent`: matches the selected execution mode.
- `expected-limitation`: mismatch is expected for a compatibility mode and is not treated as a software defect.
- `warning`: observable inconsistency worth attention.
- `blocking`: required identity property is incompatible with the selected mode.

Examples:
- Android emulation + `navigator.platform = Win32` => `expected-limitation`.
- Android emulation + `navigator.webdriver = true` => `expected-limitation` and still reported truthfully.
- Android AVD + no Android UA or zero touch points => `blocking`.
- Android AVD + non-Linux platform => `warning`/blocking depending on severity.

## Android AVD Reliability
Before launching:
1. Ensure ADB server is running.
2. Inspect devices including offline emulator instances.
3. Try `adb reconnect offline` if an emulator is offline.
4. If still offline, restart the ADB server once and re-check.
5. Reuse a booted matching AVD when possible.
6. Launch the requested AVD with a cold-start-safe profile (`-no-snapshot-load`, `-no-boot-anim`) to avoid corrupted quick-boot state.
7. Wait up to 180 seconds for `sys.boot_completed=1`.
8. Verify package manager responsiveness and Chrome presence before reporting ready.

No destructive `-wipe-data` recovery is performed automatically.

## UI
The Device Identity Check panel shows a fidelity badge and short explanation. Compatibility limitations are visually distinct from normal warnings. Device Profiles explains which modes are compatibility vs native/runtime-backed.

## Testing
- Unit tests for fidelity classification and check classification.
- Unit tests for ADB recovery and cold-boot launch arguments.
- Regression tests for existing Android launch safety and AVD-name validation.
- Full npm test, production build, and browser-health run before release.
