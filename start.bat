@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%" || exit /b 1

where node >nul 2>nul
if errorlevel 1 (
  echo Missing dependency: Node.js is not installed.
  echo Please install Node.js first, then try again.
  echo.
  pause
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo Missing dependency: pnpm is not installed.
  echo Please install pnpm first, then try again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Dependencies are missing. Installing workspace dependencies...
  call pnpm install
  if errorlevel 1 exit /b 1
)

call :prepare_package_if_needed "packages\plugin-protocol" "@jiaban/plugin-protocol"
if errorlevel 1 exit /b 1
call :prepare_package_if_needed "packages\server-shared" "@jiaban/server-shared"
if errorlevel 1 exit /b 1
call :prepare_package_if_needed "packages\server-runtime" "@jiaban/server-runtime"
if errorlevel 1 exit /b 1

call pnpm --dir apps/desktop dev
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo Jiaban exited with status %EXIT_CODE%.
pause
exit /b %EXIT_CODE%

:prepare_package_if_needed
set "PACKAGE_DIR=%~1"
set "PACKAGE_NAME=%~2"

if exist "%PACKAGE_DIR%\dist\*" (
  echo Using cached workspace package: %PACKAGE_NAME%
  exit /b 0
)

echo Preparing workspace package: %PACKAGE_NAME%
call pnpm -r --filter "%PACKAGE_NAME%" build
exit /b %ERRORLEVEL%
