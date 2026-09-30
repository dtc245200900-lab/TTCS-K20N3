@echo off
cd /d "%~dp0"
title Hotel Manager Server

echo ========================================
echo     HOTEL MANAGER SERVER
echo ========================================
echo.

powershell.exe -NoProfile -Command "$health = $null; try { $health = Invoke-RestMethod -Uri 'http://localhost:3001/health' -TimeoutSec 2 } catch {}; if ($health.status -eq 'ok') { exit 0 } else { exit 1 }"
if not errorlevel 1 (
	echo Hotel management app is already running at http://localhost:3001
	exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
	echo Node.js is required. Install the current LTS version from https://nodejs.org/ and try again.
	pause
	exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
	echo npm was not found. Reinstall Node.js with the npm option enabled, then try again.
	pause
	exit /b 1
)

if not exist "backend\node_modules\express" (
	echo Installing project dependencies...
	call npm install
	if errorlevel 1 (
		echo Dependency installation failed.
		pause
		exit /b 1
	)
)

echo Starting server at http://localhost:3001
echo.
call npm run dev

pause
