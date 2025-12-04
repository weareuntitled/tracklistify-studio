import json
import os
import sqlite3
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

from services import importer


def _setup_temp_db(db_path: str) -> None:
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            source_file TEXT,
            created_at TEXT,
            audio_file TEXT,
            artists TEXT,
            event TEXT,
            is_b2b INTEGER DEFAULT 0,
            tags TEXT
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id INTEGER NOT NULL,
            position INTEGER,
            artist TEXT,
            title TEXT,
            confidence REAL,
            start_time REAL,
            end_time REAL,
            flag INTEGER DEFAULT 0
        )
        """
    )
    conn.commit()
    conn.close()


def _patch_get_conn(monkeypatch, db_path):
    monkeypatch.setattr(importer, "get_conn", lambda: sqlite3.connect(db_path))


def test_missing_output_dir_returns_message(monkeypatch, tmp_path):
    db_path = tmp_path / "db.sqlite"
    _setup_temp_db(db_path)
    _patch_get_conn(monkeypatch, db_path)

    result = importer.import_json_files(output_dir=tmp_path / "missing", cleanup=True)

    assert result["imported"] == 0
    assert any("Kein Output-Ordner" in msg for msg in result["messages"])


def test_imports_file_and_cleans_up(monkeypatch, tmp_path):
    db_path = tmp_path / "db.sqlite"
    _setup_temp_db(db_path)
    _patch_get_conn(monkeypatch, db_path)

    output_dir = tmp_path / "output"
    output_dir.mkdir()
    payload = {
        "mix_info": {"title": "Test Mix", "artist": "Test Artist"},
        "tracks": [
            {"artist": "A1", "title": "Song", "start": 0, "end": 10, "confidence": 0.9}
        ],
    }
    json_path = output_dir / "mix.json"
    json_path.write_text(json.dumps(payload), encoding="utf-8")

    result = importer.import_json_files(output_dir=str(output_dir), cleanup=True)

    assert result["imported"] == 1
    assert result["errors"] == []
    assert not json_path.exists()

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM sets")
    assert cur.fetchone()[0] == 1
    cur.execute("SELECT COUNT(*) FROM tracks")
    assert cur.fetchone()[0] == 1
    conn.close()


def test_empty_directory_reports_no_new_files(monkeypatch, tmp_path):
    db_path = tmp_path / "db.sqlite"
    _setup_temp_db(db_path)
    _patch_get_conn(monkeypatch, db_path)

    output_dir = tmp_path / "output"
    output_dir.mkdir()

    result = importer.import_json_files(output_dir=output_dir, cleanup=True)

    assert result["imported"] == 0
    assert any("Keine neuen JSON Dateien" in msg for msg in result["messages"])
