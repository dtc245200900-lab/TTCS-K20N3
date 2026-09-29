@echo off
cd /d "%~dp0"
title Hotel Manager Server

echo ========================================
echo     HOTEL MANAGER SERVER
echo ========================================
echo.
echo Starting server at http://localhost:3001
echo.

set "NODEJS_PATH=C:\Program Files\Microsoft Visual Studio\18\Community\MSBuild\Microsoft\VisualStudio\NodeJs"
set "PATH=%NODEJS_PATH%;%PATH%"

call npm run dev

pause
