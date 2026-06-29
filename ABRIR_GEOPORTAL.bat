@echo off
REM Inicia un servidor local y abre el geoportal en el navegador.
REM Necesario porque fetch() de datos.geojson no funciona con file:// (doble clic).
cd /d "%~dp0"
start "" http://localhost:8765/index.html
python -m http.server 8765
