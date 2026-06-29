// ─── SEO Pages Router ─────────────────────────────────────────────────────────
// Server-rendered HTML pages for SEO. The game SPA at /play is served as a
// static file (public/index.html). Everything else gets EJS-rendered pages
// with proper meta tags, structured data, and content.
// ──────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router = express.Router();

const SITE_NAME = 'UNO Online';
const BASE_URL = process.env.BASE_URL || 'https://yourdomain.com';

// ── Helper: render a page with standard SEO defaults ──
function renderPage(res, view, overrides = {}) {
  const defaults = {
    siteName: SITE_NAME,
    baseUrl: BASE_URL,
    ogImage: `${BASE_URL}/images/og-image.jpg`,
    ogType: 'website',
  };
  res.render(view, { ...defaults, ...overrides });
}

// ── Homepage ──
router.get('/', (req, res) => {
  renderPage(res, 'homepage', {
    title: 'Play UNO Online Free — Multiplayer Card Game for Up to 20 Players',
    description: 'Play UNO online with friends in your browser. No download required. Create private rooms, join public games, and play with up to 20 players. Free, fast, and mobile-friendly.',
    canonical: `${BASE_URL}/`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": SITE_NAME,
        "url": BASE_URL,
        "description": "Free browser-based multiplayer UNO card game",
        "potentialAction": {
          "@type": "SearchAction",
          "target": `${BASE_URL}/search?q={search_term_string}`,
          "query-input": "required name=search_term_string"
        }
      },
      {
        "@context": "https://schema.org",
        "@type": "VideoGame",
        "name": SITE_NAME,
        "description": "Play UNO online with up to 20 players in your browser",
        "genre": ["Card Game", "Multiplayer", "Party Game"],
        "gamePlatform": ["Web Browser", "Mobile Browser"],
        "numberOfPlayers": { "@type": "QuantitativeValue", "minValue": 2, "maxValue": 20 },
        "playMode": ["MultiPlayer"],
        "applicationCategory": "Game",
        "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
        "operatingSystem": "Any (Web Browser)",
        "url": `${BASE_URL}/play`
      },
      {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
          { "@type": "Question", "name": "How many players can play UNO online?", "acceptedAnswer": { "@type": "Answer", "text": "Up to 20 players can play in a single room." } },
          { "@type": "Question", "name": "Do I need to download anything?", "acceptedAnswer": { "@type": "Answer", "text": "No. The game runs entirely in your web browser." } },
          { "@type": "Question", "name": "Is it free?", "acceptedAnswer": { "@type": "Answer", "text": "Yes, completely free. No signup required." } },
          { "@type": "Question", "name": "Can I play on my phone?", "acceptedAnswer": { "@type": "Answer", "text": "Yes! Full touch support on iOS and Android." } },
        ]
      }
    ],
  });
});

// ── Rules ──
router.get('/rules', (req, res) => {
  renderPage(res, 'rules', {
    title: 'UNO Rules — Complete Guide to Playing UNO Online',
    description: 'Learn how to play UNO with our complete rules guide. Card types, special cards, stacking, UNO calling, and winning — everything explained.',
    canonical: `${BASE_URL}/rules`,
    jsonLd: {
      "@context": "https://schema.org", "@type": "Article",
      "headline": "UNO Rules — Complete Guide",
      "description": "Complete guide to UNO rules including all card types, special cards, and gameplay mechanics.",
      "author": { "@type": "Organization", "name": SITE_NAME },
      "publisher": { "@type": "Organization", "name": SITE_NAME },
      "datePublished": "2026-06-28",
      "mainEntityOfPage": `${BASE_URL}/rules`
    },
  });
});

// ── How to Play ──
router.get('/how-to-play', (req, res) => {
  renderPage(res, 'how-to-play', {
    title: 'How to Play UNO Online — Step-by-Step Guide',
    description: 'Learn how to play UNO online with friends in 7 easy steps. Create a room, invite friends, and start playing in your browser.',
    canonical: `${BASE_URL}/how-to-play`,
  });
});

// ── FAQ ──
router.get('/faq', (req, res) => {
  renderPage(res, 'faq', {
    title: 'UNO Online FAQ — Frequently Asked Questions',
    description: 'Answers to common questions about UNO Online. Players, rules, devices, rooms, stacking, and more.',
    canonical: `${BASE_URL}/faq`,
  });
});

