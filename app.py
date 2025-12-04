import os
from functools import lru_cache
from typing import Any, Dict

import yt_dlp  # WICHTIG: pip install yt-dlp
from backend.models import (
    LoginRequest,
    PurchaseToggleRequest,
    QueueSubmission,
    ResolveAudioRequest,
    ResolveMetadataRequest,
    SetMetadataRequest,
    SetRenameRequest,
    ToggleFavoriteRequest,
    TrackFlagRequest,
    RegisterRequest,
)
from backend.storage import load_json_value
from flask import Flask, jsonify, redirect, render_template, request, send_from_directory, session
from pydantic import ValidationError
from werkzeug.exceptions import BadRequest, HTTPException
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

# Eigene Module
from config import SNIPPET_DIR, STATIC_DIR, UPLOAD_DIR
import database
from job_manager import manager as job_manager
from services.processor import resolve_audio_stream_url

database.init_db()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-key")

# --- Caching ---
@lru_cache(maxsize=500)
def cached_resolve_audio(query):
    return resolve_audio_stream_url(query)


def parse_body(model_cls):
    data = request.get_json(silent=True)
    if data is None:
        raise BadRequest("Request body must be JSON")
    try:
        return model_cls.model_validate(data)
    except ValidationError as exc:
        raise BadRequest(exc.errors())


def safe_path(base: str, *paths: str) -> str:
    base_abs = os.path.abspath(base)
    candidate = os.path.abspath(os.path.join(base_abs, *paths))
    if not candidate.startswith(base_abs + os.sep) and candidate != base_abs:
        raise BadRequest("Invalid path")
    return candidate

# --- Frontend Routes ---
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/login")
def login_page():
    if "user_id" in session:
        return redirect("/profile")
    return render_template("login.html")


@app.route("/register")
def register_page():
    if "user_id" in session:
        return redirect("/profile")
    return render_template("register.html")


@app.route("/profile")
def profile_page():
    if "user_id" not in session:
        return redirect("/login")

    user_collections = database.get_all_sets()
    liked_tracks = database.get_liked_tracks()
    stats = database.get_dashboard_stats()

    return render_template(
        "profile.html",
        username=session.get("username"),
        collections=user_collections,
        liked_tracks=liked_tracks,
        stats=stats,
    )

# --- API: Sets & Tracks ---
@app.route("/api/sets")
def list_sets():
    return jsonify(database.get_all_sets())

@app.route("/api/sets/<int:sid>/tracks")
def list_tracks(sid):
    return jsonify(database.get_tracks_by_set_with_relations(sid))

@app.route("/api/sets/<int:sid>/rename", methods=["POST"])
def rename_set(sid):
    payload = parse_body(SetRenameRequest)
    database.rename_set(sid, payload.name)
    return jsonify({"ok": True})

@app.route("/api/sets/<int:sid>/metadata", methods=["POST"])
def update_set_metadata(sid):
    payload = parse_body(SetMetadataRequest)
    database.update_set_metadata(sid, payload.model_dump(exclude_none=True))
    return jsonify({"ok": True})

@app.route("/api/sets/<int:sid>", methods=["DELETE"])
def delete_set(sid):
    deleted = database.delete_set(sid)
    return jsonify({"ok": bool(deleted), "deleted": deleted})


@app.route("/api/tracks/<int:tid>", methods=["DELETE"])
def delete_track(tid):
    deleted = database.delete_track(tid)
    status = 200 if deleted else 404
    return jsonify({"ok": bool(deleted), "deleted": deleted}), status

@app.route("/api/tracks/<int:tid>/like", methods=["POST"])
def like_track(tid):
    data = parse_body(ToggleFavoriteRequest)
    liked = 1 if data.liked else 0
    database.toggle_track_like(tid, liked)
    return jsonify({"ok": True})

@app.route("/api/tracks/likes")
def liked_tracks():
    return jsonify(database.get_liked_tracks())

@app.route("/api/tracks/<int:tid>/purchase", methods=["POST"])
def purchase_track(tid):
    data = parse_body(PurchaseToggleRequest)
    purchased = 1 if data.purchased else 0
    database.toggle_track_purchase(tid, purchased)
    return jsonify({"ok": True})

@app.route("/api/tracks/purchases")
def purchased_tracks():
    return jsonify(database.get_purchased_tracks())

@app.route("/api/producers/<int:pid>/like", methods=["POST"])
def like_producer(pid):
    data = parse_body(ToggleFavoriteRequest)
    liked = 1 if data.liked else 0
    database.toggle_producer_like(pid, liked)
    return jsonify({"ok": True})

@app.route("/api/producers/likes")
def liked_producers():
    return jsonify(database.get_favorite_producers())

@app.route("/api/tracks/<int:tid>/flag", methods=["POST"])
def flag_track(tid):
    data = parse_body(TrackFlagRequest)
    flag = int(data.flag or 0)
    database.update_track_flag(tid, flag)
    return jsonify({"ok": True})

# --- API: Metadata Resolver (NEU & VERBESSERT) ---
@app.route("/api/resolve_metadata", methods=["POST"])
def get_metadata():
    """
    Holt Metadaten via yt-dlp (schnell, ohne Download).
    """
    data = parse_body(ResolveMetadataRequest)
    url = data.url

    # Optionen für schnellen Metadaten-Abruf
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': True, # Nur Playlist/Video Infos, nicht streamen
        'skip_download': True
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

        title = info.get('title', '')
        uploader = info.get('uploader', '')

        # Logik: "Artist - Title" vs "Event"
        artist_guess = uploader
        name_guess = title
        event_guess = ""

        # Wenn Bindestrich im Titel, splitten wir oft Artist - Setname
        if " - " in title:
            parts = title.split(" - ", 1)
            if len(parts) == 2:
                # Heuristik: Wenn Uploader "HÖR BERLIN" o.ä. ist, ist das das Event
                if uploader and uploader.lower() in ["hör berlin", "boiler room", "mixmag", "cercle"]:
                    event_guess = uploader
                    artist_guess = parts[0]
                    name_guess = parts[1]
                else:
                    # Sonst nehmen wir an: Artist - Titel im Video-Titel
                    artist_guess = parts[0]
                    name_guess = parts[1]

        return jsonify({
            "ok": True,
            "name": name_guess.strip(),
            "artist": artist_guess.strip(),
            "event": event_guess.strip()
        })


