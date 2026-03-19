    //  Presence / panel
    // ═══════════════════════════════════════════════════
    function updatePanel(u) {
      if (!u) return;
      const st = u.status || S.presence[u.id] || 'offline';
      document.getElementById('up-av-wrap').innerHTML = avHTML(u, 32, st, 'var(--bg-rail)');
      document.getElementById('up-name').textContent = u.username || '—';
      document.getElementById('up-tag').textContent = `#${u.discriminator || '0000'}`;
      document.getElementById('sp-name').textContent = u.username || '—';
      document.getElementById('sp-disc').textContent = `#${u.discriminator || '0000'}`;
      lucide.createIcons();
    }

    function refreshPresence(uid) {
      if (uid === S.me?.id) {
        S.me.status = S.presence[uid] || S.me.status;
        updatePanel(S.me);
      }
      renderML();
      if (S.inDMs) renderDMList();
      renderMsgs({ preserveBottom: true });
    }

    function handleUserUpdate(d) {
      if (d.id === S.me?.id) {
        Object.assign(S.me, d);
        if (d.status) S.presence[d.id] = d.status;
        updatePanel(S.me);
      }

      if (d.status) S.presence[d.id] = d.status;

      // Update DM cached identities
      for (const c of allDMEntries()) {
        if (c._otherId === d.id) {
          if (d.username) c._name = d.username;
          if (d.avatar_url !== undefined) c._otherAv = d.avatar_url;
          const stored = getStoredDMInfo(c.id) || {};
          storeDMInfo(c.id, {
            ...stored,
            name: c._name,
            otherId: c._otherId,
            otherAv: c._otherAv,
            status: S.presence[d.id] || stored.status || 'offline',
          });
        }
      }

      // Update server members cache
      for (const sid of Object.keys(S.members)) {
        (S.members[sid] || []).forEach(m => {
          if (m.user_id === d.id && m.user) {
            if (d.username) m.user.username = d.username;
            if (d.avatar_url !== undefined) m.user.avatar_url = d.avatar_url;
            if (d.bio !== undefined) m.user.bio = d.bio;
            if (d.banner_url !== undefined) m.user.banner_url = d.banner_url;
            if (d.status) m.user.status = d.status;
          }
        });
      }

      // Update messages cache authors
      for (const cid of Object.keys(S.messages)) {
        (S.messages[cid] || []).forEach(m => {
          if (m.author_id === d.id && m.author) {
            if (d.username) m.author.username = d.username;
            if (d.avatar_url !== undefined) m.author.avatar_url = d.avatar_url;
            if (d.status) m.author.status = d.status;
          }
          if (m.reply_to && m.reply_to.author_username && S.me?.id === d.id && d.username) {
            // no direct mapping available for reply author id in payload
          }
        });
      }

      if (S.inDMs) renderDMList();
      renderML();
      renderMsgs({ preserveBottom: true });
    }

    // ═══════════════════════════════════════════════════
    //  Rail / Sidebar
    // ═══════════════════════════════════════════════════
    function countServerUnread(srvId) {
      return Object.entries(S.unread).reduce((acc, [cid, v]) => {
        return acc + (channelServerId(cid) === srvId ? Number(v || 0) : 0);
      }, 0);
    }
    function clearUnread(channelId) {
      delete S.unread[channelId];
      hideJumpToBottom();
      renderRail();
      if (S.inDMs) renderDMList();
      else renderChs();
    }
    function addUnread(channelId) {
      S.unread[channelId] = Number(S.unread[channelId] || 0) + 1;
      renderRail();
      if (S.inDMs) renderDMList();
      else renderChs();
    }

    function renderRail() {
      const el = document.getElementById('rail-servers');
      const dmUnread = totalDMUnread();
      const railDM = document.getElementById('rail-dm');
      railDM.innerHTML = `<span class="rail-indicator"></span>
        <i data-lucide="message-square" style="width:22px;height:22px"></i>
        ${dmUnread > 0 ? `<div class="rail-badge">${dmUnread > 99 ? '99+' : dmUnread}</div>` : ''}`;
      el.innerHTML = S.servers.map(srv => {
        const active = S.activeSrv?.id === srv.id && !S.inDMs;
        const unreadN = countServerUnread(srv.id);
        const badge = unreadN > 0 ? `<div class="rail-badge">${unreadN > 99 ? '99+' : unreadN}</div>` : '';
        const inner = srv.icon_url
          ? `<img src="${escA(srv.icon_url)}" alt="">`
          : `<span>${initials(srv.name)}</span>`;

        return `<div class="rail-icon${active ? ' active' : ''}${unreadN > 0 && !active ? ' has-unread' : ''}"
      onclick="selectServer('${srv.id}')"
      oncontextmenu="srvCtx(event,'${srv.id}')"
      onmouseenter="tip(event,'${escA(srv.name)}')"
      onmouseleave="hideTip()">
      <span class="rail-indicator"></span>${inner}${badge}
    </div>`;
      }).join('<div style="height:6px"></div>');

      document.getElementById('rail-dm').classList.toggle('active', S.inDMs);
      lucide.createIcons();
    }

    function renderSidebarTop() {
      const top = document.getElementById('sidebar-top');
      const chevron = document.getElementById('side-chevron');
      document.getElementById('side-title').textContent = S.inDMs ? 'Direct Messages' : (S.activeSrv?.name || '—');
      chevron.style.display = S.inDMs ? 'none' : '';
      top.style.cursor = S.inDMs ? 'default' : 'pointer';
      top.classList.toggle('no-menu', !!S.inDMs);
    }

    async function selectServer(id) {
      const srv = findServer(id);
      if (!srv) return;

      S.inDMs = false;
      S.mlOpen = true;
      S.activeSrv = srv;
      S.activeCh = null;
      S.replyTo = null;
      S.editingId = null;
      clearReply();

      renderRail();
      renderSidebarTop();
      updateSrvSettingsBtn();
      updateMLBtn();
      syncMLPanel();
      closeSrvDropdown();

      await ensureServerPerms(id);

      try {
        S.channels[id] = await GET(`/servers/${id}/channels`);
        (S.channels[id] || []).forEach(ch => { S.channelServerMap[ch.id] = id; });
      } catch (e) {
        toast(e.message, 'err');
        return;
      }

      renderChs();
      renderMsgs();
      loadMembers(id, true);
      syncMLPanel();

      const first = (S.channels[id] || []).find(c => c.type === 'text');
      if (first) {
        await pickChById(first.id);
      } else {
        updateHeader();
      }
    }

    function showDMs(keepEmpty = false) {
      S.inDMs = true;
      S.activeSrv = null;
      if (keepEmpty) {
        S.activeCh = null;
      } else if (!S.activeCh || !['dm', 'group', 'note', 'friends_home', 'groups_home', 'docs_home'].includes(S.activeCh.type)) {
        S.activeCh = firstWritableDMChannel() || friendsHomeChannel();
      } else if (['friends_home', 'groups_home', 'docs_home'].includes(S.activeCh.type)) {
        const first = firstWritableDMChannel();
        if (first) S.activeCh = first;
      }
      renderRail();
      renderSidebarTop();
      renderDMList();
      renderMsgs();
      updateSrvSettingsBtn();
      updateMLBtn();
      syncMLPanel();
      closeSrvDropdown();
      updateHeader();
      if (!keepEmpty) focusComposer();
    }

    function renderChs() {
      const el = document.getElementById('ch-list');
      if (!S.activeSrv) return renderDMList();

      const chs = (S.channels[S.activeSrv.id] || []).slice().sort((a, b) => a.position - b.position);
      const canManage = canManageChannels();

      const cats = chs.filter(c => c.type === 'category');
      const orphans = chs.filter(c => c.type !== 'category' && !c.parent_id);

      let html = `<div style="display:flex;align-items:center;padding:12px 8px 4px">
    <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:var(--t3);flex:1">Channels</span>
    ${canManage ? `<div class="cat-add" onclick="openCreateCh(null)" title="New Channel" style="opacity:1;padding:4px;cursor:pointer">
      <i data-lucide="plus" style="width:15px;height:15px"></i>
    </div>` : ''}
  </div>`;

      orphans.forEach(c => html += channelItemHTML(c));

      cats.forEach(cat => {
        const collapsed = !!window.__catCollapsed?.[cat.id];
        const children = chs.filter(c => c.parent_id === cat.id).sort((a, b) => a.position - b.position);
        html += `<div class="cat-row${collapsed ? ' collapsed' : ''}" onclick="toggleCat('${cat.id}')" oncontextmenu="chCtx(event,'${cat.id}')">
      <i data-lucide="chevron-down" class="cat-chevron" style="width:12px;height:12px"></i>
      <span class="cat-label">${esc(cat.name)}</span>
      ${canManage ? `<div class="cat-add" onclick="event.stopPropagation();openCreateCh('${cat.id}')"><i data-lucide="plus" style="width:13px;height:13px"></i></div>` : ''}
    </div>`;
        if (!collapsed) children.forEach(c => html += channelItemHTML(c));
      });

      if (canManage) {
        html += `<div style="padding:8px;text-align:center">
      <button class="btn btn-secondary" style="width:100%;font-size:12px" onclick="createCategory()">+ New Category</button>
    </div>`;
      }

      el.innerHTML = html;
      lucide.createIcons();
    }

    function channelItemHTML(c) {
      const active = S.activeCh?.id === c.id;
      const unreadCount = Number(S.unread[c.id] || 0);
      const unread = unreadCount > 0;
      const icons = { text: 'hash', voice: 'volume-2' };
      const ic = icons[c.type] || 'hash';
      const badge = unreadCount > 0 ? `<span class="ch-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` : '';
      const pip = unread && !active ? '<div class="ch-unread-pip"></div>' : '';

      return `<div class="ch-row${active ? ' active' : ''}${unread ? ' unread' : ''}" onclick="pickChById('${c.id}')" oncontextmenu="chCtx(event,'${c.id}')">
    ${pip}
    <i data-lucide="${ic}" class="ch-icon" style="width:16px;height:16px"></i>
    <span class="ch-name">${esc(c.name)}</span>
    ${badge}
  </div>`;
    }

    function renderDMList() {
      const el = document.getElementById('ch-list');
      const note = S.dmOverview.note;
      const chats = [...(S.dmOverview.groups || []), ...(S.dmOverview.friends || [])];

      const dmRow = (c, opts = {}) => {
        const active = S.activeCh?.id === c.id;
        const name = c._name || c.other_user?.username || c.name || 'DM';
        const status = c.type === 'group' ? 'online' : (S.presence[c._otherId] || c.other_user?.status || 'offline');
        const avatar = c._otherAv
          ? `<img src="${escA(c._otherAv)}" alt="">`
          : `<span>${initials(name)}</span>`;
        const unreadCount = Number(S.unread[c.id] || 0);
        const badge = unreadCount > 0 ? `<span class="ch-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` : '';
        const subtitle = opts.subtitle ? `<div class="ml-sub">${esc(opts.subtitle)}</div>` : '';
        const closeLabel = c.type === 'group' ? 'Leave Group' : 'Close DM';
        const actions = opts.actions || `<div class="dm-close" title="${closeLabel}" onclick="event.stopPropagation();closeDM('${c.id}')"><i data-lucide="x" style="width:14px;height:14px"></i></div>`;

        return `<div class="dm-row${active ? ' active' : ''}" onclick="${opts.click || `pickDM('${c.id}')`}" oncontextmenu="chCtx(event,'${c.id}')">
          <div class="av" style="width:32px;height:32px;background:${colorFor(c._otherId || c.id)};font-size:13px;flex-shrink:0">
            ${c.type === 'group' ? `<i data-lucide="users" style="width:14px;height:14px;color:#fff"></i>` : avatar}
            ${c.type === 'group' ? '' : `<div class="av-status ${status}" style="width:10px;height:10px;border-color:var(--bg-side)"></div>`}
          </div>
          <div style="flex:1;min-width:0">
            <div class="dm-name">${esc(name)}</div>
            ${subtitle}
          </div>
          ${badge}
          ${actions}
        </div>`;
      };

      let html = `<div class="dm-row${S.activeCh?.type === 'friends_home' ? ' active' : ''}" onclick="pickFriendsHome()">
        <div class="av" style="width:32px;height:32px;background:var(--brand);color:#fff;font-size:13px;flex-shrink:0">
          <i data-lucide="heart" style="width:15px;height:15px;color:#fff"></i>
        </div>
        <span class="dm-name">Friends</span>
        ${S.dmOverview.request_count > 0 ? `<span class="ch-badge">${S.dmOverview.request_count > 99 ? '99+' : S.dmOverview.request_count}</span>` : ''}
      </div>`;

      html += `<div class="dm-row${S.activeCh?.type === 'groups_home' ? ' active' : ''}" onclick="pickGroupsHome()">
        <div class="av" style="width:32px;height:32px;background:var(--brand);color:#fff;font-size:13px;flex-shrink:0">
          <i data-lucide="users" style="width:15px;height:15px;color:#fff"></i>
        </div>
        <span class="dm-name">Groups</span>
      </div>`;

      html += `<div class="dm-row${S.activeCh?.type === 'note' ? ' active' : ''}" onclick="openNotes()">
        <div class="av" style="width:32px;height:32px;background:var(--brand);font-size:13px;flex-shrink:0">
          <i data-lucide="bookmark" style="width:14px;height:14px;color:#fff"></i>
        </div>
        <span class="dm-name" style="${S.activeCh?.type === 'note' ? 'color:var(--t1)' : ''}">${esc(note?._name || 'Saved Notes')}</span>
      </div>`;

      html += `<div class="dm-section-hdr"><span>Direct Messages</span></div>`;
      if (chats.length) {
        html += chats.map(c => dmRow(c, {
          subtitle: c.type === 'group' ? `${c.participant_count || 0} members` : '',
        })).join('');
      } else {
        html += `<div class="small-muted" style="padding:0 14px 10px">No active chats yet.</div>`;
      }

      el.innerHTML = html;
      lucide.createIcons();
    }

    // ═══════════════════════════════════════════════════
    //  Header / Channel picking
    // ═══════════════════════════════════════════════════
    function updateHeader() {
      const ch = S.activeCh;
      const icons = { dm: 'message-square', group: 'users', friends_home: 'heart', groups_home: 'users', docs_home: 'book-open', note: 'bookmark', voice: 'volume-2', text: 'hash', category: 'folder' };
      const iconEl = document.getElementById('ch-hdr-icon');
      iconEl.setAttribute('data-lucide', icons[ch?.type] || 'hash');
      document.getElementById('ch-hdr-name').textContent = ch ? (ch._name || ch.name || '—') : '—';
      document.getElementById('ch-hdr-topic').textContent = ch?.topic || '';
      document.getElementById('topic-sep').style.display = ch?.topic ? '' : 'none';
      document.getElementById('msg-input').placeholder = ch
        ? ['friends_home', 'groups_home', 'docs_home'].includes(ch.type)
          ? (ch.type === 'docs_home' ? 'Read-only documentation view' : 'Open a friend or group to chat')
          : `Message ${['dm', 'note', 'group'].includes(ch.type) ? '' : '#'}${ch._name || ch.name}`
        : 'Select a channel';
      updateSrvSettingsBtn();
      updateMLBtn();
      updateShareBtn();
      updateComposerState();
      lucide.createIcons();
    }

    function updateComposerState() {
      const input = document.getElementById('msg-input');
      const send = document.getElementById('btn-send');
      const attach = document.getElementById('btn-attach');
      const emoji = document.getElementById('btn-emoji');

      const enabled = !!S.activeCh && !['friends_home', 'groups_home', 'docs_home'].includes(S.activeCh.type) && canSendHere();
      input.disabled = !enabled;
      send.classList.toggle('disabled', !enabled);
      attach.classList.toggle('disabled', !enabled);
      emoji.classList.toggle('disabled', !enabled);
    }
    function focusComposer() {
      const input = document.getElementById('msg-input');
      if (!input || input.disabled) return;
      requestAnimationFrame(() => {
        if (!input.disabled) input.focus();
      });
    }

    async function pickChById(id) {
      const ch = findChannel(id);
      if (!ch) return;
      await pickCh(ch);
    }

    async function pickDM(id) {
      const c = S.dms.find(x => x.id === id);
      if (c) await pickCh(c);
    }

    async function pickFriendsHome() {
      S.activeCh = friendsHomeChannel();
      clearReply();
      updateHeader();
      renderDMList();
      renderMsgs();
    }

    async function pickGroupsHome() {
      S.activeCh = groupsHomeChannel();
      clearReply();
      updateHeader();
      renderDMList();
      renderMsgs();
    }

    function openProjectDocsLink() {
      window.open('https://example.com/', '_blank', 'noopener');
    }

    function setFriendsMenuTab(tab) {
      S.friendsMenuTab = tab;
      if (S.activeCh?.type === 'friends_home') renderMsgs();
    }

    function setGroupsMenuTab(tab) {
      S.groupsMenuTab = tab;
      if (S.activeCh?.type === 'groups_home') renderMsgs();
    }

    function openAddFriendModal() {
      document.querySelector('#m-open-dm .modal-title').textContent = 'Add Friend';
      document.querySelector('#m-open-dm .fl').textContent = 'User ID';
      document.getElementById('dm-uid').value = '';
      document.getElementById('dm-uid').placeholder = 'usr_...';
      document.querySelector('#m-open-dm .btn.btn-primary').textContent = 'Add';
      openModal('m-open-dm');
    }

    function joinGroupByPrompt() {
      showPrompt('Join Group', 'Enter the group share code:', '', code => {
        if (code) joinGroupByShare(code.trim());
      });
    }

    async function pickCh(ch) {
      S.activeCh = ch;
      S.replyTo = null;
      S.editingId = null;
      clearReply();
      clearUnread(ch.id);

      updateHeader();

      if (!S.inDMs) renderChs();
      else renderDMList();

      syncMLPanel();

      await ensureChannelPerms(ch);
      updateComposerState();

      if (!S.messages[ch.id]) {
        await fetchMsgs(ch.id);
      } else {
        renderMsgs();
        requestAnimationFrame(() => scrollBottom(true));
      }
      focusComposer();
    }

    async function openNotes() {
      try {
        let ch = S.dmOverview.note || S.dms.find(c => c.type === 'note');
        if (!ch) {
          ch = await POST('/users/@me/channels', { recipient_id: S.me.id });
          ch._name = 'Saved Notes';
          await loadRelationships();
          ch = S.dmOverview.note || ch;
        } else {
          ch._name = 'Saved Notes';
        }
        await pickCh(ch);
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    // ═══════════════════════════════════════════════════
