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
    description: 'Play UNO online free with friends or strangers — Classic, No Mercy, and custom house rules. No download, no sign-up. Private rooms, up to 20 players. 100% free forever.',
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
  { q: 'What game modes are there?', a: 'Three: Classic (official rules), No Mercy (stacking, Wild +8s, and elimination at 25 cards), and Custom (the host toggles every house rule individually). <a href="/game-modes">Compare the modes →</a>' },
  { q: 'What is UNO No Mercy?', a: 'The brutal way to play: every kind of stacking is on, Wild +8 and Shuffle Hands cards join the deck, illegal +4s can be challenged, and collecting 25 cards eliminates you. Last player standing wins. <a href="/uno-no-mercy">Full No Mercy guide →</a>' },
  { q: 'Can you stack cards in UNO?', a: 'Officially no — but it\'s the world\'s favorite house rule, and it\'s built in here. Stack +2 on +2, +4 on +4, or mix them, and even deflect piles with Skip Dodge and Reverse Bounce. <a href="/rules/stacking">Stacking rules explained →</a>' },
  { q: 'Do you support custom house rules?', a: 'Yes — pick Custom mode and toggle each rule: stacking, Seven-Zero, Jump-In, Draw to Match, Force Play, Wild Challenge, Play for Places, elimination, starting hand size, turn timer, and more. <a href="/house-rules">Every house rule explained →</a>' },
  { q: 'What is the Wild Draw 8 card?', a: 'A custom card exclusive to our game. It works like a Wild Draw 4 but forces the next player to draw 8 cards. There are 2 per deck, and the host can toggle them on or off.' },
  { q: 'What is Play for Places?', a: 'A house rule where the first player out takes 1st place, but the round keeps going so everyone earns a final rank — 2nd, 3rd, and beyond. Nobody sits out after one lucky card.' },
  { q: 'How does UNO calling work?', a: 'When you have 1 card left, you must press the UNO button. Other players get a chance to catch you after a short grace period (the host can set it from 100ms to 1 second). Get caught and you draw 2 penalty cards.' },
  { q: 'What happens if I disconnect?', a: 'You\'ll automatically reconnect within seconds. Your cards are preserved on the server. If you\'re away too long, the auto-play system will play for you.' },
  { q: 'What is auto-play?', a: 'If a player is idle for the length of the turn timer, the game automatically plays a valid card for them or draws and passes, so one AFK player never freezes the table.' },
  { q: 'Can I watch a game without playing?', a: 'Yes! If a game is in progress, you can join as a spectator and watch without affecting the game.' },
  { q: 'Is there a time limit per turn?', a: 'Yes — 30 seconds by default, and the host can set it anywhere from 15 to 90 seconds. A visual timer shows the remaining time, then auto-play kicks in.' },
  { q: 'Can the host kick players?', a: 'Yes. The host can remove any player from the room at any time, both in the lobby and during the game.' },
  { q: 'What are coins and levels?', a: 'You earn coins and XP by playing and winning — plus daily login rewards, achievements, and daily/weekly challenges. Spend coins on cosmetics like card themes, table styles, and victory effects. Coins can never be bought with real money, and cosmetics never affect gameplay.' },
  { q: 'Do I need an account?', a: 'No — you can play and even earn rewards without one. Signing in (email or Google) is optional and saves your stats, coins, and cosmetics across devices.' },
  { q: 'Is it safe for kids?', a: 'Yes. There is no text chat (only preset emoji reactions), accounts are optional, and no personal data is needed to play. The game is family-friendly.' },
  { q: 'How many cards are in the deck?', a: 'The classic deck has 108 cards: 76 number cards, 24 action cards (Skip, Reverse, Draw Two), and 8 wild cards. Optional Wild +8 and Shuffle Hands cards add more, and games with 11+ players use a double deck.' },
  { q: 'Can I play UNO solo?', a: 'Yes! Tap "Play vs Bots" for an instant game against computer players, or add bots to any room. Bots play every mode — including No Mercy.' },
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
    title: 'UNO Game Modes — Classic, No Mercy & Custom Rules | Play Free',
    description: 'Three free ways to play UNO online: Classic official rules, brutal No Mercy with stacking and elimination, or Custom mode with every house rule. 2-20 players.',
    canonical: `${base}/game-modes`,
  });
});

