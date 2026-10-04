@echo off
echo ========================================================
echo   Rewari Sweeper Beat Planning System
echo   Starting Local GIS Server...
echo ========================================================
echo.
echo Opening system in your default browser at http://localhost:8000
start http://localhost:8000
python -m http.server 8000
pause
