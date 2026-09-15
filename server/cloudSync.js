// ─── Cloud Sync ───────────────────────────────────────────────────────────────
// Keeps player progression (coins/XP/inventory) and lifetime stats mirrored in
// MongoDB so a signed-in player's data survives redeploys and follows them to
// any device. The JSON file stores stay the live source of truth — Mongo is a
// write-through mirror (debounced, fire-and-forget; the game never waits on it).
//
//   markDirty(uid)          → schedule an upsert of that player's records
//   hydrate(uid)            → on login: pull the cloud record into the local
//                             stores when the local copy is missing
//   mergeLocalInto(from,to) → on login from a new device: fold the device's
//                             anonymous progress into the account's uid
//
// Requiring this module wires the store onChange hooks — do it once at boot.
// ──────────────────────────────────────────────────────────────────────────────

const { dbReady } = require('./db');
const PlayerProgress = require('./models/PlayerProgress');
const CoinLedger = require('./models/CoinLedger');
const progressStore = require('./progressStore');
const statsStore = require('./statsStore');
const config = require('./rewards/config');

const FLUSH_DEBOUNCE_MS = 3000;

const _dirty = new Set();
let _flushTimer = null;

function markDirty(uid) {
  if (!uid) return;
  _dirty.add(uid);
  clearTimeout(_flushTimer);
  _flushTimer = setTimeout(() => { flush(); }, FLUSH_DEBOUNCE_MS);
}

async function flush() {
  if (!dbReady() || _dirty.size === 0) return;
  const uids = [..._dirty];
  _dirty.clear();
  for (const uid of uids) {
    const progress = progressStore.peek(uid);
    const stats = statsStore.peek(uid);
    if (!progress && !stats) continue;
    try {
      await PlayerProgress.updateOne(
        { uid },
        {
          $set: {
            progress: progress || null,
            stats: stats || null,
            name: (progress && progress.name) || (stats && stats.name) || 'Player',
          },
        },
        { upsert: true }
      );
    } catch (err) {
      console.error('[cloud-sync] upsert failed:', err.message);
      _dirty.add(uid); // retry on the next flush
    }
  }
}

// On login/session-restore: if this server has no local record for the
// account's uid (fresh deploy, new machine, second instance), pull the cloud
// copy into the file stores so the player keeps everything.
async function hydrate(uid) {
  if (!uid || !dbReady()) return false;
  try {
    const doc = await PlayerProgress.findOne({ uid }).lean();
    if (!doc) return false;
    let restored = false;
    if (doc.progress && !progressStore.has(uid)) {
      progressStore.restore(uid, doc.progress);
      restored = true;
    }
    if (doc.stats && !statsStore.has(uid)) {
      statsStore.restore(uid, doc.stats);
      restored = true;
    }
    if (restored) console.log(`[cloud-sync] hydrated ${uid} from MongoDB`);
    return restored;
  } catch (err) {
    console.error('[cloud-sync] hydrate failed:', err.message);
    return false;
  }
}

// On any read of a player who has no local record yet, pull their cloud copy
// first. This is what makes anonymous balances survive a redeploy or a fresh
// server instance: without it, getPlayer() would mint a new 0-coin record even
// though the real balance is sitting in Mongo. Cheap — the findOne only fires
// when the local record is genuinely absent.
async function ensureHydrated(uid) {
  if (!uid || progressStore.has(uid)) return false;
  return hydrate(uid);
}

// ── Coin ledger (full durable history + audit trail) ──────────────────────────
// Fire-and-forget: the file store already holds the authoritative balance and a
// capped recent slice, so a failed ledger write never corrupts coins.
function appendLedger(uid, delta, reason, balanceAfter, meta) {
  if (!uid || !dbReady()) return;
  CoinLedger.create({ uid, delta, reason, balanceAfter, meta: meta || undefined })
    .catch(err => console.error('[cloud-sync] ledger append failed:', err.message));
}

