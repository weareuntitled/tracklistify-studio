import subprocess
import logging
import database

logger = logging.getLogger(__name__)

class AudioResolver:
    """
    High-Performance Audio Resolver.
    Layer 1: Database Cache (Instant)
    Layer 2: YouTube Search (Topic -> Official -> General)
    """

    @staticmethod
    def resolve_track(track_id):
        # 1. CHECK CACHE (The Speed Layer)
        cached_url = database.get_cached_stream(track_id)
        if cached_url:
            print(f"[Resolver] Cache Hit for Track {track_id}")
            return cached_url

        # 2. FETCH METADATA
        conn = database.get_conn()
        row = conn.execute("SELECT artist, title FROM tracks WHERE id = ?", (track_id,)).fetchone()
        conn.close()

        if not row:
            return None

        artist = row['artist'] or ""
        title = row['title'] or ""
        
        # 3. PERFORM SMART SEARCH
        # We search for "Topic" first (Highest Quality / Official)
        queries = [
            f"{artist} - {title} Topic",
            f"{artist} - {title} Official Audio",
            f"{artist} - {title}"
        ]

        stream_url = None

        for query in queries:
            try:
                print(f"[Resolver] Searching: '{query}'")
                # Using bestaudio and getting the direct stream URL (-g)
                cmd = [
                    "yt-dlp", 
                    "-f", "bestaudio", 
                    "-g", 
                    "--no-playlist", 
                    "--geo-bypass",  # Bypass country blocks
                    f"ytsearch1:{query}"
                ]
                
                # Run with timeout to prevent hanging threads
                res = subprocess.run(
                    cmd, 
                    capture_output=True, 
                    text=True, 
                    timeout=15, 
                    encoding='utf-8', 
                    errors='ignore'
                )

                if res.returncode == 0:
                    url = res.stdout.strip()
                    if url.startswith("http"):
                        stream_url = url
                        break # Found it!
            
            except Exception as e:
                print(f"[Resolver] Error on query '{query}': {e}")
                continue

        # 4. UPDATE CACHE
        if stream_url:
            print(f"[Resolver] Found & Cached: {stream_url[:50]}...")
            database.save_cached_stream(track_id, stream_url)
            return stream_url
        
        return None