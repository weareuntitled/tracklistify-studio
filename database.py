import sqlite3
from config import DB_PATH

def get_conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_conn()
    cur = conn.cursor()

    # --- Tabellen ---
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS djs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            image_url TEXT,
            soundcloud_url TEXT,
            soundcloud_id TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS producers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            image_url TEXT,
            beatport_url TEXT,
            beatport_id TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS labels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            image_url TEXT,
            beatport_url TEXT
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            source_file TEXT,
            created_at TEXT,
            audio_file TEXT,
            artists TEXT,
            event TEXT,
            is_b2b INTEGER DEFAULT 0,
            tags TEXT,
            dj_id INTEGER,
            soundcloud_url TEXT,
            FOREIGN KEY (dj_id) REFERENCES djs(id)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS set_djs (
            set_id INTEGER NOT NULL,
            dj_id INTEGER NOT NULL,
            PRIMARY KEY (set_id, dj_id),
            FOREIGN KEY (set_id) REFERENCES sets(id) ON DELETE CASCADE,
            FOREIGN KEY (dj_id) REFERENCES djs(id) ON DELETE CASCADE
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id INTEGER NOT NULL,
            position INTEGER,
            artist TEXT,
            title TEXT,
            confidence REAL,
            start_time REAL,
            end_time REAL,
            flag INTEGER DEFAULT 0,
            orig_artist TEXT,
            orig_title TEXT,
            needs_rescan INTEGER DEFAULT 0,
            last_rescan_at TEXT,
            liked INTEGER DEFAULT 0,
            purchased INTEGER DEFAULT 0,
            producer_id INTEGER,
            label_id INTEGER,
            beatport_url TEXT,
            FOREIGN KEY (set_id) REFERENCES sets(id) ON DELETE CASCADE,
            FOREIGN KEY (producer_id) REFERENCES producers(id),
            FOREIGN KEY (label_id) REFERENCES labels(id)
        )
        """
    )

    # --- MIGRATION: Neue Spalten hinzufügen ---
    cur.execute("PRAGMA table_info(sets)")
    existing_set_cols = [col[1] for col in cur.fetchall()]
    
    new_set_cols = {
        "name": "TEXT",
        "source_file": "TEXT",
        "created_at": "TEXT",
        "audio_file": "TEXT",
        "artists": "TEXT",
        "event": "TEXT",
        "is_b2b": "INTEGER DEFAULT 0",
        "tags": "TEXT",
        "dj_id": "INTEGER",
        "soundcloud_url": "TEXT"
    }

    for col, dtype in new_set_cols.items():
        if col not in existing_set_cols:
            print(f"Migriere DB: Füge {col} zu sets hinzu...")
            cur.execute(f"ALTER TABLE sets ADD COLUMN {col} {dtype}")

    # Tracks Migration (wie gehabt)
    cur.execute("PRAGMA table_info(tracks)")
    existing_track_cols = [col[1] for col in cur.fetchall()]
    
    track_cols = {
        "position": "INTEGER", "confidence": "REAL", "start_time": "REAL", "end_time": "REAL",
        "flag": "INTEGER DEFAULT 0", "orig_artist": "TEXT", "orig_title": "TEXT",
        "needs_rescan": "INTEGER DEFAULT 0", "last_rescan_at": "TEXT",
        "liked": "INTEGER DEFAULT 0", "purchased": "INTEGER DEFAULT 0",
        "producer_id": "INTEGER", "label_id": "INTEGER", "beatport_url": "TEXT"
    }
    for col, dtype in track_cols.items():
        if col not in existing_track_cols:
            cur.execute(f"ALTER TABLE tracks ADD COLUMN {col} {dtype}")

    conn.commit()
    conn.close()

# --- Queries (Update für Metadaten) ---

def get_set(set_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM sets WHERE id = ?", (set_id,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None

def upsert_dj(name, image_url=None, soundcloud_url=None, soundcloud_id=None):
    if not name:
        return None
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, image_url, soundcloud_url, soundcloud_id FROM djs WHERE name = ?", (name,))
    row = cur.fetchone()
    if row:
        dj_id = row[0]
        # update missing info
        image_url = image_url or row[1]
        soundcloud_url = soundcloud_url or row[2]
        soundcloud_id = soundcloud_id or row[3]
        cur.execute(
            "UPDATE djs SET image_url = ?, soundcloud_url = ?, soundcloud_id = ? WHERE id = ?",
            (image_url, soundcloud_url, soundcloud_id, dj_id),
        )
    else:
        cur.execute(
            "INSERT INTO djs (name, image_url, soundcloud_url, soundcloud_id) VALUES (?, ?, ?, ?)",
            (name, image_url, soundcloud_url, soundcloud_id),
        )
        dj_id = cur.lastrowid
    conn.commit()
    conn.close()
    return dj_id

def link_set_dj(set_id, dj_id):
    if not (set_id and dj_id):
        return
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT OR IGNORE INTO set_djs (set_id, dj_id) VALUES (?, ?)",
        (set_id, dj_id),
    )
    cur.execute("UPDATE sets SET dj_id = ? WHERE id = ?", (dj_id, set_id))
    conn.commit()
    conn.close()

def upsert_producer(name, image_url=None, beatport_url=None, beatport_id=None):
    if not name:
        return None
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, image_url, beatport_url, beatport_id FROM producers WHERE name = ?", (name,))
    row = cur.fetchone()
    if row:
        producer_id = row[0]
        image_url = image_url or row[1]
        beatport_url = beatport_url or row[2]
        beatport_id = beatport_id or row[3]
        cur.execute(
            "UPDATE producers SET image_url = ?, beatport_url = ?, beatport_id = ? WHERE id = ?",
            (image_url, beatport_url, beatport_id, producer_id),
        )
    else:
        cur.execute(
            "INSERT INTO producers (name, image_url, beatport_url, beatport_id) VALUES (?, ?, ?, ?)",
            (name, image_url, beatport_url, beatport_id),
        )
        producer_id = cur.lastrowid
    conn.commit()
    conn.close()
    return producer_id

def upsert_label(name, image_url=None, beatport_url=None):
    if not name:
        return None
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, image_url, beatport_url FROM labels WHERE name = ?", (name,))
    row = cur.fetchone()
    if row:
        label_id = row[0]
        image_url = image_url or row[1]
        beatport_url = beatport_url or row[2]
        cur.execute(
            "UPDATE labels SET image_url = ?, beatport_url = ? WHERE id = ?",
            (image_url, beatport_url, label_id),
        )
    else:
        cur.execute(
            "INSERT INTO labels (name, image_url, beatport_url) VALUES (?, ?, ?)",
            (name, image_url, beatport_url),
        )
        label_id = cur.lastrowid
    conn.commit()
    conn.close()
    return label_id

def assign_track_entities(track_id, producer_id=None, label_id=None, beatport_url=None):
    if not track_id:
        return
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "UPDATE tracks SET producer_id = COALESCE(?, producer_id), label_id = COALESCE(?, label_id), beatport_url = COALESCE(?, beatport_url) WHERE id = ?",
        (producer_id, label_id, beatport_url, track_id),
    )
    conn.commit()
    conn.close()

def update_set_soundcloud(set_id, soundcloud_url=None, dj_id=None):
    if not set_id:
        return
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "UPDATE sets SET soundcloud_url = COALESCE(?, soundcloud_url), dj_id = COALESCE(?, dj_id) WHERE id = ?",
        (soundcloud_url, dj_id, set_id),
    )
    conn.commit()
    conn.close()

def update_set_metadata(set_id, data):
    """Aktualisiert Artists, Event, B2B, Tags"""
    conn = get_conn()
    conn.execute("""
        UPDATE sets 
        SET name = ?, artists = ?, event = ?, is_b2b = ?, tags = ?
        WHERE id = ?
    """, (
        data.get("name"),
        data.get("artists"),
        data.get("event"),
        1 if data.get("is_b2b") else 0,
        data.get("tags"),
        set_id
    ))
    conn.commit()
    conn.close()

# --- Bestehende Queries (Kurzform der Vollständigkeit halber) ---
def get_all_sets():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT s.*, COUNT(t.id) as track_count
        FROM sets s LEFT JOIN tracks t ON t.set_id = s.id 
        GROUP BY s.id ORDER BY s.created_at DESC
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def get_tracks_by_set(set_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM tracks WHERE set_id = ? ORDER BY position", (set_id,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def get_liked_tracks():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT t.*, s.name as set_name FROM tracks t JOIN sets s ON t.set_id = s.id WHERE t.liked = 1 ORDER BY t.id DESC")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def toggle_track_like(track_id, liked_status):
    conn = get_conn()
    conn.execute("UPDATE tracks SET liked = ? WHERE id = ?", (liked_status, track_id))
    conn.commit()
    conn.close()

def update_track_flag(track_id, flag):
    needs = 1 if flag == 3 else 0
    conn = get_conn()
    conn.execute("UPDATE tracks SET flag = ?, needs_rescan = ? WHERE id = ?", (flag, needs, track_id))
    conn.commit()
    conn.close()

def get_rescan_candidates():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT t.*, s.name as set_name, s.audio_file FROM tracks t JOIN sets s ON t.set_id = s.id WHERE t.needs_rescan = 1")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def reset_rescan_flags():
    conn = get_conn()
    conn.execute("UPDATE tracks SET needs_rescan = 0 WHERE needs_rescan = 1")
    conn.commit()
    conn.close()

def rename_set(set_id, new_name):
    # Legacy Wrapper, jetzt via update_set_metadata besser
    conn = get_conn()
    conn.execute("UPDATE sets SET name = ? WHERE id = ?", (new_name, set_id))
    conn.commit()
    conn.close()

def delete_set(set_id):
    conn = get_conn()
    conn.execute("DELETE FROM tracks WHERE set_id = ?", (set_id,))
    conn.execute("DELETE FROM sets WHERE id = ?", (set_id,))
    conn.commit()
    conn.close()

def get_dashboard_stats():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM sets")
    total_sets = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM tracks")
    total_tracks = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM tracks WHERE liked = 1")
    total_likes = cur.fetchone()[0]
    cur.execute("SELECT artist, COUNT(*) as count FROM tracks WHERE liked=1 AND artist IS NOT NULL GROUP BY artist ORDER BY count DESC LIMIT 8")
    top_artists = [dict(r) for r in cur.fetchall()]
    cur.execute(
        """
        SELECT p.id, p.name, p.image_url, p.beatport_url, COUNT(t.id) as count
        FROM producers p
        JOIN tracks t ON t.producer_id = p.id
        GROUP BY p.id
        ORDER BY count DESC
        LIMIT 8
        """
    )
    top_producers = [dict(r) for r in cur.fetchall()]
    cur.execute(
        """
        SELECT d.id, d.name, d.image_url, d.soundcloud_url, COUNT(sd.set_id) as count
        FROM djs d
        JOIN set_djs sd ON sd.dj_id = d.id
        GROUP BY d.id
        ORDER BY count DESC
        LIMIT 8
        """
    )
    top_djs = [dict(r) for r in cur.fetchall()]
    cur.execute("""
        SELECT s.name, s.id, COUNT(t.id) as like_count, s.created_at
        FROM sets s JOIN tracks t ON t.set_id = s.id
        WHERE t.liked = 1 GROUP BY s.id ORDER BY like_count DESC LIMIT 5
    """)
    top_sets = [dict(r) for r in cur.fetchall()]
    cur.execute("SELECT id, name, created_at FROM sets ORDER BY created_at DESC LIMIT 5")
    recent_sets = [dict(r) for r in cur.fetchall()]
    conn.close()
    return {"total_sets": total_sets, "total_tracks": total_tracks, "total_likes": total_likes,
            "discovery_rate": round((total_likes/total_tracks*100),1) if total_tracks else 0,
            "top_liked_artists": top_artists, "top_artists": top_artists,
            "top_sets": top_sets, "recent_sets": recent_sets,
            "top_producers": top_producers, "top_djs": top_djs}