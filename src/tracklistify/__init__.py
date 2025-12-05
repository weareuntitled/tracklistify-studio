"""
Tracklistify - Automatic tracklist generator for DJ mixes and audio streams.

This module provides the main entry point for the Tracklistify package. It includes
metadata about the package such as version, title, author, and license. The version
information is retrieved from the _version.py file if available, otherwise it falls
back to the package metadata.
"""

from importlib import metadata as importlib_metadata
from importlib.metadata import PackageNotFoundError

# Local/package imports
from .utils.logger import get_logger

# Configure package-level logger
package_logger = get_logger(__name__)

__version__ = "0.0.0"
__title__ = "tracklistify"
__author__ = ""
__license__ = ""


def get_metadata():
    """Extract version and metadata from package distribution when available."""

    global __version__, __title__, __author__, __license__

    try:
        _meta = importlib_metadata.metadata("tracklistify")
    except PackageNotFoundError:
        return ["__version__", "__title__", "__author__", "__license__"]

    __version__ = _meta.get("Version", __version__)
    __title__ = _meta.get("Name", __title__)
    __author__ = _meta.get("Author", __author__)
    __license__ = _meta.get("License", __license__)

    return ["__version__", "__title__", "__author__", "__license__"]


__all__ = get_metadata()
