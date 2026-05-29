@echo off
REM Launch TradingView Desktop on Windows with the Chrome DevTools Protocol enabled.
REM Usage: scripts\launch_tv_debug.bat [PORT]

setlocal
set PORT=%1
if "%PORT%"=="" set PORT=9222

REM Quit any running instance so the debug flag takes effect.
taskkill /IM TradingView.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

set TV_EXE=%LOCALAPPDATA%\Programs\TradingView\TradingView.exe
if not exist "%TV_EXE%" (
  echo ERROR: TradingView.exe not found at "%TV_EXE%".
  echo Install it from https://www.tradingview.com/desktop/ and re-run.
  exit /b 1
)

echo Launching TradingView with CDP on port %PORT%...
start "" "%TV_EXE%" --remote-debugging-port=%PORT%
endlocal
