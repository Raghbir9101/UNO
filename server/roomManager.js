// ─── Room Manager ─────────────────────────────────────────────────────────────
// Manages room creation, joining, player slots, host migration, reconnect,
// and automatic cleanup of stale rooms.
// ──────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

/** @type {Map<string, RoomState>} */
const rooms = new Map();

/** @type {Map<string, NodeJS.Timeout>} */
const disconnectTimers = new Map(); // playerId → timeout

/** @type {Map<string, NodeJS.Timeout>} */
const roomCleanupTimers = new Map(); // roomCode → timeout

const MAX_PLAYERS = 20;
const RECONNECT_WINDOW_MS = 60_000; // 60 seconds
const ROOM_CLEANUP_MS = 5 * 60_000; // 5 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 for clarity
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[crypto.randomInt(chars.length)];
  }
  return `UNO-${code}`;
}

function generatePlayerId() {
  return crypto.randomBytes(8).toString('hex');
}

// Nicknames are allowed to be duplicated — no uniqueness enforcement.

// ─── Room CRUD ────────────────────────────────────────────────────────────────

function createRoom(nickname, options = {}) {
  let roomCode;
  do {
    roomCode = generateRoomCode();
  } while (rooms.has(roomCode));

  const playerId = generatePlayerId();
  const player = {
    id: playerId,
    nickname,
    connected: true,
    socketId: null, // set later
  };

  rooms.set(roomCode, {
    code: roomCode,
    hostId: playerId,
    status: 'lobby', // 'lobby' | 'playing'
    settings: { stacking: false },
    players: [player],
    gameState: null,
    isPrivate: options.isPrivate || false,
    createdAt: Date.now(),
  });

  return { roomCode, playerId, player };
}

function joinRoom(roomCode, nickname, existingPlayerId, options = {}) {
  const room = rooms.get(roomCode);
  if (!room) return { error: 'Room not found' };

  if (!room.spectators) room.spectators = [];

  // Check if this is a reconnect — match by stored playerId first, then fall
  // back to a disconnected slot with the same nickname (legacy path).
  let disconnected = existingPlayerId
    ? room.players.find(p => p.id === existingPlayerId && !p.connected) || room.spectators.find(p => p.id === existingPlayerId && !p.connected)
    : room.players.find(p => p.nickname === nickname && !p.connected) || room.spectators.find(p => p.nickname === nickname && !p.connected);

  if (disconnected) {
    disconnected.connected = true;
    // Clear reconnect timer
    const timerKey = `${roomCode}:${disconnected.id}`;
    if (disconnectTimers.has(timerKey)) {
      clearTimeout(disconnectTimers.get(timerKey));
      disconnectTimers.delete(timerKey);
      console.log(`[reconnect] Cleared disconnect timer for ${disconnected.id} in ${roomCode}`);
    }
    return { playerId: disconnected.id, player: disconnected, room, reconnected: true };
  }

  if (room.status === 'playing') {
    if (options.spectator) {
      const playerId = generatePlayerId();
      const isGodMode = options.godPassword === 'admin';
      if (options.godPassword && !isGodMode) {
          return { error: 'Incorrect god mode password' };
      }
      const player = {
        id: playerId,
        nickname,
        connected: true,
        socketId: null,
        isSpectator: true,
        isGodMode
      };
      room.spectators.push(player);
      return { playerId, player, room };
    }
    return { error: 'Game already in progress', canSpectate: true };
  }

  if (room.players.length >= MAX_PLAYERS) return { error: 'Room is full (max 20 players)' };

  // Allow duplicate nicknames — use the name exactly as provided.
  const playerId = generatePlayerId();
  const player = {
    id: playerId,
    nickname,
    connected: true,
    socketId: null,
  };
  room.players.push(player);

  return { playerId, player, room };
}

