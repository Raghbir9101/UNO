// ─── SEO Pages Router ─────────────────────────────────────────────────────────
// Server-rendered HTML pages for SEO. The game SPA at /play is served as a
// static file (public/index.html). Everything else gets EJS-rendered pages
// with proper meta tags, structured data, and content.
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router = express.Router();

const SITE_NAME = 'Play UNO Free';

// ── Helper: render a page with standard SEO defaults ──
// baseUrl is already in res.locals from the middleware in index.js; fallback
// for tests/standalone use
function renderPage(res, view, overrides = {}) {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  const defaults = {
    siteName: SITE_NAME,
    baseUrl: base,
    ogImage: `${base}/images/og-image.jpg?v=4`,
    ogType: 'website',
  };
  res.render(view, { ...defaults, ...overrides });
}

// ── Homepage ──
router.get('/', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'homepage', {
    title: 'Play UNO Online Free — No Download, No Sign-Up',
    description: 'Play UNO online free with friends or strangers. No download, no sign-up, no ads. Create a private room or join a public game with up to 20 players. 100% free forever.',
    canonical: `${base}/`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": SITE_NAME,
        "url": base,
        "description": "Free browser-based multiplayer UNO card game"
      },
      {
        "@context": "https://schema.org",
        "@type": "VideoGame",
        "name": SITE_NAME,
        "description": "Play UNO free online with up to 20 players in your browser. No download, no signup. Always free.",
        "genre": ["Card Game", "Multiplayer", "Party Game", "Free Game"],
        "gamePlatform": ["Web Browser", "Mobile Browser"],
        "numberOfPlayers": { "@type": "QuantitativeValue", "minValue": 2, "maxValue": 20 },
        "playMode": ["MultiPlayer"],
        "applicationCategory": "Game",
        "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD", "availability": "https://schema.org/InStock" },
        "operatingSystem": "Any (Web Browser)",
        "url": `${base}/play`,
        "isAccessibleForFree": true
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
          { "@type": "Question", "name": "How many players can play UNO online?", "acceptedAnswer": { "@type": "Answer", "text": "Up to 20 players can play in a single room." } },
          { "@type": "Question", "name": "Do I need to download anything?", "acceptedAnswer": { "@type": "Answer", "text": "No. The game runs entirely in your web browser." } },
          { "@type": "Question", "name": "Is Play UNO Free really free?", "acceptedAnswer": { "@type": "Answer", "text": "Yes, 100% free forever. No signup, no credit card, no hidden costs." } },
          { "@type": "Question", "name": "Can I play on my phone?", "acceptedAnswer": { "@type": "Answer", "text": "Yes! Full touch support on iOS and Android." } },
        ]
      }
    ],
  });
});

// ── Rules ──
router.get('/rules', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'rules', {
    title: 'UNO Rules — Complete Guide to Playing UNO Free Online',
    description: 'Learn how to play UNO free with our complete rules guide. Card types, special cards, stacking, UNO calling, and winning — everything explained.',
    canonical: `${base}/rules`,
    jsonLd: {
      "@context": "https://schema.org", "@type": "Article",
      "headline": "UNO Rules — Complete Guide",
      "description": "Complete guide to UNO rules including all card types, special cards, and gameplay mechanics.",
      "author": { "@type": "Organization", "name": SITE_NAME },
      "publisher": { "@type": "Organization", "name": SITE_NAME },
      "datePublished": "2026-06-28",
      "mainEntityOfPage": `${base}/rules`
    },
  });
});

// ── How to Play ──
router.get('/how-to-play', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'how-to-play', {
    title: 'How to Play UNO Free Online — Step-by-Step Guide',
    description: 'Learn how to play UNO free online with friends in 7 easy steps. Create a room, invite friends, and start playing. No download, always free.',
    canonical: `${base}/how-to-play`,
  });
});

