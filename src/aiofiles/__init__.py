"""Minimal aiofiles stub for offline testing.

This implementation provides the subset of functionality used by the cache
storage helpers without introducing an external dependency. It wraps built-in
file objects with async-friendly methods so the rest of the codebase can
``await`` file operations in tests.
"""

import builtins
from typing import Any, Optional


class AsyncFile:
    """Async-compatible wrapper around a standard file object."""

    def __init__(self, file: str, mode: str = "r", *args: Any, **kwargs: Any) -> None:
        self._file = builtins.open(file, mode, *args, **kwargs)

    async def read(self, *args: Any, **kwargs: Any) -> Any:  # pragma: no cover - passthrough
        return self._file.read(*args, **kwargs)

    async def write(self, data: Any) -> Any:  # pragma: no cover - passthrough
        return self._file.write(data)

    async def flush(self) -> Any:  # pragma: no cover - passthrough
        return self._file.flush()

    def fileno(self) -> int:  # pragma: no cover - passthrough
        return self._file.fileno()

    async def __aenter__(self) -> "AsyncFile":
        return self

    async def __aexit__(
        self,
        exc_type: Optional[type[BaseException]],
        exc: Optional[BaseException],
        tb: Optional[Any],
    ) -> None:
        self._file.close()


def open(file: str, mode: str = "r", *args: Any, **kwargs: Any) -> AsyncFile:
    """Return an async-compatible file wrapper mimicking :mod:`aiofiles.open`."""

    return AsyncFile(file, mode, *args, **kwargs)

