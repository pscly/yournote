@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo ========================================
echo.

@REM REM 说明：
@REM REM - 当前项目使用 SQLAlchemy 的 create_all 做“建表/补表”
@REM REM - 适用于：新增表（比如 diary_detail_fetches）这种场景
@REM REM - 不适用于：已有表需要 ALTER COLUMN/重命名列 等复杂迁移（那种建议上 Alembic）

cd /d "%~dp0"

where uv >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo [ERROR] no uv
  echo      or  go backend run init_db.py
  echo.
  pause
  exit /b 1
)

cd /d "%~dp0backend"

uv run python init_db.py

if %ERRORLEVEL% neq 0 (
  echo.
  echo [ERROR] db init error
  pause
  exit /b 1
)

echo.
echo ========================================
echo ========================================
echo.
pause >nul

