# Play UNO Free — Deployment Guide

## Domain & Branding

**Domain:** playunofree.com  
**Brand Name:** Play UNO Free  
**Tagline:** "Up to 20 Players. Always Free. No Downloads."

---

## Pre-Deployment Checklist

### 1. Domain Registration ✅
- [x] Register playunofree.com (₹1 for first year)
- [ ] Enable WHOIS privacy
- [ ] Enable auto-renewal
- [ ] Configure DNS records (see below)

### 2. DNS Configuration

Once you have hosting, point your domain to your server:

```
Type: A Record
Name: @
Value: <your-server-ip>
TTL: 3600

Type: A Record  
Name: www
Value: <your-server-ip>
TTL: 3600
```

For Cloudflare users:
- Enable "Proxy status" (orange cloud) for DDoS protection
- SSL/TLS mode: "Full (strict)"

### 3. Environment Variables

Update `.env` file on production server:

```env
MONGODB_URI=mongodb+srv://flowsync:flowsync123@flowsync.fsdy2.mongodb.net/uno-game
BASE_URL=https://playunofree.com
PORT=3000
NODE_ENV=production
```

### 4. SSL Certificate

**Option A: Let's Encrypt (Free)**
```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d playunofree.com -d www.playunofree.com
```

**Option B: Cloudflare (Recommended)**
- Cloudflare provides free SSL automatically
- No configuration needed if using Cloudflare DNS

---

## Deployment Options

### Option 1: Railway (Recommended for Beginners)

