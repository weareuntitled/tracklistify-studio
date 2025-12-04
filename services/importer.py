import os
import json
import datetime
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

def import_json_files():
    """
    Liest JSON-Dateien ein und schreibt sie in die DB.
    RÜCKGABE: Eine Liste der neu erstellten Set-IDs (List[int]).
    """
    conn = get_conn()
    cur = conn.cursor()
    
    new_set_ids = []
    
    if not os.path.isdir(JSON_OUTPUT_DIR): return []

    for fname in sorted(os.listdir(JSON_OUTPUT_DIR)):
        if not fname.endswith(".json"): continue
        path = os.path.join(JSON_OUTPUT_DIR, fname)
        
        # Dubletten-Check
        cur.execute("SELECT id FROM sets WHERE source_file = ?", (os.path.abspath(path),))
        if cur.fetchone(): continue
        
        try:
            with open(path, "r", encoding="utf-8") as f: data = json.load(f)
            
            mix = data.get("mix_info", {}) or {}
            meta = data.get("meta", {}) or data.get("set", {}) or {}
            ana = data.get("analysis_info", {}) or {}
            
            raw_title = mix.get("title") or meta.get("title") or os.path.splitext(fname)[0]
            artist = mix.get("artist") or meta.get("artist")
            
            if not artist:
                parts = raw_title.split(" - ", 1)
                artist = parts[0] if len(parts) == 2 else "Unknown Artist"
                if len(parts) == 2: raw_title = parts[1]

            set_name = f"{artist} - {raw_title}"
            audio_file = ana.get("audio_file") or _guess_audio_file_from_title(raw_title)

            cur.execute("INSERT INTO sets (name, source_file, created_at, audio_file) VALUES (?, ?, ?, ?)",
                       (set_name, os.path.abspath(path), datetime.datetime.now().isoformat(), audio_file))
            set_id = cur.lastrowid
            
            new_set_ids.append(set_id)
            
            tracks = data.get("tracks") or data.get("tracklist") or []
            for i, t in enumerate(tracks, 1):
                s = _parse_time_to_seconds(t.get("start") or t.get("start_seconds"))
                e = _parse_time_to_seconds(t.get("end") or t.get("end_seconds"))
                
                cur.execute("""
                    INSERT INTO tracks (set_id, position, artist, title, confidence, start_time, end_time, flag)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
                """, (set_id, i, t.get("artist"), t.get("title"), t.get("confidence"), s, e))
                
        except Exception as e:
            print(f"[Importer] Fehler bei {fname}: {e}")
            
    conn.commit()
    conn.close()
    
    return new_set_ids