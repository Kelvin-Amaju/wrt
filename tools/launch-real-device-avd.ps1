#requires -version 5.1
<#
  Boots the AVD using its system image identity, waits for boot,
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
if (-not $env:ANDROID_AVD_HOME) {
  $androidHome = if ($env:ANDROID_EMULATOR_HOME) { $env:ANDROID_EMULATOR_HOME } elseif ($env:ANDROID_USER_HOME) { $env:ANDROID_USER_HOME } else { Join-Path $env:USERPROFILE '.android' }
  $env:ANDROID_AVD_HOME = Join-Path $androidHome 'avd'
}

function Get-SdkRoot {
  $candidates = @(
    $env:ANDROID_SDK_ROOT,
    $env:ANDROID_HOME,
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }),
    $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE 'AppData\Local\Android\Sdk' }),
    'C:\Android\Sdk'
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  throw 'Android SDK not found. Set ANDROID_SDK_ROOT or ANDROID_HOME.'
}

$sdk = Get-SdkRoot
$emulator = Join-Path $sdk 'emulator\emulator.exe'
$adb      = Join-Path $sdk 'platform-tools\adb.exe'
if (-not (Test-Path $emulator)) { throw "emulator.exe not found at $emulator" }

$serial = "emulator-$Port"

$emuArgs = @('-avd', $AvdName, '-port', $Port, '-no-snapshot-load', '-no-boot-anim', '-gpu', 'host', '-no-audio')
if ($WipeData) { $emuArgs += '-wipe-data' }
if ($NoWindow) { $emuArgs += '-no-window' }

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
Write-Host "Serial: $serial"

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
foreach ($p in $props) { $emuArgs += @('-prop', $p) }