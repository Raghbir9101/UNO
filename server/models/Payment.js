const mongoose = require('mongoose');

// A real-money purchase of coins or the VIP / Remove-Ads pass, via Razorpay.
// `orderId` is unique so a replayed verify/webhook can never double-grant
// (the grant is idempotent: status flips draft → paid exactly once).
const paymentSchema = new mongoose.Schema({
  uid: { type: String, required: true, index: true },
  provider: { type: String, default: 'razorpay' },
  orderId: { type: String, required: true, unique: true, index: true },
  paymentId: { type: String, index: true, sparse: true },
  sku: { type: String, required: true },             // COIN_PACKS / VIP_PASS id from config
  kind: { type: String, enum: ['coins', 'vip'], required: true },
  amount: { type: Number, required: true },           // in the smallest currency unit (paise)
  currency: { type: String, default: 'INR' },
  coins: { type: Number, default: 0 },                // coins granted (coin packs)
  vipDays: { type: Number, default: 0 },              // VIP days granted (vip pass)
  status: { type: String, enum: ['created', 'paid', 'failed'], default: 'created', index: true },
  granted: { type: Boolean, default: false },         // idempotency guard for the grant
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
