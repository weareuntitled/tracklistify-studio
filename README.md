Tracklistify Studio (Helper Edition)
Tracklistify Studio ist eine lokale Hybrid-Webanwendung für DJs und Musiksammler. Sie automatisiert die Analyse von DJ-Sets, erkennt Tracks (via Audio-Fingerprinting), verwaltet Metadaten und hilft beim Aufbau einer kuratierten Musikbibliothek ("Merkliste").

(Hier könnte später ein Screenshot des Dashboards stehen)

🚀 Features
Smart Import & Analyse:

Importiere Sets direkt via YouTube/Mixcloud URL oder lokale Audiodateien.

Automatische Erkennung von Metadaten (Artist, Event, Name) aus Dateinamen oder Videotiteln.

Hintergrund-Verarbeitung in einer Warteschlange (Queue) – arbeite weiter, während analysiert wird.

Audio Player & Preloading:

Instant Playback: Streaming-URLs werden im Hintergrund vorgeladen (Aggressive Preloading), sodass Tracks sofort starten.

Visualizer: Ästhetische Waveform-Visualisierung basierend auf Track-Daten.

Midas Touch Scrubbing: Optimierter Player für einfache Navigation im Set.

Set Management:

Metadaten-Editor für Sets (B2B, Event, Tags).

Dashboard mit Statistiken (Top Artists, Discovery Rate).

Track Discovery:

"Merkliste" (Likes) Funktion.

Direkte Links zu Bandcamp (Primary), Beatport, SoundCloud und YouTube.

Rescan-Queue für nicht erkannte Tracks.

🛠️ Voraussetzungen
Bevor du startest, stelle sicher, dass folgende Tools installiert sind:

Python 3.10+

FFmpeg: Zwingend erforderlich für Audio-Konvertierung und Analyse.

Windows: Anleitung (Muss im System-PATH sein).

Mac: brew install ffmpeg

Linux: sudo apt install ffmpeg

📦 Installation
Repository klonen:

Bash

git clone https://github.com/DEIN_USER/tracklistify-studio.git
cd tracklistify-studio
Virtuelle Umgebung erstellen (Empfohlen):

Bash

# Windows
python -m venv .venv
.venv\Scripts\activate

# Mac/Linux
python3 -m venv .venv
source .venv/bin/activate
Abhängigkeiten installieren:

Bash

pip install -r requirements.txt
# Falls requirements.txt fehlt, installiere die Kern-Pakete manuell:
pip install flask yt-dlp tracklistify
Hinweis: Stelle sicher, dass du auch das tracklistify Kern-Modul installiert hast (falls es ein separates Paket ist).

▶️ Starten
Windows (Einfach)
Doppelklicke auf die Datei start_helper.bat.

Manuell (Terminal)
Bash

python app.py
Der Server startet standardmäßig auf http://127.0.0.1:5000.

📂 Projektstruktur
Plaintext

tracklistify/
├── app.py                 # Flask Server & API Routes
├── job_manager.py         # Hintergrund-Queue Logik
├── database.py            # SQLite Datenbank-Layer
├── config.py              # Pfad-Konfigurationen
├── services/
│   ├── processor.py       # Worker: Download, Analyse, Cleanup
│   └── importer.py        # Importiert JSON-Ergebnisse in DB
├── static/
│   └── js/app.js          # Frontend Logik (Alpine.js)
└── templates/             # HTML Views (Jinja2)
    ├── index.html         # Hauptlayout
    └── components/        # Modulare UI-Komponenten
🗺️ Roadmap
[ ] Spotify Export: Erstelle Playlists direkt aus deinen Likes.

[ ] Artist Database: Detaillierte Profile für gefundene Künstler.

[ ] Drag & Drop: Einfacheres Hinzufügen von Dateien.

[ ] Keyboard Shortcuts: Schnelleres Navigieren im Player.

⚠️ Disclaimer
Dieses Tool nutzt yt-dlp zum Streamen und Analysieren von Audio. Bitte beachte die Urheberrechte und Nutzungsbedingungen der jeweiligen Plattformen (YouTube, Mixcloud, etc.). Die heruntergeladenen Dateien werden nach der Analyse automatisch gelöscht (Hybrid-Ansatz), um Speicherplatz zu sparen und lokale Kopien zu minimieren.
