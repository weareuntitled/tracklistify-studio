import io
from pathlib import Path

import pytest

import app as flask_app
from services.user_store import UserStore


@pytest.fixture
def temp_user_store(tmp_path, monkeypatch):
    store = UserStore(storage_path=tmp_path / "users.json")
    monkeypatch.setattr(flask_app, "user_store", store)
    return store


@pytest.fixture
def temp_static_dir(tmp_path, monkeypatch):
    static_dir = tmp_path / "static"
    static_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(flask_app, "STATIC_DIR", str(static_dir))
    return static_dir


def test_profile_accepts_form_data_and_updates_avatar(temp_user_store, temp_static_dir):
    client = flask_app.app.test_client()

    user = temp_user_store.add_user("form@test.dev", "secret", name="Initial")

    with client.session_transaction() as session:
        session["user_id"] = user.id
        session["email"] = user.email
        session["is_admin"] = user.is_admin

    payload = {
        "display_name": "New Display",
        "dj_name": "DJ Tester",
        "soundcloud_url": "https://soundcloud.com/tester",
        "avatar": (io.BytesIO(b"avatar-bytes"), "avatar.png"),
    }

    response = client.post("/api/auth/profile", data=payload, content_type="multipart/form-data")
    data = response.get_json()

    assert response.status_code == 200
    assert data["ok"] is True
    assert data["user"]["name"] == "New Display"
    assert data["user"]["dj_name"] == "DJ Tester"
    assert data["user"]["avatar_url"].startswith("/static/avatars/")

    stored_user = temp_user_store.get_by_id(user.id)
    assert stored_user.avatar_url == data["user"]["avatar_url"]
    assert Path(temp_static_dir, "avatars", "avatar.png").exists()
