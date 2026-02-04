import threading
import time
import os
import asyncio
import yt_dlp
import re
import database
import shutil
from pytube import YouTube
from config import UPLOAD_DIR, BASE_DIR

# Ensure upload directory exists
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Find FFmpeg
FFMPEG_BIN = "ffmpeg.exe" if os.name == 'nt' else "ffmpeg"
FFMPEG_PATH = os.path.join(BASE_DIR, FFMPEG_BIN)
if not os.path.exists(FFMPEG_PATH):
    FFMPEG_PATH = shutil.which(FFMPEG_BIN)

print(f"[JobManager] FFmpeg Path: {FFMPEG_PATH}")

try:
    from services.analyzer import scan_dj_set
except ImportError:
    print("[JobManager] Analyzer module missing.")
    scan_dj_set = None

class JobManager:
    def __init__(self):
        self.queue = []
        self.history = []
        self.active_job = None
        self.stop_flag = False
        self.worker_thread = threading.Thread(target=self._worker, daemon=True)
        self.worker_thread.start()

    def add_job(self, type, value, metadata=None):
        job = {
            "id": int(time.time() * 1000),
            "type": type,   
            "value": value,
            "metadata": metadata or {},
            "status": "pending",
            "phase": "queued",
            "progress": 0,
            "label": metadata.get("title") or "Neues Set",
            "log": "Warte auf Start..."
        }
        self.queue.append(job)
        print(f"[JobManager] Added job: {job['label']}")

    def stop_active(self):
        if self.active_job:
            self.stop_flag = True
            return True
        return False

    def get_status(self):
        return {
            "active": self.active_job,
            "queue": self.queue,
            "history": self.history[-5:] 
        }

    def _worker(self):
        while True:
            if self.queue and not self.active_job:
                self.active_job = self.queue.pop(0)
                self.stop_flag = False
                try:
                    # New Event Loop for Thread
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    self._process_job(self.active_job)
                    loop.close()

                    self.active_job["status"] = "completed"
                    self.active_job["phase"] = "done"
                    self.active_job["progress"] = 100
                    self.active_job["log"] = "Fertig."
                except Exception as e:
                    print(f"[JobManager] Job Failed: {e}")
                    self.active_job["status"] = "error"
                    self.active_job["phase"] = "error"
                    self.active_job["log"] = str(e)
                
                self.history.append(self.active_job)
                self.active_job = None
            
            time.sleep(1)

    def _process_job(self, job):
        print(f"[JobManager] Starting Job {job['id']}")
        
        audio_path = ""
        job_id_str = str(job['id'])
        base_filename = f"import_{job_id_str}"
        
        # --- STEP 1: DOWNLOAD ---
        if job["type"] == "url":
            job["phase"] = "downloading"
            job["progress"] = 1
            job["log"] = "Initialisiere Download..."
            
            url = job["value"]
            output_template = os.path.join(UPLOAD_DIR, base_filename)
            
            def append_log(message):
                clean = re.sub(r'\x1b\[[0-9;]*m', '', str(message)).strip()
                if not clean:
                    return
                history = job.setdefault("log_history", [])
                history.append(clean)
                if len(history) > 4:
                    history[:] = history[-4:]
                job["log"] = " | ".join(history)

            def progress_hook(d):
                if d['status'] == 'downloading':
                    try:
                        raw_str = d.get('_percent_str', '0%')
                        clean_str = re.sub(r'\x1b\[[0-9;]*m', '', raw_str).strip()
                        percent = float(clean_str.replace('%', ''))
                        job["progress"] = percent * 0.8
                        progress_bucket = int(percent // 5) * 5
                        if job.get("last_progress_log") != progress_bucket:
                            job["last_progress_log"] = progress_bucket
                            append_log(f"Downloading: {clean_str}")
                    except: pass
                elif d['status'] == 'finished':
                    append_log("Finalisiere...")
                    job["progress"] = 80

            class JobLogger:
                def __init__(self, active_job):
                    self.job = active_job

                def _set_log(self, level, message):
                    clean = re.sub(r'\x1b\[[0-9;]*m', '', str(message)).strip()
                    if clean:
                        rendered = f"{level.upper()} - yt-dlp - {clean}"
                        append_log(rendered)
                        print(f"[yt-dlp] {rendered}")

                def debug(self, msg):
                    self._set_log("debug", msg)

                def info(self, msg):
                    self._set_log("info", msg)

                def warning(self, msg):
                    self._set_log("warning", msg)

                def error(self, msg):
                    self._set_log("error", msg)

            ydl_opts = {
                'format': 'bestaudio/best',
                'outtmpl': output_template, 
                'ffmpeg_location': FFMPEG_PATH, 
                'quiet': False,
                'verbose': True,
                'logtostderr': True,
                'logger': JobLogger(job),
                'extractor_args': {'youtube': {'player_client': ['default']}},
                'retries': 3,
                'fragment_retries': 3,
                'socket_timeout': 15,
                'retry_sleep_functions': {'http': 5},
                'noplaylist': True,
                'progress_hooks': [progress_hook]
            }

            print(f"[JobManager] Downloading {url}...")
            def run_download(options):
                with yt_dlp.YoutubeDL(options) as ydl:
                    return ydl.extract_info(url, download=True)

            def should_retry(error):
                message = str(error)
                return "HTTP Error 403" in message or "HTTP Error 429" in message or "Forbidden" in message

            info = None
            last_error = None
            client_candidates = ["default", "android", "web_safari", "ios"]
            for client in client_candidates:
                attempt_opts = dict(ydl_opts)
                attempt_opts['extractor_args'] = {'youtube': {'player_client': [client]}}
                try:
                    info = run_download(attempt_opts)
                    break
                except Exception as exc:
                    last_error = exc
                    if not should_retry(exc):
                        raise
                    append_log(f"Download fehlgeschlagen ({client}), versuche nächsten Client...")
            if info is None:
                append_log("yt-dlp fehlgeschlagen, versuche pytube...")
                try:
                    yt = YouTube(url)
                    stream = (
                        yt.streams.filter(only_audio=True)
                        .order_by("abr")
                        .desc()
                        .first()
                    )
                    if not stream:
                        raise Exception("Keine Audio-Streams gefunden.")
                    stream.download(output_path=UPLOAD_DIR, filename=base_filename)
                    info = {"title": yt.title}
                except Exception as exc:
                    if last_error:
                        raise last_error
                    raise exc
            if not job["metadata"].get("name"):
                job["metadata"]["name"] = info.get('title', 'YouTube Import')

            # --- FOOLPROOF FILE FINDER ---
            print(f"[JobManager] Waiting for file system...")
            time.sleep(2) # Give Windows a moment to release file locks
            
            # Scan directory directly instead of guessing paths
            files_in_dir = os.listdir(UPLOAD_DIR)
            found_file = None
            
            for f in files_in_dir:
                if f.startswith(base_filename) and not f.endswith('.part') and not f.endswith('.ytdl'):
                    # Prioritize extensions we like
                    if f.endswith('.mp3'):
                        found_file = f
                        break
                    if found_file is None:
                        found_file = f
            
            if found_file:
                audio_path = os.path.join(UPLOAD_DIR, found_file)
                print(f"[JobManager] Found file: {audio_path}")
            else:
                print(f"[Debug] Dir content: {files_in_dir}")
                raise Exception(f"Download fertig, aber Datei {base_filename} nicht gefunden.")

        else:
            audio_path = job["value"]
        
        if not os.path.exists(audio_path):
            raise Exception(f"Datei fehlt: {audio_path}")

      # --- STEP 2: DATABASE ---
        job["phase"] = "importing"
        job["progress"] = 85
        job["log"] = "Speichere Set..."

        conn = database.get_conn()
        cur = conn.cursor()
        
        # CORRECTED QUERY: Uses 'artists' (plural)
        cur.execute("""
            INSERT INTO sets (name, audio_file, created_at, artists, event, is_b2b) 
            VALUES (?, ?, datetime('now'), ?, ?, ?)
        """, (
            job["metadata"].get("name") or "Unbenanntes Set",
            audio_path,
            job["metadata"].get("artist"), # Maps input 'artist' to DB 'artists' column
            job["metadata"].get("event"),
            1 if job["metadata"].get("is_b2b") else 0
        ))
        set_id = cur.lastrowid
        conn.commit()
        conn.close()
        
        # --- STEP 3: ANALYZE ---
        if scan_dj_set:
            job["phase"] = "analyzing"
            job["progress"] = 90
            job["log"] = "Analysiere (Shazam)..."
            
            try:
                loop = asyncio.get_event_loop()
                found_tracks = loop.run_until_complete(scan_dj_set(audio_path))
                print(f"[JobManager] Found {len(found_tracks)} tracks")
            except Exception as e:
                print(f"[JobManager] Analyzer Error: {e}")
                found_tracks = [] 
                job["log"] = f"Analyse Fehler: {e}"

            # --- STEP 4: SAVE TRACKS ---
            job["progress"] = 95
            job["log"] = f"Speichere {len(found_tracks)} Tracks..."
            
            for i, t in enumerate(found_tracks):
                database.add_track_to_set(
                    set_id, i + 1, t['artist'], t['title'], t['start_time'], t.get('confidence', 0.9), t.get('cover')
                )
        else:
            job["log"] = "Analyzer inaktiv."

manager = JobManager()
