import os
import sys
import subprocess
import logging
import yt_dlp
from config import DOWNLOAD_DIR
from services import importer
import database 

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

def process_job(job):
    temp_filename = f"{job.id}"
    file_path = None
    
    print(f"--- JOB START: {job.id} ---") # Debug Print im Terminal

    try:
        # 1. DOWNLOAD
        job.phase = "downloading"
        if job.type == 'url':
            job.log_msg(f"Download: {job.payload}")
            out_tmpl = os.path.join(DOWNLOAD_DIR, f"{temp_filename}.%(ext)s")
            
            cmd = ["yt-dlp", "-x", "--audio-format", "mp3", "-o", out_tmpl, "--no-playlist", "--restrict-filenames", job.payload]
            
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='ignore')
            for line in proc.stdout:
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
        
        # HIER WAR DER FEHLER: Wir fangen ihn ab
        result = importer.import_json_files()
        print(f"Importer Result: {result} (Type: {type(result)})") # Debug Print

        new_ids = []
        count = 0
        
        if isinstance(result, list):
            new_ids = result
            count = len(new_ids)
        elif isinstance(result, int):
            count = result
            job.log_msg("ACHTUNG: Importer gab Zahl zurück, Metadata Skip.")
        
        # 4. METADATA
        if job.metadata and new_ids:
            target_id = new_ids[-1]
            meta = job.metadata
            final_name = f"{meta['artist']} - {meta['name']}" if (meta.get('artist') and meta.get('name')) else meta.get('name')
            
            upd = {"name": final_name, "artists": meta.get('artist'), "event": meta.get('event'), "is_b2b": meta.get('is_b2b'), "tags": meta.get('tags')}
            if final_name: database.rename_set(target_id, final_name)
            database.update_set_metadata(target_id, upd)
            job.log_msg("Metadaten gespeichert.")

        return {"new_sets": count}

    except Exception as e:
        job.log_msg(f"ERROR: {e}")
        import traceback
        traceback.print_exc() # Fehler im Terminal ausgeben
        raise e
    finally:
        try:
            if file_path and os.path.exists(file_path):
                os.remove(file_path)
        except: pass