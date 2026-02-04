@echo off
:: Titel des Fensters setzen
title Tracklistify Helper Console

:: In das Verzeichnis der Batch-Datei wechseln (falls als Admin gestartet)
cd /d "%~dp0"

:: Prüfen, ob venv existiert (falls nicht, erstellen)
if not exist ".venv\Scripts\activate.bat" (
    echo [INFO] .venv nicht gefunden. Erstelle Virtual Environment...
    python -m venv .venv
)

:: Venv aktivieren
call .venv\Scripts\activate

:: Dependencies installieren
echo Installiere Python-Abhaengigkeiten...
python -m pip install -r requirements.txt

:: Info ausgeben
echo.
echo ========================================================
echo   TRACKLISTIFY HELPER
echo ========================================================
echo.
echo   Starte Server...
echo   Browser sollte sich gleich oeffnen: http://127.0.0.1:5000
echo.

:: Browser im Hintergrund öffnen (wartet 2 Sekunden, damit Server Zeit hat)
timeout /t 2 >nul
start http://127.0.0.1:5000

:: Flask App starten
python app.py

:: Falls der Server abstürzt, Fenster offen lassen zum Lesen des Fehlers
pause
