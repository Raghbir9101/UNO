const Game = (() => {
  let canvas, ctx, animFrameId = null, resizeTimeout = null;

  const state = {
    active: false, myId: null, hostId: null,
    players: [], myHand: [],
    discardTop: null, activeColor: null,
    currentPlayer: null, direction: 1,
    drawPileCount: 0, pendingDraw: 0, pendingDrawType: null,
    unoState: {},
    selectedCardIndex: -1, scrollOffset: 0,
    showColorPicker: false, pendingWildCardId: null,
    unoHighlight: false,
    winner: null, winnerName: null,
    hasDrawnThisTurn: false,  // true after drawing → shows Pass button
  };

  let _flyingCardId  = null; // card hidden from canvas while it flies
  let _dealAnimating = false; // true during initial deal → hand is hidden

  let hitRegions = { cardRects: [], pileRects: {}, buttonRects: {}, colorRects: [], winRects: {} };
  let touchStartX = 0, scrollStartOffset = 0, isDragging = false, dragDist = 0;

  // ── DOM Animation System ──
  let animOverlay = null;
  function showDomAnim(className, innerHTML, duration) {
    if (!animOverlay) animOverlay = document.getElementById('anim-overlay');
    if (!animOverlay) { console.error('[ANIM] Overlay not found!'); return; }
    const el = document.createElement('div');
    el.className = 'anim-el ' + className;
    if (innerHTML) el.innerHTML = innerHTML;
    animOverlay.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, duration + 100);
  }

  // ── FLIP Animation State ──
  // Store last-known card positions keyed by cardId so we can FLIP on hand change
  let _prevCardPositions = {}; // { cardId: { x, y, w, h } }
  let _pendingFlips = [];       // [ { el, dx, dy } ] DOM elements needing inversion

  function init(canvasEl, playerId, hostId) {
    canvas = canvasEl; ctx = canvas.getContext('2d');
    state.myId = playerId; state.hostId = hostId; state.active = true;
    resizeCanvas();
    animOverlay = document.getElementById('anim-overlay');
    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp, { passive: false });
    canvas.addEventListener('pointercancel', onUp, { passive: false });
    window.addEventListener('resize', debResize);
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 200));
    requestAnimationFrame(loop);
  }

  function destroy() {
    state.active = false;
    if (animFrameId) cancelAnimationFrame(animFrameId);
    window.removeEventListener('resize', debResize);
  }

  function resizeCanvas() {
    const p = canvas.parentElement, maxW = 600;
    const w = Math.min(p.clientWidth, maxW), h = p.clientHeight;
    canvas.width = w * devicePixelRatio; canvas.height = h * devicePixelRatio;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.style.marginLeft = w < maxW ? '0' : ((p.clientWidth - maxW) / 2) + 'px';
    Renderer.updateScale(canvas);
  }
  function debResize() { clearTimeout(resizeTimeout); resizeTimeout = setTimeout(resizeCanvas, 150); }

  function loop() {
    if (!state.active) return;
    state.unoHighlight = Object.entries(state.unoState).some(([, u]) => !u.called);
    try { render(); } catch(err) { console.error('Render error:', err); }
    animFrameId = requestAnimationFrame(loop);
  }

  function render() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    Renderer.drawBackground(ctx, W, H);

    if (state.winner) {
      hitRegions.winRects = Renderer.drawWinScreen(ctx, state.winnerName, state.myId === state.hostId, W, H);
      return;
    }

    // Opponents
    const oppData = state.players.map(p => ({ id: p.id, nickname: p.nickname, cardCount: p.cardCount }));
    Renderer.drawOpponents(ctx, oppData, state.myId, state.currentPlayer, state.direction, W, H);

    // Direction
    Renderer.drawDirectionArrow(ctx, state.direction, W, H);

    // Piles
    hitRegions.pileRects = Renderer.drawPiles(ctx, state.discardTop, state.activeColor, state.drawPileCount, W, H);

    // Turn indicator
    const isMyTurn = state.currentPlayer === state.myId;
    Renderer.drawTurnIndicator(ctx, isMyTurn, W, H);

    // Buttons
    hitRegions.buttonRects = Renderer.drawActionButtons(ctx, {
      isMyTurn, pendingDraw: state.pendingDraw, unoHighlight: state.unoHighlight
    }, W, H);

    // Hand — skip the card currently in-flight; hide everything during deal animation
    if (!_dealAnimating) {
      const hr = Renderer.drawPlayerHand(ctx, state.myHand, -1, state.scrollOffset, W, H, _flyingCardId);
      hitRegions.cardRects = hr.cardRects || [];
      _prevCardPositions = {};
      hr.cardRects.forEach(r => { _prevCardPositions[r.cardId] = { x: r.x, y: r.y, w: r.w, h: r.h }; });
    } else {
      hitRegions.cardRects = [];
    }

    // Color picker overlay
    if (state.showColorPicker) {
      hitRegions.colorRects = Renderer.drawColorPicker(ctx, W, H);
    }
  }

  // ── Input ──
  function xy(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
  }
  function hit(px, py, r) { return r && px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }

  function onDown(e) {
    e.preventDefault();
    const { x } = xy(e);
    touchStartX = x; scrollStartOffset = state.scrollOffset;
    isDragging = false; dragDist = 0;
  }

  function onMove(e) {
    e.preventDefault();
    const { x } = xy(e);
    dragDist = Math.abs(x - touchStartX);
    if (dragDist > Renderer.vs(8)) {
      isDragging = true;
      state.scrollOffset = scrollStartOffset + (x - touchStartX);
      // Clamp
      const cw = Math.min(canvas.width * 0.16, Renderer.vs(60));
      const ov = Math.min(cw * 0.72, (canvas.width - Renderer.vs(24) - cw) / Math.max(state.myHand.length - 1, 1));
      const tw = cw + (state.myHand.length - 1) * ov;
      const mx = Math.max(0, tw - canvas.width + Renderer.vs(24));
      state.scrollOffset = Math.max(-mx, Math.min(0, state.scrollOffset));
    }
  }

  function onUp(e) {
    e.preventDefault();
    if (isDragging) { isDragging = false; return; }
    const { x, y } = xy(e);

    // Color picker
    if (state.showColorPicker && hitRegions.colorRects) {
      for (const cr of hitRegions.colorRects) {
        if (hit(x, y, cr)) {
          state.showColorPicker = false;
          Game.onPlayCard?.(state.pendingWildCardId, cr.color);
          state.pendingWildCardId = null; state.selectedCardIndex = -1;
          return;
        }
      }
      state.showColorPicker = false; state.pendingWildCardId = null; return;
    }

    // Win screen
    if (state.winner && hit(x, y, hitRegions.winRects?.playAgain)) { Game.onRestartGame?.(); return; }

    // UNO button
    if (hit(x, y, hitRegions.buttonRects?.uno)) {
      if (state.myHand.length === 1 && state.unoState[state.myId] && !state.unoState[state.myId].called) {
        Game.onCallUno?.();
      } else {
        for (const [pid, u] of Object.entries(state.unoState)) {
          if (pid !== state.myId && !u.called) { Game.onCatchUno?.(pid); break; }
        }
      }
      return;
    }

    // Draw/Pass or Pass (after drawing)
    if (hit(x, y, hitRegions.buttonRects?.draw) || hit(x, y, hitRegions.pileRects?.draw)) {
      if (state.currentPlayer === state.myId) {
        if (state.hasDrawnThisTurn) {
          // Already drew — this is the Pass button, just pass
          Game.onPassTurn?.();
        } else {
          // Draw one card from deck with real card-back animation
          flyCardFromDeck(0, 1, true);
          Game.onDrawCard?.();
        }
      }
      return;
    }

    // Cards — single tap to play immediately
    for (let i = hitRegions.cardRects.length - 1; i >= 0; i--) {
      const cr = hitRegions.cardRects[i];
      if (hit(x, y, cr)) {
        tryPlayCard(cr.index);
        return;
      }
    }
  }

  // ── Card Play: snapshot the real card pixels and animate that image ──────────
  // No generic placeholder — the actual rendered card flies to the discard pile.

  function flyCardToDiscard(cardRect, card) {
    if (!animOverlay || !canvas) return;

    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width  / canvas.width;
    const scaleY = canvasRect.height / canvas.height;

    // Screen-space start (where the card is on screen)
    const startLeft = canvasRect.left + cardRect.x * scaleX;
    const startTop  = canvasRect.top  + cardRect.y * scaleY;
    const screenW   = cardRect.w * scaleX;
    const screenH   = cardRect.h * scaleY;

    // Render the card fresh onto an offscreen canvas using the Renderer.
    // This is synchronous and reliable — no toDataURL decode race condition.
    const snap = document.createElement('canvas');
    snap.width  = cardRect.w;
    snap.height = cardRect.h;
    const snapCtx = snap.getContext('2d');
    // Temporarily tell Renderer to scale 1:1 for this offscreen draw
    Renderer.drawCard(snapCtx, card, 0, 0, cardRect.w, cardRect.h, { faceUp: true });

    // Hide this card from the canvas so there's no duplicate while it flies
    _flyingCardId = card ? card.id : null;

    // Use a canvas element directly as the animated element (no img decode wait)
    const flyEl = snap;
    flyEl.className = 'anim-el';
    flyEl.style.position      = 'absolute';
    flyEl.style.left          = startLeft + 'px';
    flyEl.style.top           = startTop  + 'px';
    flyEl.style.width         = screenW   + 'px';
    flyEl.style.height        = screenH   + 'px';
    flyEl.style.borderRadius  = Math.round(cardRect.w * 0.12 * scaleX) + 'px';
    flyEl.style.transform     = 'translate(0,0) scale(1)';
    flyEl.style.opacity       = '1';
    flyEl.style.zIndex        = '620';
    flyEl.style.willChange    = 'transform, opacity';
    flyEl.style.pointerEvents = 'none';
    animOverlay.appendChild(flyEl);

    // Discard pile center in screen coords (matches renderer: W/2 + gap, 38% H)
    const targetCX = canvasRect.left + canvasRect.width  * 0.62;
    const targetCY = canvasRect.top  + canvasRect.height * 0.38;
    const endX     = targetCX - screenW / 2;
    const endY     = targetCY - screenH / 2;
    const randomAngle = (Math.random() * 14 - 7);
    const TOTAL_MS  = 420; // total flight time
    const LIFT_MS   = 90;  // phase 1: lift
    const TRAVEL_MS = 280; // phase 2: arc travel
    const SETTLE_MS = 50;  // phase 3: settle

    // Phase 1 — Lift
    flyEl.style.transition = `transform ${LIFT_MS}ms cubic-bezier(0.34,1.56,0.64,1)`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      flyEl.style.transform = 'translate(0, -22px) scale(1.12)';
    }));

    // Phase 2 — Arc travel via RAF
    setTimeout(() => {
      const liftedTop = startTop - 22;
      const startTime = performance.now();
      flyEl.style.transition = 'none';

      function arcFrame(now) {
        const t   = Math.min(now - startTime, TRAVEL_MS);
        const p   = t / TRAVEL_MS;
        const ease = p < 0.5 ? 2*p*p : -1 + (4 - 2*p)*p;

        const x   = (endX - startLeft)  * ease;
        const y   = (liftedTop - startTop) + (endY - liftedTop) * ease
                    + Math.sin(p * Math.PI) * -70; // upward arc
        const sc  = 1.12 - 0.12 * ease;
        const rot = randomAngle * ease;

        flyEl.style.transform =
          `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${rot.toFixed(1)}deg) scale(${sc.toFixed(3)})`;

        if (t < TRAVEL_MS) {
          requestAnimationFrame(arcFrame);
        } else {
          // Phase 3 — Settle
          flyEl.style.transition =
            `transform ${SETTLE_MS}ms ease-out, opacity 120ms ease`;
          flyEl.style.transform =
            `translate(${(endX-startLeft).toFixed(1)}px,${(endY-startTop).toFixed(1)}px) rotate(${randomAngle.toFixed(1)}deg) scale(1)`;

          // Un-hide canvas card + fade out flyEl
          setTimeout(() => {
            _flyingCardId = null; // canvas draws it again (now as discardTop)
            flyEl.style.opacity = '0';
            setTimeout(() => { if (flyEl.parentNode) flyEl.parentNode.removeChild(flyEl); }, 130);
          }, SETTLE_MS + 20);
        }
      }
      requestAnimationFrame(arcFrame);
    }, LIFT_MS);
  }

  function tryPlayCard(idx) {
    const card = state.myHand[idx]; if (!card) return;
    if (state.currentPlayer !== state.myId) { Game.onShowToast?.('Not your turn', true); return; }
    if (card.type === 'wild' || card.type === 'wild4' || card.type === 'wild8') {
      state.showColorPicker = true; state.pendingWildCardId = card.id; return;
    }
    // Snapshot + fly the real card — must happen BEFORE hand state changes
    const cr = hitRegions.cardRects.find(r => r.index === idx);
    if (cr) flyCardToDiscard(cr, card);
    Game.onPlayCard?.(card.id, null);
  }

  // Public API
  function setPlayers(p) { state.players = p; }

  // ── Feature 4 + FLIP: Hand Rearrangement ──
  function setHand(c) {
    // Capture FIRST positions of cards still in the hand
    const firstPositions = {};
    for (const [cardId, pos] of Object.entries(_prevCardPositions)) {
      firstPositions[cardId] = pos;
    }

    state.myHand = c;
    if (state.selectedCardIndex >= c.length) state.selectedCardIndex = -1;

    // After next render, LAST positions will be in hitRegions.cardRects
    // Schedule FLIP on next frame (after canvas has re-rendered new positions)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        flipHandCards(firstPositions);
      });
    });
  }

  function flipHandCards(firstPositions) {
    if (!animOverlay || !canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / canvas.width;
    const scaleY = canvasRect.height / canvas.height;

    for (const r of hitRegions.cardRects) {
      const first = firstPositions[r.cardId];
      if (!first) continue; // new card — skip FLIP, just appears

      // Convert canvas coords → screen coords for both positions
      const fx = canvasRect.left + first.x * scaleX;
      const fy = canvasRect.top  + first.y * scaleY;
      const lx = canvasRect.left + r.x * scaleX;
      const ly = canvasRect.top  + r.y * scaleY;

      const dx = fx - lx;
      const dy = fy - ly;

      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue; // no movement needed

      // Create ghost element at LAST position, but offset to FIRST position
      const ghost = document.createElement('div');
      ghost.className = 'anim-el anim-card-fly';
      ghost.style.left    = lx + 'px';
      ghost.style.top     = ly + 'px';
      ghost.style.width   = (first.w * scaleX) + 'px';
      ghost.style.height  = (first.h * scaleY) + 'px';
      ghost.style.opacity = '0.85';
      ghost.style.zIndex  = '400';
      ghost.style.transform = `translate(${dx}px, ${dy}px)`; // Invert: place at FIRST
      animOverlay.appendChild(ghost);

      // PLAY: animate from FIRST back to LAST (dx,dy → 0,0)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        ghost.style.transition = 'transform 250ms ease-out, opacity 250ms ease-out';
        ghost.style.transform  = 'translate(0, 0)';
        ghost.style.opacity    = '0';
      }));

      setTimeout(() => { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 380);
    }
  }

  function updateGameState(gs) {
    const discardChanged = gs.discardTop?.id !== state.discardTop?.id;
    const playerChanged  = gs.currentPlayer !== state.currentPlayer;
    state.discardTop = gs.discardTop; state.activeColor = gs.activeColor;
    state.currentPlayer = gs.currentPlayer; state.direction = gs.direction;
    state.drawPileCount = gs.drawPileCount;
    state.pendingDraw = gs.pendingDraw || 0;
    state.pendingDrawType = gs.pendingDrawType || null;
    state.unoState = gs.unoState || {};
    // When the turn moves on, the new player hasn't drawn yet
    if (playerChanged) state.hasDrawnThisTurn = false;
    if (gs.cardCounts) for (const p of state.players) {
      if (gs.cardCounts[p.id] !== undefined) p.cardCount = gs.cardCounts[p.id];
    }
    if (discardChanged) showDomAnim('anim-card-played', '', 500);
  }

  function setWinner(id, name) { state.winner = id; state.winnerName = name; }
  function resetGame() {
    Object.assign(state, {
      winner: null, winnerName: null, myHand: [], selectedCardIndex: -1,
      scrollOffset: 0, showColorPicker: false, pendingDraw: 0, unoState: {},
      hasDrawnThisTurn: false,
    });
    _dealAnimating = false;
    _prevCardPositions = {};
    if (animOverlay) animOverlay.innerHTML = '';
  }

  // ── Directional Card-Fly from Deck ──────────────────────────────────────────
  // toSelf=true  → card flies DOWN toward player's hand (bottom of screen)
  // toSelf=false → card flies UP toward opponent area  (top of screen)
  function flyCardFromDeck(offsetIndex, total, toSelf) {
    if (!animOverlay || !canvas) return;

    const cRect   = canvas.getBoundingClientRect();
    const scaleX  = cRect.width  / canvas.width;
    const scaleY  = cRect.height / canvas.height;

    // Card size matching the deck pile card in the renderer
    // renderer: cw = Math.min(W * 0.22, vs(85)), ch = cw * 1.45
    const cw_c = Math.min(canvas.width * 0.22, Renderer.vs(85));  // canvas pixels
    const ch_c = cw_c * 1.45;
    const screenW = cw_c * scaleX;
    const screenH = ch_c * scaleY;

    // Render a real UNO card back on an offscreen canvas
    const snap = document.createElement('canvas');
    snap.width  = Math.round(cw_c);
    snap.height = Math.round(ch_c);
    const snapCtx = snap.getContext('2d');
    Renderer.drawCard(snapCtx, null, 0, 0, snap.width, snap.height, { faceUp: false });

    // Deck center in screen coords (renderer: W/2 - cw - gap, centred at 38% H)
    const deckCX = cRect.left + cRect.width  * 0.36;  // ≈ left pile center
    const deckCY = cRect.top  + cRect.height * 0.38;
    const startL = deckCX - screenW / 2;
    const startT = deckCY - screenH / 2;

    // Spread cards horizontally so they don't all land at the same spot
    const spread = (offsetIndex - (total - 1) / 2) * Math.min(screenW * 0.35, 20);
    let targetL, targetT;
    if (toSelf) {
      targetL = cRect.left + cRect.width * 0.5 + spread - screenW / 2;
      targetT = cRect.top  + cRect.height * 0.86 - screenH / 2;
    } else {
      targetL = cRect.left + cRect.width * 0.5 + spread - screenW / 2;
      targetT = cRect.top  + cRect.height * 0.10 - screenH / 2;
    }

    // Style the canvas element as an absolutely-positioned overlay
    snap.className = 'anim-el';
    snap.style.position      = 'absolute';
    snap.style.left          = startL + 'px';
    snap.style.top           = startT + 'px';
    snap.style.width         = screenW + 'px';
    snap.style.height        = screenH + 'px';
    snap.style.borderRadius  = (snap.width * 0.12 * scaleX) + 'px';
    snap.style.transform     = 'translate(0,0) scale(1)';
    snap.style.opacity       = '1';
    snap.style.zIndex        = '610';
    snap.style.willChange    = 'transform, opacity';
    snap.style.pointerEvents = 'none';
    animOverlay.appendChild(snap);

    const duration  = 480;
    const startTime = performance.now();

    function arcFrame(now) {
      const t        = Math.min(now - startTime, duration);
      const progress = t / duration;
      const ease     = progress < 0.5
        ? 2 * progress * progress
        : -1 + (4 - 2 * progress) * progress;

      const dx   = targetL - startL;
      const arcH = toSelf ? -65 : 65;
      const x    = dx * ease;
      const y    = (targetT - startT) * ease + Math.sin(progress * Math.PI) * arcH;
      const sc   = 1 - 0.2 * ease;
      const op   = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1;

      snap.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${sc.toFixed(3)})`;
      snap.style.opacity   = op.toFixed(3);

      if (t < duration) {
        requestAnimationFrame(arcFrame);
      } else {
        if (snap.parentNode) snap.parentNode.removeChild(snap);
      }
    }

    requestAnimationFrame(arcFrame);
  }

  // ── Feature 5: Discard Pile Stack effect ──
  // Managed by Renderer.drawPiles — we track discardStack with rotations/offsets
  const discardStack = []; // Array of { rot, ox, oy }
  function addDiscardEntry() {
    discardStack.push({
      rot: (Math.random() * 8 - 4),   // -4 to +4 degrees
      ox:  (Math.random() * 4 - 2),   // -2 to +2 px
      oy:  (Math.random() * 4 - 2),
    });
    if (discardStack.length > 8) discardStack.shift();
  }

  // ── Feature 6: Better UNO animation ──
  function triggerUnoAnim() {
    showDomAnim('anim-uno-burst', 'UNO!', 600);
  }

  // ── Feature 7: Reverse animation ──
  function triggerReverseAnim() {
    showDomAnim('anim-reverse-spin', '↻', 1000);
    showDomAnim('anim-reverse-label', 'REVERSE', 1000);
  }

  // ── Feature 8: Color change effect ──
  function triggerColorChangeAnim(color) {
    // Expanding colored ring from discard pile
    const el = document.createElement('div');
    el.className = 'anim-el anim-color-ring';
    const colorMap = { red: '#E53935', blue: '#1E88E5', green: '#43A047', yellow: '#FDD835' };
    el.style.setProperty('--ring-color', colorMap[color] || '#fff');
    if (animOverlay) animOverlay.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 700);

    // Table flash
    showDomAnim('anim-color-flash anim-color-flash--' + (color || 'wild'), '', 600);
  }

  // ── Feature 9: Winner confetti via DOM ──
  function triggerWinnerConfetti() {
    if (!animOverlay) return;
    const colors = ['#E53935', '#FDD835', '#43A047', '#1E88E5', '#AB47BC', '#FF9800', '#fff'];
    for (let i = 0; i < 80; i++) {
      setTimeout(() => {
        const bit = document.createElement('div');
        bit.className = 'anim-el anim-confetti-bit';
        bit.style.left    = Math.random() * 100 + 'vw';
        bit.style.top     = '-10px';
        bit.style.background = colors[Math.floor(Math.random() * colors.length)];
        bit.style.width   = (6 + Math.random() * 8) + 'px';
        bit.style.height  = (4 + Math.random() * 6) + 'px';
        bit.style.transform = `rotate(${Math.random() * 360}deg)`;
        bit.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        const dur   = 1200 + Math.random() * 1000;
        const endX  = (Math.random() * 200 - 100);
        const delay = Math.random() * 400;
        bit.style.animation = `confettiFall ${dur}ms ${delay}ms cubic-bezier(0.25,0.46,0.45,0.94) forwards`;
        bit.style.setProperty('--cx', endX + 'px');
        if (animOverlay) animOverlay.appendChild(bit);
        setTimeout(() => { if (bit.parentNode) bit.parentNode.removeChild(bit); }, dur + delay + 200);
      }, i * 25);
    }
  }

  function triggerAnimation(type, data) {
    if (type === 'card_played') {
      showDomAnim('anim-card-played', '', 500);
    }
    if (type === 'skip') {
      showDomAnim('anim-skip', '⊘', 1000);
    }
    if (type === 'reverse') {
      triggerReverseAnim();
    }
    if (type === 'draw_flash') {
      showDomAnim('anim-red-flash', '', 600);
    }
    if (type === 'uno') {
      triggerUnoAnim();
    }
    if (type === 'color_change') {
      const col = (data && data.color) || null;
      triggerColorChangeAnim(col);
    }
    // fly_card: directional single-card fly from deck
    if (type === 'fly_card') {
      const idx    = (data && data.index)  !== undefined ? data.index  : 0;
      const total  = (data && data.total)  !== undefined ? data.total  : 1;
      const toSelf = (data && data.toSelf) !== undefined ? data.toSelf : true;
      flyCardFromDeck(idx, total, toSelf);
    }
    // deal: initial 7-card deal animation — hides hand canvas until all cards land
    if (type === 'deal') {
      const count  = (data && data.count) || 7;
      const lastCardLands = (count - 1) * 180 + 520; // stagger + flight
      _dealAnimating = true;
      for (let i = 0; i < count; i++) {
        setTimeout(() => flyCardFromDeck(i, count, true), i * 180);
      }
      // After the last card lands, reveal the real hand
      setTimeout(() => { _dealAnimating = false; }, lastCardLands);
    }
    if (type === 'winner') {
      triggerWinnerConfetti();
    }
    if (type === 'discard_land') {
      addDiscardEntry();
    }
  }

  return {
    init, destroy, state, setPlayers, setHand, updateGameState,
    setWinner, resetGame, triggerAnimation, resizeCanvas, discardStack, showDomAnim,
    onPlayCard: null, onDrawCard: null, onPassTurn: null, onCallUno: null,
    onCatchUno: null, onRestartGame: null, onShowToast: null,
  };
})();
