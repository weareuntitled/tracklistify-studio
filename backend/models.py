from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, HttpUrl


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)

    model_config = {"extra": "forbid", "str_strip_whitespace": True}


class LoginRequest(RegisterRequest):
    pass


class ProfileUpdateRequest(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=1)
    bio: Optional[str] = None

    model_config = {"extra": "forbid", "str_strip_whitespace": True}


class SetRenameRequest(BaseModel):
    name: str = Field(..., min_length=1)

    model_config = {"extra": "forbid", "str_strip_whitespace": True}


class SetMetadataRequest(BaseModel):
    artists: Optional[str | List[str]] = None
    event: Optional[str] = None
    is_b2b: Optional[bool] = None
    tags: Optional[str | List[str]] = None

    model_config = {"extra": "allow", "str_strip_whitespace": True}


class ResolveMetadataRequest(BaseModel):
    url: HttpUrl | str = Field(..., min_length=1)

    model_config = {"extra": "forbid", "str_strip_whitespace": True}


class ResolveAudioRequest(BaseModel):
    query: str = Field(..., min_length=1)

    model_config = {"extra": "forbid", "str_strip_whitespace": True}


class QueueSubmission(BaseModel):
    type: Literal["url", "file"]
    value: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "forbid", "str_strip_whitespace": True}


class TrackFlagRequest(BaseModel):
    flag: int = Field(default=0, ge=0)

    model_config = {"extra": "forbid"}


class ToggleFavoriteRequest(BaseModel):
    liked: bool

    model_config = {"extra": "forbid"}


class PurchaseToggleRequest(BaseModel):
    purchased: bool

    model_config = {"extra": "forbid"}


class FolderCreateRequest(BaseModel):
    name: str = Field(..., min_length=1)

    model_config = {"extra": "forbid", "str_strip_whitespace": True}


class FolderAssignRequest(BaseModel):
    set_id: int

    model_config = {"extra": "forbid"}
