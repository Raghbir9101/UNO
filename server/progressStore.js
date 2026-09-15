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
      // ── Economy v2 ──────────────────────────────────────────────────────
      ledger: [],       // capped recent coin transactions (full log → Mongo)
      adRewards: { day: null, count: 0 },        // rewarded-ad daily cap/cooldown
      spin: { day: null, freeUsed: 0, extra: 0, lastPrize: null }, // wheel
      referral: { code: null, referredBy: null, referredUids: [], rewardedCount: 0 },
      gifting: { day: null, sentToday: 0 },      // gift daily cap
      season: { id: null, xp: 0, claimedTiers: [] },
      vip: { active: false, expiresAt: 0, adsRemoved: false, multiplier: 1 },
      createdAt: Date.now(),
      lastSeen: Date.now(),
    };
  }
  const rec = data.players[uid];
  // Lazy migration for records created before the cosmetics shop
  if (!Array.isArray(rec.inventory)) rec.inventory = [];
  if (!rec.equipped || typeof rec.equipped !== 'object') rec.equipped = {};
  // Lazy migration for Economy v2 fields (records predate the expanded store)
  if (!Array.isArray(rec.ledger)) rec.ledger = [];
  if (!rec.adRewards || typeof rec.adRewards !== 'object') rec.adRewards = { day: null, count: 0 };
  if (!rec.spin || typeof rec.spin !== 'object') rec.spin = { day: null, freeUsed: 0, extra: 0, lastPrize: null };
  if (!rec.referral || typeof rec.referral !== 'object') {
    rec.referral = { code: null, referredBy: null, referredUids: [], rewardedCount: 0 };
  }
  if (!Array.isArray(rec.referral.referredUids)) rec.referral.referredUids = [];
  if (!rec.gifting || typeof rec.gifting !== 'object') rec.gifting = { day: null, sentToday: 0 };
  if (!rec.season || typeof rec.season !== 'object') rec.season = { id: null, xp: 0, claimedTiers: [] };
  if (!Array.isArray(rec.season.claimedTiers)) rec.season.claimedTiers = [];
  if (!rec.vip || typeof rec.vip !== 'object') rec.vip = { active: false, expiresAt: 0, adsRemoved: false, multiplier: 1 };
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

// Every record (for the one-time Mongo backfill and admin tooling).
function all() {
  return data.players;
}

// Look a player up by their public referral code (set lazily by the engine).
function findByReferralCode(code) {
  if (!code) return null;
  for (const uid of Object.keys(data.players)) {
    const r = data.players[uid];
    if (r.referral && r.referral.code === code) return { uid, rec: r };
  }
  return null;
}

// Look a player up by (case-insensitive) display name — used for gifting.
function findByName(name) {
  if (!name) return null;
  const needle = String(name).trim().toLowerCase();
  for (const uid of Object.keys(data.players)) {
    const r = data.players[uid];
    if (r.name && r.name.toLowerCase() === needle) return { uid, rec: r };
  }
  return null;
}

module.exports = {
  getPlayer, saveSoon, saveNow, has, peek, restore, remove, all,
  findByReferralCode, findByName, onChange: null,
};
