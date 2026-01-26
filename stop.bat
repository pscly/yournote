@echo off
chcp 65001 >nul
echo ========================================
echo ========================================
echo.

echo stop...
taskkill /FI "WINDOWTITLE eq YourNote-Backend*" /F >nul 2>&1

echo stop2...
taskkill /FI "WINDOWTITLE eq YourNote-Frontend*" /F >nul 2>&1

echo.
echo stopokw
echo.
pause
