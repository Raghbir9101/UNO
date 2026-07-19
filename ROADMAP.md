# Play UNO Free — Platform Roadmap

Goal: the best free online UNO platform. No pay-to-win, cosmetics are visual
only, everything earnable by playing.

## ✅ Phase 1 — SHIPPED: Modular Game Modes Foundation

The keystone everything else builds on.

- **Shared rules registry** — `public/shared/game-modes.js` (UMD: server `require`s
  it, browser gets `window.GameModes`). Single source of truth for every mode
  and rule: type, bounds, defaults, labels, descriptions, per-mode locks.
  - **Adding a rule** = one entry in `RULES` + reading `settings.<key>` in the engine.
  - **Adding a mode** = one entry in `MODES` (overrides + locked keys). Zero
    changes anywhere else — UI, validation, persistence, and broadcasting are
    all registry-driven.
- **Modes**: Classic (pure official rules), **UNO No Mercy** (stacking matrix,
  Wild +8, Shuffle Hands, Wild Challenge, elimination at 25 cards, last player
  standing), **Custom** (every rule host-configurable).
- **Engine** (`server/gameLogic.js`): granular stacking (+2/+4/mixed families,
  Skip Dodge, Reverse Bounce), Force Play, Draw-to-Match, Seven-Zero, Jump-In,
  Wild Challenge (with legality tracking), Shuffle Hands card, elimination,
  configurable starting cards, per-room turn timer and max players.
- **Server** (`server/index.js`): shared `applyPlayResult` pipeline used by both
  the socket handler and bot/AFK auto-play (no duplicated emit logic), new
  events (`set_mode`, `challenge_wild4`, `player_eliminated`, `hands_shuffled`,
  `stack_passed`, `challenge_result`), registry-validated `set_rule`.
- **Client**: mode selector + fully dynamic rules panel (rendered from the
  registry; visible to all players, editable by host), challenge prompt bar,
  elimination/shuffle animations, mode badges in the room browser, shuffle
  card face — new card types render with zero renderer changes
  (`getCardDisplayText` / `isWildCard` are data-driven).
- **Verified**: 125-game engine simulation across all modes (card conservation,
  turn-order, elimination invariants) + live end-to-end socket test.

**Later additions to this foundation:**
- **UNO Grace Time** rule — host-configurable UNO-catch grace window (100–1000ms).
- **Play for Places** rule — the first player out wins, but the round continues
  so everyone earns a final rank (2nd, 3rd, …). Engine tracks `finishOrder`,
  `recordFinish`/`computeStandings` produce the standings; server emits
  `player_finished` (with place) mid-round and threads `standings` + per-player
  `place` into `game_over_stats`; rewards give a podium bonus (config
  `PLACEMENT`). Mutually exclusive with Elimination (opposite win models —
  enforced in the registry). Post-game panel shows medals + ordinal ranks.

### How to add things now
| Want | Do |
| --- | --- |
| New rule | Add to `RULES`, read `settings.key` in `gameLogic.js` |
| New mode (e.g. UNO Flip base) | Add to `MODES` |
| New card type | Emit from deck builder + a `case` in `playCard` + one line in `CardTypeDisplay` |

---

## ✅ Phase 2+3 — SHIPPED: Progression & Economy

The full engagement loop, server-authoritative, works without signup (keyed by
the anonymous `uno_uid`, same identity as the leaderboard) and without Mongo
(file-backed `server/progressStore.js`, same pattern as `statsStore`).

- **Rewards Engine** (`server/rewards/engine.js`) — consumes game-end summary
  rows from `recordGameEnd` and grants coins/XP/level-ups/achievements/challenge
  progress in one place. Every amount lives in `server/rewards/config.js`
  (coin/XP sources, level curve, level-unlock table, login calendar) — nothing
  hardcoded. Day/week boundaries are IST (config `TZ_OFFSET_MIN`).
- **Achievements registry** (`server/rewards/achievements.js`) — 17 achievements
  with display fields + coin/XP reward + condition fn over (game row, lifetime
  stats, game context). Deduped through the existing `statsStore` unlock flags;
  `statsStore.ACHIEVEMENTS` now re-exports the display defs so the profile API
  kept working unchanged. Engine tracks per-type card counts + UNO calls to
  power conditions (Reverse Master, Draw Four Master, UNO! …).
- **Challenges registry** (`server/rewards/challenges.js`) — daily + weekly
  pools; 3 of each active at a time, picked deterministically from the day/week
  key (every player chases the same set; no server state, no cron).
- **Daily login calendar** — 7-day repeating streak (25→300 coins), streak
  resets on a missed day, idempotent claims.
- **API** — `GET /api/progress?uid=` (one call: coins, level, XP bar, login
  calendar, both challenge lists, achievements), `POST /api/progress/claim-daily`.
