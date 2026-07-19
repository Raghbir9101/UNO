// ─── Achievements Registry ────────────────────────────────────────────────────
// Single source of truth for every achievement: display fields, coin/XP
// reward, and an unlock condition evaluated at game end.
//
// Adding an achievement = one entry here. The condition receives:
//   ctx.row   — this player's per-game summary row
//               { won, cardsPlayed, cardsDrawn, wildsPlayed, unoCalls, typeCounts }
//   ctx.rec   — lifetime stats record from statsStore (already updated)
//   ctx.game  — { durationMs, playerCount, mode, settings, finalDiscardType, maxHand }
//
// Unlocks are deduped by statsStore.unlockAchievements, so `>=` conditions
// are safe (and survive multi-game jumps).
// ──────────────────────────────────────────────────────────────────────────────

const tc = (ctx, type) => (ctx.row.typeCounts && ctx.row.typeCounts[type]) || 0;

const ACHIEVEMENTS = {
  first_win: {
    emoji: '🏆', title: 'First Victory', desc: 'Win your first game',
    coins: 50, xp: 50,
    check: (ctx) => ctx.row.won && ctx.rec.wins >= 1,
  },
  ten_wins: {
    emoji: '👑', title: 'Deca-Champion', desc: 'Win 10 games',
    coins: 100, xp: 100,
    check: (ctx) => ctx.rec.wins >= 10,
  },
  fifty_wins: {
    emoji: '🥇', title: 'Half-Century', desc: 'Win 50 games',
    coins: 300, xp: 300,
    check: (ctx) => ctx.rec.wins >= 50,
  },
  hundred_wins: {
    emoji: '💯', title: 'Century Club', desc: 'Win 100 games',
    coins: 500, xp: 500,
    check: (ctx) => ctx.rec.wins >= 100,
  },
  games_100: {
    emoji: '🎮', title: 'Regular', desc: 'Play 100 games',
    coins: 200, xp: 200,
    check: (ctx) => ctx.rec.gamesPlayed >= 100,
  },
  plus4_finish: {
    emoji: '💥', title: 'Savage Finish', desc: 'Win by playing a +4',
    coins: 75, xp: 75,
    check: (ctx) => ctx.row.won && ctx.game.finalDiscardType === 'wild4',
  },
  speed_win: {
    emoji: '⚡', title: 'Speed Run', desc: 'Win a game in under 2 minutes',
    coins: 75, xp: 75,
    check: (ctx) => ctx.row.won && ctx.game.durationMs < 120000,
  },
  comeback: {
    emoji: '💪', title: 'The Comeback', desc: 'Win after holding 12+ cards',
    coins: 100, xp: 100,
    check: (ctx) => ctx.row.won && (ctx.game.maxHand || 0) >= 12,
  },
  card_shark: {
    emoji: '🃏', title: 'Card Shark', desc: 'Play 20+ cards in one game',
    coins: 50, xp: 50,
    check: (ctx) => ctx.row.cardsPlayed >= 20,
  },
  reverse_master: {
    emoji: '🪃', title: 'Reverse Master', desc: 'Play 5 Reverse cards in one game',
    coins: 75, xp: 75,
    check: (ctx) => tc(ctx, 'reverse') >= 5,
  },
  draw4_master: {
    emoji: '☄️', title: 'Draw Four Master', desc: 'Play 3 Wild +4s in one game',
    coins: 75, xp: 75,
    check: (ctx) => tc(ctx, 'wild4') >= 3,
  },
  uno_caller: {
    emoji: '🔴', title: 'UNO!', desc: 'Call UNO successfully',
    coins: 25, xp: 25,
    check: (ctx) => (ctx.row.unoCalls || 0) >= 1,
  },
  big_table_win: {
    emoji: '🎪', title: 'Crowd Control', desc: 'Win a game with 10+ players',
    coins: 200, xp: 200,
    check: (ctx) => ctx.row.won && ctx.game.playerCount >= 10,
  },
  mega_table_win: {
    emoji: '🏟️', title: 'Arena Legend', desc: 'Win a game with 15+ players',
    coins: 400, xp: 400,
    check: (ctx) => ctx.row.won && ctx.game.playerCount >= 15,
  },
  no_draw_win: {
    emoji: '🧊', title: 'Untouchable', desc: 'Win without drawing a single card',
    coins: 150, xp: 150,
    check: (ctx) => ctx.row.won && ctx.row.cardsDrawn === 0,
  },
  survivor: {
    emoji: '💀', title: 'Last One Standing', desc: 'Win an elimination match',
    coins: 100, xp: 100,
    check: (ctx) => ctx.row.won && !!(ctx.game.settings && ctx.game.settings.elimination),
  },
};

// Evaluate every achievement for one player's finished game.
// Returns the ids whose conditions hold (dedup happens in statsStore).
function earnedAchievements(ctx) {
  const earned = [];
  for (const [id, def] of Object.entries(ACHIEVEMENTS)) {
    try {
      if (def.check(ctx)) earned.push(id);
    } catch { /* a bad condition must never break game end */ }
  }
  return earned;
}

// Display-only fields (safe to send to clients — no condition functions)
function publicDef(id) {
  const def = ACHIEVEMENTS[id];
  if (!def) return null;
  return { emoji: def.emoji, title: def.title, desc: def.desc, coins: def.coins, xp: def.xp };
}

function publicDefs() {
  const out = {};
  for (const id of Object.keys(ACHIEVEMENTS)) out[id] = publicDef(id);
  return out;
}

module.exports = { ACHIEVEMENTS, earnedAchievements, publicDef, publicDefs };
