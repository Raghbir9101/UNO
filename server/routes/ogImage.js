// ─── Dynamic Open Graph Images ────────────────────────────────────────────────
// Renders 1200×630 link-preview images (WhatsApp/Discord/Twitter) on the fly.
// /og/room/:code.png — room invite preview with the room code on the card table.
// Images are pure SVG rasterized with sharp and cached in memory (a code's
// image never changes, and the global cache middleware adds max-age=86400).
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express');
const sharp = require('sharp');
const router = express.Router();

const CODE_RE = /^[A-Z0-9]{3,10}$/;
const cache = new Map(); // code → PNG buffer
const MAX_CACHE = 300;

// The four UNO accents + card body colors, matching site.css
const C = {
  bg: '#05070d',
  panel: '#0b0f1a',
  cardTop: '#1a2237',
  cardBottom: '#0a0e1c',
  steel: '#8b93a8',
  white: '#e8ebf3',
  red: '#ff3b5c',
  yellow: '#ffd23f',
  green: '#2ee88a',
  blue: '#3d9dff',
};

const FONT = 'DejaVu Sans, Verdana, Arial, sans-serif';

// One fanned card: obsidian slab, emissive color core + border, center pip.
// Wild cards (color=null) get a four-corner prism glow and a drawn star
// instead of a text pip (a ★ glyph may be missing from server fonts).
function fanCard({ x, y, rot, color, hot, pip, uid }) {
  const W = 150, H = 225, R = 16;
  const body = `
    <linearGradient id="body-${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.cardTop}"/>
      <stop offset="1" stop-color="${C.cardBottom}"/>
    </linearGradient>`;
  const core = color
    ? `<radialGradient id="core-${uid}" cx="0.5" cy="0.45" r="0.62">
         <stop offset="0" stop-color="${color}" stop-opacity="0.36"/>
         <stop offset="1" stop-color="${color}" stop-opacity="0"/>
       </radialGradient>`
    : ['red', 'yellow', 'blue', 'green'].map((k, i) => {
        const cx = i % 2 === 0 ? 0.24 : 0.76, cy = i < 2 ? 0.2 : 0.8;
        return `<radialGradient id="core-${uid}-${i}" cx="${cx}" cy="${cy}" r="0.55">
          <stop offset="0" stop-color="${C[k]}" stop-opacity="0.34"/>
          <stop offset="1" stop-color="${C[k]}" stop-opacity="0"/>
        </radialGradient>`;
      }).join('');
  const coreFill = color
    ? `<rect width="${W}" height="${H}" rx="${R}" fill="url(#core-${uid})"/>`
    : [0, 1, 2, 3].map(i => `<rect width="${W}" height="${H}" rx="${R}" fill="url(#core-${uid}-${i})"/>`).join('');
  const border = color
    ? `<rect x="0.75" y="0.75" width="${W - 1.5}" height="${H - 1.5}" rx="${R}" fill="none" stroke="${color}" stroke-opacity="0.6" stroke-width="1.5"/>`
    : `<rect x="0.75" y="0.75" width="${W - 1.5}" height="${H - 1.5}" rx="${R}" fill="none" stroke="url(#prism-${uid})" stroke-width="1.5"/>
       <linearGradient id="prism-${uid}" x1="0" y1="0" x2="1" y2="1">
         <stop offset="0" stop-color="${C.red}"/><stop offset="0.33" stop-color="${C.yellow}"/>
         <stop offset="0.66" stop-color="${C.green}"/><stop offset="1" stop-color="${C.blue}"/>
       </linearGradient>`;
  const face = pip !== null
    ? `<text x="${W / 2}" y="${H / 2}" font-family="${FONT}" font-weight="bold" font-size="64"
         fill="${hot}" text-anchor="middle" dominant-baseline="central">${pip}</text>
       <text x="22" y="38" font-family="${FONT}" font-weight="bold" font-size="24" fill="${hot}">${pip}</text>`
    : `<path transform="translate(${W / 2} ${H / 2}) scale(2.6)" fill="#ffffff"
         d="M0,-14 L3.5,-4.5 L14,-4 L5.5,2.5 L8.5,13 L0,7 L-8.5,13 L-5.5,2.5 L-14,-4 L-3.5,-4.5 Z"/>
       <path transform="translate(24 30) scale(0.9)" fill="#ffffff"
         d="M0,-14 L3.5,-4.5 L14,-4 L5.5,2.5 L8.5,13 L0,7 L-8.5,13 L-5.5,2.5 L-14,-4 L-3.5,-4.5 Z"/>`;
  return `
    <g transform="translate(${x} ${y}) rotate(${rot} ${W / 2} ${H})">
      <defs>${body}${core}</defs>
      <rect width="${W}" height="${H}" rx="${R}" fill="url(#body-${uid})"/>
      ${coreFill}
      ${face}
      ${border}
    </g>`;
}

