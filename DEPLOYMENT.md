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

# Voice chat (optional — leave unset to disable the feature entirely)
LIVEKIT_URL=wss://livekit.playunofree.com
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
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

> The live server runs the app on **port 5000**, not 3000. The snippets below
> use 3000 as the documented default — match whatever `PORT` is set to in the
> production `.env`, and check the existing `upstream` block before changing
> anything.

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

## Voice Chat (LiveKit)

Every game room gets its own voice channel. Seated players and God Mode
spectators can hear each other and talk; plain spectators are refused a token
server-side. Audio never touches the Node process — it goes browser → SFU.

The game runs perfectly well without any of this. With `LIVEKIT_URL`,
`LIVEKIT_API_KEY`, or `LIVEKIT_API_SECRET` unset the server logs
`voice chat disabled` at boot and the mic button reports it as unavailable.

### What runs where

| Piece | Where | Purpose |
|-------|-------|---------|
| Node app | existing PM2 process | mints room-scoped JWTs, kicks people out of voice |
| LiveKit server | Docker on the same VPS | the SFU that actually relays audio |
| nginx | existing | terminates TLS for `livekit.playunofree.com` |

LiveKit has a built-in TURN server, so coturn is not needed.

> **Do not use `curl -sSL https://get.livekit.io | bash` or the `livekit/generate`
> cloud-init script on this box.** Both install Caddy and take over ports 80 and
> 443, which nginx already owns for the game itself. The manual setup below
> reuses the existing nginx instead.

### 1. DNS and certificate

Point a `livekit` A record at the same IP as the site, then issue a
certificate for it. LiveKit's TURN/TLS listener reads the cert directly, so
this has to exist before LiveKit starts.

```bash
certbot certonly --nginx -d livekit.playunofree.com
```

**Cloudflare users: create this record as DNS-only (grey cloud) from the
start.** Cloudflare's proxy does not carry WebRTC media, so it has to be grey
regardless — and creating it grey first means the browser talks straight to
nginx, which has two consequences:

- The origin certificate is now validated by the visitor's browser, not just by
  Cloudflare. A real Let's Encrypt cert for this subdomain is mandatory; the
  main site can get away with a mismatched origin cert only because Cloudflare
  is re-terminating TLS in front of it.
- The HTTP-01 challenge reaches your server directly, so certbot works without
  fighting the proxy.

Be aware this publishes your origin IP, which Cloudflare would otherwise hide.
There is no way around it: WebRTC media needs a hostname that resolves to the
real server. For a casual game this is a normal trade-off, but do not assume
Cloudflare's DDoS protection covers you once the IP is public.

### 2. Install LiveKit

Generate a key pair and keep the secret out of git:

```bash
docker run --rm livekit/livekit-server generate-keys
```

Write `/opt/livekit/livekit.yaml` using the generated values:

```yaml
port: 7880
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
keys:
  <API_KEY>: <API_SECRET>
turn:
  enabled: true
  domain: livekit.playunofree.com
  udp_port: 3478
  tls_port: 5349
  cert_file: /etc/letsencrypt/live/livekit.playunofree.com/fullchain.pem
  key_file: /etc/letsencrypt/live/livekit.playunofree.com/privkey.pem
```

Omitting `udp_port` leaves TURN reachable over TLS only. That still works, but
plain UDP is the cheaper path and worth having as well. Confirm both appear in
the startup log as `turn.portTLS` and `turn.portUDP`.

Then `/opt/livekit/docker-compose.yaml`:

```yaml
services:
  livekit:
    image: livekit/livekit-server:latest
    command: --config /etc/livekit.yaml
    restart: unless-stopped
    network_mode: host
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
```

`network_mode: host` matters — mapping a 10,000-port UDP range through Docker's
NAT is slow to start and unreliable in practice.

Mount the **whole** `/etc/letsencrypt` tree at the same path, and point
`cert_file` at the `live/` path. Everything in `live/` is a symlink to
`../../archive/<domain>/fullchainN.pem`, and that relative path only resolves if
the directory sits at the same depth inside the container as it does on the
host. Mounting just `live/<domain>` somewhere shorter, such as
`/etc/livekit/certs`, makes the symlink point at a path that does not exist and
LiveKit crash-loops with:

```
TURN tls cert required: open .../fullchain.pem: no such file or directory
```

This also means renewals keep working, since the new `fullchainN.pem` is already
inside the mounted tree.

```bash
cd /opt/livekit && docker compose up -d && docker compose logs -f
```

Put the same `<API_KEY>` / `<API_SECRET>` into the app's `.env` as
`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`, set
`LIVEKIT_URL=wss://livekit.playunofree.com`, then `pm2 restart uno-free`.

### 3. Firewall

WebRTC media is UDP. Without these ports open, voice will look fine on home
Wi-Fi and fail on mobile data.

