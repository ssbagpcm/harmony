    //  DMs
    // ═══════════════════════════════════════════════════
    function getStoredDMInfo(dmId) {
      try {
        const raw = localStorage.getItem('h_dm_info');
        const store = raw ? JSON.parse(raw) : {};
        return store[dmId] || null;
      } catch {
        return null;
      }
    }

    function storeDMInfo(dmId, data) {
      try {
        const raw = localStorage.getItem('h_dm_info');
        const store = raw ? JSON.parse(raw) : {};
        store[dmId] = data;
        localStorage.setItem('h_dm_info', JSON.stringify(store));
      } catch { }
    }

    async function enrichDMs() {
      for (const c of allDMEntries()) {
        if (c.type !== 'dm') continue;

        if (c.other_user) {
          c._name = c.other_user.username;
          c._otherId = c.other_user.id;
          c._otherAv = c.other_user.avatar_url;
          S.presence[c.other_user.id] = c.other_user.status || 'offline';
          storeDMInfo(c.id, {
            name: c.other_user.username,
            otherId: c.other_user.id,
            otherAv: c.other_user.avatar_url,
            status: c.other_user.status || 'offline',
          });
          continue;
        }

        const stored = getStoredDMInfo(c.id);
        if (stored) {
          c._name = stored.name;
          c._otherId = stored.otherId;
          c._otherAv = stored.otherAv;
          if (stored.status) S.presence[stored.otherId] = stored.status;
          continue;
        }

        try {
          const participants = await GET(`/channels/${c.id}/participants`);
          const other = participants.find(u => u.id !== S.me?.id);
          if (other) {
            c._name = other.username;
            c._otherId = other.id;
            c._otherAv = other.avatar_url;
            S.presence[other.id] = other.status || 'offline';
            storeDMInfo(c.id, {
              name: other.username,
              otherId: other.id,
              otherAv: other.avatar_url,
              status: other.status || 'offline',
            });
          }
        } catch { }
      }
    }

    async function loadRelationships() {
      try {
        applyRelationshipData(await GET('/users/@me/relationships'));
        await enrichDMs();
        if (S.inDMs && !S.activeCh) S.activeCh = firstWritableDMChannel() || friendsHomeChannel();
        if (S.inDMs) renderDMList();
        renderRail();
        updateHeader();
        renderMsgs();
      } catch { }
    }

    function openCreateGroupModal() {
      const list = document.getElementById('group-friends-list');
      const friends = S.dmOverview.friends || [];
      document.getElementById('group-name').value = '';
      if (!friends.length) {
        list.innerHTML = `<div class="small-muted">You need at least one accepted friend to create a group.</div>`;
      } else {
        list.innerHTML = friends.map(c => `
          <label class="setting-card" style="cursor:pointer">
            <input class="ui-check" type="checkbox" data-group-member="${c._otherId}">
            ${avHTML({ id: c._otherId, username: c._name, avatar_url: c._otherAv }, 34, S.presence[c._otherId] || c.other_user?.status || 'offline', 'var(--bg-card)')}
            <div style="flex:1;min-width:0">
              <div style="font-weight:700">${esc(c._name || c.other_user?.username || 'Friend')}</div>
              <div class="small-muted">${esc(formatStatusLabel(c.other_user?.status || S.presence[c._otherId] || 'offline'))}</div>
            </div>
          </label>
        `).join('');
      }
      openModal('m-create-group');
    }

    async function createGroup() {
      const name = document.getElementById('group-name').value.trim();
      const member_ids = [...document.querySelectorAll('[data-group-member]:checked')].map(el => el.dataset.groupMember);
      if (!name) return toast('Group name required', 'err');
      if (!member_ids.length) return toast('Select at least one friend', 'err');

      try {
        const ch = await POST('/users/@me/groups', { name, member_ids });
        await loadRelationships();
        closeModal('m-create-group');
        const local = findChannel(ch.id);
        if (!S.inDMs) showDMs();
        await pickCh(local || ch);
        toast('Group created', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    async function createGroupFromHome() {
      const name = document.getElementById('groups-home-name')?.value.trim();
      const member_ids = [...document.querySelectorAll('[data-group-member-home]:checked')].map(el => el.dataset.groupMemberHome);
      if (!name) return toast('Group name required', 'err');
      if (!member_ids.length) return toast('Select at least one friend', 'err');

      try {
        const ch = await POST('/users/@me/groups', { name, member_ids });
        S.groupsMenuTab = 'groups';
        await loadRelationships();
        const local = findChannel(ch.id);
        if (!S.inDMs) showDMs();
        await pickCh(local || ch);
        toast('Group created', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    async function hydrateDMChannel(ch, fallbackUid = null) {
      if (!ch || ch.type !== 'dm') return ch;
      if (ch.other_user) {
        ch._name = ch.other_user.username;
        ch._otherId = ch.other_user.id;
        ch._otherAv = ch.other_user.avatar_url;
        S.presence[ch.other_user.id] = ch.other_user.status || 'offline';
        storeDMInfo(ch.id, {
          name: ch.other_user.username,
          otherId: ch.other_user.id,
          otherAv: ch.other_user.avatar_url,
          status: ch.other_user.status || 'offline',
        });
        return ch;
      }
      const stored = getStoredDMInfo(ch.id);
      if (stored) {
        ch._name = stored.name;
        ch._otherId = stored.otherId;
        ch._otherAv = stored.otherAv;
        if (stored.status) S.presence[stored.otherId] = stored.status;
        return ch;
      }
      if (fallbackUid) {
        try {
          const u = await GET(`/users/${fallbackUid}`);
          ch._name = u.username;
          ch._otherId = u.id;
          ch._otherAv = u.avatar_url;
          S.presence[u.id] = u.status || 'offline';
          storeDMInfo(ch.id, {
            name: u.username,
            otherId: u.id,
            otherAv: u.avatar_url,
            status: u.status || 'offline',
          });
        } catch { }
      }
      return ch;
    }

    async function openDMModal() {
      const uid = document.getElementById('dm-uid').value.trim();
      if (!uid) return;
      try {
        const ch = await POST('/users/@me/channels', { recipient_id: uid });
        await hydrateDMChannel(ch, uid);
        await loadRelationships();

        closeModal('m-open-dm');
        document.getElementById('dm-uid').value = '';

        if (!S.inDMs) showDMs();
        else renderDMList();

        const local = findChannel(ch.id) || ch;
        const canAutoOpen = ['group', 'note'].includes(local?.type) || (local?.relationship_status === 'accepted' && local?.can_open !== false);
        if (canAutoOpen) {
          await pickCh(local);
        } else {
          toast('DM request sent', 'ok');
        }
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    async function closeDM(channelId) {
      showConfirm('Close DM', 'Close this conversation?', async () => {
        try {
          const wasActive = S.activeCh?.id === channelId;
          await DELETE_(`/users/@me/channels/${channelId}`);
          await loadRelationships();
          delete S.messages[channelId];
          delete S.unread[channelId];
          if (wasActive) {
            const next = firstWritableDMChannel();
            if (next) await pickCh(next);
            else {
              S.activeCh = null;
              renderMsgs();
              updateHeader();
            }
          }
          if (S.inDMs) renderDMList();
          toast('DM closed', 'ok');
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }

    async function acceptDMRequest(channelId) {
      try {
        const ch = await POST(`/users/@me/dm-requests/${channelId}/accept`, {});
        await hydrateDMChannel(ch);
        await loadRelationships();
        toast('Request accepted', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    async function rejectDMRequest(channelId) {
      try {
        await POST(`/users/@me/dm-requests/${channelId}/reject`, {});
        await loadRelationships();
        toast('Request rejected', 'ok');
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    // ═══════════════════════════════════════════════════
    //  Messages
    // ═══════════════════════════════════════════════════
    async function fetchMsgs(channelId, force = false) {
      if (S.loading[channelId]) return;
      if (!force && S.messages[channelId]) {
        renderMsgs();
        return;
      }

      S.loading[channelId] = true;
      const list = document.getElementById('msgs-list');
      list.innerHTML = `<div class="empty"><i data-lucide="loader-circle" class="spin" style="width:36px;height:36px"></i></div>`;
      lucide.createIcons();

      try {
        const msgs = await GET(`/channels/${channelId}/messages?limit=50`);
        S.messages[channelId] = msgs.reverse();
        if (S.activeCh?.id === channelId) {
          renderMsgs();
          scrollBottom();
        }
      } catch (e) {
        list.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`;
      } finally {
        S.loading[channelId] = false;
      }
    }

    function upsertMessage(msg) {
      const cid = msg.channel_id;
      if (!S.messages[cid]) S.messages[cid] = [];
      const arr = S.messages[cid];
      const idx = arr.findIndex(m => m.id === msg.id);
      if (idx >= 0) {
        arr[idx] = { ...arr[idx], ...msg };
        return true;
      }
      arr.push(msg);
      arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      return false;
    }

    function removeMessage(channelId, messageId) {
      if (!S.messages[channelId]) return;
      S.messages[channelId] = S.messages[channelId].filter(m => m.id !== messageId);
    }

    function findMessageById(messageId) {
      const arr = S.activeCh ? (S.messages[S.activeCh.id] || []) : [];
      return arr.find(m => m.id === messageId) || null;
    }

    function isMentionForMe(msg) {
      const txt = (msg.content || '').toLowerCase();
      const uname = (S.me?.username || '').toLowerCase();
      const mention = uname && txt.includes(`@${uname}`);
      const mass = txt.includes('@everyone') || txt.includes('@here');
      const reply = !!(msg.reply_to && msg.reply_to.author_username && msg.reply_to.author_username === S.me?.username);
      return mention || mass || reply;
    }

    function dmConversationNotice(ch) {
      if (!ch || ch.type !== 'dm' || ch.relationship_direction !== 'outgoing') return '';
      if (ch.relationship_status === 'pending') {
        return `<div style="margin:12px 16px 0;padding:10px 12px;border-radius:8px;background:rgba(237,66,69,.12);color:#ffb3b4;border:1px solid rgba(237,66,69,.25)">Waiting for this DM request to be accepted.</div>`;
      }
      if (ch.relationship_status === 'rejected') {
        return `<div style="margin:12px 16px 0;padding:10px 12px;border-radius:8px;background:rgba(237,66,69,.16);color:#ff9fa1;border:1px solid rgba(237,66,69,.3)">This DM request was not accepted.</div>`;
      }
      return '';
    }

    function parseSystemMessage(content) {
      const m = String(content || '').match(/^\[\[system:(join|leave|close)\]\]\s*([\s\S]+)$/i);
      if (!m) return null;
      return { kind: m[1].toLowerCase(), text: m[2] };
    }

    function friendsHomeHTML() {
      const requests = S.dmOverview.requests || [];
      const blocked = (S.dmOverview.pending || []).filter(c => c.relationship_direction === 'incoming' && c.relationship_status === 'rejected');
      const pending = (S.dmOverview.pending || []).filter(c => !(c.relationship_direction === 'incoming' && c.relationship_status === 'rejected'));
      const friends = S.dmOverview.friends || [];
      const tabs = [
        ['requests', 'Requests', requests.length],
        ['pending', 'Pending', pending.length],
        ['friends', 'Friends', friends.length],
      ];
      const activeTab = S.friendsMenuTab || 'requests';

      const friendCard = c => `<div class="setting-card">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          ${avHTML({ id: c._otherId, username: c._name, avatar_url: c._otherAv }, 36, S.presence[c._otherId] || c.other_user?.status || 'offline', 'var(--bg-card)')}
          <div style="min-width:0;flex:1">
            <div style="font-weight:700">${esc(c._name || c.other_user?.username || 'Friend')}</div>
            <div class="small-muted">${esc(formatStatusLabel(c.other_user?.status || S.presence[c._otherId] || 'offline'))}</div>
          </div>
        </div>
        <button class="btn btn-secondary" onclick="pickDM('${c.id}')">Open</button>
      </div>`;

      const incomingCard = c => `<div class="setting-card">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          ${avHTML({ id: c._otherId, username: c._name, avatar_url: c._otherAv }, 36, S.presence[c._otherId] || c.other_user?.status || 'offline', 'var(--bg-card)')}
          <div style="min-width:0;flex:1">
            <div style="font-weight:700">${esc(c._name || c.other_user?.username || 'Request')}</div>
            <div class="small-muted">Incoming request</div>
          </div>
        </div>
        <div class="dm-actions">
          <button class="dm-mini-btn accept" onclick="acceptDMRequest('${c.id}')">Accept</button>
          <button class="dm-mini-btn reject" onclick="rejectDMRequest('${c.id}')">Reject</button>
        </div>
      </div>`;

      const outgoingCard = c => `<div class="setting-card">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          ${avHTML({ id: c._otherId, username: c._name, avatar_url: c._otherAv }, 36, S.presence[c._otherId] || c.other_user?.status || 'offline', 'var(--bg-card)')}
          <div style="min-width:0;flex:1">
            <div style="font-weight:700">${esc(c._name || c.other_user?.username || 'Pending')}</div>
            <div class="small-muted">${esc(c.relationship_status === 'rejected' ? 'Request not accepted' : 'Waiting for acceptance')}</div>
          </div>
        </div>
        <button class="btn btn-secondary" onclick="pickChById('${c.id}')">Open</button>
      </div>`;

      const blockedCard = c => `<div class="setting-card">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          ${avHTML({ id: c._otherId, username: c._name, avatar_url: c._otherAv }, 36, S.presence[c._otherId] || c.other_user?.status || 'offline', 'var(--bg-card)')}
          <div style="min-width:0;flex:1">
            <div style="font-weight:700">${esc(c._name || c.other_user?.username || 'Blocked')}</div>
            <div class="small-muted">Blocked request</div>
          </div>
        </div>
        <div class="dm-actions">
          <button class="dm-mini-btn accept" onclick="acceptDMRequest('${c.id}')">Accept</button>
        </div>
      </div>`;

      const block = (title, count, content, showBadge = false) => `<div style="padding:18px 20px 0">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:18px;font-weight:800">${title}</div>
          ${showBadge && count > 0 ? `<span class="ch-badge">${count}</span>` : ''}
        </div>
        ${content}
      </div>`;

      let content = '';
      if (activeTab === 'requests') {
        content = block('Requests', requests.length, requests.length ? requests.map(incomingCard).join('') : '<div class="small-muted">No incoming requests.</div>', true);
        content += block('Blocked', blocked.length, blocked.length ? blocked.map(blockedCard).join('') : '<div class="small-muted">No blocked requests.</div>');
      } else if (activeTab === 'pending') {
        content = block('Pending', pending.length, pending.length ? pending.map(outgoingCard).join('') : '<div class="small-muted">No pending requests.</div>');
      } else {
        content = block('Friends', friends.length, friends.length ? friends.map(friendCard).join('') : '<div class="small-muted">No friends yet.</div>');
      }

      return `<div style="min-height:100%">
        <div style="padding:18px 20px 12px;border-bottom:1px solid var(--border);background:rgba(255,255,255,.02)">
          <div style="display:flex;align-items:center;gap:12px;width:100%;margin-bottom:14px">
            <div class="av" style="width:42px;height:42px;background:var(--bg-card);color:var(--t1);font-size:18px;flex-shrink:0">
              <i data-lucide="heart" style="width:18px;height:18px;color:currentColor"></i>
            </div>
            <div style="min-width:0;flex:1">
              <div style="font-size:22px;font-weight:800;line-height:1.1">Friends</div>
              <div class="small-muted" style="margin-top:4px">Relationships</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;width:100%">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            ${tabs.map(([id, label, count]) => `
              <button class="btn ${activeTab === id ? 'btn-primary' : 'btn-secondary'}" style="min-width:110px" onclick="setFriendsMenuTab('${id}')">
                ${label}
                ${id === 'requests' && count > 0 ? `<span style="margin-left:8px;display:inline-flex;min-width:18px;height:18px;padding:0 6px;align-items:center;justify-content:center;border-radius:999px;background:var(--danger);color:#fff;font-size:10px;font-weight:800">${count > 99 ? '99+' : count}</span>` : ''}
              </button>
            `).join('')}
            </div>
            <button class="btn btn-primary" onclick="openAddFriendModal()">Add Friend by ID</button>
          </div>
        </div>
        <div style="min-width:0;padding-bottom:24px">
          ${content}
        </div>
      </div>`;
    }

    function groupsHomeHTML() {
      const groups = S.dmOverview.groups || [];
      const friends = S.dmOverview.friends || [];
      const activeTab = S.groupsMenuTab || 'groups';

      const groupCard = c => `<div class="setting-card">
        <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0">
          <div class="av" style="width:40px;height:40px;background:${colorFor(c.id)};color:#fff;font-size:15px;flex-shrink:0">
            <i data-lucide="users" style="width:16px;height:16px;color:#fff"></i>
          </div>
          <div style="min-width:0;flex:1">
            <div style="font-weight:800">${esc(c.name || c._name || 'Group')}</div>
            <div class="small-muted">${esc(`${c.participant_count || 0} member${(c.participant_count || 0) > 1 ? 's' : ''}`)}</div>
          </div>
        </div>
        <div class="dm-actions">
          <button class="btn btn-secondary" onclick="pickChById('${c.id}')">Open</button>
          <button class="btn btn-secondary" onclick='renameGroup(${JSON.stringify(c.id)}, ${JSON.stringify(c.name || c._name || 'Group')})'>Rename</button>
          <button class="btn btn-secondary" onclick="showGroupShare('${c.id}')">Share</button>
          <button class="btn btn-danger" onclick="closeDM('${c.id}')">Leave</button>
        </div>
      </div>`;

      const friendPickCard = c => `<label class="setting-card" style="cursor:pointer;align-items:center">
        <input class="ui-check" type="checkbox" data-group-member-home="${c._otherId}">
        ${avHTML({ id: c._otherId, username: c._name, avatar_url: c._otherAv }, 36, S.presence[c._otherId] || c.other_user?.status || 'offline', 'var(--bg-card)')}
        <div style="flex:1;min-width:0">
          <div style="font-weight:700">${esc(c._name || c.other_user?.username || 'Friend')}</div>
          <div class="small-muted">${esc(formatStatusLabel(c.other_user?.status || S.presence[c._otherId] || 'offline'))}</div>
        </div>
      </label>`;

      const groupsTab = `<div style="padding:18px 20px 24px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="font-size:18px;font-weight:800">Your groups</div>
          <div class="small-muted">${groups.length} total</div>
        </div>
        ${groups.length ? groups.map(groupCard).join('') : '<div class="small-muted">No groups yet.</div>'}
      </div>`;

      const createTab = `<div style="padding:18px 20px 24px">
        <div style="font-size:18px;font-weight:800;margin-bottom:12px">Create a group</div>
        <div class="setting-card" style="display:block">
          <div class="small-muted" style="margin-bottom:8px">Group name</div>
          <input id="groups-home-name" class="input" maxlength="60" placeholder="Weekend plans" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
        </div>
        <div style="margin-top:14px;margin-bottom:10px;font-size:13px;font-weight:700;color:var(--t2)">Choose friends</div>
        ${friends.length ? friends.map(friendPickCard).join('') : '<div class="small-muted">You need at least one accepted friend to create a group.</div>'}
        <div style="padding-top:14px">
          <button class="btn btn-primary" onclick="createGroupFromHome()">Create Group</button>
        </div>
      </div>`;

      return `<div style="min-height:100%">
        <div style="padding:18px 20px 12px;border-bottom:1px solid var(--border);background:rgba(255,255,255,.02)">
          <div style="display:flex;align-items:center;gap:12px;width:100%;margin-bottom:14px">
            <div class="av" style="width:42px;height:42px;background:var(--bg-card);color:var(--t1);font-size:18px;flex-shrink:0">
              <i data-lucide="users" style="width:18px;height:18px;color:currentColor"></i>
            </div>
            <div style="min-width:0;flex:1">
              <div style="font-size:22px;font-weight:800;line-height:1.1">Groups</div>
              <div class="small-muted" style="margin-top:4px">Create and manage your private group chats</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;width:100%">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <button class="btn ${activeTab === 'groups' ? 'btn-primary' : 'btn-secondary'}" style="min-width:110px" onclick="setGroupsMenuTab('groups')">Groups</button>
              <button class="btn ${activeTab === 'create' ? 'btn-primary' : 'btn-secondary'}" style="min-width:110px" onclick="setGroupsMenuTab('create')">Create</button>
            </div>
            <button class="btn btn-primary" onclick="joinGroupByPrompt()">Join by Code</button>
          </div>
        </div>
        <div style="min-width:0;padding-bottom:24px">
          ${activeTab === 'create' ? createTab : groupsTab}
        </div>
      </div>`;
    }

    function renderDocsInline(text) {
      return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');
    }

    function markdownToDocsHTML(md) {
      const src = String(md || '').replace(/\r/g, '');
      const blocks = [];
      let text = src.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang = '', code = '') => {
        const token = `@@CODE${blocks.length}@@`;
        blocks.push(`<pre><code class="lang-${esc(lang)}">${esc(code.trimEnd())}</code></pre>`);
        return token;
      });

      const lines = text.split('\n');
      const html = [];
      let paragraph = [];
      let listItems = [];
      let listType = null;

      const flushParagraph = () => {
        if (!paragraph.length) return;
        html.push(`<p>${renderDocsInline(paragraph.join(' '))}</p>`);
        paragraph = [];
      };

      const flushList = () => {
        if (!listItems.length) return;
        html.push(`<${listType}>${listItems.map(item => `<li>${renderDocsInline(item)}</li>`).join('')}</${listType}>`);
        listItems = [];
        listType = null;
      };

      for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        const trimmed = line.trim();

        if (!trimmed) {
          flushParagraph();
          flushList();
          continue;
        }

        if (/^@@CODE\d+@@$/.test(trimmed)) {
          flushParagraph();
          flushList();
          const index = Number(trimmed.replace(/\D/g, ''));
          html.push(blocks[index]);
          continue;
        }

        const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
        if (heading) {
          flushParagraph();
          flushList();
          const level = heading[1].length;
          html.push(`<h${level}>${renderDocsInline(heading[2])}</h${level}>`);
          continue;
        }

        const bullet = trimmed.match(/^[-*]\s+(.*)$/);
        if (bullet) {
          flushParagraph();
          if (listType && listType !== 'ul') flushList();
          listType = 'ul';
          listItems.push(bullet[1]);
          continue;
        }

        const ordered = trimmed.match(/^\d+\.\s+(.*)$/);
        if (ordered) {
          flushParagraph();
          if (listType && listType !== 'ol') flushList();
          listType = 'ol';
          listItems.push(ordered[1]);
          continue;
        }

        if (listItems.length) flushList();
        paragraph.push(trimmed);
      }

      flushParagraph();
      flushList();
      return html.join('');
    }

    async function loadProjectDocs(force = false) {
      if (S.docsLoaded && !force) return;
      if (S.docsLoading) return;
      S.docsLoading = true;
      try {
        const md = await fetch('/static/PROJECT_DOCS.md').then(r => {
          if (!r.ok) throw new Error('Failed to load project tutorial');
          return r.text();
        });
        S.docsMarkdown = md;
        S.docsHtml = markdownToDocsHTML(md);
        S.docsLoaded = true;
      } catch (e) {
        S.docsHtml = `<div class="small-muted">${esc(e.message)}</div>`;
      } finally {
        S.docsLoading = false;
      }
    }

    function docsHomeHTML() {
      const body = S.docsLoaded
        ? S.docsHtml
        : `<div class="empty" style="min-height:52vh"><i data-lucide="loader-circle" class="spin" style="width:28px;height:28px"></i><p>Loading project tutorial...</p></div>`;
      return `<div class="docs-page">
        <div class="docs-shell">
          <div class="docs-hero">
            <div class="docs-kicker">Internal Documentation</div>
            <div class="docs-title">Harmony Project Tutorial</div>
            <div class="docs-subtitle">Architecture notes, feature overview, API examples, and implementation guidance directly inside the app UI.</div>
          </div>
          <div class="docs-body">${body}</div>
        </div>
      </div>`;
    }

    function dateSeparatorHTML(label) {
      return `<div class="date-sep"><div class="date-sep-line"></div><span class="date-sep-label">${label}</span><div class="date-sep-line"></div></div>`;
    }

    function appendActiveMessageToDOM(m) {
      const list = document.getElementById('msgs-list');
      if (!list || S.activeCh?.id !== m.channel_id) return false;
      if (list.querySelector('.empty')) return false;

      const msgs = S.messages[m.channel_id] || [];
      const index = msgs.findIndex(x => x.id === m.id);
      if (index < 0) return false;

      const prev = index > 0 ? msgs[index - 1] : null;
      let html = '';
      const currentDate = dateFmt(new Date(m.created_at));
      const prevDate = prev ? dateFmt(new Date(prev.created_at)) : null;
      if (currentDate !== prevDate) html += dateSeparatorHTML(currentDate);
      html += msgHTML(m, prev);

      list.insertAdjacentHTML('beforeend', html);
      lucide.createIcons();
      return true;
    }

    function snapshotInlineMediaState() {
      const root = document.getElementById('msgs-list');
      if (!root) return [];
      return [...root.querySelectorAll('.msg-inline-media[data-media-key]')].map(el => ({
        key: el.dataset.mediaKey,
        currentTime: Number(el.currentTime || 0),
        paused: !!el.paused,
        volume: Number(el.volume ?? 1),
        muted: !!el.muted,
        playbackRate: Number(el.playbackRate || 1),
      }));
    }

    function restoreInlineMediaState(states) {
      if (!states?.length) return;
      states.forEach(state => {
        const key = String(state.key || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const el = document.querySelector(`.msg-inline-media[data-media-key="${key}"]`);
        if (!el) return;
        const apply = () => {
          try { el.currentTime = state.currentTime || 0; } catch { }
          el.volume = state.volume;
          el.muted = state.muted;
          el.playbackRate = state.playbackRate || 1;
          if (!state.paused) {
            const p = el.play();
            if (p?.catch) p.catch(() => { });
          }
        };
        if (el.readyState >= 1) apply();
        else el.addEventListener('loadedmetadata', apply, { once: true });
      });
    }

    function snapshotViewportAnchor() {
      const wrap = document.getElementById('msgs-wrap');
      const list = document.getElementById('msgs-list');
      if (!wrap || !list) return null;
      const wrapRect = wrap.getBoundingClientRect();
      const children = [...list.children];
      if (!children.length) return { scrollTop: wrap.scrollTop, index: -1, offset: 0 };
      const index = Math.max(0, children.findIndex(el => el.getBoundingClientRect().bottom > wrapRect.top + 1));
      const target = children[index] || children[0];
      return {
        scrollTop: wrap.scrollTop,
        index,
        offset: target.getBoundingClientRect().top - wrapRect.top,
      };
    }

    function restoreViewportAnchor(anchor) {
      if (!anchor) return;
      const wrap = document.getElementById('msgs-wrap');
      const list = document.getElementById('msgs-list');
      if (!wrap || !list) return;
      if (anchor.index < 0) {
        wrap.scrollTop = anchor.scrollTop || 0;
        return;
      }
      const target = list.children[anchor.index];
      const wrapRect = wrap.getBoundingClientRect();
      if (!target) {
        wrap.scrollTop = anchor.scrollTop || 0;
        return;
      }
      const delta = (target.getBoundingClientRect().top - wrapRect.top) - anchor.offset;
      wrap.scrollTop += delta;
    }

    function renderMsgs({ preserveBottom = false, keepBottom = false } = {}) {
      const list = document.getElementById('msgs-list');
      const wrap = document.getElementById('msgs-wrap');
      const viewportAnchor = preserveBottom ? snapshotViewportAnchor() : null;
      const mediaStates = snapshotInlineMediaState();

      if (!S.activeCh) {
        list.innerHTML = S.inDMs
          ? `<div class="empty landing-empty" style="height:100%"><div class="auth-logo landing-logo">Harmony</div></div>`
          : `<div class="empty" style="height:100%">
      <i data-lucide="hash" style="width:60px;height:60px;opacity:.15"></i>
      <h2 style="font-size:22px;font-weight:800;color:var(--t1)">Select a channel</h2>
      <p>Choose a channel from the sidebar.</p>
    </div>`;
        lucide.createIcons();
        return;
      }

      if (S.activeCh.type === 'friends_home') {
        list.innerHTML = friendsHomeHTML();
        disableBrowserSuggestions(list);
        lucide.createIcons();
        return;
      }

      if (S.activeCh.type === 'groups_home') {
        list.innerHTML = groupsHomeHTML();
        disableBrowserSuggestions(list);
        lucide.createIcons();
        return;
      }

      if (S.activeCh.type === 'docs_home') {
        list.innerHTML = docsHomeHTML();
        disableBrowserSuggestions(list);
        lucide.createIcons();
        if (!S.docsLoaded && !S.docsLoading) {
          loadProjectDocs().then(() => {
            if (S.activeCh?.type === 'docs_home') {
              renderMsgs();
            }
          });
        }
        return;
      }

      const msgs = S.messages[S.activeCh.id] || [];
      const noticeHtml = dmConversationNotice(S.activeCh);
      if (!msgs.length) {
        const ch = S.activeCh;
        list.innerHTML = `${noticeHtml}<div class="empty" style="height:100%">
      <i data-lucide="${ch.type === 'dm' ? 'message-circle' : ch.type === 'note' ? 'bookmark' : ch.type === 'group' ? 'users' : 'hash'}" style="width:60px;height:60px;opacity:.18"></i>
      <h2 style="font-size:24px;font-weight:800;color:var(--t1)">
        ${ch.type === 'dm' ? esc(ch._name || 'DM') : ch.type === 'note' ? 'Saved Notes' : ch.type === 'group' ? esc(ch.name || ch._name || 'Group') : `Welcome to #${esc(ch.name)}`}
      </h2>
      <p>${ch.type === 'dm' ? 'This is the beginning of your conversation.' : ch.type === 'note' ? 'Keep your private notes here.' : ch.type === 'group' ? 'This is the beginning of your group conversation.' : `This is the start of the #${esc(ch.name)} channel.`}</p>
    </div>`;
        lucide.createIcons();
        return;
      }

      let html = '';
      let prevDate = null;

      msgs.forEach((m, i) => {
        const d = new Date(m.created_at);
        const ds = dateFmt(d);
        if (ds !== prevDate) {
          html += dateSeparatorHTML(ds);
          prevDate = ds;
        }
        html += msgHTML(m, msgs[i - 1]);
      });

      list.innerHTML = noticeHtml + html;
      disableBrowserSuggestions(list);
      lucide.createIcons();
      restoreInlineMediaState(mediaStates);

      if (keepBottom) {
        scrollBottom();
      } else if (preserveBottom) {
        restoreViewportAnchor(viewportAnchor);
      }
    }

    function fileSizeLabel(size = 0) {
      if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(1)}GB`;
      if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
      return `${Math.max(1, Math.round(size / 1024))}KB`;
    }

    function isImageAttachment(a) {
      return /\.(jpe?g|png|gif|webp|bmp|svg|avif)$/i.test(a.url) || a.content_type?.startsWith('image/');
    }

    function isAudioAttachment(a) {
      return /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(a.url) || a.content_type?.startsWith('audio/');
    }

    function isVideoAttachment(a) {
      return /\.(mp4|webm|mov|m4v|ogv)$/i.test(a.url) || a.content_type?.startsWith('video/');
    }

    function renderAttachment(a) {
      const size = fileSizeLabel(a.size || 0);
      const url = escA(a.url);
      const name = esc(a.filename || 'file');
      const mediaKey = escA(String(a.id || a.url || a.filename || 'media'));

      if (isImageAttachment(a)) {
        return `<button class="msg-media-card image" onclick='openMediaViewer(${JSON.stringify(a.url)}, ${JSON.stringify(a.filename || 'Image')})' title="Open image viewer">
          <img src="${url}" alt="${name}" loading="lazy">
        </button>`;
      }

      if (isAudioAttachment(a)) {
        return `<div class="msg-media-card">
          <div class="msg-audio-wrap">
            <audio class="msg-inline-media" data-media-key="${mediaKey}" controls preload="metadata" src="${url}"></audio>
          </div>
          <div class="msg-media-meta">
            <div class="msg-media-name">${name}</div>
            <div>${size}</div>
          </div>
        </div>`;
      }

      if (isVideoAttachment(a) && Number(a.size || 0) <= 100 * 1024 * 1024) {
        return `<div class="msg-media-card">
          <video class="msg-video msg-inline-media" data-media-key="${mediaKey}" controls preload="metadata" src="${url}"></video>
          <div class="msg-media-meta">
            <div class="msg-media-name">${name}</div>
            <div>${size}</div>
          </div>
        </div>`;
      }

      const tooLarge = isVideoAttachment(a) && Number(a.size || 0) > 100 * 1024 * 1024
        ? `<div class="msg-file-size">Video preview disabled above 100MB</div>`
        : `<div class="msg-file-size">${size}</div>`;

      return `<div class="msg-file">
        <div style="color:var(--brand)"><i data-lucide="${isVideoAttachment(a) ? 'film' : isAudioAttachment(a) ? 'music-4' : 'file'}" style="width:20px;height:20px"></i></div>
        <div class="msg-file-info">
          <div class="msg-file-name">${name}</div>
          ${tooLarge}
        </div>
        <a href="${url}" target="_blank" rel="noopener" style="color:var(--t3)"><i data-lucide="download" style="width:16px;height:16px"></i></a>
      </div>`;
    }

    function msgHTML(m, prev) {
      const sys = parseSystemMessage(m.content);
      if (sys) {
        return `<div class="sys-row" id="msg-${m.id}" data-mid="${m.id}">
          <div class="sys-pill ${sys.kind}">${esc(sys.text)}</div>
        </div>`;
      }
      const me = m.author_id === S.me?.id;
      const mentioned = isMentionForMe(m);
      const author = m.author || { id: m.author_id, username: 'Unknown', avatar_url: null, status: 'offline' };
      const status = S.presence[author.id] || author.status || 'offline';
      const authorName = author.server_nickname || getDisplayNameForUser(author.id, author.username || 'Unknown');
      const prevIsSystem = prev ? !!parseSystemMessage(prev.content) : false;
      const sameAuthor = prev && !prevIsSystem && prev.author_id === m.author_id && !m.reply_to
        && (new Date(m.created_at) - new Date(prev.created_at)) < 5 * 60 * 1000
        && dateFmt(new Date(prev.created_at)) === dateFmt(new Date(m.created_at));

      let replyHtml = '';
      if (m.reply_to) {
        const replyName = getDisplayNameForUser(m.reply_to.author_id, m.reply_to.author_display_name || m.reply_to.author_username || 'Unknown');
        replyHtml = `<div class="msg-reply-ref" onclick="scrollToMsg('${m.reply_to.id}')">
      <div class="reply-spine"></div>
      <span class="reply-author">@${esc(replyName)}</span>
      <span class="reply-text">${esc(m.reply_to.content || '')}</span>
    </div>`;
      }

      let badges = '';
      if (m.is_pinned) {
        badges += `<div class="msg-badge"><i data-lucide="pin"></i>Pinned</div>`;
      }
      badges = badges ? `<div class="msg-badges">${badges}</div>` : '';

      let attHtml = '';
      if (m.attachments?.length) {
        m.attachments.forEach(a => {
          attHtml += renderAttachment(a);
        });
      }

      let reactHtml = '';
      if (m.reactions?.length) {
        reactHtml = `<div class="msg-reactions">${m.reactions.map(r => `
      <div class="react-pill${r.me ? ' mine' : ''}" onclick="doReact('${m.id}','${escA(r.emoji)}',${r.me})">
        <span>${r.emoji}</span><span class="react-count">${r.count}</span>
      </div>`).join('')}</div>`;
      }

      const canPin = !S.activeCh?.server_id || canManageMessagesHere();
      const canDelete = me || (S.activeCh?.server_id && canManageMessagesHere());

      const actions = `<div class="msg-actions">
    ${canReactHere() ? `<div class="act" title="React" onclick="emojiFor(event,'${m.id}')"><i data-lucide="smile-plus" style="width:15px;height:15px"></i></div>` : ''}
    <div class="act" title="Reply" onclick="setReplyById('${m.id}')"><i data-lucide="reply" style="width:15px;height:15px"></i></div>
    ${me ? `<div class="act" title="Edit" onclick="startEdit('${m.id}')"><i data-lucide="pencil" style="width:15px;height:15px"></i></div>` : ''}
    ${canPin ? `<div class="act" title="${m.is_pinned ? 'Unpin' : 'Pin'}" onclick="togglePin('${m.id}','${m.channel_id}',${m.is_pinned})"><i data-lucide="${m.is_pinned ? 'pin-off' : 'pin'}" style="width:15px;height:15px"></i></div>` : ''}
    ${canDelete ? `<div class="act danger" title="Delete" onclick="delMsg('${m.id}','${m.channel_id}')"><i data-lucide="trash-2" style="width:15px;height:15px"></i></div>` : ''}
  </div>`;

      const contentHtml = formatContent(m.content || '');

      if (sameAuthor) {
        return `<div class="msg-row${mentioned ? ' mention-hl' : ''}" id="msg-${m.id}" data-mid="${m.id}" oncontextmenu="msgCtx(event,'${m.id}')">
      <div class="msg-ts-col"><span class="msg-ts-small">${timeFmt(new Date(m.created_at))}</span></div>
      <div class="msg-body">
        ${replyHtml}
        <div class="msg-text${m.edited_at ? ' edited' : ''}">${contentHtml}</div>
        ${badges}
        ${attHtml}
        ${reactHtml}
      </div>
      ${actions}
    </div>`;
      }

      return `<div class="msg-row break${mentioned ? ' mention-hl' : ''}${m.reply_to ? ' has-reply' : ''}" id="msg-${m.id}" data-mid="${m.id}" oncontextmenu="msgCtx(event,'${m.id}')">
    <div class="msg-avatar-col" onclick="userCtx(event,'${author.id}')">
      ${avHTML(author, 38, status, 'var(--bg-chat)')}
    </div>
    <div class="msg-body">
      ${replyHtml}
      <div class="msg-head">
        <span class="msg-author" style="color:${colorFor(author.id)}" onclick="userCtx(event,'${author.id}')">${esc(authorName)}</span>
        <span class="msg-time" title="${fullTimeFmt(new Date(m.created_at))}">${fullTimeFmt(new Date(m.created_at))}</span>
      </div>
      <div class="msg-text${m.edited_at ? ' edited' : ''}">${contentHtml}</div>
      ${badges}
      ${attHtml}
      ${reactHtml}
    </div>
    ${actions}
  </div>`;
    }

    function formatContent(text) {
      let s = String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      s = s.replace(/@(\w+)/g, (full, name) => {
        const uname = (S.me?.username || '').toLowerCase();
        const isMe = name.toLowerCase() === uname || name === 'everyone' || name === 'here';
        return `<span class="mention${isMe ? ' me' : ''}">${full}</span>`;
      });

      s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
      s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
      s = s.replace(/`(.+?)`/g, '<code style="background:rgba(0,0,0,.3);padding:1px 5px;border-radius:3px;font-size:13px;font-family:monospace">$1</code>');

      s = s.replace(/(https?:\/\/[^\s<>"]+)/g, url => {
        if (/\.(jpe?g|png|gif|webp)(\?[^\s]*)?$/i.test(url)) {
          return `<img class="msg-img" src="${url}" style="margin-top:4px;max-width:300px;max-height:200px" onclick='openMediaViewer(${JSON.stringify(url)}, ${JSON.stringify("Linked image")})' loading="lazy">`;
        }
        return `<a href="${url}" target="_blank" rel="noopener">${url}</a>`;
      });

      return s;
    }

    function handleMessageCreate(m, source = 'ws') {
      if (m.server_id) S.channelServerMap[m.channel_id] = m.server_id;
      const existed = upsertMessage(m);
      if (source === 'ws' && existed) return;

      const active = S.activeCh?.id === m.channel_id;
      const mine = m.author_id === S.me?.id;
      const important = isMentionForMe(m);
      const target = findChannel(m.channel_id);
      const isPrivatePingStyle = !!target && ['dm', 'group'].includes(target.type);

      if (active) {
        const bottom = isAtBottom();
        const appended = !existed && appendActiveMessageToDOM(m);
        if (!appended) {
          if (!mine && !bottom && source === 'ws') {
            S.pendingNew++;
            renderMsgs({ preserveBottom: true });
            showJumpToBottom();
          } else if (mine && !bottom) {
            renderMsgs({ preserveBottom: true });
          } else {
            renderMsgs({ keepBottom: true });
            hideJumpToBottom();
          }
        } else if (!mine && !bottom && source === 'ws') {
          S.pendingNew++;
          showJumpToBottom();
        } else if (bottom) {
          scrollBottom(true);
          hideJumpToBottom();
        } else {
          hideJumpToBottom();
        }
        clearUnread(m.channel_id);
      } else if (source === 'ws') {
        if (!mine && (isPrivatePingStyle || important)) addUnread(m.channel_id);
      }

      if (S.mentionsOpen && S.activeCh?.id === m.channel_id) openMentionsPanel();
    }

    function handleMessageUpdate(m) {
      const existed = upsertMessage(m);
      if (!existed) return;
      if (S.activeCh?.id === m.channel_id) renderMsgs({ preserveBottom: true });
      if (S.mentionsOpen && S.activeCh?.id === m.channel_id) openMentionsPanel();
    }

    function handleMessageDelete(d) {
      removeMessage(d.channel_id, d.message_id);
      if (S.activeCh?.id === d.channel_id) renderMsgs({ preserveBottom: true });
      if (S.mentionsOpen && S.activeCh?.id === d.channel_id) openMentionsPanel();
    }

    function handlePinUpdate(d) {
      const arr = S.messages[d.channel_id] || [];
      const m = arr.find(x => x.id === d.message_id);
      if (m) m.is_pinned = d.pinned;
      if (S.activeCh?.id === d.channel_id) renderMsgs({ preserveBottom: true });
      if (S.pinsOpen && S.activeCh?.id === d.channel_id) openPins();
    }

    function handleReactionEvent(d, add) {
      const arr = S.messages[d.channel_id] || [];
      const m = arr.find(x => x.id === d.message_id);
      if (!m) return;
      if (!m.reactions) m.reactions = [];
      const r = m.reactions.find(x => x.emoji === d.emoji);

      if (add) {
        if (r) {
          r.count++;
          if (d.user_id === S.me?.id) r.me = true;
        } else {
          m.reactions.push({ emoji: d.emoji, count: 1, me: d.user_id === S.me?.id });
        }
      } else if (r) {
        r.count--;
        if (d.user_id === S.me?.id) r.me = false;
        if (r.count <= 0) m.reactions = m.reactions.filter(x => x !== r);
      }

      if (S.activeCh?.id === d.channel_id) renderMsgs({ preserveBottom: true });
    }

    async function sendMsg() {
      if (!S.activeCh) return;
      if (!canSendHere()) {
        toast('Missing SEND_MESSAGES', 'err');
        return;
      }

      const inp = document.getElementById('msg-input');
      const content = inp.value.trim();
      if (!content) return;

      if (S.editingId) {
        const saved = await finishEdit(content);
        if (saved) {
          inp.value = '';
          autoResize(inp);
        }
        return;
      }

      inp.value = '';
      autoResize(inp);

      try {
        const out = await POST(`/channels/${S.activeCh.id}/messages`, {
          content,
          reply_to_id: S.replyTo?.id || null,
          attachments: [],
        });
        handleMessageCreate(out, 'http');
        clearReply();
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    function inputKey(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMsg();
        return;
      }
      if (e.key === 'Escape' && S.editingId) {
        cancelEdit();
        return;
      }
      if (S.activeCh) {
        wsSend('START_TYPING', { channel_id: S.activeCh.id });
      }
    }

    function autoResize(el) {
      el.style.height = '20px';
      el.style.height = Math.min(el.scrollHeight, 180) + 'px';
    }

    function setReplyById(id) {
      const m = findMessageById(id);
      if (!m) return;
      if (S.editingId) cancelEdit();
      S.replyTo = m;
      const authorName = m.author?.server_nickname || getDisplayNameForUser(m.author?.id, m.author?.username || 'Unknown');
      document.getElementById('reply-ui').style.display = 'flex';
      document.getElementById('reply-ui-txt').innerHTML = `Replying to <strong>${esc(authorName)}</strong>`;
      document.getElementById('msg-input').focus();
    }
    function clearReply() {
      S.replyTo = null;
      document.getElementById('reply-ui').style.display = 'none';
    }
    function scrollToMsg(id) {
      const el = document.getElementById(`msg-${id}`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.background = 'rgba(88,101,242,.2)';
      setTimeout(() => { el.style.background = ''; }, 1500);
    }

    function showEditUI(message) {
      const editUi = document.getElementById('edit-ui');
      const editTxt = document.getElementById('edit-ui-txt');
      if (!editUi || !editTxt) return;
      const text = String(message?.content || '').trim();
      const preview = text.length > 90 ? `${text.slice(0, 90)}…` : text;
      editUi.style.display = 'flex';
      editTxt.innerHTML = `Editing <strong>your message</strong>${preview ? `: ${esc(preview)}` : ''}`;
    }

    function clearEditUI() {
      const editUi = document.getElementById('edit-ui');
      if (editUi) editUi.style.display = 'none';
    }

    function startEdit(id) {
      const m = findMessageById(id);
      if (!m || m.author_id !== S.me?.id) return;
      clearReply();
      S.editingId = id;
      const inp = document.getElementById('msg-input');
      inp.value = m.content || '';
      inp.placeholder = 'Edit message… (Esc to cancel)';
      showEditUI(m);
      inp.focus();
      autoResize(inp);
    }

    async function finishEdit(content) {
      const id = S.editingId;
      if (!id) return false;
      try {
        const out = await PATCH(`/channels/${S.activeCh.id}/messages/${id}`, { content });
        S.editingId = null;
        clearEditUI();
        updateHeader();
        handleMessageUpdate(out);
        return true;
      } catch (e) {
        toast(e.message, 'err');
        return false;
      }
    }
    function cancelEdit() {
      S.editingId = null;
      clearEditUI();
      const inp = document.getElementById('msg-input');
      inp.value = '';
      autoResize(inp);
      updateHeader();
    }

    async function delMsg(id, chId) {
      showConfirm('Delete Message', 'Are you sure you want to delete this message?', async () => {
        try {
          await DELETE_(`/channels/${chId}/messages/${id}`);
          handleMessageDelete({ channel_id: chId, message_id: id });
          toast('Message deleted', 'ok');
        } catch (e) {
          toast(e.message, 'err');
        }
      });
    }

    async function togglePin(msgId, chId, isPinned) {
      try {
        if (isPinned) await DELETE_(`/channels/${chId}/messages/${msgId}/pin`);
        else await POST(`/channels/${chId}/messages/${msgId}/pin`, {});
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    async function doReact(msgId, emoji, isMine) {
      if (!S.activeCh) return;
      try {
        const base = `/channels/${S.activeCh.id}/messages/${msgId}/reactions/${encodeURIComponent(emoji)}/@me`;
        if (isMine) await DELETE_(base);
        else await PUT(base);
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    // ═══════════════════════════════════════════════════
