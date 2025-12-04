import os
import json
import datetime
import shutil
from config import (
    JSON_OUTPUT_DIR,
    DOWNLOAD_DIR,
    IMPORT_JSON_CLEANUP_MODE,
    IMPORT_JSON_ARCHIVE_DIR,
)
from database import get_conn


def _guess_audio_file_from_title(title):
    if not title:
        return None
    norm = title.lower().replace("_", " ").strip()
    best, score = None, 0
    try:
        if os.path.exists(DOWNLOAD_DIR):
            for f in os.listdir(DOWNLOAD_DIR):
                full = os.path.join(DOWNLOAD_DIR, f)
                if not os.path.isfile(full):
                    continue
                stem = os.path.splitext(f)[0].lower()
                sc = 0
                if norm in stem:
                    sc += 5
                sc += len(set(norm.split()) & set(stem.split()))
                if sc > score:
                    score, best = sc, full
    except Exception:
        pass
    return best if score > 0 else None


def _parse_time_to_seconds(val):
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str) and ":" in val:
        parts = val.split(":")
        try:
            if len(parts) == 2:
                return int(parts[0]) * 60 + int(parts[1])
            elif len(parts) == 3:
                return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        except Exception:
            pass
    try:
        return float(val)
    except Exception:
        return 0.0


def _cleanup_processed_file(path, filename, actions):
    if IMPORT_JSON_CLEANUP_MODE == "delete":
        try:
            os.remove(path)
            actions.append({"file": path, "action": "deleted"})
        except Exception as exc:
            actions.append({"file": path, "action": "delete_failed", "error": str(exc)})
    elif IMPORT_JSON_CLEANUP_MODE == "move":
        try:
            os.makedirs(IMPORT_JSON_ARCHIVE_DIR, exist_ok=True)
            target = os.path.join(IMPORT_JSON_ARCHIVE_DIR, filename)
            if os.path.exists(target):
                stem, ext = os.path.splitext(filename)
                target = os.path.join(
                    IMPORT_JSON_ARCHIVE_DIR,
                    f"{stem}_{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}{ext}",
                )
            shutil.move(path, target)
            actions.append({"file": path, "action": "moved", "destination": target})
        except Exception as exc:
            actions.append({"file": path, "action": "move_failed", "error": str(exc)})


def import_json_files():
    """
    Liest JSON-Dateien ein und schreibt sie in die DB.
    RÜCKGABE: Strukturiertes Ergebnis mit Status, importierten Set-IDs und Aktionen.
    """
    result = {
        "status": "pending",
        "message": "",
        "new_set_ids": [],
        "processed_files": [],
        "skipped_files": [],
        "errors": [],
        "cleanup_actions": [],
    }

    if not os.path.isdir(JSON_OUTPUT_DIR):
        result["status"] = "missing_directory"
        result["message"] = f"Output directory not found: {JSON_OUTPUT_DIR}"
        print(f"[Importer] {result['message']}")
        return result

    json_files = [f for f in sorted(os.listdir(JSON_OUTPUT_DIR)) if f.endswith(".json")]
    if not json_files:
        result["status"] = "no_new_files"
        result["message"] = "No JSON files to import."
        return result

    conn = get_conn()
    cur = conn.cursor()

    try:
        for fname in json_files:
            path = os.path.join(JSON_OUTPUT_DIR, fname)

            # Dubletten-Check
            cur.execute("SELECT id FROM sets WHERE source_file = ?", (os.path.abspath(path),))
            if cur.fetchone():
                result["skipped_files"].append({"file": path, "reason": "duplicate"})
                continue

            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)

                mix = data.get("mix_info", {}) or {}
                meta = data.get("meta", {}) or data.get("set", {}) or {}
                ana = data.get("analysis_info", {}) or {}

                raw_title = mix.get("title") or meta.get("title") or os.path.splitext(fname)[0]
                artist = mix.get("artist") or meta.get("artist")

                if not artist:
                    parts = raw_title.split(" - ", 1)
                    artist = parts[0] if len(parts) == 2 else "Unknown Artist"
                    if len(parts) == 2:
                        raw_title = parts[1]

                set_name = f"{artist} - {raw_title}"
                audio_file = ana.get("audio_file") or _guess_audio_file_from_title(raw_title)

                cur.execute(
                    "INSERT INTO sets (name, source_file, created_at, audio_file) VALUES (?, ?, ?, ?)",
                    (set_name, os.path.abspath(path), datetime.datetime.now().isoformat(), audio_file),
                )
                set_id = cur.lastrowid

                result["new_set_ids"].append(set_id)
                result["processed_files"].append(path)

                tracks = data.get("tracks") or data.get("tracklist") or []
                for i, t in enumerate(tracks, 1):
                    s = _parse_time_to_seconds(t.get("start") or t.get("start_seconds"))
                    e = _parse_time_to_seconds(t.get("end") or t.get("end_seconds"))

                    cur.execute(
                        """
                        INSERT INTO tracks (set_id, position, artist, title, confidence, start_time, end_time, flag)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
                        """,
                        (set_id, i, t.get("artist"), t.get("title"), t.get("confidence"), s, e),
                    )

            except Exception as e:
                result["errors"].append({"file": path, "error": str(e)})
                print(f"[Importer] Fehler bei {fname}: {e}")

        conn.commit()
    finally:
        conn.close()

    if result["processed_files"]:
        for path in result["processed_files"]:
            _cleanup_processed_file(path, os.path.basename(path), result["cleanup_actions"])

    if result["new_set_ids"]:
        result["status"] = "imported"
        result["message"] = f"Imported {len(result['new_set_ids'])} sets."
    elif result["errors"]:
        result["status"] = "errors"
        result["message"] = "Errors occurred during import."
    else:
        result["status"] = "no_new_files"
        if result["skipped_files"]:
            result["message"] = "No new files to import (duplicates)."
        else:
            result["message"] = "No new files to import."

    return result
