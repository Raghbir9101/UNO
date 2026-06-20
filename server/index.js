// ─── Express + Socket.io Server ───────────────────────────────────────────────
// Serves the public directory and handles all real-time game events.
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();
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

  // Monotonically-increasing sequence number — clients use this to reject stale events
  room.updateSeq = (room.updateSeq || 0) + 1;

  const players = room.players.map(p => ({
    id: p.id,
    nickname: p.nickname,
    connected: p.connected,
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

// ─── Auto-play: play for idle player after 30 seconds ────────────────────────
const _autoPlayTimers = {};  // roomCode → timeout handle

function resetAutoPlayTimer(roomCode) {
  clearTimeout(_autoPlayTimers[roomCode]);

  const room = roomManager.getRoom(roomCode);
  if (!room || !room.gameState || room.gameState.winner) return;

  const currentId = gameLogic.getCurrentPlayerId(room.gameState);
  if (!currentId) return;

  _autoPlayTimers[roomCode] = setTimeout(() => {
    const r = roomManager.getRoom(roomCode);
    if (!r || !r.gameState || r.gameState.winner) return;
    if (gameLogic.getCurrentPlayerId(r.gameState) !== currentId) return;

    const gs = r.gameState;
    const hand = gs.hands[currentId] || [];
    const nickname = r.players.find(p => p.id === currentId)?.nickname || 'A player';

    console.log(`[auto-play] Acting for idle player ${currentId} (${nickname}) in ${roomCode}`);

    // Notify all clients this is an AFK move
    io.to(roomCode).emit('afk_action', { playerId: currentId, nickname });

    // ── Case 1: Player has a pending forced draw (draw2/wild4/wild8 stack) ──
    if (gs.pendingDraw > 0) {
      const result = gameLogic.playerDrawCard(gs, currentId);
      if (!result.error) {
        // Send updated hand to the player
        const p = r.players.find(pl => pl.id === currentId);
        if (p && p.socketId) {
          const sock = getSocketById(p.socketId);
          if (sock) sendHandToPlayer(sock, currentId, gs);
        }
        io.to(roomCode).emit('player_drew', { playerId: currentId, count: result.drawn?.length || 1 });
        // playerDrawCard with pendingDraw already calls advanceTurn internally
        broadcastGameState(roomCode);
      }
      return;
    }

    // ── Case 2: Find a card playable under current game rules ──
    // Use the same isPlayable logic: match color, type, or value
    const playable = hand.filter(card => {
      if (gs.pendingDraw > 0 && gs.settings.stacking) {
        return card.type === gs.pendingDrawType;
      }
      if (card.color === 'wild') return gs.pendingDraw === 0 || !gs.settings.stacking;
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
        ? gameLogic.COLORS[Math.floor(Math.random() * 4)]
        : undefined;
      const result = gameLogic.playCard(gs, currentId, card.id, chosenColor);
      if (!result.error) {
        const p = r.players.find(pl => pl.id === currentId);
        if (p && p.socketId) {
          const sock = getSocketById(p.socketId);
          if (sock) sendHandToPlayer(sock, currentId, gs);
        }
        for (const effect of result.effects) {
          if (effect.type === 'draw' && effect.playerId) {
            const tp = r.players.find(pl => pl.id === effect.playerId);
            if (tp && tp.socketId) {
              const ts = getSocketById(tp.socketId);
              if (ts) sendHandToPlayer(ts, tp.id, gs);
            }
          }
        }
        io.to(roomCode).emit('card_effect', { cardType: card.type, chosenColor });
        broadcastGameState(roomCode);
      }
      return;
    }

    // ── Case 3: No playable card — draw 1 then pass ──
    const drawResult = gameLogic.playerDrawCard(gs, currentId);
    if (!drawResult.error) {
      const p = r.players.find(pl => pl.id === currentId);
      if (p && p.socketId) {
        const sock = getSocketById(p.socketId);
        if (sock) sendHandToPlayer(sock, currentId, gs);
      }
      io.to(roomCode).emit('player_drew', { playerId: currentId, count: drawResult.drawn?.length || 1 });

      // Must explicitly pass turn after drawing (turn doesn't auto-advance for normal draw)
      gameLogic.passTurn(gs, currentId);
      broadcastGameState(roomCode);
    }
  }, 30000); // 30 seconds
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
      return callback({ error: result.error, canSpectate: result.canSpectate });
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
      isSpectator: !!player.isSpectator,
      isGodMode: !!player.isGodMode,
    });

    broadcastRoomUpdate(code);

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
    if (room.status !== 'lobby') return;
    if (socket.data?.playerId !== room.hostId) return; // Only host can kick
    if (targetPlayerId === room.hostId) return; // Can't kick self

    const targetPlayer = room.players.find(p => p.id === targetPlayerId);
    if (!targetPlayer) return;

    // Find the target socket
    let targetSocketId = null;
    if (room.socketMap && room.socketMap[targetPlayerId]) {
      targetSocketId = room.socketMap[targetPlayerId];
    } else {
      // Fallback: Find target socket via connected clients in the room
      const clients = io.sockets.adapter.rooms.get(roomCode);
      if (clients) {
        for (const clientId of clients) {
          const clientSocket = io.sockets.sockets.get(clientId);
          if (clientSocket && clientSocket.data?.playerId === targetPlayerId) {
            targetSocketId = clientId;
            break;
          }
        }
      }
    }

    roomManager.removePlayer(roomCode, targetPlayerId);

    if (targetSocketId) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.leave(roomCode);
        targetSocket.data = {};
        targetSocket.emit('kicked_from_room');
      }
    }

    io.to(roomCode).emit('player_kicked', { nickname: targetPlayer.nickname });
    broadcastRoomUpdate(roomCode);
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
    const result = gameLogic.passTurn(room.gameState, playerId);

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
    player.socketId  = null;
    broadcastRoomUpdate(roomCode);

    // Schedule room cleanup after 2 minutes if no one reconnects
    roomManager.scheduleRoomCleanup(roomCode, 120000);
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`🃏 UNO server running on http://localhost:${PORT}`);
});
