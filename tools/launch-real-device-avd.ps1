#requires -version 5.1
<#
  Boots the hardened AVD with -prop retail fingerprint overrides, waits for boot,
  restores animation scales, and prints the resulting fingerprint.
#>
[CmdletBinding()]
param(
  [string]$AvdName = 'OrbitQA_Pixel_7_Real',
  [int]   $Port    = 5554,
  [switch]$NoWindow,
  [switch]$WipeData
)
$ErrorActionPreference = 'Stop'

$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT }
       elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME }
       else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
$emulator = Join-Path $sdk 'emulator\emulator.exe'
$adb      = Join-Path $sdk 'platform-tools\adb.exe'
if (-not (Test-Path $emulator)) { throw "emulator.exe not found at $emulator" }

$serial = "emulator-$Port"

$props = @(
  'ro.product.model=Pixel 7',
  'ro.product.brand=google',
  'ro.product.manufacturer=Google',
  'ro.product.device=panther',
  'ro.product.name=panther',
  'ro.build.product=panther',
  'ro.build.tags=release-keys',
  'ro.build.type=user',
  'ro.build.fingerprint=google/panther/panther:14/UQ1A.240205.004/11269751:user/release-keys',
  'ro.system.build.fingerprint=google/panther/panther:14/UQ1A.240205.004/11269751:user/release-keys',
  'ro.vendor.build.fingerprint=google/panther/panther:14/UQ1A.240205.004/11269751:user/release-keys'
)

$emuArgs = @('-avd', $AvdName, '-port', $Port, '-no-snapshot-load', '-no-boot-anim', '-gpu', 'host', '-no-audio')
if ($WipeData) { $emuArgs += '-wipe-data' }
if ($NoWindow) { $emuArgs += '-no-window' }
foreach ($p in $props) { $emuArgs += @('-prop', $p) }

Write-Host "Launching $AvdName on $serial ..."
Start-Process -FilePath $emulator -ArgumentList $emuArgs | Out-Null

& $adb -s $serial wait-for-device | Out-Null
do {
  Start-Sleep -Seconds 2
  $booted = ((& $adb -s $serial shell getprop sys.boot_completed 2>$null) -join '').Trim()
} until ($booted -eq '1')

& $adb -s $serial shell settings put global window_animation_scale 1.0 | Out-Null
& $adb -s $serial shell settings put global transition_animation_scale 1.0 | Out-Null
& $adb -s $serial shell settings put global animator_duration_scale 1.0 | Out-Null

$fp = ((& $adb -s $serial shell getprop ro.build.fingerprint) -join '').Trim()
Write-Host "ro.build.fingerprint = $fp"
if ($fp -match 'sdk_gphone|generic') { Write-Warning 'Fingerprint still looks emulated.' } else { Write-Host 'Fingerprint OK.' }
Write-Host "Serial: $serial"