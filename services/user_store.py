import uuid
from typing import List, Optional

from pydantic import BaseModel, EmailStr, Field, ValidationError, field_validator
from werkzeug.security import check_password_hash, generate_password_hash

from config import USERS_JSON_PATH
from services.atomic_storage import AtomicJSONStorage


class User(BaseModel):
    id: str
    email: EmailStr
    hashed_password: str
    name: str | None = None
    dj_name: str | None = None
    avatar_url: str | None = None
    soundcloud_url: str | None = None
    is_admin: bool = False
    favorites: List[str] = Field(default_factory=list)

    model_config = {
        "extra": "ignore",
    }


class LoginPayload(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_not_empty(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("Password erforderlich")
        return value


class RegisterPayload(LoginPayload):
    name: str | None = None

    @field_validator("password")
    @classmethod
    def password_strength(cls, value: str) -> str:
        if len(value.strip()) < 6:
            raise ValueError("Passwort muss mindestens 6 Zeichen haben")
        return value


class ProfileUpdatePayload(BaseModel):
    name: str | None = None
    dj_name: str | None = None
    avatar_url: str | None = None
    soundcloud_url: str | None = None


class InvitePayload(BaseModel):
    email: EmailStr
    name: str | None = None
    is_admin: bool = False


class FavoriteTogglePayload(BaseModel):
    item_id: str

    @field_validator("item_id")
    @classmethod
    def validate_item(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("item_id erforderlich")
        return value


class UserStore:
    def __init__(self, storage_path: str = USERS_JSON_PATH):
        self._storage = AtomicJSONStorage(storage_path)
        self._storage.ensure_file([])

    def _load_users(self) -> List[User]:
        data = self._storage.read(default=[])
        users: List[User] = []
        for raw in data:
            try:
                users.append(User.model_validate(raw))
            except ValidationError:
                continue
        return users

    def _save_users(self, users: List[User]) -> None:
        self._storage.write([user.model_dump() for user in users])

    def list_users(self) -> List[User]:
        return self._load_users()

    def _find_index_by_id(self, users: List[User], user_id: str) -> Optional[int]:
        for idx, user in enumerate(users):
            if user.id == user_id:
                return idx
        return None

    def get_by_email(self, email: str) -> Optional[User]:
        normalized = email.lower().strip()
        for user in self._load_users():
            if user.email.lower() == normalized:
                return user
        return None

    def get_by_id(self, user_id: str) -> Optional[User]:
        for user in self._load_users():
            if user.id == user_id:
                return user
        return None

    def add_user(
        self,
        email: str,
        password: str,
        name: str | None = None,
        dj_name: str | None = None,
        avatar_url: str | None = None,
        soundcloud_url: str | None = None,
        is_admin: bool = False,
    ) -> User:
        existing = self.get_by_email(email)
        if existing:
            raise ValueError("User existiert bereits")

        user = User(
            id=str(uuid.uuid4()),
            email=email.strip(),
            hashed_password=generate_password_hash(password.strip()),
            name=name,
            dj_name=dj_name,
            avatar_url=avatar_url,
            soundcloud_url=soundcloud_url,
            is_admin=is_admin,
            favorites=[],
        )
        users = self._load_users()
        users.append(user)
        self._save_users(users)
        return user

    def authenticate(self, email: str, password: str) -> Optional[User]:
        user = self.get_by_email(email)
        if user and check_password_hash(user.hashed_password, password):
            return user
        return None

    def update_user(self, user_id: str, updates: dict) -> Optional[User]:
        users = self._load_users()
        idx = self._find_index_by_id(users, user_id)
        if idx is None:
            return None

        user = users[idx]
        for key in ["name", "dj_name", "avatar_url", "soundcloud_url"]:
            if key in updates:
                setattr(user, key, updates.get(key))

        if "password" in updates and updates["password"]:
            user.hashed_password = generate_password_hash(str(updates["password"]))

        users[idx] = user
        self._save_users(users)
        return user

    def toggle_favorite(self, user_id: str, item_id: str) -> Optional[bool]:
        users = self._load_users()
        idx = self._find_index_by_id(users, user_id)
        if idx is None:
            return None

        user = users[idx]
        favorites = set(user.favorites or [])
        if item_id in favorites:
            favorites.remove(item_id)
            changed = False
        else:
            favorites.add(item_id)
            changed = True

        user.favorites = list(favorites)
        users[idx] = user
        self._save_users(users)
        return changed

    def delete_user(self, user_id: str) -> bool:
        users = self._load_users()
        idx = self._find_index_by_id(users, user_id)
        if idx is None:
            return False
        users.pop(idx)
        self._save_users(users)
        return True

    def ensure_default_admin(self) -> User:
        existing = self.get_by_email("admin")
        if existing:
            return existing
        return self.add_user("admin", "123456", name="Admin", is_admin=True)
