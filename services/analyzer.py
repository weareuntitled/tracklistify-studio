import asyncio
import os
import subprocess
from shazamio import Shazam

async def scan_dj_set(file_path):
    """
    Scans a DJ set file by splitting it into chunks and identifying them.
    """
    print(f"[Analyzer] Starting scan for: {file_path}")
    
    # 1. Check for FFmpeg
    try:
        subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except FileNotFoundError:
        print("[Analyzer] ERROR: FFmpeg not found! Cannot analyze audio.")
        return []

    detected_tracks = []
    shazam = Shazam()
    
    # 2. Get Duration
    try:
        cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", file_path]
        duration = float(subprocess.check_output(cmd).decode().strip())
    except Exception as e:
        print(f"[Analyzer] Warning: Could not get duration ({e}). Assuming 1 hour.")
        duration = 3600 

    # 3. Scan Loop
    # We take a 10s sample every 3 minutes (180s)
    interval = 180 
    current_time = 0
    temp_snippet = "temp_shazam_snippet.mp3"

    while current_time < duration:
        print(f"[Analyzer] Scanning at {current_time}s...")
        
        # Cut Snippet
        cmd = [
            "ffmpeg", "-y", "-ss", str(current_time), "-t", "10",
            "-i", file_path, "-vn", "-acodec", "libmp3lame", "-loglevel", "quiet", 
            temp_snippet
        ]
        
        try:
            subprocess.run(cmd, check=True)
            
            # Recognize
            out = await shazam.recognize(temp_snippet)
            track = out.get('track')
            
            if track:
                title = track.get('title')
                subtitle = track.get('subtitle')
                print(f"   -> Match: {subtitle} - {title}")
                
                detected_tracks.append({
                    "title": title,
                    "artist": subtitle,
                    "start_time": current_time,
                    "confidence": 1.0,
                    "cover": track.get('images', {}).get('coverart')
                })
            else:
                print("   -> No match.")
                
        except Exception as e:
            print(f"[Analyzer] Error at {current_time}s: {e}")

        current_time += interval

    # Cleanup
    if os.path.exists(temp_snippet):
        os.remove(temp_snippet)

    return detected_tracks