'use strict';

    // ═══════════════════════════════════════════════════
    //  Config
    // ═══════════════════════════════════════════════════
    const API = window.location.origin;
    const WS_URL = API.replace(/^http/, 'ws');
    const EMOJIS = ['👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🔥', '💯', '🎉', '✅', '❌', '🤔', '😎', '🚀', '💀', '⭐', '🙏', '💪', '👀', '🫡', '🥲', '😍', '🤣', '😭', '🤝', '🎶', '🍕'];
    const COLORS = ['#f04747', '#faa61a', '#43b581', '#7289da', '#99aab5', '#e91e63', '#9c27b0', '#3f51b5', '#2196f3', '#009688', '#4caf50', '#ff9800', '#ff5722', '#795548'];

    const PERM = {
      READ_MESSAGES: 1 << 0,
      SEND_MESSAGES: 1 << 1,
      MANAGE_MESSAGES: 1 << 2,
      EMBED_LINKS: 1 << 3,
      ATTACH_FILES: 1 << 4,
      ADD_REACTIONS: 1 << 5,
      MANAGE_CHANNELS: 1 << 6,
      MANAGE_ROLES: 1 << 7,
      MANAGE_SERVER: 1 << 8,
      KICK_MEMBERS: 1 << 9,
      BAN_MEMBERS: 1 << 10,
      CREATE_INVITES: 1 << 11,
      VIEW_AUDIT_LOG: 1 << 12,
      ADMINISTRATOR: 1 << 31,
    };

    const ROLE_PERMS = [
      ['ADMINISTRATOR', 'Administrator', 'Bypass all channel-specific permissions'],
      ['READ_MESSAGES', 'Read Messages', 'View channels and read messages'],
      ['SEND_MESSAGES', 'Send Messages', 'Send messages in text channels'],
      ['MANAGE_MESSAGES', 'Manage Messages', 'Delete and pin messages'],
      ['EMBED_LINKS', 'Embed Links', 'Show embeds for links'],
      ['ATTACH_FILES', 'Attach Files', 'Upload files'],
      ['ADD_REACTIONS', 'Add Reactions', 'React to messages'],
      ['MANAGE_CHANNELS', 'Manage Channels', 'Create, edit, delete channels'],
      ['MANAGE_ROLES', 'Manage Roles', 'Create, edit, assign roles'],
      ['MANAGE_SERVER', 'Manage Server', 'Edit server settings'],
      ['KICK_MEMBERS', 'Kick Members', 'Kick members from the server'],
      ['BAN_MEMBERS', 'Ban Members', 'Ban members from the server'],
      ['CREATE_INVITES', 'Create Invites', 'Generate invite links'],
      ['VIEW_AUDIT_LOG', 'View Audit Log', 'Read audit logs'],
    ];

    // ═══════════════════════════════════════════════════
    //  State
    // ═══════════════════════════════════════════════════
    const S = {
      token: localStorage.getItem('h_token'),
      me: null,
      servers: [],
      activeSrv: null,
      inDMs: true,
      channels: {},
      roles: {},
      serverPerms: {},
      channelPerms: {},
      activeCh: null,
      messages: {},
      members: {},
      dms: [],
      dmRequests: [],
      dmOverview: { note: null, friends: [], groups: [], pending: [], requests: [], request_count: 0 },
      presence: {},
      typing: {},
      unread: {},
      channelServerMap: {},
      replyTo: null,
      editingId: null,
      wsConn: null,
      wsHb: null,
      mlOpen: true,
      pinsOpen: false,
      mentionsOpen: false,
      searchOpen: false,
      loading: {},
      pendingNew: 0,
      friendsMenuTab: 'requests',
      groupsMenuTab: 'groups',
      docsMarkdown: '',
      docsHtml: '',
      docsLoaded: false,
      docsLoading: false,
      settingsTab: 'overview',
      managingRolesUserId: null,
      roleEditorRole: null,
      channelEditorMode: 'create',
      channelEditorTarget: null,
    };

    let _typingInterval = null;
    let _emojiCb = null;
    let _promptCb = null;
    let _confirmCb = null;
    let _ctxItems = [];
    let _modalZ = 1000;
    let _uiEnhancerObserver = null;
    let _viewer = {
      open: false,
      scale: 1,
      x: 0,
      y: 0,
      dragging: false,
      moved: false,
      ignoreClose: false,
      startX: 0,
      startY: 0,
    };

    // ═══════════════════════════════════════════════════
    //  HTTP
    // ═══════════════════════════════════════════════════
    async function req(method, path, body) {
      const headers = { ...(S.token ? { Authorization: `Bearer ${S.token}` } : {}) };
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      const r = await fetch(`${API}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      if (r.status === 204) return null;
      if (r.status === 401) {
        doLogout();
        throw new Error('Unauthorized');
      }

      if (!r.ok) {
        let d = {};
        try { d = await r.json(); } catch { }
        throw new Error(d.detail || `HTTP ${r.status}`);
      }

      const txt = await r.text();
      return txt ? JSON.parse(txt) : null;
    }

    const GET = p => req('GET', p);
    const POST = (p, b) => req('POST', p, b);
    const PATCH = (p, b) => req('PATCH', p, b);
    const PUT = (p, b) => req('PUT', p, b ?? {});
    const DELETE_ = p => req('DELETE', p);

    // ═══════════════════════════════════════════════════
    //  Helpers
    // ═══════════════════════════════════════════════════
    function esc(s) {
      return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    function escA(s) {
      return String(s ?? '')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
    function initials(name = '') {
      return name.split(/[\s_-]+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
    }
    function colorFor(id = '') {
      let h = 0;
      for (let i = 0; i < id.length; i++) h = ((h << 5) - h) + id.charCodeAt(i);
      return COLORS[Math.abs(h) % COLORS.length];
    }
    function timeFmt(d) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    function fullTimeFmt(d) {
      return d.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    function dateFmt(d) {
      const now = new Date();
      const diff = now - d;
      if (diff < 86400000 && d.getDate() === now.getDate()) return 'Today';
      if (diff < 172800000 && d.getDate() === new Date(now - 86400000).getDate()) return 'Yesterday';
      return d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
    }
    function hasBits(bits, permBit) {
      return !!((bits & PERM.ADMINISTRATOR) || (bits & permBit));
    }
    function findServer(id) {
      return S.servers.find(s => s.id === id) || null;
    }
    function findChannel(id) {
      if (id === 'friends-home') return friendsHomeChannel();
      if (id === 'groups-home') return groupsHomeChannel();
      if (id === 'docs-home') return docsHomeChannel();
      for (const arr of Object.values(S.channels)) {
        const c = (arr || []).find(x => x.id === id);
        if (c) return c;
      }
      return allDMEntries().find(x => x.id === id) || null;
    }
    function friendsHomeChannel() {
      return { id: 'friends-home', type: 'friends_home', name: 'Friends', topic: 'Manage requests, pending invitations and friends' };
    }
    function groupsHomeChannel() {
      return { id: 'groups-home', type: 'groups_home', name: 'Groups', topic: 'Create and manage your group chats' };
    }
    function docsHomeChannel() {
      return { id: 'docs-home', type: 'docs_home', name: 'Project Tutorial', topic: 'Integrated project tutorial with examples and implementation notes' };
    }
    function isHomeView(ch = S.activeCh) {
      return ['friends_home', 'groups_home', 'docs_home'].includes(ch?.type);
    }
    function disableBrowserSuggestions(root = document) {
      root.querySelectorAll('form').forEach(el => {
        el.setAttribute('autocomplete', 'off');
        el.setAttribute('data-form-type', 'other');
      });
      root.querySelectorAll('input, textarea').forEach(el => {
        if (el.type === 'file' || el.type === 'color') return;
        el.setAttribute('autocomplete', 'off');
        el.setAttribute('autocapitalize', 'off');
        el.setAttribute('autocorrect', 'off');
        el.setAttribute('spellcheck', 'false');
        el.setAttribute('aria-autocomplete', 'none');
        el.setAttribute('data-lpignore', 'true');
        el.setAttribute('data-1p-ignore', 'true');
      });
    }
    function enableCustomTooltips(root = document) {
      const elements = [];
      if (root?.nodeType === 1 && root.matches?.('[title], [data-tip-text]')) {
        elements.push(root);
      }
      if (root?.querySelectorAll) {
        elements.push(...root.querySelectorAll('[title], [data-tip-text]'));
      }
      elements.forEach(el => {
        const text = el.getAttribute('title') || el.dataset.tipText;
        if (!text) return;
        el.dataset.tipText = text;
        if (el.hasAttribute('title')) el.removeAttribute('title');
        if (el.dataset.tipBound === '1') return;
        el.dataset.tipBound = '1';
        el.addEventListener('mouseenter', event => tip(event, el.dataset.tipText));
        el.addEventListener('mouseleave', () => hideTip());
      });
    }
    function applyUIEnhancements(root = document) {
      disableBrowserSuggestions(root);
      enableCustomTooltips(root);
    }
    function observeUIEnhancements() {
      if (_uiEnhancerObserver || typeof MutationObserver === 'undefined' || !document.body) return;
      _uiEnhancerObserver = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) applyUIEnhancements(node);
          });
        });
      });
      _uiEnhancerObserver.observe(document.body, { childList: true, subtree: true });
    }
    applyUIEnhancements();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        applyUIEnhancements();
        observeUIEnhancements();
      }, { once: true });
    } else {
      observeUIEnhancements();
    }
    function allDMEntries() {
      return [...S.dms, ...(S.dmOverview.pending || []), ...S.dmRequests];
    }
    function firstWritableDMChannel() {
      const direct = [
        ...(S.dmOverview.friends || []),
        ...(S.dmOverview.groups || []),
        ...(S.dmOverview.pending || []),
      ].find(ch => ['dm', 'group', 'note'].includes(ch.type) && !(ch.type === 'dm' && ch.relationship_direction === 'incoming'));
      return direct || S.dmOverview.note || null;
    }
    function findDMRequest(id) {
      return S.dmRequests.find(x => x.id === id) || null;
    }
    function applyRelationshipData(data) {
      const overview = data || { note: null, friends: [], groups: [], pending: [], requests: [], request_count: 0 };
      S.dmOverview = {
        note: overview.note || null,
        friends: overview.friends || [],
        groups: overview.groups || [],
        pending: overview.pending || [],
        requests: overview.requests || [],
        request_count: overview.request_count || 0,
      };
      S.dmRequests = [...S.dmOverview.requests];
      S.dms = [
        ...(S.dmOverview.note ? [S.dmOverview.note] : []),
        ...S.dmOverview.friends,
        ...S.dmOverview.groups,
      ];
      if (S.activeCh?.id) {
        const nextActive = allDMEntries().find(c => c.id === S.activeCh.id) || null;
        if (nextActive) S.activeCh = nextActive;
        else if (['dm', 'group', 'note'].includes(S.activeCh.type)) S.activeCh = null;
      }
    }
    function totalDMUnread() {
      return S.dms
        .filter(c => ['dm', 'group'].includes(c.type))
        .reduce((acc, c) => acc + Number(S.unread[c.id] || 0), 0) + (S.dmOverview.request_count || 0);
    }
    function channelServerId(cid) {
      const ch = findChannel(cid);
      if (ch?.server_id) return ch.server_id;
      return S.channelServerMap[cid] || null;
    }
    function syncMLPanel() {
      const visible = !!(S.mlOpen && !S.inDMs && S.activeSrv);
      document.getElementById('ml-panel').style.display = visible ? 'flex' : 'none';
      document.getElementById('btn-ml').classList.toggle('active', visible);
      if (visible) renderML();
    }
    function getDisplayNameForUser(uid, fallback = 'Unknown') {
      if (!S.activeSrv) return fallback;
      const member = (S.members[S.activeSrv.id] || []).find(m => m.user_id === uid);
      return member?.nickname || member?.user?.server_nickname || member?.user?.username || fallback;
    }
    function isAtBottom() {
      const w = document.getElementById('msgs-wrap');
      if (!w) return true;
      return w.scrollHeight - w.scrollTop - w.clientHeight < 120;
    }
    function scrollBottom(force = false) {
      const w = document.getElementById('msgs-wrap');
      if (!w) return;
      w.scrollTop = w.scrollHeight;
      if (force) hideJumpToBottom();
    }
    function showJumpToBottom() {
      const jb = document.getElementById('jump-to-bottom');
      jb.style.display = 'flex';
      document.getElementById('jtb-count').textContent = S.pendingNew > 0 ? `${S.pendingNew} new` : '';
    }
    function hideJumpToBottom() {
      S.pendingNew = 0;
      document.getElementById('jump-to-bottom').style.display = 'none';
    }
    function switchTab(t) {
      ['in', 'up'].forEach(x => {
        document.getElementById('tab-' + x).classList.toggle('active', x === t);
        document.getElementById('pane-' + x).style.display = x === t ? '' : 'none';
      });
    }
    function hexRoleColor(n = 0) {
      return '#' + Number(n || 0).toString(16).padStart(6, '0');
    }
    function currentServerPermBits() {
      return S.activeSrv ? (S.serverPerms[S.activeSrv.id] || 0) : 0;
    }
    function currentChannelPermBits() {
      return S.activeCh ? (S.channelPerms[S.activeCh.id] ?? currentServerPermBits()) : 0;
    }
    function canManageServer() { return hasBits(currentServerPermBits(), PERM.MANAGE_SERVER); }
    function canManageChannels() { return hasBits(currentServerPermBits(), PERM.MANAGE_CHANNELS); }
    function canManageRoles() { return hasBits(currentServerPermBits(), PERM.MANAGE_ROLES); }
    function canKickMembers() { return hasBits(currentServerPermBits(), PERM.KICK_MEMBERS); }
    function canBanMembers() { return hasBits(currentServerPermBits(), PERM.BAN_MEMBERS); }
    function canCreateInvites() { return hasBits(currentServerPermBits(), PERM.CREATE_INVITES); }
    function canViewAudit() { return hasBits(currentServerPermBits(), PERM.VIEW_AUDIT_LOG); }
    function canManageMessagesHere() {
      if (!S.activeCh) return false;
      if (!S.activeCh.server_id) return true;
      return hasBits(currentChannelPermBits(), PERM.MANAGE_MESSAGES);
    }
    function canReactHere() {
      if (!S.activeCh) return false;
      if (!S.activeCh.server_id) return true;
      return hasBits(currentChannelPermBits(), PERM.ADD_REACTIONS);
    }
    function canSendHere() {
      if (!S.activeCh) return false;
      if (S.activeCh.type === 'category') return false;
      if (!S.activeCh.server_id) return true;
      return hasBits(currentChannelPermBits(), PERM.SEND_MESSAGES);
    }
    function formatStatusLabel(status = 'offline') {
      return {
        online: 'Online',
        idle: 'Idle',
        dnd: 'Do Not Disturb',
        invisible: 'Invisible',
        offline: 'Offline',
      }[status] || status;
    }
    function isOwner(server = S.activeSrv) {
      return !!server && server.owner_id === S.me?.id;
    }

    function avHTML(u, size, status = 'offline', borderBase = 'var(--bg-side)') {
      const bg = colorFor(u?.id || u?.username || '');
      const dotSize = size <= 32 ? 10 : 12;
      const inner = u?.avatar_url
        ? `<img src="${escA(u.avatar_url)}" alt="">`
        : `<span>${initials(u?.username || '?')}</span>`;
      return `<div class="av" data-uid="${u?.id || ''}" style="width:${size}px;height:${size}px;font-size:${Math.floor(size * .36)}px;background:${bg}">
    ${inner}
    <div class="av-status ${status}" style="width:${dotSize}px;height:${dotSize}px;border-color:${borderBase}"></div>
  </div>`;
    }

    // ═══════════════════════════════════════════════════
    //  Permissions loading
    // ═══════════════════════════════════════════════════
    async function ensureServerPerms(serverId, force = false) {
      if (!serverId) return 0;
      if (!force && typeof S.serverPerms[serverId] === 'number') return S.serverPerms[serverId];
      try {
        const r = await GET(`/servers/${serverId}/permissions/@me`);
        S.serverPerms[serverId] = r.permissions || 0;
      } catch {
        S.serverPerms[serverId] = 0;
      }
      return S.serverPerms[serverId];
    }
    async function ensureChannelPerms(ch, force = false) {
      if (!ch?.server_id) return 0;
      if (!force && typeof S.channelPerms[ch.id] === 'number') return S.channelPerms[ch.id];
      try {
        const r = await GET(`/channels/${ch.id}/permissions/@me`);
        S.channelPerms[ch.id] = r.permissions || 0;
      } catch {
        S.channelPerms[ch.id] = S.serverPerms[ch.server_id] || 0;
      }
      return S.channelPerms[ch.id];
    }

    // ═══════════════════════════════════════════════════
    //  WebSocket
    // ═══════════════════════════════════════════════════
    function connectWS() {
      if (!S.token) return;

      if (S.wsConn) {
        try { S.wsConn.onclose = null; S.wsConn.close(); } catch { }
      }

      const ws = new WebSocket(`${WS_URL}/gateway?token=${encodeURIComponent(S.token)}`);
      S.wsConn = ws;

      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          onWS(m.op, m.data || {});
        } catch { }
      };

      ws.onclose = () => {
        clearInterval(S.wsHb);
        S.wsHb = null;
        if (S.token) setTimeout(connectWS, 2500);
      };

      ws.onerror = () => {
        try { ws.close(); } catch { }
      };
    }

    function wsSend(op, data = {}) {
      if (S.wsConn?.readyState === 1) {
        S.wsConn.send(JSON.stringify({ op, data }));
      }
    }

    async function onWS(op, d) {
      switch (op) {
        case 'HELLO':
          clearInterval(S.wsHb);
          S.wsHb = setInterval(() => wsSend('HEARTBEAT'), Math.floor((d.heartbeat_interval || 30000) * 0.9));
          break;

        case 'HEARTBEAT_ACK':
          break;

        case 'ERROR':
          toast(d.message || 'Gateway error', 'err');
          break;

        case 'READY':
          if (S.me && d.user) {
            S.me.status = d.user.status || S.me.status;
            S.me.username = d.user.username || S.me.username;
            updatePanel(S.me);
          }
          break;

        case 'PRESENCE_UPDATE':
          handleUserUpdate({ id: d.user_id, status: d.status || 'offline' });
          break;

        case 'TYPING_START':
          handleTyping(d.channel_id, d.user_id, d.username);
          break;

        case 'MESSAGE_CREATE':
          handleMessageCreate(d, 'ws');
          break;

        case 'MESSAGE_ACK':
          handleMessageCreate(d, 'ws');
          break;

        case 'MESSAGE_UPDATE':
          handleMessageUpdate(d);
          break;

        case 'MESSAGE_DELETE':
          handleMessageDelete(d);
          break;

        case 'MESSAGE_PIN_UPDATE':
          handlePinUpdate(d);
          break;

        case 'REACTION_ADD':
          handleReactionEvent(d, true);
          break;

        case 'REACTION_REMOVE':
          handleReactionEvent(d, false);
          break;

        case 'GUILD_CREATE':
          await refreshServers();
          break;

        case 'GUILD_UPDATE': {
          const srv = findServer(d.id);
          if (srv) Object.assign(srv, d);
          renderRail();
          renderSidebarTop();
          if (S.activeSrv?.id === d.id && document.getElementById('m-srv-settings').style.display === 'flex') {
            loadServerSettingsData(S.settingsTab);
          }
          break;
        }

        case 'GUILD_DELETE':
          removeServerLocal(d.id);
          break;

        case 'GUILD_MEMBER_ADD':
          if (S.activeSrv?.id === d.server_id) loadMembers(d.server_id, true);
          break;

        case 'GUILD_MEMBER_REMOVE':
          if (d.user_id === S.me?.id) {
            removeServerLocal(d.server_id);
          } else {
            if (S.members[d.server_id]) {
              S.members[d.server_id] = S.members[d.server_id].filter(m => m.user_id !== d.user_id);
            }
            if (S.activeSrv?.id === d.server_id) renderML();
            if (document.getElementById('m-srv-settings').style.display === 'flex' && S.activeSrv?.id === d.server_id && S.settingsTab === 'members') {
              loadServerSettingsData('members');
            }
          }
          break;

        case 'GUILD_MEMBER_UPDATE':
          if (S.members[d.server_id]) {
            const member = S.members[d.server_id].find(m => m.user_id === d.user_id);
            if (member) {
              if (d.nickname !== undefined) member.nickname = d.nickname;
              if (d.username !== undefined && member.user) member.user.username = d.username;
              if (d.avatar_url !== undefined && member.user) member.user.avatar_url = d.avatar_url;
            }
          }
          if (S.activeSrv?.id === d.server_id) renderML();
          break;

        case 'GUILD_MEMBER_ROLES_UPDATE':
          if (S.activeSrv?.id === d.server_id) loadMembers(d.server_id, true);
          if (S.managingRolesUserId && S.activeSrv?.id === d.server_id) {
            manageRoles(S.managingRolesUserId, true);
          }
          if (document.getElementById('m-srv-settings').style.display === 'flex' && S.activeSrv?.id === d.server_id) {
            if (S.settingsTab === 'members' || S.settingsTab === 'roles') loadServerSettingsData(S.settingsTab);
          }
          break;

        case 'GUILD_BAN_ADD':
        case 'GUILD_BAN_REMOVE':
          if (document.getElementById('m-srv-settings').style.display === 'flex' && S.activeSrv?.id === d.server_id && S.settingsTab === 'bans') {
            loadServerSettingsData('bans');
          }
          break;

        case 'GUILD_MEMBERS':
          S.members[d.server_id] = (d.members || []).map(u => {
            S.presence[u.id] = u.status || 'offline';
            return { user_id: u.id, user: u };
          });
          if (S.activeSrv?.id === d.server_id) renderML();
          break;

        case 'CHANNEL_CREATE': {
          if (!S.channels[d.server_id]) S.channels[d.server_id] = [];
          const exists = S.channels[d.server_id].find(c => c.id === d.id);
          if (!exists) S.channels[d.server_id].push(d);
          else Object.assign(exists, d);
          S.channelServerMap[d.id] = d.server_id;
          S.channels[d.server_id].sort((a, b) => a.position - b.position);
          if (S.activeSrv?.id === d.server_id) renderChs();
          if (document.getElementById('m-srv-settings').style.display === 'flex' && S.activeSrv?.id === d.server_id && S.settingsTab === 'channels') {
            loadServerSettingsData('channels');
          }
          break;
        }

        case 'CHANNEL_UPDATE': {
          const arr = S.channels[d.server_id] || [];
          const ch = arr.find(c => c.id === d.id);
          if (ch) Object.assign(ch, d);
          S.channelServerMap[d.id] = d.server_id;
          if (S.activeCh?.id === d.id) {
            Object.assign(S.activeCh, d);
            updateHeader();
          }
          if (S.activeSrv?.id === d.server_id) renderChs();
          if (document.getElementById('m-srv-settings').style.display === 'flex' && S.activeSrv?.id === d.server_id && S.settingsTab === 'channels') {
            loadServerSettingsData('channels');
          }
          break;
        }

        case 'CHANNEL_DELETE': {
          for (const sid of Object.keys(S.channels)) {
            S.channels[sid] = (S.channels[sid] || []).filter(c => c.id !== d.id);
          }
          delete S.channelServerMap[d.id];
          if (S.activeCh?.id === d.id) {
            const next = S.activeSrv ? (S.channels[S.activeSrv.id] || []).find(c => c.type === 'text') : null;
            if (next) await pickCh(next);
            else {
              S.activeCh = null;
              renderMsgs();
              updateHeader();
            }
          }
          renderChs();
          break;
        }

        case 'ROLE_CREATE': {
          if (!S.roles[d.server_id]) S.roles[d.server_id] = [];
          const exists = S.roles[d.server_id].find(r => r.id === d.id);
          if (!exists) S.roles[d.server_id].push(d);
          else Object.assign(exists, d);
          S.roles[d.server_id].sort((a, b) => b.position - a.position);
          if (S.activeSrv?.id === d.server_id) loadMembers(d.server_id, true);
          if (document.getElementById('m-srv-settings').style.display === 'flex' && S.activeSrv?.id === d.server_id && S.settingsTab === 'roles') {
            loadServerSettingsData('roles');
          }
          break;
        }

        case 'ROLE_UPDATE': {
          const roles = S.roles[d.server_id] || [];
          const role = roles.find(r => r.id === d.id);
          if (role) Object.assign(role, d);
          if (S.activeSrv?.id === d.server_id) loadMembers(d.server_id, true);
          if (document.getElementById('m-srv-settings').style.display === 'flex' && S.activeSrv?.id === d.server_id && S.settingsTab === 'roles') {
            loadServerSettingsData('roles');
          }
          break;
        }

        case 'ROLE_DELETE': {
          S.roles[d.server_id] = (S.roles[d.server_id] || []).filter(r => r.id !== d.role_id);
          if (S.activeSrv?.id === d.server_id) loadMembers(d.server_id, true);
          if (document.getElementById('m-srv-settings').style.display === 'flex' && S.activeSrv?.id === d.server_id && S.settingsTab === 'roles') {
            loadServerSettingsData('roles');
          }
          break;
        }

        case 'USER_UPDATE':
          handleUserUpdate(d);
          break;

        case 'DM_CHANNEL_CREATE':
        case 'DM_REQUEST_CREATE':
        case 'DM_REQUEST_UPDATE':
        case 'DM_CHANNEL_UPDATE':
        case 'DM_CHANNEL_DELETE':
          await loadRelationships();
          if (S.inDMs) renderDMList();
          break;
      }
    }

    // ═══════════════════════════════════════════════════
    //  Auth
    // ═══════════════════════════════════════════════════
    async function doLogin() {
      const username = document.getElementById('in-user').value.trim();
      const password = document.getElementById('in-pass').value;
      const err = document.getElementById('err-in');
      err.style.display = 'none';

      try {
        const r = await POST('/auth/login', { username, password });
        S.token = r.access_token;
        localStorage.setItem('h_token', S.token);
        await boot();
      } catch (e) {
        err.textContent = e.message;
        err.style.display = 'block';
      }
    }

    async function doRegister() {
      const username = document.getElementById('up-username').value.trim();
      const password = document.getElementById('up-pass').value;
      const err = document.getElementById('err-up');
      err.style.display = 'none';

      try {
        const r = await POST('/auth/register', { username, password });
        S.token = r.access_token;
        localStorage.setItem('h_token', S.token);
        await boot();
      } catch (e) {
        err.textContent = e.message;
        err.style.display = 'block';
      }
    }

    function resetStateAfterLogout() {
      S.me = null;
      S.servers = [];
      S.activeSrv = null;
      S.inDMs = true;
      S.channels = {};
      S.roles = {};
      S.serverPerms = {};
      S.channelPerms = {};
      S.activeCh = null;
      S.messages = {};
      S.members = {};
      S.dms = [];
      S.dmRequests = [];
      S.dmOverview = { note: null, friends: [], groups: [], pending: [], requests: [], request_count: 0 };
      S.presence = {};
      S.typing = {};
      S.unread = {};
      S.channelServerMap = {};
      S.replyTo = null;
      S.editingId = null;
      if (typeof clearEditUI === 'function') clearEditUI();
      S.loading = {};
      S.pendingNew = 0;
      S.friendsMenuTab = 'requests';
      S.managingRolesUserId = null;
    }

    function doLogout() {
      S.token = null;
      localStorage.removeItem('h_token');
      clearInterval(S.wsHb);
      S.wsHb = null;
      try { S.wsConn?.close(); } catch { }
      S.wsConn = null;
      resetStateAfterLogout();
      document.getElementById('app').style.display = 'none';
      document.getElementById('auth-screen').style.display = 'flex';
      closeAllPopups();
      document.querySelectorAll('.overlay').forEach(o => o.style.display = 'none');
    }

    // ═══════════════════════════════════════════════════
    //  Boot
    // ═══════════════════════════════════════════════════
    async function boot() {
      document.getElementById('auth-screen').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      lucide.createIcons();

      try {
        const [me, servers, relationships] = await Promise.all([
          GET('/users/@me'),
          GET('/users/@me/servers'),
          GET('/users/@me/relationships'),
        ]);

        S.me = me;
        S.servers = servers;
        applyRelationshipData(relationships);
        S.presence[me.id] = me.status || 'offline';

        await enrichDMs();
        updatePanel(me);
        renderRail();
        showDMs(true);
        connectWS();
      } catch (e) {
        toast(e.message || 'Failed to boot', 'err');
        doLogout();
      }
    }

    async function refreshServers() {
      if (!S.token) return;
      try {
        S.servers = await GET('/users/@me/servers');
        renderRail();
        renderSidebarTop();
      } catch { }
    }

    function removeServerLocal(serverId) {
      S.servers = S.servers.filter(s => s.id !== serverId);
      delete S.channels[serverId];
      delete S.roles[serverId];
      delete S.serverPerms[serverId];
      delete S.members[serverId];

      Object.keys(S.channelPerms).forEach(cid => {
        const ch = findChannel(cid);
        if (!ch || ch.server_id === serverId) delete S.channelPerms[cid];
      });

      if (S.activeSrv?.id === serverId) {
        S.activeSrv = null;
        S.activeCh = null;
        showDMs();
      }
      renderRail();
    }

    // ═══════════════════════════════════════════════════
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
          if (c.other_user) {
            if (d.username) c.other_user.username = d.username;
            if (d.avatar_url !== undefined) c.other_user.avatar_url = d.avatar_url;
            if (d.bio !== undefined) c.other_user.bio = d.bio;
            if (d.pronouns !== undefined) c.other_user.pronouns = d.pronouns;
            if (d.banner_url !== undefined) c.other_user.banner_url = d.banner_url;
            if (d.status) c.other_user.status = d.status;
          }
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
            if (d.pronouns !== undefined) m.user.pronouns = d.pronouns;
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
            if (d.bio !== undefined) m.author.bio = d.bio;
            if (d.pronouns !== undefined) m.author.pronouns = d.pronouns;
            if (d.banner_url !== undefined) m.author.banner_url = d.banner_url;
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
      if (typeof clearEditUI === 'function') clearEditUI();
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
      const isHome = isHomeView(ch);
      iconEl.setAttribute('data-lucide', icons[ch?.type] || 'hash');
      document.getElementById('ch-hdr-name').textContent = ch ? (ch._name || ch.name || '—') : '—';
      document.getElementById('ch-hdr-topic').textContent = ch?.topic || '';
      document.getElementById('topic-sep').style.display = ch?.topic ? '' : 'none';
      document.getElementById('msg-input').placeholder = ch
        ? isHome
          ? (ch.type === 'docs_home' ? 'Read-only tutorial view' : 'Open a friend or group to chat')
          : `Message ${['dm', 'note', 'group'].includes(ch.type) ? '' : '#'}${ch._name || ch.name}`
        : 'Select a channel';
      document.getElementById('btn-pins').style.display = isHome ? 'none' : '';
      document.getElementById('btn-mentions').style.display = isHome ? 'none' : '';
      if (isHome) {
        closePins();
        closeMentions();
      }
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
      const inputWrap = document.getElementById('input-wrap');
      const typingBar = document.getElementById('typing-bar');
      const isHome = isHomeView();

      const enabled = !!S.activeCh && !isHome && canSendHere();
      inputWrap.style.display = isHome ? 'none' : '';
      typingBar.style.display = isHome ? 'none' : '';
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
      if (typeof clearEditUI === 'function') clearEditUI();
      clearReply();
      clearUnread(ch.id);

      updateHeader();

      if (!S.inDMs) renderChs();
      else renderDMList();

      syncMLPanel();

      await ensureChannelPerms(ch);
      updateComposerState();

      const shouldRefetchDirectHistory = ['dm', 'group', 'note'].includes(ch.type);
      if (!S.messages[ch.id] || shouldRefetchDirectHistory) {
        await fetchMsgs(ch.id, shouldRefetchDirectHistory);
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
            <input type="checkbox" data-group-member="${c._otherId}" style="width:16px;height:16px;cursor:pointer">
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
        <input type="checkbox" data-group-member-home="${c._otherId}" style="width:16px;height:16px;cursor:pointer">
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

    function renderMsgs({ preserveBottom = false, keepBottom = false } = {}) {
      const list = document.getElementById('msgs-list');
      const wrap = document.getElementById('msgs-wrap');
      const bottomOffset = wrap.scrollHeight - wrap.scrollTop;

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

      if (keepBottom) {
        scrollBottom();
      } else if (preserveBottom) {
        wrap.scrollTop = Math.max(0, wrap.scrollHeight - bottomOffset);
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

      if (isImageAttachment(a)) {
        return `<button class="msg-media-card image" onclick='openMediaViewer(${JSON.stringify(a.url)}, ${JSON.stringify(a.filename || 'Image')})' title="Open image viewer">
          <img src="${url}" alt="${name}" loading="lazy">
        </button>`;
      }

      if (isAudioAttachment(a)) {
        return `<div class="msg-media-card">
          <div class="msg-audio-wrap">
            <audio controls preload="metadata" src="${url}"></audio>
          </div>
          <div class="msg-media-meta">
            <div class="msg-media-name">${name}</div>
            <div>${size}</div>
          </div>
        </div>`;
      }

      if (isVideoAttachment(a) && Number(a.size || 0) <= 100 * 1024 * 1024) {
        return `<div class="msg-media-card">
          <video class="msg-video" controls preload="metadata" src="${url}"></video>
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

    function isCategoryEntity(chOrType) {
      return (typeof chOrType === 'string' ? chOrType : chOrType?.type) === 'category';
    }

    function channelEntityLabel(chOrType) {
      return isCategoryEntity(chOrType) ? 'Category' : 'Channel';
    }

    function syncChannelEditorType() {
      const type = document.getElementById('cc-type').value;
      const isCategory = isCategoryEntity(type);
      document.getElementById('cc-topic-group').style.display = isCategory ? 'none' : '';
      document.getElementById('cc-parent-group').style.display = isCategory ? 'none' : '';
      document.getElementById('cc-nsfw-group').style.display = isCategory ? 'none' : '';
    }

    function openCreateCh(parentId = null, type = 'text') {
      S.channelEditorMode = 'create';
      S.channelEditorTarget = { parent_id: parentId };
      document.getElementById('ch-editor-title').textContent = `Create ${channelEntityLabel(type)}`;
      document.getElementById('ch-editor-save').textContent = 'Create';
      document.getElementById('cc-type').disabled = false;
      document.getElementById('cc-type').value = type;
      document.getElementById('cc-name').value = '';
      document.getElementById('cc-topic').value = '';
      document.getElementById('cc-nsfw').value = 'false';
      populateChannelParentOptions(parentId);
      syncChannelEditorType();
      openModal('m-channel-editor');
    }

    function openEditChannel(chId) {
      const ch = findChannel(chId);
      if (!ch) return;
      S.channelEditorMode = 'edit';
      S.channelEditorTarget = ch;
      document.getElementById('ch-editor-title').textContent = `Edit ${channelEntityLabel(ch)}`;
      document.getElementById('ch-editor-save').textContent = 'Save';
      document.getElementById('cc-type').value = ch.type;
      document.getElementById('cc-type').disabled = true;
      document.getElementById('cc-name').value = ch.name || '';
      document.getElementById('cc-topic').value = ch.topic || '';
      document.getElementById('cc-nsfw').value = String(!!ch.is_nsfw);
      populateChannelParentOptions(ch.parent_id || null);
      syncChannelEditorType();
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
          const isCategory = isCategoryEntity(type);
          const body = isCategory
            ? { name, type }
            : {
              name,
              type,
              topic: topic || null,
              parent_id,
              is_nsfw
            };
          const ch = await POST(`/servers/${S.activeSrv.id}/channels`, body);
          if (!S.channels[S.activeSrv.id]) S.channels[S.activeSrv.id] = [];
          if (!S.channels[S.activeSrv.id].find(c => c.id === ch.id)) S.channels[S.activeSrv.id].push(ch);
          S.channels[S.activeSrv.id].sort((a, b) => a.position - b.position);
          renderChs();
          closeModal('m-channel-editor');
          if (ch.type === 'text') await pickCh(ch);
          toast(`${channelEntityLabel(ch)} created`, 'ok');
        } else {
          const ch = S.channelEditorTarget;
          const body = isCategoryEntity(ch)
            ? { name }
            : {
              name,
              topic: topic || null,
              parent_id,
              is_nsfw
            };
          const out = await PATCH(`/channels/${ch.id}`, body);
          Object.assign(ch, out);
          renderChs();
          if (S.activeCh?.id === ch.id) {
            Object.assign(S.activeCh, out);
            updateHeader();
          }
          closeModal('m-channel-editor');
          toast(`${channelEntityLabel(ch)} updated`, 'ok');
        }
      } catch (e) {
        toast(e.message, 'err');
      }
    }

    function createCategory() {
      openCreateCh(null, 'category');
    }

    async function deleteCh(chId) {
      const ch = findChannel(chId);
      if (!ch) return;
      const label = channelEntityLabel(ch);
      const targetName = isCategoryEntity(ch) ? ch.name : `#${ch.name}`;
      showConfirm(`Delete ${label}`, `Delete ${targetName}?`, async () => {
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
          toast(`${label} deleted`, 'ok');
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
        delete S.messages[res.channel_id];
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
      document.getElementById('set-pronouns').value = S.me.pronouns || '';
      document.getElementById('set-av').value = S.me.avatar_url || '';
      document.getElementById('set-bn').value = S.me.banner_url || '';
      openModal('m-settings');
    }

    async function saveSettings() {
      const body = {};
      const username = document.getElementById('set-user').value.trim();
      const bio = document.getElementById('set-bio').value.trim();
      const pronouns = document.getElementById('set-pronouns').value.trim();
      const avatar_url = document.getElementById('set-av').value.trim();
      const banner_url = document.getElementById('set-bn').value.trim();

      if (username !== S.me.username) body.username = username;
      if (bio !== (S.me.bio || '')) body.bio = bio;
      if (pronouns !== (S.me.pronouns || '')) body.pronouns = pronouns || null;
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
      <div class="fg"><label class="fl">Server Name</label><input class="fi" id="srv-name" type="text" value="${esc(srv.name)}" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
      <div class="fg"><label class="fl">Icon URL</label><input class="fi" id="srv-icon" type="url" value="${esc(srv.icon_url || '')}" placeholder="https://..." autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
      <div class="fg"><label class="fl">Banner URL</label><input class="fi" id="srv-banner" type="url" value="${esc(srv.banner_url || '')}" placeholder="https://..." autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></div>
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
    <input class="fi member-search" id="members-tab-search" type="text" placeholder="Search members..." oninput="filterMembersTab()" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
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
    //  Role editor / role management
    // ═══════════════════════════════════════════════════
    function buildRolePerms(bits = 0) {
      const wrap = document.getElementById('role-perms');
      wrap.innerHTML = ROLE_PERMS.map(([key, label, desc]) => {
        const bit = PERM[key];
        const checked = hasBits(bits, bit);
        const disabled = key === 'ADMINISTRATOR' ? '' : '';
        return `<label class="setting-card" style="cursor:pointer">
      <input type="checkbox" data-role-perm="${key}" ${checked ? 'checked' : ''} ${disabled} style="width:16px;height:16px;cursor:pointer">
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
        <input type="checkbox" ${current.has(r.id) ? 'checked' : ''} onchange="toggleUserRole('${uid}','${r.id}',this.checked)" style="width:16px;height:16px;cursor:pointer">
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
    function canSendProfileDM(uid) {
      if (uid === S.me?.id) return false;
      return !(S.inDMs && S.activeCh?.type === 'dm');
    }

    async function showUserProfile(uid) {
      closeAllPopups();
      const body = document.getElementById('profile-body');
      body.innerHTML = `<div class="empty"><i data-lucide="loader-circle" class="spin" style="width:24px;height:24px"></i></div>`;
      openModal('m-profile');
      lucide.createIcons();

      try {
        const user = await GET(`/users/${uid}`);
        const status = S.presence[uid] || user.status || 'offline';
        const statusLabel = formatStatusLabel(status);
        const isMe = uid === S.me?.id;
        const canMessage = canSendProfileDM(uid);
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
        <div class="small-muted">${esc(statusLabel)}</div>
        ${user.pronouns ? `<div class="small-muted" style="margin-top:4px">${esc(user.pronouns)}</div>` : ''}
        ${user.bio ? `<div style="margin-top:12px;color:var(--t2)">${esc(user.bio)}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:16px">
          ${canMessage ? `<button class="btn btn-primary" style="flex:1" onclick="sendDMTo('${uid}')">Message</button>` : ''}
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
    function compactCtxItems(items = []) {
      const compact = [];
      items.forEach(item => {
        if (!item) {
          if (!compact.length || !compact[compact.length - 1]) return;
          compact.push(null);
          return;
        }
        compact.push(item);
      });
      while (compact.length && !compact[compact.length - 1]) compact.pop();
      return compact;
    }

    function ctxMenu(event, items) {
      event.preventDefault();
      event.stopPropagation();
      _ctxItems = compactCtxItems(items);
      const m = document.getElementById('ctx-menu');
      m.innerHTML = _ctxItems.map((item, i) => {
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
      const items = [
        { icon: 'copy', label: 'Copy Channel ID', fn: () => navigator.clipboard.writeText(ch.id).then(() => toast('Copied', 'ok')) },
        ch.type === 'category' ? null : { icon: 'pin', label: 'Pinned Messages', fn: () => { pickCh(ch).then(() => setTimeout(openPins, 100)); } },
        canManageChannels() && ch.server_id ? null : null,
        canManageChannels() && ch.server_id ? { icon: 'pencil', label: editLabel, fn: () => openEditChannel(ch.id) } : null,
        canManageChannels() && ch.server_id ? { icon: 'trash-2', label: `Delete ${channelEntityLabel(ch)}`, cls: 'danger', fn: () => deleteCh(ch.id) } : null
      ];
      ctxMenu(event, items);
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
        canSendProfileDM(uid) ? { icon: 'message-square', label: 'Send Message', fn: () => sendDMTo(uid) } : null,
        { icon: 'copy', label: 'Copy User ID', fn: () => navigator.clipboard.writeText(uid).then(() => toast('Copied', 'ok')) },
        notMe && canManageRoles() ? null : null,
        notMe && canManageRoles() ? { icon: 'shield', label: 'Manage Roles', fn: () => manageRoles(uid) } : null,
        notMe && canKickMembers() ? { icon: 'user-minus', label: 'Kick', cls: 'danger', fn: () => kickUser(uid) } : null,
        notMe && canBanMembers() ? { icon: 'ban', label: 'Ban', cls: 'danger', fn: () => banUser(uid) } : null,
      ]);
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
      applyUIEnhancements(el);
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
      const pad = 12;
      let left = event.clientX + 16;
      let top = event.clientY - 4;
      const rect = t.getBoundingClientRect();
      if (left + rect.width + pad > window.innerWidth) {
        left = Math.max(pad, window.innerWidth - rect.width - pad);
      }
      if (top + rect.height + pad > window.innerHeight) {
        top = Math.max(pad, event.clientY - rect.height - 12);
      }
      if (top < pad) top = pad;
      if (left < pad) left = pad;
      t.style.left = left + 'px';
      t.style.top = top + 'px';
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
