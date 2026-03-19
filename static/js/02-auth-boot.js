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
