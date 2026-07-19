// ─── Rewards Engine ───────────────────────────────────────────────────────────
// The single place where coins, XP, levels, achievements, daily-login streaks,
// and challenge progress are computed and granted. Consumes per-game summary
// rows at game end (see recordGameEnd in server/index.js) and serves the
// /api/progress views. All amounts come from ./config — never hardcode here.
// ──────────────────────────────────────────────────────────────────────────────

const config = require('./config');
const achievements = require('./achievements');
const challenges = require('./challenges');
const progressStore = require('../progressStore');
const statsStore = require('../statsStore');
const Cosmetics = require('../../public/shared/cosmetics');

// ── Time buckets (IST-shifted day/week boundaries) ────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(now = Date.now()) {
  return new Date(now + config.TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
}

function weekKey(now = Date.now()) {
  return Math.floor((now + config.TZ_OFFSET_MIN * 60000) / (7 * DAY_MS));
}

// Roll a player's challenge buckets over when the day/week has changed
function ensureBuckets(rec, now = Date.now()) {
  const day = dayKey(now);
  const week = weekKey(now);
  if (!rec.daily || rec.daily.day !== day) {
    rec.daily = { day, progress: {}, done: {} };
  }
  if (!rec.weekly || rec.weekly.week !== week) {
    rec.weekly = { week, progress: {}, done: {}, modes: [] };
  }
}

// ── XP / levels ───────────────────────────────────────────────────────────────

// Adds XP, applying level-ups (and their unlock grants) as needed.
// Returns [{ level, label, coins, cosmetic }] for each level gained.
function grantXp(rec, amount) {
  const levelUps = [];
  rec.xp += Math.max(0, Math.round(amount));
  while (rec.level < config.MAX_LEVEL && rec.xp >= config.xpToNext(rec.level)) {
    rec.xp -= config.xpToNext(rec.level);
    rec.level++;
    const unlock = config.LEVEL_UNLOCKS[rec.level];
    let coins = 0;
    let cosmetic = null;
    if (unlock && !rec.unlockedLevels.includes(rec.level)) {
      rec.unlockedLevels.push(rec.level);
      coins = unlock.coins || 0;
      rec.coins += coins;
      // Cosmetic level unlocks drop straight into the inventory
      if (unlock.cosmetic && Cosmetics.getItem(unlock.cosmetic) && !rec.inventory.includes(unlock.cosmetic)) {
        rec.inventory.push(unlock.cosmetic);
        cosmetic = unlock.cosmetic;
      }
    }
    levelUps.push({ level: rec.level, label: unlock ? unlock.label : null, coins, cosmetic });
  }
  return levelUps;
}

// ── Shop ──────────────────────────────────────────────────────────────────────

function buyItem(uid, itemId) {
  const item = Cosmetics.getItem(itemId);
  if (!item) return { error: 'Unknown item' };
  if (item.default || !item.price) return { error: 'That item is already yours' };

  const rec = progressStore.getPlayer(uid);
  if (rec.inventory.includes(itemId)) return { error: 'You already own this item' };
  if (rec.coins < item.price) {
    return { error: `Not enough coins — you need ${item.price - rec.coins} more` };
  }

  rec.coins -= item.price;
  rec.inventory.push(itemId);
  progressStore.saveSoon(uid);
  return { success: true, itemId, coins: rec.coins, inventory: rec.inventory };
}

function equipItem(uid, category, itemId) {
  if (!Cosmetics.CATEGORIES[category]) return { error: 'Unknown category' };
  const rec = progressStore.getPlayer(uid);

  // null/absent item = back to the free default for that slot
  if (!itemId) {
    delete rec.equipped[category];
    progressStore.saveSoon(uid);
    return { success: true, equipped: rec.equipped };
  }

  const item = Cosmetics.getItem(itemId);
  if (!item || item.cat !== category) return { error: 'Unknown item' };
  if (!Cosmetics.owns(rec.inventory, itemId)) return { error: 'You don’t own this item yet' };

  rec.equipped[category] = itemId;
  progressStore.saveSoon(uid);
  return { success: true, equipped: rec.equipped };
}

// The winner's victory effect, played for the whole table (visual only)
function getVictoryFx(uid) {
  if (!uid) return 'confetti';
  const rec = progressStore.getPlayer(uid);
  const item = Cosmetics.getItem(rec.equipped && rec.equipped.victory);
  return (item && item.fx) || 'confetti';
}

// ── Game end ──────────────────────────────────────────────────────────────────
// ctx: { row, rec (statsStore record, already updated), game }
// Returns everything the post-game panel needs for this player.

