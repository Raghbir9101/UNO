// ─── Progress API ─────────────────────────────────────────────────────────────
// Coins / XP / level / daily login / challenges, keyed by the same anonymous
// uid the leaderboard uses (localStorage `uno_uid`) — no signup required.
// All grants are computed server-side by the rewards engine; the client only
// displays and claims.
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router = express.Router();
const rewardsEngine = require('../rewards/engine');

const UID_RE = /^[\w-]{8,64}$/;

function cleanUid(uid) {
  return (typeof uid === 'string' && UID_RE.test(uid)) ? uid : null;
}

// Full progress view: chip data + rewards modal in one call
router.get('/', (req, res) => {
  const uid = cleanUid(req.query.uid);
  if (!uid) return res.status(400).json({ error: 'Invalid uid' });
  res.json({ success: true, ...rewardsEngine.getProgressView(uid) });
});

// Claim today's login reward (idempotent per IST day)
router.post('/claim-daily', (req, res) => {
  const uid = cleanUid(req.body && req.body.uid);
  if (!uid) return res.status(400).json({ error: 'Invalid uid' });
  const name = typeof req.body.name === 'string' ? req.body.name.trim().substring(0, 16) : null;
  res.json({ success: true, ...rewardsEngine.claimDailyLogin(uid, name) });
});

// ── Shop: buy an item with earned coins ──
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

module.exports = router;
