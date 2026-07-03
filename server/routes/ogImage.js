// ─── Dynamic Open Graph Images ────────────────────────────────────────────────
// Renders 1200×630 link-preview images (WhatsApp/Discord/Twitter) on the fly.
// /og/room/:code.png — room invite preview with the room code on the card table.
// Images are pure SVG rasterized with sharp and cached in memory (a code's
// image never changes, and the global cache middleware adds max-age=86400).
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express');
const sharp = require('sharp');
const router = express.Router();

const CODE_RE = /^[A-Z0-9-]{3,12}$/;
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
  const codeWidth = 110 + code.length * 58;
  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <!-- Background glow pool -->
    <radialGradient id="bgGlow" cx="0.5" cy="0.5" r="0.8">
      <stop offset="0" stop-color="${C.blue}" stop-opacity="0.14"/>
      <stop offset="1" stop-color="${C.blue}" stop-opacity="0"/>
    </radialGradient>
    <!-- Projection grid -->
    <pattern id="grid" width="52" height="52" patternUnits="userSpaceOnUse">
      <path d="M52 0H0V52" fill="none" stroke="${C.steel}" stroke-opacity="0.05" stroke-width="1"/>
    </pattern>
    <!-- Brand gradient (yellow → red) -->
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.yellow}"/>
      <stop offset="1" stop-color="${C.red}"/>
    </linearGradient>
    <!-- Green glow for room code box -->
    <filter id="codeGlow">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>

  <!-- Void background -->
  <rect width="1200" height="630" fill="${C.bg}"/>
  <!-- Projection grid -->
  <rect width="1200" height="630" fill="url(#grid)" opacity="0.6"/>
  <!-- Blue glow pool -->
  <rect width="1200" height="630" fill="url(#bgGlow)"/>

  <!-- Left content area (no panel, direct on background for cleaner look) -->

  <!-- YOU'RE INVITED eyebrow -->
  <text x="80" y="120" font-family="${FONT}" font-weight="bold" font-size="28" letter-spacing="6" fill="${C.yellow}" opacity="0.95">YOU'RE INVITED</text>

  <!-- Hero title -->
  <text x="80" y="200" font-family="${FONT}" font-weight="bold" font-size="68" fill="${C.white}">Join my</text>
  <text x="80" y="275" font-family="${FONT}" font-weight="bold" font-size="68" fill="url(#brand)">UNO game</text>

  <!-- Room code label -->
  <text x="80" y="355" font-family="${FONT}" font-weight="600" font-size="20" letter-spacing="4" fill="${C.steel}" opacity="0.8">ROOM CODE</text>

  <!-- Room code box: dark slab with green emissive border + glow -->
  <rect x="76" y="380" width="${codeWidth}" height="100" rx="18" fill="${C.panel}" stroke="${C.green}" stroke-opacity="0.7" stroke-width="3" filter="url(#codeGlow)"/>
  <rect x="76.5" y="380.5" width="${codeWidth - 1}" height="99" rx="17.5" fill="none" stroke="${C.white}" stroke-opacity="0.06" stroke-width="1"/>
  <text x="${76 + codeWidth / 2}" y="430" font-family="${FONT}" font-weight="bold" font-size="56" letter-spacing="10" fill="${C.green}" text-anchor="middle" dominant-baseline="central">${code}</text>

  <!-- Footer tagline -->
  <text x="80" y="540" font-family="${FONT}" font-size="22" fill="${C.steel}" opacity="0.85">2–20 players · No download · Always free</text>

  <!-- Right side: holo-foil card fan, positioned to fit fully in frame -->
  ${cardFan(900, 420)}
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
