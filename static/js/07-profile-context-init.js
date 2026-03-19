    //  Role editor / role management
    // ═══════════════════════════════════════════════════
    function buildRolePerms(bits = 0) {
      const wrap = document.getElementById('role-perms');
      wrap.innerHTML = ROLE_PERMS.map(([key, label, desc]) => {
        const bit = PERM[key];
        const checked = hasBits(bits, bit);
        const disabled = key === 'ADMINISTRATOR' ? '' : '';
        return `<label class="setting-card" style="cursor:pointer">
      <input class="ui-check" type="checkbox" data-role-perm="${key}" ${checked ? 'checked' : ''} ${disabled}>
      <div style="flex:1">
        <div style="font-weight:700">${label}</div>
        <div class="small-muted">${desc}</div>
      </div>
    </label>`;
      }).join('');
    }

    function collectRolePermBits() {
      let bits = 0;
      document.querySelectorAll('[data-role-perm]').forEach(cb => {
        if (cb.checked) bits |= PERM[cb.dataset.rolePerm] || 0;
      });
      return bits;
    }

    function openCreateRole() {
      S.roleEditorRole = null;
      document.getElementById('role-editor-title').textContent = 'Create Role';
      document.getElementById('role-editor-save').textContent = 'Create';
      document.getElementById('role-name').value = '';
      document.getElementById('role-color').value = '#5865f2';
      document.getElementById('role-mentionable').value = 'true';
      document.getElementById('role-hoisted').value = 'false';
      buildRolePerms(0);
      openModal('m-role-editor');
      lucide.createIcons();
    }

    async function openEditRole(roleId) {
      const roles = await loadRoles(S.activeSrv.id, true);
      const role = roles.find(r => r.id === roleId);
      if (!role) return;
      S.roleEditorRole = role;
      document.getElementById('role-editor-title').textContent = 'Edit Role';
      document.getElementById('role-editor-save').textContent = 'Save';
      document.getElementById('role-name').value = role.name || '';
      document.getElementById('role-color').value = hexRoleColor(role.color || 0);
      document.getElementById('role-mentionable').value = String(!!role.is_mentionable);
      document.getElementById('role-hoisted').value = String(!!role.is_hoisted);
      buildRolePerms(role.permissions || 0);
      openModal('m-role-editor');
      lucide.createIcons();
    }

    async function saveRoleEditor() {
      if (!S.activeSrv) return;
      const name = document.getElementById('role-name').value.trim();
      if (!name) return;

      const body = {
        name,
        color: parseInt(document.getElementById('role-color').value.replace('#', ''), 16),
        permissions: collectRolePermBits(),
        is_mentionable: document.getElementById('role-mentionable').value === 'true',
        is_hoisted: document.getElementById('role-hoisted').value === 'true',
      };

      try {
        if (S.roleEditorRole) {
          const out = await PATCH(`/servers/${S.activeSrv.id}/roles/${S.roleEditorRole.id}`, body);
          const roles = S.roles[S.activeSrv.id] || [];
          const idx = roles.findIndex(r => r.id === out.id);
          if (idx >= 0) roles[idx] = out;
          closeModal('m-role-editor');
          toast('Role updated', 'ok');
        } else {
          const out = await POST(`/servers/${S.activeSrv.id}/roles`, body);
          if (!S.roles[S.activeSrv.id]) S.roles[S.activeSrv.id] = [];
          S.roles[S.activeSrv.id].push(out);
          closeModal('m-role-editor');
          toast('Role created', 'ok');
        }
        await loadServerSettingsData('roles');
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    async function deleteRole(roleId) {
      showConfirm('Delete Role', 'Delete this role?', async () => {
        try {
          await DELETE_(`/servers/${S.activeSrv.id}/roles/${roleId}`);
          S.roles[S.activeSrv.id] = (S.roles[S.activeSrv.id] || []).filter(r => r.id !== roleId);
          toast('Role deleted', 'ok');
          loadServerSettingsData('roles');
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }

    async function manageRoles(uid, refreshOnly = false) {
      if (!S.activeSrv) return;
      S.managingRolesUserId = uid;
      if (!refreshOnly) openModal('m-manage-roles');

      const body = document.getElementById('manage-roles-body');
      body.innerHTML = `<div class="empty"><i data-lucide="loader-circle" class="spin" style="width:24px;height:24px"></i></div>`;
      lucide.createIcons();

      try {
        const [roles, memberRoles] = await Promise.all([
          loadRoles(S.activeSrv.id, true),
          GET(`/servers/${S.activeSrv.id}/members/${uid}/roles`)
        ]);
        const current = new Set(memberRoles.map(r => r.id));
        body.innerHTML = roles.filter(r => !r.is_everyone).map(r => `
      <label class="setting-card" style="cursor:pointer">
        <input class="ui-check" type="checkbox" ${current.has(r.id) ? 'checked' : ''} onchange="toggleUserRole('${uid}','${r.id}',this.checked)">
        <div style="width:14px;height:14px;border-radius:50%;background:${hexRoleColor(r.color)}"></div>
        <div style="flex:1">
          <div style="font-weight:700">${esc(r.name)}</div>
          <div class="small-muted">Permissions: ${r.permissions}</div>
        </div>
      </label>
    `).join('') || '<div class="empty"><p>No roles available</p></div>';
      } catch (e) {
        body.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`;
      }
      lucide.createIcons();
    }

    async function moveRolePosition(roleId, direction) {
      if (!S.activeSrv) return;
      const roles = (await loadRoles(S.activeSrv.id, true)).filter(r => !r.is_everyone);
      const ordered = roles.slice().sort((a, b) => b.position - a.position);
      const idx = ordered.findIndex(r => r.id === roleId);
      const swapIdx = idx + direction;
      if (idx < 0 || swapIdx < 0 || swapIdx >= ordered.length) return;

      const next = ordered.slice();
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];

      try {
        await PATCH(`/servers/${S.activeSrv.id}/roles/positions`, next.map((r, index) => ({
          id: r.id,
          position: next.length - index,
        })));
        await loadRoles(S.activeSrv.id, true);
        await loadMembers(S.activeSrv.id, true);
        await loadServerSettingsData('roles');
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    async function toggleUserRole(uid, roleId, add) {
      try {
        if (add) await PUT(`/servers/${S.activeSrv.id}/members/${uid}/roles/${roleId}`, {});
        else await DELETE_(`/servers/${S.activeSrv.id}/members/${uid}/roles/${roleId}`);
        toast('Roles updated', 'ok');
      } catch (e) {
        toast(e.message, 'err');
        manageRoles(uid, true);
      }
    }

    // ═══════════════════════════════════════════════════
    //  Profile / user actions
    // ═══════════════════════════════════════════════════
    async function showUserProfile(uid) {
      closeAllPopups();
      const body = document.getElementById('profile-body');
      body.innerHTML = `<div class="empty"><i data-lucide="loader-circle" class="spin" style="width:24px;height:24px"></i></div>`;
      openModal('m-profile');
      lucide.createIcons();

      try {
        const user = await GET(`/users/${uid}`);
        const status = S.presence[uid] || user.status || 'offline';
        const isMe = uid === S.me?.id;
        const bannerStyle = user.banner_url
          ? `background:url(${escA(user.banner_url)}) center/cover;height:90px`
          : `background:#5865F2;height:90px`;

        body.innerHTML = `
      <div style="${bannerStyle};position:relative">
        <div style="position:absolute;left:16px;bottom:-32px">
          <div class="av" style="width:64px;height:64px;font-size:24px;background:${colorFor(user.id)}">
            ${user.avatar_url ? `<img src="${escA(user.avatar_url)}" style="border-radius:50%">` : initials(user.username)}
            <div class="av-status ${status}" style="width:18px;height:18px;border:3px solid var(--bg-modal)"></div>
          </div>
        </div>
      </div>
      <div style="padding:42px 16px 16px">
        <div style="font-size:18px;font-weight:700">${esc(user.username)}<span style="font-size:14px;color:var(--t3);font-weight:400">#${user.discriminator || '0000'}</span></div>
        <div class="small-muted">${esc(status)}</div>
        ${user.bio ? `<div style="margin-top:12px;color:var(--t2)">${esc(user.bio)}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:16px">
          ${!isMe ? `<button class="btn btn-primary" style="flex:1" onclick="sendDMTo('${uid}')">Message</button>` : ''}
        </div>
      </div>
    `;
      } catch (e) {
        body.innerHTML = `<div class="empty"><p style="color:var(--danger)">Failed to load user</p></div>`;
      }
      lucide.createIcons();
    }

    async function sendDMTo(uid) {
      closeModal('m-profile');
      try {
        const ch = await POST('/users/@me/channels', { recipient_id: uid });
        await hydrateDMChannel(ch, uid);
        await loadRelationships();

        if (!S.inDMs) showDMs();
        else renderDMList();

        const local = findChannel(ch.id);
        if (local?.can_open !== false) {
          await pickCh(local || ch);
        } else {
          toast('DM request sent', 'ok');
        }
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    // ═══════════════════════════════════════════════════
    //  Status popup
    // ═══════════════════════════════════════════════════
    function toggleStatusPopup(event) {
      event.stopPropagation();
      const p = document.getElementById('status-popup');
      if (p.style.display === 'block') {
        p.style.display = 'none';
        return;
      }
      p.style.display = 'block';
      const rect = document.getElementById('up-av-wrap').getBoundingClientRect();
      p.style.left = rect.left + 'px';
      p.style.top = Math.max(8, rect.top - p.offsetHeight - 8) + 'px';
      lucide.createIcons();
    }

    async function setStatus(st) {
      closeAllPopups();
      try {
        await PATCH('/users/@me/presence', { status: st });
        S.me.status = st;
        S.presence[S.me.id] = st;
        updatePanel(S.me);
        refreshPresence(S.me.id);
        toast('Status updated', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    // ═══════════════════════════════════════════════════
    //  Context menus
    // ═══════════════════════════════════════════════════
    function ctxMenu(event, items) {
      event.preventDefault();
      event.stopPropagation();
      _ctxItems = items;
      const m = document.getElementById('ctx-menu');
      m.innerHTML = items.map((item, i) => {
        if (!item) return '<div class="ctx-sep"></div>';
        return `<div class="ctx-item${item.cls ? ' ' + item.cls : ''}" onclick="ctxRun(${i})">
      <i data-lucide="${item.icon}" style="width:14px;height:14px;flex-shrink:0"></i>
      ${esc(item.label)}
    </div>`;
      }).join('');
      m.style.display = 'block';
      m.style.left = Math.min(event.clientX, window.innerWidth - 220) + 'px';
      m.style.top = Math.min(event.clientY, window.innerHeight - m.scrollHeight - 20) + 'px';
      lucide.createIcons();
    }
    function ctxRun(i) {
      const fn = _ctxItems[i]?.fn;
      closeAllPopups();
      if (fn) fn();
    }

    function srvCtx(event, srvId) {
      const srv = findServer(srvId);
      if (!srv) return;
      ctxMenu(event, [
        canCreateInvites() || isOwner(srv) ? { icon: 'link-2', label: 'Invite People', fn: () => showInvite(srvId) } : null,
        canManageChannels() || isOwner(srv) ? { icon: 'plus-circle', label: 'Create Channel', fn: () => { selectServer(srvId).then(() => openCreateCh(null)); } } : null,
        { icon: 'settings', label: 'Server Settings', fn: () => { selectServer(srvId).then(() => openServerSettings()); } },
        null,
        { icon: 'copy', label: 'Copy Server ID', fn: () => navigator.clipboard.writeText(srvId).then(() => toast('Copied', 'ok')) },
        null,
        isOwner(srv)
          ? { icon: 'trash-2', label: 'Delete Server', cls: 'danger', fn: () => deleteSrv(srvId) }
          : { icon: 'log-out', label: 'Leave Server', cls: 'danger', fn: () => leaveSrv(srvId) }
      ].filter(x => x !== null));
    }

    function chCtx(event, chId) {
      const ch = findChannel(chId);
      if (!ch) return;
      if (ch.type === 'group') {
        ctxMenu(event, [
          { icon: 'share-2', label: 'Share Group', fn: () => showGroupShare(ch.id) },
          { icon: 'pencil', label: 'Rename Group', fn: () => renameGroup(ch.id, ch.name || 'Group') },
          { icon: 'log-out', label: 'Leave Group', cls: 'danger', fn: () => closeDM(ch.id) },
          null,
          { icon: 'copy', label: 'Copy Channel ID', fn: () => navigator.clipboard.writeText(ch.id).then(() => toast('Copied', 'ok')) },
        ]);
        return;
      }
      const editLabel = ch.type === 'category' ? 'Edit Category' : 'Edit Channel';
      ctxMenu(event, [
        { icon: 'copy', label: 'Copy Channel ID', fn: () => navigator.clipboard.writeText(ch.id).then(() => toast('Copied', 'ok')) },
        { icon: 'pin', label: 'Pinned Messages', fn: () => { pickCh(ch).then(() => setTimeout(openPins, 100)); } },
        canManageChannels() && ch.server_id ? null : null,
        canManageChannels() && ch.server_id ? { icon: 'pencil', label: editLabel, fn: () => openEditChannel(ch.id) } : null,
        canManageChannels() && ch.server_id ? { icon: 'trash-2', label: 'Delete Channel', cls: 'danger', fn: () => deleteCh(ch.id) } : null
      ].filter((x, idx, arr) => x !== null || (arr[idx + 1] || arr[idx - 1])));
    }

    async function renameGroup(channelId, currentName) {
      showPrompt('Rename Group', 'Enter the new group name:', currentName || '', async (name) => {
        if (!name) return;
        try {
          await PATCH(`/channels/${channelId}`, { name });
          await loadRelationships();
          if (S.activeCh?.id === channelId) {
            S.activeCh = findChannel(channelId) || S.activeCh;
            updateHeader();
          }
          toast('Group renamed', 'ok');
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }

    function userCtx(event, uid) {
      const notMe = uid !== S.me?.id;
      ctxMenu(event, [
        { icon: 'user', label: 'View Profile', fn: () => showUserProfile(uid) },
        notMe ? { icon: 'message-square', label: 'Send Message', fn: () => sendDMTo(uid) } : null,
        { icon: 'copy', label: 'Copy User ID', fn: () => navigator.clipboard.writeText(uid).then(() => toast('Copied', 'ok')) },
        notMe && canManageRoles() ? null : null,
        notMe && canManageRoles() ? { icon: 'shield', label: 'Manage Roles', fn: () => manageRoles(uid) } : null,
        notMe && canKickMembers() ? { icon: 'user-minus', label: 'Kick', cls: 'danger', fn: () => kickUser(uid) } : null,
        notMe && canBanMembers() ? { icon: 'ban', label: 'Ban', cls: 'danger', fn: () => banUser(uid) } : null,
      ].filter((x, idx, arr) => x !== null || (arr[idx + 1] || arr[idx - 1])));
    }

    function msgCtx(event, msgId) {
      const m = findMessageById(msgId);
      if (!m) return;
      ctxMenu(event, [
        { icon: 'copy', label: 'Copy Content', fn: () => navigator.clipboard.writeText(m.content || '').then(() => toast('Copied', 'ok')) },
        { icon: 'link', label: 'Copy Message ID', fn: () => navigator.clipboard.writeText(m.id).then(() => toast('Copied', 'ok')) },
        { icon: 'reply', label: 'Reply', fn: () => setReplyById(msgId) },
      ]);
    }

    // ═══════════════════════════════════════════════════
    //  Modals / prompt / confirm / misc
    // ═══════════════════════════════════════════════════
    function openModal(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.zIndex = ++_modalZ;
      el.style.display = 'flex';
      lucide.createIcons();
    }
    function closeModal(id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.display = 'none';
    }
    function overlayClick(e, id) {
      if (e.target.classList.contains('overlay')) closeModal(id);
    }
    function closeAllPopups() {
      document.getElementById('status-popup').style.display = 'none';
      document.getElementById('ctx-menu').style.display = 'none';
      closeSrvDropdown();
    }
    function showPrompt(title, message, defaultValue, cb) {
      document.getElementById('prompt-title').textContent = title;
      document.getElementById('prompt-message').textContent = message;
      document.getElementById('prompt-input').value = defaultValue || '';
      _promptCb = cb;
      openModal('m-prompt');
      setTimeout(() => document.getElementById('prompt-input').focus(), 50);
    }
    function confirmPrompt() {
      const val = document.getElementById('prompt-input').value.trim();
      closeModal('m-prompt');
      const cb = _promptCb;
      _promptCb = null;
      if (cb) cb(val);
    }
    function closePrompt() {
      _promptCb = null;
      closeModal('m-prompt');
    }
    function showConfirm(title, message, cb) {
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-message').textContent = message;
      _confirmCb = cb;
      openModal('m-confirm');
    }
    function confirmAction() {
      closeModal('m-confirm');
      const cb = _confirmCb;
      _confirmCb = null;
      if (cb) cb();
    }
    function closeConfirm() {
      _confirmCb = null;
      closeModal('m-confirm');
    }

    function toggleCat(id) {
      if (!window.__catCollapsed) window.__catCollapsed = {};
      window.__catCollapsed[id] = !window.__catCollapsed[id];
      renderChs();
    }

    function toggleSrvDropdown(event) {
      event.stopPropagation();
      if (S.inDMs || !S.activeSrv) return;

      const dd = document.getElementById('srv-dropdown');
      const chevron = document.getElementById('side-chevron');
      if (dd.style.display === 'block') {
        closeSrvDropdown();
        return;
      }

      const items = [];
      if (canCreateInvites() || isOwner()) items.push(`<div class="ctx-item" onclick="closeSrvDropdown();showInvite('${S.activeSrv.id}')"><i data-lucide="link-2" style="width:14px;height:14px"></i>Invite People</div>`);
      items.push(`<div class="ctx-item" onclick="closeSrvDropdown();openServerSettings()"><i data-lucide="settings" style="width:14px;height:14px"></i>Server Settings</div>`);
      if (canManageChannels()) items.push(`<div class="ctx-item" onclick="closeSrvDropdown();openCreateCh(null)"><i data-lucide="plus-circle" style="width:14px;height:14px"></i>Create Channel</div>`);
      items.push('<div class="ctx-sep"></div>');
      if (isOwner()) items.push(`<div class="ctx-item danger" onclick="closeSrvDropdown();deleteSrv('${S.activeSrv.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i>Delete Server</div>`);
      else items.push(`<div class="ctx-item danger" onclick="closeSrvDropdown();leaveSrv('${S.activeSrv.id}')"><i data-lucide="log-out" style="width:14px;height:14px"></i>Leave Server</div>`);

      dd.innerHTML = items.join('');
      dd.style.display = 'block';
      chevron.style.transform = 'rotate(180deg)';
      lucide.createIcons();
    }
    function closeSrvDropdown() {
      document.getElementById('srv-dropdown').style.display = 'none';
      document.getElementById('side-chevron').style.transform = '';
    }

    function tip(event, text) {
      const t = document.getElementById('tooltip');
      t.textContent = text;
      t.style.display = 'block';
      t.style.left = (event.clientX + 16) + 'px';
      t.style.top = (event.clientY - 4) + 'px';
    }
    function hideTip() {
      document.getElementById('tooltip').style.display = 'none';
    }

    function toast(msg, type = 'ok') {
      const el = document.createElement('div');
      el.className = `toast ${type}`;
      const icon = type === 'err' ? 'alert-circle' : 'check-circle';
      el.innerHTML = `<i data-lucide="${icon}" style="width:16px;height:16px;flex-shrink:0"></i>${esc(msg)}`;
      document.body.appendChild(el);
      lucide.createIcons();
      setTimeout(() => {
        el.style.transition = 'opacity .25s';
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 250);
      }, 2800);
    }

    function applyLightboxTransform() {
      const img = document.getElementById('lb-img');
      const stage = document.getElementById('lb-stage');
      img.style.transform = `translate(${_viewer.x}px, ${_viewer.y}px) scale(${_viewer.scale})`;
      stage.classList.toggle('dragging', _viewer.dragging);
    }

    function resetLightbox() {
      _viewer.scale = 1;
      _viewer.x = 0;
      _viewer.y = 0;
      applyLightboxTransform();
    }

    function openMediaViewer(src, title = 'Image Viewer') {
      const img = document.getElementById('lb-img');
      img.src = src;
      img.alt = title || 'Image Viewer';
      document.getElementById('lb-download').href = src;
      document.getElementById('lightbox').style.display = 'flex';
      _viewer.open = true;
      resetLightbox();
      lucide.createIcons();
    }

    function closeLightbox() {
      document.getElementById('lightbox').style.display = 'none';
      _viewer.open = false;
      _viewer.dragging = false;
      _viewer.moved = false;
      _viewer.ignoreClose = false;
    }

    function zoomLightboxBy(delta) {
      _viewer.scale = Math.max(0.3, Math.min(6, _viewer.scale * (delta > 0 ? 1 + delta : 1 / (1 + Math.abs(delta)))));
      if (_viewer.scale === 1) {
        _viewer.x = 0;
        _viewer.y = 0;
      }
      applyLightboxTransform();
    }

    function startLightboxPan(event) {
      if (!_viewer.open || event.button !== 0) return;
      _viewer.dragging = true;
      _viewer.moved = false;
      _viewer.startX = event.clientX - _viewer.x;
      _viewer.startY = event.clientY - _viewer.y;
      applyLightboxTransform();
    }

    function moveLightboxPan(event) {
      if (!_viewer.dragging) return;
      const nextX = event.clientX - _viewer.startX;
      const nextY = event.clientY - _viewer.startY;
      if (Math.abs(nextX - _viewer.x) > 1 || Math.abs(nextY - _viewer.y) > 1) {
        _viewer.moved = true;
      }
      _viewer.x = nextX;
      _viewer.y = nextY;
      applyLightboxTransform();
    }

    function handleLightboxBackdropClick(event) {
      if (_viewer.ignoreClose) return;
      if (event.target.id === 'lightbox' || event.target.id === 'lb-stage') {
        closeLightbox();
      }
    }

    function releaseLightboxCloseLock() {
      setTimeout(() => {
        _viewer.ignoreClose = false;
      }, 0);
    }

    function endLightboxPan() {
      if (!_viewer.dragging) return;
      _viewer.dragging = false;
      if (_viewer.moved) {
        _viewer.ignoreClose = true;
        releaseLightboxCloseLock();
      }
      applyLightboxTransform();
    }

    // ═══════════════════════════════════════════════════
    //  Init / events
    // ═══════════════════════════════════════════════════
    document.addEventListener('click', () => closeAllPopups());
    document.addEventListener('contextmenu', event => {
      event.preventDefault();

      const customContextTarget = event.target.closest('[oncontextmenu], #ctx-menu, #srv-dropdown');
      if (customContextTarget) return;

      closeAllPopups();

      const clickTarget = event.target.closest('button, a, label, [onclick]');
      if (clickTarget) clickTarget.click();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.overlay').forEach(o => {
          if (o.style.display !== 'none') o.style.display = 'none';
        });
        closeAllPopups();
        closeLightbox();
        if (S.editingId) cancelEdit();
        closeSearchModal();
      }
    });

    document.getElementById('msgs-wrap').addEventListener('scroll', () => {
      if (isAtBottom()) hideJumpToBottom();
    });
    document.getElementById('lb-img').addEventListener('mousedown', event => {
      event.preventDefault();
      startLightboxPan(event);
    });
    document.getElementById('lb-stage').addEventListener('wheel', event => {
      event.preventDefault();
      zoomLightboxBy(event.deltaY < 0 ? 0.18 : -0.18);
    }, { passive: false });
    window.addEventListener('mousemove', moveLightboxPan);
    window.addEventListener('mouseup', endLightboxPan);

    ['in-user', 'in-pass'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') doLogin();
      });
    });
    ['up-username', 'up-pass'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') doRegister();
      });
    });

    document.querySelectorAll('form, input, textarea').forEach(el => {
      el.setAttribute('autocomplete', 'off');
      el.setAttribute('autocapitalize', 'off');
      el.setAttribute('autocorrect', 'off');
      el.setAttribute('spellcheck', 'false');
    });

    (async () => {
      lucide.createIcons();
      if (S.token) {
        try {
          const me = await GET('/users/@me');
          if (me) {
            S.me = me;
            await boot();
            return;
          }
        } catch { }
        localStorage.removeItem('h_token');
        S.token = null;
      }
      document.getElementById('auth-screen').style.display = 'flex';
    })();
