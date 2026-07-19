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

  // ── Splash screen: app-style boot ──────────────────────────────────────────
  // Shown instantly by the HTML; progress advances on real milestones (assets
  // loaded → server connected) and never traps the player if the server is
  // unreachable (5s failsafe — the reconnect overlay takes over from there).
  const $splash = document.getElementById('splash');
  const $splashFill = document.getElementById('splash-fill');
  const $splashStatus = document.getElementById('splash-status');
  const _splashT0 = performance.now();
  let _splashHidden = false;

  function splashStep(pct, msg) {
    if (_splashHidden || !$splash) return;
    if ($splashFill) $splashFill.style.width = pct + '%';
    if ($splashStatus && msg) $splashStatus.textContent = msg;
  }

  function hideSplash() {
    if (_splashHidden || !$splash) return;
    _splashHidden = true;
    // Keep the splash up long enough to feel intentional, not glitchy
    const wait = Math.max(0, 1100 - (performance.now() - _splashT0));
    setTimeout(() => {
      if ($splashFill) $splashFill.style.width = '100%';
      if ($splashStatus) $splashStatus.textContent = 'Ready!';
      setTimeout(() => {
        $splash.classList.add('splash-hide');
        setTimeout(() => $splash.remove(), 600);
      }, 250);
    }, wait);
  }

  splashStep(35, 'Loading game assets…');
  window.addEventListener('load', () => splashStep(70, 'Connecting to server…'));
  socket.on('connect', hideSplash);
  setTimeout(hideSplash, 5000); // failsafe: never block the UI on a bad network

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
  let _autoDrawTimer = null;     // pending auto-draw timeout
  let _eliminatedThisGame = false; // I was eliminated — spectating until restart
  let _finishedThisGame = false;   // Play-for-Places: I placed — watching the rest

  // Placement display helpers (Play-for-Places)
  const ordinal = (n) => {
    if (!n) return '';
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const placeMedal = (n) => (n === 1 ? '🥇' : n === 2 ? '🥈' : n === 3 ? '🥉' : '🏅');
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
  const CARD_FLY_MS = 400; // ms a single card takes to fly (must match FLIGHT_MS in game.js)
  const CARD_STAGGER = 180; // ms between staggered cards (visible gap for +card draws)
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

  // ── Anonymous stats identity — powers the leaderboard without signup ──────
  let myUid = localStorage.getItem('uno_uid');
  if (!myUid || !/^[\w-]{8,64}$/.test(myUid)) {
    myUid = crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '')
      : Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('uno_uid', myUid);
  }

  // ── Game settings: one place to sync server settings → UI + game engine ───
  // The full mode/rules registry lives in shared/game-modes.js (window.GameModes)
  let roomSettings = GameModes.normalizeSettings(null);

  function applySettings(settings) {
    roomSettings = GameModes.normalizeSettings(settings);
    Game.state.settings = { ...roomSettings };
    renderSettingsPanel();
  }

  // ── Settings panel: rendered entirely from the shared rules registry ──────
  // Everyone sees the panel; only the host gets live controls.
  const $modeSelector = document.getElementById('mode-selector');
  const $modeTagline = document.getElementById('mode-tagline');
  const $rulesContainer = document.getElementById('rules-container');
  const _openRuleDescs = new Set(); // keep ⓘ expansions open across re-renders

  function renderSettingsPanel() {
    if (!$modeSelector) return;
    const s = roomSettings;

    // — Mode cards —
    $modeSelector.innerHTML = '';
    for (const modeId of GameModes.MODE_ORDER) {
      const m = GameModes.MODES[modeId];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mode-card' + (s.mode === modeId ? ' mode-card--active' : '');
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(s.mode === modeId));
      btn.disabled = !isHost;
      btn.innerHTML = `<span class="mode-card-icon">${m.icon}</span><span class="mode-card-name">${m.name}</span>`;
      btn.addEventListener('click', () => {
        if (!isHost || !currentRoomCode || s.mode === modeId) return;
        socket.emit('set_mode', { roomCode: currentRoomCode, mode: modeId });
      });
      $modeSelector.appendChild(btn);
    }
    $modeTagline.textContent = (GameModes.MODES[s.mode] || {}).tagline || '';

    // — Rule rows, grouped —
    $rulesContainer.innerHTML = '';
    for (const [groupId, group] of Object.entries(GameModes.GROUPS)) {
      const rows = Object.entries(GameModes.RULES).filter(([key, def]) => {
        if (def.group !== groupId) return false;
        // Rules the mode locks OFF are noise — hide them entirely
        if (def.type === 'bool' && GameModes.isLocked(s.mode, key) && !s[key]) return false;
        // Dependent rules (e.g. elimination limit) hide until their parent is on
        if (def.showIf && !s[def.showIf]) return false;
        return true;
      });
      if (rows.length === 0) continue;

      const heading = document.createElement('h4');
      heading.className = 'rules-group-title';
      heading.textContent = `${group.icon} ${group.label}`;
      $rulesContainer.appendChild(heading);

      for (const [key, def] of rows) {
        const locked = GameModes.isLocked(s.mode, key);
        const row = document.createElement('div');
        row.className = 'rule-row';

        const label = document.createElement('div');
        label.className = 'rule-label';
        label.innerHTML = `<span class="rule-name">${def.icon} ${def.label}</span>`;
        const info = document.createElement('button');
        info.type = 'button';
        info.className = 'rule-info-btn';
        info.setAttribute('aria-label', `About ${def.label}`);
        info.textContent = 'i';
        label.appendChild(info);
        row.appendChild(label);

        let control;
        if (locked) {
          control = document.createElement('span');
          control.className = 'rule-locked-chip';
          control.textContent = def.type === 'bool' ? '✓ Always on' : (s[key] + (def.unit || ''));
          control.title = 'Fixed by the selected game mode';
        } else if (def.type === 'bool') {
          control = document.createElement('label');
          control.className = 'toggle-switch';
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.checked = !!s[key];
          input.disabled = !isHost;
          input.addEventListener('change', () => {
            if (!isHost || !currentRoomCode) return;
            socket.emit('set_rule', { roomCode: currentRoomCode, rule: key, value: input.checked });
          });
          const slider = document.createElement('span');
          slider.className = 'toggle-slider';
          control.append(input, slider);
        } else {
          control = document.createElement('div');
          control.className = 'rule-stepper';
          const dec = document.createElement('button');
          dec.type = 'button'; dec.className = 'stepper-btn'; dec.textContent = '−';
          const val = document.createElement('span');
          val.className = 'stepper-value'; val.textContent = s[key] + (def.unit || '');
          const inc = document.createElement('button');
          inc.type = 'button'; inc.className = 'stepper-btn'; inc.textContent = '+';
          dec.disabled = !isHost || s[key] <= def.min;
          inc.disabled = !isHost || s[key] >= def.max;
          const bump = (dir) => {
            if (!isHost || !currentRoomCode) return;
            socket.emit('set_rule', { roomCode: currentRoomCode, rule: key, value: s[key] + dir * (def.step || 1) });
          };
          dec.addEventListener('click', () => bump(-1));
          inc.addEventListener('click', () => bump(1));
          control.append(dec, val, inc);
        }
        row.appendChild(control);
        $rulesContainer.appendChild(row);

        const desc = document.createElement('p');
        desc.className = 'rule-desc';
        desc.textContent = def.desc;
        desc.hidden = !_openRuleDescs.has(key);
        info.classList.toggle('active', _openRuleDescs.has(key));
        info.setAttribute('aria-expanded', String(_openRuleDescs.has(key)));
        info.addEventListener('click', () => {
          const show = desc.hidden;
          desc.hidden = !show;
          if (show) _openRuleDescs.add(key); else _openRuleDescs.delete(key);
          info.classList.toggle('active', show);
          info.setAttribute('aria-expanded', String(show));
        });
        $rulesContainer.appendChild(desc);
      }
    }
  }

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
    // Invite arrivals came for ONE room — hide the quick-match hero and
    // divider so the join flow is the only path in view.
    const $hero = document.getElementById('btn-quick-match');
    if ($hero) $hero.style.display = 'none';
    const $div = document.querySelector('.lobby-divider');
    if ($div) $div.style.display = 'none';

    // With the new tab layout, hide just the tab switcher bar and force the
    // Join panel visible — the room code and Join button must always show.
    const $tabBar = document.querySelector('#create-section .tab-bar');
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
    // The app bar lives on menu screens only — gameplay gets the full viewport
    document.body.classList.toggle('in-game', screen === $gameScreen);
    if (screen === $gameScreen) {
      setTimeout(() => Game.resizeCanvas(), 50);
    }
  }

  // ── App Bar menu (☰) ───────────────────────────────────────────────────────
  const $btnAppMenu = document.getElementById('btn-app-menu');
  const $appMenu = document.getElementById('app-menu');
  $btnAppMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    $appMenu.hidden = !$appMenu.hidden;
    $btnAppMenu.setAttribute('aria-expanded', String(!$appMenu.hidden));
  });
  document.addEventListener('pointerdown', (e) => {
    if ($appMenu.hidden) return;
    if (e.target.closest('#app-menu') || e.target.closest('#btn-app-menu')) return;
    $appMenu.hidden = true;
    $btnAppMenu.setAttribute('aria-expanded', 'false');
  });

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

  // ── Avatars: profile photo when the player is signed in, else letter disc ──
  function makeAvatarEl(p, i) {
    const el = document.createElement('div');
    el.className = 'player-avatar';
    if (p.picture && p.picture.startsWith('emoji:')) {
      el.classList.add('player-avatar--emoji');
      el.textContent = p.picture.slice(6);
    } else if (p.picture) {
      const img = document.createElement('img');
      img.src = p.picture;
      img.alt = '';
      img.referrerPolicy = 'no-referrer'; // Google's CDN rejects some referrers
      el.appendChild(img);
    } else {
      el.style.background = getAvatarColor(i);
      el.textContent = p.isBot ? '🤖' : p.nickname.charAt(0).toUpperCase();
    }
    return el;
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

      // Avatar (profile photo for signed-in players)
      li.appendChild(makeAvatarEl(p, i));

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
    // Everyone sees the mode + rules panel; only the host can change it
    $hostSettings.style.display = 'block';
    const $addBot = document.getElementById('btn-add-bot');
    if ($addBot) $addBot.style.display = isHost ? '' : 'none';
    renderSettingsPanel();
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
    socket.emit('create_room', { nickname: nick, isPrivate, uid: myUid, picture: myPicture() }, (res) => {
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
    socket.emit('create_room', { nickname: nick, isPrivate: true, uid: myUid, picture: myPicture() }, (res) => {
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
    applySettings(res.settings);
    renderPlayerList();

    if (res.gameInProgress && (res.reconnected || res.isSpectator)) {
      showToast(res.isSpectator ? (res.isGodMode ? 'Joined God Mode Spectator' : 'Joined as Spectator') : 'Reconnected!');
      startGameUI();

      // Populate game players for spectators/reconnects using the guaranteed res.players from server
      const playerOrder = (res.players || players).map(p => ({ id: p.id, nickname: p.nickname, cardCount: p.cardCount || 7, picture: p.picture }));
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
    socket.emit('join_room', { roomCode: code, nickname: nick, playerId: null, uid: myUid, picture: myPicture() }, (res) => {
      $btnJoin.disabled = false;
      if (res.error) {
        if (res.canSpectate) {
          const pass = prompt("Game is in progress! Enter password for God Mode spectator, or leave blank for normal spectator. Click Cancel to abort.");
          if (pass === null) return;
          $btnJoin.disabled = true;
          socket.emit('join_room', { roomCode: code, nickname: nick, playerId: null, spectator: true, godPassword: pass, uid: myUid, picture: myPicture() }, (spectateRes) => {
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

        // Game mode badge (from the shared registry)
        const modeDef = GameModes.MODES[room.mode];
        if (modeDef) {
          const roomMode = document.createElement('span');
          roomMode.className = `room-mode room-mode--${modeDef.id}`;
          roomMode.textContent = `${modeDef.icon} ${modeDef.name}`;
          roomMeta.appendChild(roomMode);
        }

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
          socket.emit('join_room', { roomCode: room.code, nickname: nick, spectator, uid: myUid, picture: myPicture() }, (res) => {
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
    socket.emit('join_room', { roomCode: saved.roomCode, nickname: saved.nickname, playerId: saved.playerId, uid: myUid, picture: myPicture() }, (res) => {
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
      applySettings(res.settings);

      if (res.gameInProgress && res.reconnected) {
        showToast('✓ Reconnected successfully!');
        // Build player list with known card counts (will be updated by game_state)
        const playerOrder = res.players.map(p => ({
          id: p.id, nickname: p.nickname, cardCount: 7, picture: p.picture,
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
    if (data.settings) applySettings(data.settings);
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
    if (data.settings) applySettings(data.settings);
    startGameUI();

    // All players start at 0 cards — deal animation fills them up
    const playerOrder = data.playerOrder.map(p => ({
      id: p.id,
      nickname: p.nickname,
      cardCount: 0,
      picture: p.picture,
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
    const CARDS_EACH = (data.settings && Number(data.settings.startingCards)) || 7;
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


  let _lastTurnPlayer = null; // for the "your turn" ding — ring once per turn change

  socket.on('game_state', (data) => {
    // Your-turn ding (skip while dealing and once the game is decided)
    if (!data.winner && !_dealInProgress &&
        data.currentPlayer === myPlayerId && _lastTurnPlayer !== myPlayerId) {
      Sound.play('turn');
    }
    _lastTurnPlayer = data.currentPlayer;

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

    // Turn countdown in the UI — duration comes from the room's turn timer rule
    if (data.currentPlayer && !data.winner) {
      Game.setTurnTimer(data.currentPlayer, (roomSettings.turnTimer || 30) * 1000);
    }

    // Pending draw stack aimed at me: I can answer it (stack/dodge card),
    // challenge the +4 (Wild Challenge rule), or I must draw. When I have no
    // playable answer and no challenge, auto-draw after the +N animation.
    clearTimeout(_autoDrawTimer);
    hideChallengeBar();
    if (data.pendingDraw > 0 && data.currentPlayer === myPlayerId && !Game.isSpectator && !data.winner) {
      const myHand = Game.state.myHand || [];
      const canRespond = myHand.some(c => Game.isCardPlayable(c));
      const canChallenge = !!(data.challenge && data.challenge.targetId === myPlayerId &&
        roomSettings.wildChallenge);
      if (canChallenge) {
        showChallengeBar(data.pendingDraw, canRespond);
      } else if (!canRespond) {
        _autoDrawTimer = setTimeout(() => {
          // Double-check it's still my turn with pending draw
          if (Game.state.pendingDraw > 0 && Game.state.currentPlayer === myPlayerId) {
            socket.emit('draw_card', { roomCode: currentRoomCode });
          }
        }, 1200); // wait for +N animation
      }
    }
  });

  // ── Wild Challenge prompt (target of a fresh +4 chooses: challenge or draw) ─
  let $challengeBar = null;
  function showChallengeBar(count, canStack) {
    hideChallengeBar();
    $challengeBar = document.createElement('div');
    $challengeBar.id = 'challenge-bar';
    $challengeBar.innerHTML = `
      <span class="challenge-text">+${count} played on you!${canStack ? ' Stack a card, draw, or…' : ''}</span>
      <div class="challenge-actions">
        <button type="button" class="btn btn-primary challenge-btn" id="btn-challenge">⚔️ Challenge</button>
        <button type="button" class="btn btn-outline challenge-btn" id="btn-accept-draw">Draw +${count}</button>
      </div>`;
    document.getElementById('game-screen').appendChild($challengeBar);
    document.getElementById('btn-challenge').addEventListener('click', () => {
      hideChallengeBar();
      socket.emit('challenge_wild4', { roomCode: currentRoomCode });
    });
    document.getElementById('btn-accept-draw').addEventListener('click', () => {
      hideChallengeBar();
      socket.emit('draw_card', { roomCode: currentRoomCode });
    });
  }
  function hideChallengeBar() {
    if ($challengeBar) { $challengeBar.remove(); $challengeBar = null; }
  }

  socket.on('card_effect', (data) => {
    const { cardType, chosenColor, playedBy } = data;
    Sound.play('card');

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
      } else if (cardType === 'shuffle') {
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
    Sound.play('draw');
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
    Sound.play('uno');
  });

  socket.on('direction_changed', () => {
    Game.triggerAnimation('reverse');
  });

  socket.on('uno_caught', (data) => {
    const target = players.find(p => p.id === data.targetId);
    const catcher = players.find(p => p.id === data.catcherId);
    showToast(`${catcher?.nickname || 'Someone'} caught ${target?.nickname || 'a player'}! +${data.penaltyCount} cards`);
  });

  // ── Skip Dodge / Reverse Bounce: a draw stack was deflected ────────────────
  socket.on('stack_passed', (data) => {
    const verb = data.via === 'reverse' ? 'bounced' : 'dodged';
    showToast(`🛡️ ${data.nickname} ${verb} the stack — +${data.count} heads to ${data.targetNickname}!`);
  });

  // ── Wild Shuffle Hands card ────────────────────────────────────────────────
  socket.on('hands_shuffled', (data) => {
    showToast(`🔀 ${data.nickname} shuffled everyone's hands!`);
    Game.showDomAnim('anim-shuffle-burst', '🔀', 1800);
    Sound.play('card');
  });

  // ── Elimination (No Mercy / elimination rule) ──────────────────────────────
  socket.on('player_eliminated', (data) => {
    Game.showDomAnim('anim-eliminated', `💀 ${data.nickname}`, 2200);
    Sound.play('draw');
    // Remove their seat from the canvas (same eager prune as kicks/surrenders)
    if (data.playerId && Game.state?.players?.length) {
      const pruned = Game.state.players.filter(p => p.id !== data.playerId);
      if (pruned.length !== Game.state.players.length) Game.setPlayers(pruned);
    }
    if (data.playerId === myPlayerId) {
      _eliminatedThisGame = true;
      Game.isSpectator = true;
      Game.state.isSpectator = true;
      hideChallengeBar();
      showToast('💀 You were eliminated — spectating until the round ends', true);
    } else {
      showToast(`💀 ${data.nickname} was eliminated!`);
    }
  });

  // ── Play-for-Places: a player emptied their hand and locked in a rank ───────
  socket.on('player_finished', (data) => {
    const medal = placeMedal(data.place);
    Game.showDomAnim('anim-levelup', `${medal} ${ordinal(data.place)}`, 2200);
    Sound.play('achievement');
    // Their seat leaves the canvas — the round continues without them
    if (data.playerId && Game.state?.players?.length) {
      const pruned = Game.state.players.filter(p => p.id !== data.playerId);
      if (pruned.length !== Game.state.players.length) Game.setPlayers(pruned);
    }
    if (data.playerId === myPlayerId) {
      // No cards left and never our turn again — we naturally watch the rest.
      // (Not flagged as a spectator, so the host can still hit Play Again.)
      _finishedThisGame = true;
      hideChallengeBar();
      clearTimeout(_autoDrawTimer);
      showToast(`${medal} You finished ${ordinal(data.place)}! Watching the rest…`);
    } else {
      showToast(`${medal} ${data.nickname} finished ${ordinal(data.place)}!`);
    }
  });

  // ── Wild Challenge verdict ─────────────────────────────────────────────────
  socket.on('challenge_result', (data) => {
    const msg = data.guilty
      ? `⚔️ ${data.challengerNickname} challenged ${data.offenderNickname} — GUILTY! ${data.offenderNickname} draws ${data.count}`
      : `⚔️ ${data.challengerNickname} challenged — the +4 was legal! ${data.challengerNickname} draws ${data.count}`;
    showToast(msg, !data.guilty && data.loserId === myPlayerId);
    Game.showDomAnim('anim-plus', `+${data.count}`, 2000);
  });

  socket.on('player_won', (data) => {
    hideChallengeBar();
    clearTimeout(_autoDrawTimer);
    // The winner's equipped victory effect first, then winner screen
    Game.triggerAnimation('winner', { fx: data.victoryFx });
    Sound.play('win');
    setTimeout(() => {
      Game.setWinner(data.playerId, data.nickname);
      showToast(`🎉 ${data.nickname} wins!`);
    }, 600);
  });

  socket.on('game_restarted', () => {
    hideChallengeBar();
    // Eliminated/finished players were only spectating that round — welcome back
    if (_eliminatedThisGame || _finishedThisGame) {
      _eliminatedThisGame = false;
      _finishedThisGame = false;
      Game.isSpectator = false;
    }
    Game.resetGame();
    Game.destroy();
    _lastGameStats = null;
    $postgameModal.style.display = 'none';
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
    socket.emit('join_room', { roomCode: currentRoomCode, nickname: myNickname, playerId: myPlayerId, spectator: Game.isSpectator, godPassword: Game.isGodMode ? 'admin' : '', uid: myUid, picture: myPicture() }, (res) => {
      if (res?.error) {
        showScreen($lobby);
        showToast('Could not reconnect: ' + res.error, true);
        startPingMonitoring();
        return;
      }

      // Restore shared identity/room state from the server's response
      myPlayerId = res.playerId;
      hostId = res.hostId;
      isHost = myPlayerId === hostId;
      players = res.players;
      Game.isSpectator = res.isSpectator;
      Game.isGodMode = res.isGodMode;
      if (res.settings) applySettings(res.settings);

      // Only enter the game canvas when a game is actually running — otherwise a
      // lobby reconnect (e.g. right after creating a room) would open a blank
      // game page. Mirrors the gameInProgress gate in the other reconnect paths.
      if (res.gameInProgress && (res.reconnected || res.isSpectator)) {
        const playerOrder = players.map(p => ({ id: p.id, nickname: p.nickname, cardCount: 7, picture: p.picture }));
        showToast(res.isSpectator ? 'Reconnected as Spectator!' : 'Reconnected!');
        startGameUI();
        Game.setPlayers(playerOrder);
      } else {
        // Reconnected into a lobby that hasn't started — back to the waiting room
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
    Game.onPlayCard = (cardId, chosenColor, swapTargetId) => {
      socket.emit('play_card', { roomCode: currentRoomCode, cardId, chosenColor, swapTargetId });
    };

    // Seven-Zero: canvas hands a played 7 to the DOM target picker
    Game.onSevenSwap = (cardId) => openSevenSwapModal(cardId);

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

  // ═══════════════════════════════════════════════════════════════════════════
  // ── Accounts (optional sign-in; the game never requires it) ────────────────
  // An account is a portable pointer to the anonymous stats uid: signing in
  // adopts the account's uid so leaderboard stats follow the player across
  // devices, and the account's username becomes their reserved display name.
  // ═══════════════════════════════════════════════════════════════════════════
  const AUTH_API = '/api/auth';
  let authUser = null;
  let _authMode = 'login';
  let _googleReady = false;

  const $btnOpenAuth = document.getElementById('btn-open-auth');
  const $accountChip = document.getElementById('account-chip');
  const $accountName = document.getElementById('account-name');
  const $accountAvatar = document.getElementById('account-avatar');
  const $btnLogout = document.getElementById('btn-logout');
  const $authModal = document.getElementById('auth-modal');
  const $authTabLogin = document.getElementById('auth-tab-login');
  const $authTabRegister = document.getElementById('auth-tab-register');
  const $authForm = document.getElementById('auth-form');
  const $authEmail = document.getElementById('auth-email');
  const $authUsername = document.getElementById('auth-username');
  const $authUsernameGroup = document.getElementById('auth-username-group');
  const $authPassword = document.getElementById('auth-password');
  const $authError = document.getElementById('auth-error');
  const $authSubmit = document.getElementById('auth-submit');
  const $googleWrap = document.getElementById('google-signin-wrap');

  function setAuthUI() {
    if (authUser) {
      $btnOpenAuth.hidden = true;
      $accountChip.hidden = false;
      const isEmoji = authUser.picture && authUser.picture.startsWith('emoji:');
      $accountName.textContent = isEmoji
        ? `${authUser.picture.slice(6)} ${authUser.username}`
        : authUser.username;
      if (authUser.picture && !isEmoji) {
        $accountAvatar.src = authUser.picture;
        $accountAvatar.hidden = false;
      } else {
        $accountAvatar.hidden = true;
      }
    } else {
      $btnOpenAuth.hidden = false;
      $accountChip.hidden = true;
    }
  }

  function showAuthError(msg) {
    $authError.textContent = msg;
    $authError.hidden = false;
  }

  async function authApi(path, body) {
    const res = await fetch(AUTH_API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong — try again');
    return data;
  }

  function handleAuthSuccess(data) {
    localStorage.setItem('uno_token', data.token);
    authUser = data.user;
    // Adopt the account's stats identity — stats now follow the account
    if (authUser.uid && authUser.uid !== myUid) {
      myUid = authUser.uid;
      localStorage.setItem('uno_uid', myUid);
    }
    $nickname.value = authUser.username;
    localStorage.setItem('uno_nickname', authUser.username);
    setAuthUI();
    $authModal.style.display = 'none';
    showToast(`✓ Signed in as ${authUser.username}`);
  }

  function setAuthMode(mode) {
    _authMode = mode;
    const isLogin = mode === 'login';
    $authTabLogin.classList.toggle('tab-btn--active', isLogin);
    $authTabRegister.classList.toggle('tab-btn--active', !isLogin);
    $authUsernameGroup.hidden = isLogin;
    $authPassword.autocomplete = isLogin ? 'current-password' : 'new-password';
    $authSubmit.textContent = isLogin ? 'Sign In' : 'Create Account';
    $authError.hidden = true;
    document.getElementById('auth-title').textContent = isLogin ? 'Welcome back' : 'Create your account';
    document.getElementById('auth-pitch').textContent = isLogin
      ? 'Sign in to keep your wins and leaderboard rank.'
      : 'Save your wins, reserve your leaderboard name, and carry stats across devices.';
    document.getElementById('auth-forgot').hidden = !isLogin;
    // Focus the first field of the active mode
    setTimeout(() => (isLogin ? $authEmail : $authUsername).focus(), 50);
  }

  $authTabLogin.addEventListener('click', () => setAuthMode('login'));
  $authTabRegister.addEventListener('click', () => setAuthMode('register'));

  // Password visibility toggle
  document.getElementById('auth-eye').addEventListener('click', () => {
    const hidden = $authPassword.type === 'password';
    $authPassword.type = hidden ? 'text' : 'password';
    document.getElementById('auth-eye').textContent = hidden ? '🙈' : '👁';
  });

  $authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    $authError.hidden = true;
    $authSubmit.disabled = true;
    try {
      const body = {
        email: $authEmail.value.trim(),
        password: $authPassword.value,
        uid: myUid,
      };
      if (_authMode === 'register') body.username = $authUsername.value.trim();
      handleAuthSuccess(await authApi(_authMode === 'login' ? '/login' : '/register', body));
    } catch (err) {
      showAuthError(err.message);
    } finally {
      $authSubmit.disabled = false;
    }
  });

  // Google Sign-In: load Google Identity Services only when the modal opens,
  // and only if the server has a client id configured.
  function initGoogleSignIn() {
    if (_googleReady) return;
    _googleReady = true;
    fetch(AUTH_API + '/config')
      .then(r => r.json())
      .then(cfg => {
        if (!cfg.googleClientId) return; // not configured — email auth only
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => {
          window.google.accounts.id.initialize({
            client_id: cfg.googleClientId,
            callback: async (resp) => {
              try {
                handleAuthSuccess(await authApi('/google', { credential: resp.credential, uid: myUid, picture: null }));
              } catch (err) {
                showAuthError(err.message);
              }
            },
          });
          window.google.accounts.id.renderButton(
            document.getElementById('google-signin-btn'),
            { theme: 'filled_black', size: 'large', shape: 'pill', width: 280 }
          );
          $googleWrap.hidden = false;
        };
        document.head.appendChild(s);
      })
      .catch(() => {});
  }

  $btnOpenAuth.addEventListener('click', () => {
    setAuthMode('login');
    $authModal.style.display = 'flex';
    initGoogleSignIn();
  });

  document.getElementById('btn-close-auth').addEventListener('click', () => {
    $authModal.style.display = 'none';
  });

  $btnLogout.addEventListener('click', () => {
    localStorage.removeItem('uno_token');
    authUser = null;
    // Keep the current uid — this device keeps playing under the same identity
    setAuthUI();
    showToast('Signed out');
  });

  // Restore session on load
  (async () => {
    const token = localStorage.getItem('uno_token');
    if (!token) return;
    try {
      const res = await fetch(AUTH_API + '/me', { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) throw new Error();
      const data = await res.json();
      authUser = data.user;
      if (authUser.uid && authUser.uid !== myUid) {
        myUid = authUser.uid;
        localStorage.setItem('uno_uid', myUid);
      }
      setAuthUI();
    } catch {
      localStorage.removeItem('uno_token'); // expired/invalid — quiet cleanup
    }
  })();

  // ═══════════════════════════════════════════════════════════════════════════
  // ── Rewards: coins / XP / level / daily login / challenges ─────────────────
  // Keyed by the anonymous uid (same identity as the leaderboard) — no signup
  // needed. All grants are computed server-side; this only displays and claims.
  // ═══════════════════════════════════════════════════════════════════════════
  const PROGRESS_API = '/api/progress';
  let _progress = null;
  let _dailyToastShown = false;

  // ── Cosmetics: apply equipped items to the live game ───────────────────────
  // Card palette mutates the shared CardColors object in place (the renderer
  // holds that reference), table/back/victory go through Cosmetics.setActive.
  // Equipped state is cached in localStorage so the theme is right from the
  // first frame, before /api/progress answers.
  function applyEquippedCosmetics(equipped) {
    const eq = equipped || {};
    try {
      const classic = Cosmetics.getItem('card-classic').palette;
      const themeItem = Cosmetics.getItem(eq.cardTheme);
      const pal = (themeItem && themeItem.palette) || classic;
      for (const [color, vals] of Object.entries(pal)) {
        if (CardColors[color]) Object.assign(CardColors[color], vals);
      }
      Cosmetics.setActive('tableTheme', eq.tableTheme);
      Cosmetics.setActive('cardBack', eq.cardBack);
      Cosmetics.setActive('victory', eq.victory);
      // Cosmetic avatar becomes my seat picture (works without an account)
      const av = Cosmetics.getItem(eq.avatar);
      if (av && av.emoji) localStorage.setItem('uno_avatar', 'emoji:' + av.emoji);
      else localStorage.removeItem('uno_avatar');
      localStorage.setItem('uno_equipped', JSON.stringify(eq));
    } catch { /* a broken cache must never block the game */ }
  }

  // My seat picture: equipped cosmetic avatar wins, then account photo/emoji
  function myPicture() {
    const cosmetic = localStorage.getItem('uno_avatar');
    if (cosmetic) return cosmetic;
    return (authUser && authUser.picture) || null;
  }

  // Boot: re-apply the cached equipped set instantly (server confirms later)
  try { applyEquippedCosmetics(JSON.parse(localStorage.getItem('uno_equipped') || '{}')); } catch { }

  const $progressChip = document.getElementById('progress-chip');
  const $chipCoins = document.getElementById('chip-coins');
  const $chipLevel = document.getElementById('chip-level');
  const $chipDailyDot = document.getElementById('chip-daily-dot');
  const $rewardsModal = document.getElementById('rewards-modal');
  const $btnClaimDaily = document.getElementById('btn-claim-daily');

  function renderProgressChip() {
    if (!_progress) return;
    $progressChip.hidden = false;
    $chipCoins.textContent = _progress.coins;
    $chipLevel.textContent = _progress.level;
    $chipDailyDot.hidden = !(_progress.login && _progress.login.canClaim);
  }

  async function refreshProgress() {
    try {
      const res = await fetch(`${PROGRESS_API}?uid=${encodeURIComponent(myUid)}`);
      if (!res.ok) return;
      _progress = await res.json();
      renderProgressChip();
      applyEquippedCosmetics(_progress.equipped);
      if (!_dailyToastShown && _progress.login && _progress.login.canClaim) {
        _dailyToastShown = true;
        showToast('🎁 Daily reward available — tap your coins!');
      }
      if ($rewardsModal.style.display === 'flex') renderRewardsModal();
      if ($shopModal && $shopModal.style.display === 'flex') renderShopModal();
    } catch { /* offline / server hiccup — the chip just stays stale */ }
  }

  function renderChallengeList($el, list) {
    $el.innerHTML = '';
    if (!list || list.length === 0) {
      $el.innerHTML = '<p class="empty-text">Check back soon!</p>';
      return;
    }
    for (const ch of list) {
      const row = document.createElement('div');
      row.className = 'challenge-row' + (ch.done ? ' challenge-row--done' : '');
      const pct = Math.min(100, Math.round((ch.progress / ch.target) * 100));
      row.innerHTML = `
        <span class="challenge-icon">${ch.icon}</span>
        <div class="challenge-body">
          <div class="challenge-top">
            <span class="challenge-desc">${ch.desc}</span>
            <span class="challenge-count">${ch.done ? '✓ Done' : `${ch.progress}/${ch.target}`}</span>
          </div>
          <div class="challenge-bar"><div class="challenge-fill" style="width:${pct}%"></div></div>
          <div class="challenge-rewards">
            <span class="reward-pill reward-pill--coins">🪙 ${ch.coins}</span>
            <span class="reward-pill reward-pill--xp">+${ch.xp} XP</span>
          </div>
        </div>`;
      $el.appendChild(row);
    }
  }

  function renderRewardsModal() {
    if (!_progress) return;
    const p = _progress;
    document.getElementById('rewards-level').textContent = p.level;
    document.getElementById('rewards-coins').textContent = p.coins;
    const pct = Math.min(100, Math.round((p.xp / p.xpToNext) * 100));
    document.getElementById('xp-fill').style.width = pct + '%';
    document.getElementById('xp-label').textContent = `${p.xp} / ${p.xpToNext} XP to level ${p.level + 1}`;
    // Level ring doubles as a radial XP meter
    const $ring = document.querySelector('.level-ring');
    if ($ring) $ring.style.setProperty('--ring-pct', pct + '%');

    // — Daily login calendar —
    const login = p.login;
    document.getElementById('login-streak').textContent =
      login.streak > 1 ? `🔥 ${login.streak}-day streak` : '';
    const $cal = document.getElementById('login-calendar');
    $cal.innerHTML = '';
    // Slot the next claim lands on (server-computed); when today is already
    // claimed, everything up to the last-claimed slot shows as done.
    const nextSlot = login.canClaim ? login.nextDay : (login.calendarDay % login.calendar.length) + 1;
    for (const day of login.calendar) {
      const cell = document.createElement('div');
      const claimed = day.day < nextSlot || (!login.canClaim && day.day === login.calendarDay);
      const isNext = login.canClaim && day.day === nextSlot;
      cell.className = 'cal-day' + (claimed ? ' cal-day--claimed' : '') + (isNext ? ' cal-day--next' : '');
      cell.innerHTML = `<span class="cal-num">Day ${day.day}</span><span class="cal-reward">🪙${day.coins}${day.xp ? `<br>+${day.xp}XP` : ''}</span>${claimed ? '<span class="cal-check">✓</span>' : ''}`;
      $cal.appendChild(cell);
    }
    $btnClaimDaily.disabled = !login.canClaim;
    $btnClaimDaily.textContent = login.canClaim ? "Claim Today's Reward" : '✓ Claimed — back tomorrow!';

    renderChallengeList(document.getElementById('daily-challenges'), p.daily);
    renderChallengeList(document.getElementById('weekly-challenges'), p.weekly);
  }

  $progressChip.addEventListener('click', () => {
    $rewardsModal.style.display = 'flex';
    renderRewardsModal();
    refreshProgress();
  });

  document.getElementById('btn-close-rewards').addEventListener('click', () => {
    $rewardsModal.style.display = 'none';
  });

  $btnClaimDaily.addEventListener('click', async () => {
    if (!_progress || !_progress.login.canClaim) return;
    $btnClaimDaily.disabled = true;
    try {
      const res = await fetch(`${PROGRESS_API}/claim-daily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: myUid, name: $nickname.value.trim() || undefined }),
      });
      const data = await res.json();
      if (data.claimed) {
        Sound.play('achievement');
        showToast(`🎁 Day ${data.reward.day}: +${data.reward.coins} coins${data.reward.xp ? ` +${data.reward.xp} XP` : ''}!`);
      }
    } catch { showToast('Could not claim — try again', true); }
    refreshProgress();
  });

  // Initial load
  refreshProgress();

  // ═══════════════════════════════════════════════════════════════════════════
  // ── Shop: spend earned coins on cosmetics (registry-driven) ────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  const $shopModal = document.getElementById('shop-modal');
  const $shopTabs = document.getElementById('shop-tabs');
  const $shopGrid = document.getElementById('shop-grid');
  const $shopCoins = document.getElementById('shop-coins');
  let _shopCat = 'cardTheme';

  document.getElementById('btn-open-shop').addEventListener('click', () => {
    $shopModal.style.display = 'flex';
    renderShopModal();
    refreshProgress();
  });

  document.getElementById('btn-close-shop').addEventListener('click', () => {
    $shopModal.style.display = 'none';
  });

  function shopPreview(item) {
    if (item.cat === 'cardTheme') {
      const dots = ['red', 'blue', 'green', 'yellow']
        .map(c => `<span class="shop-dot" style="background:${item.palette[c].fill}"></span>`).join('');
      return `<div class="shop-preview shop-preview--dots">${dots}</div>`;
    }
    if (item.cat === 'tableTheme') {
      return `<div class="shop-preview shop-preview--table" style="background:radial-gradient(circle at 50% 35%, ${item.table.base[0]}, ${item.table.base[2]});box-shadow:inset 0 0 20px rgba(${item.table.spotRgb},0.45)"></div>`;
    }
    if (item.cat === 'cardBack') {
      return `<div class="shop-preview shop-preview--back" style="background:linear-gradient(${item.back.top},${item.back.bottom});border-color:rgba(${item.back.ring[0]},0.8)"><span style="color:${item.back.labelColor}">${item.back.label}</span></div>`;
    }
    return `<div class="shop-preview shop-preview--emoji">${item.emoji || '🎁'}</div>`;
  }

  function renderShopModal() {
    const inv = (_progress && _progress.inventory) || [];
    const eq = (_progress && _progress.equipped) || {};
    const coins = (_progress && _progress.coins) || 0;
    $shopCoins.textContent = coins;

    // — Category tabs —
    $shopTabs.innerHTML = '';
    for (const [cat, def] of Object.entries(Cosmetics.CATEGORIES)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'shop-tab' + (cat === _shopCat ? ' shop-tab--active' : '');
      b.textContent = `${def.icon} ${def.label}`;
      b.addEventListener('click', () => { _shopCat = cat; renderShopModal(); });
      $shopTabs.appendChild(b);
    }

    // — Item cards —
    $shopGrid.innerHTML = '';
    for (const item of Cosmetics.itemsByCategory(_shopCat)) {
      const owned = Cosmetics.owns(inv, item.id);
      const equipped = eq[_shopCat] === item.id || (!eq[_shopCat] && item.default);
      const rar = Cosmetics.RARITIES[item.rarity] || Cosmetics.RARITIES.starter;

      const card = document.createElement('div');
      card.className = 'shop-item' + (equipped ? ' shop-item--equipped' : '');
      card.innerHTML = `
        ${shopPreview(item)}
        <span class="shop-item-name">${item.name}</span>
        <span class="shop-item-rarity" style="color:${rar.color}">${rar.label}</span>
        ${item.levelUnlock && !owned ? `<span class="shop-item-unlock">free at Lv ${item.levelUnlock}</span>` : ''}`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn shop-item-btn';
      if (equipped) {
        btn.textContent = '✓ Equipped';
        btn.classList.add('shop-item-btn--equipped');
        btn.disabled = !!item.default;
        // Tapping an equipped (non-default) item takes it off → back to default
        if (!item.default) btn.addEventListener('click', () => equipCosmetic(_shopCat, null));
      } else if (owned) {
        btn.textContent = 'Equip';
        btn.classList.add('btn-primary');
        btn.addEventListener('click', () => equipCosmetic(_shopCat, item.id));
      } else {
        btn.textContent = `🪙 ${item.price}`;
        btn.classList.add('shop-item-btn--buy');
        if (coins < item.price) btn.classList.add('shop-item-btn--poor');
        btn.addEventListener('click', () => buyCosmetic(item));
      }
      card.appendChild(btn);
      $shopGrid.appendChild(card);
    }
  }

  async function buyCosmetic(item) {
    if (_progress && _progress.coins < item.price) {
      return showToast(`Not enough coins — you need ${item.price - _progress.coins} more. Win games to earn coins!`, true);
    }
    try {
      const res = await fetch(`${PROGRESS_API}/shop/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: myUid, itemId: item.id }),
      });
      const data = await res.json();
      if (data.error) return showToast(data.error, true);
      if (_progress) {
        _progress.coins = data.coins;
        _progress.inventory = data.inventory;
      }
      Sound.play('achievement');
      showToast(`🎉 ${item.name} is yours!`);
      renderProgressChip();
      await equipCosmetic(item.cat, item.id); // wear it right away
    } catch { showToast('Purchase failed — try again', true); }
  }

  async function equipCosmetic(category, itemId) {
    try {
      const res = await fetch(`${PROGRESS_API}/shop/equip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: myUid, category, itemId }),
      });
      const data = await res.json();
      if (data.error) return showToast(data.error, true);
      if (_progress) _progress.equipped = data.equipped;
      applyEquippedCosmetics(data.equipped);
      renderShopModal();
    } catch { showToast('Could not equip — try again', true); }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ── Profile (open by tapping the account chip) ─────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  // Keep in sync with AVATAR_EMOJIS in server/avatars.js
  const AVATAR_EMOJIS = [
    '😀', '😎', '🤠', '🥳', '😈', '👻', '👽', '🤖',
    '🐱', '🐶', '🦊', '🐼', '🦁', '🐸', '🐙', '🦄',
    '🐯', '🐵', '🔥', '⚡', '🌟', '🎯', '🃏', '👑',
  ];

  const $profileModal = document.getElementById('profile-modal');
  const $profileUsername = document.getElementById('profile-username');
  const $profileEmail = document.getElementById('profile-email');
  const $profileGoogleBadge = document.getElementById('profile-google-badge');
  const $profilePreview = document.getElementById('profile-avatar-preview');
  const $avatarGrid = document.getElementById('avatar-grid');
  const $profileStats = document.getElementById('profile-stats');
  const $profileAchievements = document.getElementById('profile-achievements');
  const $profileError = document.getElementById('profile-error');
  const $btnSaveProfile = document.getElementById('btn-save-profile');

  // undefined = unchanged; null = default letter; 'google'; 'emoji:X'
  let _selectedAvatar;

  function renderProfilePreview(pictureVal) {
    $profilePreview.innerHTML = '';
    if (pictureVal && pictureVal.startsWith('emoji:')) {
      $profilePreview.textContent = pictureVal.slice(6);
    } else if (pictureVal) {
      const img = document.createElement('img');
      img.src = pictureVal;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      $profilePreview.appendChild(img);
    } else {
      $profilePreview.textContent = (authUser?.username || 'P').charAt(0).toUpperCase();
    }
  }

  function buildAvatarGrid() {
    $avatarGrid.innerHTML = '';
    const current = authUser.picture;

    const addOption = (value, contentEl, title) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'avatar-option';
      btn.title = title;
      btn.appendChild(contentEl);
      const isCurrent =
        (value === null && !current) ||
        (value === 'google' && current && current === authUser.googlePicture) ||
        (value === current);
      if (isCurrent && _selectedAvatar === undefined) btn.classList.add('selected');
      btn.addEventListener('click', () => {
        _selectedAvatar = value;
        $avatarGrid.querySelectorAll('.avatar-option').forEach(el => el.classList.remove('selected'));
        btn.classList.add('selected');
        renderProfilePreview(value === 'google' ? authUser.googlePicture : value);
      });
      $avatarGrid.appendChild(btn);
    };

    // Google photo (only when the account has one)
    if (authUser.googlePicture) {
      const img = document.createElement('img');
      img.src = authUser.googlePicture;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      addOption('google', img, 'Your Google photo');
    }
    // Default letter disc
    const letter = document.createElement('span');
    letter.textContent = (authUser.username || 'P').charAt(0).toUpperCase();
    addOption(null, letter, 'Default avatar');
    // Emoji set
    for (const e of AVATAR_EMOJIS) {
      const span = document.createElement('span');
      span.textContent = e;
      addOption(`emoji:${e}`, span, e);
    }
  }

  function renderProfileStats(data) {
    $profileStats.innerHTML = '';
    const s = data.stats;
    if (!s || s.gamesPlayed === 0) {
      $profileStats.innerHTML = '<span class="profile-muted">No games recorded yet — play one!</span>';
    } else {
      const winRate = s.gamesPlayed ? Math.round((s.wins / s.gamesPlayed) * 100) : 0;
      [['🏆', s.wins, 'Wins'], ['🎮', s.gamesPlayed, 'Games'], ['📈', winRate + '%', 'Win rate'], ['🌈', s.wildsPlayed, 'Wilds']]
        .forEach(([icon, val, label]) => {
          const tile = document.createElement('div');
          tile.className = 'profile-stat-tile';
          tile.innerHTML = `<span class="stat-icon">${icon}</span><span class="stat-val">${val}</span><span class="stat-label">${label}</span>`;
          $profileStats.appendChild(tile);
        });
    }

    $profileAchievements.innerHTML = '';
    const unlocked = new Set((s && s.achievements) || []);
    for (const [id, def] of Object.entries(data.achievementDefs || {})) {
      const chip = document.createElement('div');
      chip.className = 'achievement-chip' + (unlocked.has(id) ? '' : ' achievement-chip--locked');
      chip.textContent = `${def.emoji} ${def.title}`;
      chip.title = def.desc + (unlocked.has(id) ? ' — unlocked!' : ' — locked');
      $profileAchievements.appendChild(chip);
    }
  }

  async function openProfile() {
    if (!authUser) return;
    _selectedAvatar = undefined;
    $profileError.hidden = true;
    $profileUsername.value = authUser.username;
    $profileEmail.textContent = authUser.email;
    $profileGoogleBadge.hidden = !authUser.hasGoogle;
    renderProfilePreview(authUser.picture);
    buildAvatarGrid();
    $profileStats.innerHTML = '<span class="profile-muted">Loading…</span>';
    $profileAchievements.innerHTML = '';
    $profileModal.style.display = 'flex';

    try {
      const res = await fetch(AUTH_API + '/profile', {
        headers: { Authorization: 'Bearer ' + localStorage.getItem('uno_token') },
      });
      if (!res.ok) throw new Error();
      renderProfileStats(await res.json());
    } catch {
      $profileStats.innerHTML = '<span class="profile-muted">Could not load stats</span>';
    }
  }

  // The account chip opens the profile (except the sign-out button inside it)
  $accountChip.addEventListener('click', (e) => {
    if (e.target.closest('#btn-logout')) return;
    openProfile();
  });

  document.getElementById('btn-close-profile').addEventListener('click', () => {
    $profileModal.style.display = 'none';
  });

  $btnSaveProfile.addEventListener('click', async () => {
    const body = {};
    const name = $profileUsername.value.trim();
    if (name !== authUser.username) body.username = name;
    if (_selectedAvatar !== undefined) body.picture = _selectedAvatar;
    if (Object.keys(body).length === 0) {
      $profileModal.style.display = 'none';
      return;
    }

    $btnSaveProfile.disabled = true;
    $profileError.hidden = true;
    try {
      const res = await fetch(AUTH_API + '/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + localStorage.getItem('uno_token'),
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save — try again');

      authUser = data.user;
      setAuthUI();
      $nickname.value = authUser.username;
      localStorage.setItem('uno_nickname', authUser.username);
      $profileModal.style.display = 'none';
      showToast('✓ Profile updated');
    } catch (err) {
      $profileError.textContent = err.message;
      $profileError.hidden = false;
    } finally {
      $btnSaveProfile.disabled = false;
    }
  });

  // ── Quick Match: one tap into an open public game (or a fresh bot table) ──
  const $btnQuickMatch = document.getElementById('btn-quick-match');
  $btnQuickMatch.addEventListener('click', () => {
    const nick = $nickname.value.trim();
    if (!nick) {
      showToast('Please enter a nickname', true);
      $nickname.focus();
      return;
    }
    $btnQuickMatch.disabled = true;
    socket.emit('quick_match', { nickname: nick, uid: myUid, picture: myPicture() }, (res) => {
      $btnQuickMatch.disabled = false;
      if (res.error) return showToast(res.error, true);

      if (res.joined) {
        handleJoinSuccess(res, res.roomCode);
        showToast('⚡ Joined an open game!');
        return;
      }
      // Created a new public room pre-seated with bots
      myPlayerId = res.playerId;
      myNickname = res.nickname;
      currentRoomCode = res.roomCode;
      sessionStorage.setItem('uno_session', JSON.stringify({
        roomCode: res.roomCode, playerId: res.playerId, nickname: res.nickname,
      }));
      localStorage.setItem('uno_nickname', res.nickname);
      $displayCode.textContent = res.roomCode;
      history.replaceState({}, '', `?room=${res.roomCode}&playerId=${res.playerId}&nickname=${encodeURIComponent(res.nickname)}`);
      showScreen($waitingRoom);
      showToast('No open rooms — made you one with bots. Start now or wait for players!');
    });
  });

  // ── Seven-Zero Swap Picker ─────────────────────────────────────────────────
  const $sevenModal = document.getElementById('seven-swap-modal');
  const $sevenList = document.getElementById('seven-swap-list');
  document.getElementById('btn-close-seven-swap').addEventListener('click', () => {
    $sevenModal.style.display = 'none';
  });

  function openSevenSwapModal(cardId) {
    $sevenList.innerHTML = '';
    const opponents = (Game.state.players || []).filter(p => p.id !== myPlayerId);
    if (!opponents.length) return;

    opponents.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'manage-player-item seven-swap-item';

      li.appendChild(makeAvatarEl(p, i));

      const name = document.createElement('span');
      name.className = 'manage-player-name';
      name.textContent = p.nickname;
      li.appendChild(name);

      const count = document.createElement('span');
      count.className = 'seven-swap-count';
      count.textContent = `${p.cardCount ?? '?'} cards`;
      li.appendChild(count);

      li.addEventListener('click', () => {
        $sevenModal.style.display = 'none';
        Game.playSevenWithSwap(cardId, p.id);
      });
      $sevenList.appendChild(li);
    });
    $sevenModal.style.display = 'flex';
  }

  // ── House Rule Events ──────────────────────────────────────────────────────
  socket.on('jumped_in', (data) => {
    if (data.playerId !== myPlayerId) showToast(`⚡ ${data.nickname} jumped in!`);
    Sound.play('card');
  });

  socket.on('hands_rotated', () => {
    showToast('🔄 Zero played — all hands rotate!');
    Sound.play('swap');
  });

  socket.on('hands_swapped', (data) => {
    const involvesMe = data.a === myPlayerId || data.b === myPlayerId;
    showToast(involvesMe
      ? '🔄 Your hand was swapped!'
      : `🔄 ${data.aNickname} ⇄ ${data.bNickname} swapped hands!`);
    Sound.play('swap');
  });

  // ── Sound Toggle ───────────────────────────────────────────────────────────
  const $btnSound = document.getElementById('btn-sound');
  function refreshSoundBtn() {
    $btnSound.textContent = Sound.muted ? '🔇' : '🔊';
    $btnSound.title = Sound.muted ? 'Unmute sounds' : 'Mute sounds';
  }
  refreshSoundBtn();
  $btnSound.addEventListener('click', () => {
    Sound.toggleMute();
    refreshSoundBtn();
    if (!Sound.muted) Sound.play('card');
  });

  // ── Post-Game Stats Panel ──────────────────────────────────────────────────
  let _lastGameStats = null;
  const $postgameModal = document.getElementById('postgame-modal');
  const $postgameTitle = document.getElementById('postgame-title');
  const $postgameAchievements = document.getElementById('postgame-achievements');
  const $postgameTbody = document.querySelector('#postgame-table tbody');

  document.getElementById('btn-close-postgame').addEventListener('click', () => {
    $postgameModal.style.display = 'none';
  });

  function formatDuration(ms) {
    const s = Math.round(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  function showPostgameModal(data) {
    const places = Array.isArray(data.standings) && data.standings.length > 0;
    $postgameTitle.textContent = places
      ? `🏁 ${data.winnerName} took 1st — ${formatDuration(data.durationMs)}`
      : `📊 ${data.winnerName} won in ${formatDuration(data.durationMs)}`;

    // — My match rewards (coins / XP / level-ups / completed challenges) —
    const $pgRewards = document.getElementById('postgame-rewards');
    $pgRewards.innerHTML = '';
    const mine = (data.players || []).find(p => p.playerId === myPlayerId);
    if (mine && mine.rewards) {
      const r = mine.rewards;
      const card = document.createElement('div');
      card.className = 'postgame-rewards-card';
      card.innerHTML =
        `<span class="pg-reward pg-coins">+${r.coins} 🪙</span>` +
        `<span class="pg-reward pg-xp">+${r.xp} XP</span>` +
        (r.levelUps || []).map(l =>
          `<span class="pg-reward pg-levelup">⬆️ Level ${l.level}${l.label ? ` — ${l.label}` : ''}</span>`).join('') +
        (r.challenges || []).map(c =>
          `<span class="pg-reward pg-challenge">${c.icon} ${c.desc} ✓ +${c.coins}🪙</span>`).join('');
      $pgRewards.appendChild(card);

      if ((r.levelUps || []).length) {
        const top = r.levelUps[r.levelUps.length - 1];
        Game.showDomAnim('anim-levelup', `⬆️ LEVEL ${top.level}`, 2400);
        Sound.play('achievement');
        if (top.label) showToast(`🎉 Level ${top.level} unlocked: ${top.label}!`);
      }
    }

    $postgameAchievements.innerHTML = '';
    let mineUnlocked = false;
    for (const a of data.achievements || []) {
      const chip = document.createElement('div');
      chip.className = 'achievement-chip';
      chip.textContent = `${a.emoji} ${a.title} — ${a.nickname}`;
      $postgameAchievements.appendChild(chip);
      if (a.playerId === myPlayerId) mineUnlocked = true;
    }
    if (mineUnlocked) Sound.play('achievement');

    $postgameTbody.innerHTML = '';
    // Play-for-Places: order by finishing rank and show a medal. Otherwise the
    // single winner floats to the top.
    const rows = places
      ? [...(data.players || [])].sort((a, b) => (a.place || 99) - (b.place || 99))
      : [...(data.players || [])].sort((a, b) => (b.won ? 1 : 0) - (a.won ? 1 : 0));
    for (const p of rows) {
      const tr = document.createElement('tr');
      const name = document.createElement('td');
      const prefix = places
        ? (p.place ? `${placeMedal(p.place)} ${ordinal(p.place)} ` : '')
        : (p.won ? '👑 ' : '');
      name.textContent = `${prefix}${p.nickname}${p.playerId === myPlayerId ? ' (you)' : ''}`;
      tr.appendChild(name);
      for (const v of [p.cardsPlayed, p.cardsDrawn, p.wildsPlayed, p.isBot ? '—' : (p.totalWins ?? '—')]) {
        const td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      }
      $postgameTbody.appendChild(tr);
    }

    $postgameModal.style.display = 'flex';
  }

  socket.on('game_over_stats', (data) => {
    _lastGameStats = data;
    // Grants were just applied server-side — pull the fresh chip numbers
    refreshProgress();
    // Let the confetti and winner banner land before the panel slides in
    setTimeout(() => {
      if (_lastGameStats === data && Game.state.winner) showPostgameModal(data);
    }, 1600);
  });

  document.getElementById('btn-share-result').addEventListener('click', () => {
    const d = _lastGameStats;
    if (!d) return;
    const won = d.winnerId === myPlayerId;
    const n = Math.max((d.players?.length || 2) - 1, 1);
    const text = won
      ? `🃏 I just WON a game of UNO against ${n} opponent${n > 1 ? 's' : ''} on Play UNO Free! Think you can beat me? ${location.origin}`
      : `🃏 Just played a game of UNO online — free, no signup, up to 20 players. Come play: ${location.origin}`;
    if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(text)
        .then(() => showToast('Result copied — paste it anywhere!'))
        .catch(() => showToast(text));
    }
  });

  // ── PWA: register the service worker (installable app + faster loads) ─────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // ── Quick Emotes (in-game reactions) ───────────────────────────────────────
  // Whitelisted reactions only — keep in sync with EMOTES in server/index.js.
  const EMOTES = ['👍', '😂', '😮', '😭', '😡', '🎉', '⏰', '🔥'];
  const EMOTE_COOLDOWN_MS = 1500; // matches server rate limit
  const $btnEmote = document.getElementById('btn-emote');
  const $emotePicker = document.getElementById('emote-picker');
  let _emoteCooldownTimer = null;

  EMOTES.forEach((emote) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'emote-option';
    btn.textContent = emote;
    btn.setAttribute('aria-label', `React with ${emote}`);
    btn.addEventListener('click', () => {
      if (!currentRoomCode) return;
      socket.emit('send_emote', { roomCode: currentRoomCode, emote });
      $emotePicker.hidden = true;
      // Disable for the server's cooldown window so taps aren't silently dropped
      $btnEmote.disabled = true;
      clearTimeout(_emoteCooldownTimer);
      _emoteCooldownTimer = setTimeout(() => { $btnEmote.disabled = false; }, EMOTE_COOLDOWN_MS);
    });
    $emotePicker.appendChild(btn);
  });

  $btnEmote.addEventListener('click', () => {
    $emotePicker.hidden = !$emotePicker.hidden;
  });

  // Tapping anywhere else (including the canvas) closes the picker
  document.addEventListener('pointerdown', (e) => {
    if ($emotePicker.hidden) return;
    if (e.target.closest('#btn-emote') || e.target.closest('#emote-picker')) return;
    $emotePicker.hidden = true;
  });

  socket.on('emote', (data) => {
    Sound.play('emote');
    // In-game: bubble above the sender's seat. Waiting room: plain toast.
    if ($gameScreen.classList.contains('active') && Game.state.active) {
      Game.showEmoteBubble(data.playerId, data.emote);
    } else {
      showToast(`${data.nickname}: ${data.emote}`);
    }
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

      li.appendChild(makeAvatarEl(p, 0));

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
