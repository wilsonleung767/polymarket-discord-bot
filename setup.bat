@echo off
echo ============================================================
echo Polymarket Copy Trading Discord Bot - Setup
echo ============================================================
echo.

REM Check if .env exists
if not exist .env (
    echo Creating .env from .env.example...
    copy .env.example .env
    echo.
    echo IMPORTANT: Please edit .env and fill in your credentials:
    echo - DISCORD_TOKEN
    echo - DISCORD_APP_ID
    echo - GUILD_ID
    echo - POLY_PRIVATE_KEY
    echo.
    pause
) else (
    echo .env already exists, skipping...
    echo.
)

REM Install dependencies
echo Installing dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: npm install failed
    pause
    exit /b 1
)

echo.
echo ============================================================
echo Setup Complete!
echo ============================================================
echo.
echo Next steps:
echo 1. Edit .env and fill in your credentials
echo 2. Run: npm run register-commands
echo 3. Run: npm run dev
echo.
pause
