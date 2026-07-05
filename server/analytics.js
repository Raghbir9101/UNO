// ─── Visit Analytics ──────────────────────────────────────────────────────────
// Records every real page navigation (never assets, socket.io, or API calls)
// with IP, geo (offline via geoip-lite), referrer, UTM source, device class,
// and language. Writes are fire-and-forget: analytics must never add latency
// or errors to a page load. Dashboard aggregations feed /admin/analytics.
// ──────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const geoip = require('geoip-lite');
const Visit = require('./models/Visit');
const { dbReady } = require('./db');

const BOT_RE = /bot|crawler|spider|crawling|facebookexternalhit|whatsapp|telegram|slackbot|discordbot|preview|curl|wget|python-requests|headless/i;
const SKIP_PREFIX = ['/socket.io', '/api', '/admin', '/og/', '/images/', '/css/', '/assets/', '/fonts/'];

function classifyDevice(ua) {
  if (!ua) return 'unknown';
  if (BOT_RE.test(ua)) return 'bot';
  if (/ipad|tablet/i.test(ua)) return 'tablet';
  if (/mobile|android|iphone/i.test(ua)) return 'mobile';
  return 'desktop';
}

function clientIp(req) {
  // trust proxy is enabled, so req.ip already honors X-Forwarded-For;
  // Cloudflare's CF-Connecting-IP is the most reliable when present.
  return req.headers['cf-connecting-ip'] || req.ip || '';
}

// ── Middleware: record the page view, never block the request ──
function middleware(req, res, next) {
  next(); // respond first — tracking is entirely out-of-band

  try {
    if (req.method !== 'GET') return;
    const p = req.path;
    if (SKIP_PREFIX.some(pre => p.startsWith(pre))) return;
    if (/\.[a-z0-9]{2,5}$/i.test(p) && p !== '/play') return; // static files (.js/.css/.png/…)
    if (!dbReady()) return;

    const ua = req.headers['user-agent'] || '';
    const ip = clientIp(req);
    const geo = ip ? geoip.lookup(ip) : null;
    const referer = req.headers.referer || '';
    const day = new Date().toISOString().slice(0, 10);

    Visit.create({
      path: p,
      ip,
      country: geo ? geo.country : null,
      region: geo ? geo.region : null,
      city: geo ? geo.city : null,
      referer: referer.slice(0, 300),
      utmSource: (req.query.utm_source || '').toString().slice(0, 60) || null,
      userAgent: ua.slice(0, 300),
      device: classifyDevice(ua),
      language: (req.headers['accept-language'] || '').split(',')[0].slice(0, 12) || null,
      isBot: BOT_RE.test(ua),
      sessionKey: crypto.createHash('sha256').update(`${ip}|${ua}|${day}`).digest('hex').slice(0, 16),
    }).catch(() => { /* analytics never throws at the visitor */ });
  } catch { /* ditto */ }
}

// ── Dashboard aggregations ──
async function getDashboard() {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const since = (days) => new Date(now - days * dayMs);
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
  const human = { isBot: false }; // headline numbers exclude crawlers

  const [
    visitsToday, visits7d, visits30d, visitsAll,
    uniqToday, uniq7d, uniq30d,
    botHits30d,
    topPages, topCountries, topCities, topReferrers, devices, daily, recent,
  ] = await Promise.all([
    Visit.countDocuments({ ...human, ts: { $gte: startOfToday } }),
    Visit.countDocuments({ ...human, ts: { $gte: since(7) } }),
    Visit.countDocuments({ ...human, ts: { $gte: since(30) } }),
    Visit.countDocuments(human),
    Visit.distinct('sessionKey', { ...human, ts: { $gte: startOfToday } }).then(a => a.length),
    Visit.distinct('sessionKey', { ...human, ts: { $gte: since(7) } }).then(a => a.length),
    Visit.distinct('sessionKey', { ...human, ts: { $gte: since(30) } }).then(a => a.length),
    Visit.countDocuments({ isBot: true, ts: { $gte: since(30) } }),
    Visit.aggregate([
      { $match: { ...human, ts: { $gte: since(30) } } },
      { $group: { _id: '$path', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 10 },
    ]),
    Visit.aggregate([
      { $match: { ...human, ts: { $gte: since(30) }, country: { $ne: null } } },
      { $group: { _id: '$country', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 10 },
    ]),
    Visit.aggregate([
      { $match: { ...human, ts: { $gte: since(30) }, city: { $nin: [null, ''] } } },
      { $group: { _id: { city: '$city', country: '$country' }, count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 10 },
    ]),
    Visit.aggregate([
      { $match: { ...human, ts: { $gte: since(30) }, referer: { $nin: [null, ''] } } },
      // Group referrers by host so google.com/search?q=1 and ?q=2 collapse
      { $project: { host: { $arrayElemAt: [{ $split: [{ $arrayElemAt: [{ $split: ['$referer', '//'] }, 1] }, '/'] }, 0] } } },
      { $match: { host: { $nin: [null, '', 'playunofree.com', 'www.playunofree.com'] } } },
      { $group: { _id: '$host', count: { $sum: 1 } } },
      { $sort: { count: -1 } }, { $limit: 10 },
    ]),
    Visit.aggregate([
      { $match: { ...human, ts: { $gte: since(30) } } },
      { $group: { _id: '$device', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    Visit.aggregate([
      { $match: { ...human, ts: { $gte: since(14) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Visit.find(human).sort({ ts: -1 }).limit(25)
      .select('path ip country city device referer ts').lean(),
  ]);

  return {
    totals: { visitsToday, visits7d, visits30d, visitsAll, uniqToday, uniq7d, uniq30d, botHits30d },
    topPages, topCountries, topCities, topReferrers, devices, daily, recent,
  };
}

module.exports = { middleware, getDashboard };