function processGameEnd(uid, nickname, ctx) {
  const rec = progressStore.getPlayer(uid);
  rec.name = nickname || rec.name;
  ensureBuckets(rec);

  let coins = 0;
  let xp = 0;

  // — Base match rewards —
  coins += config.COINS.participation;
  xp += config.XP.participation;
  const opponents = Math.max(0, (ctx.game.playerCount || 1) - 1);
  if (ctx.row.won) {
    coins += config.COINS.win + Math.min(opponents * config.COINS.perOpponentBonus, config.COINS.maxOpponentBonus);
    xp += config.XP.win + Math.min(opponents * config.XP.perOpponentBonus, config.XP.maxOpponentBonus);
    if ((ctx.game.maxHand || 0) >= config.XP.comebackHand) xp += config.XP.comebackBonus;
  }
  if (ctx.game.durationMs >= config.XP.longMatchMs) xp += config.XP.longMatchBonus;

  // — Play-for-Places podium bonus (1st place already got the win reward) —
  if (ctx.game.place && config.PLACEMENT) {
    const idx = ctx.game.place - 1;
    coins += config.PLACEMENT.coins[idx] || 0;
    xp += config.PLACEMENT.xp[idx] || 0;
  }

  // — Achievements (deduped by statsStore; rewards granted only when fresh) —
  const earned = achievements.earnedAchievements(ctx);
  const freshAchievements = statsStore.unlockAchievements(uid, earned);
  for (const id of freshAchievements) {
    const def = achievements.ACHIEVEMENTS[id];
    coins += def.coins || 0;
    xp += def.xp || 0;
  }

  // — Challenge progress —
  const completed = [];
  const advance = (bucket, list, scope) => {
    for (const ch of list) {
      if (bucket.done[ch.id]) continue;
      let inc = 0;
      if (ch.kind === 'modes') {
        const mode = ctx.game.mode || 'custom';
        if (!bucket.modes.includes(mode)) bucket.modes.push(mode);
        bucket.progress[ch.id] = bucket.modes.length;
      } else {
        inc = ch.metric(ctx) || 0;
        bucket.progress[ch.id] = (bucket.progress[ch.id] || 0) + inc;
      }
      if ((bucket.progress[ch.id] || 0) >= ch.target) {
        bucket.progress[ch.id] = ch.target;
        bucket.done[ch.id] = true;
        const cCoins = scope === 'daily' ? config.COINS.dailyChallenge : config.COINS.weeklyChallenge;
        const cXp = scope === 'daily' ? config.XP.dailyChallenge : config.XP.weeklyChallenge;
        coins += cCoins;
        xp += cXp;
        completed.push({ id: ch.id, icon: ch.icon, desc: ch.desc, scope, coins: cCoins, xp: cXp });
      }
    }
  };
  advance(rec.daily, challenges.activeDaily(rec.daily.day), 'daily');
  advance(rec.weekly, challenges.activeWeekly(rec.weekly.week), 'weekly');

  // — Apply —
  rec.coins += coins;
  const levelUps = grantXp(rec, xp);
  progressStore.saveSoon(uid);

  return {
    coins,
    xp,
    levelUps,
    challenges: completed,
    achievements: freshAchievements,
    level: rec.level,
    totalCoins: rec.coins,
  };
}

// ── Daily login ───────────────────────────────────────────────────────────────

function claimDailyLogin(uid, name) {
  const rec = progressStore.getPlayer(uid);
  if (name) rec.name = name;
  ensureBuckets(rec);

  const today = dayKey();
  if (rec.lastClaimDay === today) {
    return { alreadyClaimed: true, ...loginView(rec) };
  }

  const yesterday = dayKey(Date.now() - DAY_MS);
  rec.streak = rec.lastClaimDay === yesterday ? rec.streak + 1 : 1;
  rec.lastClaimDay = today;

  const calDay = (rec.streak - 1) % config.DAILY_LOGIN.length;
  const reward = config.DAILY_LOGIN[calDay];
  rec.coins += reward.coins || 0;
  const levelUps = reward.xp ? grantXp(rec, reward.xp) : [];
  progressStore.saveSoon(uid);

  return {
    claimed: true,
    reward: { ...reward, day: calDay + 1 },
    levelUps,
    ...loginView(rec),
  };
}

function loginView(rec) {
  const cycleLen = config.DAILY_LOGIN.length;
  const today = dayKey();
  const yesterday = dayKey(Date.now() - DAY_MS);
  const canClaim = rec.lastClaimDay !== today;
  // Which calendar slot the NEXT claim lands on (1-based). A missed day
  // resets the streak to slot 1 — computed here so the UI never guesses.
  const nextStreak = rec.lastClaimDay === yesterday || rec.lastClaimDay === today
    ? rec.streak + (canClaim ? 1 : 0)
    : 1;
  return {
    streak: rec.streak,
    canClaim,
    nextDay: canClaim ? ((nextStreak - 1) % cycleLen) + 1 : null,
    calendarDay: rec.streak > 0 ? ((rec.streak - 1) % cycleLen) + 1 : 0, // last claimed slot (1-based)
    calendar: config.DAILY_LOGIN.map((r, i) => ({ day: i + 1, ...r })),
    coins: rec.coins,
    level: rec.level,
  };
}

// ── Progress view (everything the rewards UI needs in one call) ──────────────

function getProgressView(uid) {
  const rec = progressStore.getPlayer(uid);
  ensureBuckets(rec);
  const stats = statsStore.getPlayer(uid);

  const challengeView = (bucket, list, scope) => list.map(ch => ({
    id: ch.id,
    icon: ch.icon,
    desc: ch.desc,
    target: ch.target,
    progress: Math.min(bucket.progress[ch.id] || 0, ch.target),
    done: !!bucket.done[ch.id],
    coins: scope === 'daily' ? config.COINS.dailyChallenge : config.COINS.weeklyChallenge,
    xp: scope === 'daily' ? config.XP.dailyChallenge : config.XP.weeklyChallenge,
  }));

  return {
    coins: rec.coins,
    level: rec.level,
    xp: rec.xp,
    xpToNext: config.xpToNext(rec.level),
    login: loginView(rec),
    daily: challengeView(rec.daily, challenges.activeDaily(rec.daily.day), 'daily'),
    weekly: challengeView(rec.weekly, challenges.activeWeekly(rec.weekly.week), 'weekly'),
    achievements: stats.achievements || [],
    achievementDefs: achievements.publicDefs(),
    levelUnlocks: config.LEVEL_UNLOCKS,
    inventory: rec.inventory,
    equipped: rec.equipped,
  };
}

module.exports = {
  processGameEnd, claimDailyLogin, getProgressView, dayKey, weekKey,
  buyItem, equipItem, getVictoryFx,
};
