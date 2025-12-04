import threading
import uuid
import time
import os
from datetime import datetime
import traceback

class Job:
    def __init__(self, job_type, payload, metadata=None):
        self.id = str(uuid.uuid4())
        self.type = job_type
        self.payload = payload
        self.metadata = metadata or {}
        
        # Status & Phase
        self.status = "pending"     # pending, processing, completed, failed
        self.phase = "init"         # init, downloading, analyzing, importing
        
        self.log = []
        self.progress = 0
        self.error = None
        self.created_at = datetime.now()

    def log_msg(self, msg):
        self.log.append(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

class JobManager:
    def __init__(self):
        self.jobs = {}
        self.queue = []
        self.current_job_id = None
        self.lock = threading.Lock()
        self.running = True
        self.worker_thread = threading.Thread(target=self._worker, daemon=True)
        self.worker_thread.start()

    def add_job(self, job_type, payload, metadata=None):
        with self.lock:
            job = Job(job_type, payload, metadata)
            self.jobs[job.id] = job
            self.queue.append(job.id)
            job.log_msg(f"Job eingereiht: {job_type}")
            return job.id

    def get_status(self):
        with self.lock:
            active = self.jobs[self.current_job_id] if self.current_job_id else None
            pending = [self.jobs[jid] for jid in self.queue]
            done = [j for j in self.jobs.values() if j.status in ['completed', 'failed']]
            done.sort(key=lambda x: x.created_at, reverse=True)
            
            return {
                "active": self._serialize(active) if active else None,
                "queue_count": len(pending),
                "history": [self._serialize(j) for j in done[:5]],
                "queue": [self._serialize(j) for j in pending]
            }

    def _serialize(self, job):
        label = job.payload
        if job.type == 'file': label = os.path.basename(label)
        return {
            "id": job.id, 
            "type": job.type, 
            "label": label,
            "status": job.status, 
            "phase": job.phase,  # NEU: Phase für Farben
            "progress": job.progress,
            "log": job.log[-1] if job.log else "Warten...",
            "error": job.error
        }

    def _worker(self):
        while self.running:
            jid = None
            with self.lock:
                if self.queue: jid = self.queue.pop(0)
            
            if jid:
                self.current_job_id = jid
                self._run_job(jid)
                self.current_job_id = None
            else:
                time.sleep(0.5)

    def _run_job(self, jid):
        job = self.jobs[jid]
        job.status = "processing"
        try:
            from services.processor import process_job
            process_job(job)
            job.status = "completed"
            job.phase = "done"
            job.progress = 100
            job.log_msg("Fertiggestellt.")
        except Exception as e:
            job.status = "failed"
            job.phase = "error"
            job.error = str(e)
            job.log_msg(f"Fehler: {str(e)}")
            traceback.print_exc()

manager = JobManager()