from typing import Iterable, Sequence

import database


def _normalize_artists(values: Iterable[str]) -> set[str]:
    artists: set[str] = set()
    for val in values:
        if not val:
            continue
        if isinstance(val, str):
            artist = val.strip()
            if artist:
                artists.add(artist)
    return artists


def lookup_soundcloud_profiles(artists: Iterable[str]) -> list[dict]:
    """Lookup SoundCloud profiles for given artists.

    This placeholder implementation is intended to be monkeypatched in tests
    or replaced by a real lookup routine. It returns an empty list by default
    to avoid network calls during normal processing.
    """

    return []


def lookup_beatport_profiles(artists: Iterable[str]) -> list[dict]:
    """Lookup Beatport profiles for given artists.

    Similar to :func:`lookup_soundcloud_profiles`, this is a stub that can be
    overridden during testing or extended with a real HTTP client.
    """

    return []


def save_beatport_profiles(profiles: Sequence[dict]):
    return database.save_beatport_profiles(profiles)


def save_soundcloud_profiles(profiles: Sequence[dict]):
    return database.save_soundcloud_profiles(profiles)


def get_set_artists(set_id: int) -> set[str]:
    conn = database.get_conn()
    cur = conn.cursor()
    cur.execute("SELECT artists, name FROM sets WHERE id = ?", (set_id,))
    row = cur.fetchone()
    conn.close()

    artists: set[str] = set()
    if row:
        if row["artists"]:
            artists.update(_normalize_artists(row["artists"].split(",")))
        name = row["name"] or ""
        if " - " in name:
            primary = name.split(" - ", 1)[0].strip()
            if primary:
                artists.add(primary)
    return artists


def get_track_artists(set_id: int) -> set[str]:
    tracks = database.get_tracks_by_set(set_id)
    return _normalize_artists(t.get("artist") for t in tracks)
