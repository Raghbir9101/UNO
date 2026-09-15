// ─── Rewards Configuration ────────────────────────────────────────────────────
// Every coin/XP amount, the level curve, level unlocks, and the daily-login
// calendar live HERE — nothing is hardcoded in the engine.
//
// Coins are EARNED by playing, watching rewarded ads, daily logins, the wheel,
// and referrals. They may ALSO be bought with real money (coin packs), and a
// VIP / Remove-Ads pass can be purchased — but coins and real money only ever
// buy cosmetics and convenience. Nothing purchasable affects a match's outcome:
// the game is strictly not pay-to-win.
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

  // ── Rewarded ads (Google Ad Manager rewarded format, NOT AdSense) ───────────
  // Web rewarded ads grant via a client-side callback (no server SSV token),
  // so trust is enforced by caps, a cooldown, and a one-time server nonce.
  AD_REWARD: {
    coins: 30,           // per completed rewarded ad
    dailyCap: 10,        // max rewarded-ad grants per IST day
    cooldownMs: 60 * 1000, // min gap between two ad grants
    nonceTtlMs: 5 * 60 * 1000, // an issued ad nonce expires after 5 minutes
  },

  // ── Spin the wheel / mystery box ────────────────────────────────────────────
  // One free spin per IST day; extra spins are earned by watching an ad.
  // Prizes are drawn by `weight` (need not sum to 100). `coins` grants coins;
  // `item` grants a cosmetic (skipped to a coin fallback if already owned).
  SPIN: {
    freePerDay: 1,
    maxAdSpinsPerDay: 3,
    prizes: [
      { id: 'c25',   label: '25 Coins',   weight: 30, coins: 25 },
      { id: 'c50',   label: '50 Coins',   weight: 24, coins: 50 },
      { id: 'c100',  label: '100 Coins',  weight: 18, coins: 100 },
      { id: 'c250',  label: '250 Coins',  weight: 9,  coins: 250 },
      { id: 'c500',  label: '500 Coins',  weight: 3,  coins: 500 },
      { id: 'jackpot', label: 'JACKPOT 1000', weight: 1, coins: 1000 },
      { id: 'item-emote', label: 'Surprise Avatar', weight: 8, item: 'avatar-alien', coinsIfOwned: 150 },
      { id: 'c10',   label: '10 Coins',   weight: 7,  coins: 10 },
    ],
  },

  // ── Refer & earn ────────────────────────────────────────────────────────────
  // The referee is credited a welcome bonus once; the referrer is credited only
  // after the referee has finished `unlockGames` games (anti-abuse). One reward
  // per referee, no self-referral.
  REFERRAL: {
    refereeBonus: 100,    // new player who arrives via a ref link
    referrerBonus: 200,   // the inviter, once the referee qualifies
    unlockGames: 2,       // games the referee must finish to qualify
    maxRewardedReferrals: 100, // cap lifetime referrer payouts (abuse guard)
  },

  // ── Coin gifting between players ─────────────────────────────────────────────
  GIFT: {
    min: 50,
    max: 2000,
    dailyCap: 5000,       // max total coins a player can send per IST day
    requireAuth: true,    // sender must be signed in (reduces alt-account abuse)
  },

  // ── Season pass / VIP track ──────────────────────────────────────────────────
  // A rolling season; players earn season XP from games and claim tier rewards.
  // `vipMultiplier` scales coin earnings while a VIP pass is active.
  SEASON: {
    id: '2026-S1',
    name: 'Neon Season',
    endsAt: Date.parse('2026-12-01T00:00:00Z'),
    vipMultiplier: 2,
    // tier = { xp: cumulative season XP needed, coins, cosmetic, vipOnly }
    tiers: [
      { tier: 1,  xp: 0,    coins: 50 },
      { tier: 2,  xp: 200,  coins: 75 },
      { tier: 3,  xp: 500,  coins: 100, cosmetic: 'card-theme-neon' },
      { tier: 4,  xp: 900,  coins: 150 },
      { tier: 5,  xp: 1400, coins: 200, cosmetic: 'back-galaxy', vipOnly: true },
      { tier: 6,  xp: 2000, coins: 250 },
      { tier: 7,  xp: 2700, coins: 300, cosmetic: 'table-ocean' },
      { tier: 8,  xp: 3500, coins: 400 },
      { tier: 9,  xp: 4400, coins: 500, cosmetic: 'avatar-wizard', vipOnly: true },
      { tier: 10, xp: 5500, coins: 1000, cosmetic: 'victory-golden' },
    ],
  },

  // ── Real-money store (Razorpay; amounts in paise — ₹1 = 100) ─────────────────
  // Coin packs buy COINS only; they never buy gameplay power.
  COIN_PACKS: [
    { id: 'pack-handful', name: 'Handful of Coins', amount: 4900,  coins: 1000,  bonus: 0,    badge: null },
    { id: 'pack-stack',   name: 'Coin Stack',       amount: 9900,  coins: 2500,  bonus: 250,  badge: 'Popular' },
    { id: 'pack-chest',   name: 'Treasure Chest',   amount: 19900, coins: 6000,  bonus: 1000, badge: 'Best value' },
    { id: 'pack-vault',   name: 'Coin Vault',       amount: 49900, coins: 16000, bonus: 4000, badge: null },
  ],

  // VIP / Remove-Ads pass: removes ads, applies the season coin multiplier, and
  // unlocks VIP-only season tiers. Duration in days.
  VIP_PASS: [
    { id: 'vip-30',  name: 'VIP — 1 Month',  amount: 9900,  days: 30 },
    { id: 'vip-90',  name: 'VIP — 3 Months', amount: 24900, days: 90,  badge: 'Save 16%' },
    { id: 'vip-365', name: 'VIP — 1 Year',   amount: 79900, days: 365, badge: 'Best value' },
  ],

  CURRENCY: 'INR',
};
