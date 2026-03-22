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