// Recent transactions for the wallet view. Returns null when the DB is
// unavailable so callers can fall back to the capped in-record ledger.
async function recentLedger(uid, limit = 40) {
  if (!uid || !dbReady()) return null;
  try {
    const rows = await CoinLedger.find({ uid }).sort({ createdAt: -1 }).limit(Math.min(limit, 100)).lean();
    return rows.map(r => ({ t: +new Date(r.createdAt), d: r.delta, r: r.reason, b: r.balanceAfter, m: r.meta || null }));
  } catch (err) {
    console.error('[cloud-sync] ledger read failed:', err.message);
    return null;
  }
}

// ── Anonymous-device merge ────────────────────────────────────────────────────
// A player grinds coins anonymously on a new phone, then signs in: their
// device uid ≠ account uid. Fold the anonymous record into the account once,
// then delete it so it can never double-merge.

function totalXpOf(rec) {
  let total = rec.xp || 0;
  for (let l = 1; l < (rec.level || 1); l++) total += config.xpToNext(l);
  return total;
}

function levelFromTotalXp(total) {
  let level = 1;
  let xp = total;
  while (level < config.MAX_LEVEL && xp >= config.xpToNext(level)) {
    xp -= config.xpToNext(level);
    level++;
  }
  return { level, xp };
}

function mergeLocalInto(fromUid, toUid) {
  if (!fromUid || !toUid || fromUid === toUid) return false;
  const from = progressStore.peek(fromUid);
  const fromStats = statsStore.peek(fromUid);
  if (!from && !fromStats) return false;

  if (from) {
    const to = progressStore.getPlayer(toUid);
    to.coins = (to.coins || 0) + (from.coins || 0);
    // Combine XP as totals, then recompute level. Level-unlock grants are NOT
    // re-run (no double coins/cosmetics) — unlockedLevels is unioned instead.
    const lv = levelFromTotalXp(totalXpOf(to) + totalXpOf(from));
    to.level = lv.level;
    to.xp = lv.xp;
    to.inventory = [...new Set([...(to.inventory || []), ...(from.inventory || [])])];
    to.unlockedLevels = [...new Set([...(to.unlockedLevels || []), ...(from.unlockedLevels || [])])];
    // The account keeps its own equipped set and challenge buckets (merging
    // half-done challenges would double-pay rewards). Streak: adopt the
    // device's only when the account has none at all.
    if (!to.lastClaimDay && from.lastClaimDay) {
      to.streak = from.streak || 0;
      to.lastClaimDay = from.lastClaimDay;
    }
    progressStore.remove(fromUid);
    progressStore.saveSoon(toUid);
  }

  if (fromStats) {
    const toS = statsStore.getPlayer(toUid);
    toS.wins += fromStats.wins || 0;
    toS.gamesPlayed += fromStats.gamesPlayed || 0;
    toS.cardsPlayed += fromStats.cardsPlayed || 0;
    toS.cardsDrawn += fromStats.cardsDrawn || 0;
    toS.wildsPlayed += fromStats.wildsPlayed || 0;
    toS.achievements = [...new Set([...(toS.achievements || []), ...(fromStats.achievements || [])])];
    if (fromStats.weekly && toS.weekly && fromStats.weekly.week === toS.weekly.week) {
      toS.weekly.wins += fromStats.weekly.wins || 0;
      toS.weekly.games += fromStats.weekly.games || 0;
    }
    statsStore.remove(fromUid);
    statsStore.saveNow();
  }

  markDirty(toUid);
  console.log(`[cloud-sync] merged anonymous ${fromUid} into account ${toUid}`);
  return true;
}

// ── Wire the store hooks (every local mutation schedules a cloud upsert) ─────
progressStore.onChange = markDirty;
statsStore.onChange = markDirty;

module.exports = {
  markDirty, flush, hydrate, ensureHydrated, mergeLocalInto,
  appendLedger, recentLedger,
};
