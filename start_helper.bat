@echo off
:: Titel des Fensters setzen
title Tracklistify Helper Console

:: In das Verzeichnis der Batch-Datei wechseln (falls als Admin gestartet)
cd /d "%~dp0"

:: Prüfen, ob venv existiert
if not exist ".venv\Scripts\activate.bat" (
    echo [FEHLER] .venv nicht gefunden! Bitte erstelle ein Virtual Environment.
    pause
    exit /b
)

:: Venv aktivieren
call .venv\Scripts\activate

:: Fehlende Dependencies gezielt nachinstallieren (z.B. beautifulsoup4)
echo Pruefe Python-Abhaengigkeiten...
python -c "import importlib.util, sys; missing=[pkg for pkg in ['bs4'] if importlib.util.find_spec(pkg) is None]; print('Missing: ' + ', '.join(missing) if missing else ''); sys.exit(len(missing))"
if errorlevel 1 (
    echo Einige Pakete fehlen. Installiere fehlende Pakete direkt...
    pip install beautifulsoup4
    if errorlevel 1 (
        echo [FEHLER] Konnte beautifulsoup4 nicht installieren. Bitte manuell pruefen.
        pause
        exit /b
    )
)

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