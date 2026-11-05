:: SPDX-License-Identifier: GPL-3.0-or-later
@echo off
setlocal
chcp 65001 >nul
title FeatherScript
cd /d "%~dp0"

echo.
echo   FeatherScript
echo.

REM The app lives next to bridge.py and starts it itself, so a ZIP preview that
REM extracted only this file is caught here instead of failing deep in Python.
if not exist "%~dp0bridge.py" goto :no_bridge

where node >nul 2>nul
if errorlevel 1 goto :no_node

if exist "%~dp0featherscript-app\node_modules\electron\package.json" goto :shell_ready

echo   First run - installing the app shell, this takes a minute...
echo.
pushd "%~dp0featherscript-app"
call npm ci --include=dev --ignore-scripts --no-audit --no-fund
set "NPM_EXIT=%errorlevel%"
popd
if not "%NPM_EXIT%"=="0" goto :npm_failed

:shell_ready
set "ELECTRON=%~dp0featherscript-app\node_modules\electron\dist\electron.exe"

echo   Checking the pinned Electron runtime (downloads only if needed)...
echo.
pushd "%~dp0featherscript-app"
REM Install the pinned runtime explicitly; dependency lifecycle scripts are disabled.
call node "%~dp0featherscript-app\scripts\install-electron.js"
set "RUNTIME_EXIT=%errorlevel%"
popd
if not "%RUNTIME_EXIT%"=="0" goto :download_failed
if not exist "%ELECTRON%" goto :download_failed

:launch
echo   Starting FeatherScript - the local bridge starts with it.
start "" "%ELECTRON%" "%~dp0featherscript-app"
exit /b 0

:no_bridge
echo   ERROR: bridge.py not found next to app.bat.
echo.
echo   If you opened app.bat from inside the downloaded ZIP, extract the whole
echo   ZIP first ^(right-click, "Extract All..."^), then run app.bat again.
echo.
pause
exit /b 1

:no_node
echo   FeatherScript needs Node.js to run its window.
echo.
echo   Install the LTS build from https://nodejs.org/ then run app.bat again.
echo.
start "" "https://nodejs.org/en/download"
pause
exit /b 1

:npm_failed
echo.
echo   ERROR: npm install failed ^(see the output above^).
echo   Check your internet connection, then run app.bat again.
echo.
pause
exit /b 1

:download_failed
echo.
echo   ERROR: the Electron runtime could not be downloaded.
echo.
echo   The app window itself is Electron, so FeatherScript cannot start without
echo   the download. It comes from GitHub and is sometimes blocked:
echo.
echo     - check your internet connection, then run app.bat again
echo     - behind a proxy:  set HTTPS_PROXY=http://host:port  then run app.bat again
echo     - if security software flags a file, keep protection on and report the detection
echo.
echo   To retry the download by hand:
echo     cd "%~dp0featherscript-app"
echo     node scripts\install-electron.js
echo.
pause
exit /b 1
