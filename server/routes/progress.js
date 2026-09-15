// ─── Progress / Economy API ───────────────────────────────────────────────────
// Coins / XP / level / daily login / challenges / store / wheel / referrals /
// gifting / season, keyed by the same anonymous uid the leaderboard uses
// (localStorage `uno_uid`) — no signup required for earning or spending coins.
// All grants are computed server-side by the rewards engine; the client only
// displays and requests. Real-money purchases live in routes/payments.js.
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router = express.Router();
const rewardsEngine = require('../rewards/engine');
const cloudSync = require('../cloudSync');
const config = require('../rewards/config');
const { requireAuth, requireDb } = require('./auth');

const UID_RE = /^[\w-]{8,64}$/;

function cleanUid(uid) {
  return (typeof uid === 'string' && UID_RE.test(uid)) ? uid : null;
}

// Client bootstrap: which ad/payment integrations are live on this server.
// No uid needed; the client caches it. When GAM/Razorpay aren't configured the
// client shows a safe dev placeholder (ads) / hides real-money tiles (payments).
router.get('/meta', (req, res) => {
  res.json({
    success: true,
    ads: {
      enabled: !!(process.env.GAM_NETWORK_CODE && process.env.GAM_REWARDED_AD_UNIT),
      network: process.env.GAM_NETWORK_CODE || null,
      rewardedUnit: process.env.GAM_REWARDED_AD_UNIT || null,
    },
    payments: {
      enabled: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
      keyId: process.env.RAZORPAY_KEY_ID || null,
      currency: config.CURRENCY,
      coinPacks: config.COIN_PACKS,
      vipPacks: config.VIP_PASS,
    },
  });
});

// Full progress view: chip data + rewards modal + store + wheel + referral in
// one call. Hydrate-on-miss first so a balance that only lives in Mongo (after
// a redeploy or on a fresh server) is restored before we read it.
router.get('/', async (req, res) => {
  const uid = cleanUid(req.query.uid);
  if (!uid) return res.status(400).json({ error: 'Invalid uid' });
  try { await cloudSync.ensureHydrated(uid); } catch { /* non-fatal */ }
  res.json({ success: true, ...rewardsEngine.getProgressView(uid) });
});

// Claim today's login reward (idempotent per IST day)
router.post('/claim-daily', (req, res) => {
  const uid = cleanUid(req.body && req.body.uid);
  if (!uid) return res.status(400).json({ error: 'Invalid uid' });
  const name = typeof req.body.name === 'string' ? req.body.name.trim().substring(0, 16) : null;
  res.json({ success: true, ...rewardsEngine.claimDailyLogin(uid, name) });
});

// ── Shop: buy a cosmetic with earned coins ──
router.post('/shop/buy', (req, res) => {
  const uid = cleanUid(req.body && req.body.uid);
  if (!uid) return res.status(400).json({ error: 'Invalid uid' });
  const result = rewardsEngine.buyItem(uid, String(req.body.itemId || ''));
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Shop: equip an owned item (itemId null/absent = back to default) ──
router.post('/shop/equip', (req, res) => {
  const uid = cleanUid(req.body && req.body.uid);
  if (!uid) return res.status(400).json({ error: 'Invalid uid' });
  const result = rewardsEngine.equipItem(uid, String(req.body.category || ''), req.body.itemId || null);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Rewarded ads: start (issue a single-use nonce) then claim ──
router.post('/ad/start', (req, res) => {
  const uid = cleanUid(req.body && req.body.uid);
  if (!uid) return res.status(400).json({ error: 'Invalid uid' });
  res.json({ success: true, nonce: rewardsEngine.issueAdNonce(uid) });
});

router.post('/ad/claim', (req, res) => {
  const uid = cleanUid(req.body && req.body.uid);
  if (!uid) return res.status(400).json({ error: 'Invalid uid' });
  const result = rewardsEngine.claimAdReward(uid, String(req.body.nonce || ''));
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Spin the wheel (free once/day; extra spins require an ad nonce) ──
router.post('/spin', (req, res) => {
  const uid = cleanUid(req.body && req.body.uid);
  if (!uid) return res.status(400).json({ error: 'Invalid uid' });
  const viaAd = !!(req.body && req.body.viaAd);
  const result = rewardsEngine.spinWheel(uid, viaAd, String((req.body && req.body.nonce) || ''));
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Referrals: attribute a new player to a code ──
router.post('/referral/apply', (req, res) => {
  const uid = cleanUid(req.body && req.body.uid);
  if (!uid) return res.status(400).json({ error: 'Invalid uid' });
  const code = String((req.body && req.body.code) || '').trim().toUpperCase().slice(0, 12);
  const result = rewardsEngine.attributeReferral(uid, code);
  if (result.error && !result.already) return res.status(400).json(result);
  res.json(result);
});

// ── Season pass: claim a tier reward ──
router.post('/season/claim', (req, res) => {
  const uid = cleanUid(req.body && req.body.uid);
  if (!uid) return res.status(400).json({ error: 'Invalid uid' });
  const tier = parseInt((req.body && req.body.tier), 10);
  const result = rewardsEngine.claimSeasonTier(uid, tier);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Wallet: recent transaction history ──
router.get('/wallet', async (req, res) => {
  const uid = cleanUid(req.query.uid);
  if (!uid) return res.status(400).json({ error: 'Invalid uid' });
  try { await cloudSync.ensureHydrated(uid); } catch { /* non-fatal */ }
  const limit = Math.min(parseInt(req.query.limit, 10) || 40, 100);
  res.json({ success: true, ...(await rewardsEngine.getWallet(uid, limit)) });
});

// ── Gifting: send coins to another player (sign-in required, anti-abuse) ──
// requireDb/requireAuth guarantee a verified account so alt-account farming is
// harder; the sender's coins are the account's uid.
router.post('/gift', requireDb, requireAuth, (req, res) => {
  const fromUid = req.user && req.user.uid;
  if (!cleanUid(fromUid)) return res.status(400).json({ error: 'Your account has no progress yet' });
  const to = String((req.body && req.body.to) || '').trim().slice(0, 32);
  const amount = parseInt((req.body && req.body.amount), 10);
  const result = rewardsEngine.giftCoins(fromUid, to, amount);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

module.exports = router;