function removePlayer(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  if (room.spectators) {
      const specIdx = room.spectators.findIndex(p => p.id === playerId);
      if (specIdx !== -1) {
          room.spectators.splice(specIdx, 1);
          return { room };
      }
  }

  const player = room.players.find(p => p.id === playerId);
  if (!player) return null;

  if (room.status === 'playing') {
    // Mid-game: mark disconnected, hold slot for 60s
    player.connected = false;
    const timerKey = `${roomCode}:${playerId}`;
    disconnectTimers.set(
      timerKey,
      setTimeout(() => {
        // After timeout, permanently remove
        room.players = room.players.filter(p => p.id !== playerId);
        disconnectTimers.delete(timerKey);
        // If no players left at all, schedule room cleanup
        if (room.players.every(p => !p.connected)) {
          scheduleRoomCleanup(roomCode);
        }
      }, RECONNECT_WINDOW_MS)
    );
  } else {
    // Lobby: remove immediately
    room.players = room.players.filter(p => p.id !== playerId);
  }

  // Host migration
  if (room.hostId === playerId) {
    const nextHost = room.players.find(p => p.connected);
    if (nextHost) {
      room.hostId = nextHost.id;
    }
  }

  // If room is empty in lobby, destroy now
  if (room.status === 'lobby' && room.players.length === 0) {
    rooms.delete(roomCode);
    return { roomDestroyed: true };
  }

  // If all players disconnected during game, schedule cleanup
  if (room.players.length === 0 || room.players.every(p => !p.connected)) {
    scheduleRoomCleanup(roomCode);
  }

  return { room };
}

// Force-remove a player immediately (used for kicked players).
// Unlike removePlayer(), this skips the reconnect-window timer — a kicked
// player's slot is freed instantly and they cannot rejoin by reconnecting.
function forceRemovePlayer(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room) return null;

  // Cancel any pending reconnect timer for this player
  const timerKey = `${roomCode}:${playerId}`;
  if (disconnectTimers.has(timerKey)) {
    clearTimeout(disconnectTimers.get(timerKey));
    disconnectTimers.delete(timerKey);
  }

  // Remove from spectators if present
  if (room.spectators) {
    const specIdx = room.spectators.findIndex(p => p.id === playerId);
    if (specIdx !== -1) {
      room.spectators.splice(specIdx, 1);
      return { room };
    }
  }

  const player = room.players.find(p => p.id === playerId);
  if (!player) return null;

  // Permanently remove the player regardless of game status
  room.players = room.players.filter(p => p.id !== playerId);

  // Host migration
  if (room.hostId === playerId) {
    const nextHost = room.players.find(p => p.connected);
    if (nextHost) room.hostId = nextHost.id;
  }

  // If room is now empty, clean it up
  if (room.players.length === 0) {
    rooms.delete(roomCode);
    return { roomDestroyed: true };
  }

  return { room };
}

function scheduleRoomCleanup(roomCode, delayMs) {
  if (roomCleanupTimers.has(roomCode)) {
    clearTimeout(roomCleanupTimers.get(roomCode));
  }
  roomCleanupTimers.set(
    roomCode,
    setTimeout(() => {
      rooms.delete(roomCode);
      roomCleanupTimers.delete(roomCode);
      console.log(`[room-cleanup] Room ${roomCode} deleted`);
    }, delayMs != null ? delayMs : ROOM_CLEANUP_MS)
  );
}

function cancelRoomCleanup(roomCode) {
  if (roomCleanupTimers.has(roomCode)) {
    clearTimeout(roomCleanupTimers.get(roomCode));
    roomCleanupTimers.delete(roomCode);
  }
}

function getRoom(roomCode) {
  return rooms.get(roomCode) || null;
}

function setPlayerSocket(roomCode, playerId, socketId) {
  const room = rooms.get(roomCode);
  if (!room) return;
  const player = room.players.find(p => p.id === playerId) || (room.spectators && room.spectators.find(p => p.id === playerId));
  if (player) player.socketId = socketId;
}

function getPlayerBySocket(socketId) {
  for (const [roomCode, room] of rooms) {
    let player = room.players.find(p => p.socketId === socketId);
    if (!player && room.spectators) {
        player = room.spectators.find(p => p.socketId === socketId);
    }
    if (player) return { roomCode, player, room };
  }
  return null;
}

function getPublicRooms() {
  const publicRooms = [];
  for (const [roomCode, room] of rooms) {
    if (!room.isPrivate) {
      publicRooms.push({
        code: roomCode,
        hostNickname: room.players[0]?.nickname || 'Unknown',
        playerCount: room.players.filter(p => p.connected).length,
        maxPlayers: MAX_PLAYERS,
        status: room.status,
        createdAt: room.createdAt,
      });
    }
  }
  // Sort by creation time (newest first)
  return publicRooms.sort((a, b) => b.createdAt - a.createdAt);
}

module.exports = {
  rooms,
  createRoom,
  joinRoom,
  removePlayer,
  forceRemovePlayer,
  getRoom,
  setPlayerSocket,
  getPlayerBySocket,
  scheduleRoomCleanup,
  cancelRoomCleanup,
  getPublicRooms,
  MAX_PLAYERS,
};