```bash
ufw allow 7881/tcp        # LiveKit RTC over TCP fallback
ufw allow 3478/udp        # TURN over UDP
ufw allow 5349/tcp        # TURN over TLS
ufw allow 50000:60000/udp # RTC media (rtc.port_range_*)
ufw allow 30000:40000/udp # TURN relay (turn.relay_range_*)
```

The TURN relay range is separate from the RTC media range and defaults to
30000-40000. Miss it and TURN accepts the connection but has no port to relay
through, which looks like voice working for most people and silently failing for
anyone on a restrictive network. Check the `Starting TURN server` line in the
log for the actual values.

Port 443/tcp is already open for the site. Port 7880 must **not** be opened —
it is reached only through nginx on localhost.

### 4. nginx for the SFU

> **Do not write this block before the certificate exists.** nginx refuses to
> load a config referencing a missing certificate file, and `nginx -t` fails
> with `cannot load certificate ... No such file or directory`. The already
> running nginx keeps serving the old config, so the site stays up — but a
> `systemctl restart` at that point takes the whole site down. If you hit this,
> cut the file back to just the `listen 80` block from step 1, reload, run
> certbot, and then come back here.

Add a second server block. Certbot will have already added the `ssl_*` lines
for this subdomain when you ran it in step 1.

```nginx
server {
    listen 443 ssl;
    server_name livekit.playunofree.com;

    ssl_certificate     /etc/letsencrypt/live/livekit.playunofree.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/livekit.playunofree.com/privkey.pem;

    location / {
        proxy_pass http://localhost:7880;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400;
    }
}
```

```bash
nginx -t && systemctl reload nginx
curl https://livekit.playunofree.com   # expects: OK
```

### 5. Certificate renewal

LiveKit reads the TURN certificate once at startup, so it keeps serving the old
one after certbot renews. Restart it on renewal:

```bash
# /etc/letsencrypt/renewal-hooks/deploy/livekit.sh  (chmod +x)
#!/bin/sh
cd /opt/livekit && docker compose restart livekit
```

### 6. Sizing

Audio costs far more than card events. Budget roughly 50-100 kbps of uplink per
person actively speaking, multiplied by the listeners in that room. 2 vCPU /
2 GB RAM comfortably handles a handful of concurrent chatty rooms; scale up
before you scale out.

### Local testing without a VPS

LiveKit's dev mode needs no certificates and no config file. `localhost` counts
as a secure context, so microphone access works over plain HTTP.

```bash
docker run -d --name livekit-dev --rm \
  -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  livekit/livekit-server --dev --bind 0.0.0.0 --node-ip=<your-LAN-IP>
```

**`--node-ip` is required on Docker Desktop (Windows/macOS).** Containers there
run inside a VM, so without it LiveKit advertises its internal Docker address as
the ICE candidate and the browser cannot reach it. The symptom is confusing:
signalling succeeds and the logs show the participant joining the room, then the
connection dies with `ConnectionError: could not establish pc connection`.
Confirm the fix took by checking `docker logs livekit-dev` for
`"nodeIP": "<your-LAN-IP>"` rather than a `172.x` address. Find the IP with
`ipconfig` on Windows or `ipconfig getifaddr en0` on macOS; `127.0.0.1` also
works and survives the LAN address changing. On Linux this flag is unnecessary —
use `--network host` instead.

Dev mode always uses the key `devkey` and secret `secret`, so the local `.env` is:

```env
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secret
```

Never use these values in production — they are public and identical for
everyone. Note `ws://`, not `wss://`: dev mode does not terminate TLS.

### Verifying

1. Open a room in two browsers, click the 🎧 button in both
2. Both should appear in the VOICE pill at the top of the screen
3. Click again to unmute — the chip turns green while you talk
4. `docker compose logs livekit` shows participants joining room `uno-UNO-XXXX`

For God Mode, start the game first, then join from a third browser with the
God Mode password. That window should get the same 🎧 button and land in the
same voice room as the players. A plain spectator gets no button at all.

### Troubleshooting

| Symptom | Cause |
|---------|-------|
| "Voice chat is not available on this server" | `LIVEKIT_*` env vars missing — restart PM2 after adding them |
| Connects, but nobody hears anyone | UDP media ports blocked; check `ufw status` |
| Works on Wi-Fi, fails on mobile data | TURN not reachable — check ports 3478/udp and 5349/tcp |
| "Could not reach the voice server" | nginx subdomain or its certificate is misconfigured |
| Mic button shows 🚫 | Browser denied mic permission (site settings) |
| Container exits at boot | Bad `livekit.yaml`, or the cert paths don't exist yet |
| Voice breaks ~90 days after setup | Certbot renewed but LiveKit still serves the old TURN cert — add the deploy hook |

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
