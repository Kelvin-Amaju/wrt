#requires -version 5.1
<#
  Creates a hardened retail-spoofing AVD.
  - resolves the SDK explicitly and passes --sdk_root everywhere
  - accepts licences before installing
  - picks the best available Play-store system image instead of hard-coding one
  - fails loudly with the real reason
  Does NOT touch any existing AVD.
#>
[CmdletBinding()]
param(
  [string]$AvdName = 'OrbitQA_Pixel_7_Real',
  [string]$Package = '',                # blank = auto-pick
  [string]$Device  = 'pixel_7',
  [int]   $RamMb   = 4096,
  [switch]$Force
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
$bin = Join-Path $sdk 'cmdline-tools\latest\bin'
$sdkman = Join-Path $bin 'sdkmanager.bat'
$avdman = Join-Path $bin 'avdmanager.bat'
if (-not (Test-Path $avdman)) {
  $alt = Get-ChildItem (Join-Path $sdk 'cmdline-tools') -Filter avdmanager.bat -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($alt) { $avdman = $alt.FullName; $sdkman = Join-Path (Split-Path $alt.FullName) 'sdkmanager.bat' }
  else { throw "avdmanager.bat not found under $sdk. Install 'Android SDK Command-line Tools' from Android Studio > SDK Manager > SDK Tools." }
}
if (-not (Test-Path $sdkman)) { throw "sdkmanager.bat not found next to $avdman" }

Write-Host "SDK   : $sdk"
Write-Host "sdkman: $sdkman"

if (-not $env:JAVA_HOME) {
  $jbr = 'C:\Program Files\Android\Android Studio\jbr'
  if (Test-Path $jbr) { $env:JAVA_HOME = $jbr; Write-Host "JAVA_HOME set to $jbr" }
  else { Write-Warning 'JAVA_HOME is not set and no Android Studio JBR was found; sdkmanager may fail.' }
}

# --- 1. accept licences (this is what silently broke before) ---
Write-Host 'Accepting SDK licences ...'
$yes = (1..60 | ForEach-Object { 'y' }) -join "`n"
$yes | & $sdkman --sdk_root="$sdk" --licenses 2>&1 | Out-Null

# --- 2. confirm the remote index actually loads ---
Write-Host 'Reading package index ...'
$listOutput = (& $sdkman --sdk_root="$sdk" --list 2>&1 | Out-String)
$available = [regex]::Matches($listOutput, '(?m)^\s*(system-images;[^|\s]+)\s*\|') |
  ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
if (-not $available) {
  throw "sdkmanager returned no system images. Check network/proxy access to dl.google.com, or install a system image manually via Android Studio > SDK Manager."
}

if (-not $Package) {
  $prefs = @(
    'system-images;android-35;google_apis_playstore;x86_64',
    'system-images;android-34;google_apis_playstore;x86_64'
  )
  foreach ($p in $prefs) { if ($available -contains $p) { $Package = $p; break } }
  if (-not $Package) { $Package = $available | Where-Object { $_ -match 'google_apis_playstore;x86_64$' } | Select-Object -First 1 }
  if (-not $Package) { $Package = $available | Where-Object { $_ -match 'google_apis;x86_64$' } | Select-Object -First 1 }
  if (-not $Package) { $Package = $available | Select-Object -First 1 }
}
if (-not $Package) { throw 'No usable system image found.' }
Write-Host "Image : $Package"

$api = ([regex]::Match($Package, 'android-(\d+)')).Groups[1].Value

# --- 3. install image + platform + tools, with exit-code checks ---
$installed = (& $sdkman --sdk_root="$sdk" --list_installed 2>&1 | Out-String)
foreach ($pkg in @($Package, "platforms;android-$api", 'emulator', 'platform-tools')) {
  if ($pkg -and $installed -notmatch [regex]::Escape($pkg)) {
    Write-Host "Installing $pkg ..."
    & $sdkman --sdk_root="$sdk" --install $pkg 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "sdkmanager failed installing $pkg (exit $LASTEXITCODE)." }
  }
}

$verify = (& $sdkman --sdk_root="$sdk" --list_installed 2>&1 | Out-String)
if ($verify -notmatch [regex]::Escape($Package)) { throw "$Package is still not installed after the install step." }
Write-Host 'Image verified as installed.'

# --- 4. create the AVD ---
$existing = (& $avdman list avd 2>&1 | Out-String)
if ($existing -match "Name:\s+$([regex]::Escape($AvdName))") {
  if (-not $Force) { Write-Host "$AvdName already exists (use -Force to recreate)."; exit 0 }
  & $avdman delete avd -n $AvdName | Out-Null
}

Write-Host "Creating AVD $AvdName ..."
'no' | & $avdman create avd -n $AvdName -k $Package -d $Device --force 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
  Write-Warning "create avd failed with device id '$Device'; retrying without -d"
  'no' | & $avdman create avd -n $AvdName -k $Package --force 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "avdmanager could not create $AvdName (exit $LASTEXITCODE)." }
}

# --- 5. locate config.ini via the .ini 'path=' entry ---
$avdHome = if ($env:ANDROID_AVD_HOME) { $env:ANDROID_AVD_HOME } else { Join-Path $env:USERPROFILE '.android\avd' }
$ini = Join-Path $avdHome "$AvdName.ini"
$cfg = $null
if (Test-Path $ini) {
  $pathLine = (Get-Content $ini | Where-Object { $_ -match '^path=' }) -replace '^path=', ''
  if ($pathLine) { $cfg = Join-Path $pathLine.Trim() 'config.ini' }
}
if (-not $cfg -or -not (Test-Path $cfg)) { $cfg = Join-Path $avdHome "$AvdName.avd\config.ini" }
if (-not (Test-Path $cfg)) { throw "AVD was created but config.ini was not found. Check $avdHome" }

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
  $pat = "^\s*$([regex]::Escape($k))\s*=.*$"
  if ($lines -match $pat) { $lines = $lines -replace $pat, "$k=$($overrides[$k])" }
  else { $lines += "$k=$($overrides[$k])" }
}
Set-Content -Path $cfg -Value $lines -Encoding ASCII

Write-Host ''
Write-Host "AVD '$AvdName' created from $Package"
Write-Host "  config: $cfg"
Write-Host 'Verifying with the emulator ...'
& (Join-Path $sdk 'emulator\emulator.exe') -list-avds