# --- API: Queue & Jobs ---
@app.route("/api/queue/add", methods=["POST"])
def add_job():
    metadata_raw = request.form.get("metadata")
    metadata: Dict[str, Any] = {}

    if metadata_raw:
        try:
            metadata = load_json_value(metadata_raw) or {}
        except Exception as exc:
            raise BadRequest(f"Invalid metadata payload: {exc}")
        if not isinstance(metadata, dict):
            raise BadRequest("Metadata must be a JSON object")

    submission = QueueSubmission.model_validate(
        {"type": request.form.get("type"), "value": request.form.get("value"), "metadata": metadata}
    )

    if submission.type == "url":
        if not submission.value:
            raise BadRequest("Keine URL")
        job_manager.add_job("url", submission.value, submission.metadata)

    elif submission.type == "file":
        if 'file' not in request.files:
            raise BadRequest("File upload required")
        file = request.files['file']
        if not file or not file.filename:
            raise BadRequest("File upload required")
        filename = secure_filename(file.filename)
        if not filename:
            raise BadRequest("Filename missing")
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        save_path = safe_path(UPLOAD_DIR, filename)
        file.save(save_path)
        job_manager.add_job("file", save_path, submission.metadata)

    return jsonify({"ok": True})

@app.route("/api/queue/status")
def queue_status():
    return jsonify(job_manager.get_status())

@app.route("/api/queue/stop", methods=["POST"])
def queue_stop():
    stopped = job_manager.stop_active()
    return jsonify({"ok": True, "stopped": stopped})

# --- API: Rescan & Audio ---
@app.route("/api/tracks/rescan_candidates")
def rescan_list():
    return jsonify(database.get_rescan_candidates())

@app.route("/api/tracks/rescan_run", methods=["POST"])
def rescan_run():
    database.reset_rescan_flags()
    return jsonify({"ok": True, "processed": 1})

@app.route("/api/resolve_audio", methods=["POST"])
def resolve_audio():
    data = parse_body(ResolveAudioRequest)
    query = data.query
    url = cached_resolve_audio(query)
    if url:
        return jsonify({"ok": True, "url": url})
    return jsonify({"ok": False}), 404

@app.route("/api/dashboard")
def dashboard_stats():
    return jsonify(database.get_dashboard_stats())


@app.route("/api/youtube/feeds")
def youtube_feeds():
    artists = request.args.get("artists")
    query = request.args.get("q")

    if artists:
        artist_list = [a.strip() for a in artists.split(",") if a.strip()]
    else:
        artist_list = database.get_engaged_artists(query=query)

    if not artist_list:
        return jsonify({"ok": False, "error": "Keine Artists aus Likes/Käufen gefunden"}), 404

    feeds = database.fetch_youtube_feed(artist_list)
    return jsonify({"ok": True, "items": feeds, "artists": artist_list})

@app.route("/api/sets/import", methods=["POST"])
def run_import():
    import services.importer as importer
    n = importer.import_json_files()
    return jsonify({"ok": True, "imported": n})

# --- Static ---
@app.route("/snippets/<path:filename>")
def serve_snippets(filename):
    return send_from_directory(SNIPPET_DIR, filename)

@app.route("/static/<path:filename>")
def serve_static(filename):
    return send_from_directory(STATIC_DIR, filename)

@app.route("/static/js/<path:filename>")
def serve_js(filename):
    return send_from_directory(os.path.join(STATIC_DIR, "js"), filename)


# --- API: Auth ---
@app.route("/api/auth/register", methods=["POST"])
def register():
    data = parse_body(RegisterRequest)
    username = data.username
    password = data.password

    if database.get_user(username):
        return jsonify({"ok": False, "error": "User existiert bereits"}), 409

    pw_hash = generate_password_hash(password)
    user_id = database.create_user(username, pw_hash)
    session["user_id"] = user_id
    session["username"] = username
    return jsonify({"ok": True, "username": username})


@app.route("/api/auth/login", methods=["POST"])
def login():
    data = parse_body(LoginRequest)
    username = data.username
    password = data.password
    user = database.get_user(username)
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"ok": False, "error": "Ungültige Zugangsdaten"}), 401

    session["user_id"] = user["id"]
    session["username"] = user["username"]
    return jsonify({"ok": True, "username": user["username"]})


@app.route("/api/auth/profile")
def profile():
    if "user_id" not in session:
        return jsonify({"ok": False}), 401
    return jsonify({"ok": True, "username": session.get("username")})


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.errorhandler(Exception)
def handle_exception(error):
    if isinstance(error, ValidationError):
        code = 400
        message = error.errors()
    elif isinstance(error, HTTPException):
        code = error.code or 500
        message = getattr(error, "description", str(error))
    else:
        code = 500
        message = str(error) or "Internal Server Error"

    response = {"error": True, "message": message, "code": code}
    return jsonify(response), code

if __name__ == "__main__":
    database.init_db()
    import services.importer as importer
    importer.import_json_files()
    print("Starte Tracklistify Helper auf http://127.0.0.1:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
