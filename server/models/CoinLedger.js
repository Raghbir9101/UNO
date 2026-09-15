const mongoose = require('mongoose');

// Append-only audit log of every coin movement (earn or spend), keyed by the
// same anonymous uid the economy uses. The file store keeps a capped recent
// slice for instant wallet display; this is the full durable history and the
// anti-abuse/support audit trail. Written fire-and-forget — the game never
// waits on it, and coin balances remain correct even if this write fails.
const coinLedgerSchema = new mongoose.Schema({
  uid: { type: String, required: true, index: true },
  delta: { type: Number, required: true },          // + earned, − spent
  reason: { type: String, required: true },          // 'game' | 'daily_login' | 'ad' | 'spin' | 'gift_in' | 'gift_out' | 'referral' | 'shop_buy' | 'purchase' | 'level_unlock' | 'season' | 'admin'
  balanceAfter: { type: Number, required: true },
  meta: { type: mongoose.Schema.Types.Mixed },       // freeform context (itemId, orderId, peer uid, …)
}, { timestamps: true });

coinLedgerSchema.index({ uid: 1, createdAt: -1 });

module.exports = mongoose.model('CoinLedger', coinLedgerSchema);
