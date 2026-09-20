@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or is not available in PATH.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting React development environments on:
//echo   Local:  http://127.0.0.1:5188
echo   LAN:    http://127.0.0.1:8080
echo.

//start "React 5188" cmd /k "npm run dev"
start "React 8080" cmd /k "npm run dev -- --host 0.0.0.0 --port 8080 --strictPort"

echo Both React development servers have been started.
echo Close the two server windows or press Ctrl+C in each window to stop them.

pause

endlocal
