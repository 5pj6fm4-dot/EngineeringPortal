@echo off
chcp 65001 >nul
setlocal
REM Support launching from a network UNC folder.
pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
  echo Cannot access the EngineeringPortal folder.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start_Design_Tools.ps1"
set "RESULT=%ERRORLEVEL%"
popd
if not "%RESULT%"=="0" (
  echo.
  echo Design Tools could not be started. Check the message above.
  pause
)
exit /b %RESULT%