// ── UNO No Mercy (landing page for the "uno no mercy online" query cluster) ──
router.get('/uno-no-mercy', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'uno-no-mercy', {
    title: 'Play UNO No Mercy Online Free — Stacking, Wild +8s & Elimination',
    description: 'Play UNO No Mercy style online for free: unlimited stacking, Wild +8 cards, shuffle hands, and elimination at 25 cards. Last player standing wins. No download, 2-20 players.',
    canonical: `${base}/uno-no-mercy`,
    jsonLd: [
      {
        "@context": "https://schema.org", "@type": "Article",
        "headline": "Play UNO No Mercy Online — Free Browser Game",
        "description": "How to play the No Mercy style of UNO online for free: stacking rules, Wild +8, Shuffle Hands, Wild Challenge, and elimination at 25 cards.",
        "author": { "@type": "Organization", "name": SITE_NAME },
        "publisher": { "@type": "Organization", "name": SITE_NAME },
        "datePublished": "2026-07-18",
        "mainEntityOfPage": `${base}/uno-no-mercy`
      },
      {
        "@context": "https://schema.org", "@type": "FAQPage",
        "mainEntity": [
          { "@type": "Question", "name": "Is UNO No Mercy free to play online?", "acceptedAnswer": { "@type": "Answer", "text": "Yes — completely free, forever. No download, no signup. It runs in any browser on phone, tablet, or computer." } },
          { "@type": "Question", "name": "How many players can join a No Mercy game?", "acceptedAnswer": { "@type": "Answer", "text": "2 to 20 players in one room. Big tables mean more stacking chains and more eliminations." } },
          { "@type": "Question", "name": "What happens when a player is eliminated?", "acceptedAnswer": { "@type": "Answer", "text": "At 25 cards they are out: their cards return to the deck and they watch the rest of the round. They rejoin automatically next round." } },
          { "@type": "Question", "name": "Can I play No Mercy with bots?", "acceptedAnswer": { "@type": "Answer", "text": "Yes. Add bots from the room lobby — they stack, challenge, and get eliminated just like human players." } },
        ]
      }
    ],
  });
});

// ── Stacking Rules (deep-dive; also the target of FAQ/rules internal links) ──
router.get('/rules/stacking', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'stacking', {
    title: 'UNO Stacking Rules — Can You Stack +2 and +4 Cards?',
    description: 'Can you stack a +2 on a +2 in UNO? Officially no — but it\'s the world\'s favorite house rule. Full stacking rules explained, plus how to play UNO with stacking online free.',
    canonical: `${base}/rules/stacking`,
    jsonLd: {
      "@context": "https://schema.org", "@type": "Article",
      "headline": "UNO Stacking Rules — The Complete Guide",
      "description": "Official UNO stacking rules vs the popular house rule: +2 stacking, +4 stacking, mixed stacking, Skip Dodge, and Reverse Bounce explained.",
      "author": { "@type": "Organization", "name": SITE_NAME },
      "publisher": { "@type": "Organization", "name": SITE_NAME },
      "datePublished": "2026-07-18",
      "mainEntityOfPage": `${base}/rules/stacking`
    },
  });
});

// ── House Rules (Seven-Zero, Jump-In, Force Play, and friends) ──
router.get('/house-rules', (req, res) => {
  const base = res.locals.baseUrl || process.env.BASE_URL || 'https://playunofree.com';
  renderPage(res, 'house-rules', {
    title: 'UNO House Rules — Seven-Zero, Jump-In, Stacking & More',
    description: 'Every popular UNO house rule explained: the 7-0 rule, Jump-In, stacking, Draw to Match, Force Play, and Wild Challenge — and how to play each one online for free.',
    canonical: `${base}/house-rules`,
    jsonLd: {
      "@context": "https://schema.org", "@type": "Article",
      "headline": "UNO House Rules — Every Popular Variant Explained",
      "description": "The Seven-Zero rule, Jump-In, stacking, Draw to Match, Force Play, Wild Challenge, Play for Places, and elimination — what each UNO house rule does.",
      "author": { "@type": "Organization", "name": SITE_NAME },
      "publisher": { "@type": "Organization", "name": SITE_NAME },
      "datePublished": "2026-07-18",
      "mainEntityOfPage": `${base}/house-rules`
    },
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
    { url: '/uno-no-mercy', changefreq: 'monthly', priority: '0.8' },
    { url: '/rules/stacking', changefreq: 'monthly', priority: '0.7' },
    { url: '/house-rules', changefreq: 'monthly', priority: '0.7' },
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
