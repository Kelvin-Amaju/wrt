#requires -version 5.1
<#
  Creates a fleet of hardened AVDs for parallel runs (default: 20).
  Names them <BaseName>_01 .. <BaseName>_20 - every one still matches the
  Pixel 7 retail profile, so all of them boot hardened with retail -prop
  overrides and -gpu host.

  Fleet members are separate AVDs, so each gets its own writable userdata disk.
  That means no -read-only is needed and cookies/history never collide.

  Examples:
    powershell -ExecutionPolicy Bypass -File tools/create-avd-fleet.ps1 -Count 20
    powershell -ExecutionPolicy Bypass -File tools/create-avd-fleet.ps1 -Count 4 -SdkRoot "$env:LOCALAPPDATA\Android\Sdk"
#>
[CmdletBinding()]
param(
  [int]$Count = 20,
  [int]$StartIndex = 1,
  [string]$BaseName = 'OrbitQA_Pixel_7_Real',
  [int]$RamMb = 2048,
  [string]$SdkRoot = '',
  [string]$AvdHome = '',
  [switch]$Force,
  [switch]$SkipVerify,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'

if ($Count -lt 1) { throw "Count must be at least 1." }
if ($BaseName.Length + 3 -gt 64) { throw "BaseName is too long; AVD names cap at 64 characters." }

# Resolve the SDK the same way the app does, so manual and app-driven runs agree.
function Resolve-SdkRoot {
  param([string]$Explicit)
  $candidates = @(
    $Explicit,
    $env:ANDROID_SDK_ROOT,
    $env:ANDROID_HOME,
    $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }),
    $(if ($env:USERPROFILE) { Join-Path $env:USERPROFILE 'AppData\Local\Android\Sdk' }),
    'C:\Android\Sdk'
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) { return $candidate }
  }
  return ''
}

$resolvedSdk = Resolve-SdkRoot -Explicit $SdkRoot
if ($resolvedSdk) {
  $env:ANDROID_SDK_ROOT = $resolvedSdk
  $env:ANDROID_HOME = $resolvedSdk
}

if (-not $env:ANDROID_AVD_HOME) {
  $androidHome = if ($env:ANDROID_EMULATOR_HOME) { $env:ANDROID_EMULATOR_HOME }
                 elseif ($env:ANDROID_USER_HOME) { $env:ANDROID_USER_HOME }
                 elseif ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.android' }
                 else { '' }
  if ($androidHome) { $env:ANDROID_AVD_HOME = Join-Path $androidHome 'avd' }
}
if ($AvdHome) { $env:ANDROID_AVD_HOME = $AvdHome }

$create = Join-Path $PSScriptRoot 'create-real-device-avd.ps1'
if (-not (Test-Path $create)) { throw "create-real-device-avd.ps1 not found next to this script" }

if (-not $Quiet) {
  Write-Host "Creating $Count AVD(s) from $BaseName (RAM ${RamMb}MB each)..."
}

$created = @()
for ($i = $StartIndex; $i -lt ($StartIndex + $Count); $i++) {
  $name = '{0}_{1:D2}' -f $BaseName, $i
  if (-not $Quiet) {
    Write-Host ''
    Write-Host "--- $name ---"
  }
  & $create -AvdName $name -RamMb $RamMb -Force:$Force
  if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) {
    throw "create-real-device-avd.ps1 failed for $name (exit $LASTEXITCODE)"
  }
  $created += $name
}

if ($SkipVerify) {
  if (-not $Quiet) { Write-Host "Fleet of $($created.Count) AVD(s) created." }
  return
}

$emulator = if ($resolvedSdk) { Join-Path $resolvedSdk 'emulator\emulator.exe' } else { '' }
if (-not $emulator -or -not (Test-Path $emulator)) {
  if (-not $Quiet) { Write-Host "emulator.exe not found; skipping verification." }
  return
}

if (-not $Quiet) { Write-Host "`nVerifying..." }
$existing = & $emulator -list-avds
$missing = $created | Where-Object { $existing -notcontains $_ }
if ($missing) { throw "Fleet incomplete. Missing: $($missing -join ', ')" }

if (-not $Quiet) {
  Write-Host "Fleet ready:"
  $created | ForEach-Object { Write-Host "  $_" }
}