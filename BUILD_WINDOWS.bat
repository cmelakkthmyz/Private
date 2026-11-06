@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Install Python 3.12 first: https://www.python.org/downloads/windows/
  pause
  exit /b 1
)
if not exist .venv\Scripts\python.exe py -3.12 -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -e ".[ai,ocr,build]"
python -m PyInstaller --noconfirm --clean --windowed --name MediaLupa ^
  --collect-all PySide6 --collect-all cv2 --collect-all numpy --collect-all PIL ^
  --collect-all torch --collect-all transformers --collect-all sentence_transformers --collect-all tokenizers ^
  --collect-all safetensors --collect-all platformdirs --collect-all pytesseract ^
  medialupa\__main__.py
if errorlevel 1 (
  echo Build failed. See the error above.
  pause
  exit /b 1
)
echo.
echo Hotovo: dist\MediaLupa\MediaLupa.exe
echo Slozku dist\MediaLupa zkopiruj na cilovy pocitac jako celek.
pause
