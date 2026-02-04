from typing import Any, Dict

from config import SETTINGS_JSON_PATH
from services.atomic_storage import AtomicJSONStorage

DEFAULT_SETTINGS: Dict[str, Any] = {"min_confidence": 50.0}


class SettingsStore:
    def __init__(self, storage_path: str = SETTINGS_JSON_PATH):
        self._storage = AtomicJSONStorage(storage_path)
        self._storage.ensure_file(DEFAULT_SETTINGS)

    def get_settings(self) -> Dict[str, Any]:
        data = self._storage.read(default=DEFAULT_SETTINGS)
        if not isinstance(data, dict):
            return DEFAULT_SETTINGS.copy()
        normalized = DEFAULT_SETTINGS.copy()
        normalized.update({key: value for key, value in data.items() if value is not None})
        return normalized

    def update_settings(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        current = self.get_settings()
        current.update({key: value for key, value in updates.items() if value is not None})
        self._storage.write(current)
        return current
