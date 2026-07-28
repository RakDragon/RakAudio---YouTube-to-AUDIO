@echo off
chcp 65001 > NUL
title YT Audio Pro Editor - Motor del Sistema

cd /d "%~dp0.."

echo Iniciando servidor Backend (Flask)...
start /b cmd /c "cd backend && python app.py > nul 2>&1"

echo Iniciando servidor Frontend (HTML)...
start /b cmd /c "cd frontend && python -m http.server 8000 > nul 2>&1"

echo Preparando entorno...
timeout /t 3 /nobreak > NUL

echo Abriendo la interfaz...
start http://localhost:8000

echo.
echo ==================================================================
echo SISTEMA EN LINEA Y FUNCIONANDO.
echo Manten esta pequena ventana abierta mientras editas tus audios.
echo Simplemente cierra esta ventana (X) para apagar los servidores.
echo ==================================================================
pause > NUL
