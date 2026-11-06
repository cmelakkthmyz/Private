@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Nejprve spust RUN_WINDOWS.bat.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
python -m pip install -e ".[ocr]"
echo.
echo Nyni nainstaluj Tesseract OCR pro Windows a jazyk Czech (ces).
echo https://github.com/UB-Mannheim/tesseract/wiki
pause