// The card fan shared by every OG image — same hand as the homepage hero
function cardFan(cx, baseY) {
  const cards = [
    { rot: -26, color: C.red, hot: '#ff8fa3', pip: '7' },
    { rot: -13, color: C.blue, hot: '#8ec4ff', pip: '9' },
    { rot: 0, color: C.green, hot: '#7df2b8', pip: '3' },
    { rot: 13, color: C.yellow, hot: '#ffe37e', pip: '+2' },
    { rot: 26, color: null, hot: '#ffffff', pip: null },
  ];
  return cards.map((c, i) =>
    fanCard({ x: cx - 75, y: baseY - 225, rot: c.rot, color: c.color, hot: c.hot, pip: c.pip, uid: i })
  ).join('');
}

function roomSvg(code) {
  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="0.72" cy="0.55" r="0.6">
      <stop offset="0" stop-color="${C.blue}" stop-opacity="0.10"/>
      <stop offset="1" stop-color="${C.blue}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="52" height="52" patternUnits="userSpaceOnUse">
      <path d="M52 0H0V52" fill="none" stroke="${C.steel}" stroke-opacity="0.07" stroke-width="1"/>
    </pattern>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.yellow}"/><stop offset="1" stop-color="${C.red}"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="${C.bg}"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  <!-- Left column: invitation copy + room code -->
  <text x="80" y="130" font-family="${FONT}" font-weight="bold" font-size="30" letter-spacing="6" fill="${C.yellow}">YOU'RE INVITED</text>
  <text x="80" y="212" font-family="${FONT}" font-weight="bold" font-size="64" fill="${C.white}">Join my UNO game</text>

  <text x="80" y="300" font-family="${FONT}" font-size="28" fill="${C.steel}">ROOM CODE</text>
  <rect x="76" y="330" width="${90 + code.length * 62}" height="112" rx="20" fill="${C.panel}" stroke="${C.green}" stroke-opacity="0.55" stroke-width="2"/>
  <text x="${76 + (90 + code.length * 62) / 2}" y="386" font-family="${FONT}" font-weight="bold" font-size="76" letter-spacing="14" fill="${C.green}" text-anchor="middle" dominant-baseline="central">${code}</text>

  <text x="80" y="520" font-family="${FONT}" font-size="30" fill="${C.steel}">Free multiplayer UNO · 2–20 players · No download</text>
  <text x="80" y="575" font-family="${FONT}" font-weight="bold" font-size="32" fill="url(#brand)">Tap to join the game</text>

  <!-- Right column: the card fan -->
  ${cardFan(920, 480)}
</svg>`;
}

router.get('/og/room/:code.png', async (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  if (!CODE_RE.test(code)) return res.status(404).end();

  try {
    let png = cache.get(code);
    if (!png) {
      png = await sharp(Buffer.from(roomSvg(code))).png({ compressionLevel: 9 }).toBuffer();
      if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
      cache.set(code, png);
    }
    res.type('png').send(png);
  } catch (err) {
    console.error('[og-image] render failed:', err.message);
    // Fall back to the static site image so previews never 500
    res.redirect(302, '/images/og-image.jpg');
  }
});

module.exports = router;
