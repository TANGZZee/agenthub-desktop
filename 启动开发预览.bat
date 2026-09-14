@echo off
setlocal

REM Always run from the project directory, even when double-clicked.
cd /d "%~dp0"

REM Load the Visual Studio C++ tools needed by Rust on Windows.
set "VCVARS_PATH=D:\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS_PATH%" set "VCVARS_PATH=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"

call "%VCVARS_PATH%" >nul
if errorlevel 1 (
    echo [ERROR] Visual Studio 2022 C++ build tools were not found.
    pause
    exit /b 1
)

echo Starting AgentHub Desktop...
call npm run tauri dev

if errorlevel 1 (
    echo.
    echo [ERROR] Startup failed. Please send the full error above to Codex.
    pause
)

endlocal
