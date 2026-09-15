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
const cloudSync = require('../cloudSync');
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

// ── Coin ledger ───────────────────────────────────────────────────────────────
// THE single choke point for every coin change. Updates the balance, appends a
// capped entry to the in-record ledger (instant wallet display, survives with
// the file store), and mirrors the full entry to Mongo for audit. Never lets a
// balance go negative. Callers still own calling progressStore.saveSoon(uid).
const LEDGER_CAP = 60;

function recordCoins(rec, uid, delta, reason, meta) {
  delta = Math.round(delta || 0);
  if (delta === 0) return 0;
  rec.coins = Math.max(0, (rec.coins || 0) + delta);
  if (!Array.isArray(rec.ledger)) rec.ledger = [];
  rec.ledger.push({ t: Date.now(), d: delta, r: reason, b: rec.coins, m: meta || undefined });
  if (rec.ledger.length > LEDGER_CAP) rec.ledger = rec.ledger.slice(-LEDGER_CAP);
  cloudSync.appendLedger(uid, delta, reason, rec.coins, meta);
  return delta;
}

// ── VIP helpers ───────────────────────────────────────────────────────────────

function isVipActive(rec) {
  return !!(rec.vip && rec.vip.active && rec.vip.expiresAt > Date.now());
}

// Coin multiplier applied to EARNINGS (play/daily/etc.) while VIP is active.
function earnMultiplier(rec) {
  return isVipActive(rec) ? (config.SEASON.vipMultiplier || 1) : 1;
}

function vipView(rec) {
  const active = isVipActive(rec);
  return {
    active,
    expiresAt: active ? rec.vip.expiresAt : 0,
    adsRemoved: active, // VIP removes ads
    multiplier: active ? (config.SEASON.vipMultiplier || 1) : 1,
  };
}

// ── XP / levels ───────────────────────────────────────────────────────────────

