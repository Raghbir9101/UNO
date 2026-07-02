// ─── State Persistence ────────────────────────────────────────────────────────
// Saves and loads room state to/from disk to survive server restarts.
// Automatically saves every 30 seconds and on graceful shutdown.
// ──────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'data', 'game-state.json');
const BACKUP_FILE = path.join(__dirname, '..', 'data', 'game-state.backup.json');

// ─── Ensure data directory exists ─────────────────────────────────────────────

function ensureDataDir() {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── Save State ───────────────────────────────────────────────────────────────

function saveState(rooms) {
  try {
    ensureDataDir();

    // Convert Map to serializable object
    const roomsArray = Array.from(rooms.entries()).map(([code, room]) => ({
      code,
      hostId: room.hostId,
      status: room.status,
      settings: room.settings,
      players: room.players.map(p => ({
        id: p.id,
        nickname: p.nickname,
        connected: p.connected,
        isBot: !!p.isBot,
        // Don't persist socketId — it will be reassigned on reconnect
      })),
      spectators: room.spectators ? room.spectators.map(s => ({
        id: s.id,
        nickname: s.nickname,
        connected: s.connected,
        isSpectator: s.isSpectator,
        isGodMode: s.isGodMode,
      })) : [],
      gameState: room.gameState,
      isPrivate: room.isPrivate,
      createdAt: room.createdAt,
      updateSeq: room.updateSeq || 0,
    }));

    const state = {
      version: 1,
      savedAt: Date.now(),
      rooms: roomsArray,
    };

    const json = JSON.stringify(state, null, 2);

    // Atomic write: write to temp file, then rename
    const tempFile = STATE_FILE + '.tmp';
    fs.writeFileSync(tempFile, json, 'utf8');

    // Keep backup of previous state
    if (fs.existsSync(STATE_FILE)) {
      fs.copyFileSync(STATE_FILE, BACKUP_FILE);
    }

    fs.renameSync(tempFile, STATE_FILE);
    console.log(`[persistence] Saved state for ${roomsArray.length} room(s)`);
    return true;
  } catch (error) {
    console.error('[persistence] Failed to save state:', error.message);
    return false;
  }
}

// ─── Load State ───────────────────────────────────────────────────────────────

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      console.log('[persistence] No saved state found, starting fresh');
      return null;
    }

    const json = fs.readFileSync(STATE_FILE, 'utf8');
    const state = JSON.parse(json);

    if (state.version !== 1) {
      console.warn('[persistence] Unknown state version, ignoring');
      return null;
    }

    // Convert back to Map structure
    const rooms = new Map();
    for (const roomData of state.rooms) {
      // Restore players with disconnected status (they can reconnect).
      // Bots have no socket to reconnect — they come back alive immediately.
      const players = roomData.players.map(p => ({
        id: p.id,
        nickname: p.nickname,
        connected: !!p.isBot,
        socketId: null,
        isBot: !!p.isBot,
      }));

      const spectators = roomData.spectators ? roomData.spectators.map(s => ({
        id: s.id,
        nickname: s.nickname,
        connected: false,
        socketId: null,
        isSpectator: s.isSpectator,
        isGodMode: s.isGodMode,
      })) : [];

      rooms.set(roomData.code, {
        code: roomData.code,
        hostId: roomData.hostId,
        status: roomData.status,
        settings: roomData.settings,
        players,
        spectators,
        gameState: roomData.gameState,
        isPrivate: roomData.isPrivate,
        createdAt: roomData.createdAt,
        updateSeq: roomData.updateSeq || 0,
      });
    }

    const age = Date.now() - state.savedAt;
    const ageMinutes = Math.floor(age / 60000);
    console.log(`[persistence] Loaded ${rooms.size} room(s) from ${ageMinutes}m ago`);

    return rooms;
  } catch (error) {
    console.error('[persistence] Failed to load state:', error.message);
    // Try loading backup
    if (fs.existsSync(BACKUP_FILE)) {
      console.log('[persistence] Attempting to load backup...');
      try {
        const json = fs.readFileSync(BACKUP_FILE, 'utf8');
        const state = JSON.parse(json);
        if (state.version === 1) {
          console.log('[persistence] Backup loaded successfully');
          // Same conversion logic as above
          const rooms = new Map();
          for (const roomData of state.rooms) {
            const players = roomData.players.map(p => ({
              id: p.id,
              nickname: p.nickname,
              connected: !!p.isBot,
              socketId: null,
              isBot: !!p.isBot,
            }));
            const spectators = roomData.spectators ? roomData.spectators.map(s => ({
              id: s.id,
              nickname: s.nickname,
              connected: false,
              socketId: null,
              isSpectator: s.isSpectator,
              isGodMode: s.isGodMode,
            })) : [];
            rooms.set(roomData.code, {
              code: roomData.code,
              hostId: roomData.hostId,
              status: roomData.status,
              settings: roomData.settings,
              players,
              spectators,
              gameState: roomData.gameState,
              isPrivate: roomData.isPrivate,
              createdAt: roomData.createdAt,
              updateSeq: roomData.updateSeq || 0,
            });
          }
          return rooms;
        }
      } catch (backupError) {
        console.error('[persistence] Backup also failed:', backupError.message);
      }
    }
    return null;
  }
}

// ─── Cleanup Old Rooms (optional) ─────────────────────────────────────────────
// Remove rooms older than 24 hours on load to prevent stale data buildup

function cleanupOldRooms(rooms, maxAgeMs = 24 * 60 * 60 * 1000) {
  const now = Date.now();
  let removed = 0;
  for (const [code, room] of rooms) {
    if (now - room.createdAt > maxAgeMs) {
      rooms.delete(code);
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`[persistence] Cleaned up ${removed} old room(s)`);
  }
}

module.exports = {
  saveState,
  loadState,
  cleanupOldRooms,
};
