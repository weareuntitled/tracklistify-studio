import logging
import urllib.parse

import requests
import yt_dlp
from bs4 import BeautifulSoup

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
    """Scrape Beatport artist search results to find the first matching producer."""
    if not producer_name:
        return None

    search_url = f"https://www.beatport.com/search/artists?q={urllib.parse.quote_plus(producer_name)}"
    headers = {"User-Agent": USER_AGENT}

    try:
        resp = requests.get(search_url, headers=headers, timeout=8)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        # Beatport search cards typically live under anchors with /artist/ slug
        link = soup.select_one("a[href*='/artist/']")
        if not link:
            return None

        url = urllib.parse.urljoin("https://www.beatport.com", link.get("href"))
        image = None
        img_tag = link.find("img")
        if img_tag:
            image = img_tag.get("data-src") or img_tag.get("src")

        # Beatport URLs usually end with /<name>/<id>
        beatport_id = None
        try:
            parts = url.rstrip("/").split("/")
            beatport_id = parts[-1]
        except Exception:
            beatport_id = None

        return {"beatport_url": url, "image_url": image, "beatport_id": beatport_id}
    except Exception as exc:  # noqa: BLE001
        logger.debug("Beatport lookup failed: %s", exc)
        return None
