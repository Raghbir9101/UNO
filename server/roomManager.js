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

function uniqueNickname(nickname, players) {
  const existing = players.map(p => p.nickname);
  if (!existing.includes(nickname)) return nickname;
  let n = 2;
  while (existing.includes(`${nickname}#${n}`)) n++;
  return `${nickname}#${n}`;
}

// ─── Room CRUD ────────────────────────────────────────────────────────────────

function createRoom(nickname) {
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
  });

  return { roomCode, playerId, player };
}

function joinRoom(roomCode, nickname) {
  const room = rooms.get(roomCode);
  if (!room) return { error: 'Room not found' };

  // Check if this is a reconnect (same nickname in the room, disconnected)
  const disconnected = room.players.find(
    p => p.nickname === nickname && !p.connected
  );
  if (disconnected) {
    disconnected.connected = true;
    // Clear reconnect timer
    const timerKey = `${roomCode}:${disconnected.id}`;
    if (disconnectTimers.has(timerKey)) {
      clearTimeout(disconnectTimers.get(timerKey));
      disconnectTimers.delete(timerKey);
    }
    return { playerId: disconnected.id, player: disconnected, room, reconnected: true };
  }

  if (room.status === 'playing') return { error: 'Game already in progress' };
  if (room.players.length >= MAX_PLAYERS) return { error: 'Room is full (max 20 players)' };

  const safeName = uniqueNickname(nickname, room.players);
  const playerId = generatePlayerId();
  const player = {
    id: playerId,
    nickname: safeName,
    connected: true,
    socketId: null,
  };
  room.players.push(player);

  return { playerId, player, room };
}

function removePlayer(roomCode, playerId) {
  const room = rooms.get(roomCode);
  if (!room) return null;

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

function scheduleRoomCleanup(roomCode) {
  if (roomCleanupTimers.has(roomCode)) return; // already scheduled
  roomCleanupTimers.set(
    roomCode,
    setTimeout(() => {
      rooms.delete(roomCode);
      roomCleanupTimers.delete(roomCode);
    }, ROOM_CLEANUP_MS)
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
  const player = room.players.find(p => p.id === playerId);
  if (player) player.socketId = socketId;
}

function getPlayerBySocket(socketId) {
  for (const [roomCode, room] of rooms) {
    const player = room.players.find(p => p.socketId === socketId);
    if (player) return { roomCode, player, room };
  }
  return null;
}

module.exports = {
  rooms,
  createRoom,
  joinRoom,
  removePlayer,
  getRoom,
  setPlayerSocket,
  getPlayerBySocket,
  cancelRoomCleanup,
  MAX_PLAYERS,
};
