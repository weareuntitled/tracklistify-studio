import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Datenbank
DB_PATH = os.path.join(BASE_DIR, "tracklistify.db")

# Speicherorte für Uploads und Downloads (Hybrid-Ansatz)
STORAGE_DIR = os.path.join(BASE_DIR, "storage")
UPLOAD_DIR = os.path.join(STORAGE_DIR, "uploads")
DOWNLOAD_DIR = os.path.join(STORAGE_DIR, "downloads")

# Tracklistify spezifische Ordner (Legacy Pfade beibehalten)
SNIPPET_DIR = os.path.join(BASE_DIR, ".tracklistify", "snippets")
JSON_OUTPUT_DIR = os.path.join(BASE_DIR, ".tracklistify", "output")
IMPORT_JSON_CLEANUP_MODE = os.getenv("IMPORT_JSON_CLEANUP", "none")  # none, move, delete
IMPORT_JSON_ARCHIVE_DIR = os.path.join(JSON_OUTPUT_DIR, "processed")

# Statische Dateien (Logo, JS)
STATIC_DIR = os.path.join(BASE_DIR, "static")

# Sicherstellen, dass alle Ordner existieren
for d in [UPLOAD_DIR, DOWNLOAD_DIR, SNIPPET_DIR, JSON_OUTPUT_DIR, STATIC_DIR]:
    os.makedirs(d, exist_ok=True)