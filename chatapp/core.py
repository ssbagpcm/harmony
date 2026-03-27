"""
Discord-like Backend — main.py  (single file, improved)
=======================================================
Run:
    pip install -r requirements.txt
    python main.py

Swagger UI : http://localhost:8000/docs
WebSocket  : ws://localhost:8000/gateway?token=<jwt>
"""

import json
import logging
import os
import random
import string
import time
import uuid
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[1]
DATABASE_DIR = APP_ROOT / "database"
UPLOAD_PATH = APP_ROOT / "uploads"
STATIC_DIR = APP_ROOT / "static"

DATABASE_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_PATH.mkdir(parents=True, exist_ok=True)

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from enum import IntFlag
from typing import Optional

import bcrypt as _bcrypt
import uvicorn
from fastapi import (
    Depends,
    FastAPI,
    File,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    delete,
    func,
    select,
    text,
    update,
)
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# ═══════════════════════════════════════════════════════════════════════════
#  Config
# ═══════════════════════════════════════════════════════════════════════════
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    f"sqlite+aiosqlite:///{(DATABASE_DIR / 'discord.db').as_posix()}",
)
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production!")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_DAYS = 7
UPLOAD_DIR = str(UPLOAD_PATH)
MAX_UPLOAD_MB = 25
HEARTBEAT_MS = 30_000
ALLOWED_MIME = None

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("harmony")

# ═══════════════════════════════════════════════════════════════════════════
#  Database
# ═══════════════════════════════════════════════════════════════════════════
engine = create_async_engine(DATABASE_URL, echo=False, future=True)
AsyncSessionLocal = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as s:
        yield s


# ═══════════════════════════════════════════════════════════════════════════
#  ID generators
# ═══════════════════════════════════════════════════════════════════════════
def _uid(p: str) -> str:
    return f"{p}_{uuid.uuid4().hex}"


def srv_id():
    return _uid("srv")


def chn_id():
    return _uid("chn")


def usr_id():
    return _uid("usr")


def msg_id():
    return _uid("msg")


def rol_id():
    return _uid("rol")


def att_id():
    return _uid("att")


def aud_id():
    return _uid("aud")


def inv_code(n=12):
    return f"invite-{''.join(random.choices(string.ascii_letters + string.digits, k=n))}"


def share_code(n=12):
    return f"share-{''.join(random.choices(string.ascii_letters + string.digits, k=n))}"


# ═══════════════════════════════════════════════════════════════════════════
#  Auth
# ═══════════════════════════════════════════════════════════════════════════
_bearer = HTTPBearer()


def hash_pw(pw: str) -> str:
    return _bcrypt.hashpw(pw.encode(), _bcrypt.gensalt()).decode()


def verify_pw(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(uid: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    return jwt.encode({"sub": uid, "exp": exp}, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[str]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM]).get("sub")
    except JWTError:
        return None


# ═══════════════════════════════════════════════════════════════════════════
#  ORM Models
# ═══════════════════════════════════════════════════════════════════════════
class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    discriminator: Mapped[str] = mapped_column(String(4), default="0000")
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    avatar_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    banner_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    bio: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    pronouns: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    status: Mapped[str] = mapped_column(String, default="offline")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Server(Base):
    __tablename__ = "servers"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    icon_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    banner_url: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    owner_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ServerMember(Base):
    __tablename__ = "server_members"
    server_id: Mapped[str] = mapped_column(
        String, ForeignKey("servers.id"), primary_key=True, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), primary_key=True, index=True
    )
    nickname: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Ban(Base):
    __tablename__ = "bans"
    server_id: Mapped[str] = mapped_column(
        String, ForeignKey("servers.id"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), primary_key=True
    )
    reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    banned_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Channel(Base):
    __tablename__ = "channels"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    server_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("servers.id"), nullable=True, index=True
    )
    parent_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("channels.id"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    # type: text | voice | category | dm | note | group
    type: Mapped[str] = mapped_column(String)
    topic: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    is_nsfw: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ChannelPermOverwrite(Base):
    __tablename__ = "channel_perm_overwrites"
    channel_id: Mapped[str] = mapped_column(
        String, ForeignKey("channels.id"), primary_key=True
    )
    target_id: Mapped[str] = mapped_column(String, primary_key=True)
    target_type: Mapped[str] = mapped_column(String)  # role | member
    allow: Mapped[int] = mapped_column(BigInteger, default=0)
    deny: Mapped[int] = mapped_column(BigInteger, default=0)


class DMParticipant(Base):
    __tablename__ = "dm_participants"
    channel_id: Mapped[str] = mapped_column(
        String, ForeignKey("channels.id"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), primary_key=True
    )
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False)


class DMRequest(Base):
    __tablename__ = "dm_requests"
    channel_id: Mapped[str] = mapped_column(
        String, ForeignKey("channels.id"), primary_key=True
    )
    requester_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), index=True
    )
    recipient_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), index=True
    )
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class Role(Base):
    __tablename__ = "roles"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    server_id: Mapped[str] = mapped_column(String, ForeignKey("servers.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    color: Mapped[int] = mapped_column(Integer, default=0)
    permissions: Mapped[int] = mapped_column(BigInteger, default=0)
    position: Mapped[int] = mapped_column(Integer, default=0)
    is_mentionable: Mapped[bool] = mapped_column(Boolean, default=True)
    is_hoisted: Mapped[bool] = mapped_column(Boolean, default=False)
    is_everyone: Mapped[bool] = mapped_column(Boolean, default=False)


class MemberRole(Base):
    __tablename__ = "member_roles"
    server_id: Mapped[str] = mapped_column(
        String, ForeignKey("servers.id"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), primary_key=True
    )
    role_id: Mapped[str] = mapped_column(
        String, ForeignKey("roles.id"), primary_key=True
    )


class Message(Base):
    __tablename__ = "messages"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    channel_id: Mapped[str] = mapped_column(
        String, ForeignKey("channels.id"), index=True
    )
    author_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    content: Mapped[str] = mapped_column(Text)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    reply_to_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("messages.id"), nullable=True, index=True
    )
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, index=True
    )


