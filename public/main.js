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
      showScreen($waitingRoom);
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
    }
    renderPlayerList();
  });

  socket.on('game_started', (data) => {
    showToast('Game started!');
    startGameUI();

    // Set player order
    const playerOrder = data.playerOrder.map(p => ({
      id: p.id,
      nickname: p.nickname,
      cardCount: data.cardCounts?.[p.id] || 7,
    }));
    Game.setPlayers(playerOrder);
    Game.updateGameState(data);
  });

  socket.on('hand_updated', (data) => {
    Game.setHand(data.cards);
  });

  socket.on('game_state', (data) => {
    Game.updateGameState(data);
  });

  socket.on('card_effect', (data) => {
    const { cardType } = data;
    // Power card animations
    if (cardType === 'draw2') {
      Game.triggerAnimation('plus', { text: '+2', count: 2 });
      Game.triggerAnimation('multi_card_draw', { count: 2 });
    } else if (cardType === 'wild4') {
      Game.triggerAnimation('plus', { text: '+4', count: 4 });
      Game.triggerAnimation('multi_card_draw', { count: 4 });
    } else if (cardType === 'wild8') {
      Game.triggerAnimation('plus', { text: '+8', count: 8 });
      Game.triggerAnimation('multi_card_draw', { count: 8 });
    } else if (cardType === 'reverse') {
      Game.triggerAnimation('reverse');
    } else if (cardType === 'skip') {
      Game.triggerAnimation('skip');
    } else if (cardType === 'wild') {
      Game.triggerAnimation('color_change');
    } else {
      Game.triggerAnimation('card_played');
    }
  });

  socket.on('player_drew', (data) => {
    const p = players.find(pl => pl.id === data.playerId);
    const name = p ? p.nickname : 'Player';
    if (data.playerId !== myPlayerId) {
      showToast(`${name} drew ${data.count} card${data.count > 1 ? 's' : ''}`);
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
    Game.setWinner(data.playerId, data.nickname);
    showToast(`🎉 ${data.nickname} wins!`);
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
