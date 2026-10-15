#requires -version 5.1
<#
  Creates a second, hardened AVD that presents as a retail Pixel 7.
  Uses a Google Play system image so Play Services / Play Integrity see a retail build.
  Does NOT touch your existing AVD.
#>
[CmdletBinding()]
param(
  [string]$AvdName = 'OrbitQA_Pixel_7_Real',
  [string]$Package = 'system-images;android-14;google_apis_playstore;x86_64',
  [string]$Device  = 'pixel_7',
  [int]   $RamMb   = 4096,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'

function Get-SdkRoot {
  if ($env:ANDROID_SDK_ROOT) { return $env:ANDROID_SDK_ROOT }
  if ($env:ANDROID_HOME)     { return $env:ANDROID_HOME }
  foreach ($c in @((Join-Path $env:LOCALAPPDATA 'Android\Sdk'), 'C:\Android\Sdk')) {
    if (Test-Path $c) { return $c }
  }
  throw 'Android SDK not found. Set ANDROID_SDK_ROOT or ANDROID_HOME.'
}

$sdk = Get-SdkRoot
$avdman = Join-Path $sdk 'cmdline-tools\latest\bin\avdmanager.bat'
if (-not (Test-Path $avdman)) {
  $alt = Get-ChildItem (Join-Path $sdk 'cmdline-tools') -Filter avdmanager.bat -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($alt) { $avdman = $alt.FullName } else { throw "avdmanager.bat not found under $sdk" }
}
$sdkman = Join-Path (Split-Path $avdman) 'sdkmanager.bat'

$installed = (& $sdkman --list_installed 2>$null | Out-String)
if ($installed -notmatch [regex]::Escape($Package)) {
  Write-Host "Installing $Package ..."
  & $sdkman --install $Package | Out-Null
}

$existing = (& $avdman list avd 2>$null | Out-String)
if ($existing -match "Name:\s+$([regex]::Escape($AvdName))") {
  if (-not $Force) { Write-Host "$AvdName already exists (use -Force)."; exit 0 }
  & $avdman delete avd -n $AvdName | Out-Null
}

Write-Host "Creating AVD $AvdName ..."
'no' | & $avdman create avd -n $AvdName -k $Package -d $Device --force | Out-Null

$avdHome = if ($env:ANDROID_AVD_HOME) { $env:ANDROID_AVD_HOME } else { Join-Path $env:USERPROFILE '.android\avd' }
$cfg = Join-Path $avdHome "$AvdName.avd\config.ini"
if (-not (Test-Path $cfg)) { throw "config.ini not found at $cfg" }

$overrides = @{
  'hw.ramSize'                = $RamMb
  'vm.heapSize'               = 512
  'hw.gpu.enabled'            = 'yes'
  'hw.gpu.mode'               = 'host'
  'hw.keyboard'               = 'yes'
  'hw.mainKeys'               = 'no'
  'hw.sensors.orientation'    = 'yes'
  'hw.sensors.proximity'      = 'yes'
  'hw.sensors.light'          = 'yes'
  'hw.sensors.pressure'       = 'yes'
  'hw.sensors.magnetic_field' = 'yes'
  'hw.sensors.gyroscope'      = 'yes'
  'hw.audioInput'             = 'yes'
  'hw.audioOutput'            = 'yes'
  'hw.camera.back'            = 'webcam0'
  'hw.camera.front'           = 'webcam0'
  'hw.battery'                = 'yes'
  'disk.dataPartition.size'   = '6442450944'
  'showDeviceFrame'           = 'yes'
}

$lines = Get-Content $cfg
foreach ($k in $overrides.Keys) {
  $pat = "^\s*$([regex]::Escape($k))\s*="
  if ($lines -match $pat) { $lines = $lines -replace $pat, "$k=$($overrides[$k])" }
  else { $lines += "$k=$($overrides[$k])" }
}
Set-Content -Path $cfg -Value $lines -Encoding ASCII

Write-Host ""
Write-Host "AVD '$AvdName' created at $cfg"
Write-Host "Launch: tools\launch-real-device-avd.ps1 -AvdName $AvdName"