// Adds XP, applying level-ups (and their unlock grants) as needed.
// Returns [{ level, label, coins, cosmetic }] for each level gained.
function grantXp(rec, amount, uid) {
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
      if (coins) recordCoins(rec, uid, coins, 'level_unlock', { level: rec.level });
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

  recordCoins(rec, uid, -item.price, 'shop_buy', { itemId });
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

  // — Apply (VIP doubles coin EARNINGS; never XP or gameplay) —
  const mult = earnMultiplier(rec);
  coins = Math.round(coins * mult);
  recordCoins(rec, uid, coins, 'game', { won: !!ctx.row.won, mode: ctx.game.mode, vip: mult > 1 });
  const levelUps = grantXp(rec, xp, uid);

  // — Season pass XP (cosmetic-track progression; uses match XP) —
  const seasonTiers = grantSeasonXp(rec, xp);

  // — Referral: credit the inviter once the referee clears the games milestone —
  const referral = creditReferralOnMilestone(uid, rec);

  progressStore.saveSoon(uid);

  return {
    coins,
    xp,
    levelUps,
    challenges: completed,
    achievements: freshAchievements,
    level: rec.level,
    totalCoins: rec.coins,
    seasonTiers,
    referral,
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
  const coins = Math.round((reward.coins || 0) * earnMultiplier(rec));
  recordCoins(rec, uid, coins, 'daily_login', { day: calDay + 1, streak: rec.streak });
  const levelUps = reward.xp ? grantXp(rec, reward.xp, uid) : [];
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

// ── Rewarded ads ──────────────────────────────────────────────────────────────
// Web rewarded ads have no server-to-server verification, so we issue a
// single-use, short-lived nonce when the ad starts and require it back on the
// grant — combined with a per-day cap and a cooldown. In-memory is fine for a
// single instance; a shared store would be needed to scale horizontally.
const crypto = require('crypto');
const _adNonces = new Map(); // nonce → { uid, exp }

function issueAdNonce(uid) {
  // opportunistic sweep of expired nonces
  const now = Date.now();
  if (_adNonces.size > 500) for (const [k, v] of _adNonces) if (v.exp < now) _adNonces.delete(k);
  const nonce = crypto.randomBytes(16).toString('hex');
  _adNonces.set(nonce, { uid, exp: now + config.AD_REWARD.nonceTtlMs });
  return nonce;
}

function consumeAdNonce(uid, nonce) {
  const entry = _adNonces.get(nonce);
  if (!entry || entry.uid !== uid || entry.exp < Date.now()) return false;
  _adNonces.delete(nonce); // one-time use
  return true;
}

function adRewardView(rec) {
  const today = dayKey();
  const count = rec.adRewards.day === today ? rec.adRewards.count : 0;
  const last = rec.adRewards.day === today ? (rec.adRewards.lastAt || 0) : 0;
  return {
    coins: config.AD_REWARD.coins,
    used: count,
    cap: config.AD_REWARD.dailyCap,
    remaining: Math.max(0, config.AD_REWARD.dailyCap - count),
    cooldownMs: config.AD_REWARD.cooldownMs,
    nextAt: last + config.AD_REWARD.cooldownMs,
  };
}

function claimAdReward(uid, nonce) {
  const rec = progressStore.getPlayer(uid);
  if (!consumeAdNonce(uid, nonce)) return { error: 'Ad session expired — please try again' };
  const today = dayKey();
  if (rec.adRewards.day !== today) rec.adRewards = { day: today, count: 0, lastAt: 0 };
  if (rec.adRewards.count >= config.AD_REWARD.dailyCap) {
    return { error: 'Daily ad-reward limit reached — come back tomorrow', dailyCapReached: true };
  }
  if (Date.now() - (rec.adRewards.lastAt || 0) < config.AD_REWARD.cooldownMs) {
    return { error: 'Please wait a moment before your next ad' };
  }
  rec.adRewards.count++;
  rec.adRewards.lastAt = Date.now();
  const coins = Math.round(config.AD_REWARD.coins * earnMultiplier(rec));
  recordCoins(rec, uid, coins, 'ad', {});
  progressStore.saveSoon(uid);
  return { success: true, coins, totalCoins: rec.coins, ...adRewardView(rec) };
}

// ── Spin the wheel / mystery box ──────────────────────────────────────────────

function pickPrize() {
  const prizes = config.SPIN.prizes;
  const total = prizes.reduce((s, p) => s + (p.weight || 0), 0);
  let r = Math.random() * total;
  for (const p of prizes) { if ((r -= (p.weight || 0)) <= 0) return p; }
  return prizes[prizes.length - 1];
}

function spinView(rec) {
  const today = dayKey();
  const freeUsed = rec.spin.day === today ? rec.spin.freeUsed : 0;
  const extra = rec.spin.day === today ? rec.spin.extra : 0;
  return {
    freeAvailable: freeUsed < config.SPIN.freePerDay,
    freePerDay: config.SPIN.freePerDay,
    adSpinsLeft: Math.max(0, config.SPIN.maxAdSpinsPerDay - extra),
    // wheel segments the client renders (order = segment index)
    segments: config.SPIN.prizes.map(p => ({ id: p.id, label: p.label })),
  };
}

function spinWheel(uid, viaAd, nonce) {
  const rec = progressStore.getPlayer(uid);
  const today = dayKey();
  if (rec.spin.day !== today) rec.spin = { day: today, freeUsed: 0, extra: 0, lastPrize: null };

  if (viaAd) {
    if (!consumeAdNonce(uid, nonce)) return { error: 'Ad session expired — please try again' };
    if (rec.spin.extra >= config.SPIN.maxAdSpinsPerDay) return { error: 'No more ad spins today' };
    rec.spin.extra++;
  } else {
    if (rec.spin.freeUsed >= config.SPIN.freePerDay) {
      return { error: 'Free spin used — watch an ad for another', noFree: true };
    }
    rec.spin.freeUsed++;
  }

  const prize = pickPrize();
  let coins = prize.coins || 0;
  let item = null;
  if (prize.item) {
    if (!Cosmetics.owns(rec.inventory, prize.item)) {
      rec.inventory.push(prize.item);
      item = prize.item;
      coins = 0; // the cosmetic IS the prize
    } else {
      coins = prize.coinsIfOwned || prize.coins || 0; // already owned → coin fallback
    }
  }
  if (coins) recordCoins(rec, uid, coins, 'spin', { prize: prize.id });
  rec.spin.lastPrize = prize.id;
  progressStore.saveSoon(uid);

  return {
    success: true,
    prize: { id: prize.id, label: prize.label, coins, item, index: config.SPIN.prizes.indexOf(prize) },
    totalCoins: rec.coins,
    ...spinView(rec),
  };
}

// ── Refer & earn ──────────────────────────────────────────────────────────────

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I

function genRefCode() {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  return s;
}

function ensureReferralCode(rec, uid) {
  if (rec.referral.code) return rec.referral.code;
  let code = genRefCode();
  for (let tries = 0; tries < 12 && progressStore.findByReferralCode(code); tries++) code = genRefCode();
  rec.referral.code = code;
  progressStore.saveSoon(uid);
  return code;
}

function referralView(rec, uid) {
  return {
    code: ensureReferralCode(rec, uid),
    referredBy: rec.referral.referredBy || null,
    referredCount: rec.referral.referredUids.length,
    rewardedCount: rec.referral.rewardedCount || 0,
    refereeBonus: config.REFERRAL.refereeBonus,
    referrerBonus: config.REFERRAL.referrerBonus,
    unlockGames: config.REFERRAL.unlockGames,
  };
}

// New player arrives via someone's referral code. Idempotent & self-guarded.
function attributeReferral(uid, code) {
  if (!uid || !code) return { error: 'Invalid referral' };
  const rec = progressStore.getPlayer(uid);
  if (rec.referral.referredBy) return { error: 'You have already used a referral', already: true };
  const stats = statsStore.getPlayer(uid);
  if ((stats.gamesPlayed || 0) > config.REFERRAL.unlockGames) {
    return { error: 'Referral can only be applied by new players', already: true };
  }
  const ref = progressStore.findByReferralCode(String(code).toUpperCase());
  if (!ref) return { error: 'Unknown referral code' };
  if (ref.uid === uid) return { error: 'You cannot refer yourself' };
  rec.referral.referredBy = ref.uid;
  if (!ref.rec.referral.referredUids.includes(uid)) {
    ref.rec.referral.referredUids.push(uid);
    progressStore.saveSoon(ref.uid);
  }
  // Welcome bonus to the referee right away (the hook to stick around).
  recordCoins(rec, uid, config.REFERRAL.refereeBonus, 'referral', { role: 'referee', by: ref.uid });
  progressStore.saveSoon(uid);
  return { success: true, bonus: config.REFERRAL.refereeBonus, by: ref.rec.name };
}

// Credit the inviter once the referee has finished enough games. Called at
// game end. Returns a note for the post-game panel when a credit fires.
function creditReferralOnMilestone(uid, rec) {
  const r = rec.referral;
  if (!r.referredBy || r.referrerCredited) return null;
  const stats = statsStore.getPlayer(uid);
  if ((stats.gamesPlayed || 0) < config.REFERRAL.unlockGames) return null;
  const referrerRec = progressStore.getPlayer(r.referredBy);
  if ((referrerRec.referral.rewardedCount || 0) >= config.REFERRAL.maxRewardedReferrals) {
    r.referrerCredited = true; // cap hit — stop re-checking this referee
    progressStore.saveSoon(uid);
    return null;
  }
  recordCoins(referrerRec, r.referredBy, config.REFERRAL.referrerBonus, 'referral', { role: 'referrer', referee: uid });
  referrerRec.referral.rewardedCount = (referrerRec.referral.rewardedCount || 0) + 1;
  progressStore.saveSoon(r.referredBy);
  r.referrerCredited = true;
  progressStore.saveSoon(uid);
  return { credited: true, referrerBonus: config.REFERRAL.referrerBonus };
}

// ── Coin gifting ──────────────────────────────────────────────────────────────

function giftCoins(fromUid, toCodeOrName, amount) {
  amount = Math.round(amount || 0);
  if (amount < config.GIFT.min || amount > config.GIFT.max) {
    return { error: `Gift must be between ${config.GIFT.min} and ${config.GIFT.max} coins` };
  }
  const from = progressStore.getPlayer(fromUid);
  let target = progressStore.findByReferralCode(String(toCodeOrName || '').toUpperCase());
  if (!target) target = progressStore.findByName(toCodeOrName);
  if (!target) return { error: 'Player not found — check their friend code' };
  if (target.uid === fromUid) return { error: 'You cannot gift yourself' };
  if ((from.coins || 0) < amount) return { error: 'Not enough coins' };

  const today = dayKey();
  if (from.gifting.day !== today) from.gifting = { day: today, sentToday: 0 };
  if (from.gifting.sentToday + amount > config.GIFT.dailyCap) {
    return { error: `Daily gift limit is ${config.GIFT.dailyCap} coins` };
  }

  recordCoins(from, fromUid, -amount, 'gift_out', { to: target.uid });
  from.gifting.sentToday += amount;
  recordCoins(target.rec, target.uid, amount, 'gift_in', { from: fromUid });
  progressStore.saveSoon(fromUid);
  progressStore.saveSoon(target.uid);
  return { success: true, amount, to: target.rec.name, coins: from.coins };
}

// ── Season pass / VIP track ──────────────────────────────────────────────────

function seasonTierForXp(xp) {
  let reached = 0;
  for (const t of config.SEASON.tiers) if (xp >= t.xp) reached = t.tier;
  return reached;
}

function ensureSeason(rec) {
  if (!rec.season || rec.season.id !== config.SEASON.id) {
    rec.season = { id: config.SEASON.id, xp: 0, claimedTiers: [] };
  }
  return rec.season;
}

function grantSeasonXp(rec, xp) {
  ensureSeason(rec);
  rec.season.xp += Math.max(0, Math.round(xp));
  return { xp: rec.season.xp, tier: seasonTierForXp(rec.season.xp) };
}

function seasonView(rec) {
  ensureSeason(rec);
  const xp = rec.season.xp;
  const vip = isVipActive(rec);
  return {
    id: config.SEASON.id,
    name: config.SEASON.name,
    endsAt: config.SEASON.endsAt,
    xp,
    currentTier: seasonTierForXp(xp),
    vip,
    tiers: config.SEASON.tiers.map(t => ({
      tier: t.tier, xp: t.xp, coins: t.coins || 0, cosmetic: t.cosmetic || null,
      vipOnly: !!t.vipOnly,
      unlocked: xp >= t.xp,
      claimed: rec.season.claimedTiers.includes(t.tier),
      claimable: xp >= t.xp && !rec.season.claimedTiers.includes(t.tier) && (!t.vipOnly || vip),
    })),
  };
}

function claimSeasonTier(uid, tierNum) {
  const rec = progressStore.getPlayer(uid);
  ensureSeason(rec);
  const tier = config.SEASON.tiers.find(t => t.tier === tierNum);
  if (!tier) return { error: 'Unknown tier' };
  if (rec.season.xp < tier.xp) return { error: 'Tier locked — earn more season XP' };
  if (tier.vipOnly && !isVipActive(rec)) return { error: 'VIP pass required for this tier', vipRequired: true };
  if (rec.season.claimedTiers.includes(tierNum)) return { error: 'Already claimed' };
  rec.season.claimedTiers.push(tierNum);
  if (tier.coins) recordCoins(rec, uid, tier.coins, 'season', { tier: tierNum });
  let cosmetic = null;
  if (tier.cosmetic && Cosmetics.getItem(tier.cosmetic) && !rec.inventory.includes(tier.cosmetic)) {
    rec.inventory.push(tier.cosmetic);
    cosmetic = tier.cosmetic;
  }
  progressStore.saveSoon(uid);
  return { success: true, tier: tierNum, coins: tier.coins || 0, cosmetic, ...seasonView(rec) };
}

// ── Wallet / transaction history ──────────────────────────────────────────────

async function getWallet(uid, limit = 40) {
  const rec = progressStore.getPlayer(uid);
  const cloud = await cloudSync.recentLedger(uid, limit);
  const entries = cloud || (rec.ledger || []).slice().reverse()
    .map(e => ({ t: e.t, d: e.d, r: e.r, b: e.b, m: e.m || null }));
  return { coins: rec.coins, entries, source: cloud ? 'cloud' : 'local' };
}

// ── Real-money grants (called by the payments route after verification) ───────

function grantCoinPack(uid, sku) {
  const pack = config.COIN_PACKS.find(p => p.id === sku);
  if (!pack) return { error: 'Unknown coin pack' };
  const rec = progressStore.getPlayer(uid);
  const coins = pack.coins + (pack.bonus || 0);
  recordCoins(rec, uid, coins, 'purchase', { sku });
  progressStore.saveSoon(uid);
  return { success: true, coins, totalCoins: rec.coins };
}

function activateVip(uid, days, sku) {
  const rec = progressStore.getPlayer(uid);
  const now = Date.now();
  const base = isVipActive(rec) ? rec.vip.expiresAt : now; // stack onto remaining time
  rec.vip = {
    active: true,
    expiresAt: base + days * 24 * 60 * 60 * 1000,
    adsRemoved: true,
    multiplier: config.SEASON.vipMultiplier || 1,
  };
  progressStore.saveSoon(uid);
  return { success: true, vip: vipView(rec), sku };
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
    // ── Economy v2 surfaces ──
    adReward: adRewardView(rec),
    spin: spinView(rec),
    referral: referralView(rec, uid),
    season: seasonView(rec),
    vip: vipView(rec),
    wallet: { coins: rec.coins, recent: (rec.ledger || []).slice(-12).reverse() },
    coinPacks: config.COIN_PACKS,
    vipPacks: config.VIP_PASS,
    currency: config.CURRENCY,
  };
}

module.exports = {
  processGameEnd, claimDailyLogin, getProgressView, dayKey, weekKey,
  buyItem, equipItem, getVictoryFx,
  // Economy v2
  issueAdNonce, claimAdReward,
  spinWheel,
  ensureReferralCode, attributeReferral, referralView,
  giftCoins,
  claimSeasonTier, seasonView,
  getWallet,
  grantCoinPack, activateVip, isVipActive,
};
