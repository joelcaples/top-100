@echo off
REM Deployment script for ListFlair

REM Get deployment folder
setlocal
cd /d "%~dp0"

echo.
echo Building ListFlair deployment...
echo.

REM Install dependencies with scripts disabled to avoid native module compilation
echo Installing npm packages...
call npm install --production --ignore-scripts

if errorlevel 1 (
  echo Error installing dependencies
  exit /b 1
)

echo.
echo Deployment finished successfully.
echo.
