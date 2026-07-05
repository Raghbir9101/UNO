// ─── Auth Routes (/api/auth/*) ────────────────────────────────────────────────
// Email+password register/login plus Google Sign-In (ID token verification).
// Accounts are a portable pointer to the anonymous stats uid: on login the
// client adopts the account's uid, which makes leaderboard stats cross-device.
// Every route degrades to 503 when Mongo is unreachable — the game never dies.
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const User = require('../models/User');
const { dbReady } = require('../db');
const statsStore = require('../statsStore');
const mailer = require('../mailer');
const { AVATAR_EMOJIS, sanitizePicture } = require('../avatars');

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UID_RE = /^[\w-]{8,64}$/;

function requireDb(req, res, next) {
  if (!dbReady()) return res.status(503).json({ error: 'Accounts are temporarily unavailable' });
  if (!JWT_SECRET) return res.status(503).json({ error: 'Auth not configured on this server' });
  next();
}

function issueToken(user) {
  return jwt.sign({ id: user._id.toString() }, JWT_SECRET, { expiresIn: '30d' });
}

function publicUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    username: user.username,
    picture: user.picture || null,
    googlePicture: user.googlePicture || null,
    uid: user.uid || null,
    hasGoogle: !!user.googleId,
  };
}

// Bearer-token gate for account endpoints — sets req.user
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not signed in' });
    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Session expired' });
    }
    const user = await User.findById(payload.id);
    if (!user) return res.status(401).json({ error: 'Account not found' });
    req.user = user;
    next();
  } catch (error) {
    console.error('[auth] requireAuth failed:', error.message);
    res.status(500).json({ error: 'Server error' });
  }
}

// If the account has no stats identity yet, adopt the device's (preserves the
// player's pre-login history). Either way, stamp the verified username onto
// the stats record so the leaderboard shows the reserved name.
function linkUid(user, clientUid) {
  if (!user.uid && clientUid && UID_RE.test(clientUid)) {
    user.uid = clientUid;
  }
  if (user.uid) {
    statsStore.getPlayer(user.uid).name = user.username;
  }
}

// ── Config for the client (which providers are available) ──
router.get('/config', (req, res) => {
  res.json({
    googleClientId: GOOGLE_CLIENT_ID || null,
    accountsAvailable: dbReady() && !!JWT_SECRET,
  });
});

