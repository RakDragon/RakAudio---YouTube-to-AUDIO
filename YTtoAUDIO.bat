@echo off
title YT Audio Pro Editor - Motor del Sistema

echo Iniciando servidor Backend (Flask)...
start /b python app.py > nul 2>&1

echo Iniciando servidor Frontend (HTML)...
start /b python -m http.server 8000 > nul 2>&1

echo Preparando entorno...
timeout /t 3 /nobreak > NUL

echo Abriendo la interfaz...
start http://localhost:8000

echo.
echo ==================================================================
echo SISTEMA EN LINEA Y FUNCIONANDO.
echo Mantén esta pequeña ventana abierta mientras edites tus audios.
echo Simplemente cierra esta ventana (X) para apagar los servidores.
echo ==================================================================
pause > NUL