# 🚀 Play UNO Free — Launch Checklist

## ✅ Completed (Done by Claude)

### Rebranding
- [x] Domain chosen: **playunofree.com**
- [x] Brand name updated: **Play UNO Free**
- [x] All view templates updated with new branding
- [x] All SEO page titles optimized for "free" keyword
- [x] Meta descriptions updated to emphasize "100% free forever"
- [x] Logo text changed from "Online" to "Free"
- [x] Footer and navigation updated
- [x] Email addresses updated to @playunofree.com
- [x] Package.json renamed and description updated
- [x] Environment variables configured (.env file)
- [x] SEO routes updated (server/routes/seoPages.js)
- [x] Structured data schemas updated (VideoGame, FAQPage, etc.)
- [x] Game application HTML updated (public/index.html)

### Documentation
- [x] DEPLOYMENT.md created (hosting guide)
- [x] REBRANDING_SUMMARY.md created (all changes documented)
- [x] LAUNCH_CHECKLIST.md created (this file)

---

## 📋 Your Action Items

### Step 1: Register Domain (Do First!)

- [ ] Go to [GoDaddy](https://godaddy.com) or [Namecheap](https://namecheap.com)
- [ ] Search for **playunofree.com**
- [ ] Purchase domain (₹1 for first year)
- [ ] Enable **WHOIS privacy** (free at Namecheap/Porkbun)
- [ ] Enable **auto-renewal** to avoid losing domain

**Note:** Don't delay! Domains can get snatched up quickly. Register it today.

---

### Step 2: Choose Hosting & Deploy

Pick one hosting option:

#### Option A: Railway (Recommended - Easy)
- [ ] Go to [Railway.app](https://railway.app)
- [ ] Sign up with GitHub
- [ ] Click "New Project" → "Deploy from GitHub repo"
- [ ] Select your UNO game repository
- [ ] Add environment variables:
  - `BASE_URL`: https://playunofree.com
  - `MONGODB_URI`: mongodb+srv://flowsync:flowsync123@flowsync.fsdy2.mongodb.net/uno-game
  - `PORT`: 3000
  - `NODE_ENV`: production
- [ ] Under Settings → Domains, add custom domain: **playunofree.com**
- [ ] Copy the CNAME record Railway provides
- [ ] Go to your domain registrar (GoDaddy), add CNAME record:
  - **Type:** CNAME
  - **Name:** www
  - **Value:** (paste Railway's CNAME, e.g., `abc123.up.railway.app`)
- [ ] Add A record:
  - **Type:** A
  - **Name:** @
  - **Value:** (Railway will provide IP, or use Cloudflare)
- [ ] Wait 10-30 minutes for DNS propagation
- [ ] Visit https://playunofree.com to verify it works!

**Cost:** $5/month (includes 500GB bandwidth)

---

#### Option B: Render (Has Free Tier)
- [ ] Go to [Render.com](https://render.com)
- [ ] Sign up with GitHub
- [ ] Click "New +" → "Web Service"
- [ ] Connect GitHub repo
- [ ] Configure:
  - **Name:** playunofree
  - **Build Command:** `npm install`
  - **Start Command:** `npm start`
- [ ] Add environment variables (same as Railway)
- [ ] Under Settings → Custom Domain, add **playunofree.com**
- [ ] Configure DNS as instructed by Render
- [ ] Deploy!

**Cost:** Free tier available (sleeps after 15min inactivity), or $7/month for always-on

---

#### Option C: DigitalOcean / Linode (Advanced)
- [ ] See detailed instructions in `DEPLOYMENT.md`
- [ ] Requires: SSH, Nginx, PM2, Certbot knowledge
- [ ] Cost: $6-12/month

---

### Step 3: Verify Deployment

Once deployed, check these pages work:

- [ ] Homepage: https://playunofree.com/
- [ ] Game page: https://playunofree.com/play
- [ ] Rules: https://playunofree.com/rules
- [ ] FAQ: https://playunofree.com/faq
- [ ] About: https://playunofree.com/about
- [ ] Sitemap: https://playunofree.com/sitemap.xml
- [ ] Robots: https://playunofree.com/robots.txt
- [ ] Manifest: https://playunofree.com/manifest.json

**Test game functionality:**
- [ ] Create a new room
- [ ] Copy invite link and open in another browser/incognito
- [ ] Join the room with second player
- [ ] Start game and play a few cards
- [ ] Test on mobile (responsive design)
- [ ] Test disconnect/reconnect

---

### Step 4: SEO Setup (Week 1)

#### Google Search Console
- [ ] Go to [Google Search Console](https://search.google.com/search-console)
- [ ] Add property: **playunofree.com**
- [ ] Verify ownership:
  - **Option 1:** HTML file upload (upload verification file to `/public` folder)
  - **Option 2:** DNS TXT record (add to GoDaddy DNS settings)
- [ ] Submit sitemap: https://playunofree.com/sitemap.xml
- [ ] Request indexing for homepage

#### Bing Webmaster Tools
- [ ] Go to [Bing Webmaster](https://www.bing.com/webmasters)
- [ ] Add site: **playunofree.com**
- [ ] Import settings from Google Search Console (easiest)
- [ ] Or verify with HTML file/DNS
- [ ] Submit sitemap

#### Google Analytics 4
- [ ] Go to [Google Analytics](https://analytics.google.com)
- [ ] Create account: "Play UNO Free"
- [ ] Create property: "playunofree.com"
- [ ] Get Measurement ID: `G-XXXXXXXXXX`
- [ ] Add tracking code to `views/partials/head.ejs` (before `</head>`):

```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-XXXXXXXXXX"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-XXXXXXXXXX');
</script>
```

- [ ] Redeploy site with analytics code
- [ ] Test: Visit site, check Real-time report in GA4 dashboard

---

### Step 5: Performance Testing

#### Run Lighthouse Audit
- [ ] Open Chrome DevTools (F12)
- [ ] Go to "Lighthouse" tab
- [ ] Run audit on https://playunofree.com
- [ ] **Target Scores:**
  - Performance: 90+
  - SEO: 95+
  - Accessibility: 90+
  - Best Practices: 95+
- [ ] If scores are low, check `DEPLOYMENT.md` for optimization tips

#### Test on Multiple Devices
- [ ] Desktop Chrome
- [ ] Desktop Firefox
- [ ] Desktop Safari (Mac)
- [ ] iPhone Safari
- [ ] Android Chrome
- [ ] Tablet (iPad or Android)

---

### Step 6: Marketing & Distribution (Week 1-2)

#### Game Directories
- [ ] [itch.io](https://itch.io/game/new) - HTML5 games (Free, easy approval)
- [ ] [CrazyGames](https://developer.crazygames.com/) - Submit game (Popular platform)
- [ ] [Poki](https://developers.poki.com/) - Developer portal (High traffic)
- [ ] [Y8.com](https://www.y8.com/submit) - Submit game
- [ ] [Kongregate](https://www.kongregate.com/games/new) - Upload game

**Tips:**
- Use description: "Play UNO free with up to 20 players. No download, no signup. Browser-based multiplayer card game."
- Use tags: uno, card game, multiplayer, free, browser, online, party game
- Upload screenshots and gameplay video if required

#### Social Media & Communities
- [ ] **Reddit** (read rules first!):
  - Post on [r/WebGames](https://reddit.com/r/WebGames) - "Show off Saturday" threads
  - Post on [r/IndieGaming](https://reddit.com/r/IndieGaming) - Follow self-promotion rules
  - Post on [r/BrowserGames](https://reddit.com/r/browsergames)
- [ ] **Product Hunt** - Launch your product (great for visibility)
- [ ] **Hacker News** - Post on "Show HN" (tech-savvy audience)
- [ ] **Discord** - Share in web dev/gaming communities

**Example Reddit post title:**
> "I built a free browser-based UNO game that supports up to 20 players (no download/signup)"

---

### Step 7: Content Marketing (Week 2-4)

Create and publish blog posts (helps SEO):

- [ ] **Post 1:** "How to Play UNO Free Online with 20 People (Step-by-Step Guide)"
  - Target keyword: "how to play uno online"
  - Include screenshots and instructions
  - Link to /play page

- [ ] **Post 2:** "UNO Rules Explained: Classic vs. Stacking Mode"
  - Target keyword: "uno rules"
  - Explain stacking mechanics
  - Link to /rules page

- [ ] **Post 3:** "10 Virtual Game Night Ideas During Remote Work"
  - Target keyword: "virtual game night ideas"
  - List games (including your UNO game)
  - Broader appeal to non-gamers

**Where to publish:**
- Your own blog (create `/blog` section if needed)
- Medium (cross-post)
- Dev.to (if technical angle)

---

### Step 8: Monitor & Optimize (Ongoing)

#### Weekly Checks
- [ ] Check Google Search Console for crawl errors
- [ ] Review Google Analytics traffic (top pages, sources)
- [ ] Monitor server logs for errors: `pm2 logs` (if using PM2)
- [ ] Check uptime (use UptimeRobot.com - free monitoring)

#### Monthly Tasks
- [ ] Publish 2-4 new blog posts
- [ ] Check keyword rankings in Search Console
- [ ] Review top landing pages, optimize low performers
- [ ] Build 3-5 backlinks (guest posts, directory submissions, outreach)
- [ ] Run Lighthouse audit again, improve scores if needed

---

## 🎯 Success Metrics to Track

### Month 1 Goals
- [ ] 1,000 organic visitors
- [ ] 100+ rooms created
- [ ] 500+ games played
- [ ] 5+ indexed pages in Google

### Month 3 Goals
- [ ] 10,000 organic visitors
- [ ] Rank #1-10 for 5+ long-tail keywords
- [ ] 1,000+ rooms created per month
- [ ] 20+ backlinks

### Month 6 Goals
- [ ] 50,000 organic visitors
- [ ] Rank #1-5 for "free multiplayer uno online"
- [ ] 5,000+ monthly active players
- [ ] Domain Authority (DA) 20+

---

## 🆘 Troubleshooting

### Domain not loading
**Problem:** Typed playunofree.com but got "site can't be reached"

**Fix:**
1. Check DNS propagation: https://dnschecker.org (enter playunofree.com)
2. Wait 10-60 minutes after adding DNS records
3. Clear browser cache: Ctrl+Shift+Del → Clear cache
4. Try incognito mode
5. Check hosting is running (Railway/Render dashboard)

---

### Game not loading
**Problem:** Homepage loads but /play is blank

**Fix:**
1. Check browser console (F12) for errors
2. Verify `public/index.html` exists
3. Check server logs for 404 errors
4. Ensure `BASE_URL` in `.env` matches your domain

---

### WebSockets not connecting
**Problem:** "Connecting..." stuck on screen

**Fix:**
1. Check if MongoDB connection works (check server logs)
2. Verify Socket.io is running (check port 3000)
3. If using Nginx, ensure WebSocket proxy is configured
4. Check firewall allows port 3000

---

## 💰 Budget Recap

| Item | Year 1 Cost | Renewal (Year 2) |
|------|-------------|------------------|
| Domain | ₹1 | ₹1,599 |
| Hosting (Railway) | ₹3,600 (~$5/mo × 12) | ₹3,600 |
| SSL | ₹0 (free) | ₹0 |
| Analytics | ₹0 (free) | ₹0 |
| **Total** | **₹3,601** | **₹5,199** |

**Monthly:** ~₹300 (Year 1), ~₹433 (Year 2+)

---

## 📚 Resources

- **DEPLOYMENT.md** - Full hosting setup guide
- **REBRANDING_SUMMARY.md** - All changes documented
- SEO Plan: `.claude/plans/suggest-name-and-domain-splendid-noodle.md`

---

## ✅ Final Pre-Launch Checklist

Before announcing to the world:

- [ ] Domain registered and DNS configured
- [ ] Site deployed and accessible at playunofree.com
- [ ] All pages load correctly (homepage, game, rules, FAQ, etc.)
- [ ] Game works end-to-end (create room, join, play cards)
- [ ] Mobile responsive (tested on phone)
- [ ] Google Search Console verified and sitemap submitted
- [ ] Google Analytics installed and tracking
- [ ] Lighthouse scores 90+ (performance, SEO, accessibility)
- [ ] SSL certificate active (https:// works)
- [ ] Error monitoring set up (check server logs)

**Once all boxes checked:** 🎉 You're ready to launch!

---

## 🚀 Launch Day Plan

1. **Morning:** Post on Reddit (r/WebGames, r/IndieGaming)
2. **Afternoon:** Submit to Product Hunt
3. **Evening:** Share on Twitter/LinkedIn/Facebook
4. **Week 1:** Submit to game directories (itch.io, CrazyGames, Poki)

**Remember:** Don't spam. Follow each platform's rules. Engage authentically with comments and feedback.

---

## 🎊 Post-Launch

After launching:
- Monitor traffic in Google Analytics
- Respond to user feedback and bug reports
- Fix any critical bugs immediately
- Start publishing SEO blog posts (week 2)
- Track keyword rankings in Search Console

**Good luck! 🎮 You've got this!**

---

**Questions?** Re-read DEPLOYMENT.md or check server logs first.

**Last Updated:** 2026-07-01  
**Domain:** playunofree.com  
**Status:** Ready to launch! 🚀