// ── Register ──
router.post('/register', requireDb, async (req, res) => {
  try {
    const { email, username, password, uid } = req.body || {};

    if (!EMAIL_RE.test(email || '')) return res.status(400).json({ error: 'Enter a valid email' });
    const name = (username || '').trim();
    if (name.length < 2 || name.length > 16) return res.status(400).json({ error: 'Username must be 2-16 characters' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(400).json({ error: 'An account with this email already exists' });

    const nameTaken = await User.findOne({ username: name });
    if (nameTaken) return res.status(400).json({ error: 'That username is taken — pick another' });

    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ email, username: name, password: hashed, lastLoginAt: new Date() });
    linkUid(user, uid);
    await user.save();

    res.status(201).json({ success: true, token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) {
      // Unique-index race (username or email landed between check and save)
      return res.status(400).json({ error: 'That username or email is already taken' });
    }
    console.error('[auth] register failed:', error.message);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// ── Login ──
router.post('/login', requireDb, async (req, res) => {
  try {
    const { email, password, uid } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user || !user.password) return res.status(400).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

    linkUid(user, uid);
    user.lastLoginAt = new Date();
    await user.save();

    res.json({ success: true, token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    console.error('[auth] login failed:', error.message);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// ── Google Sign-In ──
// The client sends the Google Identity Services ID token; we verify it against
// Google's tokeninfo endpoint (no extra dependency; Node 22 has global fetch).
router.post('/google', requireDb, async (req, res) => {
  try {
    if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google Sign-In not configured' });
    const { credential, uid } = req.body || {};
    if (!credential || typeof credential !== 'string') return res.status(400).json({ error: 'Missing Google credential' });

    const resp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!resp.ok) return res.status(401).json({ error: 'Invalid Google token' });
    const info = await resp.json();

    if (info.aud !== GOOGLE_CLIENT_ID) return res.status(401).json({ error: 'Google token audience mismatch' });
    if (info.email_verified !== 'true' && info.email_verified !== true) {
      return res.status(401).json({ error: 'Google email not verified' });
    }

    let user = await User.findOne({ googleId: info.sub });
    if (!user) {
      // Same email registered earlier with a password? Link Google to it.
      user = await User.findOne({ email: info.email.toLowerCase() });
      if (user) {
        user.googleId = info.sub;
        if (!user.picture && info.picture) user.picture = info.picture;
      }
    }
    if (!user) {
      // New account. Usernames are unique — derive from the Google name and
      // suffix digits until one is free
      const base = (info.name || info.email.split('@')[0]).trim().substring(0, 12) || 'Player';
      let username = base;
      for (let i = 0; await User.findOne({ username }); i++) {
        if (i > 20) { username = `Player${Date.now() % 100000}`; break; }
        username = `${base}${Math.floor(Math.random() * 1000)}`;
      }
      user = new User({
        email: info.email,
        username,
        googleId: info.sub,
        picture: info.picture || null,
      });
    }
    // Always keep the Google photo on file so "use Google photo" works even
    // after the player switches to an emoji avatar
    if (info.picture) user.googlePicture = info.picture;

    linkUid(user, uid);
    user.lastLoginAt = new Date();
    await user.save();

    res.json({ success: true, token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    console.error('[auth] google failed:', error.message);
    res.status(500).json({ error: 'Server error during Google sign-in' });
  }
});

// ── Forgot Password ──
// Response is identical whether or not the account exists (no enumeration).
// The emailed token is stored hashed; the raw token only ever lives in the link.
const _forgotLastSent = new Map(); // email → ts (basic per-email rate limit)

router.post('/forgot', requireDb, async (req, res) => {
  const generic = { success: true, message: 'If an account exists for that email, a reset link is on its way.' };
  try {
    const email = String((req.body || {}).email || '').toLowerCase().trim();
    if (!EMAIL_RE.test(email)) return res.json(generic);

    const last = _forgotLastSent.get(email) || 0;
    if (Date.now() - last < 60_000) return res.json(generic); // max 1/min per email
    _forgotLastSent.set(email, Date.now());

    const user = await User.findOne({ email });
    if (!user) return res.json(generic);

    const token = crypto.randomBytes(32).toString('hex');
    user.resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    const base = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const link = `${base}/reset-password?token=${token}`;
    const sent = await mailer.sendPasswordReset(user.email, user.username, link);
    if (!sent) {
      // No SMTP configured — surface the link server-side so an admin can help
      console.warn(`[auth] Password reset requested for ${user.email} but SMTP is not configured. Link: ${link}`);
    }
    res.json(generic);
  } catch (error) {
    console.error('[auth] forgot failed:', error.message);
    res.json(generic); // never leak internals on this endpoint
  }
});

// ── Reset Password ──
router.post('/reset', requireDb, async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Invalid reset link' });
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({ resetTokenHash: hash, resetTokenExpires: { $gt: new Date() } });
    if (!user) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });

    user.password = await bcrypt.hash(password, 10);
    user.resetTokenHash = undefined;
    user.resetTokenExpires = undefined;
    user.lastLoginAt = new Date();
    await user.save();

    // Sign them straight in — they just proved account ownership
    res.json({ success: true, token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    console.error('[auth] reset failed:', error.message);
    res.status(500).json({ error: 'Server error during password reset' });
  }
});

// ── Current user ──
router.get('/me', requireDb, requireAuth, (req, res) => {
  res.json({ success: true, user: publicUser(req.user) });
});

// ── Profile: everything the profile page needs in one call ──
router.get('/profile', requireDb, requireAuth, (req, res) => {
  const stats = req.user.uid ? statsStore.getPlayer(req.user.uid) : null;
  res.json({
    success: true,
    user: publicUser(req.user),
    stats: stats ? {
      wins: stats.wins,
      gamesPlayed: stats.gamesPlayed,
      cardsPlayed: stats.cardsPlayed,
      cardsDrawn: stats.cardsDrawn,
      wildsPlayed: stats.wildsPlayed,
      weeklyWins: stats.weekly ? stats.weekly.wins : 0,
      achievements: stats.achievements || [],
    } : null,
    achievementDefs: statsStore.ACHIEVEMENTS,
    avatarEmojis: AVATAR_EMOJIS,
  });
});

// ── Update profile (username and/or avatar) ──
router.put('/profile', requireDb, requireAuth, async (req, res) => {
  try {
    const { username, picture } = req.body || {};
    const user = req.user;

    if (username !== undefined) {
      const name = String(username).trim();
      if (name.length < 2 || name.length > 16) {
        return res.status(400).json({ error: 'Username must be 2-16 characters' });
      }
      if (name !== user.username) {
        const taken = await User.findOne({ username: name, _id: { $ne: user._id } });
        if (taken) return res.status(400).json({ error: 'That username is taken — pick another' });
        user.username = name;
      }
    }

    if (picture !== undefined) {
      if (picture === null || picture === '') {
        user.picture = null; // default letter avatar
      } else if (picture === 'google') {
        if (!user.googlePicture) return res.status(400).json({ error: 'No Google photo on this account' });
        user.picture = user.googlePicture;
      } else {
        const clean = sanitizePicture(picture);
        if (!clean) return res.status(400).json({ error: 'Invalid avatar choice' });
        // Only allow a raw photo URL if it is this account's own Google photo
        if (!clean.startsWith('emoji:') && clean !== user.googlePicture) {
          return res.status(400).json({ error: 'Invalid avatar choice' });
        }
        user.picture = clean;
      }
    }

    await user.save();
    // Keep the leaderboard display name in sync with the account name
    if (user.uid) statsStore.getPlayer(user.uid).name = user.username;

    res.json({ success: true, user: publicUser(user) });
  } catch (error) {
    if (error.code === 11000) return res.status(400).json({ error: 'That username is taken — pick another' });
    console.error('[auth] profile update failed:', error.message);
    res.status(500).json({ error: 'Server error updating profile' });
  }
});

module.exports = router;
