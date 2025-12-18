import sqlite3
import urllib.parse

from config import DB_PATH

try:
    import feedparser
except ModuleNotFoundError:  # pragma: no cover - handled gracefully in fetch_youtube_feed
    feedparser = None

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
            label_id INTEGER,
            FOREIGN KEY (dj_id) REFERENCES djs(id),
            FOREIGN KEY (label_id) REFERENCES labels(id)
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS folder_sets (
            folder_id INTEGER NOT NULL,
            set_id INTEGER NOT NULL UNIQUE,
            created_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (folder_id, set_id),
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
            FOREIGN KEY (set_id) REFERENCES sets(id) ON DELETE CASCADE
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

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS track_purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER UNIQUE,
            purchased_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        )
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS producer_likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            producer_id INTEGER UNIQUE,
            liked_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (producer_id) REFERENCES producers(id) ON DELETE CASCADE
        )
        """
    )

    cur.execute("""
        CREATE TABLE IF NOT EXISTS beatport_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist_name TEXT UNIQUE,
            beatport_id TEXT,
            profile_url TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS soundcloud_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            artist_name TEXT UNIQUE,
            soundcloud_id TEXT,
            profile_url TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash TEXT,
            display_name TEXT,
            dj_name TEXT,
            soundcloud_url TEXT,
            avatar_path TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
        """
    )

    cur.execute("PRAGMA table_info(users)")
    existing_user_cols = [col[1] for col in cur.fetchall()]
    new_user_cols = {
        "display_name": "TEXT",
        "dj_name": "TEXT",
        "soundcloud_url": "TEXT",
        "avatar_path": "TEXT"
    }
    for col, dtype in new_user_cols.items():
        if col not in existing_user_cols:
            print(f"Migriere DB: Füge {col} zu users hinzu...")
            cur.execute(f"ALTER TABLE users ADD COLUMN {col} {dtype}")

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
        "soundcloud_url": "TEXT",
        "label_id": "INTEGER"
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

def get_folders_with_sets():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, name, created_at FROM folders ORDER BY created_at DESC")
    folders = [dict(r) for r in cur.fetchall()]
    cur.execute("SELECT folder_id, set_id FROM folder_sets")
    mapping = cur.fetchall()
    conn.close()

    sets_by_folder = {}
    for row in mapping:
        fid = row["folder_id"]
        sets_by_folder.setdefault(fid, []).append(row["set_id"])

    for folder in folders:
        folder["sets"] = sets_by_folder.get(folder["id"], [])
    return folders

def create_folder(name: str):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO folders (name) VALUES (?)",
        (name.strip(),),
    )
    conn.commit()
    folder_id = cur.lastrowid
    cur.execute("SELECT id, name, created_at FROM folders WHERE id = ?", (folder_id,))
    row = cur.fetchone()
    conn.close()
    folder_data = dict(row) if row else {"id": folder_id, "name": name, "created_at": None}
    folder_data["sets"] = []
    return folder_data

def assign_set_to_folder(folder_id: int, set_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM folder_sets WHERE set_id = ?", (set_id,))
    cur.execute(
        """
        INSERT OR IGNORE INTO folder_sets (folder_id, set_id)
        VALUES (?, ?)
        """,
        (folder_id, set_id),
    )
    conn.commit()
    conn.close()

def remove_set_from_folder(folder_id: int, set_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM folder_sets WHERE folder_id = ? AND set_id = ?",
        (folder_id, set_id),
    )
    conn.commit()
    conn.close()

# --- Bestehende Queries (Kurzform der Vollständigkeit halber) ---
def get_all_sets():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT s.*, COUNT(t.id) as track_count,
               GROUP_CONCAT(DISTINCT d.name) as dj_names,
               l.name AS label_name,
               MAX(fs.folder_id) as folder_id
        FROM sets s
        LEFT JOIN tracks t ON t.set_id = s.id
        LEFT JOIN set_djs sd ON sd.set_id = s.id
        LEFT JOIN djs d ON sd.dj_id = d.id
        LEFT JOIN labels l ON s.label_id = l.id
        LEFT JOIN folder_sets fs ON fs.set_id = s.id
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

def get_tracks_by_set_with_relations(set_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT t.*, d.name AS dj_name, p.name AS producer_name, l.name AS label_name
        FROM tracks t
        LEFT JOIN djs d ON t.dj_id = d.id
        LEFT JOIN producers p ON t.producer_id = p.id
        LEFT JOIN labels l ON t.label_id = l.id
        WHERE t.set_id = ?
        ORDER BY t.position
        """,
        (set_id,),
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def get_liked_tracks():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT t.*, s.name as set_name, p.name AS producer_name, l.name AS label_name
        FROM tracks t
        JOIN sets s ON t.set_id = s.id
        LEFT JOIN producers p ON t.producer_id = p.id
        LEFT JOIN labels l ON t.label_id = l.id
        WHERE t.liked = 1
        ORDER BY t.id DESC
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def get_purchased_tracks():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT t.*, s.name AS set_name, p.name AS producer_name, l.name AS label_name, tp.purchased_at
        FROM track_purchases tp
        JOIN tracks t ON tp.track_id = t.id
        JOIN sets s ON t.set_id = s.id
        LEFT JOIN producers p ON t.producer_id = p.id
        LEFT JOIN labels l ON t.label_id = l.id
        ORDER BY tp.purchased_at DESC
        """
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def toggle_track_like(track_id, liked_status):
    conn = get_conn()
    conn.execute("UPDATE tracks SET liked = ? WHERE id = ?", (liked_status, track_id))
    conn.commit()
    conn.close()

def toggle_track_purchase(track_id, purchased_status):
    conn = get_conn()
    cur = conn.cursor()
    if purchased_status:
        cur.execute(
            "INSERT OR IGNORE INTO track_purchases (track_id, purchased_at) VALUES (?, datetime('now'))",
            (track_id,),
        )
    else:
        cur.execute("DELETE FROM track_purchases WHERE track_id = ?", (track_id,))

    cur.execute("UPDATE tracks SET purchased = ? WHERE id = ?", (1 if purchased_status else 0, track_id))
    conn.commit()
    conn.close()

def get_favorite_producers():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        SELECT p.*, pl.liked_at
        FROM producer_likes pl
        JOIN producers p ON pl.producer_id = p.id
        ORDER BY pl.liked_at DESC
        """
    )
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def toggle_producer_like(producer_id, liked_status):
    conn = get_conn()
    cur = conn.cursor()
    if liked_status:
        cur.execute(
            "INSERT OR IGNORE INTO producer_likes (producer_id, liked_at) VALUES (?, datetime('now'))",
            (producer_id,),
        )
    else:
        cur.execute("DELETE FROM producer_likes WHERE producer_id = ?", (producer_id,))
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


