// ─── MongoDB Connection ───────────────────────────────────────────────────────
// Accounts and analytics live in Mongo, but the game itself must never depend
// on it: if the DB is down or MONGODB_URI is missing, gameplay continues and
// the account/analytics features simply report themselves unavailable.
// ──────────────────────────────────────────────────────────────────────────────

// Polyfill global crypto for Node 18.x so the MongoDB driver doesn't crash
// with "crypto is not defined" when trying to generate UUIDs/hashes.
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('crypto').webcrypto;
}

const mongoose = require('mongoose');

async function connectDB() {
  if (!process.env.MONGODB_URI) {
    console.warn('[db] MONGODB_URI not set — accounts & analytics disabled');
    return false;
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
    });
    console.log(`[db] MongoDB connected: ${mongoose.connection.host}`);
    return true;
  } catch (error) {
    // Do NOT exit — the game runs fine without the database
    console.error(`[db] MongoDB connection failed (accounts/analytics disabled): ${error.message}`);
    return false;
  }
}

function dbReady() {
  return mongoose.connection.readyState === 1;
}

module.exports = { connectDB, dbReady };