- **Client** — coins/level chip in the lobby (pulsing dot when the daily reward
  is unclaimed), rewards modal (level ring, XP bar, claimable calendar,
  challenge progress bars), post-game rewards strip (+coins/+XP/level-ups/
  completed challenges) in the existing stats panel, level-up burst animation.
- **Verified**: 31-test engine suite (mocked clock for streak/rollover paths,
  achievement dedupe, level-window invariants, no condition-fn leakage) + live
  API e2e (claim idempotency, uid validation).

**Cloud persistence (added later the same phase):** signed-in players' data is
mirrored to MongoDB (`PlayerProgress` model + `server/cloudSync.js`):
- **Write-through** — every progress/stats mutation marks the uid dirty; a
  debounced flush upserts `{ uid, progress, stats }` to Mongo. Fire-and-forget:
  the game never waits on the DB, and the JSON files stay the live source.
- **Hydrate on login / session restore** — if the server has no local record
  for the account's uid (redeploy, new machine, second instance), the cloud
  copy is pulled into the file stores before the client fetches progress.
- **Anonymous-device merge** — logging in on a device that was playing
  anonymously folds those coins/XP/inventory/stats into the account (XP
  recombined as totals, unions for inventory/achievements, no double
  challenge/unlock payouts), then deletes the anonymous record.

## ✅ Phase 4 — SHIPPED: Cosmetics Shop & Inventory

- **Cosmetics registry** (`public/shared/cosmetics.js`, same UMD pattern as
  game-modes): 32 items across 5 categories — 6 card themes (palettes that
  keep R/B/G/Y recognizable), 7 table themes, 6 card backs, 8 avatars,
  5 victory effects. Each item = id, category, name, price, rarity, render
  params. Adding an item = one registry entry.
- **Server**: `inventory[]` + `equipped{}` on the progress record (lazy
  migration), `buyItem`/`equipItem`/`getVictoryFx` in the rewards engine
  (coin checks, ownership checks, category validation), API at
  `POST /api/progress/shop/buy` and `/shop/equip`. Level-unlock cosmetics
  (config `LEVEL_UNLOCKS`) now drop straight into the inventory on level-up.
- **Live theming**: the renderer reads `Cosmetics.active` every frame — table
  background, card backs, and the CardColors palette all swap instantly on
  equip, no reload. Equipped state cached in localStorage so the theme is
  right from the first frame.
- **Victory effects travel**: `player_won` (single `emitPlayerWon` helper now)
  carries the winner's equipped effect — the whole table sees their
  celebration (confetti / fireworks / golden burst / card explosion / royale).
- **Avatars**: purchased emoji avatars become the seat picture for anonymous
  players too (localStorage + join payload); server avatar whitelist extended
  from the registry.
- **Shop UI**: 🛍️ in the app bar → tabbed modal with live previews (palette
  dots, table gradients, mini card backs), rarity labels, "free at Lv N"
  hints, buy → auto-equip, tap-to-unequip.
- Still open: seasonal items (`availableFrom/Until` registry fields), emote
  packs (needs the emote whitelist to become registry-driven), strict
  server-side ownership check on avatar emojis at join time.

## Phase 5 — Profiles, History, Leaderboards

- Public profile page `/player/:username` (server-rendered EJS like
  `/leaderboard` — SEO benefit).
- Match history: extend `GameHistory` (already stores every game) with per-mode
  filters and pagination API.
- Leaderboard windows (daily/weekly/monthly/all-time) and categories (wins,
  win rate, level, streak) — aggregate from `GameHistory` + `PlayerProgress`.

## Phase 6 — Social & Viral

- Share cards: `routes/ogImage.js` already generates room OG images — add a
  match-result variant (winner, MVP, duration) + share links.
- Referrals: `?ref=uid` on invite links → coin grant when referee finishes a game.
- Friends system (requests, online status, invites) + party join.
- Badges (early supporter, event winner) as cosmetics-registry entries.

## Phase 7 — Modes II

- **UNO Flip**: new deck builder (dual-faced cards `{ light: {...}, dark: {...} }`),
  `state.side` flag, flip card handling in `playCard`, renderer draws the active
  face, table-flip animation. Registry entry locks its rules.
- Replay system: append `(playerId, action, payload)` to a move log in game
  state (persist alongside `GameHistory`) → replay = re-running the engine.
- Spectator polish (counter, chip), ranked/tournament later.

## Phase 8 — Admin & Ops

- Extend `/admin/analytics` (already shows live rooms, history, bug reports)
  with: economy overview, challenge/cosmetics management (CRUD over the
  registries), feature flags (per-mode enable/disable via registry `enabled`
  flag), broadcast announcements (io.emit → toast).

---

### Standing constraints
- 20-player performance first: never block the event loop, keep payloads lean.
- All meta writes fire-and-forget like `GameHistory` — the game never waits on Mongo.
- Rewards server-authoritative; clients only display.
- No real-money purchases, ever.
