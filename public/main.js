// ─── Main Entry Point ─────────────────────────────────────────────────────────
// Lobby flow, socket connection, and event wiring between server ↔ Game engine.
// ──────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const socket = io({
    transports: ['websocket', 'polling'],  // WebSocket first — nginx confirmed 101
    upgrade: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  // Debug: Log connection info
  socket.io.on('open', () => {
    console.log('[Socket.IO] Connected via:', socket.io.engine.transport.name);
  });

  socket.io.engine.on('upgrade', (transport) => {
    console.log('[Socket.IO] Upgraded to:', transport.name);
  });

  // ── Session state ──────────────────────────────────────────────────────────
  let myPlayerId = null;
  let myNickname = null;
  let currentRoomCode = null;
  let hostId = null;
  let isHost = false;
  let players = [];
  let stackingEnabled = false;   // track room stacking setting
  let _autoDrawTimer = null;     // pending auto-draw timeout
  let _lastServerSeq = 0;        // last server-issued room_updated seq; rejects stale events
  let _winnerFallbackTimer = null; // shows winner from game_state if player_won was missed

  // ── Ping measurement ───────────────────────────────────────────────────────
  let _pingLatency = null;
  let _pingInterval = null;
  let _pingTimestamp = null;

  // ── Connection state ───────────────────────────────────────────────────────
  let _connectionState = 'connected';
  let _reconnectAttempts = 0;
  let _lastSlowToast = 0;

  // ── Draw animation sync ────────────────────────────────────────────────────
  // When a multi-card draw happens, we reveal cards one-by-one in sync with
  // the fly animation instead of applying the full hand/count instantly.
  const CARD_FLY_MS = 250; // ms a single card takes to fly (Four Colors style)
  const CARD_STAGGER = 80; // ms between staggered cards (rapid dealing)
  // When a draw is forced by another player's +card, hold the draw animation so
  // the +card is first seen flying to the discard pile (otherwise both happen
  // at once and the penalty cards appear to arrive out of nowhere).
  const FORCED_DRAW_DELAY_MS = 1000;
  let _pendingSelfDrawDelay = 0; // set by player_drew, consumed by hand_updated
  let _bufferedHand = null;          // full hand stored while incremental reveal runs
  let _handAnimating = false;         // true while self draw animation is in progress
  const _drawAnimPlayers = new Set(); // playerIds currently mid draw-animation (for others)
  const _pendingCardCounts = new Map(); // playerId → latest server cardCount received while protected

  // ── Deal animation ──────────────────────────────────────────────────────
  let _dealInProgress = false;  // true during initial round-robin deal
  let _bufferedDealHand = null;   // hand received during deal — revealed card-by-card

  // Shared helper: map opponent index → screen side
  // oppIdx is 0-based among opponents (0 = next player clockwise)
  // oppCount = total number of opponents
  // MUST stay in sync with the nLeft/nRight/nTop split in renderer.js drawOpponents()
  function computeSide(oppIdx, oppCount) {
    let nLeft = 0, nRight = 0;
    if (oppCount === 1) { nLeft = 0; nRight = 0; }
    else if (oppCount === 2) { nLeft = 0; nRight = 0; }
    else if (oppCount === 3) { nLeft = 1; nRight = 1; }
    else if (oppCount === 4) { nLeft = 1; nRight = 1; }
    else if (oppCount === 5) { nLeft = 1; nRight = 1; }
    else if (oppCount === 6) { nLeft = 2; nRight = 2; }
    else if (oppCount <= 9) { nLeft = Math.floor(oppCount / 3); nRight = Math.floor(oppCount / 3); }
    else if (oppCount <= 12) { nLeft = Math.ceil(oppCount / 3); nRight = Math.floor(oppCount / 3); }
    else { nLeft = Math.round(oppCount / 3); nRight = Math.round(oppCount / 3); }
    // leftOps  = opps.slice(0, nLeft)           → indices 0 .. nLeft-1
    // topOps   = opps.slice(nLeft, n-nRight)    → indices nLeft .. n-nRight-1
    // rightOps = opps.slice(n-nRight)           → indices n-nRight .. n-1
    if (oppIdx < nLeft) return 'left';
    if (oppIdx >= oppCount - nRight) return 'right';
    return 'top';
  }

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const $lobby = document.getElementById('lobby');
  const $waitingRoom = document.getElementById('waiting-room');
  const $gameScreen = document.getElementById('game-screen');
  const $browseScreen = document.getElementById('browse-screen');
  const $nickname = document.getElementById('nickname');
  const $roomCode = document.getElementById('room-code');
  const $btnCreate = document.getElementById('btn-create');
  const $btnJoin = document.getElementById('btn-join');
  const $btnBrowse = document.getElementById('btn-browse');
  const $btnBackToLobby = document.getElementById('btn-back-to-lobby');
  const $btnRefreshRooms = document.getElementById('btn-refresh-rooms');
  const $roomsList = document.getElementById('rooms-list');
  const $privateRoomToggle = document.getElementById('private-room-toggle');
  const $btnStart = document.getElementById('btn-start');
  const $btnLeave = document.getElementById('btn-leave');
  const $displayCode = document.getElementById('display-code');
  const $playerList = document.getElementById('player-list');
  const $playerCount = document.getElementById('player-count');
  const $stackingToggle = document.getElementById('stacking-toggle');
  const $hostSettings = document.getElementById('host-settings');
  const $canvas = document.getElementById('game-canvas');
  const $toastContainer = document.getElementById('toast-container');
  const $createSection = document.getElementById('create-section');
  const $btnManagePlayers = document.getElementById('btn-manage-players');
  const $manageModal = document.getElementById('manage-players-modal');
  const $btnCloseManage = document.getElementById('btn-close-manage');
  const $managePlayerList = document.getElementById('manage-player-list');

  // ── Pre-fill nickname from last session ───────────────────────────────────
  const _savedNick = localStorage.getItem('uno_nickname');
  if (_savedNick) $nickname.value = _savedNick;

  // ── Invite Link: pre-fill room code if ?room=CODE in URL ──────────────────
  const _urlParams = new URLSearchParams(window.location.search);
  const _inviteCode = (_urlParams.get('room') || '').toUpperCase().trim();
  const _urlPlayerId = _urlParams.get('playerId');
  const _urlNickname = _urlParams.get('nickname');

  if (_inviteCode && _urlPlayerId && _urlNickname) {
    sessionStorage.setItem('uno_session', JSON.stringify({
      roomCode: _inviteCode,
      playerId: _urlPlayerId,
      nickname: _urlNickname
    }));
  }

  if (_inviteCode) {
    // With the new tab layout, hide just the tab switcher bar and force the
    // Join panel visible — the room code and Join button must always show.
    const $tabBar = document.querySelector('.tab-bar');
    if ($tabBar) $tabBar.style.display = 'none';

    const $panelCreate = document.getElementById('panel-create');
    const $panelJoin = document.getElementById('panel-join');
    if ($panelCreate) $panelCreate.classList.add('tab-panel--hidden');
    if ($panelJoin) $panelJoin.classList.remove('tab-panel--hidden');

    $roomCode.value = _inviteCode;
    $roomCode.setAttribute('readonly', 'readonly'); // code is fixed from link
    $nickname.placeholder = 'Enter your nickname to join';
    if (!_savedNick) $nickname.focus();
    if (!_urlPlayerId || !_urlNickname) {
      history.replaceState({}, '', window.location.pathname); // clean the URL
    }
  }
  const $btnFullscreen = document.getElementById('btn-fullscreen');

  // ── Fullscreen / Landscape Toggle ────────────────────────────────────────
  let _landscapeMode = false;
  $btnFullscreen.addEventListener('click', () => {
    const supportsFS = document.documentElement.requestFullscreen ||
      document.documentElement.webkitRequestFullscreen;
    if (supportsFS && !_landscapeMode) {
      // Try native fullscreen first
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      req.call(el).then(() => {
        // Also try screen orientation lock to landscape
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('landscape').catch(() => { });
        }
        _landscapeMode = true;
        $btnFullscreen.textContent = '×';
        $btnFullscreen.title = 'Exit Fullscreen';
        setTimeout(() => Game.resizeCanvas(), 100);
      }).catch(() => {
        // Fullscreen denied (iOS) — use CSS rotation fallback
        toggleLandscapeFallback();
      });
    } else if (_landscapeMode) {
      // Exit
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        exit.call(document).catch(() => { });
      }
      document.body.classList.remove('landscape');
      _landscapeMode = false;
      $btnFullscreen.textContent = '⛶';
      $btnFullscreen.title = 'Fullscreen / Landscape';
      setTimeout(() => Game.resizeCanvas(), 100);
    } else {
      toggleLandscapeFallback();
    }
  });

  function toggleLandscapeFallback() {
    _landscapeMode = !_landscapeMode;
    document.body.classList.toggle('landscape', _landscapeMode);
    $btnFullscreen.textContent = _landscapeMode ? '×' : '⛶';
    $btnFullscreen.title = _landscapeMode ? 'Exit Landscape' : 'Fullscreen / Landscape';
    setTimeout(() => Game.resizeCanvas(), 150);
  }

  // Sync state when user exits fullscreen via Escape
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && _landscapeMode) {
      document.body.classList.remove('landscape');
      _landscapeMode = false;
      $btnFullscreen.textContent = '⛶';
      $btnFullscreen.title = 'Fullscreen / Landscape';
      setTimeout(() => Game.resizeCanvas(), 100);
    }
  });
  document.addEventListener('webkitfullscreenchange', () => {
    if (!document.webkitFullscreenElement && _landscapeMode) {
      document.body.classList.remove('landscape');
      _landscapeMode = false;
      $btnFullscreen.textContent = '⛶';
      $btnFullscreen.title = 'Fullscreen / Landscape';
      setTimeout(() => Game.resizeCanvas(), 100);
    }
  });

  // ── Screen Switching ───────────────────────────────────────────────────────
  function showScreen(screen) {
    [$lobby, $waitingRoom, $gameScreen, $browseScreen].forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
    if (screen === $gameScreen) {
      setTimeout(() => Game.resizeCanvas(), 50);
    }
  }

  // ── Toast Notifications ────────────────────────────────────────────────────
  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' error' : '');
    toast.textContent = message;
    $toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  function showAfkToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast toast-afk';
    toast.innerHTML = `🤖 <strong>AFK Mode</strong> — ${message}`;
    $toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // ── Player List Rendering (drag-to-reorder) ────────────────────────────────
  let _dragSrcIndex = null;

  function renderPlayerList() {
    $playerList.innerHTML = '';
    $playerCount.textContent = players.length;
    const amHost = myPlayerId === hostId;
    const N = players.length;

    players.forEach((p, i) => {
      const li = document.createElement('li');
      li.dataset.playerId = p.id;

      // Sequence number
      const seq = document.createElement('span');
      seq.className = 'seq-num';
      seq.textContent = i + 1;
      li.appendChild(seq);

      // Drag handle (host only)
      if (amHost) {
        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.textContent = '⠿⠿';
        handle.title = 'Drag to reorder turn order';
        li.appendChild(handle);

        li.draggable = true;
        li.addEventListener('dragstart', (e) => {
          _dragSrcIndex = i;
          li.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', i);
        });
        li.addEventListener('dragend', () => {
          _dragSrcIndex = null;
          li.classList.remove('dragging');
          document.querySelectorAll('#player-list li').forEach(el => el.classList.remove('drag-over'));
        });
        li.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          document.querySelectorAll('#player-list li').forEach(el => el.classList.remove('drag-over'));
          if (_dragSrcIndex !== null && _dragSrcIndex !== i) li.classList.add('drag-over');
        });
        li.addEventListener('drop', (e) => {
          e.preventDefault();
          const src = parseInt(e.dataTransfer.getData('text/plain'), 10);
          if (isNaN(src) || src === i) return;
          const ids = players.map(pl => pl.id);
          const moved = ids.splice(src, 1)[0];
          ids.splice(i, 0, moved);
          socket.emit('reorder_players', { roomCode: currentRoomCode, order: ids });
        });

        // Touch events for mobile
        handle.addEventListener('touchstart', (e) => {
          e.preventDefault(); // Prevent page scroll
          _dragSrcIndex = i;
          li.classList.add('dragging');
        }, { passive: false });

        handle.addEventListener('touchmove', (e) => {
          if (_dragSrcIndex !== i) return;
          e.preventDefault();
          const touch = e.touches[0];
          const target = document.elementFromPoint(touch.clientX, touch.clientY);
          const targetLi = target ? target.closest('li[data-player-id]') : null;

          document.querySelectorAll('#player-list li').forEach(el => el.classList.remove('drag-over'));
          if (targetLi && targetLi !== li) {
            targetLi.classList.add('drag-over');
          }
        }, { passive: false });

        handle.addEventListener('touchend', (e) => {
          if (_dragSrcIndex !== i) return;
          li.classList.remove('dragging');

          const targetLi = document.querySelector('#player-list li.drag-over');
          document.querySelectorAll('#player-list li').forEach(el => el.classList.remove('drag-over'));
          _dragSrcIndex = null;

          if (targetLi) {
            const destId = targetLi.dataset.playerId;
            const destIndex = players.findIndex(p => p.id === destId);
            if (destIndex !== -1 && destIndex !== i) {
              const ids = players.map(pl => pl.id);
              const moved = ids.splice(i, 1)[0];
              ids.splice(destIndex, 0, moved);
              socket.emit('reorder_players', { roomCode: currentRoomCode, order: ids });
            }
          }
        });
      }

      // Avatar
      const avatar = document.createElement('div');
      avatar.className = 'player-avatar';
      avatar.style.background = getAvatarColor(i);
      avatar.textContent = p.isBot ? '🤖' : p.nickname.charAt(0).toUpperCase();
      li.appendChild(avatar);

      // Name
      const name = document.createElement('span');
      name.textContent = p.nickname;
      if (!p.connected) name.style.opacity = '0.4';
      li.appendChild(name);

      if (p.isBot) {
        const bot = document.createElement('span');
        bot.className = 'bot-badge';
        bot.textContent = 'BOT';
        li.appendChild(bot);
      }
      if (p.id === myPlayerId) {
        const you = document.createElement('span');
        you.className = 'you-badge';
        you.textContent = '(you)';
        li.appendChild(you);
      }
      if (p.id === hostId) {
        const host = document.createElement('span');
        host.className = 'host-badge';
        host.textContent = 'HOST';
        li.appendChild(host);
      } else if (amHost) {
        // Kick button for host
        const kickBtn = document.createElement('button');
        kickBtn.className = 'btn-kick';
        kickBtn.innerHTML = '✖';
        kickBtn.title = p.isBot ? 'Remove bot' : 'Kick player';
        kickBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          // Bots are removed without confirmation — it's a settings tweak, not a kick
          if (p.isBot || confirm(`Kick ${p.nickname}?`)) {
            socket.emit('kick_player', { roomCode: currentRoomCode, targetPlayerId: p.id });
          }
        });
        li.appendChild(kickBtn);
      }

      $playerList.appendChild(li);
    });

    if (amHost && N > 1) {
      const hint = document.createElement('p');
      hint.className = 'reorder-hint';
      hint.textContent = '⠿ Drag players to set turn order';
      $playerList.appendChild(hint);
    }

    isHost = amHost;
    $hostSettings.style.display = isHost ? 'block' : 'none';
    if (isHost) {
      $btnStart.disabled = N < 2;
      $btnStart.textContent = N < 2 ? 'Waiting for players...' : `Start Game (${N} players)`;
    } else {
      $btnStart.disabled = true;
      $btnStart.textContent = 'Waiting for host to start...';
    }
  }


  // ── Lobby: Create Room ─────────────────────────────────────────────────────

  $btnCreate.addEventListener('click', () => {
    const nick = $nickname.value.trim();
    if (!nick) {
      showToast('Please enter a nickname', true);
      $nickname.focus();
      return;
    }

    const isPrivate = $privateRoomToggle?.checked || false;

    $btnCreate.disabled = true;
    socket.emit('create_room', { nickname: nick, isPrivate }, (res) => {
      $btnCreate.disabled = false;
      if (res.error) return showToast(res.error, true);

      myPlayerId = res.playerId;
      myNickname = res.nickname;
      currentRoomCode = res.roomCode;

      // Persist session so refresh reconnects automatically
      sessionStorage.setItem('uno_session', JSON.stringify({
        roomCode: res.roomCode,
        playerId: res.playerId,
        nickname: res.nickname,
      }));
      // Remember name for next visit
      localStorage.setItem('uno_nickname', res.nickname);

      $displayCode.textContent = res.roomCode;
      // Push invite link into address bar so host can copy it easily
      history.replaceState({}, '', `?room=${res.roomCode}&playerId=${res.playerId}&nickname=${encodeURIComponent(res.nickname)}`);
      showScreen($waitingRoom);
    });
  });

  // ── Lobby: Play vs Bots (instant solo game — no second human needed) ──────
  const $btnPlayBots = document.getElementById('btn-play-bots');
  const QUICK_PLAY_BOTS = 3; // classic 4-player table

  $btnPlayBots.addEventListener('click', () => {
    const nick = $nickname.value.trim();
    if (!nick) {
      showToast('Please enter a nickname', true);
      $nickname.focus();
      return;
    }

    $btnPlayBots.disabled = true;
    socket.emit('create_room', { nickname: nick, isPrivate: true }, (res) => {
      if (res.error) {
        $btnPlayBots.disabled = false;
        return showToast(res.error, true);
      }

      myPlayerId = res.playerId;
      myNickname = res.nickname;
      currentRoomCode = res.roomCode;

      sessionStorage.setItem('uno_session', JSON.stringify({
        roomCode: res.roomCode,
        playerId: res.playerId,
        nickname: res.nickname,
      }));
      localStorage.setItem('uno_nickname', res.nickname);

      $displayCode.textContent = res.roomCode;
      history.replaceState({}, '', `?room=${res.roomCode}&playerId=${res.playerId}&nickname=${encodeURIComponent(res.nickname)}`);
      showScreen($waitingRoom); // valid fallback state if bot setup fails midway
      showToast('Setting up your game...');

      // Add bots one by one, then start — game_started flips us to the game UI
      let added = 0;
      function addNextBot() {
        socket.emit('add_bot', { roomCode: currentRoomCode }, (botRes) => {
          if (botRes && botRes.error) {
            $btnPlayBots.disabled = false;
            return showToast(botRes.error, true);
          }
          added++;
          if (added < QUICK_PLAY_BOTS) return addNextBot();
          socket.emit('start_game', { roomCode: currentRoomCode }, (startRes) => {
            $btnPlayBots.disabled = false;
            if (startRes && startRes.error) showToast(startRes.error, true);
          });
        });
      }
      addNextBot();
    });
  });

  // ── Waiting Room: Add Bot (host only — button lives inside #host-settings) ─
  const $btnAddBot = document.getElementById('btn-add-bot');
  $btnAddBot.addEventListener('click', () => {
    $btnAddBot.disabled = true;
    socket.emit('add_bot', { roomCode: currentRoomCode }, (res) => {
      $btnAddBot.disabled = false;
      if (res && res.error) return showToast(res.error, true);
      showToast(`${res.nickname} joined the table`);
    });
  });

  // ── Waiting Room: Copy Invite Link ─────────────────────────────────
  const $btnCopyLink = document.getElementById('btn-copy-link');
  $btnCopyLink.addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}?room=${currentRoomCode}`;
    navigator.clipboard.writeText(url).then(() => {
      // Scan-line shimmer across the room code — the "holo" share moment
      $displayCode.classList.remove('code-copied');
      void $displayCode.offsetWidth; // restart the animation on repeat copies
      $displayCode.classList.add('code-copied');
      $btnCopyLink.textContent = '✓ Link Copied!';
      $btnCopyLink.classList.add('copied');
      setTimeout(() => {
        $btnCopyLink.innerHTML = '🔗 Copy Invite Link';
        $btnCopyLink.classList.remove('copied');
      }, 2500);
    }).catch(() => {
      // Fallback: show the URL as toast
      showToast(`Invite: ${url}`);
    });
  });

  // ── Waiting Room: Share on WhatsApp ────────────────────────────────
  const $btnShareWhatsApp = document.getElementById('btn-share-whatsapp');
  $btnShareWhatsApp.addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}?room=${currentRoomCode}`;
    const text = `🃏 Join my UNO game! Room ${currentRoomCode} — tap to play: ${url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  });


  // ── Lobby: Join Room ───────────────────────────────────────────────────────
  function handleJoinSuccess(res, code) {
    myPlayerId = res.playerId;
    myNickname = res.nickname;
    currentRoomCode = code;
    hostId = res.hostId;
    Game.isSpectator = res.isSpectator;
    Game.isGodMode = res.isGodMode;

    // Only apply callback players if no room_updated has arrived yet
    if (_lastServerSeq === 0) players = res.players;

    // Persist session so refresh reconnects automatically
    sessionStorage.setItem('uno_session', JSON.stringify({
      roomCode: code,
      playerId: res.playerId,
      nickname: res.nickname,
    }));
    // Remember name for next visit
    localStorage.setItem('uno_nickname', res.nickname);

    history.replaceState({}, '', `?room=${code}&playerId=${res.playerId}&nickname=${encodeURIComponent(res.nickname)}`);

    $displayCode.textContent = code;
    $stackingToggle.checked = res.settings?.stacking || false;
    stackingEnabled = res.settings?.stacking || false;
    renderPlayerList();

    if (res.gameInProgress && (res.reconnected || res.isSpectator)) {
      showToast(res.isSpectator ? (res.isGodMode ? 'Joined God Mode Spectator' : 'Joined as Spectator') : 'Reconnected!');
      startGameUI();

      // Populate game players for spectators/reconnects using the guaranteed res.players from server
      const playerOrder = (res.players || players).map(p => ({ id: p.id, nickname: p.nickname, cardCount: p.cardCount || 7 }));
      Game.setPlayers(playerOrder);
    } else {
      showScreen($waitingRoom);
    }
  }

  $btnJoin.addEventListener('click', () => {
    const nick = $nickname.value.trim();
    const code = $roomCode.value.trim().toUpperCase();

    if (!nick) { showToast('Please enter a nickname', true); return; }
    if (!code) { showToast('Please enter a room code', true); return; }

    $btnJoin.disabled = true;
    socket.emit('join_room', { roomCode: code, nickname: nick, playerId: null }, (res) => {
      $btnJoin.disabled = false;
      if (res.error) {
        if (res.canSpectate) {
          const pass = prompt("Game is in progress! Enter password for God Mode spectator, or leave blank for normal spectator. Click Cancel to abort.");
          if (pass === null) return;
          $btnJoin.disabled = true;
          socket.emit('join_room', { roomCode: code, nickname: nick, playerId: null, spectator: true, godPassword: pass }, (spectateRes) => {
            $btnJoin.disabled = false;
            if (spectateRes.error) return showToast(spectateRes.error, true);
            handleJoinSuccess(spectateRes, code);
          });
          return;
        }
        return showToast(res.error, true);
      }
      handleJoinSuccess(res, code);
    });
  });

  // ── Lobby: Leave Room ──────────────────────────────────────────────────────
  $btnLeave.addEventListener('click', () => {
    if (!currentRoomCode) return;

    socket.emit('leave_room', { roomCode: currentRoomCode }, (res) => {
      if (res?.success) {
        currentRoomCode = null;
        myPlayerId = null;
        players = [];
        _lastServerSeq = 0;
        sessionStorage.removeItem('uno_session');
        history.replaceState({}, '', window.location.pathname);
        showScreen($lobby);
        showToast('Left the room');
      } else {
        showToast(res?.error || 'Could not leave room', true);
      }
    });
  });

  // ── Lobby: Start Game ──────────────────────────────────────────────────────
  $btnStart.addEventListener('click', () => {
    if (!isHost || !currentRoomCode) return;
    socket.emit('start_game', { roomCode: currentRoomCode }, (res) => {
      if (res?.error) showToast(res.error, true);
    });
  });

  // ── Lobby: Stacking Toggle ─────────────────────────────────────────────────
  $stackingToggle.addEventListener('change', () => {
    if (!isHost || !currentRoomCode) return;
    socket.emit('toggle_stacking', {
      roomCode: currentRoomCode,
      enabled: $stackingToggle.checked,
    });
  });

  // ── Lobby Tabs ─────────────────────────────────────────────────────────────
  const $tabCreate = document.getElementById('tab-create');
  const $tabJoin = document.getElementById('tab-join');
  const $panelCreate = document.getElementById('panel-create');
  const $panelJoin = document.getElementById('panel-join');

  function switchTab(active) {
    const isCreate = active === 'create';
    $tabCreate.classList.toggle('tab-btn--active', isCreate);
    $tabCreate.setAttribute('aria-selected', String(isCreate));
    $tabJoin.classList.toggle('tab-btn--active', !isCreate);
    $tabJoin.setAttribute('aria-selected', String(!isCreate));

    if (isCreate) {
      $panelCreate.classList.remove('tab-panel--hidden');
      $panelJoin.classList.add('tab-panel--hidden');
    } else {
      $panelJoin.classList.remove('tab-panel--hidden');
      $panelCreate.classList.add('tab-panel--hidden');
      $roomCode.focus();
    }
  }

  if ($tabCreate) $tabCreate.addEventListener('click', () => switchTab('create'));
  if ($tabJoin) $tabJoin.addEventListener('click', () => switchTab('join'));

  // ── Browse Rooms ───────────────────────────────────────────────────────────
  $btnBrowse.addEventListener('click', () => {
    showScreen($browseScreen);
    loadRoomsList();
  });

  $btnBackToLobby.addEventListener('click', () => {
    showScreen($lobby);
  });

  $btnRefreshRooms.addEventListener('click', () => {
    loadRoomsList();
    showToast('Refreshing rooms...');
  });

  function loadRoomsList() {
    $roomsList.innerHTML = '<p class="loading-text">Loading rooms...</p>';

    socket.emit('browse_rooms', (res) => {
      if (!res || !res.rooms) {
        $roomsList.innerHTML = '<p class="empty-text">Failed to load rooms</p>';
        return;
      }

      if (res.rooms.length === 0) {
        $roomsList.innerHTML = '<p class="empty-text">No public rooms available. Create one!</p>';
        return;
      }

      $roomsList.innerHTML = '';
      res.rooms.forEach(room => {
        const roomCard = document.createElement('div');
        roomCard.className = 'room-card';

        const roomInfo = document.createElement('div');
        roomInfo.className = 'room-info';

        const roomCode = document.createElement('div');
        roomCode.className = 'room-code-text';
        roomCode.textContent = room.code;

        const roomHost = document.createElement('div');
        roomHost.className = 'room-host';
        roomHost.textContent = room.hostNickname;

        const roomMeta = document.createElement('div');
        roomMeta.className = 'room-meta';

        const roomPlayers = document.createElement('span');
        roomPlayers.className = 'room-players';
        roomPlayers.textContent = `${room.playerCount}/${room.maxPlayers}`;

        const roomStatus = document.createElement('span');
        roomStatus.className = `room-status ${room.status}`;
        roomStatus.textContent = room.status === 'lobby' ? 'Waiting' : 'In Game';

        roomMeta.appendChild(roomPlayers);
        roomMeta.appendChild(roomStatus);

        roomInfo.appendChild(roomCode);
        roomInfo.appendChild(roomHost);
        roomInfo.appendChild(roomMeta);

        const joinBtn = document.createElement('button');
        joinBtn.className = 'btn btn-join-room';
        joinBtn.textContent = room.status === 'lobby' ? 'Join' : 'Spectate';
        joinBtn.addEventListener('click', () => {
          const nick = $nickname.value.trim();
          if (!nick) {
            showToast('Please enter a nickname first', true);
            showScreen($lobby);
            $nickname.focus();
            return;
          }

          joinBtn.disabled = true;
          const spectator = room.status === 'playing';
          socket.emit('join_room', { roomCode: room.code, nickname: nick, spectator }, (res) => {
            joinBtn.disabled = false;
            if (res.error) {
              showToast(res.error, true);
            } else {
              handleJoinSuccess(res, room.code);
            }
          });
        });

        roomCard.appendChild(roomInfo);
        roomCard.appendChild(joinBtn);
        $roomsList.appendChild(roomCard);
      });
    });
  }

  // ── Enter key for inputs ───────────────────────────────────────────────────
  $nickname.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    // Trigger whichever tab is active
    if ($tabCreate && $tabCreate.classList.contains('tab-btn--active')) {
      $btnCreate.click();
    } else {
      $btnJoin.click();
    }
  });
  $roomCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $btnJoin.click();
  });

  // Auto-uppercase room code input
  $roomCode.addEventListener('input', () => {
    $roomCode.value = $roomCode.value.toUpperCase();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ── Connection Management ─────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  function showReconnectOverlay() {
    const $overlay = document.getElementById('reconnect-overlay');
    if ($overlay) $overlay.style.display = 'flex';
  }

  function hideReconnectOverlay() {
    const $overlay = document.getElementById('reconnect-overlay');
    if ($overlay) $overlay.style.display = 'none';
  }

  function updateReconnectMessage(msg) {
    const $msg = document.getElementById('reconnect-message');
    if ($msg) $msg.textContent = msg;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── Ping Monitoring ───────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  let _pingIntervalDuration = 3000;

  function startPingMonitoring() {
    clearInterval(_pingInterval);

    function doPing() {
      // Skip ping measurement if tab is hidden (avoid inaccurate throttled results)
      if (document.hidden) return;

      _pingTimestamp = Date.now();
      socket.emit('ping_measure');

      // Warn about slow connection (max once per minute)
      if (_pingLatency > 500 && Date.now() - _lastSlowToast > 60000) {
        showToast('⚠ Slow connection detected');
        _lastSlowToast = Date.now();
      }
    }

    _pingInterval = setInterval(doPing, _pingIntervalDuration);
  }

  // Adjust ping frequency based on tab visibility to minimize throttling impact
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      console.log('[Ping] Tab hidden - reducing ping frequency');
      // Slow down ping when hidden (less wasted measurements)
      clearInterval(_pingInterval);
      _pingIntervalDuration = 10000; // 10 seconds when hidden
      startPingMonitoring();
      updatePingDisplay(); // Show "paused" immediately
    } else {
      console.log('[Ping] Tab visible - normal ping frequency');
      // Speed up ping when visible
      clearInterval(_pingInterval);
      _pingIntervalDuration = 3000; // 3 seconds when visible
      startPingMonitoring();
      updatePingDisplay(); // Restore display immediately
      // Immediately measure ping when tab becomes visible
      _pingTimestamp = Date.now();
      socket.emit('ping_measure');
    }
  });

  function updatePingDisplay() {
    const $ping = document.getElementById('ping-indicator');
    if (!$ping) return;

    const $pingMs = $ping.querySelector('.ping-ms');
    if (!$pingMs) return;

    // Show "paused" if tab is hidden
    if (document.hidden) {
      $pingMs.textContent = '⏸ paused';
      $ping.className = 'ping-indicator dimmed';
      return;
    }

    if (_pingLatency === null) {
      $pingMs.textContent = '-- ms';
      $ping.className = 'ping-indicator';
      return;
    }

    $pingMs.textContent = `${_pingLatency} ms`;

    // Realistic thresholds for a turn-based game
    if (_pingLatency < 150) {
      $ping.className = 'ping-indicator'; // Green - Excellent
    } else if (_pingLatency < 300) {
      $ping.className = 'ping-indicator yellow'; // Yellow - Good
    } else {
      $ping.className = 'ping-indicator red'; // Red - Poor
    }
  }

  socket.on('pong_measure', () => {
    if (_pingTimestamp) {
      const raw = Date.now() - _pingTimestamp;
      // Exponential moving average for smoother display (α = 0.3)
      _pingLatency = _pingLatency === null ? raw : Math.round(_pingLatency * 0.7 + raw * 0.3);

      // Debug log (remove in production)
      console.log(`[Ping] Raw: ${raw}ms | Smoothed: ${_pingLatency}ms | Transport: ${socket.io.engine?.transport?.name || 'unknown'}`);

      updatePingDisplay();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ── Auto-reconnect on page refresh ────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('connect', () => {
    const saved = (() => {
      try {
        return JSON.parse(sessionStorage.getItem('uno_session'));
      } catch {
        return null;
      }
    })();

    // Validate session data
    if (!saved || !saved.roomCode || !saved.nickname) {
      startPingMonitoring();
      return;
    }

    // Prevent duplicate reconnection if already in room
    if (currentRoomCode) {
      startPingMonitoring();
      return;
    }

    showReconnectOverlay();
    updateReconnectMessage('Rejoining your room...');

    // Attempt to re-join the saved room silently
    socket.emit('join_room', { roomCode: saved.roomCode, nickname: saved.nickname, playerId: saved.playerId }, (res) => {
      hideReconnectOverlay();

      if (res.error) {
        sessionStorage.removeItem('uno_session');
        showToast(`Could not reconnect: ${res.error}`, true);
        showScreen($lobby);
        startPingMonitoring();
        return; // Room gone — show lobby
      }
      myPlayerId = res.playerId;
      myNickname = res.nickname;
      currentRoomCode = saved.roomCode;
      hostId = res.hostId;
      if (_lastServerSeq === 0) players = res.players;

      sessionStorage.setItem('uno_session', JSON.stringify({
        roomCode: saved.roomCode,
        playerId: res.playerId,
        nickname: res.nickname,
      }));

      history.replaceState({}, '', `?room=${saved.roomCode}&playerId=${res.playerId}&nickname=${encodeURIComponent(res.nickname)}`);

      $displayCode.textContent = saved.roomCode;
      $stackingToggle.checked = res.settings?.stacking || false;
      stackingEnabled = res.settings?.stacking || false;

      if (res.gameInProgress && res.reconnected) {
        showToast('✓ Reconnected successfully!');
        // Build player list with known card counts (will be updated by game_state)
        const playerOrder = res.players.map(p => ({
          id: p.id, nickname: p.nickname, cardCount: 7,
        }));
        startGameUI();
        Game.setPlayers(playerOrder);
      } else {
        renderPlayerList();
        showScreen($waitingRoom);
      }

      startPingMonitoring();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ── Socket Event Handlers ──────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('room_updated', (data) => {
    const seq = data.seq || 0;
    // Discard stale updates (can happen if events arrive out of order)
    if (seq > 0 && seq <= _lastServerSeq) return;
    _lastServerSeq = seq;
    players = data.players;      // exact order from server, no local mutation
    hostId = data.hostId;
    isHost = myPlayerId === hostId;
    if (data.settings) {
      $stackingToggle.checked = data.settings.stacking;
      stackingEnabled = data.settings.stacking || false;
    }
    renderPlayerList();
    updateManagePlayersButton();
  });

  socket.on('player_kicked', (data) => {
    showToast(`${data.nickname} was kicked from the room`);
    // During an active game, prune the kicked player from the renderer immediately.
    // The server will follow up with game_state + room_updated to confirm,
    // but we act eagerly here so the canvas never shows a ghost player.
    if (data.playerId && Game.state?.players?.length) {
      const pruned = Game.state.players.filter(p => p.id !== data.playerId);
      if (pruned.length !== Game.state.players.length) {
        Game.setPlayers(pruned);
      }
    }
  });

  socket.on('player_left', (data) => {
    showToast(data.surrendered ? `🏳️ ${data.nickname} surrendered` : `${data.nickname} left the room`);
    // Surrendered mid-game: prune them from the canvas immediately so no
    // ghost seat remains (same eager prune as player_kicked).
    if (data.playerId && Game.state?.players?.length) {
      const pruned = Game.state.players.filter(p => p.id !== data.playerId);
      if (pruned.length !== Game.state.players.length) {
        Game.setPlayers(pruned);
      }
    }
  });

  socket.on('kicked_from_room', () => {
    showToast('You were kicked from the room', true);
    myPlayerId = null;
    currentRoomCode = null;
    hostId = null;
    isHost = false;
    players = [];
    history.replaceState({}, '', window.location.pathname); // clean the URL
    showScreen($lobby);
  });

  socket.on('game_started', (data) => {
    showToast('Game started!');
    if (data.settings) stackingEnabled = data.settings.stacking || false;
    startGameUI();

    // All players start at 0 cards — deal animation fills them up
    const playerOrder = data.playerOrder.map(p => ({
      id: p.id,
      nickname: p.nickname,
      cardCount: 0,
    }));
    Game.setPlayers(playerOrder);
    // Strip cardCounts so updateGameState doesn't instantly set everyone to 7.
    // The deal animation increments counts one card at a time.
    Game.updateGameState({ ...data, cardCounts: null });


    // ── Round-robin deal animation (Four Colors style) ─────────
    // Deal cards one at a time: P1→P2→P3→P4→P1→P2→...
    // Each card uses flyCardToPlayer with an onLand callback that
    // increments the count and reveals the hand card on arrival.
    // Cards are dealt SEQUENTIALLY — each card waits for the previous
    // to land before the next launches, ensuring perfect sync.
    const CARDS_EACH = 7;
    const DEAL_GAP = 20; // ms pause after a card lands before next launches

    // Build deal order starting from local player
    const myIdx = playerOrder.findIndex(p => p.id === myPlayerId);
    const N = playerOrder.length;
    const dealOrder = []; // [{ id, toSelf }]
    for (let i = 0; i < N; i++) {
      const pi = (myIdx + i) % N;
      const p = playerOrder[pi];
      dealOrder.push({ id: p.id, toSelf: i === 0 });
    }

    _dealInProgress = true;
    // hand_updated arrives BEFORE game_started — _bufferedDealHand already has cards

    const totalCards = CARDS_EACH * N;

    // Sequential deal: launch card N, wait for it to land + DEAL_GAP, then launch N+1
    function dealCard(seq) {
      if (seq >= totalCards) return; // all cards dealt

      const playerSlot = seq % N;
      const dp = dealOrder[playerSlot];
      const isLastCard = seq === totalCards - 1;

      Game.flyCardToPlayer({
        toSelf: dp.toSelf,
        targetPlayerId: dp.toSelf ? null : dp.id,
        onLand: () => {
          // Card has visually arrived — sync state NOW
          const pl = Game.state.players.find(x => x.id === dp.id);
          if (pl) pl.cardCount++;

          // Reveal one hand card in sync when dealt to local player
          if (dp.toSelf && _bufferedDealHand) {
            const selfCount = Game.state.players.find(x => x.id === myPlayerId)?.cardCount || 0;
            Game.state.myHand = _bufferedDealHand.slice(0, selfCount);
          }

          // Last card of the whole deal
          if (isLastCard) {
            if (_bufferedDealHand) {
              Game.setHand(_bufferedDealHand); // final proper setHand
              _bufferedDealHand = null;
            }
            _dealInProgress = false;
          } else {
            // Chain: launch next card after a short gap
            setTimeout(() => dealCard(seq + 1), DEAL_GAP);
          }
        },
      });
    }

    // Kick off the first card
    dealCard(0);
  });

  socket.on('hand_updated', (data) => {
    // The server sends hand_updated BEFORE game_started, so _dealInProgress is
    // still false when this arrives for the initial deal. Detect this by checking
    // if the game canvas hasn't been initialized yet.
    if (!Game.state.active || _dealInProgress) {
      _bufferedDealHand = data.cards;
      return;
    }

    // Consume any hold requested by a forced draw — the server sends player_drew
    // (which sets this) before hand_updated, so it's ready by the time we're here
    const baseDelay = _pendingSelfDrawDelay;
    _pendingSelfDrawDelay = 0;

    const prevLen = Game.state.myHand.length;
    const newCards = data.cards;
    const added = newCards.length - prevLen;

    // Single card or removal — apply immediately
    if (added <= 1) {
      Game.setHand(newCards);
      return;
    }

    // Multi-card draw: reveal one card per animation frame
    _handAnimating = true;
    _bufferedHand = newCards;

    for (let i = 0; i < added; i++) {
      const delay = baseDelay + i * CARD_STAGGER + CARD_FLY_MS; // wait for each card to land
      setTimeout(() => {
        if (!_bufferedHand) return; // cancelled
        // Show cards up to prevLen + i + 1
        Game.state.myHand = _bufferedHand.slice(0, prevLen + i + 1);
        if (i === added - 1) {
          // Final card: do a proper setHand so scroll/selection is recalculated
          Game.setHand(_bufferedHand);
          _handAnimating = false;
          _bufferedHand = null;
        }
      }, delay);
    }
  });


  socket.on('game_state', (data) => {
    // While deal animation is running, skip card count updates entirely —
    // the deal loop increments counts one-by-one in sync with the animations.
    if (data.cardCounts && Game.state.players.length > 0 && !_dealInProgress) {
      const updated = Game.state.players.map(p => {
        if (_drawAnimPlayers.has(p.id)) {
          // Protected — save for later
          _pendingCardCounts.set(p.id, data.cardCounts[p.id]);
          return { ...p, cardCount: p.cardCount };
        } else {
          return { ...p, cardCount: data.cardCounts[p.id] ?? p.cardCount };
        }
      });
      Game.setPlayers(updated);
    }
    // During deal, also strip cardCounts from updateGameState so the
    // direct player-count increments in the deal loop aren't overwritten.
    Game.updateGameState(_dealInProgress ? { ...data, cardCounts: null } : data);

    // Winner fallback: the live player_won event drives the normal win
    // sequence (confetti, then winner screen 600ms later). But that event is
    // transient — a client that was disconnected when the game ended (hidden
    // mobile tab while AFK auto-play finished their hand, refresh at game
    // end) never gets it, and used to rejoin a finished game as a frozen
    // table. game_state now carries `winner`, so honor it after a grace
    // period that lets the live sequence win the race when both arrive.
    if (data.winner && !Game.state.winner) {
      const wp = Game.state.players.find(p => p.id === data.winner) ||
                 players.find(p => p.id === data.winner);
      const wname = wp ? wp.nickname : 'Winner';
      clearTimeout(_winnerFallbackTimer);
      _winnerFallbackTimer = setTimeout(() => {
        if (!Game.state.winner) {
          Game.setWinner(data.winner, wname);
          showToast(`🎉 ${wname} wins!`);
        }
      }, 900);
    }

    // Show 30s turn timer in UI (not once the game is decided)
    if (data.currentPlayer && !data.winner) {
      Game.setTurnTimer(data.currentPlayer, 30000);
    }

    // Auto-draw: if stacking is ON, it's my turn, I have a pendingDraw,
    // and I have NO valid stack card → automatically draw after a brief delay
    // (gives time for the +N flash animation to finish)
    if (stackingEnabled && data.pendingDraw > 0 && data.currentPlayer === myPlayerId) {
      const myHand = Game.state.myHand || [];
      const drawType = data.pendingDrawType; // 'draw2' | 'wild4' | 'wild8'
      const canStack = myHand.some(c => c.type === drawType);
      if (!canStack) {
        clearTimeout(_autoDrawTimer);
        _autoDrawTimer = setTimeout(() => {
          // Double-check it's still my turn with pending draw
          if (Game.state.pendingDraw > 0 && Game.state.currentPlayer === myPlayerId) {
            socket.emit('draw_card', { roomCode: currentRoomCode });
          }
        }, 1200); // wait for +N animation
      }
    } else {
      clearTimeout(_autoDrawTimer);
    }
  });

  socket.on('card_effect', (data) => {
    const { cardType, chosenColor, playedBy } = data;

    // If another player played this card, animate it flying from their zone to the discard pile
    if (playedBy && playedBy !== myPlayerId) {
      const myIdx = players.findIndex(pl => pl.id === myPlayerId);
      if (myIdx !== -1) {
        const n = players.length;
        const opps = [];
        for (let i = 1; i < n; i++) opps.push({ id: players[(myIdx + i) % n].id, oppIdx: i - 1 });
        const tgtOpp = opps.find(o => o.id === playedBy);
        if (tgtOpp) {
          const side = computeSide(tgtOpp.oppIdx, opps.length);
          // playerId lets the animation start from the exact seat; side is fallback
          Game.triggerAnimation('fly_opponent_card', { side, playerId: playedBy });
        }
      }
    }

    // Show label + flash effects. For OUR own play the card is still flying
    // to the pile (~700ms flight) — hold the effects until it visually lands
    // so the +N/skip/reverse callout doesn't fire while the card is mid-air.
    const effectDelay = playedBy === myPlayerId ? 620 : 0;
    setTimeout(() => {
      if (cardType === 'draw2') {
        Game.showDomAnim('anim-plus', '+2', 2000);
        Game.showDomAnim('anim-red-flash', '', 1000);
      } else if (cardType === 'wild4') {
        Game.showDomAnim('anim-plus', '+4', 2000);
        Game.showDomAnim('anim-red-flash', '', 1000);
      } else if (cardType === 'wild8') {
        Game.showDomAnim('anim-plus', '+8', 2000);
        Game.showDomAnim('anim-red-flash', '', 1000);
      } else if (cardType === 'reverse') {
        Game.triggerAnimation('reverse');
      } else if (cardType === 'skip') {
        Game.triggerAnimation('skip');
      } else if (cardType === 'wild') {
        Game.triggerAnimation('color_change', { color: chosenColor });
      } else if (playedBy !== myPlayerId) {
        // Own number-card ripple is fired by the flight's landing instead
        Game.triggerAnimation('card_played');
      }
      // Build the discard pile visual stack
      Game.triggerAnimation('discard_land');
    }, effectDelay);
  });


  // ── player_drew: THE only place card-fly animations happen ──────────────
  // Direction: toSelf = fly to bottom (your hand). !toSelf = fly to opponent area.
  socket.on('player_drew', (data) => {
    const p = players.find(pl => pl.id === data.playerId);
    const name = p ? p.nickname : 'Player';
    if (data.playerId !== myPlayerId) {
      showToast(`${name} drew ${data.count} card${data.count > 1 ? 's' : ''}`);
    }

    const toSelf = data.playerId === myPlayerId;
    const pid = data.playerId;

    // Draw forced by another player's +card: hold the incoming-card animation
    // so the +card is seen landing on the discard pile first
    const startDelay = (data.causedBy && data.causedBy !== data.playerId) ? FORCED_DRAW_DELAY_MS : 0;
    if (toSelf) _pendingSelfDrawDelay = startDelay; // hand_updated arrives next and syncs to this

    // For opponents: protect their card count during animation
    if (!toSelf) {
      _drawAnimPlayers.add(pid);
    }

    // Trigger fly animations staggered per card, with onLand callbacks
    for (let i = 0; i < data.count; i++) {
      const isLast = i === data.count - 1;

      setTimeout(() => {
        Game.flyCardToPlayer({
          toSelf,
          targetPlayerId: toSelf ? null : pid,
          onLand: () => {
            if (!toSelf && isLast) {
              // Animation complete — apply pending server count and unprotect
              _drawAnimPlayers.delete(pid);
              if (_pendingCardCounts.has(pid)) {
                const pl = Game.state.players.find(x => x.id === pid);
                if (pl) pl.cardCount = _pendingCardCounts.get(pid);
                _pendingCardCounts.delete(pid);
              }
            }
            // Self: hand reveal is driven by hand_updated handler
          },
        });
      }, startDelay + i * CARD_STAGGER);
    }

    // If this was MY normal draw (not forced), show Pass Turn button
    if (toSelf && data.mustPass) {
      Game.state.hasDrawnThisTurn = true;
    }

    if (data.count > 1) {
      if (startDelay > 0) {
        setTimeout(() => Game.triggerAnimation('draw_flash'), startDelay);
      } else {
        Game.triggerAnimation('draw_flash');
      }
    }
  });

  socket.on('god_hands', (hands) => {
    Game.godHands = hands;
    if (!Game.spectatingPlayerId && players.length > 0) {
      Game.spectatingPlayerId = players[0].id;
    }
    Game.render();
  });

  socket.on('turn_skipped', (data) => {
    const p = players.find(pl => pl.id === data.playerId);
    if (p) showToast(`${p.nickname}'s turn was skipped`);
    Game.triggerAnimation('skip');
  });

  socket.on('uno_trigger', () => {
    showToast('Press UNO! 🔴');
  });

  socket.on('afk_action', (data) => {
    const isMe = data.playerId === myPlayerId;
    showAfkToast(isMe ? 'You were AFK — auto-played!' : `${data.nickname} is AFK — auto-playing...`);
  });

  socket.on('uno_called', (data) => {
    const p = players.find(pl => pl.id === data.playerId);
    showToast(`${p ? p.nickname : 'Someone'} called UNO! 🔴`);
    Game.triggerAnimation('uno');
  });

  socket.on('direction_changed', () => {
    Game.triggerAnimation('reverse');
  });

  socket.on('uno_caught', (data) => {
    const target = players.find(p => p.id === data.targetId);
    const catcher = players.find(p => p.id === data.catcherId);
    showToast(`${catcher?.nickname || 'Someone'} caught ${target?.nickname || 'a player'}! +${data.penaltyCount} cards`);
  });

  socket.on('player_won', (data) => {
    // Confetti first, then winner screen after a brief delay
    Game.triggerAnimation('winner');
    setTimeout(() => {
      Game.setWinner(data.playerId, data.nickname);
      showToast(`🎉 ${data.nickname} wins!`);
    }, 600);
  });

  socket.on('game_restarted', () => {
    Game.resetGame();
    Game.destroy();
    showScreen($waitingRoom);
    showToast('Game ended — back to lobby');
  });

  socket.on('error', (data) => {
    showToast(data.message, true);
  });

  socket.on('disconnect', () => {
    _connectionState = 'reconnecting';
    _reconnectAttempts = 0;
    clearInterval(_pingInterval);
    _pingLatency = null;
    updatePingDisplay();
    showReconnectOverlay();
    showToast('Connection lost — reconnecting...', true);
  });

  // Socket.IO reconnection events
  socket.io.on('reconnect_attempt', (attempt) => {
    _reconnectAttempts = attempt;
    updateReconnectMessage(`Reconnect attempt ${attempt}...`);
  });

  socket.io.on('reconnect_failed', () => {
    updateReconnectMessage('Reconnection failed. Please refresh the page.');
  });

  socket.io.on('reconnect', () => {
    _connectionState = 'connected';
    hideReconnectOverlay();
  });

  // Mid-session reconnect (socket temporarily dropped)
  socket.on('connect', () => {
    if (!currentRoomCode || !myNickname) return; // handled by sessionStorage handler above
    socket.emit('join_room', { roomCode: currentRoomCode, nickname: myNickname, playerId: myPlayerId, spectator: Game.isSpectator, godPassword: Game.isGodMode ? 'admin' : '' }, (res) => {
      if (res?.error) {
        showScreen($lobby);
        showToast('Could not reconnect: ' + res.error, true);
      } else if (res?.reconnected || res?.isSpectator) {
        myPlayerId = res.playerId;
        hostId = res.hostId;
        players = res.players;
        Game.isSpectator = res.isSpectator;
        Game.isGodMode = res.isGodMode;
        const playerOrder = players.map(p => ({ id: p.id, nickname: p.nickname, cardCount: 7 }));
        showToast(res.isSpectator ? 'Reconnected as Spectator!' : 'Reconnected!');
        startGameUI();
        Game.setPlayers(playerOrder);
      } else if (res?.success && !res?.gameInProgress) {
        // Back in lobby
        players = res.players;
        renderPlayerList();
        showScreen($waitingRoom);
      }
      startPingMonitoring();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ── Game UI Initialization ─────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  function startGameUI() {
    showScreen($gameScreen);
    Game.init($canvas, myPlayerId, hostId);

    // Wire game callbacks → socket emits
    Game.onPlayCard = (cardId, chosenColor) => {
      socket.emit('play_card', { roomCode: currentRoomCode, cardId, chosenColor });
    };

    Game.onDrawCard = () => {
      socket.emit('draw_card', { roomCode: currentRoomCode });
    };

    Game.onPassTurn = () => {
      Game.state.hasDrawnThisTurn = false;
      socket.emit('pass_turn', { roomCode: currentRoomCode });
    };

    Game.onCallUno = () => {
      socket.emit('call_uno', { roomCode: currentRoomCode });
    };

    Game.onCatchUno = (targetPlayerId) => {
      socket.emit('catch_uno', { roomCode: currentRoomCode, targetPlayerId });
    };

    Game.onRestartGame = () => {
      socket.emit('restart_game', { roomCode: currentRoomCode });
    };

    Game.onShowToast = showToast;
    updateManagePlayersButton();
  }

  // ── Surrender (in-game leave; the rest of the table keeps playing) ────────
  const $btnSurrender = document.getElementById('btn-surrender');
  $btnSurrender.addEventListener('click', () => {
    if (!currentRoomCode) return;
    const msg = Game.isSpectator
      ? 'Stop spectating and leave the room?'
      : 'Surrender and leave the game? Your cards go back to the deck and the others keep playing.';
    if (!confirm(msg)) return;

    socket.emit('leave_room', { roomCode: currentRoomCode }, (res) => {
      if (res?.success) {
        Game.resetGame();
        Game.destroy();
        currentRoomCode = null;
        myPlayerId = null;
        players = [];
        _lastServerSeq = 0;
        sessionStorage.removeItem('uno_session');
        history.replaceState({}, '', window.location.pathname);
        showScreen($lobby);
        showToast(Game.isSpectator ? 'Left the room' : '🏳️ You surrendered');
      } else {
        showToast(res?.error || 'Could not leave the game', true);
      }
    });
  });

  // ── Manage Players Modal ───────────────────────────────────────────────────

  function updateManagePlayersButton() {
    if ($btnManagePlayers && isHost && $gameScreen.classList.contains('active')) {
      $btnManagePlayers.style.display = 'block';
    } else if ($btnManagePlayers) {
      $btnManagePlayers.style.display = 'none';
    }
  }

  function renderManagePlayerList() {
    $managePlayerList.innerHTML = '';

    // Build a quick set of which player IDs are in the active game
    // (game.js state.players has them in game-turn order)
    const gamePlayerIds = new Set((Game.state?.players || []).map(p => p.id));

    players.forEach(p => {
      const li = document.createElement('li');
      li.className = 'manage-player-item';

      const avatar = document.createElement('div');
      avatar.className = 'player-avatar';
      avatar.textContent = p.nickname.charAt(0).toUpperCase();
      li.appendChild(avatar);

      const infoWrap = document.createElement('div');
      infoWrap.className = 'manage-player-info';

      const name = document.createElement('span');
      name.className = 'manage-player-name';
      name.textContent = p.nickname;
      if (!p.connected) name.style.opacity = '0.45';
      infoWrap.appendChild(name);

      if (!p.connected) {
        const offTag = document.createElement('span');
        offTag.className = 'manage-player-status';
        offTag.textContent = 'Disconnected';
        infoWrap.appendChild(offTag);
      }
      li.appendChild(infoWrap);

      if (p.id === hostId) {
        const badge = document.createElement('span');
        badge.className = 'host-badge';
        badge.textContent = 'HOST';
        li.appendChild(badge);
      } else if (isHost) {
        // Host can kick any non-host player at any time
        const kickBtn = document.createElement('button');
        kickBtn.className = 'btn-kick';
        kickBtn.textContent = '✕ Kick';
        kickBtn.title = p.connected ? 'Kick this player from the game' : 'Remove disconnected player';
        kickBtn.addEventListener('click', () => {
          const msg = p.connected
            ? `Kick ${p.nickname} from the game? This cannot be undone.`
            : `Remove disconnected player ${p.nickname}?`;
          if (confirm(msg)) {
            socket.emit('kick_player', { roomCode: currentRoomCode, targetPlayerId: p.id });
            $manageModal.style.display = 'none';
          }
        });
        li.appendChild(kickBtn);
      }

      $managePlayerList.appendChild(li);
    });
  }

  if ($btnManagePlayers) {
    $btnManagePlayers.addEventListener('click', () => {
      renderManagePlayerList();
      $manageModal.style.display = 'flex';
    });
  }

  if ($btnCloseManage) {
    $btnCloseManage.addEventListener('click', () => {
      $manageModal.style.display = 'none';
    });
  }
})();
