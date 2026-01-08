@echo off
chcp 65001 >nul
echo ========================================
echo 停止 YourNote 服务
echo ========================================
echo.

echo 正在停止后端服务...
taskkill /FI "WINDOWTITLE eq YourNote-Backend*" /F >nul 2>&1

echo 正在停止前端服务...
taskkill /FI "WINDOWTITLE eq YourNote-Frontend*" /F >nul 2>&1

echo.
echo 服务已停止！
echo.
pause
