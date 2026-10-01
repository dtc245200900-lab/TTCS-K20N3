@echo off
cd /d "%~dp0"
title Hotel Manager Server

echo ========================================
echo     HOTEL MANAGER SERVER
echo ========================================
echo.

powershell.exe -NoProfile -Command "$health = $null; try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3001/health' -TimeoutSec 2 } catch {}; if ($health.status -eq 'ok' -and $health.runtime -eq 'python') { exit 0 } elseif ($health.status -eq 'ok') { exit 2 } else { exit 1 }"
if not errorlevel 1 (
	echo Hotel management app is already running at http://localhost:3001
	exit /b 0
)
if errorlevel 2 (
	echo A server using the previous backend is already running on port 3001.
	echo Stop that server, then run this launcher again to start the Python backend.
	if not defined HOTEL_NO_PAUSE pause
	exit /b 1
)

where py >nul 2>nul
if errorlevel 1 (
	echo Python 3 is required. Install Python 3 from https://www.python.org/downloads/ and try again.
	pause
	exit /b 1
)

if not exist "backend\.venv\Scripts\python.exe" (
	echo Creating Python virtual environment...
	py -3 -m venv backend\.venv
	if errorlevel 1 (
		echo Could not create the Python virtual environment.
		if not defined HOTEL_NO_PAUSE pause
		exit /b 1
	)
)

echo Checking Python dependencies...
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
	if errorlevel 1 (
		echo Python dependency installation failed.
		if not defined HOTEL_NO_PAUSE pause
		exit /b 1
	)

echo Starting server at http://localhost:3001
echo.
backend\.venv\Scripts\python.exe backend\app.py

if not defined HOTEL_NO_PAUSE pause
