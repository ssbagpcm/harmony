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
      return { id: 'docs-home', type: 'docs_home', name: 'Project Docs', topic: 'Integrated project documentation with examples and implementation notes' };
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
