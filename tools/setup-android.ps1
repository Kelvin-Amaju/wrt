#requires -version 5.1
# Installs per-user prerequisites; does not require Android Studio or admin rights.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$SdkRoot)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
if (-not $env:ANDROID_AVD_HOME) {
  $androidHome = if ($env:ANDROID_EMULATOR_HOME) { $env:ANDROID_EMULATOR_HOME } elseif ($env:ANDROID_USER_HOME) { $env:ANDROID_USER_HOME } else { Join-Path $env:USERPROFILE '.android' }
  $env:ANDROID_AVD_HOME = Join-Path $androidHome 'avd'
}
$work = Join-Path ([IO.Path]::GetTempPath()) ('orbitqa-android-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
  Write-Output 'Preparing Java 21 ...'
  $javaRoot = Join-Path $env:LOCALAPPDATA 'OrbitQA\AndroidJava'
  $java = Get-ChildItem $javaRoot -Filter java.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $java) {
    Write-Output 'Downloading Eclipse Temurin Java 21 ...'
    $assets = Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
    $package = $assets[0].binary.package
    if (-not $package.link.StartsWith('https://') -or -not $package.checksum) { throw 'Java download metadata is invalid.' }
    $zip = Join-Path $work 'java.zip'
    Invoke-WebRequest -UseBasicParsing -Uri $package.link -OutFile $zip
    if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne $package.checksum) { throw 'Java checksum verification failed.' }
    Expand-Archive -LiteralPath $zip -DestinationPath $javaRoot -Force
    $java = Get-ChildItem $javaRoot -Filter java.exe -Recurse | Select-Object -First 1
  }
  if (-not $java) { throw 'Java installation was not found after extraction.' }
  $env:JAVA_HOME = Split-Path (Split-Path $java.FullName)
  $env:PATH = (Join-Path $env:JAVA_HOME 'bin') + ';' + $env:PATH

  $sdkman = Join-Path $SdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'
  if (-not (Test-Path $sdkman)) {
    Write-Output 'Downloading Android SDK Command-line Tools ...'
    $zip = Join-Path $work 'tools.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' -OutFile $zip
    if ((Get-FileHash $zip -Algorithm SHA256).Hash -ne '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a') { throw 'Android tools checksum verification failed.' }
    $extract = Join-Path $work 'sdk'
    Expand-Archive -LiteralPath $zip -DestinationPath $extract
    $latest = Join-Path $SdkRoot 'cmdline-tools\latest'
    New-Item -ItemType Directory -Path $latest -Force | Out-Null
    Copy-Item -Path (Join-Path $extract 'cmdline-tools\*') -Destination $latest -Recurse -Force
  }
  Write-Output 'Installing emulator, platform tools and Android system image ...'
  # Run in a child process: the creation script may exit early for an existing AVD.
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'create-real-device-avd.ps1')
  if ($LASTEXITCODE -ne 0) { throw "Android device setup failed (exit $LASTEXITCODE)." }
  $avds = & (Join-Path $SdkRoot 'emulator\emulator.exe') -list-avds
  if ($LASTEXITCODE -ne 0 -or $avds -notcontains 'OrbitQA_Pixel_7_Real') { throw 'Setup finished but OrbitQA_Pixel_7_Real was not detected. Retry setup and check the log.' }
  Write-Output 'Checking emulator acceleration ...'
  $acceleration = & (Join-Path $SdkRoot 'emulator\emulator.exe') -accel-check 2>&1
  $accelExit = $LASTEXITCODE
  $acceleration | ForEach-Object { Write-Output "$_" }
  if ($accelExit -ne 0) {
    Write-Output 'ACTION REQUIRED: Enable CPU virtualization in BIOS/UEFI and Windows Hypervisor Platform in Windows Features, then restart Windows.'
  }
  Write-Output 'Android installation complete.'
} finally {
  # Only clean the unique temporary directory created by this invocation.
  if ((Split-Path $work -Parent) -eq ([IO.Path]::GetTempPath()).TrimEnd('\')) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}
