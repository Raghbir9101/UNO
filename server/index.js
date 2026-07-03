// ─── Express + Socket.io Server ───────────────────────────────────────────────
// Serves the public directory and handles all real-time game events.
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const compression = require('compression');
require('dotenv').config();
const roomManager = require('./roomManager');
const gameLogic = require('./gameLogic');
const seoPages = require('./routes/seoPages');
const statePersistence = require('./statePersistence');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  // WebSocket first — nginx confirmed 101, Cloudflare grey-clouded
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  // Faster heartbeat detection (default is 25s/20s which masks dead connections)
  pingInterval: 10000,   // 10s between server pings
  pingTimeout: 5000,     // 5s to respond before considered dead
  // Reduce per-message overhead
  perMessageDeflate: false,  // compression adds CPU latency on small payloads
});

const PORT = process.env.PORT || 3000;

// ── View Engine (EJS for SEO pages) ──
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

// ── Compression ──
app.use(compression());

// Disable caching for HTML pages only (not static assets / socket.io)
app.use((req, res, next) => {
  // Don't break socket.io or static asset caching
  if (req.path.startsWith('/socket.io')) return next();
  const ext = path.extname(req.path);
  if (ext && ext !== '.html' && ext !== '.ejs') {
    if (req.query.v) {
      // Versioned assets (?v=N bumped on deploy): safe to cache forever
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      // Unversioned static assets: cache for 1 day
      res.set('Cache-Control', 'public, max-age=86400');
    }
  } else {
    // HTML/dynamic pages: no cache
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// ── SEO Pages (must come BEFORE static middleware so / doesn't serve index.html) ──
app.use(seoPages);

// ── Game SPA: serve the existing index.html at /play ──
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Serve static files (JS, CSS, images, assets — but NOT index.html as homepage)
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));

// ── 404 Handler (must come after all other routes) ──
app.use((req, res) => {
  res.status(404).render('404', {
    title: 'Page Not Found — UNO Online',
    description: 'The page you are looking for does not exist.',
    canonical: (process.env.BASE_URL || 'https://yourdomain.com') + req.path,
  });
});

// ─── Helper: broadcast room player list ───────────────────────────────────────

function broadcastRoomUpdate(roomCode) {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;

  // Monotonically-increasing sequence number — clients use this to reject stale events
  room.updateSeq = (room.updateSeq || 0) + 1;

  const players = room.players.map(p => ({
    id: p.id,
    nickname: p.nickname,
    connected: p.connected,
    isBot: !!p.isBot,
  }));

  io.to(roomCode).emit('room_updated', {
    seq: room.updateSeq,
    players,
    hostId: room.hostId,
    settings: room.settings,
  });
}


function broadcastGameState(roomCode) {
  const room = roomManager.getRoom(roomCode);
  if (!room || !room.gameState) return;

  const publicState = gameLogic.getPublicState(room.gameState);
  io.to(roomCode).emit('game_state', publicState);

  if (room.spectators) {
    for (const spec of room.spectators) {
      if (spec.connected && spec.socketId && spec.isGodMode) {
        const sock = getSocketById(spec.socketId);
        if (sock) sock.emit('god_hands', room.gameState.hands);
      }
    }
  }

  // Reset the 30-second auto-play timer for the current player
  resetAutoPlayTimer(roomCode);
}

// ─── Per-room action lock ────────────────────────────────────────────────────
// Prevents two near-simultaneous socket events (e.g. double-tap on mobile) from
// both mutating game state. The lock is released immediately after the action
// completes — it only blocks truly concurrent events, not sequential ones.
const _roomLocks = {};  // roomCode → boolean

function acquireRoomLock(roomCode) {
  if (_roomLocks[roomCode]) return false;  // already locked
  _roomLocks[roomCode] = true;
  return true;
}

function releaseRoomLock(roomCode) {
  delete _roomLocks[roomCode];
}

// ─── Auto-play: AFK players (after 30s) and bots (after a short delay) ───────
const _autoPlayTimers = {};  // roomCode → timeout handle

const AFK_TIMEOUT_MS = Number(process.env.AFK_TIMEOUT_MS) || 30000; // env override is for tests
// Bots think for a moment so the game has a human rhythm instead of instant replies
function botDelayMs() {
  return 1100 + Math.floor(Math.random() * 1400); // 1.1–2.5s
}

// The client deals cards sequentially at ~270ms per card (CARD_FLY_MS 250 +
// DEAL_GAP 20 in public/main.js — keep in sync). No auto-play may fire while
// clients are still dealing, or bots visibly play over the deal animation.
const DEAL_CARD_MS = 270;
const DEAL_BUFFER_MS = 800; // network delivery + client render start

function dealAnimationMs(playerCount) {
  return playerCount * 7 * DEAL_CARD_MS + DEAL_BUFFER_MS;
}

function isBotPlayer(room, playerId) {
  const p = room.players.find(pl => pl.id === playerId);
  return !!(p && p.isBot);
}

// Pick a wild color the way a person would: the color you hold most of
function bestWildColor(hand) {
  const counts = {};
  for (const c of hand) {
    if (c.color !== 'wild') counts[c.color] = (counts[c.color] || 0) + 1;
  }
  let best = null;
  for (const color of gameLogic.COLORS) {
    if (best === null || (counts[color] || 0) > (counts[best] || 0)) best = color;
  }
  return best || gameLogic.COLORS[Math.floor(Math.random() * 4)];
}

// Perform one full turn for a player who can't act themselves (AFK human or bot).
// Mirrors exactly what the play_card / draw_card / pass_turn socket handlers do.
function performAutoAction(roomCode, currentId, { isBot } = {}) {
  const r = roomManager.getRoom(roomCode);
  if (!r || !r.gameState || r.gameState.winner) return;
  if (gameLogic.getCurrentPlayerId(r.gameState) !== currentId) return;

  const gs = r.gameState;
  const hand = gs.hands[currentId] || [];

  const sendHandTo = (playerId) => {
    const p = r.players.find(pl => pl.id === playerId);
    if (p && p.socketId) {
      const sock = getSocketById(p.socketId);
      if (sock) sendHandToPlayer(sock, playerId, gs);
    }
  };

  const playCardAs = (card, chosenColor) => {
    const result = gameLogic.playCard(gs, currentId, card.id, chosenColor);
    if (result.error) return false;

    sendHandTo(currentId);
    for (const effect of result.effects) {
      if (effect.type === 'draw' && effect.playerId) {
        // Same ordering contract as the play_card handler: player_drew (with
        // causedBy) first, then the victim's hand_updated
        io.to(roomCode).emit('player_drew', { playerId: effect.playerId, count: effect.count, causedBy: currentId });
        sendHandTo(effect.playerId);
      }
      if (effect.type === 'skip') {
        io.to(roomCode).emit('turn_skipped', { playerId: effect.playerId });
      }
      if (effect.type === 'reverse') {
        io.to(roomCode).emit('direction_changed', { direction: effect.direction });
      }
    }
    const drawEffect = result.effects.find(e => e.type === 'draw');
    io.to(roomCode).emit('card_effect', {
      cardType: card.type,
      cardColor: card.color,
      chosenColor: chosenColor || null,
      playedBy: currentId,
      targetPlayerId: drawEffect ? drawEffect.playerId : null,
    });
    broadcastGameState(roomCode);
    saveStateSoon();

    // Bot UNO etiquette: call UNO after a beat — humans get a window to catch it,
    // and sometimes (15%) the bot "forgets" entirely and can be caught.
    if (isBot && !result.winner && gs.hands[currentId] && gs.hands[currentId].length === 1) {
      if (Math.random() > 0.15) {
        setTimeout(() => {
          const room2 = roomManager.getRoom(roomCode);
          if (!room2 || !room2.gameState) return;
          const res = gameLogic.callUno(room2.gameState, currentId);
          if (res.success) io.to(roomCode).emit('uno_called', { playerId: currentId });
        }, 1200 + Math.floor(Math.random() * 1200));
      }
    }

    if (result.winner) {
      const winner = r.players.find(p => p.id === result.winner);
      io.to(roomCode).emit('player_won', {
        playerId: result.winner,
        nickname: winner ? winner.nickname : 'Unknown',
      });
    }
    return true;
  };

  // ── Case 1: Pending forced draw (draw2/wild4/wild8 stack) ──
  if (gs.pendingDraw > 0) {
    // Bots stack back when they can instead of eating the cards
    if (isBot && gs.settings.stacking) {
      const stackCard = hand.find(c => c.type === gs.pendingDrawType);
      if (stackCard) {
        const chosenColor = stackCard.color === 'wild' ? bestWildColor(hand) : undefined;
        if (playCardAs(stackCard, chosenColor)) return;
      }
    }
    const result = gameLogic.playerDrawCard(gs, currentId);
    if (!result.error) {
      sendHandTo(currentId);
      io.to(roomCode).emit('player_drew', { playerId: currentId, count: result.drawn?.length || 1 });
      // playerDrawCard with pendingDraw already calls advanceTurn internally
      broadcastGameState(roomCode);
    }
    return;
  }

  // ── Case 2: Find a card playable under current game rules ──
  const playable = hand.filter(card => {
    if (card.color === 'wild') return true;
    if (card.color === gs.activeColor) return true;
    const top = gs.discardPile[gs.discardPile.length - 1];
    if (top && card.type === 'number' && top.type === 'number' && card.value === top.value) return true;
    if (top && card.type !== 'number' && card.type === top.type) return true;
    return false;
  });

  if (playable.length > 0) {
    // Prefer non-wild cards to conserve wilds
    const card = playable.find(c => c.color !== 'wild') || playable[0];
    const chosenColor = card.color === 'wild'
      ? (isBot ? bestWildColor(hand) : gameLogic.COLORS[Math.floor(Math.random() * 4)])
      : undefined;
    if (playCardAs(card, chosenColor)) return;
  }

  // ── Case 3: No playable card — draw 1, play it if possible (bots), else pass ──
  const drawResult = gameLogic.playerDrawCard(gs, currentId);
  if (!drawResult.error) {
    sendHandTo(currentId);
    io.to(roomCode).emit('player_drew', { playerId: currentId, count: drawResult.drawn?.length || 1 });

    // Must explicitly pass turn after drawing (turn doesn't auto-advance for normal draw)
    gameLogic.passTurn(gs, currentId);
    broadcastGameState(roomCode);
  }
}

function resetAutoPlayTimer(roomCode) {
  clearTimeout(_autoPlayTimers[roomCode]);

  const room = roomManager.getRoom(roomCode);
  if (!room || !room.gameState || room.gameState.winner) return;

  const currentId = gameLogic.getCurrentPlayerId(room.gameState);
  if (!currentId) return;

  // While clients are still running the deal animation, hold every auto-play
  // past its end — this also covers re-arms caused by a human acting mid-deal
  const dealHold = Math.max(0, (room.dealEndsAt || 0) - Date.now());
  const isBot = isBotPlayer(room, currentId);
  const delay = dealHold + (isBot ? botDelayMs() : AFK_TIMEOUT_MS);

  _autoPlayTimers[roomCode] = setTimeout(() => {
    const r = roomManager.getRoom(roomCode);
    if (!r || !r.gameState || r.gameState.winner) return;
    if (gameLogic.getCurrentPlayerId(r.gameState) !== currentId) return;

    if (!isBot) {
      const nickname = r.players.find(p => p.id === currentId)?.nickname || 'A player';
      console.log(`[auto-play] Acting for idle player ${currentId} (${nickname}) in ${roomCode}`);
      // Notify all clients this is an AFK move
      io.to(roomCode).emit('afk_action', { playerId: currentId, nickname });
    }

    performAutoAction(roomCode, currentId, { isBot });
  }, delay);
}


function sendHandToPlayer(socket, playerId, gameState) {
  const hand = gameState.hands[playerId] || [];
  socket.emit('hand_updated', { cards: hand });
}

function getSocketById(socketId) {
  return io.sockets.sockets.get(socketId);
}

// ─── Socket.io Events ────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // ── Ping Measurement ──
  socket.on('ping_measure', () => {
    socket.emit('pong_measure');
  });

  // ── Browse Rooms ──
  socket.on('browse_rooms', (callback) => {
    const publicRooms = roomManager.getPublicRooms();
    callback({ rooms: publicRooms });
  });

  // ── Create Room ──
  socket.on('create_room', ({ nickname, isPrivate }, callback) => {
    if (!nickname || nickname.trim().length === 0) {
      return callback({ error: 'Nickname is required' });
    }
    const name = nickname.trim().substring(0, 16);
    const { roomCode, playerId, player } = roomManager.createRoom(name, { isPrivate: !!isPrivate });
    roomManager.setPlayerSocket(roomCode, playerId, socket.id);

    socket.join(roomCode);
    socket.data = { roomCode, playerId };

    callback({ roomCode, playerId, nickname: player.nickname });
    broadcastRoomUpdate(roomCode);
    saveStateSoon(); // Save after room creation
  });

  // ── Join Room ──
  socket.on('join_room', ({ roomCode, nickname, playerId: existingPlayerId, spectator, godPassword }, callback) => {
    if (!nickname || nickname.trim().length === 0) {
      return callback({ error: 'Nickname is required' });
    }
    if (!roomCode || roomCode.trim().length === 0) {
      return callback({ error: 'Room code is required' });
    }
    const code = roomCode.trim().toUpperCase();
    const name = nickname.trim().substring(0, 16);
    const result = roomManager.joinRoom(code, name, existingPlayerId, { spectator, godPassword });

    if (result.error) {
      console.log(`[join] Failed for ${name}: ${result.error}`);
      return callback({ error: result.error, canSpectate: result.canSpectate });
    }

    const { playerId, player, room, reconnected } = result;

    if (reconnected) {
      console.log(`[reconnect] ${name} (${playerId}) rejoined ${code}`);
    } else {
      console.log(`[join] ${name} (${playerId}) joined ${code}`);
    }
    roomManager.setPlayerSocket(code, playerId, socket.id);
    roomManager.cancelRoomCleanup(code);

    socket.join(code);
    socket.data = { roomCode: code, playerId };

    const players = room.players.map(p => ({
      id: p.id,
      nickname: p.nickname,
      connected: p.connected,
      isBot: !!p.isBot,
    }));

    callback({
      success: true,
      playerId,
      nickname: player.nickname,
      players,
      settings: room.settings,
      hostId: room.hostId,
      reconnected: !!reconnected,
      gameInProgress: room.status === 'playing',
      isSpectator: !!player.isSpectator,
      isGodMode: !!player.isGodMode,
    });

    broadcastRoomUpdate(code);
    if (!reconnected) saveStateSoon(); // Save after new player joins

    // If reconnecting/spectating an in-progress game, send game state + hand
    if ((reconnected || player.isSpectator) && room.status === 'playing' && room.gameState) {
      socket.emit('game_state', gameLogic.getPublicState(room.gameState));
      if (!player.isSpectator) {
        sendHandToPlayer(socket, playerId, room.gameState);
      } else if (player.isGodMode) {
        socket.emit('god_hands', room.gameState.hands);
      }
    }
  });

  // ── Kick Player ──
  socket.on('kick_player', ({ roomCode, targetPlayerId }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return;

    if (socket.data?.playerId !== room.hostId) {
      return socket.emit('error', { message: 'Only host can kick players' });
    }

    if (targetPlayerId === room.hostId) {
      return socket.emit('error', { message: 'Cannot kick yourself' });
    }

    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer) {
      return socket.emit('error', { message: 'Player not found' });
    }

    const wasPlaying = room.status === 'playing' && !!room.gameState;
    const nickname = targetPlayer.nickname;

    // ── Step 1: Find and evict the target socket BEFORE removing from room ──
    let targetSocketId = null;
    const clients = io.sockets.adapter.rooms.get(roomCode);
    if (clients) {
      for (const clientId of clients) {
        const cs = io.sockets.sockets.get(clientId);
        if (cs && cs.data?.playerId === targetPlayerId) {
          targetSocketId = clientId;
          break;
        }
      }
    }
    if (targetSocketId) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('kicked_from_room');  // tell client first
        targetSocket.leave(roomCode);
        targetSocket.data = {};
      }
    }

    // ── Step 2: Remove from game state (if game is live) ──
    let kickWinner = null;
    if (wasPlaying) {
      clearTimeout(_autoPlayTimers[roomCode]); // stop auto-play for kicked player
      const kickResult = gameLogic.removePlayerFromGame(room.gameState, targetPlayerId);
      if (!kickResult.notInGame) {
        kickWinner = kickResult.winner; // null = game continues, string = winner id
      }
    }

    // ── Step 3: Permanently remove from room (no reconnect window) ──
    roomManager.forceRemovePlayer(roomCode, targetPlayerId);

    // ── Step 4: Notify remaining players ──
    io.to(roomCode).emit('player_kicked', { nickname, playerId: targetPlayerId });
    console.log(`[kick] ${nickname} (${targetPlayerId}) kicked from ${roomCode} (status: ${room.status})`);

    if (!wasPlaying) {
      // Lobby kick — just refresh the player list
      broadcastRoomUpdate(roomCode);
      return;
    }

    // ── Step 5: Game was active ──
    if (kickWinner) {
      // Only 1 player left — they win
      const winner = room.players.find(p => p.id === kickWinner);
      io.to(roomCode).emit('player_won', {
        playerId: kickWinner,
        nickname: winner ? winner.nickname : 'Unknown',
      });
      // End the game properly
      clearTimeout(_autoPlayTimers[roomCode]);
      room.status = 'lobby';
      broadcastRoomUpdate(roomCode);
    } else {
      // Game continues with remaining players
      broadcastGameState(roomCode);
      broadcastRoomUpdate(roomCode);
    }
  });

  // ── Leave Room (voluntary) ──
  socket.on('leave_room', ({ roomCode }, callback) => {
    const playerId = socket.data?.playerId;
    if (!playerId) return callback?.({ error: 'Not in a room' });

    const room = roomManager.getRoom(roomCode);
    if (!room) return callback?.({ error: 'Room not found' });

    const player = room.players.find(p => p.id === playerId);
    const spectator = room.spectators?.find(p => p.id === playerId);

    if (!player && !spectator) {
      return callback?.({ error: 'Not a member of this room' });
    }

    const nickname = player?.nickname || spectator?.nickname || 'Player';

    // ── Surrender: leaving during an active game ──
    // Mirror the kick flow: pull them out of the game state (their hand is
    // reshuffled into the draw pile), free their slot immediately (no
    // reconnect window — they quit on purpose), and the game continues.
    const isActiveGamePlayer = room.status === 'playing' && room.gameState &&
      player && room.gameState.playerIds.includes(playerId);

    if (isActiveGamePlayer) {
      clearTimeout(_autoPlayTimers[roomCode]);
      const result = gameLogic.removePlayerFromGame(room.gameState, playerId);

      roomManager.forceRemovePlayer(roomCode, playerId);
      socket.leave(roomCode);
      socket.data = {};

      io.to(roomCode).emit('player_left', { nickname, playerId, surrendered: true });
      console.log(`[surrender] ${nickname} (${playerId}) surrendered in ${roomCode}`);

      if (result.winner) {
        // Only one player left standing — they win
        const winner = room.players.find(p => p.id === result.winner);
        io.to(roomCode).emit('player_won', {
          playerId: result.winner,
          nickname: winner ? winner.nickname : 'Unknown',
        });
        clearTimeout(_autoPlayTimers[roomCode]);
        room.status = 'lobby';
        broadcastRoomUpdate(roomCode);
      } else {
        // broadcastGameState also reschedules the auto-play/bot timer
        broadcastGameState(roomCode);
        broadcastRoomUpdate(roomCode);
      }

      return callback?.({ success: true });
    }

    // ── Normal leave (lobby, or a spectator) ──
    roomManager.removePlayer(roomCode, playerId);

    // Leave socket room
    socket.leave(roomCode);
    socket.data = {};

    // Notify others
    io.to(roomCode).emit('player_left', { nickname });
    broadcastRoomUpdate(roomCode);

    console.log(`[leave] ${nickname} (${playerId}) voluntarily left ${roomCode}`);

    callback?.({ success: true });
  });

  // ── Add Bot (host only, lobby only) ──
  socket.on('add_bot', ({ roomCode }, callback) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return callback?.({ error: 'Room not found' });
    if (socket.data?.playerId !== room.hostId) return callback?.({ error: 'Only host can add bots' });

    const result = roomManager.addBot(roomCode);
    if (result.error) return callback?.({ error: result.error });

    console.log(`[bot] ${result.player.nickname} added to ${roomCode}`);
    broadcastRoomUpdate(roomCode);
    callback?.({ success: true, botId: result.player.id, nickname: result.player.nickname });
  });

  // ── Toggle Stacking ──
  socket.on('toggle_stacking', ({ roomCode, enabled }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (room.status !== 'lobby') return socket.emit('error', { message: 'Cannot change settings during game' });
    if (socket.data?.playerId !== room.hostId) return socket.emit('error', { message: 'Only host can change settings' });

    room.settings.stacking = !!enabled;
    broadcastRoomUpdate(roomCode);
  });

  // ── Reorder Players (host only, lobby only) ──
  socket.on('reorder_players', ({ roomCode, order }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return socket.emit('error', { message: 'Room not found' });
    if (room.status !== 'lobby') return socket.emit('error', { message: 'Cannot reorder during game' });
    if (socket.data?.playerId !== room.hostId) return socket.emit('error', { message: 'Only host can reorder players' });
    if (!Array.isArray(order)) return;

    // Build a lookup map and reorder, ignoring unknown IDs
    const map = new Map(room.players.map(p => [p.id, p]));
    const reordered = order.map(id => map.get(id)).filter(Boolean);
    // Append any players not in the order array (safety net)
    room.players.forEach(p => { if (!order.includes(p.id)) reordered.push(p); });
    room.players = reordered;

    broadcastRoomUpdate(roomCode);
  });

  // ── Start Game ──
  socket.on('start_game', ({ roomCode }, callback) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return callback?.({ error: 'Room not found' });
    if (socket.data?.playerId !== room.hostId) return callback?.({ error: 'Only host can start the game' });
    if (room.players.length < 2) return callback?.({ error: 'Need at least 2 players' });
    if (room.status === 'playing') return callback?.({ error: 'Game already in progress' });

    room.status = 'playing';
    const activePlayers = room.players.filter(p => p.connected);
    room.gameState = gameLogic.initGame(activePlayers, room.settings);

    // Send each player their private hand
    for (const player of activePlayers) {
      const sock = getSocketById(player.socketId);
      if (sock) {
        sendHandToPlayer(sock, player.id, room.gameState);
      }
    }

    // Broadcast game started + initial public state
    const publicState = gameLogic.getPublicState(room.gameState);
    io.to(roomCode).emit('game_started', {
      ...publicState,
      playerOrder: activePlayers.map(p => ({ id: p.id, nickname: p.nickname })),
      settings: room.settings,
    });

    callback?.({ success: true });
    saveStateSoon(); // Save after game starts

    // Arm the turn timer — if the first player is a bot this kicks off its
    // move, and if a human goes AFK on turn one the 30s fallback works.
    // dealEndsAt makes resetAutoPlayTimer wait out the clients' deal animation.
    room.dealEndsAt = Date.now() + dealAnimationMs(activePlayers.length);
    resetAutoPlayTimer(roomCode);
  });

  // ── Play Card ──
  socket.on('play_card', ({ roomCode, cardId, chosenColor }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.gameState) return socket.emit('error', { message: 'No active game' });

    const playerId = socket.data?.playerId;

    if (!acquireRoomLock(roomCode)) return;
    const result = gameLogic.playCard(room.gameState, playerId, cardId, chosenColor);
    releaseRoomLock(roomCode);

    if (result.error) {
      return socket.emit('error', { message: result.error });
    }

    // Send updated hand to the player who played
    sendHandToPlayer(socket, playerId, room.gameState);

    // If effects caused other players to draw, send them updated hands.
    // player_drew goes out BEFORE hand_updated: it carries causedBy, which the
    // client uses to delay the draw animation until the +card play is visible.
    for (const effect of result.effects) {
      if (effect.type === 'draw' && effect.playerId) {
        io.to(roomCode).emit('player_drew', { playerId: effect.playerId, count: effect.count, causedBy: playerId });
        const targetPlayer = room.players.find(p => p.id === effect.playerId);
        if (targetPlayer) {
          const targetSock = getSocketById(targetPlayer.socketId);
          if (targetSock) {
            sendHandToPlayer(targetSock, effect.playerId, room.gameState);
          }
        }
      }
      if (effect.type === 'skip') {
        io.to(roomCode).emit('turn_skipped', { playerId: effect.playerId });
      }
      if (effect.type === 'reverse') {
        io.to(roomCode).emit('direction_changed', { direction: effect.direction });
      }
    }

    // Emit card effect for animations — include target of draw effects
    const drawEffect = result.effects.find(e => e.type === 'draw');
    io.to(roomCode).emit('card_effect', {
      cardType: result.card.type,
      cardColor: result.card.color,
      chosenColor: chosenColor || null,
      playedBy: playerId,
      targetPlayerId: drawEffect ? drawEffect.playerId : null,
    });

    // Broadcast updated game state
    broadcastGameState(roomCode);
    saveStateSoon(); // Save after card played

    // Check for UNO trigger
    const hand = room.gameState.hands[playerId];
    if (hand && hand.length === 1) {
      socket.emit('uno_trigger', {}); // tell this player to press UNO
    }

    // Check for winner
    if (result.winner) {
      const winner = room.players.find(p => p.id === result.winner);
      io.to(roomCode).emit('player_won', {
        playerId: result.winner,
        nickname: winner ? winner.nickname : 'Unknown',
      });
    }
  });

  // ── Draw Card ──
  socket.on('draw_card', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.gameState) return socket.emit('error', { message: 'No active game' });

    const playerId = socket.data?.playerId;

    // Serialize concurrent events — silently drop duplicate actions
    if (!acquireRoomLock(roomCode)) return;

    const result = gameLogic.playerDrawCard(room.gameState, playerId);
    releaseRoomLock(roomCode);

    if (result.error) {
      return socket.emit('error', { message: result.error });
    }

    // Send updated hand to the player who drew
    sendHandToPlayer(socket, playerId, room.gameState);
    // Notify everyone of the draw (include mustPass so client shows Pass button)
    io.to(roomCode).emit('player_drew', {
      playerId,
      count: result.count,
      forced: result.forced || false,
      mustPass: result.mustPass || false,
    });
    broadcastGameState(roomCode);
  });

  // ── Pass Turn (player passes after drawing) ──
  socket.on('pass_turn', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.gameState) return socket.emit('error', { message: 'No active game' });

    const playerId = socket.data?.playerId;

    if (!acquireRoomLock(roomCode)) return;
    const result = gameLogic.passTurn(room.gameState, playerId);
    releaseRoomLock(roomCode);

    if (result.error) {
      return socket.emit('error', { message: result.error });
    }

    broadcastGameState(roomCode);
  });

  // ── Call UNO ──
  socket.on('call_uno', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.gameState) return;

    const playerId = socket.data?.playerId;
    const result = gameLogic.callUno(room.gameState, playerId);
    if (result.success) {
      io.to(roomCode).emit('uno_called', { playerId });
    }
  });

  // ── Catch UNO ──
  socket.on('catch_uno', ({ roomCode, targetPlayerId }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.gameState) return;

    const catcherId = socket.data?.playerId;
    const result = gameLogic.catchUno(room.gameState, catcherId, targetPlayerId);

    if (result.success) {
      io.to(roomCode).emit('uno_caught', {
        catcherId,
        targetId: result.targetId,
        penaltyCount: result.drawn.length,
      });
      // Send updated hand to the caught player
      const targetPlayer = room.players.find(p => p.id === result.targetId);
      if (targetPlayer) {
        const targetSock = getSocketById(targetPlayer.socketId);
        if (targetSock) {
          sendHandToPlayer(targetSock, result.targetId, room.gameState);
        }
      }
      broadcastGameState(roomCode);
    }
  });

  // ── Restart Game ──
  socket.on('restart_game', ({ roomCode }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room) return;
    if (socket.data?.playerId !== room.hostId) {
      return socket.emit('error', { message: 'Only host can restart' });
    }

    clearTimeout(_autoPlayTimers[roomCode]);
    releaseRoomLock(roomCode); // clear any stale lock from previous round
    room.status = 'lobby';
    room.gameState = null;

    io.to(roomCode).emit('game_restarted', {});
    broadcastRoomUpdate(roomCode);
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    const info = roomManager.getPlayerBySocket(socket.id);
    if (!info) return;

    const { roomCode, player } = info;
    // Mark as disconnected but keep in room (allows reconnection on refresh)
    player.connected = false;
    player.socketId = null;
    broadcastRoomUpdate(roomCode);

    // Schedule room cleanup after 2 minutes if no one reconnects
    roomManager.scheduleRoomCleanup(roomCode, 120000);
  });
});

