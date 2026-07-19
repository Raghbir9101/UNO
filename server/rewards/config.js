// ─── Rewards Configuration ────────────────────────────────────────────────────
// Every coin/XP amount, the level curve, level unlocks, and the daily-login
// calendar live HERE — nothing is hardcoded in the engine. Coins are earned
// only by playing; they are never purchasable with real money.
// ──────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Day/week boundaries use IST — the player base is India-first
  TZ_OFFSET_MIN: 330,

  COINS: {
    participation: 10,     // finishing any game
    win: 50,               // winning a game
    perOpponentBonus: 5,   // per human/bot opponent beaten…
    maxOpponentBonus: 60,  // …capped
    dailyChallenge: 40,
    weeklyChallenge: 200,
  },

  // Play-for-Places podium bonus by finishing rank (index 0 = 1st). 1st place
  // ALSO receives the normal win reward on top of this.
  PLACEMENT: {
    coins: [40, 25, 15],
    xp: [40, 25, 15],
  },

  XP: {
    participation: 20,
    win: 60,
    perOpponentBonus: 8,
    maxOpponentBonus: 100,
    longMatchBonus: 30,          // matches longer than…
    longMatchMs: 10 * 60 * 1000, // …10 minutes
    comebackBonus: 40,           // win after holding 12+ cards
    comebackHand: 12,
    dailyChallenge: 50,
    weeklyChallenge: 300,
  },

  // XP needed to advance FROM `level` to the next one
  xpToNext(level) {
    return 100 + (level - 1) * 50;
  },
  MAX_LEVEL: 200,

  // Level-up grants. `cosmetic` ids reference the cosmetics registry
  // (public/shared/cosmetics.js) — the item lands in the player's inventory
  // on level-up, alongside the coin grant.
  LEVEL_UNLOCKS: {
    2:   { label: 'Rookie Badge',             coins: 50 },
    5:   { label: 'Azure Card Theme',         coins: 100,  cosmetic: 'card-theme-azure' },
    10:  { label: 'Neon City Table',          coins: 200,  cosmetic: 'table-neon' },
    20:  { label: 'Lightning Card Back',      coins: 400,  cosmetic: 'back-lightning' },
    35:  { label: 'Gold Card Back',           coins: 600,  cosmetic: 'back-gold' },
    50:  { label: 'Dragon Avatar',            coins: 1000, cosmetic: 'avatar-dragon' },
    75:  { label: 'Holographic Card Theme',   coins: 1500, cosmetic: 'card-theme-holo' },
    100: { label: 'Royale Victory Effect',    coins: 2500, cosmetic: 'victory-royale' },
  },

  // 7-day repeating login streak calendar (index = streak day − 1)
  DAILY_LOGIN: [
    { coins: 25 },
    { coins: 50 },
    { coins: 75, xp: 25 },
    { coins: 100 },
    { coins: 125, xp: 50 },
    { coins: 150 },
    { coins: 300, xp: 150 },
  ],

  DAILY_CHALLENGE_COUNT: 3,
  WEEKLY_CHALLENGE_COUNT: 3,
};
