// ─── Player Stats Store ───────────────────────────────────────────────────────
// File-backed lifetime stats keyed by an anonymous client uid (localStorage on
// the client — no signup needed). Powers the /leaderboard page, the post-game
// stats panel, and achievement unlocks. Same persistence pattern as
// statePersistence.js: JSON on disk, debounced writes.
// ──────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const STATS_FILE = path.join(__dirname, '..', 'data', 'player-stats.json');

// Achievement definitions now live in the rewards registry
// (server/rewards/achievements.js) — re-exported here (display fields only,
// no condition functions) so existing consumers (profile API) keep working.
// Unlocked ids are still stored per player in this store.
const ACHIEVEMENTS = require('./rewards/achievements').publicDefs();

let data = { version: 1, players: {} };

// ─── Load / Save ──────────────────────────────────────────────────────────────

try {
  if (fs.existsSync(STATS_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    if (parsed && parsed.players) data = parsed;
    console.log(`[stats] Loaded stats for ${Object.keys(data.players).length} player(s)`);
  }
} catch (err) {
  console.error('[stats] Failed to load stats file, starting fresh:', err.message);
}

let _saveTimer = null;
function saveSoon() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveNow, 2000);
}

function saveNow() {
  clearTimeout(_saveTimer);
  try {
    const dir = path.dirname(STATS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(data));
  } catch (err) {
    console.error('[stats] Save failed:', err.message);
  }
}

// ─── Records ──────────────────────────────────────────────────────────────────

// Week bucket for the weekly leaderboard — a plain epoch-week counter is
// enough; it only has to be stable and monotonic.
function currentWeek() {
  return Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
}

function getPlayer(uid) {
  if (!data.players[uid]) {
    data.players[uid] = {
      name: 'Player',
      wins: 0,
      gamesPlayed: 0,
      cardsPlayed: 0,
      cardsDrawn: 0,
      wildsPlayed: 0,
      weekly: { week: currentWeek(), wins: 0, games: 0 },
      achievements: [],
      lastSeen: Date.now(),
    };
  }
  const rec = data.players[uid];
  // Roll the weekly bucket over lazily on access
  const week = currentWeek();
  if (!rec.weekly || rec.weekly.week !== week) {
    rec.weekly = { week, wins: 0, games: 0 };
  }
  return rec;
}

function recordGame({ uid, nickname, won, cardsPlayed = 0, cardsDrawn = 0, wildsPlayed = 0 }) {
  const rec = getPlayer(uid);
  rec.name = nickname || rec.name;
  rec.gamesPlayed++;
  rec.cardsPlayed += cardsPlayed;
  rec.cardsDrawn += cardsDrawn;
  rec.wildsPlayed += wildsPlayed;
  rec.weekly.games++;
  if (won) {
    rec.wins++;
    rec.weekly.wins++;
  }
  rec.lastSeen = Date.now();
  if (module.exports.onChange) module.exports.onChange(uid); // → cloud sync
  saveSoon();
  return rec;
}

// Marks achievements as unlocked; returns only the ones that are new.
function unlockAchievements(uid, achievementIds) {
  const rec = getPlayer(uid);
  const fresh = achievementIds.filter(id => !rec.achievements.includes(id));
  if (fresh.length) {
    rec.achievements.push(...fresh);
    if (module.exports.onChange) module.exports.onChange(uid); // → cloud sync
    saveSoon();
  }
  return fresh;
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

function getLeaderboard(limit = 20) {
  const all = Object.values(data.players);
  const week = currentWeek();

  const allTime = all
    .filter(p => p.wins > 0)
    .sort((a, b) => b.wins - a.wins || a.gamesPlayed - b.gamesPlayed)
    .slice(0, limit)
    .map(p => ({ name: p.name, wins: p.wins, gamesPlayed: p.gamesPlayed }));

  const weekly = all
    .filter(p => p.weekly && p.weekly.week === week && p.weekly.wins > 0)
    .sort((a, b) => b.weekly.wins - a.weekly.wins || a.weekly.games - b.weekly.games)
    .slice(0, limit)
    .map(p => ({ name: p.name, wins: p.weekly.wins, gamesPlayed: p.weekly.games }));

  return { allTime, weekly, totalPlayers: all.length };
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

module.exports = {
  recordGame, unlockAchievements, getLeaderboard, getPlayer, saveNow,
  has, peek, restore, remove, onChange: null,
  ACHIEVEMENTS,
};
