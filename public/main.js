// ─── Main Entry Point ─────────────────────────────────────────────────────────
// Lobby flow, socket connection, and event wiring between server ↔ Game engine.
// ──────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';

  const socket = io();

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

  // ── Draw animation sync ────────────────────────────────────────────────────
  // When a multi-card draw happens, we reveal cards one-by-one in sync with
  // the fly animation instead of applying the full hand/count instantly.
  const CARD_FLY_MS  = 480; // ms a single card takes to fly
  const CARD_STAGGER = 120; // ms between staggered cards
  let _bufferedHand  = null;          // full hand stored while incremental reveal runs
  let _handAnimating = false;         // true while self draw animation is in progress
  const _drawAnimPlayers = new Set(); // playerIds currently mid draw-animation (for others)

  // ── Deal animation ──────────────────────────────────────────────────────
  let _dealInProgress    = false;  // true during initial round-robin deal
  let _bufferedDealHand  = null;   // hand received during deal — revealed card-by-card

  // Shared helper: map opponent index → screen side
  // oppIdx is 0-based among opponents (0 = next player clockwise)
  // oppCount = total number of opponents
  function computeSide(oppIdx, oppCount) {
    let nLeft = 0, nRight = 0;
    if      (oppCount <= 2)  { nLeft = 0; nRight = 0; }
    else if (oppCount === 3) { nLeft = 1; nRight = 1; }
    else if (oppCount <= 5)  { nLeft = 1; nRight = 1; }
    else if (oppCount === 6) { nLeft = 2; nRight = 2; }
    else if (oppCount <= 9)  { nLeft = Math.floor(oppCount / 3); nRight = Math.floor(oppCount / 3); }
    else if (oppCount <= 12) { nLeft = Math.ceil(oppCount / 3);  nRight = Math.floor(oppCount / 3); }
    else                     { nLeft = Math.round(oppCount / 3); nRight = Math.round(oppCount / 3); }
    if (oppIdx < nLeft)                   return 'left';
    if (oppIdx >= oppCount - nRight)      return 'right';
    return 'top';
  }

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const $lobby = document.getElementById('lobby');
  const $waitingRoom = document.getElementById('waiting-room');
  const $gameScreen = document.getElementById('game-screen');
  const $nickname = document.getElementById('nickname');
  const $roomCode = document.getElementById('room-code');
  const $btnCreate = document.getElementById('btn-create');
  const $btnJoin = document.getElementById('btn-join');
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

  // ── Pre-fill nickname from last session ───────────────────────────────────
  const _savedNick = localStorage.getItem('uno_nickname');
  if (_savedNick) $nickname.value = _savedNick;

  // ── Invite Link: pre-fill room code if ?room=CODE in URL ──────────────────
  const _urlParams  = new URLSearchParams(window.location.search);
  const _inviteCode = (_urlParams.get('room') || '').toUpperCase().trim();
  if (_inviteCode) {
    $createSection.style.display = 'none';          // hide Create Room + divider
    $roomCode.value = _inviteCode;
    $roomCode.setAttribute('readonly', 'readonly'); // code is fixed from link
    $nickname.placeholder = 'Enter your nickname to join';
    if (!_savedNick) $nickname.focus();
    history.replaceState({}, '', window.location.pathname); // clean the URL
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
          screen.orientation.lock('landscape').catch(() => {});
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
        exit.call(document).catch(() => {});
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
    [$lobby, $waitingRoom, $gameScreen].forEach(s => s.classList.remove('active'));
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
      }

      // Avatar
      const avatar = document.createElement('div');
      avatar.className = 'player-avatar';
      avatar.style.background = getAvatarColor(i);
      avatar.textContent = p.nickname.charAt(0).toUpperCase();
      li.appendChild(avatar);

      // Name
      const name = document.createElement('span');
      name.textContent = p.nickname;
      if (!p.connected) name.style.opacity = '0.4';
      li.appendChild(name);

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
        kickBtn.title = 'Kick player';
        kickBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm(`Kick ${p.nickname}?`)) {
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

    $btnCreate.disabled = true;
    socket.emit('create_room', { nickname: nick }, (res) => {
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
      history.replaceState({}, '', `?room=${res.roomCode}`);
      showScreen($waitingRoom);
    });
  });

  // ── Waiting Room: Copy Invite Link ─────────────────────────────────
  const $btnCopyLink = document.getElementById('btn-copy-link');
  $btnCopyLink.addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}?room=${currentRoomCode}`;
    navigator.clipboard.writeText(url).then(() => {
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


  // ── Lobby: Join Room ───────────────────────────────────────────────────────
  $btnJoin.addEventListener('click', () => {
    const nick = $nickname.value.trim();
    const code = $roomCode.value.trim().toUpperCase();

    if (!nick) { showToast('Please enter a nickname', true); return; }
    if (!code) { showToast('Please enter a room code', true); return; }

    $btnJoin.disabled = true;
    socket.emit('join_room', { roomCode: code, nickname: nick, playerId: null }, (res) => {
      $btnJoin.disabled = false;
      if (res.error) return showToast(res.error, true);

      myPlayerId = res.playerId;
      myNickname = res.nickname;
      currentRoomCode = code;
      hostId = res.hostId;
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

      $displayCode.textContent = code;
      $stackingToggle.checked = res.settings?.stacking || false;
      stackingEnabled = res.settings?.stacking || false;
      renderPlayerList();

      if (res.gameInProgress && res.reconnected) {
        // Reconnecting to an in-progress game
        showToast('Reconnected!');
        startGameUI();
      } else {
        showScreen($waitingRoom);
      }
    });
  });

  // ── Lobby: Leave Room ──────────────────────────────────────────────────────
  $btnLeave.addEventListener('click', () => {
    socket.disconnect();
    socket.connect();
    currentRoomCode = null;
    myPlayerId = null;
    players = [];
    _lastServerSeq = 0;
    sessionStorage.removeItem('uno_session');  // clear so next visit starts fresh
    showScreen($lobby);
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

  // ── Enter key for inputs ───────────────────────────────────────────────────
  $nickname.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $btnCreate.click();
  });
  $roomCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $btnJoin.click();
  });

  // Auto-uppercase room code input
  $roomCode.addEventListener('input', () => {
    $roomCode.value = $roomCode.value.toUpperCase();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ── Auto-reconnect on page refresh ────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('connect', () => {
    const saved = (() => { try { return JSON.parse(sessionStorage.getItem('uno_session')); } catch { return null; } })();
    if (!saved || !saved.roomCode || !saved.nickname || currentRoomCode) return;

    // Attempt to re-join the saved room silently
    socket.emit('join_room', { roomCode: saved.roomCode, nickname: saved.nickname, playerId: saved.playerId }, (res) => {
      if (res.error) {
        sessionStorage.removeItem('uno_session');
        return; // Room gone — just show lobby
      }
      myPlayerId   = res.playerId;
      myNickname   = res.nickname;
      currentRoomCode = saved.roomCode;
      hostId       = res.hostId;
      if (_lastServerSeq === 0) players = res.players;

      sessionStorage.setItem('uno_session', JSON.stringify({
        roomCode: saved.roomCode,
        playerId: res.playerId,
        nickname: res.nickname,
      }));

      $displayCode.textContent = saved.roomCode;
      $stackingToggle.checked  = res.settings?.stacking || false;
      stackingEnabled          = res.settings?.stacking || false;

      if (res.gameInProgress && res.reconnected) {
        showToast('Reconnected to game!');
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
    if (data.settings) {
      $stackingToggle.checked = data.settings.stacking;
      stackingEnabled = data.settings.stacking || false;
    }
    renderPlayerList();
  });

  socket.on('player_kicked', (data) => {
    showToast(`${data.nickname} was kicked from the room`);
  });

  socket.on('kicked_from_room', () => {
    showToast('You were kicked from the room', true);
    myPlayerId = null;
    currentRoomCode = null;
    hostId = null;
    isHost = false;
    players = [];
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


    // ── Round-robin deal animation ─────────────────────────────
    // Deal cards one at a time: local player first, then clockwise.
    // Each player's card count ticks up as each card lands.
    const CARDS_EACH  = 7;
    const DEAL_GAP    = 160; // ms between each individual card deal

    // Build deal order starting from local player
    const myIdx = playerOrder.findIndex(p => p.id === myPlayerId);
    const N = playerOrder.length;
    const dealOrder = []; // [{ id, toSelf, side }]
    for (let i = 0; i < N; i++) {
      const pi   = (myIdx + i) % N;
      const p    = playerOrder[pi];
      const toSelf = i === 0;
      const side   = toSelf ? null : computeSide(i - 1, N - 1);
      dealOrder.push({ id: p.id, toSelf, side });
    }

    _dealInProgress   = true;
    // Do NOT reset _bufferedDealHand here — hand_updated arrives BEFORE game_started
    // and already stored the cards there. Clearing it would lose them.
    // _bufferedDealHand is only nulled at the end of the deal loop.
    // Do NOT call setDealMode(true) — that blanks the hand canvas.
    // Cards are revealed incrementally via Game.state.myHand direct mutation.

    const totalCards = CARDS_EACH * N;
    for (let seq = 0; seq < totalCards; seq++) {
      const playerSlot = seq % N;
      const dp = dealOrder[playerSlot];

      // Launch fly animation
      setTimeout(() => {
        Game.triggerAnimation('fly_card', { index: 0, total: 1, toSelf: dp.toSelf, side: dp.side });
      }, seq * DEAL_GAP);

      // When card lands: increment that player's count + reveal hand card if self
      setTimeout(() => {
        const pl = Game.state.players.find(x => x.id === dp.id);
        if (pl) pl.cardCount++;

        // Reveal one hand card in sync when dealt to local player
        if (dp.toSelf && _bufferedDealHand) {
          const selfCount = Game.state.players.find(x => x.id === myPlayerId)?.cardCount || 0;
          Game.state.myHand = _bufferedDealHand.slice(0, selfCount);
        }

        // Last card of the whole deal
        if (seq === totalCards - 1) {
          if (_bufferedDealHand) {
            Game.setHand(_bufferedDealHand); // final proper setHand
            _bufferedDealHand = null;
          }
          _dealInProgress = false;
        }
      }, seq * DEAL_GAP + CARD_FLY_MS);
    }
  });

  socket.on('hand_updated', (data) => {
    // The server sends hand_updated BEFORE game_started, so _dealInProgress is
    // still false when this arrives for the initial deal. Detect this by checking
    // if the game canvas hasn't been initialized yet.
    if (!Game.state.active || _dealInProgress) {
      _bufferedDealHand = data.cards;
      return;
    }

    const prevLen  = Game.state.myHand.length;
    const newCards = data.cards;
    const added    = newCards.length - prevLen;

    // Single card or removal — apply immediately
    if (added <= 1) {
      Game.setHand(newCards);
      return;
    }

    // Multi-card draw: reveal one card per animation frame
    _handAnimating = true;
    _bufferedHand  = newCards;

    for (let i = 0; i < added; i++) {
      const delay = i * CARD_STAGGER + CARD_FLY_MS; // wait for each card to land
      setTimeout(() => {
        if (!_bufferedHand) return; // cancelled
        // Show cards up to prevLen + i + 1
        Game.state.myHand = _bufferedHand.slice(0, prevLen + i + 1);
        if (i === added - 1) {
          // Final card: do a proper setHand so scroll/selection is recalculated
          Game.setHand(_bufferedHand);
          _handAnimating = false;
          _bufferedHand  = null;
        }
      }, delay);
    }
  });


  socket.on('game_state', (data) => {
    // While deal animation is running, skip card count updates entirely —
    // the deal loop increments counts one-by-one in sync with the animations.
    if (data.cardCounts && Game.state.players.length > 0 && !_dealInProgress) {
      const updated = Game.state.players.map(p => ({
        ...p,
        cardCount: _drawAnimPlayers.has(p.id)
          ? p.cardCount                        // protected — draw animation is running
          : (data.cardCounts[p.id] ?? p.cardCount),
      }));
      Game.setPlayers(updated);
    }
    // During deal, also strip cardCounts from updateGameState so the
    // direct player-count increments in the deal loop aren't overwritten.
    Game.updateGameState(_dealInProgress ? { ...data, cardCounts: null } : data);

    // Show 30s turn timer in UI
    if (data.currentPlayer) {
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
      const myIdx  = players.findIndex(pl => pl.id === myPlayerId);
      const oppIdx = players.findIndex(pl => pl.id === playedBy);
      if (myIdx !== -1 && oppIdx !== -1) {
        const n = players.length;
        const opps = [];
        for (let i = 1; i < n; i++) opps.push({ id: players[(myIdx + i) % n].id, oppIdx: i - 1 });
        const oppCount = opps.length;
        const tgtOpp = opps.find(o => o.id === playedBy);
        if (tgtOpp) {
          let nLeft = 0, nRight = 0;
          if      (oppCount === 3) { nLeft = 1; nRight = 1; }
          else if (oppCount === 4) { nLeft = 1; nRight = 1; }
          else if (oppCount === 5) { nLeft = 1; nRight = 1; }
          else if (oppCount === 6) { nLeft = 2; nRight = 2; }
          else if (oppCount <= 9)  { nLeft = Math.floor(oppCount / 3); nRight = Math.floor(oppCount / 3); }
          else if (oppCount <= 12) { nLeft = Math.ceil(oppCount / 3);  nRight = Math.floor(oppCount / 3); }
          else                     { nLeft = Math.round(oppCount / 3); nRight = Math.round(oppCount / 3); }
          const oi = tgtOpp.oppIdx;
          const side = oi < nLeft ? 'left' : (oi >= oppCount - nRight ? 'right' : 'top');
          Game.triggerAnimation('fly_opponent_card', { side });
        }
      }
    }

    // Show label + flash effects
    if (cardType === 'draw2') {
      Game.showDomAnim('anim-plus', '+2', 1200);
      Game.showDomAnim('anim-red-flash', '', 600);
    } else if (cardType === 'wild4') {
      Game.showDomAnim('anim-plus', '+4', 1200);
      Game.showDomAnim('anim-red-flash', '', 600);
    } else if (cardType === 'wild8') {
      Game.showDomAnim('anim-plus', '+8', 1200);
      Game.showDomAnim('anim-red-flash', '', 600);
    } else if (cardType === 'reverse') {
      Game.triggerAnimation('reverse');
    } else if (cardType === 'skip') {
      Game.triggerAnimation('skip');
    } else if (cardType === 'wild') {
      Game.triggerAnimation('color_change', { color: chosenColor });
    } else {
      Game.triggerAnimation('card_played');
    }
    // Build the discard pile visual stack
    Game.triggerAnimation('discard_land');
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

    // Work out which screen zone the target player occupies
    let side = null;
    if (!toSelf) {
      const myIdx = players.findIndex(pl => pl.id === myPlayerId);
      if (myIdx !== -1) {
        const n    = players.length;
        const opps = [];
        for (let i = 1; i < n; i++) opps.push({ id: players[(myIdx + i) % n].id, oppIdx: i - 1 });
        const tgtOpp = opps.find(o => o.id === data.playerId);
        if (tgtOpp) side = computeSide(tgtOpp.oppIdx, opps.length);
      }
    }

    // Trigger fly animations staggered per card
    for (let i = 0; i < data.count; i++) {
      setTimeout(() => {
        Game.triggerAnimation('fly_card', { index: i, total: data.count, toSelf, side });
      }, i * CARD_STAGGER);
    }

    // For opponents: protect their card count in game_state updates and
    // increment it one-by-one in sync with each card landing.
    if (!toSelf && data.count > 1) {
      const pid = data.playerId;
      _drawAnimPlayers.add(pid);
      const startCount = Game.state.players.find(pl => pl.id === pid)?.cardCount ?? 0;
      for (let i = 0; i < data.count; i++) {
        setTimeout(() => {
          const pl = Game.state.players.find(x => x.id === pid);
          if (pl) pl.cardCount = startCount + i + 1;
          if (i === data.count - 1) {
            _drawAnimPlayers.delete(pid); // unprotect so next game_state can sync
          }
        }, i * CARD_STAGGER + CARD_FLY_MS); // offset to match when card lands
      }
    }

    // If this was MY normal draw (not forced), show Pass Turn button
    if (toSelf && data.mustPass) {
      Game.state.hasDrawnThisTurn = true;
    }

    if (data.count > 1) {
      Game.triggerAnimation('draw_flash');
    }
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
    showToast('Disconnected — trying to reconnect...', true);
  });

  // Mid-session reconnect (socket temporarily dropped)
  socket.on('connect', () => {
    if (!currentRoomCode || !myNickname) return; // handled by sessionStorage handler above
    socket.emit('join_room', { roomCode: currentRoomCode, nickname: myNickname, playerId: myPlayerId }, (res) => {
      if (res?.error) {
        showScreen($lobby);
        showToast('Could not reconnect: ' + res.error, true);
      } else if (res?.reconnected && res?.gameInProgress) {
        myPlayerId = res.playerId;
        hostId     = res.hostId;
        players    = res.players;
        const playerOrder = players.map(p => ({ id: p.id, nickname: p.nickname, cardCount: 7 }));
        showToast('Reconnected!');
        startGameUI();
        Game.setPlayers(playerOrder);
      } else if (res?.success && !res?.gameInProgress) {
        // Back in lobby
        players = res.players;
        renderPlayerList();
        showScreen($waitingRoom);
      }
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
  }
})();
