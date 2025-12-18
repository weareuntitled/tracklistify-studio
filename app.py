import os
from functools import lru_cache
from typing import Any, Dict, Optional

import yt_dlp  # WICHTIG: pip install yt-dlp
from flask import (
    Blueprint,
    Flask,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
)
from pydantic import BaseModel, EmailStr, ValidationError
from werkzeug.exceptions import BadRequest, HTTPException
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Internal Modules
from config import SNIPPET_DIR, STATIC_DIR, UPLOAD_DIR
import database
from job_manager import manager as job_manager
from services.processor import resolve_audio_stream_url
from backend.storage import load_json_value
from backend.models import (
    QueueSubmission,
    ResolveAudioRequest,
    ResolveMetadataRequest,
    SetMetadataRequest,
    SetRenameRequest,
    ToggleFavoriteRequest,
    PurchaseToggleRequest,
    TrackFlagRequest,
    FolderAssignRequest,
    FolderCreateRequest
)
from services.user_store import (
    DEFAULT_ADMIN_EMAIL,
    UserStore,
    LoginPayload,
    RegisterPayload,
    ProfileUpdatePayload,
    InvitePayload
)

# Initialize Database
database.init_db()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-key")

# Blueprints
auth_api = Blueprint("auth_api", __name__, url_prefix="/api/auth")

# Initialize User Store & Create Admin
user_store = UserStore()
ADMIN_LOGIN_EMAIL = user_store.ensure_default_admin().email

# --- Helper Functions ---

def get_current_user():
    """Retrieves the current user object based on the session ID."""
    if "user_id" not in session:
        return None
    return user_store.get_by_id(session["user_id"])

@app.context_processor
def inject_user():
    """Makes the 'current_user' variable available in all Jinja templates."""
    return dict(current_user=get_current_user())

@lru_cache(maxsize=500)
def cached_resolve_audio(query):
    return resolve_audio_stream_url(query)

def parse_body(model_cls):
    """Parses JSON body against a Pydantic model."""
    data = request.get_json(silent=True)
    if data is None:
        raise BadRequest("Request body must be JSON")
    try:
        return model_cls.model_validate(data)
    except ValidationError as exc:
        raise BadRequest(exc.errors())


def parse_profile_payload() -> ProfileUpdatePayload:
    """Parses profile update payload from JSON or multipart form data."""
    content_type = request.content_type or ""

    if "multipart/form-data" in content_type:
        avatar_url: Optional[str] = None
        avatar_file = request.files.get("avatar")
        if avatar_file and avatar_file.filename:
            filename = secure_filename(avatar_file.filename)
            avatar_dir = os.path.join(STATIC_DIR, "avatars")
            os.makedirs(avatar_dir, exist_ok=True)
            save_path = safe_path(avatar_dir, filename)
            avatar_file.save(save_path)
            avatar_url = f"/static/avatars/{filename}"

        form_data: Dict[str, Optional[str]] = {
            "name": request.form.get("display_name") or request.form.get("name"),
            "dj_name": request.form.get("dj_name"),
            "soundcloud_url": request.form.get("soundcloud_url"),
        }

        if avatar_url is not None:
            form_data["avatar_url"] = avatar_url

        normalized: Dict[str, Optional[str]] = {}
        for key, value in form_data.items():
            if value is None:
                continue
            if isinstance(value, str):
                value = value.strip()
                if value == "":
                    continue
            normalized[key] = value
        try:
            return ProfileUpdatePayload.model_validate(normalized)
        except ValidationError as exc:
            raise BadRequest(exc.errors())

    return parse_body(ProfileUpdatePayload)

def safe_path(base: str, *paths: str) -> str:
    """Prevents directory traversal attacks."""
    base_abs = os.path.abspath(base)
    candidate = os.path.abspath(os.path.join(base_abs, *paths))
    if not candidate.startswith(base_abs + os.sep) and candidate != base_abs:
        raise BadRequest("Invalid path")
    return candidate

