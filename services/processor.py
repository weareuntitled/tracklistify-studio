import os
import sys
import subprocess
import logging
import yt_dlp
from threading import Event
from config import DOWNLOAD_DIR
from services import importer
from services import enrichment
import database


class JobCancelled(Exception):
    pass

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def resolve_audio_stream_url(query):
    # ... (unverändert, siehe vorher)
    cmd = ["yt-dlp", "-f", "bestaudio", "-g", "--no-playlist", f"ytsearch1:{query}"]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=8, encoding='utf-8', errors='ignore')
        if res.returncode == 0 and res.stdout.strip().startswith("http"):
            return res.stdout.strip()
    except: pass
    return None

def process_job(job, cancel_event: Event | None = None):
    temp_filename = f"{job.id}"
    file_path = None
    
    print(f"--- JOB START: {job.id} ---") # Debug Print im Terminal

    def _check_cancel(proc=None):
        if cancel_event and cancel_event.is_set():
            if proc:
                try:
                    proc.terminate()
                except Exception:
                    pass
            raise JobCancelled("Abgebrochen")

    try:
        # 1. DOWNLOAD
        job.phase = "downloading"
        if job.type == 'url':
            job.log_msg(f"Download: {job.payload}")
            out_tmpl = os.path.join(DOWNLOAD_DIR, f"{temp_filename}.%(ext)s")
            
            cmd = ["yt-dlp", "-x", "--audio-format", "mp3", "-o", out_tmpl, "--no-playlist", "--restrict-filenames", job.payload]
            
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='ignore')
            for line in proc.stdout:
                _check_cancel(proc)
                if "[download]" in line and "%" in line:
                    try: job.progress = float(line.split("%")[0].split()[-1])
                    except: pass
                elif "ERROR" in line: job.log_msg(line.strip())
            proc.wait()
            
            if proc.returncode != 0: raise Exception("Download fehlgeschlagen.")
            
            # Datei finden
            candidates = [f for f in os.listdir(DOWNLOAD_DIR) if f.startswith(temp_filename)]
            if candidates: file_path = os.path.join(DOWNLOAD_DIR, candidates[0])
            else: raise Exception("Datei nach Download nicht gefunden.")
            
        elif job.type == 'file':
            file_path = job.payload
            if not os.path.exists(file_path): raise Exception("Datei weg.")

        print(f"File Path: {file_path}") # Debug Print

        # 2. ANALYSE
        job.phase = "analyzing"
        job.progress = 0
        job.log_msg("Starte Analyse...")

        cmd_ana = [sys.executable, "-m", "tracklistify", file_path]
        proc_ana = subprocess.Popen(cmd_ana, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='ignore')

        analyzer_output = []
        for line in proc_ana.stdout:
            _check_cancel(proc_ana)
            l = line.strip()
            if l:
                analyzer_output.append(l)
                # Nur wichtige Lines ins UI loggen, alles ins Terminal
                print(f"[Tracklistify] {l}")
                if "Identifying" in l or "Found" in l:
                    job.log_msg(l)
                    if job.progress < 90: job.progress += 2

        proc_ana.wait()
        print(f"Analyse Exit Code: {proc_ana.returncode}") # Debug Print

        if proc_ana.returncode != 0:
            job.phase = "error"
            job.status = "failed"
            job.error = f"Analyzer exited with code {proc_ana.returncode}"
            job.log_msg(job.error)
            if analyzer_output:
                job.log_msg("Analyzer output:")
                for entry in analyzer_output:
                    job.log_msg(entry)
            raise RuntimeError(job.error)

        # 3. IMPORT
        job.phase = "importing"
        job.log_msg("Datenbank Import...")

        _check_cancel()

        # HIER WAR DER FEHLER: Wir fangen ihn ab
        result = importer.import_json_files()
        print(f"Importer Result: {result} (Type: {type(result)})") # Debug Print

        new_ids = []

        if isinstance(result, list):
            new_ids = result
        elif isinstance(result, dict) and isinstance(result.get("new_set_ids"), list):
            new_ids = result.get("new_set_ids", [])
        else:
            job.log_msg("ACHTUNG: Importer gab unerwartetes Format zurück, Metadata Skip.")

        count = len(new_ids)
        if count:
            job.log_msg(f"Import abgeschlossen: {count} neues Set")
        else:
            job.log_msg("Kein neues Set gefunden, eventuell bereits importiert.")

        # 4. METADATA
        if job.metadata and new_ids:
            target_id = new_ids[-1]
            meta = job.metadata
            final_name = f"{meta['artist']} - {meta['name']}" if (meta.get('artist') and meta.get('name')) else meta.get('name')

            upd = {"name": final_name, "artists": meta.get('artist'), "event": meta.get('event'), "is_b2b": meta.get('is_b2b'), "tags": meta.get('tags')}
            if final_name: database.rename_set(target_id, final_name)
            database.update_set_metadata(target_id, upd)
            job.log_msg("Metadaten gespeichert.")

        # 5. ENRICHMENT
        if new_ids:
            # SoundCloud enrichment for DJs (sets)
            for set_id in new_ids:
                set_row = database.get_set(set_id)
                dj_name = None
                if job.metadata and job.metadata.get("artist"):
                    dj_name = job.metadata.get("artist")
                elif set_row and set_row.get("artists"):
                    dj_name = set_row.get("artists")
                if dj_name:
                    dj_info = enrichment.find_dj_on_soundcloud(dj_name)
                    if dj_info:
                        dj_id = database.upsert_dj(
                            dj_name,
                            image_url=dj_info.get("image_url"),
                            soundcloud_url=dj_info.get("soundcloud_url"),
                            soundcloud_id=dj_info.get("soundcloud_id"),
                        )
                        database.link_set_dj(set_id, dj_id)
                        database.update_set_soundcloud(set_id, dj_info.get("soundcloud_url"), dj_id)
                        job.log_msg(f"Found SoundCloud Profile: {dj_name}")

            # Beatport enrichment for producers (tracks)
            producer_cache: dict[str, dict | None] = {}
            for set_id in new_ids:
                tracks = database.get_tracks_by_set(set_id)
                for track in tracks:
                    artist_name = track.get("artist")
                    if not artist_name:
                        continue
                    if artist_name not in producer_cache:
                        producer_cache[artist_name] = enrichment.find_producer_on_beatport(artist_name)
                    info = producer_cache.get(artist_name)
                    if info:
                        producer_id = database.upsert_producer(
                            artist_name,
                            image_url=info.get("image_url"),
                            beatport_url=info.get("beatport_url"),
                            beatport_id=info.get("beatport_id"),
                        )
                        database.assign_track_entities(track.get("id"), producer_id=producer_id, beatport_url=info.get("beatport_url"))
                        job.log_msg(f"Found Beatport Profile: {artist_name}")

        return {"new_sets": count}

    except JobCancelled as e:
        job.log_msg(str(e))
        raise
    except Exception as e:
        job.log_msg(f"ERROR: {e}")
        import traceback
        traceback.print_exc() # Fehler im Terminal ausgeben
        raise e
    finally:
        try:
            if file_path and os.path.exists(file_path):
                os.remove(file_path)
        except:
            pass
