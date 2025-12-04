import os
import json
import datetime
from typing import Dict, List

from config import JSON_OUTPUT_DIR, DOWNLOAD_DIR, BASE_DIR
from database import get_conn

def _guess_audio_file_from_title(title):
    if not title: return None
    norm = title.lower().replace("_", " ").strip()
    best, score = None, 0
    try:
        if os.path.exists(DOWNLOAD_DIR):
            for f in os.listdir(DOWNLOAD_DIR):
                full = os.path.join(DOWNLOAD_DIR, f)
                if not os.path.isfile(full): continue
                stem = os.path.splitext(f)[0].lower()
                sc = 0
                if norm in stem: sc += 5
                sc += len(set(norm.split()) & set(stem.split()))
                if sc > score: score, best = sc, full
    except: pass
    return best if score > 0 else None

def _parse_time_to_seconds(val):
    if val is None: return 0.0
    if isinstance(val, (int, float)): return float(val)
    if isinstance(val, str) and ":" in val:
        parts = val.split(":")
        try:
            if len(parts) == 2:
                return int(parts[0]) * 60 + int(parts[1])
            elif len(parts) == 3:
                return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        except: pass
    try: return float(val)
    except: return 0.0

def import_json_files(output_dir: str = JSON_OUTPUT_DIR, cleanup: bool = True) -> Dict[str, object]:
    """
    Liest JSON-Dateien ein und schreibt sie in die DB.

    Args:
        output_dir: Optional alternatives Ausgabeverzeichnis für Tracklistify JSON Dateien.
        cleanup: Entfernt erfolgreich importierte JSON Dateien nach dem Import.

    Returns:
        dict: Struktur mit neuen IDs, Import-Statistiken und Fehlern.
    """
    conn = get_conn()
    cur = conn.cursor()

    new_set_ids: List[int] = []
    messages: List[str] = []
    errors: List[str] = []
    processed_paths: List[str] = []

    if not os.path.isdir(output_dir):
        messages.append(f"Kein Output-Ordner gefunden: {output_dir}")
        conn.close()
        return {"new_set_ids": new_set_ids, "imported": 0, "skipped": 0, "errors": errors, "messages": messages}

    for fname in sorted(os.listdir(output_dir)):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(output_dir, fname)

        # Dubletten-Check
        cur.execute("SELECT id FROM sets WHERE source_file = ?", (os.path.abspath(path),))
        if cur.fetchone():
            messages.append(f"Überspringe bereits importierte Datei: {fname}")
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

            new_set_ids.append(set_id)
            processed_paths.append(path)

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
            errors.append(f"{fname}: {e}")

    conn.commit()
    conn.close()

    if cleanup:
        for path in processed_paths:
            try:
                os.remove(path)
            except Exception as e:
                errors.append(f"Cleanup fehlgeschlagen für {os.path.basename(path)}: {e}")

    if not new_set_ids and not errors:
        messages.append("Keine neuen JSON Dateien zum Import gefunden.")

    return {
        "new_set_ids": new_set_ids,
        "imported": len(new_set_ids),
        "skipped": len(messages),
        "errors": errors,
        "messages": messages,
    }