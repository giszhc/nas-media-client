@echo off
rem YunYing NAS Media Center - Windows launcher
rem Double click to start the local service and open an app-style window.
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if "%PORT%"=="" set PORT=8787
set "URL=http://127.0.0.1:%PORT%"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Please install Node.js 18+ from https://nodejs.org/
  pause
  exit /b 1
)

if not exist "data" mkdir "data"

rem Reuse an already running instance
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%URL%/api/state' -UseBasicParsing -TimeoutSec 1; exit 0 } catch { exit 1 }" >nul 2>nul
if errorlevel 1 (
  echo Starting YunYing service...
  start "" /min cmd /c "node server.js >> data\server.log 2>&1"
  timeout /t 3 /nobreak >nul
)

set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME%" (
  start "" "%CHROME%" --app=%URL% --window-size=1440,900 --no-first-run
  goto :eof
)

set "CHROME86=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%CHROME86%" (
  start "" "%CHROME86%" --app=%URL% --window-size=1440,900 --no-first-run
  goto :eof
)

set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" --app=%URL% --window-size=1440,900
  goto :eof
)

start "" "%URL%"