// ── Game Modes ──
router.get('/game-modes', (req, res) => {
  renderPage(res, 'game-modes', {
    title: 'UNO Game Modes — Classic, Stacking, and More',
    description: 'Explore UNO game modes including Classic and Stacking. Learn the differences and choose your favorite way to play.',
    canonical: `${BASE_URL}/game-modes`,
  });
});

// ── 20-Player UNO ──
router.get('/20-player-uno', (req, res) => {
  renderPage(res, '20-player-uno', {
    title: '20-Player UNO Online — Massive Multiplayer Card Games',
    description: 'Play UNO with up to 20 players in a single room. Double decks, auto-play, spectator mode — the biggest online UNO experience anywhere.',
    canonical: `${BASE_URL}/20-player-uno`,
  });
});

// ── Multiplayer ──
router.get('/multiplayer', (req, res) => {
  renderPage(res, 'multiplayer', {
    title: 'Multiplayer UNO Online — Play With Friends in Real-Time',
    description: 'Create a room, share the invite link, and play UNO with friends instantly. Private rooms, public rooms, host controls, and spectator mode.',
    canonical: `${BASE_URL}/multiplayer`,
  });
});

// ── Blog ──
router.get('/blog', (req, res) => {
  renderPage(res, 'blog', {
    title: 'UNO Online Blog — Tips, Strategies & Updates',
    description: 'UNO tips, strategies, game updates, and card game knowledge. Learn to play better and discover new features.',
    canonical: `${BASE_URL}/blog`,
  });
});

// ── About ──
router.get('/about', (req, res) => {
  renderPage(res, 'about', {
    title: 'About UNO Online — The Best Browser-Based UNO Game',
    description: 'Learn about UNO Online, the free browser-based multiplayer UNO game supporting up to 20 players.',
    canonical: `${BASE_URL}/about`,
  });
});

// ── Contact ──
router.get('/contact', (req, res) => {
  renderPage(res, 'contact', {
    title: 'Contact Us — UNO Online',
    description: 'Get in touch with the UNO Online team. Report bugs, request features, or send business inquiries.',
    canonical: `${BASE_URL}/contact`,
  });
});

// ── Privacy Policy ──
router.get('/privacy-policy', (req, res) => {
  renderPage(res, 'privacy-policy', {
    title: 'Privacy Policy — UNO Online',
    description: 'UNO Online privacy policy. Learn about data collection, cookies, and your rights.',
    canonical: `${BASE_URL}/privacy-policy`,
  });
});

// ── Terms ──
router.get('/terms', (req, res) => {
  renderPage(res, 'terms', {
    title: 'Terms of Service — UNO Online',
    description: 'UNO Online terms of service. User conduct, intellectual property, and liability.',
    canonical: `${BASE_URL}/terms`,
  });
});

// ── Cookie Policy ──
router.get('/cookie-policy', (req, res) => {
  renderPage(res, 'cookie-policy', {
    title: 'Cookie Policy — UNO Online',
    description: 'UNO Online cookie policy. Essential, analytics, and advertising cookies explained.',
    canonical: `${BASE_URL}/cookie-policy`,
  });
});

// ── robots.txt ──
router.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Disallow: /play?room=*
Disallow: /api/

Sitemap: ${BASE_URL}/sitemap.xml`);
});

// ── sitemap.xml ──
router.get('/sitemap.xml', (req, res) => {
  const pages = [
    { url: '/', changefreq: 'weekly', priority: '1.0' },
    { url: '/play', changefreq: 'monthly', priority: '0.9' },
    { url: '/rules', changefreq: 'monthly', priority: '0.8' },
    { url: '/how-to-play', changefreq: 'monthly', priority: '0.8' },
    { url: '/game-modes', changefreq: 'monthly', priority: '0.7' },
    { url: '/faq', changefreq: 'monthly', priority: '0.7' },
    { url: '/20-player-uno', changefreq: 'monthly', priority: '0.7' },
    { url: '/multiplayer', changefreq: 'monthly', priority: '0.7' },
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
    <loc>${BASE_URL}${p.url}</loc>
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
    name: 'UNO Online — Multiplayer Card Game',
    short_name: 'UNO Online',
    description: 'Play UNO with friends in your browser',
    start_url: '/play',
    display: 'standalone',
    background_color: '#0f0f1a',
    theme_color: '#0f0f1a',
    orientation: 'any',
    icons: [
      { src: '/images/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/images/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  });
});

module.exports = router;