class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    message_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("messages.id"), nullable=True, index=True
    )
    uploader_id: Mapped[Optional[str]] = mapped_column(
        String, ForeignKey("users.id"), nullable=True, index=True
    )
    url: Mapped[str] = mapped_column(String)
    filename: Mapped[str] = mapped_column(String)
    size: Mapped[int] = mapped_column(Integer)
    content_type: Mapped[str] = mapped_column(String)


class Reaction(Base):
    __tablename__ = "reactions"
    message_id: Mapped[str] = mapped_column(
        String, ForeignKey("messages.id"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String, ForeignKey("users.id"), primary_key=True
    )
    emoji: Mapped[str] = mapped_column(String(64), primary_key=True)


class Invite(Base):
    __tablename__ = "invites"
    code: Mapped[str] = mapped_column(String, primary_key=True)
    server_id: Mapped[str] = mapped_column(String, ForeignKey("servers.id"), index=True)
    channel_id: Mapped[str] = mapped_column(String, ForeignKey("channels.id"))
    creator_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    max_uses: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    uses: Mapped[int] = mapped_column(Integer, default=0)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ShareLink(Base):
    __tablename__ = "share_links"
    code: Mapped[str] = mapped_column(String, primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), index=True)
    target_id: Mapped[str] = mapped_column(String, index=True)
    creator_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    server_id: Mapped[str] = mapped_column(String, ForeignKey("servers.id"), index=True)
    actor_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String)
    target_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    reason: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    changes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# ═══════════════════════════════════════════════════════════════════════════
#  Schemas
# ═══════════════════════════════════════════════════════════════════════════
class _ORM(BaseModel):
    model_config = {"from_attributes": True}


class RegisterIn(BaseModel):
    username: str = Field(min_length=2, max_length=32)
    password: str = Field(min_length=6)


