// ─── Payments (/api/payments/*) ───────────────────────────────────────────────
// Real-money coin packs and the VIP / Remove-Ads pass, via Razorpay. We talk to
// Razorpay over its REST API (no SDK dependency). Grants are idempotent: a
// Payment doc flips draft → paid exactly once, so a replayed verify or webhook
// can never double-credit. Degrades to 503 when keys aren't configured — the
// rest of the game is unaffected.
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const config = require('../rewards/config');
const rewardsEngine = require('../rewards/engine');
const Payment = require('../models/Payment');
const { requireAuth, requireDb } = require('./auth');

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

function configured() { return !!(KEY_ID && KEY_SECRET); }

function timingSafeEq(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function skuInfo(sku) {
  const pack = config.COIN_PACKS.find(p => p.id === sku);
  if (pack) return { kind: 'coins', amount: pack.amount, coins: pack.coins + (pack.bonus || 0), vipDays: 0, sku };
  const vip = config.VIP_PASS.find(v => v.id === sku);
  if (vip) return { kind: 'vip', amount: vip.amount, coins: 0, vipDays: vip.days, sku };
  return null;
}

// Public: key id + catalog so the client can render the store & open checkout.
router.get('/config', (req, res) => {
  res.json({
    enabled: configured(),
    keyId: KEY_ID || null,
    currency: config.CURRENCY,
    coinPacks: config.COIN_PACKS,
    vipPacks: config.VIP_PASS,
  });
});

// Create a Razorpay order for a SKU (sign-in required — coins land on the account uid).
router.post('/create-order', requireDb, requireAuth, async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'Payments are not enabled on this server yet' });
  const uid = req.user && req.user.uid;
  if (!uid) return res.status(400).json({ error: 'Your account has no progress yet — play a game first' });
  const info = skuInfo(String((req.body && req.body.sku) || ''));
  if (!info) return res.status(400).json({ error: 'Unknown item' });
  try {
    const resp = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Basic ' + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64'),
      },
      body: JSON.stringify({ amount: info.amount, currency: config.CURRENCY, notes: { uid, sku: info.sku } }),
    });
    const order = await resp.json().catch(() => ({}));
    if (!resp.ok || !order.id) {
      return res.status(502).json({ error: (order.error && order.error.description) || 'Could not create order' });
    }
    await Payment.create({
      uid, orderId: order.id, sku: info.sku, kind: info.kind,
      amount: info.amount, currency: config.CURRENCY, coins: info.coins, vipDays: info.vipDays,
      status: 'created', granted: false,
    });
    res.json({ success: true, orderId: order.id, amount: info.amount, currency: config.CURRENCY, keyId: KEY_ID, sku: info.sku });
  } catch (err) {
    console.error('[pay] create-order failed:', err.message);
    res.status(502).json({ error: 'Payment gateway unreachable' });
  }
});

// Verify the checkout handler signature, then grant (idempotent).
router.post('/verify', requireDb, requireAuth, async (req, res) => {
  if (!configured()) return res.status(503).json({ error: 'Payments not enabled' });
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment fields' });
  }
  const expected = crypto.createHmac('sha256', KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
  if (!timingSafeEq(expected, razorpay_signature)) {
    return res.status(400).json({ error: 'Payment signature verification failed' });
  }
  const result = await grant(razorpay_order_id, razorpay_payment_id, req.user.uid);
  if (result.error) return res.status(400).json(result);
  res.json({ success: true, ...result });
});

// Server-to-server webhook (HMAC over the raw body). Always 200 so Razorpay stops retrying.
router.post('/webhook', async (req, res) => {
  if (!WEBHOOK_SECRET) return res.status(503).end();
  const sig = req.headers['x-razorpay-signature'];
  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const expected = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  if (!sig || !timingSafeEq(expected, sig)) return res.status(400).end();
  try {
    const evt = req.body || {};
    if (evt.event === 'payment.captured' || evt.event === 'order.paid') {
      const payEntity = evt.payload && evt.payload.payment && evt.payload.payment.entity;
      const orderEntity = evt.payload && evt.payload.order && evt.payload.order.entity;
      const orderId = (payEntity && payEntity.order_id) || (orderEntity && orderEntity.id);
      const paymentId = payEntity && payEntity.id;
      if (orderId) await grant(orderId, paymentId, null);
    }
  } catch (err) {
    console.error('[pay] webhook error:', err.message);
  }
  res.json({ received: true });
});

// Idempotent grant: atomically flips the payment to paid, then credits once.
async function grant(orderId, paymentId, _uidHint) {
  const pay = await Payment.findOne({ orderId });
  if (!pay) return { error: 'Unknown order' };
  if (pay.granted) return { alreadyGranted: true, coins: pay.coins, kind: pay.kind, vipDays: pay.vipDays };
  const claimed = await Payment.findOneAndUpdate(
    { orderId, granted: false },
    { $set: { granted: true, status: 'paid', paymentId: paymentId || pay.paymentId } },
    { new: true }
  );
  if (!claimed) return { alreadyGranted: true, coins: pay.coins, kind: pay.kind };
  if (claimed.kind === 'coins') rewardsEngine.grantCoinPack(claimed.uid, claimed.sku);
  else if (claimed.kind === 'vip') rewardsEngine.activateVip(claimed.uid, claimed.vipDays, claimed.sku);
  return { kind: claimed.kind, coins: claimed.coins, vipDays: claimed.vipDays };
}

module.exports = router;
