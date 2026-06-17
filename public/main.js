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

  // ── Invite Link: pre-fill room code if ?room=CODE in URL ──────────────────
  const _urlParams  = new URLSearchParams(window.location.search);
  const _inviteCode = (_urlParams.get('room') || '').toUpperCase().trim();
  if (_inviteCode) {
    $createSection.style.display = 'none';          // hide Create Room + divider
    $roomCode.value = _inviteCode;
    $roomCode.setAttribute('readonly', 'readonly'); // code is fixed from link
    $nickname.placeholder = 'Enter your nickname to join';
    $nickname.focus();
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

  // ── Player List Rendering ──────────────────────────────────────────────────
  function renderPlayerList() {
    $playerList.innerHTML = '';
    $playerCount.textContent = players.length;

    players.forEach((p, i) => {
      const li = document.createElement('li');

      const avatar = document.createElement('div');
      avatar.className = 'player-avatar';
      avatar.style.background = getAvatarColor(i);
      avatar.textContent = p.nickname.charAt(0).toUpperCase();

      const name = document.createElement('span');
      name.textContent = p.nickname;
      if (!p.connected) name.style.opacity = '0.4';

      li.appendChild(avatar);
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
      }

      $playerList.appendChild(li);
    });

    // Update host-specific UI
    isHost = myPlayerId === hostId;
    $hostSettings.style.display = isHost ? 'block' : 'none';

    if (isHost) {
      $btnStart.disabled = players.length < 2;
      $btnStart.textContent = players.length < 2
        ? 'Waiting for players...'
        : `Start Game (${players.length} players)`;
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
    socket.emit('join_room', { roomCode: code, nickname: nick }, (res) => {
      $btnJoin.disabled = false;
      if (res.error) return showToast(res.error, true);

      myPlayerId = res.playerId;
      myNickname = res.nickname;
      currentRoomCode = code;
      hostId = res.hostId;
      players = res.players;

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
  // ── Socket Event Handlers ──────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════

  socket.on('room_updated', (data) => {
    players = data.players;
    hostId = data.hostId;
    if (data.settings) {
      $stackingToggle.checked = data.settings.stacking;
      stackingEnabled = data.settings.stacking || false;
    }
    renderPlayerList();
  });

  socket.on('game_started', (data) => {
    showToast('Game started!');
    if (data.settings) stackingEnabled = data.settings.stacking || false;
    startGameUI();

    // Set player order
    const playerOrder = data.playerOrder.map(p => ({
      id: p.id,
      nickname: p.nickname,
      cardCount: data.cardCounts?.[p.id] || 7,
    }));
    Game.setPlayers(playerOrder);
    Game.updateGameState(data);

    // Animate the initial 7-card deal from the deck to the player's hand
    setTimeout(() => Game.triggerAnimation('deal', { count: 7 }), 300);
  });

  socket.on('hand_updated', (data) => {
    Game.setHand(data.cards);
  });

  socket.on('game_state', (data) => {
    Game.updateGameState(data);

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
    const { cardType, chosenColor } = data;
    // Show label + flash ONLY — no card-fly here (that's player_drew's job)
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
  // Direction: toSelf = fly to bottom (your hand). !toSelf = fly to top (opponent).
  socket.on('player_drew', (data) => {
    const p = players.find(pl => pl.id === data.playerId);
    const name = p ? p.nickname : 'Player';
    if (data.playerId !== myPlayerId) {
      showToast(`${name} drew ${data.count} card${data.count > 1 ? 's' : ''}`);
    }

    const toSelf = data.playerId === myPlayerId;
    for (let i = 0; i < data.count; i++) {
      setTimeout(() => {
        Game.triggerAnimation('fly_card', { index: i, total: data.count, toSelf });
      }, i * 120);
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

  socket.on('connect', () => {
    // If we were in a game, try to rejoin
    if (currentRoomCode && myNickname) {
      socket.emit('join_room', { roomCode: currentRoomCode, nickname: myNickname }, (res) => {
        if (res?.error) {
          showScreen($lobby);
          showToast('Could not reconnect: ' + res.error, true);
        } else if (res?.reconnected && res?.gameInProgress) {
          myPlayerId = res.playerId;
          hostId = res.hostId;
          players = res.players;
          showToast('Reconnected!');
          startGameUI();
        }
      });
    }
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
