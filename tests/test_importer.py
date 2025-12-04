import json
import os
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.append(str(ROOT_DIR))

from services import importer


def _setup_temp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "db.sqlite"

    def _get_conn():
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        return conn

    monkeypatch.setattr(importer, "get_conn", _get_conn)

    conn = _get_conn()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE sets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            source_file TEXT,
            created_at TEXT,
            audio_file TEXT
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

    return db_path


def _write_json_file(directory, filename, data):
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / filename
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_import_json_files_missing_directory(tmp_path, monkeypatch):
    monkeypatch.setattr(importer, "JSON_OUTPUT_DIR", tmp_path / "missing")

    result = importer.import_json_files()

    assert result["status"] == "missing_directory"
    assert result["new_set_ids"] == []
    assert "Output directory not found" in result["message"]


def test_import_json_files_no_new_files(tmp_path, monkeypatch):
    _setup_temp_db(tmp_path, monkeypatch)
    output_dir = tmp_path / "output"
    monkeypatch.setattr(importer, "JSON_OUTPUT_DIR", output_dir)

    data = {
        "mix_info": {"title": "Test Mix", "artist": "DJ"},
        "tracks": [{"artist": "Artist", "title": "Song", "start": 0, "end": 10}],
    }
    json_path = _write_json_file(output_dir, "duplicate.json", data)

    conn = importer.get_conn()
    conn.execute(
        "INSERT INTO sets (name, source_file, created_at, audio_file) VALUES (?, ?, ?, ?)",
        ("Existing", os.path.abspath(json_path), "2024-01-01", None),
    )
    conn.commit()
    conn.close()

    result = importer.import_json_files()

    assert result["status"] == "no_new_files"
    assert result["new_set_ids"] == []
    assert result["skipped_files"] and result["skipped_files"][0]["reason"] == "duplicate"
    assert "No new files" in result["message"]


def test_import_json_files_success_with_cleanup(tmp_path, monkeypatch):
    _setup_temp_db(tmp_path, monkeypatch)
    output_dir = tmp_path / "output"
    archive_dir = tmp_path / "archive"
    monkeypatch.setattr(importer, "JSON_OUTPUT_DIR", output_dir)
    monkeypatch.setattr(importer, "IMPORT_JSON_CLEANUP_MODE", "move")
    monkeypatch.setattr(importer, "IMPORT_JSON_ARCHIVE_DIR", archive_dir)

    data = {
        "mix_info": {"title": "Fresh Mix", "artist": "New DJ"},
        "tracks": [{"artist": "Track Artist", "title": "Track Title", "start": 5, "end": 15}],
    }
    json_path = _write_json_file(output_dir, "fresh.json", data)

    result = importer.import_json_files()

    assert result["status"] == "imported"
    assert len(result["new_set_ids"]) == 1
    assert result["cleanup_actions"]

    conn = importer.get_conn()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM sets")
    assert cur.fetchone()[0] == 1
    cur.execute("SELECT COUNT(*) FROM tracks")
    assert cur.fetchone()[0] == 1
    conn.close()

    assert not json_path.exists()
    assert any(action.get("action") == "moved" for action in result["cleanup_actions"])
    assert archive_dir.exists()
