import logging
import urllib.parse

import yt_dlp

logger = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Safari/537.36"


def find_dj_on_soundcloud(dj_name: str):
    """Find a DJ profile on SoundCloud using yt-dlp flat search as primary strategy.

    Returns a dict with soundcloud_url, image_url, and soundcloud_id if a hit is found.
    """
    if not dj_name:
        return None

    query = f"scsearch1:{dj_name}"
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(query, download=False)
            entries = info.get("entries") or []
            if entries:
                first = entries[0]
                url = first.get("url") or first.get("webpage_url")
                image_url = None
                thumbs = first.get("thumbnails") or []
                if thumbs:
                    image_url = thumbs[-1].get("url") or thumbs[0].get("url")
                return {
                    "soundcloud_url": url,
                    "image_url": image_url,
                    "soundcloud_id": first.get("id"),
                }
    except Exception as exc:  # noqa: BLE001
        logger.debug("SoundCloud lookup failed via yt-dlp: %s", exc)

    # Fallback: store a search link to at least surface the profile search
    search_url = f"https://soundcloud.com/search/people?q={urllib.parse.quote_plus(dj_name)}"
    return {"soundcloud_url": search_url, "image_url": None, "soundcloud_id": None}


def find_producer_on_beatport(producer_name: str):
    """Beatport lookup disabled because BeautifulSoup is no longer required.

    Returns None so callers can skip Beatport enrichment without errors.
    """
    if not producer_name:
        return None

    return None
