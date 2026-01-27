@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

@REM 默认端口（如 .env 未配置则使用默认值）
set "BACKEND_PORT=31012"
set "FRONTEND_PORT=31011"

if exist "%~dp0.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%~dp0.env") do (
    set "K=%%A"
    set "V=%%B"
    if /I "!K!"=="BACKEND_PORT" set "BACKEND_PORT=!V!"
    if /I "!K!"=="FRONTEND_PORT" set "FRONTEND_PORT=!V!"
  )
)

echo ========================================
echo ========================================
echo.

echo [1/2] start backend...
cd /d "%~dp0backend"
start "YourNote-Backend" cmd /k "uv run python run.py"

echo [2/2] start frontend...
cd /d "%~dp0frontend"
start "YourNote-Frontend" cmd /k "npm run dev"

echo.
echo ========================================
echo start ok
echo ========================================
echo.
echo  Backend:   http://localhost:%BACKEND_PORT%  (Docs: /docs)
echo  Frontend:  http://localhost:%FRONTEND_PORT%
echo.
