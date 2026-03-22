from . import core as _core

globals().update(
    {
        name: value
        for name, value in vars(_core).items()
        if not name.startswith("__")
    }
)



# ═══════════════════════════════════════════════════════════════════════════
#  FastAPI app
# ═══════════════════════════════════════════════════════════════════════════
@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        migrations = [
            "ALTER TABLE messages ADD COLUMN reply_to_id VARCHAR",
            "ALTER TABLE attachments ADD COLUMN uploader_id VARCHAR",
            "ALTER TABLE servers ADD COLUMN banner_url VARCHAR",
            "ALTER TABLE users ADD COLUMN banner_url VARCHAR",
            "ALTER TABLE users ADD COLUMN bio VARCHAR(256)",
            "ALTER TABLE users ADD COLUMN pronouns VARCHAR(20)",
            "ALTER TABLE dm_participants ADD COLUMN is_hidden BOOLEAN DEFAULT 0",
        ]
        for stmt in migrations:
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass

    yield


app = FastAPI(
    title="Discord-like API",
    description="Single-file backend — corrected REST + WebSocket base",
    version="4.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# ═══════════════════════════════════════════════════════════════════════════
#  Auth routes
# ═══════════════════════════════════════════════════════════════════════════
@app.post("/auth/register", response_model=TokenOut, status_code=201, tags=["Auth"])
async def register(body: RegisterIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.username == body.username))
    if res.scalar():
        raise HTTPException(409, "Username already taken")

    uid = usr_id()
    u = User(
        id=uid,
        username=body.username,
        email=f"{uid}@local.harmony",
        password_hash=hash_pw(body.password),
    )
    try:
        db.add(u)
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Username already taken")

    return TokenOut(access_token=create_token(u.id))


@app.post("/auth/login", response_model=TokenOut, tags=["Auth"])
async def login(body: LoginIn, db: AsyncSession = Depends(get_db)):
    res = await db.execute(select(User).where(User.username == body.username))
    u = res.scalar_one_or_none()
    if not u or not verify_pw(body.password, u.password_hash):
        raise HTTPException(401, "Invalid credentials")
    return TokenOut(access_token=create_token(u.id))


@app.post("/auth/refresh", response_model=TokenOut, tags=["Auth"])
async def refresh(user: User = Depends(_dep_user)):
    return TokenOut(access_token=create_token(user.id))


@app.post("/auth/logout", status_code=204, tags=["Auth"])
async def logout():
    # JWT stateless logout no-op in this version.
    return None


# ═══════════════════════════════════════════════════════════════════════════
#  User routes
# ═══════════════════════════════════════════════════════════════════════════
@app.get("/users/@me", response_model=UserOut, tags=["Users"])
async def get_me(user: User = Depends(_dep_user)):
    return user


