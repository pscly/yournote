@echo off
chcp 65001 >nul
echo ========================================
echo ========================================
echo.

echo [1/2] start1...
cd /d "%~dp0backend"
start "YourNote-Backend" cmd /k "uv run python run.py"

echo [2/2] start2...
cd /d "%~dp0frontend"
start "YourNote-Frontend" cmd /k "npm run dev"

echo.
echo ========================================
echo start ok
echo ========================================
echo.
echo  http://localhost:8000
echo  http://localhost:5173
echo.
pause >nul
