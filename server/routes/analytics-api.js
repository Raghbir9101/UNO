// ─── Analytics API Routes ─────────────────────────────────────────────────────
// RESTful endpoints for filtered analytics data with pagination and search.
// Powers the enhanced admin dashboard's interactive filters.
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router = express.Router();
const Visit = require('../models/Visit');

// Middleware: verify admin key
function requireAdminKey(req, res, next) {
  const key = process.env.ADMIN_KEY;
  const provided = req.query.key || req.headers['x-admin-key'];
  if (!key || provided !== key) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

router.use(requireAdminKey);

// GET /api/analytics/visits - Paginated visits with filters
router.get('/visits', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;

    // Build filter query
    const filter = { isBot: false };

    // Time range filter
    const timeRange = req.query.timeRange || '7d';
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    if (timeRange === 'today') {
      filter.ts = { $gte: new Date(new Date().setHours(0, 0, 0, 0)) };
    } else if (timeRange === '7d') {
      filter.ts = { $gte: new Date(now - 7 * dayMs) };
    } else if (timeRange === '30d') {
      filter.ts = { $gte: new Date(now - 30 * dayMs) };
    } else if (timeRange === '90d') {
      filter.ts = { $gte: new Date(now - 90 * dayMs) };
    }

    // Device filter
    if (req.query.device && req.query.device !== 'all') {
      filter.device = req.query.device;
    }

    // Country filter
    if (req.query.country && req.query.country !== 'all') {
      filter.country = req.query.country;
    }

    // Path search
    if (req.query.pathSearch) {
      filter.path = { $regex: req.query.pathSearch, $options: 'i' };
    }

    const [visits, total] = await Promise.all([
      Visit.find(filter)
        .sort({ ts: -1 })
        .skip(skip)
        .limit(limit)
        .select('path ip country city device referer ts')
        .lean(),
      Visit.countDocuments(filter),
    ]);

    res.json({
      visits,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('[analytics-api] visits failed:', err.message);
    res.status(500).json({ error: 'Query failed' });
  }
});

// GET /api/analytics/summary - Aggregate stats for current filters
router.get('/summary', async (req, res) => {
  try {
    const filter = { isBot: false };

    // Time range
    const timeRange = req.query.timeRange || '7d';
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    if (timeRange === 'today') {
      filter.ts = { $gte: new Date(new Date().setHours(0, 0, 0, 0)) };
    } else if (timeRange === '7d') {
      filter.ts = { $gte: new Date(now - 7 * dayMs) };
    } else if (timeRange === '30d') {
      filter.ts = { $gte: new Date(now - 30 * dayMs) };
    } else if (timeRange === '90d') {
      filter.ts = { $gte: new Date(now - 90 * dayMs) };
    }

    // Device filter
    if (req.query.device && req.query.device !== 'all') {
      filter.device = req.query.device;
    }

    // Country filter
    if (req.query.country && req.query.country !== 'all') {
      filter.country = req.query.country;
    }

    const [totalVisits, uniqueVisitors, topPages, topCountries, devices] = await Promise.all([
      Visit.countDocuments(filter),
      Visit.distinct('sessionKey', filter).then(a => a.length),
      Visit.aggregate([
        { $match: filter },
        { $group: { _id: '$path', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      Visit.aggregate([
        { $match: { ...filter, country: { $ne: null } } },
        { $group: { _id: '$country', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      Visit.aggregate([
        { $match: filter },
        { $group: { _id: '$device', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    res.json({
      totalVisits,
      uniqueVisitors,
      topPages,
      topCountries,
      devices,
    });
  } catch (err) {
    console.error('[analytics-api] summary failed:', err.message);
    res.status(500).json({ error: 'Query failed' });
  }
});

// GET /api/analytics/timeseries - Daily/hourly breakdown
router.get('/timeseries', async (req, res) => {
  try {
    const filter = { isBot: false };
    const granularity = req.query.granularity || 'daily'; // 'hourly' or 'daily'
    const days = parseInt(req.query.days) || 14;

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    filter.ts = { $gte: new Date(now - days * dayMs) };

    // Device/country filters
    if (req.query.device && req.query.device !== 'all') {
      filter.device = req.query.device;
    }
    if (req.query.country && req.query.country !== 'all') {
      filter.country = req.query.country;
    }

    const format = granularity === 'hourly' ? '%Y-%m-%d %H:00' : '%Y-%m-%d';

    const data = await Visit.aggregate([
      { $match: filter },
      { $group: {
        _id: { $dateToString: { format, date: '$ts' } },
        count: { $sum: 1 },
        uniqueVisitors: { $addToSet: '$sessionKey' },
      }},
      { $project: {
        _id: 1,
        count: 1,
        uniqueVisitors: { $size: '$uniqueVisitors' },
      }},
      { $sort: { _id: 1 } },
    ]);

    res.json({ data, granularity });
  } catch (err) {
    console.error('[analytics-api] timeseries failed:', err.message);
    res.status(500).json({ error: 'Query failed' });
  }
});

// GET /api/analytics/geo - Geographic breakdown with lat/lng for map
router.get('/geo', async (req, res) => {
  try {
    const filter = { isBot: false };

    // Time range
    const timeRange = req.query.timeRange || '30d';
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    if (timeRange === '7d') {
      filter.ts = { $gte: new Date(now - 7 * dayMs) };
    } else if (timeRange === '30d') {
      filter.ts = { $gte: new Date(now - 30 * dayMs) };
    } else if (timeRange === '90d') {
      filter.ts = { $gte: new Date(now - 90 * dayMs) };
    }

    const countries = await Visit.aggregate([
      { $match: { ...filter, country: { $ne: null } } },
      { $group: {
        _id: { country: '$country', city: '$city' },
        count: { $sum: 1 },
      }},
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]);

    res.json({ countries });
  } catch (err) {
    console.error('[analytics-api] geo failed:', err.message);
    res.status(500).json({ error: 'Query failed' });
  }
});

// GET /api/analytics/paths - Path performance with metrics
router.get('/paths', async (req, res) => {
  try {
    const filter = { isBot: false };
    const timeRange = req.query.timeRange || '30d';
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    if (timeRange === '7d') {
      filter.ts = { $gte: new Date(now - 7 * dayMs) };
    } else if (timeRange === '30d') {
      filter.ts = { $gte: new Date(now - 30 * dayMs) };
    }

    const paths = await Visit.aggregate([
      { $match: filter },
      { $group: {
        _id: '$path',
        visits: { $sum: 1 },
        uniqueVisitors: { $addToSet: '$sessionKey' },
        devices: { $addToSet: '$device' },
      }},
      { $project: {
        path: '$_id',
        visits: 1,
        uniqueVisitors: { $size: '$uniqueVisitors' },
        deviceCount: { $size: '$devices' },
      }},
      { $sort: { visits: -1 } },
      { $limit: 20 },
    ]);

    res.json({ paths });
  } catch (err) {
    console.error('[analytics-api] paths failed:', err.message);
    res.status(500).json({ error: 'Query failed' });
  }
});

module.exports = router;
