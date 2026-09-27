@echo off
cd /d "%~dp0"
title Hotel Manager Server

echo ========================================
echo     HOTEL MANAGER SERVER
echo ========================================
echo.
echo Starting server at http://localhost:3000
echo.

call npm run dev

pause
