const Game = (() => {
  let canvas, ctx, animFrameId = null, resizeTimeout = null;

  // ── Action in-flight guard ──────────────────────────────────────────────────
  // Prevents rapid taps on mobile (slow network) from firing duplicate actions.
  // Set to true when any game action is sent; cleared when server confirms via
  // game_state or a short safety timeout elapses.
  let _actionInFlight = false;
  let _actionTimeout  = null;

  function lockAction() {
    _actionInFlight = true;
    clearTimeout(_actionTimeout);
    // Safety valve: auto-unlock after 3s in case server never responds
    _actionTimeout = setTimeout(() => { _actionInFlight = false; }, 3000);
  }

  function unlockAction() {
    _actionInFlight = false;
    clearTimeout(_actionTimeout);
  }

  // ── UNO call guard ─────────────────────────────────────────────────────────
  // Separate from _actionInFlight: calling UNO doesn't block draws/plays,
  // but we still can't let it fire multiple times per hand.
  let _unoCalled = false;  // true once the player has tapped "UNO" this hand

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
    turnTimer: null,          // { playerId, startTime, durationMs }
    settings: {},             // room house rules (stacking, jumpIn, sevenZero, drawToMatch)
  };

  let _flyingCardId    = null;  // card hidden from canvas while it flies
  let _prevDiscardTop  = null;  // shown on the pile while our played card is in flight

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
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, duration + 200);
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
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;

    // Fill the full viewport — renderer scales content to fit inside
    canvas.width  = Math.round(vpW * devicePixelRatio);
    canvas.height = Math.round(vpH * devicePixelRatio);
    canvas.style.width  = vpW + 'px';
    canvas.style.height = vpH + 'px';
    canvas.style.left   = '0px';
    canvas.style.top    = '0px';
    canvas.style.position = 'absolute';

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
    const oppData = state.players.map(p => ({ id: p.id, nickname: p.nickname, cardCount: p.cardCount, picture: p.picture }));
    Renderer.drawOpponents(ctx, oppData, state.myId, state.currentPlayer, state.direction, W, H);

    // Direction
    Renderer.drawDirectionArrow(ctx, state.direction, W, H);

    // Piles — while our played card is still flying, keep drawing the card it
    // is landing ON, so the new top doesn't pop in before the flight arrives
    let discardToDraw = state.discardTop;
    if (_flyingCardId && state.discardTop && state.discardTop.id === _flyingCardId) {
      discardToDraw = _prevDiscardTop;
    }
    hitRegions.pileRects = Renderer.drawPiles(ctx, discardToDraw, state.activeColor, state.drawPileCount, W, H);

    // Turn indicator (pulses in the active-turn color)
    const isMyTurn = state.currentPlayer === state.myId;
    Renderer.drawTurnIndicator(ctx, isMyTurn, W, H, state.activeColor);

    // Buttons
    hitRegions.buttonRects = Renderer.drawActionButtons(ctx, {
      isMyTurn, pendingDraw: state.pendingDraw, unoHighlight: state.unoHighlight,
      activeColor: state.activeColor, hasDrawnThisTurn: state.hasDrawnThisTurn,
      isSpectator: Game.isSpectator, isGodMode: Game.isGodMode,
      spectatingPlayerName: state.spectatingPlayerName, players: state.players
    }, W, H);

    // Hand — skip the card currently in-flight; playable cards breathe
    const playableFlags = (isMyTurn && !state.showColorPicker && !Game.isSpectator)
      ? state.myHand.map(clientIsPlayable)
      : null;
    const hr = Renderer.drawPlayerHand(ctx, state.myHand, -1, state.scrollOffset, W, H, _flyingCardId, playableFlags);
    hitRegions.cardRects = hr.cardRects || [];
    _prevCardPositions = {};
    hr.cardRects.forEach(r => { _prevCardPositions[r.cardId] = { x: r.x, y: r.y, w: r.w, h: r.h }; });

    // Color picker overlay
    if (state.showColorPicker) {
      hitRegions.colorRects = Renderer.drawColorPicker(ctx, W, H);
    }

    // Turn countdown timer (drawn last so it's on top)
    if (!state.winner) {
      Renderer.drawTurnTimer(ctx, state.turnTimer, state.myId, W, H);
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
          if (!_actionInFlight) {
            lockAction();
            Game.onPlayCard?.(state.pendingWildCardId, cr.color);
          }
          state.pendingWildCardId = null; state.selectedCardIndex = -1;
          return;
        }
      }
      state.showColorPicker = false; state.pendingWildCardId = null; return;
    }

    // Win screen
    if (state.winner && hit(x, y, hitRegions.winRects?.playAgain) && !Game.isSpectator) { Game.onRestartGame?.(); return; }

    // God mode controls
    if (Game.isGodMode && hitRegions.buttonRects) {
       if (hit(x, y, hitRegions.buttonRects.godLeft)) {
           const idx = state.players.findIndex(p => p.id === Game.spectatingPlayerId);
           if (idx !== -1 && state.players.length > 0) {
               const prevIdx = (idx - 1 + state.players.length) % state.players.length;
               Game.spectatingPlayerId = state.players[prevIdx].id;
               updateGameState(state);
               return;
           }
       }
       if (hit(x, y, hitRegions.buttonRects.godRight)) {
           const idx = state.players.findIndex(p => p.id === Game.spectatingPlayerId);
           if (idx !== -1 && state.players.length > 0) {
               const nextIdx = (idx + 1) % state.players.length;
               Game.spectatingPlayerId = state.players[nextIdx].id;
               updateGameState(state);
               return;
           }
       }
    }

    if (Game.isSpectator) return; // Spectators cannot interact with the game itself

    // UNO button
    if (hit(x, y, hitRegions.buttonRects?.uno)) {
      state.unoClickTime = Date.now();

      // ── Call UNO (self): player just got to 1 card ──
      // Guard with _unoCalled so fast taps only emit once.
      // unoState may not have arrived yet (network lag), so we check hand length.
      if (state.myHand.length === 1 && !_unoCalled) {
        const myUno = state.unoState[state.myId];
        if (!myUno || !myUno.called) {
          _unoCalled = true; // optimistic lock — cleared by server confirmation
          Game.onCallUno?.();
          return;
        }
      }

      // ── Catch UNO (another player): debounced via _actionInFlight ──
      if (!_actionInFlight) {
        for (const [pid, u] of Object.entries(state.unoState)) {
          if (pid !== state.myId && !u.called) { lockAction(); Game.onCatchUno?.(pid); break; }
        }
      }
      return;
    }

    // Clicking the draw pile itself → always draw (never pass)
    // Animation is handled by the server's player_drew event — do NOT call
    // flyCardFromDeck here or you'll get a duplicate animation.
    if (hit(x, y, hitRegions.pileRects?.draw)) {
      if (state.currentPlayer === state.myId && !state.hasDrawnThisTurn && state.pendingDraw === 0 && !_actionInFlight) {
        state.hasDrawnThisTurn = true; // optimistic lock — prevents second tap before server responds
        lockAction();
        Game.onDrawCard?.();
      }
      return;
    }

    // Clicking the diamond pass/draw button
    if (hit(x, y, hitRegions.buttonRects?.draw)) {
      if (state.currentPlayer === state.myId && !_actionInFlight) {
        if (state.hasDrawnThisTurn) {
          // Already drew — pass turn
          lockAction();
          Game.onPassTurn?.();
        } else if (state.pendingDraw > 0) {
          // Forced draw from +2/+4/+8 — must draw
          state.hasDrawnThisTurn = true; // optimistic lock
          lockAction();
          Game.onDrawCard?.();
        } else {
          // Normal draw — draw one card first, then player can pass
          state.hasDrawnThisTurn = true; // optimistic lock
          lockAction();
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
    // Motion trail in the card's color while it travels to the discard core
    const trailColor = (card && typeof CardColors !== 'undefined' && CardColors[card.color])
      ? CardColors[card.color].fill
      : 'rgba(232,235,243,0.8)';
    flyEl.style.boxShadow = `0 0 22px ${trailColor}, 0 0 44px 6px ${trailColor}55`;
    animOverlay.appendChild(flyEl);

    // Land on the exact discard pile position the renderer draws
    const W = canvas.width, H = canvas.height;
    const discard = Renderer.getDiscardPosition(W, H);
    const targetCX = canvasRect.left + discard.cx * scaleX;
    const targetCY = canvasRect.top  + discard.cy * scaleY;
    const endX     = targetCX - screenW / 2;
    const endY     = targetCY - screenH / 2;

    const randomAngle = (Math.random() * 14 - 7);
    const TOTAL_MS  = 700; // total flight time
    const LIFT_MS   = 140; // phase 1: lift
    const TRAVEL_MS = 460; // phase 2: arc travel
    const SETTLE_MS = 100; // phase 3: settle

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
            // Ripple now that the card has physically landed on the pile
            // (only if the server confirmed it as the new discard top)
            if (card && state.discardTop && state.discardTop.id === card.id) {
              showDomAnim('anim-card-played', '', 900);
            }
            _flyingCardId = null; // canvas draws it again (now as discardTop)
            flyEl.style.opacity = '0';
            setTimeout(() => { if (flyEl.parentNode) flyEl.parentNode.removeChild(flyEl); }, 130);
          }, SETTLE_MS + 20);
        }
      }
      requestAnimationFrame(arcFrame);
    }, LIFT_MS);
  }

  // Client-side playability check (mirrors server isPlayable in gameLogic.js)
  function clientIsPlayable(card) {
    if (state.pendingDraw > 0) {
      // Stacking rules enforced server-side; client just blocks obviously wrong cards
      // Allow wild cards and matching draw type to pass through
      return card.color === 'wild' || card.type === state.pendingDrawType;
    }
    if (card.color === 'wild') return true;
    if (card.color === state.activeColor) return true;
    const top = state.discardTop;
    if (!top) return true;
    if (card.type === 'number' && top.type === 'number' && card.value === top.value) return true;
    if (card.type !== 'number' && card.type === top.type) return true;
    return false;
  }

  // Jump-in rule: only an EXACT copy of the top card (mirrors server isExactMatch)
  function clientIsExactMatch(card) {
    const top = state.discardTop;
    if (!top || card.color === 'wild' || top.color === 'wild') return false;
    if (card.color !== top.color) return false;
    if (card.type === 'number') return top.type === 'number' && card.value === top.value;
    return card.type === top.type;
  }

  function tryPlayCard(idx) {
    const card = state.myHand[idx]; if (!card) return;
    const rules = state.settings || {};

    if (state.currentPlayer !== state.myId) {
      // Jump-in: identical card may be slammed out of turn
      const canJumpIn = rules.jumpIn && state.pendingDraw === 0 && clientIsExactMatch(card);
      if (!canJumpIn) { Game.onShowToast?.('Not your turn', true); return; }
    }
    if (_actionInFlight) return; // debounce: discard rapid duplicate taps

    // Client-side validation — skip animation and show toast for invalid cards
    if (!clientIsPlayable(card)) {
      Game.onShowToast?.('Cannot play that card', true);
      return;
    }

    if (card.type === 'wild' || card.type === 'wild4' || card.type === 'wild8') {
      state.showColorPicker = true; state.pendingWildCardId = card.id; return;
    }

    // Seven-Zero: playing a 7 (not as the winning card) needs a swap target —
    // hand off to the DOM picker; playSevenWithSwap finishes the play.
    if (rules.sevenZero && card.type === 'number' && card.value === 7 && state.myHand.length > 1) {
      Game.onSevenSwap?.(card.id);
      return;
    }

    // Snapshot + fly the real card — must happen BEFORE hand state changes
    const cr = hitRegions.cardRects.find(r => r.index === idx);
    if (cr) flyCardToDiscard(cr, card);
    lockAction();
    Game.onPlayCard?.(card.id, null);
  }

  // Called by the seven-swap modal once a target is chosen
  function playSevenWithSwap(cardId, swapTargetId) {
    const idx = state.myHand.findIndex(c => c.id === cardId);
    if (idx === -1 || _actionInFlight) return;
    const card = state.myHand[idx];
    const cr = hitRegions.cardRects.find(r => r.cardId === cardId);
    if (cr) flyCardToDiscard(cr, card);
    lockAction();
    Game.onPlayCard?.(cardId, null, swapTargetId);
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
        ghost.style.transition = 'transform 150ms ease-out, opacity 150ms ease-out';
        ghost.style.transform  = 'translate(0, 0)';
        ghost.style.opacity    = '0';
      }));

      setTimeout(() => { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); }, 280);
    }
  }

  function updateGameState(gs) {
    const discardChanged = gs.discardTop?.id !== state.discardTop?.id;
    const playerChanged  = gs.currentPlayer !== state.currentPlayer;
    if (discardChanged) _prevDiscardTop = state.discardTop; // pile shows this while our card flies
    state.discardTop = gs.discardTop; state.activeColor = gs.activeColor;
    state.currentPlayer = gs.currentPlayer; state.direction = gs.direction;
    state.drawPileCount = gs.drawPileCount;
    state.pendingDraw = gs.pendingDraw || 0;
    state.pendingDrawType = gs.pendingDrawType || null;
    state.unoState = gs.unoState || {};
    // When the turn moves on, the new player hasn't drawn yet
    if (playerChanged) {
      state.hasDrawnThisTurn = false;
      _unoCalled = false; // new turn — reset UNO call guard
    }
    // If server confirms our UNO was registered, also clear the guard
    const myUnoEntry = (gs.unoState || {})[state.myId];
    if (myUnoEntry && myUnoEntry.called) _unoCalled = false;
    // Server confirmed state — safe to unlock the action guard
    unlockAction();
    if (gs.cardCounts) for (const p of state.players) {
      if (gs.cardCounts[p.id] !== undefined) p.cardCount = gs.cardCounts[p.id];
    }
    
    state.isSpectator = Game.isSpectator;
    state.isGodMode = Game.isGodMode;
    if (Game.isGodMode && Game.godHands && Game.spectatingPlayerId) {
        state.myHand = Game.godHands[Game.spectatingPlayerId] || [];
        state.myId = Game.spectatingPlayerId; // spoof myId so the hand is drawn
        const p = state.players.find(pl => pl.id === Game.spectatingPlayerId);
        state.spectatingPlayerName = p ? p.nickname : 'Unknown';
    } else if (Game.isSpectator && !Game.isGodMode) {
        state.myHand = [];
    }

    if (discardChanged) {
      // Our own play: the ripple fires when the flight lands, not on server-confirm
      const isOurFlight = _flyingCardId && gs.discardTop && gs.discardTop.id === _flyingCardId;
      if (!isOurFlight) showDomAnim('anim-card-played', '', 900);
    }
  }

  function setWinner(id, name) { state.winner = id; state.winnerName = name; }
  function resetGame() {
    Object.assign(state, {
      winner: null, winnerName: null, myHand: [], selectedCardIndex: -1,
      scrollOffset: 0, showColorPicker: false, pendingDraw: 0, unoState: {},
      hasDrawnThisTurn: false,
    });
    _prevCardPositions = {};
    unlockAction();  // clear any stale lock from the previous round
    _unoCalled = false; // clear UNO call guard for next game
    if (animOverlay) animOverlay.innerHTML = '';
  }

  // ── Unified card flight: deck → any player ───────────────────────────────────
  // Uses Renderer layout helpers for pixel-perfect source/target positions.
  // opts: { toSelf, targetPlayerId, onLand }
  //   toSelf        — true = fly to local hand, false = fly to opponent
  //   targetPlayerId — required when !toSelf, used to find the exact opponent slot
  //   onLand        — callback fired the instant the card reaches its destination
  function flyCardToPlayer(opts = {}) {
    if (!animOverlay || !canvas) { opts.onLand?.(); return; }
    const { toSelf = true, targetPlayerId = null, onLand = null } = opts;

    const W = canvas.width, H = canvas.height;
    const cRect  = canvas.getBoundingClientRect();
    const scaleX = cRect.width  / W;
    const scaleY = cRect.height / H;

    // ── Source: exact deck center ──
    const deck = Renderer.getDeckPosition(W, H);
    const startL = cRect.left + (deck.cx - deck.w / 2) * scaleX;
    const startT = cRect.top  + (deck.cy - deck.h / 2) * scaleY;
    const screenW = deck.w * scaleX;
    const screenH = deck.h * scaleY;

    // ── Target: exact player position ──
    let targetCX, targetCY, targetRot;
    let oppSlot = null;
    if (toSelf) {
      const hand = Renderer.getHandTarget(W, H);
      targetCX = cRect.left + hand.cx * scaleX;
      targetCY = cRect.top  + hand.cy * scaleY;
      targetRot = 0;
    } else {
      // Find opponent slot
      const oppPositions = Renderer.getOpponentPositions(state.players, state.myId, W, H);
      const slot = oppPositions.find(o => o.id === targetPlayerId);
      oppSlot = slot || null;
      if (slot) {
        targetCX  = cRect.left + slot.cx * scaleX;
        targetCY  = cRect.top  + slot.cy * scaleY;
        targetRot = slot.rotation;
      } else {
        // Fallback: top center
        targetCX = cRect.left + cRect.width * 0.5;
        targetCY = cRect.top  + cRect.height * 0.1;
        targetRot = 180;
      }
    }
    const targetL = targetCX - screenW / 2;
    const targetT = targetCY - screenH / 2;

    // ── Render card-back onto offscreen canvas ──
    const snap = document.createElement('canvas');
    snap.width  = Math.round(deck.w);
    snap.height = Math.round(deck.h);
    Renderer.drawCard(snap.getContext('2d'), null, 0, 0, snap.width, snap.height, { faceUp: false });

    snap.className = 'anim-el';
    snap.style.cssText = `position:absolute;left:${startL}px;top:${startT}px;` +
      `width:${screenW}px;height:${screenH}px;` +
      `border-radius:${snap.width * 0.12 * scaleX}px;` +
      `transform:translate(0,0) scale(0.95) rotate(0deg);opacity:1;z-index:900;` +
      `will-change:transform;pointer-events:none;`;
    animOverlay.appendChild(snap);

    // ── Animation: 250ms easeOutCubic, no fade, subtle arc, smooth rotation ──
    const FLIGHT_MS = 250;
    const startTime = performance.now();
    const dx = targetL - startL;
    const dy = targetT - startT;
    // Subtle arc: 25px upward
    const arcH = toSelf ? -25 : -25;
    // Target scale: full size for self, actual seat card size for opponents
    const targetScale = toSelf ? 1.0 : (oppSlot ? oppSlot.w / deck.w : 0.4);

    function frame(now) {
      const t = Math.min(now - startTime, FLIGHT_MS);
      const p = t / FLIGHT_MS;
      // easeOutCubic
      const ease = 1 - Math.pow(1 - p, 3);

      const x   = dx * ease;
      const y   = dy * ease + Math.sin(p * Math.PI) * arcH;
      const sc  = 0.95 + (targetScale - 0.95) * ease;  // 0.95 → targetScale
      const rot = targetRot * ease;     // 0° → target orientation

      snap.style.transform =
        `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) scale(${sc.toFixed(3)}) rotate(${rot.toFixed(1)}deg)`;

      if (t < FLIGHT_MS) {
        requestAnimationFrame(frame);
      } else {
        // Card has landed — fire onLand immediately (deal chain timing depends
        // on it), then leave the element briefly for a holo-sheen land flash.
        onLand?.();
        snap.classList.add('holo-land');
        setTimeout(() => { if (snap.parentNode) snap.parentNode.removeChild(snap); }, 200);
      }
    }
    requestAnimationFrame(frame);
  }

  // ── Quick Emote: speech bubble anchored to the sender's seat ────────────────
  // Uses the same Renderer layout helpers as flyCardToPlayer so the bubble
  // appears exactly above the drawn seat (or above your own hand).
  function showEmoteBubble(playerId, emote) {
    if (!animOverlay || !canvas) return;
    const W = canvas.width, H = canvas.height;
    const cRect  = canvas.getBoundingClientRect();
    const scaleX = cRect.width  / W;
    const scaleY = cRect.height / H;

    let cx, cy, below = false;
    if (playerId === state.myId) {
      const hand = Renderer.getHandTarget(W, H);
      cx = hand.cx;
      cy = hand.cy - H * 0.10; // sit clear of the hand fan
    } else {
      const slot = Renderer.getOpponentPositions(state.players, state.myId, W, H)
        .find(o => o.id === playerId);
      if (slot) {
        cx = slot.cx; cy = slot.cy;
        // Top-row seats hug the top edge — a bubble drawn above them clips off
        // screen, so drop it below the seat instead.
        below = slot.side === 'top';
      } else {
        cx = W * 0.5; cy = H * 0.12; below = true; // spectator sender — top center
      }
    }

    const el = document.createElement('div');
    el.className = 'anim-el emote-bubble' + (below ? ' emote-bubble--below' : '');
    el.textContent = emote;
    const screenX = cRect.left + cx * scaleX;
    el.style.top  = (cRect.top + cy * scaleY) + 'px';
    animOverlay.appendChild(el);

    // Clamp horizontally so seats near the left/right edge don't overflow the
    // viewport. offsetWidth forces layout, so the width is known synchronously.
    const half = el.offsetWidth / 2;
    const minX = cRect.left + half + 4;
    const maxX = cRect.left + cRect.width - half - 4;
    el.style.left = Math.max(minX, Math.min(maxX, screenX)) + 'px';

    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 2600);
  }

  // Animate a card-back flying FROM an opponent's seat TO the discard pile.
  // playerId locates the exact seat via getOpponentPositions; side is only a
  // fallback for the rare case the player isn't in the layout (just left, etc.)
  function flyCardFromOpponentToDiscard(side, playerId) {
    if (!animOverlay || !canvas) return;

    const cRect  = canvas.getBoundingClientRect();
    const scaleX = cRect.width  / canvas.width;
    const scaleY = cRect.height / canvas.height;
    const W = canvas.width, H = canvas.height;

    // Target: the exact discard pile the renderer draws — the flying element is
    // pile-card-sized and lands scale 1, so it matches the discardTop underneath
    const discard = Renderer.getDiscardPosition(W, H);
    const screenW = discard.w * scaleX;
    const screenH = discard.h * scaleY;
    const tgtCX = cRect.left + discard.cx * scaleX;
    const tgtCY = cRect.top  + discard.cy * scaleY;

    // Source: the player's exact seat
    let srcCX = null, srcCY = null;
    const slot = Renderer.getOpponentPositions(state.players, state.myId, W, H)
      .find(o => o.id === playerId);
    if (slot) {
      srcCX = cRect.left + slot.cx * scaleX;
      srcCY = cRect.top  + slot.cy * scaleY;
    } else if (side === 'left') {
      srcCX = cRect.left + cRect.width * 0.08;
      srcCY = cRect.top  + cRect.height * 0.45;
    } else if (side === 'right') {
      srcCX = cRect.left + cRect.width * 0.92;
      srcCY = cRect.top  + cRect.height * 0.45;
    } else {
      // top
      srcCX = cRect.left + cRect.width * 0.50;
      srcCY = cRect.top  + cRect.height * 0.10;
    }

    // Start at the seat's actual card size, grow to pile size
    const START_SCALE = slot ? slot.w / discard.w : 0.45;
    const startL = srcCX - screenW / 2;
    const startT = srcCY - screenH / 2;
    const endL   = tgtCX - screenW / 2;
    const endT   = tgtCY - screenH / 2;

    // Draw a card-back onto an offscreen canvas
    const snap = document.createElement('canvas');
    snap.width  = Math.round(discard.w);
    snap.height = Math.round(discard.h);
    Renderer.drawCard(snap.getContext('2d'), null, 0, 0, snap.width, snap.height, { faceUp: false });

    snap.className = 'anim-el';
    snap.style.cssText = `position:absolute;left:${startL}px;top:${startT}px;` +
      `width:${screenW}px;height:${screenH}px;` +
      `border-radius:${snap.width * 0.12 * scaleX}px;` +
      `transform:translate(0,0) scale(${START_SCALE});opacity:1;z-index:615;` +
      `will-change:transform,opacity;pointer-events:none;`;
    animOverlay.appendChild(snap);

    const duration  = 750;
    const startTime = performance.now();
    const randomAngle = (Math.random() * 10 - 5);

    function arcFrame(now) {
      const t    = Math.min(now - startTime, duration);
      const p    = t / duration;
      const ease = p < 0.5 ? 2*p*p : -1+(4-2*p)*p;
      const arcY = Math.sin(p * Math.PI) * -80;
      const x    = (endL - startL) * ease;
      const y    = (endT - startT) * ease + arcY;
      const sc   = START_SCALE + (1 - START_SCALE) * ease;
      // Fade only at the very end, once the card has landed on the pile
      const op   = p > 0.85 ? 1 - (p - 0.85) / 0.15 : 1;
      snap.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${(randomAngle*ease).toFixed(1)}deg) scale(${sc.toFixed(3)})`;
      snap.style.opacity   = op.toFixed(3);
      if (t < duration) {
        requestAnimationFrame(arcFrame);
      } else {
        if (snap.parentNode) snap.parentNode.removeChild(snap);
      }
    }
    requestAnimationFrame(arcFrame);
  }

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
    showDomAnim('anim-uno-burst', 'UNO!', 1400);
  }

  // ── Feature 7: Reverse animation ──
  function triggerReverseAnim() {
    showDomAnim('anim-reverse-spin', '↻', 1800);
    showDomAnim('anim-reverse-label', 'REVERSE', 1800);
  }

  // ── Feature 8: Color change effect ──
  function triggerColorChangeAnim(color) {
    // Expanding colored ring from discard pile
    const el = document.createElement('div');
    el.className = 'anim-el anim-color-ring';
    const colorMap = { red: '#E53935', blue: '#1E88E5', green: '#43A047', yellow: '#FDD835' };
    el.style.setProperty('--ring-color', colorMap[color] || '#fff');
    if (animOverlay) animOverlay.appendChild(el);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 1400);

    // Table flash
    showDomAnim('anim-color-flash anim-color-flash--' + (color || 'wild'), '', 1200);
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
      showDomAnim('anim-card-played', '', 900);
    }
    if (type === 'skip') {
      showDomAnim('anim-skip', '⊘', 1800);
    }
    if (type === 'reverse') {
      triggerReverseAnim();
    }
    if (type === 'draw_flash') {
      showDomAnim('anim-red-flash', '', 1000);
    }
    if (type === 'uno') {
      triggerUnoAnim();
    }
    if (type === 'color_change') {
      const col = (data && data.color) || null;
      triggerColorChangeAnim(col);
    }
    // fly_card: card fly from deck using new unified system
    if (type === 'fly_card') {
      const toSelf          = data?.toSelf !== undefined ? data.toSelf : true;
      const targetPlayerId  = data?.targetPlayerId || null;
      const onLand          = data?.onLand || null;
      flyCardToPlayer({ toSelf, targetPlayerId, onLand });
    }
    // fly_opponent_card: opponent played a card — animate it to the discard pile
    if (type === 'fly_opponent_card') {
      const side = (data && data.side) || 'top';
      flyCardFromOpponentToDiscard(side, data && data.playerId);
    }
    if (type === 'winner') {
      triggerWinnerConfetti();
    }
    if (type === 'discard_land') {
      addDiscardEntry();
    }
  }

  function setTurnTimer(playerId, durationMs) {
    // ALWAYS reset startTime to fix stuck timer bug
    state.turnTimer = { playerId, startTime: Date.now(), durationMs };
  }

  return {
    init, destroy, state, setPlayers, setHand, updateGameState,
    setWinner, resetGame, triggerAnimation, resizeCanvas, discardStack, showDomAnim,
    setTurnTimer, flyCardToPlayer, showEmoteBubble, playSevenWithSwap,
    onPlayCard: null, onDrawCard: null, onPassTurn: null, onCallUno: null,
    onCatchUno: null, onRestartGame: null, onShowToast: null, onSevenSwap: null,
  };
})();
