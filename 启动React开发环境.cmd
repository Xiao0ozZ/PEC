@echo off
setlocal

cd /d "%~dp0"

echo Starting React development environment on http://127.0.0.1:5188 ...
call npm run dev

if errorlevel 1 (
  echo.
  echo React development environment failed to start.
  pause
)

endlocal
