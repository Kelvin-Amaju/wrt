@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   ORBITQA DESKTOP v0.20.1 - ONE-CLICK WINDOWS BUILDER
echo ============================================================
echo.

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node.js / npm was not found.
  echo Install Node.js LTS, then double-click this file again.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\vite.cmd" (
  echo [1/3] Installing the exact project dependencies from package-lock.json...
  call npm.cmd ci
  if errorlevel 1 goto :failed
) else (
  echo [1/3] Dependencies already present.
)

echo.
echo [2/3] Building and type-checking OrbitQA v0.20.1...
call npm.cmd run build
if errorlevel 1 goto :failed

echo.
echo [3/3] Packaging the Windows portable EXE...
call npx.cmd electron-builder --config electron-builder.yml --win portable --x64
if errorlevel 1 goto :failed

echo.
echo ============================================================
echo BUILD COMPLETE - ORBITQA v0.20.1
echo ============================================================
echo.
echo Your portable app is in the RELEASE folder:
echo OrbitQA-Desktop-v0.20.1-portable.exe
echo.
if exist "%CD%\release" explorer "%CD%\release"
pause
exit /b 0

:failed
echo.
echo ============================================================
echo BUILD FAILED
echo ============================================================
echo Copy the error shown above and send it to ChatGPT.
echo Do not delete your OrbitQA user data and do not run npm audit fix --force.
echo.
pause
exit /b 1
