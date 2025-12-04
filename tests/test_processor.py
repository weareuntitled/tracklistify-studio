import sys
import types
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

sys.modules.setdefault("yt_dlp", types.SimpleNamespace())

from job_manager import Job
from services import processor


def test_process_job_logs_analyzer_failure(monkeypatch, tmp_path):
    audio_file = tmp_path / "input.mp3"
    audio_file.write_text("dummy audio content")

    job = Job("file", str(audio_file))
    job.status = "processing"

    analyzer_lines = [
        "Identifying track 1",
        "Analyzer error details",
    ]

    class FakeProcess:
        def __init__(self, *args, **kwargs):
            self.stdout = iter(line + "\n" for line in analyzer_lines)
            self.returncode = 1

        def wait(self):
            return

    monkeypatch.setattr(processor.subprocess, "Popen", lambda *a, **kw: FakeProcess())

    imported = False

    def fake_import():
        nonlocal imported
        imported = True
        return []

    monkeypatch.setattr(processor.importer, "import_json_files", fake_import)

    with pytest.raises(RuntimeError):
        processor.process_job(job)

    assert job.status == "failed"
    assert job.phase == "error"
    assert job.error == "Analyzer exited with code 1"
    assert imported is False
    assert any("Analyzer error details" in entry for entry in job.log)
    assert any("Analyzer output" in entry for entry in job.log)
