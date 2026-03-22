    //  Typing
    // ═══════════════════════════════════════════════════
    function handleTyping(channelId, uid, name) {
      if (uid === S.me?.id) return;
      if (!S.typing[channelId]) S.typing[channelId] = new Map();
      S.typing[channelId].set(uid, { name: name || uid, t: Date.now() });
      if (S.activeCh?.id === channelId) renderTyping();

      if (!_typingInterval) {
        _typingInterval = setInterval(() => {
          const now = Date.now();
          for (const chId of Object.keys(S.typing)) {
            for (const [u, data] of S.typing[chId].entries()) {
              if (now - data.t > 8000) S.typing[chId].delete(u);
            }
          }
          if (S.activeCh?.id) renderTyping();
        }, 1000);
      }
    }

    function renderTyping() {
      const el = document.getElementById('typing-inner');
      const cid = S.activeCh?.id;
      if (!cid || !S.typing[cid]) {
        el.innerHTML = '';
        return;
      }
      const typers = [...S.typing[cid].values()].filter(t => Date.now() - t.t < 8000);
      if (!typers.length) {
        el.innerHTML = '';
        return;
      }
      const names = typers.slice(0, 3).map(t => `<strong>${esc(t.name)}</strong>`).join(', ');
      const verb = typers.length === 1 ? 'is' : 'are';
      el.innerHTML = `<div class="typing-dots"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div><span class="typing-text">${names} ${verb} typing…</span>`;
    }

    // ═══════════════════════════════════════════════════
    //  Member list
    // ═══════════════════════════════════════════════════
    async function loadMembers(serverId, force = false) {
      if (!force && S.members[serverId]) {
        renderML();
        return;
      }
      try {
        const members = await GET(`/servers/${serverId}/members?limit=100`);
        S.members[serverId] = members;
        members.forEach(m => {
          if (m.user?.status) S.presence[m.user_id] = m.user.status;
        });
        renderML();
      } catch (e) {
        if (S.activeSrv?.id === serverId) {
          document.getElementById('ml-body').innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`;
        }
      }
    }

    function renderML() {
      const el = document.getElementById('ml-body');
      const countEl = document.getElementById('ml-count');
      if (!S.activeSrv) {
        el.innerHTML = '';
        countEl.textContent = '0 total';
        return;
      }
      const source = S.members[S.activeSrv.id];
      if (!source) {
        countEl.textContent = 'Loading...';
        el.innerHTML = `<div class="small-muted" style="padding:10px 8px">Loading members...</div>`;
        return;
      }
      const members = source.slice().sort((a, b) => {
        const roleDiff = (b.top_role_position || 0) - (a.top_role_position || 0);
        if (roleDiff) return roleDiff;
        const aOnline = ['online', 'idle', 'dnd'].includes(S.presence[a.user_id] || a.user?.status || 'offline') ? 1 : 0;
        const bOnline = ['online', 'idle', 'dnd'].includes(S.presence[b.user_id] || b.user?.status || 'offline') ? 1 : 0;
        if (bOnline !== aOnline) return bOnline - aOnline;
        const aName = (a.nickname || a.user?.username || a.user_id).toLowerCase();
        const bName = (b.nickname || b.user?.username || b.user_id).toLowerCase();
        return aName.localeCompare(bName);
      });

      const row = m => {
        const u = m.user || { id: m.user_id, username: m.nickname || m.user_id };
        const name = m.nickname || u.username || m.user_id;
        const st = S.presence[m.user_id] || u.status || 'offline';
        const labels = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible', offline: 'Offline' };
        return `<div class="ml-row" onclick="userCtx(event,'${m.user_id}')">
      ${avHTML(u, 32, st, 'var(--bg-side)')}
      <div style="min-width:0">
        <div class="ml-name">${esc(name)}${m.user_id === S.me?.id ? '<span style="color:var(--brand);font-size:10px;margin-left:4px">you</span>' : ''}</div>
        <div class="ml-sub">${labels[st] || st}</div>
      </div>
    </div>`;
      };

      const groups = new Map();
      members.forEach(m => {
        const label = m.top_role_name || 'Members';
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(m);
      });

      countEl.textContent = `${members.length} total`;

      el.innerHTML = [...groups.entries()].map(([label, items], idx) => `
        <div class="ml-section-title"${idx ? ' style="margin-top:8px"' : ''}>${esc(label)} — ${items.length}</div>
        ${items.map(row).join('')}
      `).join('');
    }

    function toggleML() {
      S.mlOpen = !S.mlOpen;
      syncMLPanel();
    }

    // ═══════════════════════════════════════════════════
    //  Pins / mentions / search
    // ═══════════════════════════════════════════════════
    function togglePins() {
      if (!S.activeCh || isHomeView()) return;
      S.pinsOpen = !S.pinsOpen;
      if (S.pinsOpen && S.mentionsOpen) closeMentions();
      document.getElementById('pins-panel').style.display = S.pinsOpen ? 'block' : 'none';
      document.getElementById('btn-pins').classList.toggle('active', S.pinsOpen);
      if (S.pinsOpen) openPins();
    }
    function closePins() {
      S.pinsOpen = false;
      document.getElementById('pins-panel').style.display = 'none';
      document.getElementById('btn-pins').classList.remove('active');
    }

    async function openPins() {
      if (!S.activeCh) return;
      const body = document.getElementById('pins-body');
      body.innerHTML = `<div class="empty"><i data-lucide="loader-circle" class="spin" style="width:24px;height:24px"></i></div>`;
      lucide.createIcons();

      try {
        const pins = await GET(`/channels/${S.activeCh.id}/pins`);
        if (!pins.length) {
          body.innerHTML = '<div class="empty"><p>No pinned messages yet.</p></div>';
          return;
        }
        body.innerHTML = pins.map(m => `
      <div style="padding:12px;background:var(--bg-card);border-radius:var(--radius-sm);margin:8px;cursor:pointer" onclick="jumpToMessage('${m.id}','${m.channel_id}')">
        <div style="font-size:12px;color:var(--t3);margin-bottom:4px;display:flex;align-items:center;justify-content:space-between">
          <span><strong style="color:var(--t1)">${esc(m.author?.server_nickname || getDisplayNameForUser(m.author?.id, m.author?.username || '?'))}</strong> · ${fullTimeFmt(new Date(m.created_at))}</span>
          <span style="color:var(--brand);font-size:12px">Jump</span>
        </div>
        <div style="font-size:14px;color:var(--t2)">${formatContent((m.content || '').slice(0, 300))}</div>
      </div>
    `).join('');
      } catch (e) {
        body.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`;
      }
      lucide.createIcons();
    }

    function toggleMentions() {
      if (!S.activeCh || isHomeView()) return;
      S.mentionsOpen = !S.mentionsOpen;
      if (S.mentionsOpen && S.pinsOpen) closePins();
      document.getElementById('mentions-panel').style.display = S.mentionsOpen ? 'block' : 'none';
      document.getElementById('btn-mentions').classList.toggle('active', S.mentionsOpen);
      if (S.mentionsOpen) openMentionsPanel();
    }
    function closeMentions() {
      S.mentionsOpen = false;
      document.getElementById('mentions-panel').style.display = 'none';
      document.getElementById('btn-mentions').classList.remove('active');
    }

    function openMentionsPanel() {
      const body = document.getElementById('mentions-body');
      const msgs = S.messages[S.activeCh?.id] || [];
      const filtered = msgs.filter(m => isMentionForMe(m));

      if (!filtered.length) {
        body.innerHTML = '<div class="empty"><p>No mentions or replies in this channel.</p></div>';
        return;
      }

      body.innerHTML = filtered.map(m => `
    <div style="padding:12px;background:var(--bg-card);border-radius:var(--radius-sm);margin:8px;cursor:pointer;border-left:3px solid var(--mention-border)" onclick="jumpToMessage('${m.id}','${m.channel_id}')">
      <div style="font-size:12px;color:var(--t3);margin-bottom:4px;display:flex;align-items:center;justify-content:space-between">
        <span><strong style="color:var(--t1)">${esc(m.author?.server_nickname || getDisplayNameForUser(m.author?.id, m.author?.username || '?'))}</strong> · ${fullTimeFmt(new Date(m.created_at))}</span>
        <span style="color:var(--brand);font-size:12px">Jump</span>
      </div>
      <div style="font-size:14px;color:var(--t2)">${formatContent((m.content || '').slice(0, 260))}</div>
    </div>
  `).join('');
    }

    function searchModalMeta() {
      if (S.activeCh?.type === 'friends_home') {
        return { title: 'Search Friends', placeholder: 'Search friends, requests, pending...' };
      }
      if (S.activeCh?.type === 'groups_home') {
        return { title: 'Search Groups', placeholder: 'Search groups...' };
      }
      if (S.activeCh?.type === 'docs_home') {
        return { title: 'Search Tutorial', placeholder: 'Search the tutorial...' };
      }
      return { title: 'Search Messages', placeholder: 'Search...' };
    }

    function renderSearchResults(results, countLabel, onSelect) {
      const out = document.getElementById('s-results');
      if (!results.length) {
        out.innerHTML = '<div class="empty"><p>No results.</p></div>';
        return;
      }
      out.innerHTML = results.map((item, index) => `
        <div style="padding:10px;background:var(--bg-card);border-radius:var(--radius-sm);margin-bottom:6px;cursor:pointer;display:flex;align-items:flex-start;gap:10px" onclick="${onSelect(item, index)}">
          <i data-lucide="${item.icon}" style="width:16px;height:16px;color:var(--t3);margin-top:2px;flex-shrink:0"></i>
          <div style="min-width:0;flex:1">
            <div style="font-size:13px;color:var(--t1);font-weight:700">${esc(item.title)}</div>
            <div style="font-size:12px;color:var(--t3);margin-top:2px">${esc(item.subtitle)}</div>
          </div>
        </div>
      `).join('') + `<div style="font-size:12px;color:var(--t4);padding:6px">${countLabel}</div>`;
      lucide.createIcons();
    }

    function searchFriendsHome(needle) {
      const sections = [
        { icon: 'heart', label: 'Friend', items: S.dmOverview.friends || [] },
        { icon: 'inbox', label: 'Request', items: S.dmOverview.requests || [] },
        { icon: 'clock-3', label: 'Pending', items: S.dmOverview.pending || [] },
      ];
      const matches = [];

      sections.forEach(section => {
        section.items.forEach(entry => {
          const name = entry._name || entry.other_user?.username || entry.name || 'Unknown';
          const sectionLabel = entry.relationship_direction === 'incoming' && entry.relationship_status === 'rejected'
            ? 'Blocked'
            : section.label;
          const subtitle = `${sectionLabel} · ${formatStatusLabel(entry.other_user?.status || S.presence[entry._otherId] || entry.relationship_status || 'offline')}`;
          const haystack = [name, subtitle, entry.id, entry._otherId, entry.other_user?.username]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (haystack.includes(needle)) {
            matches.push({
              id: entry.id,
              title: name,
              subtitle,
              icon: section.icon,
            });
          }
        });
      });

      return matches;
    }

    function searchGroupsHome(needle) {
      return (S.dmOverview.groups || []).reduce((matches, entry) => {
        const name = entry.name || entry._name || 'Group';
        const subtitle = `Group · ${entry.participant_count || 0} member${(entry.participant_count || 0) > 1 ? 's' : ''}`;
        const haystack = [name, subtitle, entry.id].join(' ').toLowerCase();
        if (haystack.includes(needle)) {
          matches.push({
            id: entry.id,
            title: name,
            subtitle,
            icon: 'users',
          });
        }
        return matches;
      }, []);
    }

    function searchDocsHome(needle) {
      const matches = [];
      String(S.docsMarkdown || '').split('\n').forEach((line, index) => {
        const text = line.trim();
        if (!text) return;
        if (text.toLowerCase().includes(needle)) {
          matches.push({
            title: text.replace(/^#+\s*/, '').slice(0, 120),
            subtitle: `Tutorial line ${index + 1}`,
            icon: 'book-open',
          });
        }
      });
      return matches.slice(0, 30);
    }

    function toggleSearch() {
      if (!S.activeCh) {
        toast('Select a channel first', 'err');
        return;
      }
      const meta = searchModalMeta();
      S.searchOpen = true;
      document.querySelector('#m-search .modal-title').textContent = meta.title;
      document.getElementById('sq').placeholder = meta.placeholder;
      document.getElementById('s-results').innerHTML = '';
      document.getElementById('btn-search').classList.add('active');
      openModal('m-search');
      requestAnimationFrame(() => document.getElementById('sq')?.focus());
    }
    function closeSearchModal() {
      S.searchOpen = false;
      document.getElementById('btn-search').classList.remove('active');
      closeModal('m-search');
    }

    async function doSearch() {
      const q = document.getElementById('sq').value.trim();
      if (!q || !S.activeCh) return;
      const out = document.getElementById('s-results');
      out.innerHTML = '<div class="empty"><i data-lucide="loader-circle" class="spin" style="width:20px;height:20px"></i></div>';
      lucide.createIcons();

      try {
        const needle = q.toLowerCase();

        if (S.activeCh.type === 'friends_home') {
          const matches = searchFriendsHome(needle);
          renderSearchResults(matches, `${matches.length} result(s)`, item => `pickChById('${item.id}');closeSearchModal()`);
          return;
        }

        if (S.activeCh.type === 'groups_home') {
          const matches = searchGroupsHome(needle);
          renderSearchResults(matches, `${matches.length} result(s)`, item => `pickChById('${item.id}');closeSearchModal()`);
          return;
        }

        if (S.activeCh.type === 'docs_home') {
          if (!S.docsLoaded && !S.docsLoading) await loadProjectDocs();
          const matches = searchDocsHome(needle);
          renderSearchResults(matches, `${matches.length} result(s)`, () => `closeSearchModal()`);
          return;
        }

        if (S.activeSrv && S.activeCh.server_id) {
          const r = await GET(`/servers/${S.activeSrv.id}/search?q=${encodeURIComponent(q)}&limit=30`);
          if (!r.messages.length) {
            out.innerHTML = '<div class="empty"><p>No results.</p></div>';
            return;
          }
          out.innerHTML = r.messages.map(m => {
            const ch = findChannel(m.channel_id);
            const authorName = m.author?.server_nickname || getDisplayNameForUser(m.author?.id, m.author?.username || '?');
            return `<div style="padding:10px;background:var(--bg-card);border-radius:var(--radius-sm);margin-bottom:6px;cursor:pointer" onclick="jumpToMessage('${m.id}','${m.channel_id}')">
          <div style="font-size:12px;color:var(--t3);margin-bottom:3px"><strong style="color:var(--t1)">${esc(authorName)}</strong> in #${esc(ch?.name || m.channel_id)} · ${fullTimeFmt(new Date(m.created_at))}</div>
          <div style="font-size:13px;color:var(--t2)">${formatContent((m.content || '').slice(0, 240))}</div>
        </div>`;
          }).join('') + `<div style="font-size:12px;color:var(--t4);padding:6px">${r.total} result(s)</div>`;
          return;
        }

        if (!S.messages[S.activeCh.id]) await fetchMsgs(S.activeCh.id, true);
        const source = S.messages[S.activeCh.id] || [];
        const matches = source.filter(m =>
          (m.content || '').toLowerCase().includes(needle) ||
          (m.author?.username || '').toLowerCase().includes(needle) ||
          (m.author?.server_nickname || '').toLowerCase().includes(needle)
        );
        if (!matches.length) {
          out.innerHTML = '<div class="empty"><p>No results.</p></div>';
          return;
        }
        out.innerHTML = matches.map(m => {
          const authorName = m.author?.server_nickname || m.author?.username || '?';
          return `<div style="padding:10px;background:var(--bg-card);border-radius:var(--radius-sm);margin-bottom:6px;cursor:pointer" onclick="jumpToMessage('${m.id}','${m.channel_id}')">
            <div style="font-size:12px;color:var(--t3);margin-bottom:3px"><strong style="color:var(--t1)">${esc(authorName)}</strong> · ${fullTimeFmt(new Date(m.created_at))}</div>
            <div style="font-size:13px;color:var(--t2)">${formatContent((m.content || '').slice(0, 240))}</div>
          </div>`;
        }).join('') + `<div style="font-size:12px;color:var(--t4);padding:6px">${matches.length} result(s)</div>`;
      } catch (e) {
        out.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`;
      }
    }

    async function jumpToMessage(msgId, channelId) {
      const ch = findChannel(channelId);
      if (!ch) return;
      closeSearchModal();
      await pickCh(ch);
      setTimeout(() => scrollToMsg(msgId), 200);
    }

    // ═══════════════════════════════════════════════════
