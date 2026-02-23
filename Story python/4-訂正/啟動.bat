@echo off
set VENV=D:\my_venv\Scripts\python.exe
set SCRIPT=%~dp0text_corrector_v5.py

if not exist "%VENV%" goto NO_VENV
if not exist "%SCRIPT%" goto NO_SCRIPT

"%VENV%" "%SCRIPT%"
goto END

:NO_VENV
echo Cannot find virtual environment: %VENV%
echo Please run: python -m venv D:\my_venv
goto END

:NO_SCRIPT
echo Cannot find text_corrector_v5.py in same folder
goto END

:END
echo.
echo Done. Press any key to close...
pause
