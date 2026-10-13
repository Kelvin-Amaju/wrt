@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   ORBITQA DESKTOP v0.20.1 - RUN FULL SOURCE
echo ============================================================
echo.

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node.js / npm was not found.
  echo Install Node.js LTS, then double-click this file again.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [1/2] Installing the exact project dependencies from package-lock.json...
  call npm.cmd ci
  if errorlevel 1 goto :failed
) else (
  echo [1/2] Exact project dependencies already present.
)

echo.
echo [2/2] Type-checking and rebuilding the current OrbitQA renderer...
call npm.cmd run build
if errorlevel 1 goto :failed

echo.
echo Starting OrbitQA v0.20.1 from the freshly rebuilt source...
start "OrbitQA v0.20.1" "node_modules\electron\dist\electron.exe" .
exit /b 0

:failed
echo.
echo OrbitQA could not be prepared. Copy the error above and send it to ChatGPT.
echo Do not delete your OrbitQA user data and do not run npm audit fix --force.
pause
exit /b 1