def save_beatport_profiles(profiles):
    conn = get_conn()
    cur = conn.cursor()
    saved = []
    for profile in profiles:
        artist_name = profile.get("artist") or profile.get("artist_name")
        beatport_id = profile.get("beatport_id") or profile.get("id")
        profile_url = profile.get("url") or profile.get("profile_url")
        if not artist_name:
            continue
        cur.execute(
            """
            INSERT INTO beatport_profiles (artist_name, beatport_id, profile_url)
            VALUES (?, ?, ?)
            ON CONFLICT(artist_name) DO UPDATE SET
                beatport_id=excluded.beatport_id,
                profile_url=excluded.profile_url
            """,
            (artist_name, beatport_id, profile_url),
        )
        saved.append(
            {
                "artist_name": artist_name,
                "beatport_id": beatport_id,
                "profile_url": profile_url,
            }
        )
    conn.commit()
    conn.close()
    return saved


def save_soundcloud_profiles(profiles):
    conn = get_conn()
    cur = conn.cursor()
    saved = []
    for profile in profiles:
        artist_name = profile.get("artist") or profile.get("artist_name")
        sc_id = profile.get("soundcloud_id") or profile.get("id")
        profile_url = profile.get("url") or profile.get("profile_url")
        if not artist_name:
            continue
        cur.execute(
            """
            INSERT INTO soundcloud_profiles (artist_name, soundcloud_id, profile_url)
            VALUES (?, ?, ?)
            ON CONFLICT(artist_name) DO UPDATE SET
                soundcloud_id=excluded.soundcloud_id,
                profile_url=excluded.profile_url
            """,
            (artist_name, sc_id, profile_url),
        )
        saved.append(
            {
                "artist_name": artist_name,
                "soundcloud_id": sc_id,
                "profile_url": profile_url,
            }
        )
    conn.commit()
    conn.close()
    return saved

