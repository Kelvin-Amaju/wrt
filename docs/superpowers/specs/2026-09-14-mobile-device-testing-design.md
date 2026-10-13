# OrbitQA Mobile Device Testing Design

## Goal

Add mobile testing to OrbitQA Desktop on Windows with two clearly separated modes:

1. **Real Android Virtual Device** — launch and control an Android AVD/emulator installed through the Android SDK.
2. **iPhone/iPad Browser Emulation** — run Playwright WebKit with Playwright's device descriptors for iPhone/iPad behavior. This is browser emulation, not Apple's iOS Simulator.

## Scope

This milestone extends the existing Test Runs and Device Profiles modules. It does not add cloud devices, physical USB device management, Apple Xcode simulators, Appium, account/login systems, or background services.

## Platform constraints

- OrbitQA V1 remains Windows-only.
- The desktop application remains local-first.
- Android emulator processes run only when the user explicitly launches or uses an Android test.
- iPhone/iPad testing on Windows is labeled **Emulation** everywhere; OrbitQA must not call it a real iOS simulator.
- Real Apple iOS Simulator support is out of scope because it requires macOS/Xcode.
- Existing desktop Chromium, Firefox, and WebKit testing must continue to work.
- Default concurrency remains lightweight. Real Android AVD testing is limited to one emulator/device per run in the first milestone.

## User experience

### Device Profiles page

Replace the placeholder with a working page containing three tabs:

- Desktop
- Android Virtual Device
- iPhone/iPad Emulation

### Android Virtual Device tab

Show:

- Android SDK status: detected / not detected
- ADB status
- Emulator binary status
- Installed AVD list
- Selected AVD
- Current device state: stopped / booting / ready / unavailable
- Buttons: Refresh Devices, Launch Virtual Phone, Stop Virtual Phone

OrbitQA auto-detects the SDK from `ANDROID_HOME`, `ANDROID_SDK_ROOT`, and common Windows SDK locations. Users can also select a custom SDK path in Settings later.

When Launch Virtual Phone is selected, OrbitQA starts the Android emulator executable for the selected AVD and waits for `adb` to report the device as ready. It does not keep an emulator running in the background after the user stops it.

### iPhone/iPad Emulation tab

Show a curated list of Playwright device descriptors, initially:

- iPhone 13
- iPhone 13 Pro
- iPhone 13 Pro Max
- iPhone 13 Mini
- iPad Pro 11
- iPad Mini

The UI shows viewport, device scale factor, touch support, and orientation where available.

### Test Runs page

Add **Target Device** above the browser selector:

- Desktop Browser
- Android Virtual Device
- iPhone/iPad Emulation

Behavior:

- **Desktop Browser** keeps the current Chromium / Firefox / WebKit selector.
- **Android Virtual Device** selects an installed AVD. The browser is Chrome for Android. OrbitQA launches or connects to the selected AVD, then uses Playwright's experimental Android bridge to automate Chrome.
- **iPhone/iPad Emulation** selects a Playwright device descriptor and runs it through WebKit on Windows.

The existing behavior steps (wait, scroll, click, type, screenshot) remain the common script model. Android support may surface a clear setup error if the connected Chrome instance does not meet Playwright Android requirements rather than silently falling back to desktop emulation.

## Android architecture

Create a focused Android service in the Electron main process.

Responsibilities:

1. Discover Android SDK tools.
2. List AVDs using `emulator -list-avds`.
3. Check ADB devices using `adb devices`.
4. Launch an AVD with `emulator -avd <name>`.
5. Poll boot completion using ADB with a bounded timeout.
6. Stop the selected emulator cleanly with `adb -s <serial> emu kill`.
7. Expose status and lifecycle actions over Electron IPC.

The service never accepts arbitrary shell command text from the renderer. It accepts validated AVD names and uses `spawn`/`execFile` with argument arrays.

## Android browser automation

The QA runner gains a device mode. For Android runs it uses Playwright's `_android` API, which is currently documented as experimental. The runner:

1. Resolves an ADB-connected Android device.
2. Connects to Chrome for Android.
3. Opens the target URL.
4. Executes the same high-level steps supported by the desktop runner where Playwright Android exposes equivalent browser-page functionality.
5. Saves screenshots under the existing run folder.
6. Reports unsupported Android actions as explicit run errors.

Because Playwright Android support is experimental, OrbitQA displays a small **Experimental** badge for real Android automation.

## iPhone/iPad emulation architecture

Use `playwright.devices[deviceName]` to configure a normal WebKit browser context. The runner merges the selected descriptor into `browser.newContext()`.

This emulates browser-facing properties such as viewport, user agent, device scale factor, touch support, and mobile viewport behavior. OrbitQA does not claim that this is the Apple iOS operating system.

## Shared data model

Extend `QaRunRequest` with:

- `deviceMode: 'desktop' | 'android' | 'ios-emulation'`
- `deviceName?: string`

Validation rules:

- Desktop requires a supported desktop browser.
- Android requires a non-empty AVD/device name and forces one session / one concurrency in this milestone.
- iOS emulation requires a supported iPhone/iPad descriptor and WebKit.

## IPC surface

Expose only narrow APIs through the preload bridge:

- `mobile:getStatus`
- `mobile:listAvds`
- `mobile:launchAvd`
- `mobile:stopAvd`
- existing `qa:startRun` with the extended request model
- existing `qa:event`

No Node.js or shell access is exposed directly to React.

## Error handling

User-facing errors must explain the next action. Examples:

- Android SDK not found → install Android Studio/SDK or configure SDK path.
- No AVDs installed → create a virtual device in Android Device Manager.
- Emulator boot timeout → stop/retry the AVD.
- ADB unavailable → restart ADB or repair Android SDK Platform Tools.
- Playwright Android Chrome prerequisite missing → show the exact prerequisite instead of falling back silently.
- Unknown iOS descriptor → reject before starting the run.

## Performance

- Do not start Android tools during normal OrbitQA startup beyond fast path detection.
- Device polling occurs only while the Device Profiles page is open or an Android operation is active.
- One AVD at a time for V1 mobile testing.
- Existing desktop concurrency cap of five remains unchanged.
- iOS emulation uses the existing lightweight Playwright process model.

## Testing

Unit tests cover:

- SDK path discovery inputs.
- Parsing `emulator -list-avds` output.
- Parsing `adb devices` output.
- Safe AVD-name validation.
- Device-mode request validation.
- iOS device descriptor resolution.
- Runner context-option selection.
- React Device Profiles states.
- Test Runs device-mode controls.

Integration/manual checks cover:

- Existing desktop Chromium test still completes.
- Real AVD launches and reaches ready state on Windows.
- Android Chrome opens the authorized target when Android automation prerequisites are satisfied.
- iPhone/iPad WebKit emulation completes a run and reports the selected device.
- Closing/stopping an AVD leaves OrbitQA responsive.

## First-run setup

OrbitQA does not silently install Android Studio. When Android SDK tools are missing, Device Profiles shows a guided setup card. The beginner setup path is:

1. Install Android Studio.
2. Install Android SDK Platform Tools and Android Emulator.
3. Create one AVD in Device Manager.
4. Return to OrbitQA and click Refresh Devices.

Once setup is complete, normal Android runs happen from OrbitQA; the user does not need to work inside Android Studio for every test.

## Out of scope for this milestone

- Real iOS Simulator on Windows.
- macOS/Xcode integration.
- Physical iPhone automation.
- Cloud device farms.
- Multiple simultaneous Android emulators.
- Automated Android Studio installation.
- Anti-detect/fingerprint evasion.
