Android setup on a new Windows x64 PC
====================================

Open Device Profiles → Android Virtual Device. Read and accept the Android SDK
terms, then click **Set up Android Emulator**. Keep OrbitQA open until setup
finishes. Internet access and several GB of disk space are required.

The installer downloads checksum-verified Eclipse Temurin Java 21 and Google
Android Command-line Tools, installs the emulator/platform tools/system image,
and creates `OrbitQA_Pixel_7_Real`. Android Studio is not required. Existing AVDs
are preserved. Progress and failures appear in the setup log; failed downloads
can be retried. Downloads may take several minutes or longer depending on the
connection. Java is installed under `%LOCALAPPDATA%\OrbitQA\AndroidJava`; a new
SDK defaults to `%LOCALAPPDATA%\Android\Sdk`. An existing configured SDK is reused.

If the log requests acceleration setup, enable CPU virtualization in BIOS/UEFI
and **Windows Hypervisor Platform** in Windows Features, then restart Windows.
These machine settings are not changed automatically. After restarting, open
OrbitQA and launch the virtual phone.

The portable Electron build includes both PowerShell scripts in its resources
directory. Copy the packaged application to the new PC; the source project and
Node.js are not required. A newly built application is required for this feature.

Sources: https://developer.android.com/studio (tools and SDK terms),
https://developer.android.com/studio/run/emulator-acceleration (virtualization),
https://api.adoptium.net (Java release metadata and checksums).
