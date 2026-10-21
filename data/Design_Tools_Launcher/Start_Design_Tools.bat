@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start_Design_Tools.ps1"
if errorlevel 1 (
  echo.
  echo Design Tools could not be started. Please read the message above.
  pause
)
endlocal
