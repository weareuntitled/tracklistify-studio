import logging
from typing import Optional
from urllib.parse import quote_plus

import requests
import yt_dlp
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


SOUNDCLOUD_FALLBACK_BASE = "https://soundcloud.com/search/people?q="
BEATPORT_BASE = "https://www.beatport.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)


def _default_result() -> dict:
    return {"url": None, "image": None}


def find_dj_on_soundcloud(name: Optional[str]) -> dict:
    """Find a DJ profile on SoundCloud using yt-dlp's SoundCloud search.

    Falls back to the public people search page when yt-dlp cannot resolve a
    profile. Always returns a dictionary with ``url`` and ``image`` keys.
    """

    if not name:
        return _default_result()

    search_term = f"scsearch1:{name}"
    try:
        with yt_dlp.YoutubeDL(
            {
                "quiet": True,
                "skip_download": True,
                "extract_flat": True,
                "default_search": "auto",
            }
        ) as ydl:
            info = ydl.extract_info(search_term, download=False)

        entries = info.get("entries") if isinstance(info, dict) else None
        entry = entries[0] if entries else None
        if entry:
            url = (
                entry.get("url")
                or entry.get("webpage_url")
                or entry.get("original_url")
            )
            image = entry.get("thumbnail")
            if url:
                return {"url": url, "image": image}
    except Exception as exc:  # pragma: no cover - network/yt-dlp failures
        logger.warning("SoundCloud lookup failed: %s", exc)

    fallback_url = f"{SOUNDCLOUD_FALLBACK_BASE}{quote_plus(name)}"
    return {"url": fallback_url, "image": None}


def find_producer_on_beatport(name: Optional[str]) -> dict:
    """Find a producer profile on Beatport via the artist search page.

    Scrapes the first artist result and returns its profile URL and image if
    available. Returns the search page URL when no profile could be parsed.
    """

    if not name:
        return _default_result()

    search_url = f"{BEATPORT_BASE}/search/artists?q={quote_plus(name)}"
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"}

    try:
        response = requests.get(search_url, headers=headers, timeout=10)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        link = None
        for anchor in soup.find_all("a", href=True):
            href = anchor.get("href", "")
            if "/artist/" in href:
                link = anchor
                break

        if link:
            href = link["href"]
            url = href if href.startswith("http") else f"{BEATPORT_BASE}{href}"

            image_tag = link.find("img") or link.find_next("img")
            image = None
            if image_tag:
                image = image_tag.get("data-src") or image_tag.get("src")

            return {"url": url, "image": image}
    except Exception as exc:  # pragma: no cover - network/scraper failures
        logger.warning("Beatport lookup failed: %s", exc)

    return {"url": search_url, "image": None}