def delete_set(set_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM tracks WHERE set_id = ?", (set_id,))
    cur.execute("DELETE FROM sets WHERE id = ?", (set_id,))
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    return deleted


def delete_track(track_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM tracks WHERE id = ?", (track_id,))
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    return deleted

def get_dashboard_stats():
    conn = get_conn()
    cur = conn.cursor()

    def table_exists(name):
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (name,))
        return cur.fetchone() is not None

    def get_top_entities(table_name, limit=8):
        if not table_exists(table_name):
            return []

        cur.execute(f"PRAGMA table_info({table_name})")
        cols = {row[1] for row in cur.fetchall()}

        name_col_candidates = ("name", "display_name", "artist_name", "full_name")
        avatar_col_candidates = ("avatar_url", "image_url", "avatar", "profile_image")
        usage_col_candidates = ("usage_count", "usage_frequency", "uses", "count", "frequency")

        name_col = next((c for c in name_col_candidates if c in cols), None)
        avatar_col = next((c for c in avatar_col_candidates if c in cols), None)
        usage_col = next((c for c in usage_col_candidates if c in cols), None)

        if not name_col:
            return []

        select_parts = [f"{name_col} as name"]
        if avatar_col:
            select_parts.append(f"{avatar_col} as avatar_url")
        if usage_col:
            select_parts.append(f"{usage_col} as usage_count")

        order_clause = f" ORDER BY {usage_col} DESC" if usage_col else ""
        cur.execute(
            f"SELECT {', '.join(select_parts)} FROM {table_name}{order_clause} LIMIT ?",
            (limit,),
        )
        return [dict(r) for r in cur.fetchall()]

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
    cur.execute(
        """
        SELECT p.name, COUNT(*) as count
        FROM tracks t
        JOIN producers p ON t.producer_id = p.id
        WHERE t.liked = 1 AND p.name IS NOT NULL
        GROUP BY p.id
        ORDER BY count DESC
        LIMIT 8
        """
    )
    top_producers = [dict(r) for r in cur.fetchall()]
    cur.execute(
        """
        SELECT l.name, COUNT(*) as count
        FROM tracks t
        JOIN labels l ON t.label_id = l.id
        WHERE t.liked = 1 AND l.name IS NOT NULL
        GROUP BY l.id
        ORDER BY count DESC
        LIMIT 8
        """
    )
    top_labels = [dict(r) for r in cur.fetchall()]
    cur.execute("SELECT id, name, created_at FROM sets ORDER BY created_at DESC LIMIT 5")
    recent_sets = [dict(r) for r in cur.fetchall()]

    top_producers = get_top_entities("enriched_producers")
    top_djs = get_top_entities("enriched_djs")
    conn.close()
    return {"total_sets": total_sets, "total_tracks": total_tracks, "total_likes": total_likes,
            "discovery_rate": round((total_likes/total_tracks*100),1) if total_tracks else 0,
            "top_liked_artists": top_artists, "top_artists": top_artists,
            "top_sets": top_sets, "recent_sets": recent_sets,
            "top_producers": top_producers, "top_djs": top_djs}


def get_user(username):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, username, password_hash, display_name, dj_name, soundcloud_url, avatar_path, created_at FROM users WHERE username = ?", (username,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def get_user_by_id(user_id: int):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, username, password_hash, display_name, dj_name, soundcloud_url, avatar_path, created_at FROM users WHERE id = ?", (user_id,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def create_user(username, password_hash, display_name=None):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)",
        (username, password_hash, display_name or username),
    )
    conn.commit()
    user_id = cur.lastrowid
    conn.close()
    return user_id


def update_user_profile(user_id, display_name, dj_name, soundcloud_url, avatar_path=None):
    conn = get_conn()
    cur = conn.cursor()
    fields = {
        "display_name": display_name,
        "dj_name": dj_name,
        "soundcloud_url": soundcloud_url,
    }
    if avatar_path is not None:
        fields["avatar_path"] = avatar_path

    set_clause = ", ".join([f"{col} = ?" for col in fields.keys()])
    params = list(fields.values()) + [user_id]

    cur.execute(f"UPDATE users SET {set_clause} WHERE id = ?", params)
    conn.commit()
    conn.close()


def get_user_profile(user_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, username, display_name, dj_name, soundcloud_url, avatar_path, created_at FROM users WHERE id = ?",
        (user_id,),
    )
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def list_users():
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("SELECT id, username, display_name, dj_name, soundcloud_url, created_at FROM users ORDER BY created_at DESC")
    rows = [dict(row) for row in cur.fetchall()]
    conn.close()
    return rows


def delete_user(user_id):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    deleted = cur.rowcount
    conn.close()
    return deleted


def get_engaged_artists(query=None, limit=10):
    """Return distinct artist names from liked or purchased tracks and their producers."""

    conn = get_conn()
    cur = conn.cursor()

    filters = []
    params = []
    if query:
        filters.append("LOWER(name) LIKE ?")
        params.append(f"%{query.lower()}%")

    where_clause = " WHERE " + " AND ".join(filters) if filters else ""

    cur.execute(
        f"""
        SELECT name FROM (
            SELECT DISTINCT t.artist as name
            FROM tracks t
            WHERE (t.liked = 1 OR t.purchased = 1) AND t.artist IS NOT NULL
            UNION
            SELECT DISTINCT p.name as name
            FROM tracks t
            JOIN producers p ON t.producer_id = p.id
            WHERE (t.liked = 1 OR t.purchased = 1) AND p.name IS NOT NULL
        ) base
        {where_clause}
        ORDER BY name COLLATE NOCASE
        LIMIT ?
        """,
        (*params, limit),
    )
    artists = [row[0] for row in cur.fetchall() if row[0]]
    conn.close()
    return artists


def fetch_youtube_feed(artists, max_items=6):
    items = []
    seen = set()
    if not artists:
        return items

    if feedparser is None:
        return items

    for artist in artists:
        if not artist:
            continue
        encoded = urllib.parse.quote_plus(artist)
        feed_url = f"https://www.youtube.com/feeds/videos.xml?search_query={encoded}"
        try:
            parsed = feedparser.parse(feed_url)
        except Exception:
            continue

        for entry in parsed.entries[:2]:
            link = getattr(entry, "link", None)
            if not link or link in seen:
                continue
            seen.add(link)
            items.append(
                {
                    "title": getattr(entry, "title", ""),
                    "link": link,
                    "published": getattr(entry, "published", ""),
                    "artist": artist,
                }
            )
            if len(items) >= max_items:
                return items
    return items