// ── FAQ ──
// Single source of truth for the visible FAQ list AND the FAQPage schema.
// Answers may contain HTML links (rendered on-page, stripped for JSON-LD).
const FAQS = [
  { q: 'How many players can play UNO online?', a: 'Up to 20 players can play in a single room. This makes it perfect for large groups, parties, and classrooms. Games with 11+ players automatically use two decks.' },
  { q: 'Is Play UNO Free really free?', a: 'Yes, 100% free forever! There is no signup, no credit card, no ads, and no hidden fees. Just open the website and start playing.' },
  { q: 'Do I need to download anything?', a: 'No. The game runs entirely in your web browser. It works on Chrome, Firefox, Safari, Edge, and most modern browsers.' },
  { q: 'Can I play on my phone?', a: 'Yes! The game has full touch support on both iOS and Android. The interface adapts automatically to your screen size.' },
  { q: 'Can I play on a tablet or iPad?', a: 'Absolutely. Tablets provide a great UNO experience with more screen space for cards and player information.' },
  { q: 'How do I create a room?', a: 'Go to the <a href="/play">Play page</a>, enter a nickname, and click "Create New Room." You\'ll receive a room code to share with friends.' },
  { q: 'How do I join a room?', a: 'Enter the room code shared by the host, or click "Browse Public Rooms" to find open games.' },
  { q: 'How do I invite friends?', a: 'After creating a room, click "Copy Invite Link" and send it via WhatsApp, Discord, text, or any messaging app. Friends join in one click.' },
  { q: 'What is a private room?', a: 'A private room can only be joined with the room code or invite link. It won\'t appear in the public room browser.' },
  { q: 'What is a public room?', a: 'A public room appears in the "Browse Public Rooms" list, allowing anyone to join.' },
  { q: 'What are the UNO rules?', a: 'Standard UNO rules apply. Match cards by color, number, or symbol. Wild cards can be played anytime. <a href="/rules">Read the full rules →</a>' },
  { q: 'What is card stacking?', a: 'When enabled, you can stack +2 on +2, +4 on +4, and +8 on +8. The penalty accumulates until someone can\'t stack and must draw all the cards. <a href="/rules/stacking">Learn more →</a>' },
  { q: 'What is the Wild Draw 8 card?', a: 'A custom card exclusive to our game. It works like a Wild Draw 4 but forces the next player to draw 8 cards. There are 2 per deck.' },
  { q: 'How does UNO calling work?', a: 'When you have 1 card left, you must press the UNO button within a few seconds. If another player catches you first, you draw 2 penalty cards.' },
  { q: 'What happens if I disconnect?', a: 'You\'ll automatically reconnect within seconds. Your cards are preserved on the server. If you\'re away too long, the auto-play system will play for you.' },
  { q: 'What is auto-play?', a: 'If a player is AFK (away from keyboard) for 30 seconds, the game automatically plays a valid card for them or draws and passes.' },
  { q: 'Can I watch a game without playing?', a: 'Yes! If a game is in progress, you can join as a spectator and watch without affecting the game.' },
  { q: 'Is there a time limit per turn?', a: 'Yes, each player has 30 seconds to play. After that, auto-play kicks in. A visual timer shows the remaining time.' },
  { q: 'Can the host kick players?', a: 'Yes. The host can remove any player from the room at any time, both in the lobby and during the game.' },
  { q: 'Is it safe for kids?', a: 'Yes. There is no text chat, no user accounts, and no personal data collected. The game is family-friendly.' },
  { q: 'How many cards are in the deck?', a: 'A standard deck has 110 cards: 76 number cards, 24 action cards (Skip, Reverse, Draw Two), and 10 wild cards. Games with 11+ players use 220 cards.' },
  { q: 'Do you support custom rules?', a: 'Currently, the host can toggle card stacking on or off. More custom rules (Jump-In, Seven-Zero, etc.) are on our roadmap.' },
  { q: 'Can I play UNO solo?', a: 'Not yet. We\'re working on AI bot opponents so you can practice or play solo. Stay tuned!' },
  { q: 'Is this affiliated with Mattel?', a: 'No. This is an independent fan-made project. UNO® is a registered trademark of Mattel, Inc.' },
];

const stripHtml = (s) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

router.get('/faq', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'faq', {
    title: 'Play UNO Free FAQ — Frequently Asked Questions',
    description: 'Answers to common questions about Play UNO Free. Players, rules, devices, rooms, and why it\'s 100% free forever.',
    canonical: `${base}/faq`,
    faqs: FAQS,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      "mainEntity": FAQS.map(f => ({
        "@type": "Question",
        "name": f.q,
        "acceptedAnswer": { "@type": "Answer", "text": stripHtml(f.a) }
      }))
    },
  });
});

// ── Game Modes ──
router.get('/game-modes', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'game-modes', {
    title: 'Free UNO Game Modes — Classic, Stacking, and More',
    description: 'Explore free UNO game modes including Classic and Stacking. Learn the differences and choose your favorite way to play for free.',
    canonical: `${base}/game-modes`,
  });
});

// ── 20-Player UNO ──
router.get('/20-player-uno', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, '20-player-uno', {
    title: '20-Player UNO — Play UNO With More Than 4 Players Online',
    description: 'Need UNO for more than 4 players? Play free online with up to 20 players in one room. Double decks, auto-play, spectator mode — perfect for big groups.',
    canonical: `${base}/20-player-uno`,
  });
});

