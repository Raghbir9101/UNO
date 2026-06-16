// ─── Express + Socket.io Server ───────────────────────────────────────────────
// Serves the public directory and handles all real-time game events.
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const roomManager = require('./roomManager');
const gameLogic = require('./gameLogic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3000;

// Disable caching for development
app.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Serve static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Helper: broadcast room player list ───────────────────────────────────────

function broadcastRoomUpdate(roomCode) {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;

  const players = room.players.map(p => ({
    id: p.id,
    nickname: p.nickname,
    connected: p.connected,
  }));

  io.to(roomCode).emit('room_updated', {
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

  // ── Create Room ──
  socket.on('create_room', ({ nickname }, callback) => {
    if (!nickname || nickname.trim().length === 0) {
      return callback({ error: 'Nickname is required' });
    }
    const name = nickname.trim().substring(0, 16);
    const { roomCode, playerId, player } = roomManager.createRoom(name);
    roomManager.setPlayerSocket(roomCode, playerId, socket.id);

    socket.join(roomCode);
    socket.data = { roomCode, playerId };

    callback({ roomCode, playerId, nickname: player.nickname });
    broadcastRoomUpdate(roomCode);
  });

  // ── Join Room ──
  socket.on('join_room', ({ roomCode, nickname }, callback) => {
    if (!nickname || nickname.trim().length === 0) {
      return callback({ error: 'Nickname is required' });
    }
    if (!roomCode || roomCode.trim().length === 0) {
      return callback({ error: 'Room code is required' });
    }
    const code = roomCode.trim().toUpperCase();
    const name = nickname.trim().substring(0, 16);
    const result = roomManager.joinRoom(code, name);

    if (result.error) {
      return callback({ error: result.error });
    }

    const { playerId, player, room, reconnected } = result;
    roomManager.setPlayerSocket(code, playerId, socket.id);
    roomManager.cancelRoomCleanup(code);

    socket.join(code);
    socket.data = { roomCode: code, playerId };

    const players = room.players.map(p => ({
      id: p.id,
      nickname: p.nickname,
      connected: p.connected,
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
    });

    broadcastRoomUpdate(code);

    // If reconnecting to an in-progress game, send game state + hand
    if (reconnected && room.status === 'playing' && room.gameState) {
      sendHandToPlayer(socket, playerId, room.gameState);
      socket.emit('game_state', gameLogic.getPublicState(room.gameState));
    }
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
    });

    callback?.({ success: true });
  });

  // ── Play Card ──
  socket.on('play_card', ({ roomCode, cardId, chosenColor }) => {
    const room = roomManager.getRoom(roomCode);
    if (!room || !room.gameState) return socket.emit('error', { message: 'No active game' });

    const playerId = socket.data?.playerId;
    const result = gameLogic.playCard(room.gameState, playerId, cardId, chosenColor);

    if (result.error) {
      return socket.emit('error', { message: result.error });
    }

    // Send updated hand to the player who played
    sendHandToPlayer(socket, playerId, room.gameState);

    // If effects caused other players to draw, send them updated hands
    for (const effect of result.effects) {
      if (effect.type === 'draw' && effect.playerId) {
        const targetPlayer = room.players.find(p => p.id === effect.playerId);
        if (targetPlayer) {
          const targetSock = getSocketById(targetPlayer.socketId);
          if (targetSock) {
            sendHandToPlayer(targetSock, effect.playerId, room.gameState);
          }
        }
        io.to(roomCode).emit('player_drew', { playerId: effect.playerId, count: effect.count });
      }
      if (effect.type === 'skip') {
        io.to(roomCode).emit('turn_skipped', { playerId: effect.playerId });
      }
      if (effect.type === 'reverse') {
        io.to(roomCode).emit('direction_changed', { direction: effect.direction });
      }
    }

    // Emit card effect for animations
    io.to(roomCode).emit('card_effect', {
      cardType: result.card.type,
      cardColor: result.card.color,
      playedBy: playerId,
    });

    // Broadcast updated game state
    broadcastGameState(roomCode);

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
    const result = gameLogic.playerDrawCard(room.gameState, playerId);

    if (result.error) {
      return socket.emit('error', { message: result.error });
    }

    // Send updated hand
    sendHandToPlayer(socket, playerId, room.gameState);
    io.to(roomCode).emit('player_drew', { playerId, count: result.count });
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
    roomManager.removePlayer(roomCode, player.id);
    broadcastRoomUpdate(roomCode);
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`🃏 UNO server running on http://localhost:${PORT}`);
});