class LoginIn(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(_ORM):
    id: str
    username: str
    discriminator: str
    avatar_url: Optional[str]
    banner_url: Optional[str]
    bio: Optional[str]
    pronouns: Optional[str]
    status: str
    server_nickname: Optional[str] = None
    created_at: datetime


class UpdateMeIn(BaseModel):
    username: Optional[str] = Field(None, min_length=2, max_length=32)
    bio: Optional[str] = Field(None, max_length=256)
    pronouns: Optional[str] = Field(None, max_length=20)
    avatar_url: Optional[str] = None
    banner_url: Optional[str] = None


class PresenceIn(BaseModel):
    status: str


class CreateServerIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class UpdateServerIn(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    icon_url: Optional[str] = None
    banner_url: Optional[str] = None


class ServerOut(_ORM):
    id: str
    name: str
    icon_url: Optional[str]
    banner_url: Optional[str]
    owner_id: str
    created_at: datetime


class MemberOut(_ORM):
    server_id: str
    user_id: str
    nickname: Optional[str]
    joined_at: datetime
    role_ids: list[str] = []
    top_role_id: Optional[str] = None
    top_role_name: Optional[str] = None
    top_role_color: Optional[int] = None
    top_role_position: int = 0
    user: Optional[UserOut] = None


class UpdateMemberIn(BaseModel):
    nickname: Optional[str] = Field(None, max_length=32)


class BanIn(BaseModel):
    reason: Optional[str] = None


class BanOut(_ORM):
    server_id: str
    user_id: str
    reason: Optional[str]
    banned_at: datetime


class CreateChannelIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: str = "text"
    parent_id: Optional[str] = None
    topic: Optional[str] = Field(None, max_length=1024)
    position: int = 0
    is_nsfw: bool = False


class UpdateChannelIn(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    topic: Optional[str] = Field(None, max_length=1024)
    position: Optional[int] = None
    parent_id: Optional[str] = None
    is_nsfw: Optional[bool] = None


class ChannelOut(_ORM):
    id: str
    server_id: Optional[str]
    parent_id: Optional[str]
    name: str
    type: str
    topic: Optional[str]
    position: int
    is_nsfw: bool
    created_at: datetime


class DMChannelOut(ChannelOut):
    other_user: Optional[UserOut] = None
    relationship_status: Optional[str] = None
    relationship_direction: Optional[str] = None
    can_open: bool = True
    participant_count: int = 0


class DMOverviewOut(BaseModel):
    note: Optional[DMChannelOut] = None
    friends: list[DMChannelOut] = []
    groups: list[DMChannelOut] = []
    pending: list[DMChannelOut] = []
    requests: list[DMChannelOut] = []
    request_count: int = 0


class OverwriteIn(BaseModel):
    target_type: str
    allow: int = 0
    deny: int = 0


class OverwriteOut(_ORM):
    channel_id: str
    target_id: str
    target_type: str
    allow: int
    deny: int


class PositionUpdate(BaseModel):
    id: str
    position: int
    parent_id: Optional[str] = None


class CreateRoleIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: int = 0
    permissions: int = 0
    is_mentionable: bool = True
    is_hoisted: bool = False


class UpdateRoleIn(BaseModel):
    name: Optional[str] = None
    color: Optional[int] = None
    permissions: Optional[int] = None
    is_mentionable: Optional[bool] = None
    is_hoisted: Optional[bool] = None
    position: Optional[int] = None


class RoleOut(_ORM):
    id: str
    server_id: str
    name: str
    color: int
    permissions: int
    position: int
    is_mentionable: bool
    is_hoisted: bool
    is_everyone: bool


class RolePosIn(BaseModel):
    id: str
    position: int


class SendMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    attachments: list[str] = []
    reply_to_id: Optional[str] = None


class EditMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class AttachOut(_ORM):
    id: str
    url: str
    filename: str
    size: int
    content_type: str


class ReactionOut(BaseModel):
    emoji: str
    count: int
    me: bool


class MessageOut(_ORM):
    id: str
    channel_id: str
    server_id: Optional[str] = None
    author_id: str
    content: str
    is_pinned: bool
    reply_to_id: Optional[str] = None
    edited_at: Optional[datetime]
    created_at: datetime
    author: Optional[UserOut] = None
    attachments: list[AttachOut] = []
    reactions: list[ReactionOut] = []
    reply_to: Optional[dict] = None


class CreateInviteIn(BaseModel):
    channel_id: str
    max_uses: Optional[int] = None
    max_age: Optional[int] = None


class InviteOut(_ORM):
    code: str
    server_id: str
    channel_id: str
    creator_id: str
    max_uses: Optional[int]
    uses: int
    expires_at: Optional[datetime]
    created_at: datetime


class ShareLinkOut(_ORM):
    code: str
    kind: str
    target_id: str
    creator_id: str
    created_at: datetime


class OpenDMIn(BaseModel):
    recipient_id: str


class CreateGroupIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    member_ids: list[str] = Field(default_factory=list, min_length=1, max_length=9)


class AuditOut(_ORM):
    id: str
    server_id: str
    actor_id: str
    action: str
    target_id: Optional[str]
    reason: Optional[str]
    changes: Optional[str]
    created_at: datetime


class SearchOut(BaseModel):
    total: int
    messages: list[MessageOut]


class EffectivePermsOut(BaseModel):
    permissions: int


# ═══════════════════════════════════════════════════════════════════════════
#  Permissions
# ═══════════════════════════════════════════════════════════════════════════
class Perm(IntFlag):
    READ_MESSAGES = 1 << 0
    SEND_MESSAGES = 1 << 1
    MANAGE_MESSAGES = 1 << 2
    EMBED_LINKS = 1 << 3
    ATTACH_FILES = 1 << 4
    ADD_REACTIONS = 1 << 5
    MANAGE_CHANNELS = 1 << 6
    MANAGE_ROLES = 1 << 7
    MANAGE_SERVER = 1 << 8
    KICK_MEMBERS = 1 << 9
    BAN_MEMBERS = 1 << 10
    CREATE_INVITES = 1 << 11
    VIEW_AUDIT_LOG = 1 << 12
    ADMINISTRATOR = 1 << 31


ALL_PERMS = (1 << 32) - 1
DEFAULT_PERMS = int(
    Perm.READ_MESSAGES
    | Perm.SEND_MESSAGES
    | Perm.EMBED_LINKS
    | Perm.ATTACH_FILES
    | Perm.ADD_REACTIONS
    | Perm.CREATE_INVITES
)


def _has(bits: int, perm: Perm) -> bool:
    return bool(bits & Perm.ADMINISTRATOR) or bool(bits & perm)


def _public_status(status: str) -> str:
    return status


async def _get_dm_request(db: AsyncSession, channel_id: str) -> Optional[DMRequest]:
    return await db.get(DMRequest, channel_id)


async def _dm_access_state(
    db: AsyncSession, channel_id: str, uid: str
) -> tuple[Optional[DMRequest], bool]:
    req = await _get_dm_request(db, channel_id)
    if not req:
        return None, True
    if req.status == "accepted":
        return req, True
    if uid == req.requester_id:
        return req, True
    return req, False


async def _visible_dm_user_ids(db: AsyncSession, channel_id: str) -> list[str]:
    req = await _get_dm_request(db, channel_id)
    if req and req.status in ("pending", "rejected"):
        return [req.requester_id]

    res = await db.execute(
        select(DMParticipant.user_id).where(DMParticipant.channel_id == channel_id)
    )
    return [uid for (uid,) in res.all()]


async def _dm_peer_ids(db: AsyncSession, uid: str) -> set[str]:
    res = await db.execute(
        select(DMParticipant.channel_id).where(DMParticipant.user_id == uid)
    )
    channel_ids = [cid for (cid,) in res.all()]
    peers: set[str] = set()

    for cid in channel_ids:
        res = await db.execute(
            select(DMParticipant.user_id).where(
                DMParticipant.channel_id == cid, DMParticipant.user_id != uid
            )
        )
        peers.update(other_uid for (other_uid,) in res.all())
    return peers


async def _friend_user_ids(db: AsyncSession, uid: str) -> set[str]:
    res = await db.execute(
        select(Channel)
        .join(DMParticipant, DMParticipant.channel_id == Channel.id)
        .where(DMParticipant.user_id == uid, Channel.type == "dm")
    )
    friends: set[str] = set()

    for ch in res.scalars().all():
        req = await _get_dm_request(db, ch.id)
        if req and req.status != "accepted":
            continue
        other_res = await db.execute(
            select(DMParticipant.user_id).where(
                DMParticipant.channel_id == ch.id,
                DMParticipant.user_id != uid,
            )
        )
        friends.update(other_uid for (other_uid,) in other_res.all())
    return friends


async def _broadcast_presence(db: AsyncSession, uid: str, status: str):
    public_status = _public_status(status)
    ev = {"op": "PRESENCE_UPDATE", "data": {"user_id": uid, "status": public_status}}

    res = await db.execute(
        select(ServerMember.server_id).where(ServerMember.user_id == uid)
    )
    for (sid,) in res.all():
        await gw.to_server(sid, ev)

    for peer_uid in await _dm_peer_ids(db, uid):
        await gw.to_user(peer_uid, ev)


def _system_message_text(kind: str, text: str) -> str:
    return f"[[system:{kind}]] {text}"


async def _create_system_notice(
    db: AsyncSession, channel_id: str, actor_id: str, kind: str, text: str
) -> Message:
    m = Message(
        id=msg_id(),
        channel_id=channel_id,
        author_id=actor_id,
        content=_system_message_text(kind, text),
    )
    db.add(m)
    await db.flush()
    return m


async def _get_or_create_share_link(
    db: AsyncSession, kind: str, target_id: str, creator_id: str
) -> ShareLink:
    res = await db.execute(
        select(ShareLink).where(ShareLink.kind == kind, ShareLink.target_id == target_id)
    )
    share = res.scalars().first()
    if share:
        return share

    share = ShareLink(
        code=share_code(),
        kind=kind,
        target_id=target_id,
        creator_id=creator_id,
    )
    db.add(share)
    await db.commit()
    await db.refresh(share)
    return share


async def _build_dm_channel_out(
    db: AsyncSession, ch: Channel, viewer_id: str
) -> DMChannelOut:
    ch_dict = {
        "id": ch.id,
        "server_id": ch.server_id,
        "parent_id": ch.parent_id,
        "name": ch.name,
        "type": ch.type,
        "topic": ch.topic,
        "position": ch.position,
        "is_nsfw": ch.is_nsfw,
        "created_at": ch.created_at,
        "relationship_status": None,
        "relationship_direction": None,
        "can_open": True,
        "participant_count": 0,
    }

    count_res = await db.execute(
        select(func.count()).select_from(DMParticipant).where(DMParticipant.channel_id == ch.id)
    )
    ch_dict["participant_count"] = count_res.scalar_one()

    if ch.type == "dm":
        other_res = await db.execute(
            select(User)
            .join(DMParticipant, DMParticipant.user_id == User.id)
            .where(
                DMParticipant.channel_id == ch.id,
                DMParticipant.user_id != viewer_id,
            )
        )
        other_user = other_res.scalar_one_or_none()
        if other_user:
            ch_dict["other_user"] = {
                "id": other_user.id,
                "username": other_user.username,
                "discriminator": other_user.discriminator,
                "avatar_url": other_user.avatar_url,
                "banner_url": other_user.banner_url,
                "bio": other_user.bio,
                "pronouns": other_user.pronouns,
                "status": _public_status(other_user.status),
                "created_at": other_user.created_at,
                "server_nickname": None,
            }

        req = await _get_dm_request(db, ch.id)
        if req:
            ch_dict["relationship_status"] = req.status
            if viewer_id == req.requester_id:
                ch_dict["relationship_direction"] = "outgoing"
            elif viewer_id == req.recipient_id:
                ch_dict["relationship_direction"] = "incoming"
            _, can_open = await _dm_access_state(db, ch.id, viewer_id)
            ch_dict["can_open"] = can_open
        else:
            ch_dict["relationship_status"] = "accepted"
    elif ch.type == "group":
        ch_dict["relationship_status"] = "accepted"
        ch_dict["relationship_direction"] = "group"

    return DMChannelOut.model_validate(ch_dict)


async def _build_member_out(
    db: AsyncSession, member: ServerMember, viewer_id: str
) -> MemberOut:
    out = MemberOut.model_validate(member)
    user = await db.get(User, member.user_id)
    if user:
        out.user = UserOut.model_validate(
            {
                **UserOut.model_validate(user).model_dump(),
                "server_nickname": member.nickname,
            }
        )

    res = await db.execute(
        select(Role)
        .join(MemberRole, MemberRole.role_id == Role.id)
        .where(
            MemberRole.server_id == member.server_id,
            MemberRole.user_id == member.user_id,
            Role.server_id == member.server_id,
        )
        .order_by(Role.position.desc())
    )
    roles = res.scalars().all()
    out.role_ids = [r.id for r in roles]
    top_role = roles[0] if roles else None
    out.top_role_id = top_role.id if top_role else None
    out.top_role_name = top_role.name if top_role else None
    out.top_role_color = top_role.color if top_role else None
    out.top_role_position = top_role.position if top_role else 0
    return out


async def _assert_member(db: AsyncSession, server_id: str, uid: str):
    m = await db.get(ServerMember, (server_id, uid))
    if not m:
        raise HTTPException(403, "Not a member of this server")
    return m


async def _compute_perms(
    db: AsyncSession, uid: str, server_id: str, channel_id: Optional[str] = None
) -> int:
    srv = await db.get(Server, server_id)
    if not srv:
        return 0

    if srv.owner_id == uid:
        return ALL_PERMS

    member = await db.get(ServerMember, (server_id, uid))
    if not member:
        return 0

    res = await db.execute(
        select(MemberRole.role_id).where(
            MemberRole.server_id == server_id,
            MemberRole.user_id == uid,
        )
    )
    role_ids = {server_id} | {rid for (rid,) in res.all()}

    res = await db.execute(
        select(Role).where(Role.server_id == server_id, Role.id.in_(role_ids))
    )
    roles = res.scalars().all()

    base = 0
    for r in roles:
        base |= int(r.permissions)

    if base & Perm.ADMINISTRATOR:
        return ALL_PERMS

    if not channel_id:
        return base

    res = await db.execute(
        select(ChannelPermOverwrite).where(ChannelPermOverwrite.channel_id == channel_id)
    )
    overwrites = res.scalars().all()

    role_ow = {o.target_id: o for o in overwrites if o.target_type == "role"}
    member_ow = {o.target_id: o for o in overwrites if o.target_type == "member"}

    if server_id in role_ow:
        o = role_ow[server_id]
        base = (base & ~o.deny) | o.allow

    for r in sorted(
        [r for r in roles if r.id in role_ow and not r.is_everyone],
        key=lambda x: x.position,
    ):
        o = role_ow[r.id]
        base = (base & ~o.deny) | o.allow

    if uid in member_ow:
        o = member_ow[uid]
        base = (base & ~o.deny) | o.allow

    return int(base)


async def _require(
    db: AsyncSession,
    uid: str,
    server_id: str,
    perm: Perm,
    channel_id: Optional[str] = None,
):
    await _assert_member(db, server_id, uid)
    bits = await _compute_perms(db, uid, server_id, channel_id)
    if not _has(bits, perm):
        raise HTTPException(403, "Missing permission")
    return bits


# ═══════════════════════════════════════════════════════════════════════════
#  Shared helpers
# ═══════════════════════════════════════════════════════════════════════════
def _msg_dict(m: Message, author: Optional[User] = None) -> dict:
    return {
        "id": m.id,
        "channel_id": m.channel_id,
        "author_id": m.author_id,
        "content": m.content,
        "is_pinned": m.is_pinned,
        "reply_to_id": m.reply_to_id,
        "edited_at": m.edited_at.isoformat() if m.edited_at else None,
        "created_at": m.created_at.isoformat(),
        "author": {
            "id": author.id,
            "username": author.username,
            "avatar_url": author.avatar_url,
            "discriminator": author.discriminator,
            "status": author.status,
            "created_at": author.created_at.isoformat(),
            "banner_url": author.banner_url,
            "bio": author.bio,
        }
        if author
        else None,
        "attachments": [],
        "reactions": [],
        "reply_to": None,
    }


async def _build_msg(db: AsyncSession, m: Message, me_id: str) -> MessageOut:
    author = await db.get(User, m.author_id)
    ch = await db.get(Channel, m.channel_id)
    author_nickname = None
    if ch and ch.server_id and author:
        author_member = await db.get(ServerMember, (ch.server_id, author.id))
        if author_member:
            author_nickname = author_member.nickname

    res = await db.execute(select(Attachment).where(Attachment.message_id == m.id))
    atts = res.scalars().all()

    res = await db.execute(
        select(Reaction.emoji, func.count())
        .where(Reaction.message_id == m.id)
        .group_by(Reaction.emoji)
    )
    reactions = []
    for emoji, count in res.all():
        me_r = await db.get(Reaction, (m.id, me_id, emoji))
        reactions.append(ReactionOut(emoji=emoji, count=count, me=bool(me_r)))

    reply_to_data = None
    if m.reply_to_id:
        reply_msg = await db.get(Message, m.reply_to_id)
        if reply_msg:
            reply_author = await db.get(User, reply_msg.author_id)
            reply_display = reply_author.username if reply_author else "Unknown"
            if ch and ch.server_id and reply_author:
                reply_member = await db.get(ServerMember, (ch.server_id, reply_author.id))
                if reply_member and reply_member.nickname:
                    reply_display = reply_member.nickname
            reply_to_data = {
                "id": reply_msg.id,
                "content": reply_msg.content[:100],
                "author_username": reply_author.username if reply_author else "Unknown",
                "author_id": reply_author.id if reply_author else None,
                "author_display_name": reply_display,
            }

    return MessageOut(
        id=m.id,
        channel_id=m.channel_id,
        server_id=ch.server_id if ch else None,
        author_id=m.author_id,
        content=m.content,
        is_pinned=m.is_pinned,
        reply_to_id=m.reply_to_id,
        edited_at=m.edited_at,
        created_at=m.created_at,
        author=UserOut.model_validate(
            {
                **UserOut.model_validate(author).model_dump(),
                "server_nickname": author_nickname,
            }
        )
        if author
        else None,
        attachments=[AttachOut.model_validate(a) for a in atts],
        reactions=reactions,
        reply_to=reply_to_data,
    )


async def _get_or_404(db: AsyncSession, model, pk, detail="Not found"):
    obj = await db.get(model, pk)
    if not obj:
        raise HTTPException(404, detail)
    return obj


async def _can_read(db: AsyncSession, uid: str, ch: Channel):
    if ch.server_id:
        await _assert_member(db, ch.server_id, uid)
        bits = await _compute_perms(db, uid, ch.server_id, ch.id)
        if not _has(bits, Perm.READ_MESSAGES):
            raise HTTPException(403, "Missing READ_MESSAGES")
    else:
        if not await db.get(DMParticipant, (ch.id, uid)):
            raise HTTPException(403, "Not a participant of this DM")
        req, can_open = await _dm_access_state(db, ch.id, uid)
        if req and not can_open:
            raise HTTPException(403, "DM request not accepted yet")


async def _require_message_channel_access(
    db: AsyncSession, uid: str, channel_id: str, message_id: str
) -> tuple[Channel, Message]:
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    await _can_read(db, uid, ch)
    m = await _get_or_404(db, Message, message_id, "Message not found")
    if m.channel_id != channel_id:
        raise HTTPException(404, "Message not found in this channel")
    return ch, m


async def _audit(
    db: AsyncSession,
    server_id: str,
    actor_id: str,
    action: str,
    target_id: Optional[str] = None,
    reason: Optional[str] = None,
    changes: Optional[dict] = None,
):
    db.add(
        AuditLog(
            id=aud_id(),
            server_id=server_id,
            actor_id=actor_id,
            action=action,
            target_id=target_id,
            reason=reason,
            changes=json.dumps(changes) if changes else None,
        )
    )


async def _dep_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    uid = decode_token(creds.credentials)
    if not uid:
        raise HTTPException(401, "Invalid or expired token")
    u = await db.get(User, uid)
    if not u:
        raise HTTPException(401, "User not found")
    return u


async def _visible_server_channels(
    db: AsyncSession, uid: str, server_id: str
) -> list[Channel]:
    await _assert_member(db, server_id, uid)

    res = await db.execute(
        select(Channel).where(Channel.server_id == server_id).order_by(Channel.position)
    )
    channels = res.scalars().all()

    visible_ids: set[str] = set()
    categories = [c for c in channels if c.type == "category"]
    non_categories = [c for c in channels if c.type != "category"]

    for ch in non_categories:
        bits = await _compute_perms(db, uid, server_id, ch.id)
        if _has(bits, Perm.READ_MESSAGES):
            visible_ids.add(ch.id)
            if ch.parent_id:
                visible_ids.add(ch.parent_id)

    for cat in categories:
        bits = await _compute_perms(db, uid, server_id, cat.id)
        if _has(bits, Perm.READ_MESSAGES):
            visible_ids.add(cat.id)

    return [c for c in channels if c.id in visible_ids]


async def _validate_parent(
    db: AsyncSession,
    server_id: str,
    parent_id: Optional[str],
):
    if parent_id is None:
        return None
    parent = await _get_or_404(db, Channel, parent_id, "Parent channel not found")
    if parent.server_id != server_id:
        raise HTTPException(422, "parent_id must belong to the same server")
    if parent.type != "category":
        raise HTTPException(422, "parent_id must reference a category")
    return parent


def _attachment_disk_path(url: str) -> Optional[str]:
    if not url.startswith("/uploads/"):
        return None
    filename = url.split("/uploads/", 1)[1]
    return os.path.join(UPLOAD_DIR, filename)


def _remove_file_safe(path: Optional[str]):
    if not path:
        return
    try:
        if os.path.isfile(path):
            os.remove(path)
    except Exception:
        pass


async def _delete_message_related(db: AsyncSession, message_id: str):
    await db.execute(update(Message).where(Message.reply_to_id == message_id).values(reply_to_id=None))

    res = await db.execute(select(Attachment).where(Attachment.message_id == message_id))
    for a in res.scalars().all():
        _remove_file_safe(_attachment_disk_path(a.url))
        await db.delete(a)

    await db.execute(delete(Reaction).where(Reaction.message_id == message_id))

    m = await db.get(Message, message_id)
    if m:
        await db.delete(m)


async def _delete_channel_related(db: AsyncSession, channel_id: str):
    res = await db.execute(select(Message.id).where(Message.channel_id == channel_id))
    mids = [mid for (mid,) in res.all()]
    for mid in mids:
        await _delete_message_related(db, mid)

    req = await db.get(DMRequest, channel_id)
    if req:
        await db.delete(req)

    await db.execute(delete(DMParticipant).where(DMParticipant.channel_id == channel_id))
    await db.execute(
        delete(ChannelPermOverwrite).where(ChannelPermOverwrite.channel_id == channel_id)
    )
    await db.execute(delete(Invite).where(Invite.channel_id == channel_id))
    await db.execute(
        delete(ShareLink).where(
            ShareLink.kind == "group",
            ShareLink.target_id == channel_id,
        )
    )

    ch = await db.get(Channel, channel_id)
    if ch:
        await db.delete(ch)


async def _delete_role_related(db: AsyncSession, role_id: str):
    await db.execute(delete(MemberRole).where(MemberRole.role_id == role_id))
    await db.execute(
        delete(ChannelPermOverwrite).where(
            ChannelPermOverwrite.target_id == role_id,
            ChannelPermOverwrite.target_type == "role",
        )
    )
    role = await db.get(Role, role_id)
    if role:
        await db.delete(role)


async def _remove_member_from_server(db: AsyncSession, server_id: str, user_id: str):
    await db.execute(
        delete(MemberRole).where(
            MemberRole.server_id == server_id,
            MemberRole.user_id == user_id,
        )
    )
    m = await db.get(ServerMember, (server_id, user_id))
    if m:
        await db.delete(m)

    await db.execute(
        delete(ChannelPermOverwrite).where(
            ChannelPermOverwrite.target_id == user_id,
            ChannelPermOverwrite.target_type == "member",
        )
    )


# ═══════════════════════════════════════════════════════════════════════════
#  WebSocket Gateway
# ═══════════════════════════════════════════════════════════════════════════
class GatewayManager:
    def __init__(self):
        self._sockets: dict[str, list[WebSocket]] = {}
        self._srv_users: dict[str, set[str]] = {}
        self._typing: dict[str, dict[str, float]] = {}

    def _reg(self, uid: str, sids: list[str], ws: WebSocket):
        self._sockets.setdefault(uid, []).append(ws)
        for sid in sids:
            self._srv_users.setdefault(sid, set()).add(uid)

    def _unreg(self, uid: str, sids: list[str], ws: WebSocket):
        lst = self._sockets.get(uid, [])
        if ws in lst:
            lst.remove(ws)
        if not lst:
            self._sockets.pop(uid, None)
        for sid in sids:
            self._srv_users.get(sid, set()).discard(uid)

    def is_connected(self, uid: str) -> bool:
        return bool(self._sockets.get(uid))

    def add_user_to_server(self, uid: str, server_id: str):
        if self.is_connected(uid):
            self._srv_users.setdefault(server_id, set()).add(uid)

    def remove_user_from_server(self, uid: str, server_id: str):
        self._srv_users.get(server_id, set()).discard(uid)

    def remove_server(self, server_id: str):
        self._srv_users.pop(server_id, None)

    async def to_user(self, uid: str, payload: dict):
        for ws in list(self._sockets.get(uid, [])):
            try:
                await ws.send_json(payload)
            except Exception:
                pass

    async def to_server(self, server_id: str, payload: dict):
        for uid in list(self._srv_users.get(server_id, set())):
            await self.to_user(uid, payload)

    async def to_channel(self, db: AsyncSession, channel: Channel, payload: dict):
        if channel.server_id:
            res = await db.execute(
                select(ServerMember.user_id).where(ServerMember.server_id == channel.server_id)
            )
            server_members = {uid for (uid,) in res.all()}

            # keep registry in sync lazily
            connected = self._srv_users.setdefault(channel.server_id, set())
            for uid in list(connected):
                if uid not in server_members:
                    connected.discard(uid)

            for uid in server_members:
                if self.is_connected(uid):
                    connected.add(uid)
                    await self.to_user(uid, payload)
        else:
            for uid in await _visible_dm_user_ids(db, channel.id):
                await self.to_user(uid, payload)

    def set_typing(self, uid: str, channel_id: str):
        self._typing.setdefault(uid, {})[channel_id] = time.time()

    def get_typers(self, channel_id: str, exclude_uid: str) -> list[str]:
        now = time.time()
        return [
            uid
            for uid, channels in self._typing.items()
            if uid != exclude_uid and channels.get(channel_id, 0) > now - 8
        ]

    async def _recv_text(self, ws: WebSocket) -> str:
        try:
            return await ws.receive_text()
        except RuntimeError as exc:
            # Starlette may raise RuntimeError here when the socket is already closing,
            # even though this should be treated like a normal disconnect.
            if "WebSocket is not connected" in str(exc):
                raise WebSocketDisconnect(code=1006) from exc
            raise

    async def handle(self, ws: WebSocket, token: Optional[str]):
        await ws.accept()
        await ws.send_json({"op": "HELLO", "data": {"heartbeat_interval": HEARTBEAT_MS}})

        uid = decode_token(token) if token else None
        if not uid:
            try:
                raw = await self._recv_text(ws)
                msg = json.loads(raw)
                if msg.get("op") == "IDENTIFY":
                    uid = decode_token((msg.get("data") or {}).get("token", ""))
            except Exception:
                pass

        if not uid:
            await ws.close(code=4004)
            return

        sids: list[str] = []

        async with AsyncSessionLocal() as db:
            user = await db.get(User, uid)
            if not user:
                await ws.close(code=4004)
                return

            res = await db.execute(
                select(Server.id)
                .join(ServerMember, ServerMember.server_id == Server.id)
                .where(ServerMember.user_id == uid)
            )
            sids = [sid for (sid,) in res.all()]

            if user.status not in ("idle", "dnd", "invisible"):
                user.status = "online"
                await db.commit()

            actual_status = user.status
        self._reg(uid, sids, ws)

        async with AsyncSessionLocal() as db:
            await _broadcast_presence(db, uid, actual_status)

        await ws.send_json(
            {
                "op": "READY",
                "data": {
                    "user": {
                        "id": user.id,
                        "username": user.username,
                        "discriminator": user.discriminator,
                        "avatar_url": user.avatar_url,
                        "status": actual_status,
                    },
                    "servers": [],
                },
            }
        )

        try:
            while True:
                raw = await self._recv_text(ws)
                try:
                    msg = json.loads(raw)
                except Exception:
                    continue

                op = msg.get("op", "")
                data = msg.get("data") or {}

                if op == "HEARTBEAT":
                    await ws.send_json({"op": "HEARTBEAT_ACK"})
                    continue

                if op == "UPDATE_PRESENCE":
                    st = data.get("status", "")
                    if st not in ("online", "idle", "dnd", "invisible"):
                        await ws.send_json(
                            {
                                "op": "ERROR",
                                "data": {
                                    "message": "status must be online | idle | dnd | invisible"
                                },
                            }
                        )
                        continue

                    async with AsyncSessionLocal() as db:
                        u = await db.get(User, uid)
                        if u:
                            u.status = st
                            await db.commit()
                        await _broadcast_presence(db, uid, st)

                    await self.to_user(
                        uid,
                        {"op": "USER_UPDATE", "data": {"id": uid, "status": st}},
                    )
                    continue

                if op == "START_TYPING":
                    channel_id = data.get("channel_id", "")
                    if not channel_id:
                        continue

                    async with AsyncSessionLocal() as db:
                        ch = await db.get(Channel, channel_id)
                        if not ch:
                            continue

                        try:
                            await _can_read(db, uid, ch)
                        except HTTPException:
                            continue

                        self.set_typing(uid, channel_id)
                        author = await db.get(User, uid)

                        ev = {
                            "op": "TYPING_START",
                            "data": {
                                "channel_id": channel_id,
                                "user_id": uid,
                                "username": author.username if author else uid,
                                "timestamp": time.time(),
                            },
                        }
                        await self.to_channel(db, ch, ev)
                    continue

                if op == "SEND_MESSAGE":
                    channel_id = data.get("channel_id", "")
                    content = (data.get("content") or "").strip()
                    attachments = data.get("attachments") or []
                    reply_to_id = data.get("reply_to_id")

                    if not channel_id or not content:
                        await ws.send_json(
                            {
                                "op": "ERROR",
                                "data": {"message": "channel_id and content required"},
                            }
                        )
                        continue

                    if len(content) > 4000:
                        await ws.send_json(
                            {"op": "ERROR", "data": {"message": "content too long"}}
                        )
                        continue

                    async with AsyncSessionLocal() as db:
                        ch = await db.get(Channel, channel_id)
                        if not ch:
                            await ws.send_json(
                                {"op": "ERROR", "data": {"message": "Channel not found"}}
                            )
                            continue

                        try:
                            await _can_read(db, uid, ch)
                        except HTTPException as e:
                            await ws.send_json({"op": "ERROR", "data": {"message": e.detail}})
                            continue

                        if ch.server_id:
                            bits = await _compute_perms(db, uid, ch.server_id, channel_id)
                            if not _has(bits, Perm.SEND_MESSAGES):
                                await ws.send_json(
                                    {
                                        "op": "ERROR",
                                        "data": {"message": "Missing SEND_MESSAGES"},
                                    }
                                )
                                continue

                        if reply_to_id:
                            reply_msg = await db.get(Message, reply_to_id)
                            if not reply_msg or reply_msg.channel_id != channel_id:
                                reply_to_id = None

                        m = Message(
                            id=msg_id(),
                            channel_id=channel_id,
                            author_id=uid,
                            content=content,
                            reply_to_id=reply_to_id,
                        )
                        db.add(m)
                        await db.flush()

                        for aid in attachments:
                            a = await db.get(Attachment, aid)
                            if not a:
                                continue
                            if a.message_id is not None:
                                continue
                            if a.uploader_id and a.uploader_id != uid:
                                continue
                            a.message_id = m.id

                        await db.commit()
                        out = await _build_msg(db, m, uid)
                        payload = {"op": "MESSAGE_CREATE", "data": out.model_dump(mode="json")}
                        await self.to_channel(db, ch, payload)
                        await ws.send_json({"op": "MESSAGE_ACK", "data": out.model_dump(mode="json")})
                    continue

                if op == "EDIT_MESSAGE":
                    mid = data.get("message_id", "")
                    content = (data.get("content") or "").strip()

                    if not mid or not content:
                        await ws.send_json(
                            {
                                "op": "ERROR",
                                "data": {"message": "message_id and content required"},
                            }
                        )
                        continue

                    async with AsyncSessionLocal() as db:
                        m = await db.get(Message, mid)
                        if not m or m.author_id != uid:
                            await ws.send_json(
                                {
                                    "op": "ERROR",
                                    "data": {"message": "Message not found or not yours"},
                                }
                            )
                            continue

                        ch = await db.get(Channel, m.channel_id)
                        if not ch:
                            continue

                        try:
                            await _can_read(db, uid, ch)
                        except HTTPException:
                            continue

                        m.content = content
                        m.edited_at = datetime.utcnow()
                        await db.commit()
                        out = await _build_msg(db, m, uid)
                        await self.to_channel(
                            db,
                            ch,
                            {"op": "MESSAGE_UPDATE", "data": out.model_dump(mode="json")},
                        )
                    continue

                if op == "DELETE_MESSAGE":
                    mid = data.get("message_id", "")
                    if not mid:
                        continue

                    async with AsyncSessionLocal() as db:
                        m = await db.get(Message, mid)
                        if not m:
                            continue

                        ch = await db.get(Channel, m.channel_id)
                        if not ch:
                            continue

                        try:
                            await _can_read(db, uid, ch)
                        except HTTPException:
                            continue

                        can_manage = False
                        if ch.server_id:
                            bits = await _compute_perms(db, uid, ch.server_id, m.channel_id)
                            can_manage = _has(bits, Perm.MANAGE_MESSAGES)

                        if m.author_id != uid and not can_manage:
                            await ws.send_json(
                                {"op": "ERROR", "data": {"message": "Cannot delete"}}
                            )
                            continue

                        cid = m.channel_id
                        await _delete_message_related(db, mid)
                        await db.commit()
                        await self.to_channel(
                            db,
                            ch,
                            {
                                "op": "MESSAGE_DELETE",
                                "data": {"message_id": mid, "channel_id": cid},
                            },
                        )
                    continue

                if op == "ADD_REACTION":
                    mid = data.get("message_id", "")
                    emoji = data.get("emoji", "")
                    if not mid or not emoji:
                        continue

                    async with AsyncSessionLocal() as db:
                        m = await db.get(Message, mid)
                        if not m:
                            continue
                        ch = await db.get(Channel, m.channel_id)
                        if not ch:
                            continue

                        try:
                            await _can_read(db, uid, ch)
                        except HTTPException:
                            continue

                        if ch.server_id:
                            bits = await _compute_perms(db, uid, ch.server_id, ch.id)
                            if not _has(bits, Perm.ADD_REACTIONS):
                                await ws.send_json(
                                    {"op": "ERROR", "data": {"message": "Missing ADD_REACTIONS"}}
                                )
                                continue

                        if not await db.get(Reaction, (mid, uid, emoji)):
                            db.add(Reaction(message_id=mid, user_id=uid, emoji=emoji))
                            await db.commit()

                        await self.to_channel(
                            db,
                            ch,
                            {
                                "op": "REACTION_ADD",
                                "data": {
                                    "message_id": mid,
                                    "channel_id": m.channel_id,
                                    "user_id": uid,
                                    "emoji": emoji,
                                },
                            },
                        )
                    continue

                if op == "REMOVE_REACTION":
                    mid = data.get("message_id", "")
                    emoji = data.get("emoji", "")
                    if not mid or not emoji:
                        continue

                    async with AsyncSessionLocal() as db:
                        m = await db.get(Message, mid)
                        if not m:
                            continue
                        ch = await db.get(Channel, m.channel_id)
                        if not ch:
                            continue

                        try:
                            await _can_read(db, uid, ch)
                        except HTTPException:
                            continue

                        r = await db.get(Reaction, (mid, uid, emoji))
                        if r:
                            await db.delete(r)
                            await db.commit()

                        await self.to_channel(
                            db,
                            ch,
                            {
                                "op": "REACTION_REMOVE",
                                "data": {
                                    "message_id": mid,
                                    "channel_id": m.channel_id,
                                    "user_id": uid,
                                    "emoji": emoji,
                                },
                            },
                        )
                    continue

                if op == "REQUEST_MEMBERS":
                    sid_ = data.get("server_id", "")
                    if not sid_:
                        continue

                    async with AsyncSessionLocal() as db:
                        if not await db.get(ServerMember, (sid_, uid)):
                            await ws.send_json(
                                {"op": "ERROR", "data": {"message": "Not a member"}}
                            )
                            continue

                        self.add_user_to_server(uid, sid_)

                        res = await db.execute(
                            select(User)
                            .join(ServerMember, ServerMember.user_id == User.id)
                            .where(ServerMember.server_id == sid_)
                        )
                        users = res.scalars().all()

                        members = [
                            {
                                "id": u.id,
                                "username": u.username,
                                "avatar_url": u.avatar_url,
                                "status": _public_status(u.status),
                            }
                            for u in users
                        ]

                    await ws.send_json(
                        {
                            "op": "GUILD_MEMBERS",
                            "data": {"server_id": sid_, "members": members},
                        }
                    )
                    continue

                await ws.send_json(
                    {"op": "ERROR", "data": {"message": f"Unknown op: {op}"}}
                )

        except WebSocketDisconnect:
            pass
        finally:
            self._unreg(uid, sids, ws)
            self._typing.pop(uid, None)

            if not self._sockets.get(uid):
                async with AsyncSessionLocal() as db:
                    u = await db.get(User, uid)
                    if u:
                        u.status = "offline"
                        await db.commit()
                    await _broadcast_presence(db, uid, "offline")


gw = GatewayManager()
