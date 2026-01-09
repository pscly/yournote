@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo ========================================
echo.

REM 说明：
REM - 当前项目使用 SQLAlchemy 的 create_all 做“建表/补表”
REM - 适用于：新增表（比如 diary_detail_fetches）这种场景
REM - 不适用于：已有表需要 ALTER COLUMN/重命名列 等复杂迁移（那种建议上 Alembic）

cd /d "%~dp0"

where uv >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo [ERROR] no uv
  echo      or  go backend run init_db.py
  echo.
  pause
  exit /b 1
)

@REM echo [1/2] 进入 backend 目录...
cd /d "%~dp0backend"

@REM echo [2/2] 执行数据库初始化/补表（uv run python init_db.py）...
uv run python init_db.py

if %ERRORLEVEL% neq 0 (
  echo.
  echo [ERROR] db init error
  pause
  exit /b 1
)

echo.
echo ========================================
echo 数据库迁移/初始化完成
echo ========================================
echo.
pause >nul

