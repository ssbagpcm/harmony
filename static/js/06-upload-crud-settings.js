    //  Upload / emoji
    // ═══════════════════════════════════════════════════
    async function uploadFile(input) {
      const file = input.files?.[0];
      if (!file || !S.activeCh) return;
      input.value = '';

      try {
        const fd = new FormData();
        fd.append('file', file);
        const headers = {};
        if (S.token) headers.Authorization = `Bearer ${S.token}`;

        const r = await fetch(`${API}/attachments`, { method: 'POST', headers, body: fd });
        if (!r.ok) {
          let d = {};
          try { d = await r.json(); } catch { }
          throw new Error(d.detail || 'Upload failed');
        }
        const att = await r.json();
        const inp = document.getElementById('msg-input');
        const content = inp.value.trim() || file.name;

        const out = await POST(`/channels/${S.activeCh.id}/messages`, {
          content,
          attachments: [att.id],
          reply_to_id: S.replyTo?.id || null,
        });

        handleMessageCreate(out, 'http');
        clearReply();
        inp.value = '';
        autoResize(inp);
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    function buildEmoji() {
      document.getElementById('emoji-grid').innerHTML = EMOJIS.map(e =>
        `<div class="emoji-item" onclick="(_emojiCb||console.log)('${e}')">${e}</div>`
      ).join('');
    }
    function openEmojiPicker() {
      _emojiCb = (emoji) => {
        const inp = document.getElementById('msg-input');
        inp.value += emoji;
        autoResize(inp);
        inp.focus();
        closeModal('m-emoji');
      };
      buildEmoji();
      openModal('m-emoji');
    }
    function emojiFor(event, msgId) {
      event.stopPropagation();
      _emojiCb = (emoji) => { doReact(msgId, emoji, false); closeModal('m-emoji'); };
      buildEmoji();
      openModal('m-emoji');
      const p = document.getElementById('emoji-pos');
      p.style.left = Math.min(event.clientX, window.innerWidth - 320) + 'px';
      p.style.top = Math.max(0, event.clientY - 250) + 'px';
    }

    // ═══════════════════════════════════════════════════
    //  Server / channel CRUD
    // ═══════════════════════════════════════════════════
    async function createServer() {
      const name = document.getElementById('cs-name').value.trim();
      if (!name) return;
      try {
        const srv = await POST('/servers', { name });
        if (!S.servers.find(s => s.id === srv.id)) S.servers.push(srv);
        closeModal('m-create-server');
        document.getElementById('cs-name').value = '';
        renderRail();
        await selectServer(srv.id);
        toast('Server created', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    async function joinServerByInvite(code) {
      try {
        let res;
        try {
          res = await POST(`/invites/${code}/join`, {});
        } catch (inviteErr) {
          res = await POST(`/shares/${code}/join`, {});
          if (res.kind !== 'server') throw inviteErr;
        }
        await refreshServers();
        closePrompt();
        await selectServer(res.server_id);
        if (res.channel_id) {
          const joinedCh = findChannel(res.channel_id);
          if (joinedCh) {
            delete S.messages[res.channel_id];
            await pickCh(joinedCh);
            await fetchMsgs(res.channel_id, true);
          }
        } else if (S.activeCh?.server_id === res.server_id) {
          delete S.messages[S.activeCh.id];
          await fetchMsgs(S.activeCh.id, true);
        }
        toast('Joined server!', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    function populateChannelParentOptions(selectedId = null) {
      const select = document.getElementById('cc-parent');
      const cats = (S.channels[S.activeSrv?.id] || []).filter(c => c.type === 'category');
      select.innerHTML = `<option value="">No parent</option>` + cats.map(c =>
        `<option value="${c.id}" ${selectedId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`
      ).join('');
    }

    function openCreateCh(parentId = null) {
      S.channelEditorMode = 'create';
      S.channelEditorTarget = { parent_id: parentId };
      document.getElementById('ch-editor-title').textContent = 'Create Channel';
      document.getElementById('ch-editor-save').textContent = 'Create';
      document.getElementById('cc-type').disabled = false;
      document.getElementById('cc-type').value = 'text';
      document.getElementById('cc-name').value = '';
      document.getElementById('cc-topic').value = '';
      document.getElementById('cc-nsfw').value = 'false';
      populateChannelParentOptions(parentId);
      openModal('m-channel-editor');
    }

    function openEditChannel(chId) {
      const ch = findChannel(chId);
      if (!ch) return;
      S.channelEditorMode = 'edit';
      S.channelEditorTarget = ch;
      document.getElementById('ch-editor-title').textContent = 'Edit Channel';
      document.getElementById('ch-editor-save').textContent = 'Save';
      document.getElementById('cc-type').value = ch.type;
      document.getElementById('cc-type').disabled = true;
      document.getElementById('cc-name').value = ch.name || '';
      document.getElementById('cc-topic').value = ch.topic || '';
      document.getElementById('cc-nsfw').value = String(!!ch.is_nsfw);
      populateChannelParentOptions(ch.parent_id || null);
      openModal('m-channel-editor');
    }

    async function saveChannelEditor() {
      const name = document.getElementById('cc-name').value.trim();
      const type = document.getElementById('cc-type').value;
      const topic = document.getElementById('cc-topic').value.trim();
      const parent_id = document.getElementById('cc-parent').value || null;
      const is_nsfw = document.getElementById('cc-nsfw').value === 'true';

      if (!name) return;
      try {
        if (S.channelEditorMode === 'create') {
          if (!S.activeSrv) throw new Error('No active server');
          const ch = await POST(`/servers/${S.activeSrv.id}/channels`, {
            name,
            type,
            topic: topic || null,
            parent_id,
            is_nsfw
          });
          if (!S.channels[S.activeSrv.id]) S.channels[S.activeSrv.id] = [];
          if (!S.channels[S.activeSrv.id].find(c => c.id === ch.id)) S.channels[S.activeSrv.id].push(ch);
          S.channels[S.activeSrv.id].sort((a, b) => a.position - b.position);
          renderChs();
          closeModal('m-channel-editor');
          if (ch.type === 'text') await pickCh(ch);
          toast('Channel created', 'ok');
        } else {
          const ch = S.channelEditorTarget;
          const out = await PATCH(`/channels/${ch.id}`, {
            name,
            topic: topic || null,
            parent_id,
            is_nsfw
          });
          Object.assign(ch, out);
          renderChs();
          if (S.activeCh?.id === ch.id) {
            Object.assign(S.activeCh, out);
            updateHeader();
          }
          closeModal('m-channel-editor');
          toast('Channel updated', 'ok');
        }
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    function createCategory() {
      showPrompt('New Category', 'Enter category name:', '', async (name) => {
        if (!name || !S.activeSrv) return;
        try {
          const ch = await POST(`/servers/${S.activeSrv.id}/channels`, { name, type: 'category' });
          if (!S.channels[S.activeSrv.id]) S.channels[S.activeSrv.id] = [];
          if (!S.channels[S.activeSrv.id].find(c => c.id === ch.id)) S.channels[S.activeSrv.id].push(ch);
          renderChs();
          toast('Category created', 'ok');
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }

    async function deleteCh(chId) {
      const ch = findChannel(chId);
      if (!ch) return;
      showConfirm('Delete Channel', `Delete #${ch.name}?`, async () => {
        try {
          await DELETE_(`/channels/${ch.id}`);
          if (ch.server_id && S.channels[ch.server_id]) {
            S.channels[ch.server_id] = S.channels[ch.server_id].filter(c => c.id !== ch.id);
          }
          if (S.activeCh?.id === ch.id) {
            S.activeCh = null;
            renderMsgs();
            updateHeader();
          }
          renderChs();
          toast('Channel deleted', 'ok');
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }

    // ═══════════════════════════════════════════════════
    //  Invites
    // ═══════════════════════════════════════════════════
    async function showInvite(serverId) {
      const srv = findServer(serverId);
      document.getElementById('inv-title').textContent = 'Share Server';
      document.getElementById('inv-srv-name').textContent = srv?.name || '';
      document.getElementById('inv-code').textContent = 'Generating...';
      document.getElementById('inv-code').removeAttribute('data-code');
      document.getElementById('inv-help').textContent = 'Share this permanent server code. It never expires and is not listed in normal invites.';
      openModal('m-invite');

      try {
        const inv = await POST(`/servers/${serverId}/share-link`, {});
        document.getElementById('inv-code').textContent = inv.code;
        document.getElementById('inv-code').setAttribute('data-code', inv.code);
      } catch (e) {
        document.getElementById('inv-code').textContent = e.message;
      }
    }

    async function showGroupShare(channelId) {
      const ch = findChannel(channelId);
      document.getElementById('inv-title').textContent = 'Share Group';
      document.getElementById('inv-srv-name').textContent = ch?._name || ch?.name || 'Group';
      document.getElementById('inv-code').textContent = 'Generating...';
      document.getElementById('inv-code').removeAttribute('data-code');
      document.getElementById('inv-help').textContent = 'Share this permanent group code. It never expires.';
      openModal('m-invite');

      try {
        const inv = await POST(`/channels/${channelId}/share-link`, {});
        document.getElementById('inv-code').textContent = inv.code;
        document.getElementById('inv-code').setAttribute('data-code', inv.code);
      } catch (e) {
        document.getElementById('inv-code').textContent = e.message;
      }
    }

    async function joinGroupByShare(code) {
      try {
        const res = await POST(`/shares/${code}/join`, {});
        if (res.kind !== 'group') throw new Error('This code is not a group link');
        await loadRelationships();
        const local = findChannel(res.channel_id);
        if (local) await pickCh(local);
        closePrompt();
        toast('Joined group!', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    function copyInvite() {
      const el = document.getElementById('inv-code');
      const code = el.getAttribute('data-code') || el.textContent;
      if (!code || code === 'Generating...') return toast('Invite not ready', 'err');
      navigator.clipboard.writeText(code).then(() => toast('Invite copied!', 'ok')).catch(() => toast('Copy failed', 'err'));
    }

    async function revokeInvite(code) {
      showConfirm('Revoke Invite', `Revoke invite ${code}?`, async () => {
        try {
          await DELETE_(`/invites/${code}`);
          toast('Invite revoked', 'ok');
          if (document.getElementById('m-srv-settings').style.display === 'flex' && S.settingsTab === 'invites') {
            loadServerSettingsData('invites');
          }
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }

    // ═══════════════════════════════════════════════════
    //  User settings
    // ═══════════════════════════════════════════════════
    function openSettings() {
      if (!S.me) return;
      document.getElementById('set-user').value = S.me.username || '';
      document.getElementById('set-bio').value = S.me.bio || '';
      document.getElementById('set-av').value = S.me.avatar_url || '';
      document.getElementById('set-bn').value = S.me.banner_url || '';
      openModal('m-settings');
    }

    async function saveSettings() {
      const body = {};
      const username = document.getElementById('set-user').value.trim();
      const bio = document.getElementById('set-bio').value.trim();
      const avatar_url = document.getElementById('set-av').value.trim();
      const banner_url = document.getElementById('set-bn').value.trim();

      if (username !== S.me.username) body.username = username;
      if (bio !== (S.me.bio || '')) body.bio = bio;
      if (avatar_url !== (S.me.avatar_url || '')) body.avatar_url = avatar_url || null;
      if (banner_url !== (S.me.banner_url || '')) body.banner_url = banner_url || null;

      if (!Object.keys(body).length) {
        closeModal('m-settings');
        return;
      }

      try {
        const updated = await PATCH('/users/@me', body);
        Object.assign(S.me, updated);
        updatePanel(S.me);
        closeModal('m-settings');
        renderMsgs({ preserveBottom: true });
        toast('Settings saved!', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    // ═══════════════════════════════════════════════════
    //  Server settings
    // ═══════════════════════════════════════════════════
    function updateSrvSettingsBtn() {
      document.getElementById('btn-srv-settings').style.display = S.activeSrv && !S.inDMs ? '' : 'none';
    }
    function updateMLBtn() {
      document.getElementById('btn-ml').style.display = !S.inDMs && S.activeSrv ? '' : 'none';
      syncMLPanel();
    }
    function updateShareBtn() {
      const btn = document.getElementById('btn-share');
      const canShowGroup = !!(S.inDMs && S.activeCh?.type === 'group');
      const canShowServer = !!(!S.inDMs && S.activeSrv && (canCreateInvites() || isOwner()));
      btn.style.display = canShowGroup || canShowServer ? '' : 'none';
    }

    function shareCurrent() {
      if (S.inDMs && S.activeCh?.type === 'group') return showGroupShare(S.activeCh.id);
      if (!S.inDMs && S.activeSrv) return showInvite(S.activeSrv.id);
    }

    function openServerSettings() {
      if (!S.activeSrv) return;
      document.getElementById('srv-settings-title').textContent = `Settings - ${S.activeSrv.name}`;
      openModal('m-srv-settings');
      loadServerSettingsData(S.settingsTab || 'overview');
    }

    async function loadRoles(serverId, force = false) {
      if (!force && S.roles[serverId]) return S.roles[serverId];
      const roles = await GET(`/servers/${serverId}/roles`);
      S.roles[serverId] = roles;
      return roles;
    }

    async function loadServerSettingsData(tab = 'overview') {
      if (!S.activeSrv) return;
      S.settingsTab = tab;
      const body = document.getElementById('srv-settings-body');
      body.innerHTML = `<div class="empty"><i data-lucide="loader-circle" class="spin" style="width:24px;height:24px"></i></div>`;
      lucide.createIcons();

      await ensureServerPerms(S.activeSrv.id, true);

      const tabs = `
    <div class="srv-set-tabs">
      <div class="srv-set-tab${tab === 'overview' ? ' active' : ''}" onclick="loadServerSettingsData('overview')">Overview</div>
      <div class="srv-set-tab${tab === 'channels' ? ' active' : ''}" onclick="loadServerSettingsData('channels')">Channels</div>
      <div class="srv-set-tab${tab === 'roles' ? ' active' : ''}" onclick="loadServerSettingsData('roles')">Roles</div>
      <div class="srv-set-tab${tab === 'invites' ? ' active' : ''}" onclick="loadServerSettingsData('invites')">Invites</div>
      <div class="srv-set-tab${tab === 'members' ? ' active' : ''}" onclick="loadServerSettingsData('members')">Members</div>
      <div class="srv-set-tab${tab === 'bans' ? ' active' : ''}" onclick="loadServerSettingsData('bans')">Bans</div>
      <div class="srv-set-tab${tab === 'audit' ? ' active' : ''}" onclick="loadServerSettingsData('audit')">Audit</div>
    </div>
  `;

      try {
        let content = '';
        if (tab === 'overview') content = await renderServerOverviewTab();
        if (tab === 'channels') content = await renderServerChannelsTab();
        if (tab === 'roles') content = await renderServerRolesTab();
        if (tab === 'invites') content = await renderServerInvitesTab();
        if (tab === 'members') content = await renderServerMembersTab();
        if (tab === 'bans') content = await renderServerBansTab();
        if (tab === 'audit') content = await renderServerAuditTab();
        body.innerHTML = tabs + content;
      } catch (e) {
        body.innerHTML = tabs + `<div class="empty"><p>${esc(e.message)}</p></div>`;
      }
      lucide.createIcons();
    }

    async function renderServerOverviewTab() {
      const srv = S.activeSrv;
      const manage = canManageServer();

      return `<div style="padding:16px">
    <div style="text-align:center;margin-bottom:20px">
      <div class="av" style="width:80px;height:80px;font-size:32px;margin:0 auto 12px;background:${colorFor(srv.id)}">
        ${srv.icon_url ? `<img src="${escA(srv.icon_url)}" style="border-radius:50%">` : initials(srv.name)}
      </div>
      <div style="font-size:18px;font-weight:700">${esc(srv.name)}</div>
      <div class="small-muted">Owner ID: <span class="mono">${esc(srv.owner_id)}</span></div>
    </div>

    ${manage ? `
      <div class="fg"><label class="fl">Server Name</label><input class="fi" id="srv-name" type="text" value="${esc(srv.name)}"></div>
      <div class="fg"><label class="fl">Icon URL</label><input class="fi" id="srv-icon" type="url" value="${esc(srv.icon_url || '')}" placeholder="https://..."></div>
      <div class="fg"><label class="fl">Banner URL</label><input class="fi" id="srv-banner" type="url" value="${esc(srv.banner_url || '')}" placeholder="https://..."></div>
      <button class="btn btn-primary" style="width:100%;margin-top:12px" onclick="saveSrvSettings()">Save Changes</button>
    ` : `
      <div class="setting-card col">
        <div style="font-weight:700">Read-only</div>
        <div class="small-muted">You don't have permission to edit this server.</div>
      </div>
    `}

    <div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border)">
      <div style="font-size:13px;font-weight:700;color:var(--t3);margin-bottom:8px">Danger Zone</div>
      ${isOwner(srv)
          ? `<button class="btn btn-danger" style="width:100%" onclick="deleteSrv('${srv.id}')">Delete Server</button>`
          : `<button class="btn btn-danger" style="width:100%" onclick="leaveSrv('${srv.id}')">Leave Server</button>`
        }
    </div>
  </div>`;
    }

    async function renderServerChannelsTab() {
      const channels = S.channels[S.activeSrv.id] || await GET(`/servers/${S.activeSrv.id}/channels`);
      S.channels[S.activeSrv.id] = channels;
      const manage = canManageChannels();

      const renderGroup = (title, type, icon) => {
        const items = channels.filter(c => c.type === type).sort((a, b) => a.position - b.position);
        return `
      <div style="font-size:13px;font-weight:700;color:var(--t3);margin-bottom:8px">${title}</div>
      ${items.length ? items.map(c => `
        <div class="setting-card">
          <i data-lucide="${icon}" style="width:16px;height:16px;color:var(--t3)"></i>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${esc(c.name)}</div>
            ${c.topic ? `<div class="small-muted">${esc(c.topic)}</div>` : ''}
          </div>
          ${manage ? `
            <div class="up-btn" onclick="openEditChannel('${c.id}')" title="Edit"><i data-lucide="pencil" style="width:14px;height:14px"></i></div>
            <div class="up-btn" onclick="deleteCh('${c.id}')" title="Delete"><i data-lucide="trash-2" style="width:14px;height:14px"></i></div>
          ` : ''}
        </div>
      `).join('') : `<div class="small-muted" style="margin-bottom:12px">No ${title.toLowerCase()}.</div>`}
    `;
      };

      return `<div style="padding:16px">
    ${renderGroup('Categories', 'category', 'folder')}
    ${renderGroup('Text Channels', 'text', 'hash')}
    ${renderGroup('Voice Channels', 'voice', 'volume-2')}

    ${manage ? `
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-secondary" style="flex:1" onclick="openCreateCh(null)">+ Create Channel</button>
        <button class="btn btn-secondary" style="flex:1" onclick="createCategory()">+ Create Category</button>
      </div>
    ` : `<div class="small-muted">You don't have permission to manage channels.</div>`}
  </div>`;
    }

    async function renderServerRolesTab() {
      const roles = await loadRoles(S.activeSrv.id, true);
      const manage = canManageRoles();

      return `<div style="padding:16px">
    ${roles.map(r => `
      <div class="setting-card">
        <div style="width:16px;height:16px;border-radius:50%;background:${hexRoleColor(r.color)};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;color:${hexRoleColor(r.color)}">${esc(r.name)}</div>
          <div class="small-muted">Perms: ${r.permissions} · Pos: ${r.position}${r.is_everyone ? ' · @everyone' : ''}</div>
        </div>
        ${manage && !r.is_everyone ? `
          <div class="up-btn" onclick="moveRolePosition('${r.id}',-1)" title="Move Up"><i data-lucide="chevron-up" style="width:14px;height:14px"></i></div>
          <div class="up-btn" onclick="moveRolePosition('${r.id}',1)" title="Move Down"><i data-lucide="chevron-down" style="width:14px;height:14px"></i></div>
          <div class="up-btn" onclick="openEditRole('${r.id}')" title="Edit"><i data-lucide="pencil" style="width:14px;height:14px"></i></div>
          <div class="up-btn" onclick="deleteRole('${r.id}')" title="Delete"><i data-lucide="trash-2" style="width:14px;height:14px"></i></div>
        ` : ''}
      </div>
    `).join('')}

    ${manage ? `
      <button class="btn btn-primary" style="width:100%;margin-top:12px" onclick="openCreateRole()">Create Role</button>
    ` : `<div class="small-muted">You don't have permission to manage roles.</div>`}
  </div>`;
    }

    async function renderServerInvitesTab() {
      const canManage = canManageServer();
      let invites = [];
      let listHtml = '';

      if (canManage) {
        invites = await GET(`/servers/${S.activeSrv.id}/invites`);
        listHtml = invites.length
          ? invites.map(inv => `
        <div class="setting-card">
          <div style="flex:1">
            <div class="mono" style="color:var(--brand);font-size:13px">${esc(inv.code)}</div>
            <div class="small-muted">Uses: ${inv.uses}${inv.max_uses ? ` / ${inv.max_uses}` : ''}</div>
          </div>
          <div class="up-btn" onclick="navigator.clipboard.writeText('${escA(inv.code)}').then(()=>toast('Copied','ok'))"><i data-lucide="copy" style="width:14px;height:14px"></i></div>
          <div class="up-btn" onclick="revokeInvite('${inv.code}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></div>
        </div>
      `).join('')
          : '<div class="small-muted">No invites yet.</div>';
      } else {
        listHtml = '<div class="small-muted">Invite listing requires Manage Server. You can still create an invite if you have the permission.</div>';
      }

      return `<div style="padding:16px">
    ${listHtml}
    ${canCreateInvites() ? `<button class="btn btn-primary" style="width:100%;margin-top:12px" onclick="showInvite('${S.activeSrv.id}')">Create Invite</button>` : ''}
  </div>`;
    }

    async function renderServerMembersTab() {
      const [members, roles] = await Promise.all([
        GET(`/servers/${S.activeSrv.id}/members?limit=100`),
        loadRoles(S.activeSrv.id, true),
      ]);

      S.members[S.activeSrv.id] = members;
      members.forEach(m => {
        if (m.user?.status) S.presence[m.user_id] = m.user.status;
      });

      let rows = '';
      for (const m of members) {
        const u = m.user || { id: m.user_id, username: m.user_id };
        const st = S.presence[m.user_id] || u.status || 'offline';
        const nick = m.nickname || '';
        rows += `<div class="setting-card member-row" data-name="${escA((u.username || '').toLowerCase())}">
      ${avHTML(u, 36, st, 'var(--bg-card)')}
      <div style="flex:1;min-width:0">
        <div style="font-weight:700">${esc(nick || u.username)} ${m.user_id === S.activeSrv.owner_id ? '👑' : ''}</div>
        <div class="small-muted">${esc(u.username)} · ${esc(m.user_id)}</div>
      </div>
      <div class="setting-card-actions">
        <div class="up-btn" onclick="showUserProfile('${m.user_id}')" title="Profile"><i data-lucide="user" style="width:14px;height:14px"></i></div>
        ${canManageRoles() ? `<div class="up-btn" onclick="manageRoles('${m.user_id}')" title="Roles"><i data-lucide="shield" style="width:14px;height:14px"></i></div>` : ''}
        ${canManageRoles() ? `<div class="up-btn" onclick="editNickname('${m.user_id}','${escA(nick)}')" title="Nickname"><i data-lucide="badge-plus" style="width:14px;height:14px"></i></div>` : ''}
        ${canKickMembers() && m.user_id !== S.me?.id && m.user_id !== S.activeSrv.owner_id ? `<div class="up-btn" onclick="kickUser('${m.user_id}')" title="Kick"><i data-lucide="user-minus" style="width:14px;height:14px"></i></div>` : ''}
        ${canBanMembers() && m.user_id !== S.me?.id && m.user_id !== S.activeSrv.owner_id ? `<div class="up-btn" onclick="banUser('${m.user_id}')" title="Ban"><i data-lucide="ban" style="width:14px;height:14px"></i></div>` : ''}
      </div>
    </div>`;
      }

      return `<div style="padding:16px">
    <input class="fi member-search" id="members-tab-search" type="text" placeholder="Search members..." oninput="filterMembersTab()">
    <div id="members-tab-list">${rows || '<div class="small-muted">No members.</div>'}</div>
  </div>`;
    }

    async function renderServerBansTab() {
      if (!canBanMembers()) {
        return `<div style="padding:16px"><div class="small-muted">You don't have permission to view bans.</div></div>`;
      }

      const bans = await GET(`/servers/${S.activeSrv.id}/bans`);
      return `<div style="padding:16px">
    ${bans.length ? bans.map(b => `
      <div class="setting-card">
        <div style="flex:1">
          <div style="font-weight:700">${esc(b.user_id)}</div>
          <div class="small-muted">${esc(b.reason || 'No reason')} · ${fullTimeFmt(new Date(b.banned_at))}</div>
        </div>
        <button class="btn btn-secondary" style="padding:6px 10px" onclick="unbanUser('${b.user_id}')">Unban</button>
      </div>
    `).join('') : '<div class="small-muted">No bans.</div>'}
  </div>`;
    }

    async function renderServerAuditTab() {
      if (!canViewAudit()) {
        return `<div style="padding:16px"><div class="small-muted">You don't have permission to view audit logs.</div></div>`;
      }

      const logs = await GET(`/servers/${S.activeSrv.id}/audit-logs?limit=100`);
      return `<div style="padding:16px">
    ${logs.length ? logs.map(l => `
      <div class="setting-card col">
        <div style="font-weight:700">${esc(l.action)}</div>
        <div class="small-muted">Actor: ${esc(l.actor_id)}${l.target_id ? ` · Target: ${esc(l.target_id)}` : ''}</div>
        ${l.reason ? `<div class="small-muted">Reason: ${esc(l.reason)}</div>` : ''}
        <div class="small-muted">${fullTimeFmt(new Date(l.created_at))}</div>
      </div>
    `).join('') : '<div class="small-muted">No audit entries.</div>'}
  </div>`;
    }

    async function saveSrvSettings() {
      const body = {};
      const name = document.getElementById('srv-name').value.trim();
      const icon = document.getElementById('srv-icon').value.trim();
      const banner = document.getElementById('srv-banner').value.trim();

      if (!name) return;
      if (name !== S.activeSrv.name) body.name = name;
      if (icon !== (S.activeSrv.icon_url || '')) body.icon_url = icon || null;
      if (banner !== (S.activeSrv.banner_url || '')) body.banner_url = banner || null;
      if (!Object.keys(body).length) return toast('No changes', 'ok');

      try {
        const updated = await PATCH(`/servers/${S.activeSrv.id}`, body);
        Object.assign(S.activeSrv, updated);
        renderRail();
        renderSidebarTop();
        toast('Server updated', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    async function deleteSrv(id) {
      showConfirm('Delete Server', 'This cannot be undone. Delete this server?', async () => {
        try {
          await DELETE_(`/servers/${id}`);
          removeServerLocal(id);
          closeModal('m-srv-settings');
          toast('Server deleted', 'ok');
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }

    async function leaveSrv(id) {
      showConfirm('Leave Server', 'Leave this server?', async () => {
        try {
          await DELETE_(`/servers/${id}/@me`);
          removeServerLocal(id);
          closeModal('m-srv-settings');
          toast('You left the server', 'ok');
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }

    function filterMembersTab() {
      const q = (document.getElementById('members-tab-search')?.value || '').toLowerCase();
      document.querySelectorAll('#members-tab-list .member-row').forEach(row => {
        const name = row.dataset.name || '';
        row.style.display = name.includes(q) ? '' : 'none';
      });
    }

    async function kickUser(uid) {
      if (!S.activeSrv) return;
      showConfirm('Kick User', 'Kick this user from the server?', async () => {
        try {
          await DELETE_(`/servers/${S.activeSrv.id}/members/${uid}`);
          toast('User kicked', 'ok');
          loadMembers(S.activeSrv.id, true);
          if (document.getElementById('m-srv-settings').style.display === 'flex' && S.settingsTab === 'members') {
            loadServerSettingsData('members');
          }
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }

    async function banUser(uid) {
      if (!S.activeSrv) return;
      showPrompt('Ban User', 'Enter optional reason:', '', async (reason) => {
        try {
          await PUT(`/servers/${S.activeSrv.id}/bans/${uid}`, { reason: reason || null });
          toast('User banned', 'ok');
          loadMembers(S.activeSrv.id, true);
          if (document.getElementById('m-srv-settings').style.display === 'flex') {
            if (S.settingsTab === 'members' || S.settingsTab === 'bans') loadServerSettingsData(S.settingsTab);
          }
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }

    async function unbanUser(uid) {
      if (!S.activeSrv) return;
      showConfirm('Unban User', `Unban ${uid}?`, async () => {
        try {
          await DELETE_(`/servers/${S.activeSrv.id}/bans/${uid}`);
          toast('User unbanned', 'ok');
          if (document.getElementById('m-srv-settings').style.display === 'flex' && S.settingsTab === 'bans') {
            loadServerSettingsData('bans');
          }
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }

    async function editNickname(uid, current = '') {
      if (!S.activeSrv) return;
      showPrompt('Set Nickname', 'Enter nickname (empty to clear):', current || '', async (nickname) => {
        try {
          await PATCH(`/servers/${S.activeSrv.id}/members/${uid}`, { nickname: nickname || null });
          toast('Nickname updated', 'ok');
          loadMembers(S.activeSrv.id, true);
          if (document.getElementById('m-srv-settings').style.display === 'flex' && S.settingsTab === 'members') {
            loadServerSettingsData('members');
          }
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }

    // ═══════════════════════════════════════════════════
