// ─── Banner Ads (Monetag) ─────────────────────────────────────────────────────
// One reusable loader for the whole site, on every surface EXCEPT the live game
// board. Each ad renders inside its OWN fixed-size <iframe srcdoc> so that:
//   • it is always perfectly centered (we position a known-size box; Monetag can
//     only draw inside it and cannot escape our layout), and
//   • many ads can share one page — each iframe has its own document + atOptions,
//     so the global `atOptions` never collides.
// Exactly one unit per slot is chosen by viewport (≥768→728×90, 480–767→468×60,
// <480→320×50). The slot's height is reserved BEFORE the iframe loads (no layout
// shift), and a slot only reloads when a resize actually crosses a breakpoint.
// Keys and invoke.js URLs are the exact values supplied by Monetag — do not edit.
// ──────────────────────────────────────────────────────────────────────────────
(function () {
  'use strict';

  const INVOKE_BASE = 'https://www.highrevenueformat.com/';

  const UNITS = {
    desktop: { key: '04419a97d873f7eaf8f968751dc4dd70', width: 728, height: 90, cls: 'is-728' },
    tablet:  { key: 'fd9b226721810d9355a1110f6d32026a', width: 468, height: 60, cls: 'is-468' },
    mobile:  { key: '92e6fcfb1c45421439c18c745410a1bc', width: 320, height: 50, cls: 'is-320' },
  };
  const SIZE_CLASSES = ['is-728', 'is-468', 'is-320'];

  function pickUnit() {
    const w = window.innerWidth;
    if (w >= 768) return UNITS.desktop;
    if (w >= 480) return UNITS.tablet;
    return UNITS.mobile;
  }

  // Build an isolated ad iframe: its own mini-document runs the exact Monetag
  // snippet (atOptions + invoke.js). Fixed width/height → we center this box.
  function buildAdIframe(unit) {
    const opts = JSON.stringify({ key: unit.key, format: 'iframe', height: unit.height, width: unit.width, params: {} });
    const doc =
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}' +
      'body{width:' + unit.width + 'px;height:' + unit.height + 'px}</style></head><body>' +
      '<script>window.atOptions=' + opts + ';<\/script>' +
      '<script src="' + INVOKE_BASE + unit.key + '/invoke.js"><\/script>' +
      '</body></html>';
    const f = document.createElement('iframe');
    f.width = unit.width;
    f.height = unit.height;
    f.setAttribute('scrolling', 'no');
    f.setAttribute('frameborder', '0');
    f.setAttribute('title', 'Advertisement');
    f.setAttribute('aria-hidden', 'true');
    // Contain the ad. `allow-scripts` lets the banner render; the DELIBERATE
    // absence of allow-top-navigation, allow-popups and allow-same-origin means
    // the ad code cannot redirect the page (window.top.location) or open
    // popunders (window.open) — the exact abuse Monetag's payloads attempt.
    f.setAttribute('sandbox', 'allow-scripts');
    f.style.cssText = 'width:' + unit.width + 'px;height:' + unit.height +
      'px;border:0;display:block;margin:0 auto;overflow:hidden';
    f.srcdoc = doc;
    return f;
  }

  // Fill a slot with the viewport-appropriate unit. Idempotent per slot+size.
  function renderSlot(wrap) {
    const container = wrap.querySelector('.banner-ad__container');
    if (!container) return;
    const unit = pickUnit();
    if (wrap.getAttribute('data-bp') === unit.cls) return; // already this size
    container.innerHTML = '';
    wrap.classList.remove.apply(wrap.classList, SIZE_CLASSES);
    wrap.classList.add(unit.cls); // reserve exact height BEFORE the iframe loads
    wrap.setAttribute('data-bp', unit.cls);
    container.appendChild(buildAdIframe(unit));
    bindResize();
  }

  function clearSlot(wrap) {
    const container = wrap.querySelector('.banner-ad__container');
    if (container) container.innerHTML = '';
    wrap.classList.remove.apply(wrap.classList, SIZE_CLASSES);
    wrap.removeAttribute('data-bp');
  }

  // ── Resize: reload every mounted slot only when the breakpoint bucket changes.
  let lastCls = pickUnit().cls;
  let resizeTimer = null;
  let resizeBound = false;
  function bindResize() {
    if (resizeBound) return;
    window.addEventListener('resize', onResize);
    resizeBound = true;
  }
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      const cls = pickUnit().cls;
      if (cls === lastCls) return;
      lastCls = cls;
      // Re-render whatever is currently mounted (data-bp set), in place.
      var mounted = document.querySelectorAll('.banner-ad[data-bp]');
      for (var i = 0; i < mounted.length; i++) {
        mounted[i].removeAttribute('data-bp'); // force rebuild at the new size
        renderSlot(mounted[i]);
      }
    }, 250);
  }

  // ── SPA: follow the active screen. Mount all slots inside it; clear the rest.
  function syncScreens() {
    var slots = document.querySelectorAll('.screen .banner-ad');
    for (var i = 0; i < slots.length; i++) {
      var screen = slots[i].closest('.screen');
      if (screen && screen.classList.contains('active')) renderSlot(slots[i]);
      else clearSlot(slots[i]);
    }
  }

  // ── Content pages: build extra slots at structural points, then fill all.
  function makeSlot() {
    var w = document.createElement('div');
    w.className = 'banner-ad banner-ad--page';
    w.setAttribute('aria-hidden', 'true');
    var c = document.createElement('div');
    c.className = 'banner-ad__container';
    w.appendChild(c);
    return w;
  }
  function autoInjectContentSlots() {
    var main = document.querySelector('main#main-content') ||
               document.querySelector('main.content-page') ||
               document.querySelector('main');
    if (!main) return;
    var host = main.querySelector('.container') || main;
    var article = host.querySelector('.blog-article') || host;

    // Top slot — after the breadcrumbs, else at the top of the content column.
    var bc = host.querySelector('.breadcrumbs');
    var top = makeSlot();
    if (bc && bc.parentNode) bc.parentNode.insertBefore(top, bc.nextSibling);
    else host.insertBefore(top, host.firstChild);

    // In-content slots — before evenly-spaced h2 headings (skip the first one),
    // up to 4, so a typical page lands around 6 ads total (top + 4 + footer).
    var heads = Array.prototype.slice.call(article.querySelectorAll('h2')).slice(1);
    if (heads.length) {
      var want = 4;
      var step = Math.max(1, Math.floor(heads.length / want));
      var placed = 0;
      for (var i = 0; i < heads.length && placed < want; i += step) {
        var h = heads[i];
        if (h && h.parentNode) { h.parentNode.insertBefore(makeSlot(), h); placed++; }
      }
    }
  }

  window.BannerAd = { syncScreens: syncScreens, renderSlot: renderSlot };

  function init() {
    if (document.querySelector('.screen')) {
      // SPA. When the URL carries a room code, the lobby is shown only for a
      // moment before we reconnect into the room — mounting its ads there just
      // spends same-zone loads that then starve the room screen's ad. Skip the
      // immediate mount and let showScreen() load the destination screen's ad;
      // a delayed fallback still mounts the lobby if we never navigate away
      // (e.g. the room was invalid). When there is no room code, the lobby is
      // the real landing page, so mount right away.
      if (/[?&]room=/.test(location.search)) {
        setTimeout(syncScreens, 1800);
      } else {
        syncScreens();
      }
    } else {
      autoInjectContentSlots();
      var slots = document.querySelectorAll('.banner-ad');
      for (var i = 0; i < slots.length; i++) renderSlot(slots[i]);
    }
    bindResize();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
