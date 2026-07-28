# Google AdSense Setup Guide

## Current Implementation

AdSense has been integrated into your UNO game with **non-intrusive** ad placements that don't disrupt gameplay:

### Ad Placements

1. **Lobby Ad** (Bottom of main lobby screen)
   - Shows below the "View Leaderboard" link
   - Visible when players are choosing to create/join rooms
   - Users see this while waiting, not during active gameplay

2. **Post-Game Ad** (In the game stats modal)
   - Shows after a match ends, between rewards and stats table
   - Perfect timing: players are taking a break anyway
   - Natural moment for an ad without frustration

### What You Need to Do

#### Step 1: Create Ad Units in Google AdSense

1. Log into your [Google AdSense dashboard](https://www.google.com/adsense/)
2. Go to **Ads** → **By ad unit** → **Display ads**
3. Create **two new ad units**:
   - **Lobby Ad** (responsive display ad)
   - **Post-Game Ad** (responsive display ad)
4. Copy the **ad slot IDs** for each unit

#### Step 2: Replace Placeholder Ad Slot IDs

Open `public/index.html` and replace the placeholder ad slot IDs:

**Lobby Ad** (around line 211):
```html
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-5274802993197394"
     data-ad-slot="REPLACE_WITH_LOBBY_AD_SLOT_ID"  <!-- Change this -->
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
```

**Post-Game Ad** (around line 502):
```html
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-5274802993197394"
     data-ad-slot="REPLACE_WITH_POSTGAME_AD_SLOT_ID"  <!-- Change this -->
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
```

#### Step 3: Deploy and Verify

1. Deploy the updated code to your server
2. Wait 24-48 hours for Google to review your site
3. Check AdSense dashboard for impressions

### Technical Details

- **AdSense script**: Loaded in `<head>` with `async` attribute
- **Initialization**: Ads are lazy-loaded to avoid slowing down game startup
  - Lobby ad: 2 seconds after page load
  - Post-game ad: When the modal is shown
- **Responsive**: Ads automatically adapt to mobile/desktop
- **Styled**: Glass-panel styling matches your game's design

### Performance Notes

- Ads use `async` loading - won't block game startup
- Only initialized when visible (lazy loading)
- Fail gracefully if AdSense is blocked
- Mobile-optimized with responsive sizing

### Privacy & UX

✅ **Good**: Ads appear during natural breaks (lobby, post-game)  
✅ **Good**: Never during active gameplay  
✅ **Good**: Styled to match your game's aesthetic  
✅ **Good**: Auto-hide if ad blocking is detected

### Troubleshooting

**Ads not showing?**
- Check ad slot IDs are correct
- Verify site is approved in AdSense dashboard
- Check browser console for errors
- AdSense can take 24-48 hours to activate

**Ads look broken?**
- AdSense may show blank/test ads initially
- Real ads appear after site review
- Check responsive styling on mobile

**Want to add more ad spots?**
- Consider: Waiting room (while players join)
- Consider: Browse rooms screen
- **Avoid**: During active gameplay - will frustrate users

## Revenue Optimization Tips

1. **Wait for approval**: Don't expect revenue immediately
2. **Traffic matters**: More players = more impressions
3. **User experience first**: Don't add too many ads
4. **Monitor performance**: Use AdSense analytics to optimize

## Current Ad Locations Summary

| Location | When Shown | User State | Intrusion Level |
|----------|-----------|------------|----------------|
| Lobby | Main screen | Deciding what to do | Low ✅ |
| Post-Game | After match | Reviewing stats | Low ✅ |

Good luck with monetization! 🎮💰
