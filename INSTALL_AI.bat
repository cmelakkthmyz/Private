@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Nejprve spust RUN_WINDOWS.bat, aby se vytvorilo virtualni prostredi.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -e ".[ai]"
echo.
echo AI modul je nainstalovan. Model CLIP se stahne pri prvni AI analyze.
pause
