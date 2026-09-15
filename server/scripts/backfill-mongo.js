// ─── One-time Mongo backfill ──────────────────────────────────────────────────
// The cloud mirror only upserts a player on their NEXT change, so records that
// existed before the mirror (or that haven't changed since) may be missing from
// MongoDB. This walks every file-store record and upserts it into
// PlayerProgress — but NEVER overwrites a cloud record that is newer than the
// local one (guards the case where the file store was reset but Mongo is ahead).
//
// Safe to re-run (idempotent). Usage:
//   node server/scripts/backfill-mongo.js          (standalone)
//   BACKFILL_ON_BOOT=1 npm start                   (auto-heal on server boot)
// ──────────────────────────────────────────────────────────────────────────────

const { dbReady } = require('../db');
const PlayerProgress = require('../models/PlayerProgress');
const progressStore = require('../progressStore');
const statsStore = require('../statsStore');

function seenOf(progress, stats) {
  return Math.max(
    (progress && progress.lastSeen) || 0,
    (stats && stats.lastSeen) || 0
  );
}

// Runs against an already-connected DB. Returns { upserted, skipped }.
async function runBackfill() {
  if (!dbReady()) {
    console.warn('[backfill] DB not ready — skipped');
    return { upserted: 0, skipped: 0, ok: false };
  }
  const progs = progressStore.all();
  const stats = statsStore.all();
  const uids = new Set([...Object.keys(progs), ...Object.keys(stats)]);

  let upserted = 0;
  let skipped = 0;
  for (const uid of uids) {
    const progress = progs[uid] || null;
    const s = stats[uid] || null;
    if (!progress && !s) continue;
    try {
      const existing = await PlayerProgress.findOne({ uid }).lean();
      if (existing) {
        const localSeen = seenOf(progress, s);
        const cloudSeen = seenOf(existing.progress, existing.stats);
        if (cloudSeen > localSeen) { skipped++; continue; } // cloud is fresher — keep it
      }
      await PlayerProgress.updateOne(
        { uid },
        {
          $set: {
            progress: progress || null,
            stats: s || null,
            name: (progress && progress.name) || (s && s.name) || 'Player',
          },
        },
        { upsert: true }
      );
      upserted++;
    } catch (err) {
      console.error(`[backfill] ${uid} failed:`, err.message);
    }
  }
  console.log(`[backfill] done — upserted ${upserted}, skipped ${skipped} (of ${uids.size})`);
  return { upserted, skipped, ok: true };
}

// Standalone invocation: connect, run, exit.
if (require.main === module) {
  require('dotenv').config();
  const { connectDB } = require('../db');
  (async () => {
    const connected = await connectDB();
    if (!connected) {
      console.error('[backfill] Could not connect to MongoDB (set MONGODB_URI). Aborting.');
      process.exit(1);
    }
    await runBackfill();
    process.exit(0);
  })();
}

module.exports = { runBackfill };
