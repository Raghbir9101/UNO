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
  };

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
    console.log('[ANIM] DOM element added:', className, 'overlay children:', animOverlay.children.length);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, duration + 100);
  }

  function init(canvasEl, playerId, hostId) {
    canvas = canvasEl; ctx = canvas.getContext('2d');
    state.myId = playerId; state.hostId = hostId; state.active = true;
    resizeCanvas();
    // Init overlay reference
    animOverlay = document.getElementById('anim-overlay');
    console.log('[ANIM] Overlay element:', animOverlay);
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

    // Hand
    const hr = Renderer.drawPlayerHand(ctx, state.myHand, -1, state.scrollOffset, W, H);
    hitRegions.cardRects = hr.cardRects || [];

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

    // Draw/Pass
    if (hit(x, y, hitRegions.buttonRects?.draw) || hit(x, y, hitRegions.pileRects?.draw)) {
      if (state.currentPlayer === state.myId) {
        // Animate card draw using DOM animation
        flyCardFromDeck(0, 1, 700);
        Game.onDrawCard?.();
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

  function flyCardToDiscard(cardRect) {
    if (!animOverlay || !canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / canvas.width;
    const scaleY = canvasRect.height / canvas.height;
    const screenX = canvasRect.left + cardRect.x * scaleX;
    const screenY = canvasRect.top + cardRect.y * scaleY;
    const screenW = cardRect.w * scaleX;
    const screenH = cardRect.h * scaleY;
    const el = document.createElement('div');
    el.className = 'anim-el anim-card-fly';
    el.style.left = screenX + 'px';
    el.style.top = screenY + 'px';
    el.style.width = screenW + 'px';
    el.style.height = screenH + 'px';
    el.style.transition = 'transform 350ms cubic-bezier(0.25,0.46,0.45,0.94), opacity 350ms ease';
    el.style.opacity = '1';
    animOverlay.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const targetX = window.innerWidth * 0.5 - screenX - screenW / 2;
      const targetY = window.innerHeight * 0.33 - screenY - screenH / 2;
      el.style.transform = `translate(${targetX}px,${targetY}px) rotate(12deg) scale(0.85)`;
      el.style.opacity = '0';
    }));
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 500);
  }

  function tryPlayCard(idx) {
    const card = state.myHand[idx]; if (!card) return;
    if (state.currentPlayer !== state.myId) { Game.onShowToast?.('Not your turn', true); return; }
    if (card.type === 'wild' || card.type === 'wild4' || card.type === 'wild8') {
      state.showColorPicker = true; state.pendingWildCardId = card.id; return;
    }
    // Fly card visually from hand to discard pile before server confirms
    const cr = hitRegions.cardRects.find(r => r.index === idx);
    if (cr) flyCardToDiscard(cr);
    Game.onPlayCard?.(card.id, null);
  }

  // Public API
  function setPlayers(p) { state.players = p; }
  function setHand(c) { state.myHand = c; if (state.selectedCardIndex >= c.length) state.selectedCardIndex = -1; }

  function updateGameState(gs) {
    const discardChanged = gs.discardTop?.id !== state.discardTop?.id;
    state.discardTop = gs.discardTop; state.activeColor = gs.activeColor;
    state.currentPlayer = gs.currentPlayer; state.direction = gs.direction;
    state.drawPileCount = gs.drawPileCount;
    state.pendingDraw = gs.pendingDraw || 0;
    state.pendingDrawType = gs.pendingDrawType || null;
    state.unoState = gs.unoState || {};
    if (gs.cardCounts) for (const p of state.players) {
      if (gs.cardCounts[p.id] !== undefined) p.cardCount = gs.cardCounts[p.id];
    }
    if (discardChanged) showDomAnim('anim-card-played', '', 500);
  }

  function setWinner(id, name) { state.winner = id; state.winnerName = name; }
  function resetGame() {
    Object.assign(state, {
      winner: null, winnerName: null, myHand: [], selectedCardIndex: -1,
      scrollOffset: 0, showColorPicker: false, pendingDraw: 0, unoState: {}
    });
    if (animOverlay) animOverlay.innerHTML = '';
  }

  function flyCardFromDeck(offsetIndex, total, duration) {
    // Spawn card at deck position (center of screen) and fly it to player hand (bottom)
    if (!animOverlay) return;
    const el = document.createElement('div');
    el.className = 'anim-el anim-card-fly';
    el.textContent = '🃏';
    // Start at deck center (~35% top, random offset around 50% left)
    const startLeft = 45 + (Math.random() * 6 - 3);
    el.style.top = '33%';
    el.style.left = startLeft + '%';
    el.style.transition = `transform ${duration}ms cubic-bezier(0.25,0.46,0.45,0.94), opacity ${duration}ms ease`;
    el.style.transform = 'translate(0,0) rotate(0deg) scale(1)';
    el.style.opacity = '1';
    animOverlay.appendChild(el);
    // After paint, animate to player hand area (bottom center)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const spread = (offsetIndex - total / 2) * 20; // spread cards left/right
        el.style.transform = `translate(${spread}px, ${window.innerHeight * 0.45}px) rotate(${spread * 0.5}deg) scale(0.8)`;
        el.style.opacity = '0';
      });
    });
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, duration + 100);
  }

  function triggerAnimation(type, data) {
    if (type === 'card_played') {
      showDomAnim('anim-card-played', '', 500);
    }
    if (type === 'skip') {
      showDomAnim('anim-skip', '⊘', 1000);
    }
    if (type === 'reverse') {
      showDomAnim('anim-reverse', '⇄', 1000);
      showDomAnim('anim-reverse-label', 'REVERSE', 1000);
    }
    if (type === 'plus') {
      const text = (data && data.text) || '+2';
      const count = (data && data.count) || 2;
      showDomAnim('anim-plus', text, 1200);
      showDomAnim('anim-red-flash', '', 600);
      // Stagger cards flying from deck to player — 300ms apart
      for (let i = 0; i < count; i++) {
        setTimeout(() => flyCardFromDeck(i, count, 700), i * 300);
      }
    }
    if (type === 'draw_flash') {
      showDomAnim('anim-red-flash', '', 600);
    }
    if (type === 'uno') {
      showDomAnim('anim-uno', 'UNO!', 1500);
    }
    if (type === 'color_change') {
      showDomAnim('anim-wild', '<div class="anim-wild-dot"></div><div class="anim-wild-dot"></div><div class="anim-wild-dot"></div><div class="anim-wild-dot"></div>', 800);
      showDomAnim('anim-wild-text', 'WILD', 800);
    }
    if (type === 'multi_card_draw') {
      // Cards flying from deck — 300ms stagger
      const count = (data && data.count) || 2;
      for (let i = 0; i < count; i++) {
        setTimeout(() => flyCardFromDeck(i, count, 700), i * 300);
      }
    }
  }

  return {
    init, destroy, state, setPlayers, setHand, updateGameState,
    setWinner, resetGame, triggerAnimation, resizeCanvas,
    onPlayCard: null, onDrawCard: null, onCallUno: null,
    onCatchUno: null, onRestartGame: null, onShowToast: null,
  };
})();
