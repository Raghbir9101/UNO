const mongoose = require('mongoose');

// One document per page view. Static assets, socket.io traffic, and API calls
// are never recorded — only real page navigations.
const visitSchema = new mongoose.Schema({
  path: { type: String, required: true, index: true },
  ip: { type: String },
  country: { type: String, index: true },
  region: { type: String },
  city: { type: String },
  referer: { type: String },
  utmSource: { type: String },
  userAgent: { type: String },
  device: { type: String, enum: ['mobile', 'tablet', 'desktop', 'bot', 'unknown'], default: 'unknown' },
  language: { type: String },
  isBot: { type: Boolean, default: false },
  // sha256(ip|ua|day) prefix — approximates a unique daily visitor without a cookie
  sessionKey: { type: String, index: true },
  ts: { type: Date, default: Date.now }, // indexed via the TTL index below
}, {
  versionKey: false
});

// Analytics grow forever otherwise — keep 180 days of raw visits
visitSchema.index({ ts: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });

const Visit = mongoose.model('Visit', visitSchema);
module.exports = Visit;
