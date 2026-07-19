// ─── Challenges Registry ──────────────────────────────────────────────────────
// Daily and weekly challenge pools. Each day/week a deterministic subset is
// active — the SAME set for every player (seeded by the day/week key), so the
// community is chasing the same goals and no server state is needed to pick.
//
// `metric(ctx)` returns how much one finished game advances the challenge.
// ctx is identical to the achievements context (row / rec / game).
// Adding a challenge = one entry in a pool.
// ──────────────────────────────────────────────────────────────────────────────

const config = require('./config');

const tc = (ctx, type) => (ctx.row.typeCounts && ctx.row.typeCounts[type]) || 0;

const DAILY_POOL = [
  { id: 'd_win2',     icon: '🏆', desc: 'Win 2 games',                 target: 2,  metric: (c) => (c.row.won ? 1 : 0) },
  { id: 'd_play3',    icon: '🎮', desc: 'Play 3 games',                target: 3,  metric: () => 1 },
  { id: 'd_uno',      icon: '🔴', desc: 'Call UNO successfully',       target: 1,  metric: (c) => ((c.row.unoCalls || 0) > 0 ? 1 : 0) },
  { id: 'd_reverse5', icon: '🪃', desc: 'Play 5 Reverse cards',        target: 5,  metric: (c) => tc(c, 'reverse') },
  { id: 'd_skip4',    icon: '⊘',  desc: 'Play 4 Skip cards',           target: 4,  metric: (c) => tc(c, 'skip') },
  { id: 'd_wilds3',   icon: '🌈', desc: 'Play 3 Wild cards',           target: 3,  metric: (c) => c.row.wildsPlayed || 0 },
  { id: 'd_cards30',  icon: '🃏', desc: 'Play 30 cards',               target: 30, metric: (c) => c.row.cardsPlayed || 0 },
  { id: 'd_party',    icon: '🎪', desc: 'Play a game with 5+ players', target: 1,  metric: (c) => (c.game.playerCount >= 5 ? 1 : 0) },
  { id: 'd_nomercy',  icon: '💀', desc: 'Finish a No Mercy match',     target: 1,  metric: (c) => (c.game.mode === 'noMercy' ? 1 : 0) },
];

const WEEKLY_POOL = [
  { id: 'w_win10',   icon: '👑', desc: 'Win 10 games',                 target: 10,  metric: (c) => (c.row.won ? 1 : 0) },
  { id: 'w_play25',  icon: '🎮', desc: 'Play 25 games',                target: 25,  metric: () => 1 },
  { id: 'w_modes',   icon: '🎛️', desc: 'Play every game mode',         target: 3,  kind: 'modes' },
  { id: 'w_wilds20', icon: '🌈', desc: 'Play 20 Wild cards',           target: 20,  metric: (c) => c.row.wildsPlayed || 0 },
  { id: 'w_bigwin',  icon: '🏟️', desc: 'Win a game with 8+ players',   target: 1,   metric: (c) => (c.row.won && c.game.playerCount >= 8 ? 1 : 0) },
  { id: 'w_draw100', icon: '🎣', desc: 'Draw 100 cards',               target: 100, metric: (c) => c.row.cardsDrawn || 0 },
  { id: 'w_nomercy3', icon: '💀', desc: 'Win 3 No Mercy matches',      target: 3,   metric: (c) => (c.row.won && c.game.mode === 'noMercy' ? 1 : 0) },
];

// ── Deterministic selection ───────────────────────────────────────────────────
// Seeded shuffle-pick: same key → same challenge set, on every server.

function hashKey(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededPick(pool, count, seedStr) {
  let seed = hashKey(seedStr);
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const items = [...pool];
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items.slice(0, Math.min(count, items.length));
}

function activeDaily(dayKey) {
  return seededPick(DAILY_POOL, config.DAILY_CHALLENGE_COUNT, 'daily:' + dayKey);
}

function activeWeekly(weekKey) {
  return seededPick(WEEKLY_POOL, config.WEEKLY_CHALLENGE_COUNT, 'weekly:' + weekKey);
}

module.exports = { DAILY_POOL, WEEKLY_POOL, activeDaily, activeWeekly };