def set_session(user):
    """Sets session variables after login."""
    session["user_id"] = user.id
    session["email"] = user.email
    session["is_admin"] = user.is_admin

def require_session_user():
    """Middleware-like helper for API protection."""
    user = get_current_user()
    if not user:
        return None, (jsonify({"ok": False, "error": "Not authorized"}), 401)
    return user, None


# --- Frontend Routes ---

@app.route("/")
def index():
    user = get_current_user()
    if not user:
        return redirect("/login")
    return render_template("index.html", user=user)

@app.route("/login")
def login_page():
    if "user_id" in session:
        return redirect("/")
    return render_template("login.html")

@app.route("/register")
def register_page():
    if "user_id" in session:
        return redirect("/")
    return render_template("register.html")

@app.route("/profile")
def profile_page():
    user = get_current_user()
    if not user:
        session.clear()
        return redirect("/login")

    user_collections = database.get_all_sets()
    liked_tracks = database.get_liked_tracks()
    stats = database.get_dashboard_stats()

    display_name = user.name or user.dj_name or user.email

    return render_template(
        "profile.html",
        username=display_name,
        user=user,
        collections=user_collections,
        liked_tracks=liked_tracks,
        stats=stats,
    )


# --- API: Auth ---

@auth_api.route("/register", methods=["POST"])
def register_api():
    payload = parse_body(RegisterPayload)
    try:
        user = user_store.add_user(payload.email, payload.password, name=payload.name)
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 409

    set_session(user)
    return jsonify({"ok": True, "user": user.model_dump()})

@auth_api.route("/login", methods=["POST"])
def login():
    data: Dict[str, Any] = {}
    json_data = request.get_json(silent=True)
    if isinstance(json_data, dict):
        data.update(json_data)

    for key in ("email", "password"):
        if key not in data and key in request.form:
            data[key] = request.form.get(key)

    raw_email = str(data.get("email") or "").strip()
    password = str(data.get("password") or "").strip()

    class _AdminEmailModel(BaseModel):
        email: EmailStr

    try:
        admin_email = _AdminEmailModel(email=os.getenv("ADMIN_EMAIL", ADMIN_LOGIN_EMAIL)).email
    except ValidationError:
        admin_email = ADMIN_LOGIN_EMAIL

    admin_aliases = [admin_email, DEFAULT_ADMIN_EMAIL]
    admin_aliases = [email for email in admin_aliases if email]
    admin_alias_set = {email.lower() for email in admin_aliases}

    normalized_email = raw_email.lower()
    candidate_emails = []

    if normalized_email == "admin" or normalized_email in admin_alias_set:
        candidate_emails.extend(admin_aliases)
    else:
        candidate_emails.append(raw_email)

    validated_emails = []
    for email in candidate_emails:
        try:
            validated_emails.append(LoginPayload(email=email, password=password).email)
        except ValidationError:
            continue

    if not validated_emails:
        return jsonify({"ok": False, "error": "Invalid credentials"}), 401

    user = None
    for email in validated_emails:
        user = user_store.authenticate(email, password)
        if user:
            break

    if not user:
        return jsonify({"ok": False, "error": "Invalid credentials"}), 401

    set_session(user)
    role = "admin" if user.is_admin else "user"
    return jsonify({"ok": True, "user": user.model_dump(), "role": role})

@auth_api.route("/profile", methods=["GET", "POST"])
def profile():
    user, error_response = require_session_user()
    if error_response:
        return error_response
        
    if request.method == "POST":
        payload = parse_profile_payload()
        updated_user = user_store.update_user(user.id, payload.model_dump(exclude_unset=True))
        if updated_user:
            body = {"ok": True, "user": updated_user.model_dump()}
            if updated_user.avatar_url:
                body["avatar_url"] = updated_user.avatar_url
            return jsonify(body)
        return jsonify({"ok": False, "error": "Update failed"}), 500
        
    return jsonify({"ok": True, "user": user.model_dump()})