// ─── State Persistence ────────────────────────────────────────────────────────

// Load saved state on startup
const savedRooms = statePersistence.loadState();
let restoredRoomCount = 0;
if (savedRooms) {
  // Restore rooms into roomManager
  for (const [code, room] of savedRooms) {
    roomManager.rooms.set(code, room);
    restoredRoomCount++;
  }
  // Cleanup old rooms (older than 24 hours)
  statePersistence.cleanupOldRooms(roomManager.rooms);
  // Save cleaned state
  statePersistence.saveState(roomManager.rooms);
  console.log(`[persistence] Restored ${restoredRoomCount} room(s) - players can reconnect`);

  // Re-arm turn timers for restored in-progress games — otherwise a game whose
  // current player is a bot (or AFK) would sit frozen until someone acted.
  // Also start the cleanup clock: every restored room has zero connected humans,
  // so if nobody rejoins within the window the room is garbage-collected
  // (join_room cancels the timer on the first human reconnect).
  for (const [code, room] of roomManager.rooms) {
    roomManager.scheduleRoomCleanup(code);
    if (room.status === 'playing' && room.gameState && !room.gameState.winner) {
      resetAutoPlayTimer(code);
    }
  }
}

// Auto-save every 30 seconds
const SAVE_INTERVAL_MS = 30_000;
const saveInterval = setInterval(() => {
  if (roomManager.rooms.size > 0) {
    statePersistence.saveState(roomManager.rooms);
  }
}, SAVE_INTERVAL_MS);

// Helper: save state immediately on critical events
function saveStateSoon() {
  // Debounced save to avoid hammering disk on rapid events
  clearTimeout(saveStateSoon._timer);
  saveStateSoon._timer = setTimeout(() => {
    statePersistence.saveState(roomManager.rooms);
  }, 2000); // 2-second debounce
}

// Graceful shutdown: save state before exit
function gracefulShutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  clearInterval(saveInterval);
  statePersistence.saveState(roomManager.rooms);
  server.close(() => {
    console.log('[shutdown] HTTP server closed');
    process.exit(0);
  });
  // Force exit after 5 seconds if server doesn't close
  setTimeout(() => {
    console.error('[shutdown] Forcing exit after timeout');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ─── Start Server ─────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`🃏 UNO server running on http://localhost:${PORT}`);
});
