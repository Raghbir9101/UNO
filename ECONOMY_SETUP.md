# Economy v2 — Setup & Operations

A full coin economy: a tabbed **Store** (cosmetics · coin packs · VIP · season pass), an **Earn** hub (daily login, rewarded ads, spin-the-wheel, refer-and-earn, coin gifting), a **Wallet** with transaction history, and **room chat** with emoji.

Coins are **server-authoritative** and **durable** (MongoDB-backed). Everything purchasable is **cosmetic/convenience only — never pay-to-win**.

---

## How it behaves out of the box (no config)

Everything works free-to-play with **zero** setup:

- Coins earned via games, daily login, challenges, achievements, **rewarded ads** (dev placeholder), the **wheel**, and **referrals**.
- Real-money tiles (coin packs, VIP) show a friendly "not enabled yet" note.
- Rewarded ads play a short in-app placeholder that grants the reward — so the whole flow is demonstrable before you have an ad network.

Add the env vars below to switch on real money and real rewarded ads.

---

## Environment variables (`.env`)

| Var | Purpose |
|-----|---------|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay API keys. Start with test keys (`rzp_test_…`). Enables coin packs + VIP. |
| `RAZORPAY_WEBHOOK_SECRET` | Verifies the server-to-server webhook (backstop for the client verify). |
| `GAM_NETWORK_CODE`, `GAM_REWARDED_AD_UNIT` | Google Ad Manager rewarded-ad slot. When both are set, real rewarded ads replace the placeholder. |
| `BACKFILL_ON_BOOT` | `1` = on startup, sweep any file-store records not yet mirrored into MongoDB. |

### Rewarded ads — why Google Ad Manager, not AdSense
Plain **AdSense has no rewarded-ad format for the web**, and gating a reward behind an AdSense *display* impression violates Google's incentivized-views policy (it can get your AdSense account flagged — which you don't want mid-approval). Google's rewarded ads come through **Google Ad Manager (GAM)** via the Google Publisher Tag, and AdSense can serve as demand *inside* GAM. This integration loads GPT on demand and is kept entirely separate from your AdSense display units.

> Web GAM rewarded ads grant via a client-side callback (there's no server-to-server reward token like AdMob mobile). Server trust is therefore enforced by a per-day cap, a cooldown, and a single-use server nonce issued per ad — see `AD_REWARD` in `server/rewards/config.js`.

### Razorpay webhook
Dashboard → Settings → Webhooks → add:
- **URL:** `https://playunofree.com/api/payments/webhook`
- **Events:** `payment.captured`, `order.paid`
- **Secret:** the value you put in `RAZORPAY_WEBHOOK_SECRET`

Grants are idempotent (a `Payment` doc flips `draft → paid` exactly once), so a replayed verify or webhook never double-credits.

---

## All amounts are config-driven
Every number — ad reward + caps, wheel prize table, referral bonuses, gift limits, season tiers, coin-pack SKUs, VIP durations — lives in [`server/rewards/config.js`](server/rewards/config.js). Change prices/rewards there; no engine code changes needed.

---

## Data & durability

- Balances live in `data/player-progress.json` (authoritative, per anonymous `uid`) and mirror to MongoDB (`PlayerProgress`).
- Every coin movement goes through one `recordCoins()` choke point → a capped in-record ledger **and** the Mongo `CoinLedger` audit log (powers the Wallet).
- **Durability fix:** `GET /api/progress` now hydrates a balance from Mongo when the file store has no record for that uid (redeploy / fresh server / new instance), so anonymous coins no longer "reset to 0".
- **One-time backfill** for records that predate the mirror:
  ```bash
  node server/scripts/backfill-mongo.js      # standalone, idempotent
  # or
  BACKFILL_ON_BOOT=1 npm start               # auto-heal on boot
  ```
  It never overwrites a Mongo record that is newer than the local one.

---

## Anti-abuse summary
- All grants server-side with per-IST-day idempotency, caps, and cooldowns.
- Rewarded ads: daily cap + cooldown + single-use nonce.
- Referrals: referee bonus once; referrer paid only after the referee finishes N games; no self-referral; lifetime payout cap.
- Gifting: sign-in required, per-day send cap, balance-checked.
- Payments: HMAC signature verified; idempotent grant by order id.
- Chat: length cap, rate limit, control-char stripping, profanity mask.