@auth_api.route("/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


# Register blueprints
app.register_blueprint(auth_api)


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
def get_liked_tracks_endpoint():
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

@app.route("/api/folders", methods=["GET", "POST"])
def folders():
    if request.method == "GET":
        return jsonify({"folders": database.get_folders_with_sets()})

    payload = parse_body(FolderCreateRequest)
    folder = database.create_folder(payload.name)
    return jsonify({"ok": True, "folder": folder})

@app.route("/api/folders/<int:folder_id>/sets", methods=["POST", "DELETE"])
def assign_folder(folder_id: int):
    payload = parse_body(FolderAssignRequest)
    if request.method == "DELETE":
        database.remove_set_from_folder(folder_id, payload.set_id)
    else:
        database.assign_set_to_folder(folder_id, payload.set_id)
    return jsonify({"ok": True, "folders": database.get_folders_with_sets()})

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


# --- API: Metadata Resolver ---

@app.route("/api/resolve_metadata", methods=["POST"])
def get_metadata():
    """Fetches metadata via yt-dlp quickly."""
    data = parse_body(ResolveMetadataRequest)
    url = data.url

    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'extract_flat': True,
        'skip_download': True
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
        except Exception as e:
             return jsonify({"ok": False, "error": str(e)}), 400

        title = info.get('title', '')
        uploader = info.get('uploader', '')

        artist_guess = uploader
        name_guess = title
        event_guess = ""

        if " - " in title:
            parts = title.split(" - ", 1)
            if len(parts) == 2:
                if uploader and uploader.lower() in ["hör berlin", "boiler room", "mixmag", "cercle"]:
                    event_guess = uploader
                    artist_guess = parts[0]
                    name_guess = parts[1]
                else:
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
    metadata: Dict[str, Any] = {}
    submission_type = None
    submission_value = None

    if request.is_json:
        data = request.get_json(force=True)
        submission_type = data.get("type")
        submission_value = data.get("value")
        metadata = data.get("metadata") or {}
    else:
        metadata_raw = request.form.get("metadata")
        if metadata_raw:
            try:
                metadata = load_json_value(metadata_raw) or {}
            except Exception as exc:
                raise BadRequest(f"Invalid metadata payload: {exc}")

        submission_type = request.form.get("type")
        submission_value = request.form.get("value")

    if submission_type == "url":
        if not submission_value:
            raise BadRequest("URL missing")
        job_manager.add_job("url", submission_value, metadata)

    elif submission_type == "file":
        if request.is_json:
            raise BadRequest("File upload requires multipart form data")
        if 'file' not in request.files:
            raise BadRequest("File upload required")
        file = request.files['file']
        if not file or not file.filename:
            raise BadRequest("File upload required")
        
        filename = secure_filename(file.filename)
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        save_path = safe_path(UPLOAD_DIR, filename)
        file.save(save_path)
        job_manager.add_job("file", save_path, metadata)
    
    else:
        raise BadRequest("Invalid job type")

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
        return jsonify({"ok": False, "error": "No artists found from likes/purchases"}), 404

    feeds = database.fetch_youtube_feed(artist_list)
    return jsonify({"ok": True, "items": feeds, "artists": artist_list})

@app.route("/api/sets/import", methods=["POST"])
def run_import():
    import services.importer as importer
    n = importer.import_json_files()
    return jsonify({"ok": True, "imported": n})


# --- Static Files ---

@app.route("/snippets/<path:filename>")
def serve_snippets(filename):
    return send_from_directory(SNIPPET_DIR, filename)

@app.route("/static/<path:filename>")
def serve_static(filename):
    return send_from_directory(STATIC_DIR, filename)

@app.route("/static/js/<path:filename>")
def serve_js(filename):
    return send_from_directory(os.path.join(STATIC_DIR, "js"), filename)


# --- Error Handling ---

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

    return jsonify({"error": True, "message": message, "code": code}), code


if __name__ == "__main__":
    print("Starte Tracklistify Helper auf http://127.0.0.1:5000")
    app.run(host="0.0.0.0", port=5000, debug=True)
