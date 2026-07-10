// ─── Bug Report API ───────────────────────────────────────────────────────────
// Public endpoint behind the /contact form. Reports are stored in Mongo and
// surfaced on the /admin/analytics dashboard.
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router = express.Router();
const BugReport = require('../models/BugReport');
const { dbReady } = require('../db');

// Per-IP cooldown so the public form can't be spammed (in-memory is fine —
// worst case a restart resets the window)
const COOLDOWN_MS = 60 * 1000;
const lastSubmit = new Map();

function clientIp(req) {
  return req.headers['cf-connecting-ip'] || req.ip || '';
}

router.post('/', async (req, res) => {
  try {
    const { name, email, message, page, website } = req.body || {};

    // Honeypot: real users never fill the hidden "website" field
    if (website) return res.json({ ok: true });

    if (!message || typeof message !== 'string' || message.trim().length < 10) {
      return res.status(400).json({ error: 'Please describe the bug (at least 10 characters).' });
    }
    if (!dbReady()) {
      return res.status(503).json({ error: 'Temporarily unavailable — please email us instead.' });
    }

    const ip = clientIp(req);
    const last = lastSubmit.get(ip) || 0;
    if (Date.now() - last < COOLDOWN_MS) {
      return res.status(429).json({ error: 'Please wait a minute before sending another report.' });
    }
    lastSubmit.set(ip, Date.now());
    if (lastSubmit.size > 5000) lastSubmit.clear();

    await BugReport.create({
      name: (name || '').toString().slice(0, 60),
      email: (email || '').toString().slice(0, 120),
      message: message.toString().slice(0, 2000),
      page: (page || '').toString().slice(0, 200),
      userAgent: (req.headers['user-agent'] || '').slice(0, 300),
      ip,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[bug-report] failed:', err.message);
    res.status(500).json({ error: 'Something went wrong — please email us instead.' });
  }
});

module.exports = router;