// ── Multiplayer ──
router.get('/multiplayer', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'multiplayer', {
    title: 'Multiplayer UNO Online — Play With Friends or Strangers',
    description: 'Play UNO online with friends via invite link, or join a public room and play with strangers. Real-time multiplayer, host controls, up to 20 players — all free.',
    canonical: `${base}/multiplayer`,
  });
});

// ── UNO Unblocked ──
router.get('/uno-unblocked', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'uno-unblocked', {
    title: 'UNO Unblocked — Play Free Online, No Download',
    description: 'Play UNO unblocked in your browser. No download, no install, no signup — works on Chromebooks and any device with a browser. 100% free.',
    canonical: `${base}/uno-unblocked`,
  });
});

// ── Blog ──
router.get('/blog', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'blog', {
    title: 'Play UNO Free Blog — Tips, Strategies & Updates',
    description: 'Free UNO tips, strategies, game updates, and card game knowledge. Learn to play better and discover new free features.',
    canonical: `${base}/blog`,
  });
});

// ── About ──
router.get('/about', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'about', {
    title: 'About Play UNO Free — The Best Free Browser-Based UNO Game',
    description: 'Learn about Play UNO Free, the 100% free browser-based multiplayer UNO game supporting up to 20 players.',
    canonical: `${base}/about`,
  });
});

// ── Contact ──
router.get('/contact', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'contact', {
    title: 'Contact Us — Play UNO Free',
    description: 'Get in touch with the Play UNO Free team. Report bugs, request features, or send business inquiries.',
    canonical: `${base}/contact`,
  });
});

// ── Privacy Policy ──
router.get('/privacy-policy', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'privacy-policy', {
    title: 'Privacy Policy — Play UNO Free',
    description: 'Play UNO Free privacy policy. Learn about data collection, cookies, and your rights.',
    canonical: `${base}/privacy-policy`,
  });
});

// ── Terms ──
router.get('/terms', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'terms', {
    title: 'Terms of Service — Play UNO Free',
    description: 'Play UNO Free terms of service. User conduct, intellectual property, and liability.',
    canonical: `${base}/terms`,
  });
});

// ── Cookie Policy ──
router.get('/cookie-policy', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'cookie-policy', {
    title: 'Cookie Policy — Play UNO Free',
    description: 'Play UNO Free cookie policy. Essential, analytics, and advertising cookies explained.',
    canonical: `${base}/cookie-policy`,
  });
});

// ── robots.txt ──
router.get('/robots.txt', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Disallow: /play?room=*
Disallow: /api/

Sitemap: ${base}/sitemap.xml`);
});

// ── sitemap.xml ──
router.get('/sitemap.xml', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  const pages = [
    { url: '/', changefreq: 'weekly', priority: '1.0' },
    { url: '/play', changefreq: 'monthly', priority: '0.9' },
    { url: '/rules', changefreq: 'monthly', priority: '0.8' },
    { url: '/how-to-play', changefreq: 'monthly', priority: '0.8' },
    { url: '/game-modes', changefreq: 'monthly', priority: '0.7' },
    { url: '/faq', changefreq: 'monthly', priority: '0.7' },
    { url: '/20-player-uno', changefreq: 'monthly', priority: '0.7' },
    { url: '/multiplayer', changefreq: 'monthly', priority: '0.7' },
    { url: '/uno-unblocked', changefreq: 'monthly', priority: '0.7' },
    { url: '/blog', changefreq: 'weekly', priority: '0.7' },
    { url: '/about', changefreq: 'yearly', priority: '0.5' },
    { url: '/contact', changefreq: 'yearly', priority: '0.4' },
    { url: '/privacy-policy', changefreq: 'yearly', priority: '0.3' },
    { url: '/terms', changefreq: 'yearly', priority: '0.3' },
    { url: '/cookie-policy', changefreq: 'yearly', priority: '0.3' },
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(p => `  <url>
    <loc>${base}${p.url}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  res.type('application/xml');
  res.send(xml);
});

// ── manifest.json ──
router.get('/manifest.json', (req, res) => {
  res.json({
    name: 'Play UNO Free — Multiplayer Card Game',
    short_name: 'UNO Free',
    description: 'Play UNO free with up to 20 friends in your browser',
    start_url: '/play',
    display: 'standalone',
    background_color: '#05070d',
    theme_color: '#05070d',
    orientation: 'any',
    icons: [
      { src: '/images/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/images/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
});

module.exports = router;
