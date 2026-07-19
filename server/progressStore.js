// ─── Player Progress Store ────────────────────────────────────────────────────
// File-backed economy/progression state keyed by the same anonymous uid as
// statsStore: coins, XP, level, login streak, and challenge buckets. Same
// persistence pattern (JSON on disk, debounced writes) — the game never
// waits on a database for rewards.
//
// This store is intentionally dumb: it only loads/saves/creates records.
// All rules (amounts, curves, rollovers) live in server/rewards/engine.js.
// ──────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const PROGRESS_FILE = path.join(__dirname, '..', 'data', 'player-progress.json');

let data = { version: 1, players: {} };

try {
  if (fs.existsSync(PROGRESS_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    if (parsed && parsed.players) data = parsed;
    console.log(`[progress] Loaded progress for ${Object.keys(data.players).length} player(s)`);
  }
} catch (err) {
  console.error('[progress] Failed to load progress file, starting fresh:', err.message);
}

let _saveTimer = null;
// Pass the uid of the changed record so cloud sync can mirror it to MongoDB
// (cloudSync assigns module.exports.onChange at boot).
function saveSoon(uid) {
  if (uid && module.exports.onChange) module.exports.onChange(uid);
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveNow, 2000);
}

function saveNow() {
  clearTimeout(_saveTimer);
  try {
    const dir = path.dirname(PROGRESS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(data));
  } catch (err) {
    console.error('[progress] Save failed:', err.message);
  }
}

function getPlayer(uid) {
  if (!data.players[uid]) {
    data.players[uid] = {
      name: 'Player',
      coins: 0,
      xp: 0,           // XP inside the current level
      level: 1,
      streak: 0,        // consecutive login-claim days
      lastClaimDay: null,
      daily: null,      // { day, progress: {id: n}, done: {id: true} }
      weekly: null,     // { week, progress, done, modes: [] }
      unlockedLevels: [], // LEVEL_UNLOCKS already granted
      inventory: [],    // owned cosmetic item ids (defaults are implicit)
      equipped: {},     // category → item id (absent = default)
      createdAt: Date.now(),
      lastSeen: Date.now(),
    };
  }
  const rec = data.players[uid];
  // Lazy migration for records created before the cosmetics shop
  if (!Array.isArray(rec.inventory)) rec.inventory = [];
  if (!rec.equipped || typeof rec.equipped !== 'object') rec.equipped = {};
  rec.lastSeen = Date.now();
  return rec;
}

// ── Cloud-sync accessors (no side effects, no record creation) ───────────────

function has(uid) {
  return !!data.players[uid];
}

function peek(uid) {
  return data.players[uid] || null;
}

function restore(uid, rec) {
  if (!rec || typeof rec !== 'object') return;
  data.players[uid] = rec;
  saveSoon(); // file only — restoring FROM the cloud must not re-upsert
}

function remove(uid) {
  delete data.players[uid];
  saveSoon();
}

module.exports = { getPlayer, saveSoon, saveNow, has, peek, restore, remove, onChange: null };
