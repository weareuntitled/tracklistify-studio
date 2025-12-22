import sqlite3
import urllib.parse
import time
import datetime
from config import DB_PATH

try:
    import feedparser
except ModuleNotFoundError:
    feedparser = None

def get_conn():
    conn = sqlite3.connect(DB_PATH, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    conn = get_conn()
    
    # --- 1. PERFORMANCE TUNING ---
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    
    cur = conn.cursor()

    # --- 2. CORE TABLES ---
    cur.execute("""
        CREATE TABLE IF NOT EXISTS djs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            image_url TEXT,
            soundcloud_url TEXT,
            soundcloud_id TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS producers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            image_url TEXT,
            beatport_url TEXT,
            beatport_id TEXT
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS labels (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE,
            image_url TEXT,
            beatport_url TEXT
        )
    """)

    cur.execute("""
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
            image_url TEXT,
            FOREIGN KEY (dj_id) REFERENCES djs(id),
            FOREIGN KEY (label_id) REFERENCES labels(id)
        )
    """)

    cur.execute("""
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
            purchased_at TEXT,
            producer_id INTEGER,
            label_id INTEGER,
            beatport_url TEXT,
            FOREIGN KEY (set_id) REFERENCES sets(id) ON DELETE CASCADE,
            FOREIGN KEY (producer_id) REFERENCES producers(id),
            FOREIGN KEY (label_id) REFERENCES labels(id)
        )
    """)

    # --- 3. RELATIONS & EXTRAS ---
    cur.execute("""
        CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS folder_sets (
            folder_id INTEGER NOT NULL,
            set_id INTEGER NOT NULL UNIQUE,
            created_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (folder_id, set_id),
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
            FOREIGN KEY (set_id) REFERENCES sets(id) ON DELETE CASCADE
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS set_djs (
            set_id INTEGER NOT NULL,
            dj_id INTEGER NOT NULL,
            PRIMARY KEY (set_id, dj_id),
            FOREIGN KEY (set_id) REFERENCES sets(id) ON DELETE CASCADE,
            FOREIGN KEY (dj_id) REFERENCES djs(id) ON DELETE CASCADE
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS track_purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_id INTEGER UNIQUE,
            purchased_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS producer_likes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            producer_id INTEGER UNIQUE,
            liked_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (producer_id) REFERENCES producers(id) ON DELETE CASCADE
        )
    """)

    # --- 4. AUTH & PROFILES ---
    cur.execute("""
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
    """)

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

    # --- 5. NEW: STREAM CACHE ---
    cur.execute("""
        CREATE TABLE IF NOT EXISTS stream_cache (
            track_id INTEGER PRIMARY KEY,
            stream_url TEXT,
            expires_at REAL
        )
    """)

    # --- 6. MIGRATION LOGIC (Safe Updates) ---
    cur.execute("PRAGMA table_info(users)")
    existing_user_cols = [col[1] for col in cur.fetchall()]
    new_user_cols = {
        "display_name": "TEXT", "dj_name": "TEXT",
        "soundcloud_url": "TEXT", "avatar_path": "TEXT"
    }
    for col, dtype in new_user_cols.items():
        if col not in existing_user_cols:
            try: cur.execute(f"ALTER TABLE users ADD COLUMN {col} {dtype}")
            except: pass

    cur.execute("PRAGMA table_info(sets)")
    existing_set_cols = [col[1] for col in cur.fetchall()]
    new_set_cols = {
        "image_url": "TEXT", "is_b2b": "INTEGER DEFAULT 0",
        "tags": "TEXT", "dj_id": "INTEGER", "soundcloud_url": "TEXT", "label_id": "INTEGER",
        "artists": "TEXT", "event": "TEXT"  # <--- ADDED THESE CRITICAL COLUMNS
    }
    for col, dtype in new_set_cols.items():
        if col not in existing_set_cols:
            try: cur.execute(f"ALTER TABLE sets ADD COLUMN {col} {dtype}")
            except: pass

    cur.execute("PRAGMA table_info(tracks)")
    existing_track_cols = [col[1] for col in cur.fetchall()]
    new_track_cols = {
        "purchased_at": "TEXT", "beatport_url": "TEXT", 
        "producer_id": "INTEGER", "label_id": "INTEGER"
    }
    for col, dtype in new_track_cols.items():
        if col not in existing_track_cols:
            try: cur.execute(f"ALTER TABLE tracks ADD COLUMN {col} {dtype}")
            except: pass

    conn.commit()
    conn.close()

# --- CACHE METHODS ---
def get_cached_stream(track_id):
    conn = get_conn()
    row = conn.execute("SELECT stream_url FROM stream_cache WHERE track_id = ? AND expires_at > ?", (track_id, time.time())).fetchone()
    conn.close()
    return row['stream_url'] if row else None

def save_cached_stream(track_id, url):
    conn = get_conn()
    conn.execute("INSERT OR REPLACE INTO stream_cache (track_id, stream_url, expires_at) VALUES (?, ?, ?)", (track_id, url, time.time() + 21600))
    conn.commit()
    conn.close()

# --- SETS & TRACKS ---
def get_all_sets():
    conn = get_conn()
    sets = conn.execute("""
        SELECT s.*, COUNT(t.id) as track_count 
        FROM sets s LEFT JOIN tracks t ON t.set_id = s.id 
        GROUP BY s.id ORDER BY s.created_at DESC
    """).fetchall()
    conn.close()
    return [dict(s) for s in sets]

def get_tracks_by_set_with_relations(set_id):
    conn = get_conn()
    tracks = conn.execute("""
        SELECT t.*, d.name AS dj_name, p.name AS producer_name, l.name AS label_name
        FROM tracks t
        LEFT JOIN djs d ON t.producer_id = d.id
        LEFT JOIN producers p ON t.producer_id = p.id
        LEFT JOIN labels l ON t.label_id = l.id
        WHERE t.set_id = ? ORDER BY t.position
    """, (set_id,)).fetchall()
    conn.close()
    return [dict(t) for t in tracks]

def get_set(set_id):
    conn = get_conn()
    row = conn.execute("SELECT * FROM sets WHERE id = ?", (set_id,)).fetchone()
    conn.close()
    return dict(row) if row else None

def update_set_metadata(set_id, data):
    conn = get_conn()
    conn.execute("UPDATE sets SET name = ?, artists = ?, event = ?, is_b2b = ?, tags = ? WHERE id = ?", 
                 (data.get("name"), data.get("artists"), data.get("event"), 1 if data.get("is_b2b") else 0, data.get("tags"), set_id))
    conn.commit()
    conn.close()

def delete_set(set_id):
    conn = get_conn()
    conn.execute("DELETE FROM tracks WHERE set_id = ?", (set_id,))
    conn.execute("DELETE FROM sets WHERE id = ?", (set_id,))
    rows = conn.execute("SELECT changes()").fetchone()[0]
    conn.commit()
    conn.close()
    return rows > 0

def add_track_to_set(set_id, position, artist, title, start_time, confidence=1.0, cover=None):
    conn = get_conn()
    try:
        conn.execute("""
            INSERT INTO tracks (set_id, position, artist, title, start_time, confidence, liked, purchased, flag)
            VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0)
        """, (set_id, position, artist, title, start_time, confidence))
        conn.commit()
    except Exception as e:
        print(f"[DB Error] Could not insert track: {e}")
    finally:
        conn.close()

# --- LIKES, STATS, USERS (Keep existing logic) ---
# ... (The rest of your functions are standard select/updates, they are fine) ...
# Just ensure get_dashboard_stats, get_user, etc are present.
# I will include them for completeness:

def get_dashboard_stats():
    conn = get_conn()
    stats = {}
    stats['total_sets'] = conn.execute("SELECT COUNT(*) FROM sets").fetchone()[0]
    stats['total_tracks'] = conn.execute("SELECT COUNT(*) FROM tracks").fetchone()[0]
    likes = conn.execute("SELECT COUNT(*) FROM tracks WHERE liked = 1").fetchone()[0]
    stats['total_likes'] = likes
    stats['discovery_rate'] = round((likes / stats['total_tracks'] * 100), 1) if stats['total_tracks'] > 0 else 0
    stats['top_artists'] = [dict(r) for r in conn.execute("SELECT artist, COUNT(*) as count FROM tracks WHERE liked=1 AND artist IS NOT NULL GROUP BY artist ORDER BY count DESC LIMIT 8").fetchall()]
    stats['recent_sets'] = [dict(r) for r in conn.execute("SELECT * FROM sets ORDER BY created_at DESC LIMIT 5").fetchall()]
    stats['top_producers'] = [dict(r) for r in conn.execute("SELECT p.name, p.image_url, COUNT(t.id) as count FROM producers p JOIN tracks t ON t.producer_id = p.id GROUP BY p.id ORDER BY count DESC LIMIT 8").fetchall()]
    conn.close()
    return stats

def get_user(username):
    conn = get_conn()
    row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    conn.close()
    return dict(row) if row else None

def create_user(username, password_hash, display_name=None):
    conn = get_conn()
    cur = conn.cursor()
    cur.execute("INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)", (username, password_hash, display_name or username))
    uid = cur.lastrowid
    conn.commit()
    conn.close()
    return uid

def toggle_track_like(track_id, liked_status):
    conn = get_conn()
    conn.execute("UPDATE tracks SET liked = ? WHERE id = ?", (1 if liked_status else 0, track_id))
    conn.commit()
    conn.close()

def toggle_track_purchase(track_id, purchased_status):
    conn = get_conn()
    purchased_at = datetime.datetime.now().isoformat() if purchased_status else None
    if purchased_status:
        conn.execute("INSERT OR IGNORE INTO track_purchases (track_id, purchased_at) VALUES (?, ?)", (track_id, purchased_at))
    else:
        conn.execute("DELETE FROM track_purchases WHERE track_id = ?", (track_id,))
    conn.execute("UPDATE tracks SET purchased = ?, purchased_at = ? WHERE id = ?", (1 if purchased_status else 0, purchased_at, track_id))
    conn.commit()
    conn.close()

def get_liked_tracks():
    conn = get_conn()
    tracks = conn.execute("SELECT t.*, s.name as set_name FROM tracks t JOIN sets s ON t.set_id = s.id WHERE t.liked = 1 ORDER BY t.id DESC").fetchall()
    conn.close()
    return [dict(t) for t in tracks]

def get_purchased_tracks():
    conn = get_conn()
    tracks = conn.execute("SELECT t.*, s.name as set_name FROM tracks t JOIN sets s ON t.set_id = s.id WHERE t.purchased = 1 ORDER BY t.purchased_at DESC").fetchall()
    conn.close()
    return [dict(t) for t in tracks]

def toggle_producer_like(producer_id, state):
    conn = get_conn()
    if state:
        conn.execute("INSERT OR IGNORE INTO producer_likes (producer_id, liked_at) VALUES (?, datetime('now'))", (producer_id,))
    else:
        conn.execute("DELETE FROM producer_likes WHERE producer_id = ?", (producer_id,))
    conn.commit()
    conn.close()

def get_favorite_producers():
    conn = get_conn()
    prods = conn.execute("SELECT p.*, pl.liked_at FROM producers p JOIN producer_likes pl ON pl.producer_id = p.id ORDER BY pl.liked_at DESC").fetchall()
    conn.close()
    return [dict(p) for p in prods]