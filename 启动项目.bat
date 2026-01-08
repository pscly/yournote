@echo off
chcp 65001 >nul
echo ========================================
echo YourNote 项目启动脚本
echo ========================================
echo.

echo [1/2] 启动后端服务...
cd /d "%~dp0backend"
start "YourNote-Backend" cmd /k "uv run python run.py"

echo [2/2] 启动前端服务...
cd /d "%~dp0frontend"
start "YourNote-Frontend" cmd /k "npm run dev"

echo.
echo ========================================
echo 启动完成！
echo ========================================
echo.
echo 后端服务: http://localhost:8000
echo 前端界面: http://localhost:5173
echo.
echo 按任意键关闭此窗口...
pause >nul