@app.patch("/users/@me", response_model=UserOut, tags=["Users"])
async def update_me(
    body: UpdateMeIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    if body.username is not None:
        user.username = body.username
    if body.bio is not None:
        user.bio = body.bio
    if body.pronouns is not None:
        user.pronouns = body.pronouns
    if body.avatar_url is not None:
        user.avatar_url = body.avatar_url
    if body.banner_url is not None:
        user.banner_url = body.banner_url

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise HTTPException(409, "Username already taken")

    await db.refresh(user)

    ev = {
        "op": "USER_UPDATE",
        "data": {
            "id": user.id,
            "username": user.username,
            "avatar_url": user.avatar_url,
            "bio": user.bio,
            "pronouns": user.pronouns,
            "banner_url": user.banner_url,
            "status": user.status,
        },
    }

    res = await db.execute(
        select(ServerMember.server_id).where(ServerMember.user_id == user.id)
    )
    for (sid,) in res.all():
        await gw.to_server(sid, ev)

    await gw.to_user(user.id, ev)

    dm_res = await db.execute(
        select(DMParticipant.channel_id).where(DMParticipant.user_id == user.id)
    )
    for (ch_id,) in dm_res.all():
        others = await db.execute(
            select(DMParticipant.user_id).where(
                DMParticipant.channel_id == ch_id, DMParticipant.user_id != user.id
            )
        )
        for (other_uid,) in others.all():
            await gw.to_user(other_uid, ev)

    return user


@app.get("/users/{user_id}", response_model=UserOut, tags=["Users"])
async def get_user(user_id: str, db: AsyncSession = Depends(get_db)):
    return await _get_or_404(db, User, user_id, "User not found")


@app.patch("/users/@me/presence", status_code=204, tags=["Users"])
async def update_presence(
    body: PresenceIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    if body.status == "offline":
        raise HTTPException(422, "offline is managed by the WebSocket gateway")
    if body.status not in ("online", "idle", "dnd", "invisible"):
        raise HTTPException(422, "status must be online | idle | dnd | invisible")
    if not gw.is_connected(user.id):
        raise HTTPException(409, "No active WebSocket connection — connect first")

    user.status = body.status
    await db.commit()
    await _broadcast_presence(db, user.id, body.status)

    await gw.to_user(
        user.id,
        {"op": "USER_UPDATE", "data": {"id": user.id, "status": body.status}},
    )
    return None


@app.get("/users/@me/servers", response_model=list[ServerOut], tags=["Users"])
async def my_servers(
    user: User = Depends(_dep_user), db: AsyncSession = Depends(get_db)
):
    res = await db.execute(
        select(Server)
        .join(ServerMember, ServerMember.server_id == Server.id)
        .where(ServerMember.user_id == user.id)
    )
    return res.scalars().all()


@app.get("/channels/{channel_id}/typing", tags=["Channels"])
async def get_typing(
    channel_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    await _can_read(db, user.id, ch)
    return {"typing": gw.get_typers(channel_id, user.id)}


@app.put("/channels/{channel_id}/typing", status_code=204, tags=["Channels"])
async def start_typing(
    channel_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    await _can_read(db, user.id, ch)
    gw.set_typing(user.id, channel_id)
    await gw.to_channel(
        db,
        ch,
        {
            "op": "TYPING_START",
            "data": {
                "channel_id": channel_id,
                "user_id": user.id,
                "username": user.username,
                "timestamp": time.time(),
            },
        },
    )
    return None


# ═══════════════════════════════════════════════════════════════════════════
#  Server routes
# ═══════════════════════════════════════════════════════════════════════════
@app.post("/servers", response_model=ServerOut, status_code=201, tags=["Servers"])
async def create_server(
    body: CreateServerIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    sid = srv_id()
    srv = Server(id=sid, name=body.name, owner_id=user.id)
    db.add(srv)
    db.add(
        Role(
            id=sid,
            server_id=sid,
            name="@everyone",
            permissions=DEFAULT_PERMS,
            position=0,
            is_everyone=True,
        )
    )
    db.add(ServerMember(server_id=sid, user_id=user.id))
    db.add(
        Channel(id=chn_id(), server_id=sid, name="general", type="text", position=0)
    )
    await db.commit()
    await db.refresh(srv)

    gw.add_user_to_server(user.id, sid)

    await gw.to_user(
        user.id,
        {
            "op": "GUILD_CREATE",
            "data": {
                "id": srv.id,
                "name": srv.name,
                "owner_id": srv.owner_id,
                "icon_url": srv.icon_url,
            },
        },
    )
    return srv


@app.get("/servers/{server_id}", response_model=ServerOut, tags=["Servers"])
async def get_server(
    server_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    srv = await _get_or_404(db, Server, server_id, "Server not found")
    await _assert_member(db, server_id, user.id)
    return srv


@app.patch("/servers/{server_id}", response_model=ServerOut, tags=["Servers"])
async def update_server(
    server_id: str,
    body: UpdateServerIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    srv = await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.MANAGE_SERVER)

    if body.name is not None:
        srv.name = body.name
    if body.icon_url is not None:
        srv.icon_url = body.icon_url
    if body.banner_url is not None:
        srv.banner_url = body.banner_url

    await _audit(db, server_id, user.id, "server_update")
    await db.commit()
    await db.refresh(srv)

    await gw.to_server(
        server_id,
        {
            "op": "GUILD_UPDATE",
            "data": {
                "id": srv.id,
                "name": srv.name,
                "icon_url": srv.icon_url,
                "banner_url": srv.banner_url,
            },
        },
    )
    return srv


@app.delete("/servers/{server_id}", status_code=204, tags=["Servers"])
async def delete_server(
    server_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    srv = await _get_or_404(db, Server, server_id, "Server not found")
    if srv.owner_id != user.id:
        raise HTTPException(403, "Only the owner can delete")

    await gw.to_server(server_id, {"op": "GUILD_DELETE", "data": {"id": server_id}})
    gw.remove_server(server_id)

    res = await db.execute(select(Channel.id).where(Channel.server_id == server_id))
    for (cid,) in res.all():
        await _delete_channel_related(db, cid)

    res = await db.execute(select(Role.id).where(Role.server_id == server_id))
    for (rid,) in res.all():
        role = await db.get(Role, rid)
        if role:
            await db.delete(role)

    await db.execute(delete(MemberRole).where(MemberRole.server_id == server_id))
    await db.execute(delete(ServerMember).where(ServerMember.server_id == server_id))
    await db.execute(delete(Ban).where(Ban.server_id == server_id))
    await db.execute(delete(AuditLog).where(AuditLog.server_id == server_id))
    await db.execute(delete(Invite).where(Invite.server_id == server_id))
    await db.execute(
        delete(ShareLink).where(
            ShareLink.kind == "server",
            ShareLink.target_id == server_id,
        )
    )
    await db.delete(srv)
    await db.commit()
    return None


@app.delete("/servers/{server_id}/@me", status_code=204, tags=["Servers"])
async def leave_server(
    server_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    srv = await _get_or_404(db, Server, server_id, "Server not found")
    if srv.owner_id == user.id:
        raise HTTPException(403, "Owner cannot leave without deleting or transferring ownership")

    await _assert_member(db, server_id, user.id)
    await _remove_member_from_server(db, server_id, user.id)
    await _audit(db, server_id, user.id, "member_leave", target_id=user.id)
    await db.commit()

    gw.remove_user_from_server(user.id, server_id)

    await gw.to_server(
        server_id,
        {
            "op": "GUILD_MEMBER_REMOVE",
            "data": {"server_id": server_id, "user_id": user.id},
        },
    )
    await gw.to_user(user.id, {"op": "GUILD_DELETE", "data": {"id": server_id}})
    return None


@app.get("/servers/{server_id}/members", response_model=list[MemberOut], tags=["Servers"])
async def list_members(
    server_id: str,
    limit: int = 50,
    offset: int = 0,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _assert_member(db, server_id, user.id)

    res = await db.execute(
        select(ServerMember)
        .where(ServerMember.server_id == server_id)
        .limit(limit)
        .offset(offset)
    )
    members = res.scalars().all()
    return [await _build_member_out(db, m, user.id) for m in members]


@app.get(
    "/servers/{server_id}/members/{target_id}",
    response_model=MemberOut,
    tags=["Servers"],
)
async def get_member(
    server_id: str,
    target_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _assert_member(db, server_id, user.id)
    m = await _get_or_404(db, ServerMember, (server_id, target_id), "Member not found")
    return await _build_member_out(db, m, user.id)


@app.patch(
    "/servers/{server_id}/members/{target_id}",
    response_model=MemberOut,
    tags=["Servers"],
)
async def update_member(
    server_id: str,
    target_id: str,
    body: UpdateMemberIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.MANAGE_ROLES)
    m = await _get_or_404(db, ServerMember, (server_id, target_id), "Member not found")

    if body.nickname is not None:
        m.nickname = body.nickname

    await db.commit()
    await db.refresh(m)

    await gw.to_server(
        server_id,
        {
            "op": "GUILD_MEMBER_UPDATE",
            "data": {
                "server_id": server_id,
                "user_id": target_id,
                "nickname": m.nickname,
            },
        },
    )
    return await _build_member_out(db, m, user.id)


@app.delete("/servers/{server_id}/members/{target_id}", status_code=204, tags=["Servers"])
async def kick_member(
    server_id: str,
    target_id: str,
    reason: Optional[str] = None,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    srv = await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.KICK_MEMBERS)

    if srv.owner_id == target_id:
        raise HTTPException(403, "Cannot kick the owner")

    await _get_or_404(db, ServerMember, (server_id, target_id), "Member not found")
    await _remove_member_from_server(db, server_id, target_id)
    await _audit(db, server_id, user.id, "member_kick", target_id=target_id, reason=reason)
    await db.commit()

    gw.remove_user_from_server(target_id, server_id)

    await gw.to_server(
        server_id,
        {
            "op": "GUILD_MEMBER_REMOVE",
            "data": {"server_id": server_id, "user_id": target_id},
        },
    )
    await gw.to_user(target_id, {"op": "GUILD_DELETE", "data": {"id": server_id}})
    return None


@app.get("/servers/{server_id}/bans", response_model=list[BanOut], tags=["Servers"])
async def list_bans(
    server_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.BAN_MEMBERS)
    res = await db.execute(select(Ban).where(Ban.server_id == server_id))
    return res.scalars().all()


@app.put("/servers/{server_id}/bans/{target_id}", response_model=BanOut, tags=["Servers"])
async def ban_user(
    server_id: str,
    target_id: str,
    body: BanIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    srv = await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.BAN_MEMBERS)

    if srv.owner_id == target_id:
        raise HTTPException(403, "Cannot ban the owner")

    if await db.get(Ban, (server_id, target_id)):
        raise HTTPException(409, "Already banned")

    if await db.get(ServerMember, (server_id, target_id)):
        await _remove_member_from_server(db, server_id, target_id)

    ban = Ban(server_id=server_id, user_id=target_id, reason=body.reason)
    db.add(ban)
    await _audit(db, server_id, user.id, "member_ban", target_id=target_id, reason=body.reason)
    await db.commit()
    await db.refresh(ban)

    gw.remove_user_from_server(target_id, server_id)

    await gw.to_server(
        server_id,
        {"op": "GUILD_BAN_ADD", "data": {"server_id": server_id, "user_id": target_id}},
    )
    await gw.to_user(target_id, {"op": "GUILD_DELETE", "data": {"id": server_id}})
    return ban


@app.delete("/servers/{server_id}/bans/{target_id}", status_code=204, tags=["Servers"])
async def unban_user(
    server_id: str,
    target_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.BAN_MEMBERS)
    ban = await _get_or_404(db, Ban, (server_id, target_id), "Ban not found")
    await db.delete(ban)
    await db.commit()
    await gw.to_server(
        server_id,
        {"op": "GUILD_BAN_REMOVE", "data": {"server_id": server_id, "user_id": target_id}},
    )
    return None


@app.get("/servers/{server_id}/audit-logs", response_model=list[AuditOut], tags=["Servers"])
async def audit_logs(
    server_id: str,
    limit: int = 50,
    offset: int = 0,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.VIEW_AUDIT_LOG)
    res = await db.execute(
        select(AuditLog)
        .where(AuditLog.server_id == server_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return res.scalars().all()


@app.get("/servers/{server_id}/permissions/@me", response_model=EffectivePermsOut, tags=["Servers"])
async def my_server_permissions(
    server_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _assert_member(db, server_id, user.id)
    return EffectivePermsOut(permissions=await _compute_perms(db, user.id, server_id))


# ═══════════════════════════════════════════════════════════════════════════
#  Channel routes
# ═══════════════════════════════════════════════════════════════════════════
@app.get("/servers/{server_id}/channels", response_model=list[ChannelOut], tags=["Channels"])
async def list_channels(
    server_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    return await _visible_server_channels(db, user.id, server_id)


@app.post(
    "/servers/{server_id}/channels",
    response_model=ChannelOut,
    status_code=201,
    tags=["Channels"],
)
async def create_channel(
    server_id: str,
    body: CreateChannelIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.MANAGE_CHANNELS)

    if body.type not in ("text", "voice", "category"):
        raise HTTPException(422, "type must be text | voice | category")

    await _validate_parent(db, server_id, body.parent_id)

    ch = Channel(
        id=chn_id(),
        server_id=server_id,
        parent_id=body.parent_id,
        name=body.name,
        type=body.type,
        topic=body.topic,
        position=body.position,
        is_nsfw=body.is_nsfw,
    )
    db.add(ch)
    await db.commit()
    await db.refresh(ch)

    await gw.to_server(
        server_id,
        {
            "op": "CHANNEL_CREATE",
            "data": {
                "id": ch.id,
                "server_id": server_id,
                "name": ch.name,
                "type": ch.type,
                "topic": ch.topic,
                "position": ch.position,
                "parent_id": ch.parent_id,
                "is_nsfw": ch.is_nsfw,
            },
        },
    )
    return ch


@app.get("/channels/{channel_id}", response_model=ChannelOut, tags=["Channels"])
async def get_channel(
    channel_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    await _can_read(db, user.id, ch)
    return ch


@app.patch("/channels/{channel_id}", response_model=ChannelOut, tags=["Channels"])
async def update_channel(
    channel_id: str,
    body: UpdateChannelIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    parent_id_set = "parent_id" in body.model_fields_set

    if ch.server_id:
        await _require(db, user.id, ch.server_id, Perm.MANAGE_CHANNELS, ch.id)
        if parent_id_set and body.parent_id is not None:
            await _validate_parent(db, ch.server_id, body.parent_id)
    else:
        if not await db.get(DMParticipant, (channel_id, user.id)):
            raise HTTPException(403, "Not a participant of this DM")
        if ch.type not in ("group", "dm", "note"):
            raise HTTPException(403, "Unsupported private channel")
        if ch.type != "group":
            body_name = body.name
            body_position = body.position
            if body_name is not None and body_name != ch.name:
                raise HTTPException(403, "Only groups can be renamed")
            if body_position is not None:
                raise HTTPException(403, "Private channel positions cannot be updated")
        if parent_id_set or body.topic is not None or body.is_nsfw is not None:
            raise HTTPException(403, "Unsupported update for private channels")

    if body.name is not None:
        ch.name = body.name
    if body.topic is not None:
        ch.topic = body.topic
    if body.position is not None:
        ch.position = body.position
    if parent_id_set:
        ch.parent_id = body.parent_id
    if body.is_nsfw is not None:
        ch.is_nsfw = body.is_nsfw

    await db.commit()
    await db.refresh(ch)

    if ch.server_id:
        await gw.to_server(
            ch.server_id,
            {
                "op": "CHANNEL_UPDATE",
                "data": {
                    "id": ch.id,
                    "server_id": ch.server_id,
                    "name": ch.name,
                    "topic": ch.topic,
                    "position": ch.position,
                    "parent_id": ch.parent_id,
                    "is_nsfw": ch.is_nsfw,
                },
            },
        )
    else:
        payload = await _build_dm_channel_out(db, ch, user.id)
        for target_uid in await _visible_dm_user_ids(db, ch.id):
            await gw.to_user(
                target_uid,
                {"op": "DM_CHANNEL_UPDATE", "data": payload.model_dump(mode="json")},
            )
    return ch


@app.delete("/channels/{channel_id}", status_code=204, tags=["Channels"])
async def delete_channel(
    channel_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")

    if ch.server_id:
        await _require(db, user.id, ch.server_id, Perm.MANAGE_CHANNELS, ch.id)
    else:
        if not await db.get(DMParticipant, (channel_id, user.id)):
            raise HTTPException(403, "Not a participant of this DM")
        if ch.type == "group":
            notice = await _create_system_notice(
                db, channel_id, user.id, "leave", f"{user.username} left the group"
            )
            await db.execute(
                delete(DMParticipant).where(
                    DMParticipant.channel_id == channel_id,
                    DMParticipant.user_id == user.id,
                )
            )
            await db.commit()

            res = await db.execute(
                select(func.count()).select_from(DMParticipant).where(DMParticipant.channel_id == channel_id)
            )
            remaining = res.scalar_one()
            if remaining == 0:
                await _delete_channel_related(db, channel_id)
                await db.commit()
            else:
                out = await _build_msg(db, notice, user.id)
                await gw.to_channel(
                    db, ch, {"op": "MESSAGE_CREATE", "data": out.model_dump(mode="json")}
                )
                payload = {"op": "DM_CHANNEL_DELETE", "data": {"id": channel_id, "user_id": user.id}}
                await gw.to_user(user.id, payload)
                for target_uid in await _visible_dm_user_ids(db, channel_id):
                    await gw.to_user(target_uid, {"op": "DM_CHANNEL_UPDATE", "data": {"id": channel_id}})
            return None

    sid = ch.server_id
    await _delete_channel_related(db, channel_id)
    await db.commit()

    if sid:
        await gw.to_server(sid, {"op": "CHANNEL_DELETE", "data": {"id": channel_id}})
    else:
        await gw.to_user(user.id, {"op": "DM_CHANNEL_DELETE", "data": {"id": channel_id}})
    return None


@app.patch("/servers/{server_id}/channels/positions", status_code=204, tags=["Channels"])
async def update_channel_positions(
    server_id: str,
    updates: list[PositionUpdate],
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.MANAGE_CHANNELS)

    for u in updates:
        ch = await db.get(Channel, u.id)
        if ch and ch.server_id == server_id:
            if u.parent_id is not None:
                await _validate_parent(db, server_id, u.parent_id)
                ch.parent_id = u.parent_id
            ch.position = u.position

    await db.commit()
    return None


@app.get("/channels/{channel_id}/permissions", response_model=list[OverwriteOut], tags=["Channels"])
async def list_overwrites(
    channel_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    if not ch.server_id:
        raise HTTPException(400, "DM channels do not support overwrites")
    await _require(db, user.id, ch.server_id, Perm.MANAGE_CHANNELS, ch.id)

    res = await db.execute(
        select(ChannelPermOverwrite).where(ChannelPermOverwrite.channel_id == channel_id)
    )
    return res.scalars().all()


@app.get("/channels/{channel_id}/permissions/@me", response_model=EffectivePermsOut, tags=["Channels"])
async def my_channel_permissions(
    channel_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    if not ch.server_id:
        raise HTTPException(400, "DM channels do not expose permission bits")
    await _assert_member(db, ch.server_id, user.id)
    return EffectivePermsOut(
        permissions=await _compute_perms(db, user.id, ch.server_id, ch.id)
    )


@app.put("/channels/{channel_id}/permissions/{overwrite_id}", status_code=204, tags=["Channels"])
async def set_overwrite(
    channel_id: str,
    overwrite_id: str,
    body: OverwriteIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    if not ch.server_id:
        raise HTTPException(400, "DM channels do not support overwrites")
    await _require(db, user.id, ch.server_id, Perm.MANAGE_CHANNELS, ch.id)

    if body.target_type not in ("role", "member"):
        raise HTTPException(422, "target_type must be role | member")

    if body.target_type == "role":
        role = await db.get(Role, overwrite_id)
        if not role or role.server_id != ch.server_id:
            raise HTTPException(422, "Role not found in this server")
    else:
        if not await db.get(ServerMember, (ch.server_id, overwrite_id)):
            raise HTTPException(422, "Member not found in this server")

    ow = await db.get(ChannelPermOverwrite, (channel_id, overwrite_id))
    if ow:
        ow.allow = body.allow
        ow.deny = body.deny
        ow.target_type = body.target_type
    else:
        db.add(
            ChannelPermOverwrite(
                channel_id=channel_id,
                target_id=overwrite_id,
                target_type=body.target_type,
                allow=body.allow,
                deny=body.deny,
            )
        )

    await db.commit()
    return None


@app.delete("/channels/{channel_id}/permissions/{overwrite_id}", status_code=204, tags=["Channels"])
async def delete_overwrite(
    channel_id: str,
    overwrite_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    if not ch.server_id:
        raise HTTPException(400, "DM channels do not support overwrites")
    await _require(db, user.id, ch.server_id, Perm.MANAGE_CHANNELS, ch.id)

    ow = await db.get(ChannelPermOverwrite, (channel_id, overwrite_id))
    if ow:
        await db.delete(ow)
        await db.commit()
    return None


# ═══════════════════════════════════════════════════════════════════════════
#  Role routes
# ═══════════════════════════════════════════════════════════════════════════
@app.get("/servers/{server_id}/roles", response_model=list[RoleOut], tags=["Roles"])
async def list_roles(
    server_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _assert_member(db, server_id, user.id)
    res = await db.execute(
        select(Role).where(Role.server_id == server_id).order_by(Role.position.desc())
    )
    return res.scalars().all()


@app.post("/servers/{server_id}/roles", response_model=RoleOut, status_code=201, tags=["Roles"])
async def create_role(
    server_id: str,
    body: CreateRoleIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.MANAGE_ROLES)

    res = await db.execute(
        select(Role).where(Role.server_id == server_id).order_by(Role.position.desc())
    )
    top = res.scalars().first()

    r = Role(
        id=rol_id(),
        server_id=server_id,
        name=body.name,
        color=body.color,
        permissions=body.permissions,
        position=(top.position + 1 if top else 1),
        is_mentionable=body.is_mentionable,
        is_hoisted=body.is_hoisted,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)

    await gw.to_server(
        server_id,
        {
            "op": "ROLE_CREATE",
            "data": {
                "id": r.id,
                "server_id": server_id,
                "name": r.name,
                "permissions": r.permissions,
                "color": r.color,
                "position": r.position,
                "is_mentionable": r.is_mentionable,
                "is_hoisted": r.is_hoisted,
            },
        },
    )
    return r


@app.patch("/servers/{server_id}/roles/positions", status_code=204, tags=["Roles"])
async def update_role_positions(
    server_id: str,
    updates: list[RolePosIn],
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.MANAGE_ROLES)

    for u in updates:
        r = await db.get(Role, u.id)
        if r and r.server_id == server_id and not r.is_everyone:
            r.position = u.position

    await db.commit()
    return None


@app.patch("/servers/{server_id}/roles/{role_id}", response_model=RoleOut, tags=["Roles"])
async def update_role(
    server_id: str,
    role_id: str,
    body: UpdateRoleIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.MANAGE_ROLES)

    r = await _get_or_404(db, Role, role_id, "Role not found")
    if r.server_id != server_id:
        raise HTTPException(404, "Role not found in this server")
    if r.is_everyone:
        raise HTTPException(403, "Cannot edit @everyone")

    if body.name is not None:
        r.name = body.name
    if body.color is not None:
        r.color = body.color
    if body.permissions is not None:
        r.permissions = body.permissions
    if body.is_mentionable is not None:
        r.is_mentionable = body.is_mentionable
    if body.is_hoisted is not None:
        r.is_hoisted = body.is_hoisted
    if body.position is not None:
        r.position = body.position

    await db.commit()
    await db.refresh(r)

    await gw.to_server(
        server_id,
        {
            "op": "ROLE_UPDATE",
            "data": {
                "id": r.id,
                "server_id": server_id,
                "name": r.name,
                "permissions": r.permissions,
                "color": r.color,
                "position": r.position,
                "is_mentionable": r.is_mentionable,
                "is_hoisted": r.is_hoisted,
            },
        },
    )
    return r


@app.delete("/servers/{server_id}/roles/{role_id}", status_code=204, tags=["Roles"])
async def delete_role(
    server_id: str,
    role_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.MANAGE_ROLES)

    r = await _get_or_404(db, Role, role_id, "Role not found")
    if r.server_id != server_id:
        raise HTTPException(404, "Role not found in this server")
    if r.is_everyone:
        raise HTTPException(403, "Cannot delete @everyone")

    await _delete_role_related(db, role_id)
    await db.commit()

    await gw.to_server(
        server_id,
        {"op": "ROLE_DELETE", "data": {"role_id": role_id, "server_id": server_id}},
    )
    return None


@app.put("/servers/{server_id}/members/{target_id}/roles/{role_id}", status_code=204, tags=["Roles"])
async def assign_role(
    server_id: str,
    target_id: str,
    role_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.MANAGE_ROLES)

    r = await _get_or_404(db, Role, role_id, "Role not found")
    if r.server_id != server_id:
        raise HTTPException(422, "Role does not belong to this server")
    if r.is_everyone:
        raise HTTPException(403, "Cannot assign @everyone")

    await _get_or_404(db, ServerMember, (server_id, target_id), "Member not found")

    if not await db.get(MemberRole, (server_id, target_id, role_id)):
        db.add(MemberRole(server_id=server_id, user_id=target_id, role_id=role_id))
        await db.commit()

        await gw.to_server(
            server_id,
            {
                "op": "GUILD_MEMBER_ROLES_UPDATE",
                "data": {
                    "server_id": server_id,
                    "user_id": target_id,
                    "role_id": role_id,
                    "action": "add",
                },
            },
        )
    return None


@app.delete("/servers/{server_id}/members/{target_id}/roles/{role_id}", status_code=204, tags=["Roles"])
async def remove_role(
    server_id: str,
    target_id: str,
    role_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.MANAGE_ROLES)

    r = await _get_or_404(db, Role, role_id, "Role not found")
    if r.server_id != server_id:
        raise HTTPException(422, "Role does not belong to this server")

    mr = await db.get(MemberRole, (server_id, target_id, role_id))
    if mr:
        await db.delete(mr)
        await db.commit()

        await gw.to_server(
            server_id,
            {
                "op": "GUILD_MEMBER_ROLES_UPDATE",
                "data": {
                    "server_id": server_id,
                    "user_id": target_id,
                    "role_id": role_id,
                    "action": "remove",
                },
            },
        )
    return None


@app.get("/servers/{server_id}/members/{target_id}/roles", response_model=list[RoleOut], tags=["Roles"])
async def get_member_roles(
    server_id: str,
    target_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _assert_member(db, server_id, user.id)

    res = await db.execute(
        select(Role)
        .join(MemberRole, MemberRole.role_id == Role.id)
        .where(
            MemberRole.server_id == server_id,
            MemberRole.user_id == target_id,
            Role.server_id == server_id,
        )
        .order_by(Role.position.desc())
    )
    return res.scalars().all()


# ═══════════════════════════════════════════════════════════════════════════
#  Message routes
# ═══════════════════════════════════════════════════════════════════════════
@app.get("/channels/{channel_id}/messages", response_model=list[MessageOut], tags=["Messages"])
async def list_messages(
    channel_id: str,
    before: Optional[str] = Query(None),
    after: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100),
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    await _can_read(db, user.id, ch)

    q = select(Message).where(Message.channel_id == channel_id)

    if before:
        p = await db.get(Message, before)
        if p and p.channel_id == channel_id:
            q = q.where(Message.created_at < p.created_at)
    if after:
        p = await db.get(Message, after)
        if p and p.channel_id == channel_id:
            q = q.where(Message.created_at > p.created_at)

    res = await db.execute(q.order_by(Message.created_at.desc()).limit(limit))
    return [await _build_msg(db, m, user.id) for m in res.scalars().all()]


@app.post("/channels/{channel_id}/messages", response_model=MessageOut, status_code=201, tags=["Messages"])
async def send_message(
    channel_id: str,
    body: SendMessageIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    await _can_read(db, user.id, ch)

    if ch.server_id:
        await _require(db, user.id, ch.server_id, Perm.SEND_MESSAGES, channel_id)

    reply_to_id = body.reply_to_id
    if reply_to_id:
        original_msg = await db.get(Message, reply_to_id)
        if not original_msg or original_msg.channel_id != channel_id:
            reply_to_id = None

    m = Message(
        id=msg_id(),
        channel_id=channel_id,
        author_id=user.id,
        content=body.content,
        reply_to_id=reply_to_id,
    )
    db.add(m)
    await db.flush()

    for aid in body.attachments:
        a = await db.get(Attachment, aid)
        if not a:
            continue
        if a.message_id is not None:
            continue
        if a.uploader_id and a.uploader_id != user.id:
            continue
        a.message_id = m.id

    await db.commit()
    await db.refresh(m)

    out = await _build_msg(db, m, user.id)
    await gw.to_channel(
        db, ch, {"op": "MESSAGE_CREATE", "data": out.model_dump(mode="json")}
    )
    return out


@app.patch("/channels/{channel_id}/messages/{message_id}", response_model=MessageOut, tags=["Messages"])
async def edit_message(
    channel_id: str,
    message_id: str,
    body: EditMessageIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch, m = await _require_message_channel_access(db, user.id, channel_id, message_id)

    if m.author_id != user.id:
        raise HTTPException(403, "Not your message")

    m.content = body.content
    m.edited_at = datetime.utcnow()
    await db.commit()
    await db.refresh(m)

    out = await _build_msg(db, m, user.id)
    await gw.to_channel(
        db, ch, {"op": "MESSAGE_UPDATE", "data": out.model_dump(mode="json")}
    )
    return out


@app.delete("/channels/{channel_id}/messages/{message_id}", status_code=204, tags=["Messages"])
async def delete_message(
    channel_id: str,
    message_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch, m = await _require_message_channel_access(db, user.id, channel_id, message_id)

    can_manage = False
    if ch.server_id:
        bits = await _compute_perms(db, user.id, ch.server_id, channel_id)
        can_manage = _has(bits, Perm.MANAGE_MESSAGES)

    if m.author_id != user.id and not can_manage:
        raise HTTPException(403, "Cannot delete this message")

    await _delete_message_related(db, message_id)
    await db.commit()

    await gw.to_channel(
        db,
        ch,
        {
            "op": "MESSAGE_DELETE",
            "data": {"message_id": message_id, "channel_id": channel_id},
        },
    )
    return None


@app.post("/channels/{channel_id}/messages/{message_id}/pin", status_code=204, tags=["Messages"])
async def pin_message(
    channel_id: str,
    message_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch, m = await _require_message_channel_access(db, user.id, channel_id, message_id)

    if ch.server_id:
        await _require(db, user.id, ch.server_id, Perm.MANAGE_MESSAGES, channel_id)

    m.is_pinned = True
    await db.commit()

    await gw.to_channel(
        db,
        ch,
        {
            "op": "MESSAGE_PIN_UPDATE",
            "data": {
                "channel_id": channel_id,
                "message_id": message_id,
                "pinned": True,
            },
        },
    )
    return None


@app.delete("/channels/{channel_id}/messages/{message_id}/pin", status_code=204, tags=["Messages"])
async def unpin_message(
    channel_id: str,
    message_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch, m = await _require_message_channel_access(db, user.id, channel_id, message_id)

    if ch.server_id:
        await _require(db, user.id, ch.server_id, Perm.MANAGE_MESSAGES, channel_id)

    m.is_pinned = False
    await db.commit()

    await gw.to_channel(
        db,
        ch,
        {
            "op": "MESSAGE_PIN_UPDATE",
            "data": {
                "channel_id": channel_id,
                "message_id": message_id,
                "pinned": False,
            },
        },
    )
    return None


@app.get("/channels/{channel_id}/pins", response_model=list[MessageOut], tags=["Messages"])
async def get_pins(
    channel_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    await _can_read(db, user.id, ch)

    res = await db.execute(
        select(Message)
        .where(Message.channel_id == channel_id, Message.is_pinned == True)
        .order_by(Message.created_at.desc())
    )
    return [await _build_msg(db, m, user.id) for m in res.scalars().all()]


@app.put("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me", status_code=204, tags=["Messages"])
async def add_reaction(
    channel_id: str,
    message_id: str,
    emoji: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch, _m = await _require_message_channel_access(db, user.id, channel_id, message_id)

    if ch.server_id:
        await _require(db, user.id, ch.server_id, Perm.ADD_REACTIONS, channel_id)

    if not await db.get(Reaction, (message_id, user.id, emoji)):
        db.add(Reaction(message_id=message_id, user_id=user.id, emoji=emoji))
        await db.commit()

    await gw.to_channel(
        db,
        ch,
        {
            "op": "REACTION_ADD",
            "data": {
                "message_id": message_id,
                "channel_id": channel_id,
                "user_id": user.id,
                "emoji": emoji,
            },
        },
    )
    return None


@app.delete("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}/@me", status_code=204, tags=["Messages"])
async def remove_reaction(
    channel_id: str,
    message_id: str,
    emoji: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch, _m = await _require_message_channel_access(db, user.id, channel_id, message_id)

    r = await db.get(Reaction, (message_id, user.id, emoji))
    if r:
        await db.delete(r)
        await db.commit()

    await gw.to_channel(
        db,
        ch,
        {
            "op": "REACTION_REMOVE",
            "data": {
                "message_id": message_id,
                "channel_id": channel_id,
                "user_id": user.id,
                "emoji": emoji,
            },
        },
    )
    return None


@app.get("/channels/{channel_id}/messages/{message_id}/reactions/{emoji}", tags=["Messages"])
async def get_reactions(
    channel_id: str,
    message_id: str,
    emoji: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    _ch, _m = await _require_message_channel_access(db, user.id, channel_id, message_id)

    res = await db.execute(
        select(User)
        .join(Reaction, Reaction.user_id == User.id)
        .where(Reaction.message_id == message_id, Reaction.emoji == emoji)
    )
    return [{"id": u.id, "username": u.username} for u in res.scalars().all()]


@app.get("/servers/{server_id}/search", response_model=SearchOut, tags=["Messages"])
async def search_messages(
    server_id: str,
    q: str = Query(..., min_length=1),
    channel: Optional[str] = Query(None),
    author: Optional[str] = Query(None),
    before: Optional[datetime] = Query(None),
    after: Optional[datetime] = Query(None),
    has: Optional[str] = Query(None),
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    readable = await _visible_server_channels(db, user.id, server_id)
    readable_ids = [c.id for c in readable if c.type != "category"]

    if not readable_ids:
        return SearchOut(total=0, messages=[])

    stmt = select(Message).where(
        Message.channel_id.in_(readable_ids),
        Message.content.ilike(f"%{q}%"),
    )

    if channel:
        if channel not in readable_ids:
            return SearchOut(total=0, messages=[])
        stmt = stmt.where(Message.channel_id == channel)
    if author:
        stmt = stmt.where(Message.author_id == author)
    if before:
        stmt = stmt.where(Message.created_at < before)
    if after:
        stmt = stmt.where(Message.created_at > after)
    if has == "pin":
        stmt = stmt.where(Message.is_pinned == True)

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    res = await db.execute(
        stmt.order_by(Message.created_at.desc()).limit(limit).offset(offset)
    )

    return SearchOut(
        total=total,
        messages=[await _build_msg(db, m, user.id) for m in res.scalars().all()],
    )


# ═══════════════════════════════════════════════════════════════════════════
#  Invite routes
# ═══════════════════════════════════════════════════════════════════════════
@app.post("/servers/{server_id}/invites", response_model=InviteOut, status_code=201, tags=["Invites"])
async def create_invite(
    server_id: str,
    body: CreateInviteIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    ch = await db.get(Channel, body.channel_id)
    if not ch or ch.server_id != server_id:
        raise HTTPException(422, "Invalid channel_id")

    await _require(db, user.id, server_id, Perm.CREATE_INVITES, body.channel_id)

    expires_at = (
        datetime.utcnow() + timedelta(seconds=body.max_age) if body.max_age else None
    )
    inv = Invite(
        code=inv_code(),
        server_id=server_id,
        channel_id=body.channel_id,
        creator_id=user.id,
        max_uses=body.max_uses,
        expires_at=expires_at,
    )
    db.add(inv)
    await db.commit()
    await db.refresh(inv)
    return inv


@app.get("/servers/{server_id}/invites", response_model=list[InviteOut], tags=["Invites"])
async def list_invites(
    server_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.MANAGE_SERVER)
    res = await db.execute(select(Invite).where(Invite.server_id == server_id))
    return res.scalars().all()


@app.get("/invites/{code}", response_model=InviteOut, tags=["Invites"])
async def get_invite(code: str, db: AsyncSession = Depends(get_db)):
    inv = await _get_or_404(db, Invite, code, "Invite not found")
    if inv.expires_at and datetime.utcnow() > inv.expires_at:
        raise HTTPException(410, "Expired")
    if inv.max_uses and inv.uses >= inv.max_uses:
        raise HTTPException(410, "Max uses reached")
    return inv


@app.post("/invites/{code}/join", status_code=201, tags=["Invites"])
async def join_server(
    code: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    inv = await _get_or_404(db, Invite, code, "Invite not found")

    if inv.expires_at and datetime.utcnow() > inv.expires_at:
        raise HTTPException(410, "Expired")
    if inv.max_uses and inv.uses >= inv.max_uses:
        raise HTTPException(410, "Max uses reached")
    if await db.get(Ban, (inv.server_id, user.id)):
        raise HTTPException(403, "You are banned")

    if not await db.get(ServerMember, (inv.server_id, user.id)):
        db.add(ServerMember(server_id=inv.server_id, user_id=user.id))
        inv.uses += 1
        await db.commit()

        gw.add_user_to_server(user.id, inv.server_id)

        await gw.to_server(
            inv.server_id,
            {
                "op": "GUILD_MEMBER_ADD",
                "data": {
                    "server_id": inv.server_id,
                    "user_id": user.id,
                    "username": user.username,
                },
            },
        )
        await gw.to_user(
            user.id,
            {
                "op": "GUILD_CREATE",
                "data": {
                    "id": inv.server_id,
                    "name": (await db.get(Server, inv.server_id)).name,
                    "owner_id": (await db.get(Server, inv.server_id)).owner_id,
                },
            },
        )

    return {"server_id": inv.server_id, "channel_id": inv.channel_id}


@app.delete("/invites/{code}", status_code=204, tags=["Invites"])
async def revoke_invite(
    code: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    inv = await _get_or_404(db, Invite, code, "Invite not found")
    await _require(db, user.id, inv.server_id, Perm.CREATE_INVITES, inv.channel_id)
    await db.delete(inv)
    await db.commit()
    return None


@app.post("/servers/{server_id}/share-link", response_model=ShareLinkOut, tags=["Invites"])
async def create_server_share_link(
    server_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_or_404(db, Server, server_id, "Server not found")
    await _require(db, user.id, server_id, Perm.CREATE_INVITES)
    return await _get_or_create_share_link(db, "server", server_id, user.id)


@app.post("/channels/{channel_id}/share-link", response_model=ShareLinkOut, tags=["Invites"])
async def create_group_share_link(
    channel_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    if ch.type != "group":
        raise HTTPException(400, "Only groups support share links")
    if not await db.get(DMParticipant, (channel_id, user.id)):
        raise HTTPException(403, "Not a participant of this group")
    return await _get_or_create_share_link(db, "group", channel_id, user.id)


@app.post("/shares/{code}/join", tags=["Invites"])
async def join_share_link(
    code: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    share = await _get_or_404(db, ShareLink, code, "Share link not found")

    if share.kind == "server":
        server = await _get_or_404(db, Server, share.target_id, "Server not found")
        if await db.get(Ban, (server.id, user.id)):
            raise HTTPException(403, "You are banned")

        if not await db.get(ServerMember, (server.id, user.id)):
            db.add(ServerMember(server_id=server.id, user_id=user.id))
            await db.commit()

            gw.add_user_to_server(user.id, server.id)

            await gw.to_server(
                server.id,
                {
                    "op": "GUILD_MEMBER_ADD",
                    "data": {
                        "server_id": server.id,
                        "user_id": user.id,
                        "username": user.username,
                    },
                },
            )
            await gw.to_user(
                user.id,
                {
                    "op": "GUILD_CREATE",
                    "data": {
                        "id": server.id,
                        "name": server.name,
                        "owner_id": server.owner_id,
                        "icon_url": server.icon_url,
                    },
                },
            )

        return {"kind": "server", "server_id": server.id}

    if share.kind != "group":
        raise HTTPException(400, "Unsupported share link")

    ch = await _get_or_404(db, Channel, share.target_id, "Group not found")
    if ch.type != "group":
        raise HTTPException(410, "Group not available")

    if await db.get(DMParticipant, (ch.id, user.id)):
        return {
            "kind": "group",
            "channel_id": ch.id,
            "channel": (await _build_dm_channel_out(db, ch, user.id)).model_dump(mode="json"),
        }

    db.add(DMParticipant(channel_id=ch.id, user_id=user.id))
    notice = await _create_system_notice(
        db, ch.id, user.id, "join", f"{user.username} joined the group"
    )
    await db.commit()

    await gw.to_user(user.id, {"op": "DM_CHANNEL_CREATE", "data": {"id": ch.id, "type": "group"}})
    for target_uid in await _visible_dm_user_ids(db, ch.id):
        await gw.to_user(target_uid, {"op": "DM_CHANNEL_UPDATE", "data": {"id": ch.id}})

    out = await _build_msg(db, notice, user.id)
    await gw.to_channel(db, ch, {"op": "MESSAGE_CREATE", "data": out.model_dump(mode="json")})

    return {
        "kind": "group",
        "channel_id": ch.id,
        "channel": (await _build_dm_channel_out(db, ch, user.id)).model_dump(mode="json"),
    }


# ═══════════════════════════════════════════════════════════════════════════
#  DM & Notes routes
# ═══════════════════════════════════════════════════════════════════════════
@app.get("/users/@me/relationships", response_model=DMOverviewOut, tags=["DMs"])
async def list_relationships(
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Channel, DMParticipant)
        .join(DMParticipant, DMParticipant.channel_id == Channel.id)
        .where(DMParticipant.user_id == user.id)
        .order_by(Channel.created_at.asc())
    )
    channels = res.all()

    note = None
    friends: list[DMChannelOut] = []
    groups: list[DMChannelOut] = []
    pending: list[DMChannelOut] = []
    requests: list[DMChannelOut] = []

    for ch, participant in channels:
        out = await _build_dm_channel_out(db, ch, user.id)
        if ch.type == "note":
            if participant.is_hidden:
                continue
            note = out
            continue
        if ch.type == "group":
            if participant.is_hidden:
                continue
            groups.append(out)
            continue
        if ch.type != "dm":
            continue
        if participant.is_hidden and out.relationship_status == "accepted":
            continue

        if out.relationship_direction == "incoming" and out.relationship_status == "pending":
            requests.append(out)
        elif out.relationship_status == "accepted":
            friends.append(out)
        else:
            pending.append(out)

    return DMOverviewOut(
        note=note,
        friends=friends,
        groups=groups,
        pending=pending,
        requests=requests,
        request_count=len(requests),
    )


@app.get("/users/@me/channels", response_model=list[DMChannelOut], tags=["DMs"])
async def list_dms(
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    overview = await list_relationships(user=user, db=db)
    visible = []
    if overview.note:
        visible.append(overview.note)
    visible.extend(overview.friends)
    visible.extend(overview.groups)
    visible.extend(overview.pending)
    return visible


@app.post("/users/@me/channels", response_model=DMChannelOut, status_code=201, tags=["DMs"])
async def open_dm(
    body: OpenDMIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    if body.recipient_id == user.id:
        res = await db.execute(
            select(Channel)
            .join(DMParticipant, DMParticipant.channel_id == Channel.id)
            .where(DMParticipant.user_id == user.id, Channel.type == "note")
        )
        existing = res.scalar_one_or_none()
        if existing:
            return {
                "id": existing.id,
                "server_id": existing.server_id,
                "parent_id": existing.parent_id,
                "name": existing.name,
                "type": existing.type,
                "topic": existing.topic,
                "position": existing.position,
                "is_nsfw": existing.is_nsfw,
                "created_at": existing.created_at,
            }

        ch = Channel(id=chn_id(), name="Notes", type="note")
        db.add(ch)
        await db.flush()
        db.add(DMParticipant(channel_id=ch.id, user_id=user.id))
        await db.commit()
        await db.refresh(ch)
        return await _build_dm_channel_out(db, ch, user.id)

    recipient = await db.get(User, body.recipient_id)
    if not recipient:
        raise HTTPException(404, "Recipient not found")

    res = await db.execute(
        select(Channel)
        .join(DMRequest, DMRequest.channel_id == Channel.id)
        .where(
            Channel.type == "dm",
            (
                ((DMRequest.requester_id == user.id) & (DMRequest.recipient_id == body.recipient_id))
                | ((DMRequest.requester_id == body.recipient_id) & (DMRequest.recipient_id == user.id))
            ),
        )
        .order_by(Channel.created_at.asc())
    )
    existing = res.scalars().first()
    if existing:
        created_user_participant = False
        user_participant = await db.get(DMParticipant, (existing.id, user.id))
        if not user_participant:
            user_participant = DMParticipant(channel_id=existing.id, user_id=user.id)
            db.add(user_participant)
            created_user_participant = True

        created_recipient_participant = False
        recipient_participant = await db.get(DMParticipant, (existing.id, body.recipient_id))
        if not recipient_participant:
            recipient_participant = DMParticipant(channel_id=existing.id, user_id=body.recipient_id)
            db.add(recipient_participant)
            created_recipient_participant = True

        req = await _get_dm_request(db, existing.id)
        notify_recipient = False
        if req:
            should_re_request = req.status == "accepted" and (
                user_participant.is_hidden
                or recipient_participant.is_hidden
                or created_user_participant
                or created_recipient_participant
            )
            if should_re_request:
                req.requester_id = user.id
                req.recipient_id = body.recipient_id
                req.status = "pending"
                req.updated_at = datetime.utcnow()
                notify_recipient = True
            elif req.status in ("pending", "rejected") and req.requester_id != user.id:
                req.requester_id = user.id
                req.recipient_id = body.recipient_id
                req.status = "pending"
                req.updated_at = datetime.utcnow()
                notify_recipient = True
            elif req.status == "rejected" and req.requester_id == user.id:
                req.status = "pending"
                req.updated_at = datetime.utcnow()
                notify_recipient = True

        user_participant.is_hidden = False
        await db.commit()
        await db.refresh(existing)

        if notify_recipient:
            await gw.to_user(
                body.recipient_id,
                {
                    "op": "DM_REQUEST_CREATE",
                    "data": {"channel_id": existing.id, "from_user_id": user.id},
                },
            )

        return await _build_dm_channel_out(db, existing, user.id)

    ch = Channel(id=chn_id(), name="dm", type="dm")
    db.add(ch)
    await db.flush()
    db.add(DMParticipant(channel_id=ch.id, user_id=user.id))
    db.add(DMParticipant(channel_id=ch.id, user_id=body.recipient_id))
    db.add(
        DMRequest(
            channel_id=ch.id,
            requester_id=user.id,
            recipient_id=body.recipient_id,
            status="pending",
        )
    )
    await db.commit()
    await db.refresh(ch)

    await gw.to_user(
        body.recipient_id,
        {
            "op": "DM_REQUEST_CREATE",
            "data": {"channel_id": ch.id, "from_user_id": user.id},
        },
    )

    return await _build_dm_channel_out(db, ch, user.id)


@app.post("/users/@me/groups", response_model=DMChannelOut, status_code=201, tags=["DMs"])
async def create_group(
    body: CreateGroupIn,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    member_ids = []
    seen = {user.id}
    for uid in body.member_ids:
        if uid in seen:
            continue
        seen.add(uid)
        member_ids.append(uid)

    if not member_ids:
        raise HTTPException(422, "At least one friend is required")

    friend_ids = await _friend_user_ids(db, user.id)
    invalid = [uid for uid in member_ids if uid not in friend_ids]
    if invalid:
        raise HTTPException(403, "Groups can only include your friends")

    res = await db.execute(select(User.id).where(User.id.in_(member_ids)))
    existing_ids = {uid for (uid,) in res.all()}
    if existing_ids != set(member_ids):
        raise HTTPException(404, "One or more users were not found")

    ch = Channel(id=chn_id(), name=body.name, type="group")
    db.add(ch)
    await db.flush()

    db.add(DMParticipant(channel_id=ch.id, user_id=user.id))
    notice_ids: list[str] = []
    creator_notice = await _create_system_notice(
        db, ch.id, user.id, "join", f"{user.username} joined the group"
    )
    notice_ids.append(creator_notice.id)
    for uid in member_ids:
        db.add(DMParticipant(channel_id=ch.id, user_id=uid))
        member_user = await db.get(User, uid)
        if member_user:
            notice = await _create_system_notice(
                db,
                ch.id,
                uid,
                "join",
                f"{member_user.username} joined the group",
            )
            notice_ids.append(notice.id)

    await db.commit()
    await db.refresh(ch)

    payload = {"op": "DM_CHANNEL_CREATE", "data": {"id": ch.id, "type": "group"}}
    for uid in [user.id, *member_ids]:
        await gw.to_user(uid, payload)

    for notice_id in notice_ids:
        notice_msg = await db.get(Message, notice_id)
        if notice_msg:
            out = await _build_msg(db, notice_msg, user.id)
            await gw.to_channel(
                db, ch, {"op": "MESSAGE_CREATE", "data": out.model_dump(mode="json")}
            )

    return await _build_dm_channel_out(db, ch, user.id)


@app.post(
    "/users/@me/dm-requests/{channel_id}/accept",
    response_model=DMChannelOut,
    tags=["DMs"],
)
async def accept_dm_request(
    channel_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    req = await _get_or_404(db, DMRequest, channel_id, "DM request not found")
    if req.recipient_id != user.id:
        raise HTTPException(403, "Not your DM request")

    req.status = "accepted"
    req.updated_at = datetime.utcnow()
    requester_participant = await db.get(DMParticipant, (channel_id, req.requester_id))
    if not requester_participant:
        requester_participant = DMParticipant(channel_id=channel_id, user_id=req.requester_id)
        db.add(requester_participant)
    requester_participant.is_hidden = False

    recipient_participant = await db.get(DMParticipant, (channel_id, req.recipient_id))
    if not recipient_participant:
        recipient_participant = DMParticipant(channel_id=channel_id, user_id=req.recipient_id)
        db.add(recipient_participant)
    recipient_participant.is_hidden = False
    await db.commit()

    await gw.to_user(
        req.requester_id,
        {"op": "DM_REQUEST_UPDATE", "data": {"channel_id": channel_id, "status": "accepted"}},
    )
    await gw.to_user(
        req.recipient_id,
        {"op": "DM_REQUEST_UPDATE", "data": {"channel_id": channel_id, "status": "accepted"}},
    )

    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    return await _build_dm_channel_out(db, ch, user.id)


@app.post("/users/@me/dm-requests/{channel_id}/reject", status_code=204, tags=["DMs"])
async def reject_dm_request(
    channel_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    req = await _get_or_404(db, DMRequest, channel_id, "DM request not found")
    if req.recipient_id != user.id:
        raise HTTPException(403, "Not your DM request")

    req.status = "rejected"
    req.updated_at = datetime.utcnow()
    await db.commit()

    await gw.to_user(
        req.requester_id,
        {"op": "DM_REQUEST_UPDATE", "data": {"channel_id": channel_id, "status": "rejected"}},
    )
    await gw.to_user(
        req.recipient_id,
        {"op": "DM_REQUEST_UPDATE", "data": {"channel_id": channel_id, "status": "rejected"}},
    )
    return None


@app.delete("/users/@me/channels/{channel_id}", status_code=204, tags=["DMs"])
async def close_dm(
    channel_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "DM not found")
    if ch.type == "group":
        await delete_channel(channel_id=channel_id, user=user, db=db)
        return None

    p = await _get_or_404(db, DMParticipant, (channel_id, user.id), "DM not found")
    req = await _get_dm_request(db, channel_id)
    p.is_hidden = True

    notice = None
    if req and req.status == "accepted":
        other_res = await db.execute(
            select(DMParticipant).where(
                DMParticipant.channel_id == channel_id,
                DMParticipant.user_id != user.id,
            )
        )
        other_participant = other_res.scalar_one_or_none()
        if other_participant:
            notice = await _create_system_notice(
                db, channel_id, user.id, "close", f"{user.username} left the DM"
            )

    await db.commit()

    if notice:
        out = await _build_msg(db, notice, user.id)
        await gw.to_channel(
            db, ch, {"op": "MESSAGE_CREATE", "data": out.model_dump(mode="json")}
        )

    return None


@app.get("/channels/{channel_id}/participants", response_model=list[UserOut], tags=["DMs"])
async def get_dm_participants(
    channel_id: str,
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    ch = await _get_or_404(db, Channel, channel_id, "Channel not found")
    if ch.type not in ("dm", "note", "group"):
        raise HTTPException(400, "Not a DM channel")
    await _can_read(db, user.id, ch)

    res = await db.execute(
        select(User)
        .join(DMParticipant, DMParticipant.user_id == User.id)
        .where(DMParticipant.channel_id == channel_id)
    )
    users = res.scalars().all()
    out = []
    for u in users:
        out.append(UserOut.model_validate(u))
    return out


# ═══════════════════════════════════════════════════════════════════════════
#  Attachment route
# ═══════════════════════════════════════════════════════════════════════════
@app.post("/attachments", response_model=AttachOut, status_code=201, tags=["Attachments"])
async def upload(
    file: UploadFile = File(...),
    user: User = Depends(_dep_user),
    db: AsyncSession = Depends(get_db),
):
    if ALLOWED_MIME and file.content_type not in ALLOWED_MIME:
        raise HTTPException(415, f"Unsupported type: {file.content_type}")

    data = await file.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Exceeds {MAX_UPLOAD_MB}MB")

    aid = att_id()
    ext = os.path.splitext(file.filename or "file")[1]
    filename = f"{aid}{ext}"
    path = os.path.join(UPLOAD_DIR, filename)

    with open(path, "wb") as f:
        f.write(data)

    a = Attachment(
        id=aid,
        uploader_id=user.id,
        url=f"/uploads/{filename}",
        filename=file.filename or filename,
        size=len(data),
        content_type=file.content_type or "application/octet-stream",
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


# ═══════════════════════════════════════════════════════════════════════════
#  Frontend / WebSocket endpoint
# ═══════════════════════════════════════════════════════════════════════════
@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def frontend():
    html_file = STATIC_DIR / "index.html"
    if not html_file.is_file():
        return HTMLResponse(
            "<h1>index.html not found</h1><p>Place index.html in new/static</p>",
            status_code=404,
        )
    return HTMLResponse(html_file.read_text(encoding="utf-8"))


@app.websocket("/gateway")
async def gateway(ws: WebSocket, token: Optional[str] = Query(None)):
    await gw.handle(ws, token)


# ═══════════════════════════════════════════════════════════════════════════
#  Entry point
# ═══════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
