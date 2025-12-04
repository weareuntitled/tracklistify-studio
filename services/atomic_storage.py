import json
import os
import tempfile
from pathlib import Path
from threading import Lock
from typing import Any


class AtomicJSONStorage:
    """Atomic JSON reader/writer for small datasets."""

    def __init__(self, file_path: str | Path):
        self.path = Path(file_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()

    def read(self, default: Any) -> Any:
        with self._lock:
            if not self.path.exists():
                return default
            try:
                with self.path.open("r", encoding="utf-8") as handle:
                    return json.load(handle)
            except json.JSONDecodeError:
                return default

    def write(self, data: Any) -> None:
        serialized = json.dumps(data, ensure_ascii=False, indent=2)
        with self._lock:
            temp_file = None
            try:
                with tempfile.NamedTemporaryFile(
                    "w", delete=False, dir=self.path.parent, encoding="utf-8"
                ) as handle:
                    temp_file = Path(handle.name)
                    handle.write(serialized)
                    handle.flush()
                    os.fsync(handle.fileno())

                os.replace(temp_file, self.path)
            finally:
                if temp_file and temp_file.exists():
                    try:
                        temp_file.unlink()
                    except OSError:
                        pass

    def ensure_file(self, initial_data: Any) -> None:
        if not self.path.exists():
            self.write(initial_data)
