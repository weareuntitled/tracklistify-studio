![Tracklistify banner](docs/assets/banner.png)

# Tracklistify Studio

A Flask-based helper app that wraps the `tracklistify` analyzer with a simple queue, downloader, and dashboard UI. Studio lets you drop in YouTube/Mixcloud/SoundCloud links or upload audio files, runs the Tracklistify CLI in the background, and imports the generated JSON into a local SQLite library with snippets and playback support.

## What this repo contains
- **Flask UI (`app.py`, `templates/`, `static/`)** – dashboard, queue, likes, and rescan views built with Tailwind + Alpine.
- **Job pipeline (`job_manager.py`, `services/processor.py`)** – downloads audio via `yt-dlp`, runs `python -m tracklistify`, and streams analyzer logs back to the UI.
- **Importer (`services/importer.py`)** – ingests Tracklistify JSON from `.tracklistify/output` into `tracklistify.db` with metadata guessing.
- **Storage layout (`config.py`)** – creates data directories under the repo so everything works out of the box.

## Prerequisites
- Python 3.11+
- `ffmpeg` available on your `PATH`
- `yt-dlp` (Python package) for downloads/metadata
- A working internet connection for provider calls (Shazam/ACRCloud via the Tracklistify CLI)

> The repo includes the `tracklistify` package itself (see `pyproject.toml`), so you do **not** need a separate checkout. Installing the repo in editable mode gives you the `tracklistify` CLI used by the processor.

## Setup
```bash
# Clone
git clone https://github.com/betmoar/tracklistify-studio.git
cd tracklistify-studio

# Create and activate a virtual environment (example for venv)
python -m venv .venv
source .venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt
pip install -e .  # provides the local `tracklistify` CLI
```

## Directory layout
- `tracklistify.db` – SQLite database with sets and tracks
- `storage/uploads` – uploaded audio files from the UI
- `storage/downloads` – temporary downloads created by `yt-dlp`
- `.tracklistify/output` – JSON emitted by the Tracklistify analyzer (importer reads from here)
- `.tracklistify/snippets` – audio snippets used by the player
- `static/` – bundled JS/CSS assets

All folders are created automatically when `config.py` is imported.

## Running the app
```bash
# From an activated virtualenv
python app.py
```
The server initializes the database, kicks off the background job worker, imports any JSON already present in `.tracklistify/output`, and serves the UI at `http://127.0.0.1:5000`.

### Processing a set
1. Open the UI and choose **Add to queue**.
2. Submit a **URL** (YouTube/Mixcloud/SoundCloud/etc.) or upload an **audio file**. Optional metadata (artist, name, event, tags) is stored after import.
3. The queue view shows phases (`downloading → analyzing → importing`) and live logs from Tracklistify so you can spot provider/ffmpeg errors while a job runs.
4. Imported sets appear in the sidebar; tracks can be liked/flagged, and problematic entries can be marked for rescan.

### Manual import
If you generated Tracklistify JSON yourself, drop the files into `.tracklistify/output` and call:
```bash
python - <<'PY'
from services import importer
print(importer.import_json_files())
PY
```
You can also trigger it from the UI via **Rescan → Import JSON** (`POST /api/sets/import`).

## API hints
- `GET /api/queue/status` – current job + recent history
- `POST /api/queue/add` – enqueue a URL or uploaded file
- `POST /api/resolve_metadata` – quick metadata guess via `yt-dlp`
- `GET /api/sets`, `GET /api/sets/<id>/tracks` – data for the main views

The endpoints mirror the UI features and return JSON suitable for automation.

## Troubleshooting
- **`yt-dlp` or `ffmpeg` missing:** ensure both are installed and reachable on `PATH`. Download/analysis will fail otherwise.
- **Analyzer exits with errors:** check the job log in the queue view; if Tracklistify aborted, clear broken downloads and re-run the job after fixing the dependency/config issue.
- **No sets imported:** confirm `.tracklistify/output` contains JSON and that `services/importer.py` hasn’t already deduplicated the same `source_file` path. Delete/move stale files after successful imports to avoid reprocessing.
- **Database location:** `tracklistify.db` lives in the repo root. Delete it to reset the library; it will be recreated on next start.

## Development notes
- Tailwind/Alpine templates live in `templates/` with component includes under `templates/components/`.
- Background work runs inside the Flask process; `JobManager` spawns a single worker thread at import time (`job_manager.manager`).
- Tests can be added under `tests/` and executed with `pytest` once dependencies are installed.

## License
MIT – see [LICENSE](LICENSE).
