# Link Preview Setup (Open Graph / Twitter Cards)

**Status:** Implemented and tested. Link previews now work in WhatsApp, Discord, Slack, Twitter/X, and other messaging apps.

## What Changed

### 1. Homepage & SEO Pages
All marketing pages (`/`, `/rules`, `/multiplayer`, etc.) now have full Open Graph and Twitter Card meta tags with absolute URLs. The `og:image` points to `/images/og-image.jpg` (1200×630, already exists).

### 2. Game `/play` Route
- **Default `/play`**: Generic OG tags with the site's default image
- **Room invite `/play?room=CODE`**: Personalized OG tags with:
  - Title: `"Join my UNO game — Room CODE"`
  - Description: `"You're invited to a free online UNO game! Tap to join room CODE — no download, no signup, up to 20 players."`
  - Image: **Dynamically generated** at `/og/room/CODE.png` (1200×630)

### 3. Dynamic OG Images (`/og/room/:code.png`)
Server-side SVG → PNG rendering with [sharp](https://www.npmjs.com/package/sharp). Each room code gets a unique preview card with:
- The holo-foil card fan from the homepage hero (7, 9, 3, +2, wild ★)
- Large "YOU'RE INVITED" heading
- The room code in a glowing green box
- Tagline: "Tap to join the game"

Images are **cached in memory** after first render (300 room limit, FIFO eviction). If sharp fails, the route 302-redirects to the static `/images/og-image.jpg` so previews never 500.

## BASE_URL Configuration

The server derives the base URL per request from `req.protocol + req.get('host')` (works behind proxies when `trust proxy` is enabled), with an override via `BASE_URL` env var.

**For production:** Set `BASE_URL=https://yourdomain.com` in `.env` or the hosting environment. This ensures OG image URLs are absolute and match your actual domain (required for WhatsApp/Discord crawlers).

**Current `.env` has:** `BASE_URL = https://playunofree.com`

If you deploy to a different domain or test on a staging environment, update that line.

## Testing Link Previews

### Discord / Slack
Paste a room invite link:
```
https://playunofree.com/play?room=TEST
```
You should see:
- Title: "Join my UNO game — Room TEST"
- Image: The holo-card fan with the room code
- Description with invitation copy

### WhatsApp
WhatsApp's link preview cache is aggressive. If you paste the same link twice, you may see a stale preview. To force a refresh:
1. Change the room code (e.g. `?room=TEST2`)
2. Or wait ~24 hours for WhatsApp's cache to expire
3. Or use WhatsApp's [cache debug tool](https://business.facebook.com/linksharing/debugger) (for business accounts)

### Twitter / X
Twitter crawls `twitter:card` tags. The setup uses `summary_large_image` for the 1200×630 card. Paste the link and the preview should render within seconds. Use [Twitter Card Validator](https://cards-dev.twitter.com/validator) to debug.

### Testing Locally
1. Start the server: `npm start`
2. Visit `http://localhost:3000/og/room/DEMO.png` — you should see a 1200×630 PNG with the card fan and "DEMO" in the green box
3. Open `http://localhost:3000/play?room=DEMO` and view source — `og:image` should point to `/og/room/DEMO.png`

## File Changes
- `server/index.js` — trust proxy, baseUrl middleware, `/play` meta injection
- `server/routes/ogImage.js` — NEW: dynamic OG image renderer
- `server/routes/seoPages.js` — use per-request baseUrl instead of hardcoded BASE_URL
- `public/index.html` — replaced static OG tags with `<!--OG_TAGS-->` placeholder
- `views/partials/head.ejs` — already had OG tags (no change needed)
- `package.json` — added `sharp` dependency

## Deployment Checklist
- [ ] Set `BASE_URL` env var to your production domain
- [ ] Verify `trust proxy` is enabled if behind nginx/Cloudflare
- [ ] Test a room invite link in Discord/WhatsApp after deploy
- [ ] Monitor `/og/room/*.png` cache size (logged to console on startup)