1. Go to [Railway.app](https://railway.app)
2. Connect your GitHub repo
3. Add environment variables:
   - `BASE_URL`: https://playunofree.com
   - `MONGODB_URI`: (your MongoDB URI)
   - `PORT`: 3000
4. Add custom domain: playunofree.com
5. Deploy

**Cost:** $5/month (includes 500GB bandwidth)

---

### Option 2: Render

1. Go to [Render.com](https://render.com)
2. Create new Web Service
3. Connect GitHub repo
4. Build command: `npm install`
5. Start command: `npm start`
6. Add environment variables
7. Add custom domain

**Cost:** Free tier available (sleeps after inactivity)

---

### Option 3: DigitalOcean / Linode (More Control)

**Requirements:**
- Ubuntu 22.04 server
- 1GB RAM minimum
- Node.js 18+

**Setup:**

```bash
# SSH into server
ssh root@your-server-ip

# Update system
apt update && apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt install -y nodejs

# Install PM2
npm install -g pm2

# Clone repo
git clone https://github.com/yourusername/playunofree.git
cd playunofree

# Install dependencies
npm install

# Create .env file
nano .env
# (paste your environment variables)

# Start with PM2
pm2 start server/index.js --name "uno-free"
pm2 save
pm2 startup

# Install Nginx
apt install -y nginx

# Configure Nginx
nano /etc/nginx/sites-available/playunofree.com
```

**Nginx Configuration:**

```nginx
server {
    listen 80;
    server_name playunofree.com www.playunofree.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**Enable site:**
```bash
ln -s /etc/nginx/sites-available/playunofree.com /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx

# Install SSL
certbot --nginx -d playunofree.com -d www.playunofree.com
```

**Cost:** $6-12/month

---

## Post-Deployment SEO Setup

### 1. Google Search Console (Week 1)

1. Go to [Google Search Console](https://search.google.com/search-console)
2. Add property: playunofree.com
3. Verify ownership (DNS TXT record or HTML file)
4. Submit sitemap: https://playunofree.com/sitemap.xml
5. Request indexing for homepage

### 2. Bing Webmaster Tools

1. Go to [Bing Webmaster](https://www.bing.com/webmasters)
2. Add site: playunofree.com
3. Import from Google Search Console (easier)
4. Submit sitemap

### 3. Google Analytics 4

1. Go to [Google Analytics](https://analytics.google.com)
2. Create new property: Play UNO Free
3. Get Measurement ID (G-XXXXXXXXXX)
4. Add to `views/partials/head.ejs` before `</head>`:

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

### 4. Submit to Game Directories

- [itch.io](https://itch.io/game/new) - HTML5 games
- [CrazyGames](https://developer.crazygames.com/) - Submit game
- [Poki](https://developers.poki.com/) - Developer portal
- [Y8.com](https://www.y8.com/submit) - Submit game
- [Kongregate](https://www.kongregate.com/games/new) - Upload game

### 5. Social Media Setup (Optional)

**Twitter:** @playunofree  
**Facebook:** facebook.com/playunofree  
**Discord:** Create community server

Add social links to `server/routes/seoPages.js` Organization schema (already done).

---

## Monitoring & Maintenance

### Check Site Health

```bash
# Check if server is running
pm2 status

# View logs
pm2 logs uno-free

# Restart if needed
pm2 restart uno-free

# Monitor resource usage
pm2 monit
```

### Performance Testing

- **Lighthouse:** Run in Chrome DevTools (Ctrl+Shift+I → Lighthouse)
- **PageSpeed Insights:** https://pagespeed.web.dev/
- **GTmetrix:** https://gtmetrix.com/

**Target Scores:**
- Performance: 90+
- SEO: 95+
- Accessibility: 90+
- Best Practices: 95+

### Monthly SEO Tasks

1. Check Google Search Console for errors
2. Review top performing pages
3. Update blog with 2-4 new posts
4. Monitor keyword rankings (use Google Search Console)
5. Check backlinks (use Ahrefs/SEMrush if available)

---

## Troubleshooting

### Issue: Site not loading

**Check:**
1. Is server running? `pm2 status`
2. Is port 3000 open? `netstat -tulpn | grep 3000`
3. Is Nginx running? `systemctl status nginx`
4. Check logs: `pm2 logs`

### Issue: WebSockets not connecting

**Check:**
1. Nginx WebSocket config correct? (see above)
2. Firewall blocking port? `ufw allow 80` and `ufw allow 443`
3. Check browser console for errors

### Issue: SSL certificate errors

**Fix:**
```bash
certbot renew --dry-run
certbot renew --force-renewal
systemctl restart nginx
```

---

## Backup Strategy

### MongoDB Backup (Daily)

```bash
# Manual backup
mongodump --uri="mongodb+srv://flowsync:flowsync123@flowsync.fsdy2.mongodb.net/uno-game" --out=/backups/$(date +%Y%m%d)

# Automated daily backup (crontab)
0 2 * * * mongodump --uri="..." --out=/backups/$(date +\%Y\%m\%d) && find /backups -mtime +7 -delete
```

### Code Backup

Use Git! Push to GitHub/GitLab regularly:

```bash
git add .
git commit -m "Update: ..."
git push origin main
```

---

## Cost Estimate

| Item | Cost (Monthly) | Notes |
|------|---------------|-------|
| Domain (playunofree.com) | ₹83 (~$1/mo amortized) | ₹1 first year, ₹1599/year renewal |
| Hosting (Railway) | $5 | Includes 500GB bandwidth |
| MongoDB Atlas | $0 | Free tier (512MB) |
| **Total** | **~₹500/mo** | ~$6/month |

**Free alternatives:**
- Hosting: Render.com (free tier, sleeps after 15min inactivity)
- Domain: Keep using .com (good for SEO)

---

## Launch Checklist

**Before Launch:**
- [ ] Domain registered and DNS configured
- [ ] SSL certificate installed
- [ ] Environment variables set on production
- [ ] Test all pages (homepage, /play, /rules, /faq, etc.)
- [ ] Test game functionality (create room, join room, play cards)
- [ ] Test mobile responsiveness
- [ ] Run Lighthouse audit (scores 90+)
- [ ] Verify sitemap.xml loads
- [ ] Verify robots.txt loads
- [ ] Test OG image preview (paste link in Discord/Slack)

**After Launch:**
- [ ] Submit to Google Search Console
- [ ] Submit to Bing Webmaster Tools
- [ ] Install Google Analytics
- [ ] Post on Reddit (r/WebGames, r/IndieGaming)
- [ ] Submit to game directories
- [ ] Monitor errors in server logs

---

## Support

**Issues?** Check logs first:
```bash
pm2 logs uno-free --lines 100
```

**Need help?** File an issue on GitHub or contact via email.

---

**Good luck with the launch! 🎮🎉**
