#requires -version 5.1
<#
  Creates a fleet of hardened AVDs for parallel runs (default: 20).
  Names them <BaseName>_01 .. <BaseName>_20 - every one still matches the
  Pixel 7 retail profile, so all of them boot hardened.

  Example:
    powershell -ExecutionPolicy Bypass -File tools/create-avd-fleet.ps1 -Count 20
#>
[CmdletBinding()]
param(
  [int]$Count = 20,
  [int]$StartIndex = 1,
  [string]$BaseName = 'OrbitQA_Pixel_7_Real',
  [int]$RamMb = 2048,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'

$create = Join-Path $PSScriptRoot 'create-real-device-avd.ps1'
if (-not (Test-Path $create)) { throw "create-real-device-avd.ps1 not found next to this script" }

Write-Host "Creating $Count AVD(s) from $BaseName (RAM ${RamMb}MB each)..."
for ($i = $StartIndex; $i -lt ($StartIndex + $Count); $i++) {
  $name = '{0}_{1:D2}' -f $BaseName, $i
  Write-Host ""
  Write-Host "--- $name ---"
  & $create -AvdName $name -RamMb $RamMb -Force:$Force
}

Write-Host ""
Write-Host "Fleet ready. Verifying..."
$sdk = if ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT }
       elseif ($env:ANDROID_HOME) { $env:ANDROID_HOME }
       elseif ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
       else { 'C:\Android\Sdk' }
& (Join-Path $sdk 'emulator\emulator.exe') -list-avds