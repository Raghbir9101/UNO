const Renderer = (() => {
  const VW = 980, VH = 600;
  let s = 1;
  const font = "'Inter', sans-serif";
  const displayFont = "'Space Grotesk', 'Inter', sans-serif";
  const dataFont = "'JetBrains Mono', 'Courier New', monospace";

  // Reduced-motion: freeze sheens/pulses to a pleasant static state
  const REDUCED = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  function updateScale(c) { s = Math.min(c.width / VW, c.height / VH); }

  function vs(v) { return v * s; }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // '#rrggbb' + alpha → 'rgba(...)'
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  // 0..1 oscillator; `ms` = half-period. REDUCED freezes it mid-swing.
  function osc(ms) { return REDUCED ? 0.5 : (Math.sin(Date.now() / ms) + 1) / 2; }

  // Truncate a name ONLY if it doesn't fit in maxW pixels (ctx.font must be
  // set by the caller first). Full names show whenever there's room.
  function fitName(ctx, name, maxW) {
    if (ctx.measureText(name).width <= maxW) return name;
    let n = name;
    while (n.length > 1 && ctx.measureText(n + '…').width > maxW) n = n.slice(0, -1);
    return n + '…';
  }

  function drawBackground(ctx, W, H) {
    const t = REDUCED ? 0 : Date.now() / 1000;

    // 1. Obsidian base — a single pool of light on a black table
    const g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#0c1220');
    g.addColorStop(0.55, '#070a13');
    g.addColorStop(1, '#04060b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 2. Projection grid — fine static steel lines (the holo surface)
    ctx.save();
    ctx.globalAlpha = 0.045;
    ctx.strokeStyle = '#8b93a8';
    ctx.lineWidth = vs(1);
    const grid = vs(52);
    ctx.beginPath();
    for (let gx = (W / 2) % grid; gx < W; gx += grid) { ctx.moveTo(gx, 0); ctx.lineTo(gx, H); }
    for (let gy = (H / 2) % grid; gy < H; gy += grid) { ctx.moveTo(0, gy); ctx.lineTo(W, gy); }
    ctx.stroke();
    ctx.restore();

    // 3. Projection rings radiating from the play area
    const _TH = H * 0.26, _HH = H * 0.26;
    const _CY = _TH + (H - _TH - _HH) / 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(61,157,255,0.06)';
    ctx.lineWidth = vs(1);
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.ellipse(W / 2, _CY, vs(140) * i, vs(78) * i, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // 4. Center spotlight with a very slow breath
    ctx.save();
    const spotSize = Math.max(W, H) * 0.45;
    const spot = ctx.createRadialGradient(W / 2, _CY, 0, W / 2, _CY, spotSize);
    spot.addColorStop(0, 'rgba(61, 157, 255, 0.10)');
    spot.addColorStop(0.5, 'rgba(61, 157, 255, 0.03)');
    spot.addColorStop(1, 'transparent');
    ctx.fillStyle = spot;
    ctx.globalAlpha = 0.8 + Math.sin(t * 0.8) * 0.2;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // ── Signature element: holo-foil sheen ─────────────────────────────────────
  // A slow diagonal light band sweeping across the card face, keyed to the
  // card's color. Caller must have clipped to the card silhouette already.
  const FOIL_MS = 5200;
  function _foilSheen(ctx, x, y, w, h, phase, colorHex) {
    const p = REDUCED ? 0.38 : (((Date.now() % FOIL_MS) / FOIL_MS) + phase) % 1;
    // Sweep range must overshoot far enough that the band's diagonal
    // projection is fully off-card at p=0 and p=1 — otherwise the loop
    // wrap visibly teleports the highlight (the gradient axis is steep,
    // so the band "reaches" much further than its x offset suggests).
    const bx = x + (-2.4 + p * 4.9) * w;
    const grad = ctx.createLinearGradient(bx, y, bx + w * 0.9, y + h);
    grad.addColorStop(0.3, 'rgba(255,255,255,0)');
    grad.addColorStop(0.42, 'rgba(255,255,255,0.055)');
    grad.addColorStop(0.5, hexA(colorHex, 0.11));
    grad.addColorStop(0.58, 'rgba(255,255,255,0.045)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
  }

  function drawCard(ctx, card, x, y, w, h, opts = {}) {
    const { selected, faceUp = true, playable = false, foilPhase = 0 } = opts;
    const rd = w * 0.12;
    ctx.save();
    if (selected) y -= vs(20);

    if (!faceUp) { _cardBack(ctx, x, y, w, h); ctx.restore(); return; }

    const wild = isWildCard(card);
    const ci = wild ? CardColors.wild : (CardColors[card.color] || CardColors.wild);
    const accent = wild ? '#e8ebf3' : ci.fill;

    // Drop shadow onto the table
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = vs(8);
    ctx.shadowOffsetY = vs(3);
    rr(ctx, x, y, w, h, rd); ctx.fillStyle = '#0b0f1a'; ctx.fill();
    ctx.restore();

    // Obsidian slab body
    const body = ctx.createLinearGradient(x, y, x, y + h);
    body.addColorStop(0, '#1a2237');
    body.addColorStop(0.5, '#10162a');
    body.addColorStop(1, '#0a0e1c');
    rr(ctx, x, y, w, h, rd); ctx.fillStyle = body; ctx.fill();

    // Emissive energy core + foil sheen (clipped to the card)
    ctx.save();
    rr(ctx, x, y, w, h, rd); ctx.clip();
    if (wild) {
      // Four-corner prism glow
      const quads = [
        ['#ff3b5c', x + w * 0.22, y + h * 0.2], ['#ffd23f', x + w * 0.78, y + h * 0.2],
        ['#3d9dff', x + w * 0.22, y + h * 0.8], ['#2ee88a', x + w * 0.78, y + h * 0.8],
      ];
      for (const [qc, qx, qy] of quads) {
        const qg = ctx.createRadialGradient(qx, qy, 0, qx, qy, w * 0.6);
        qg.addColorStop(0, hexA(qc, 0.3));
        qg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = qg; ctx.fillRect(x, y, w, h);
      }
    } else {
      const core = ctx.createRadialGradient(x + w / 2, y + h * 0.48, 0, x + w / 2, y + h * 0.48, h * 0.62);
      core.addColorStop(0, hexA(ci.fill, 0.32));
      core.addColorStop(0.65, hexA(ci.fill, 0.1));
      core.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = core; ctx.fillRect(x, y, w, h);
    }
    _foilSheen(ctx, x, y, w, h, foilPhase, accent);
    ctx.restore();

    // Center symbol — the light source of the card
    const txt = getCardDisplayText(card);
    const fs = card.type === 'number' ? w * 0.52 : w * 0.4;
    ctx.fillStyle = wild ? '#fff' : ci.light;
    ctx.font = `700 ${fs}px ${displayFont}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, x + w / 2, y + h / 2);

    // Corner pips
    const cs = w * 0.2;
    ctx.font = `700 ${cs}px ${displayFont}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = wild ? 'rgba(232,235,243,0.85)' : hexA(ci.fill, 0.85);
    ctx.fillText(txt, x + w * 0.2, y + h * 0.06);
    ctx.save();
    ctx.translate(x + w * 0.8, y + h * 0.94);
    ctx.rotate(Math.PI);
    ctx.textBaseline = 'top';
    ctx.fillText(txt, 0, 0);
    ctx.restore();

    // Thin emissive border — wild gets the prism, colors get their own light
    if (wild) {
      const pg = ctx.createLinearGradient(x, y, x + w, y + h);
      pg.addColorStop(0, 'rgba(255,59,92,0.7)');
      pg.addColorStop(0.33, 'rgba(255,210,63,0.7)');
      pg.addColorStop(0.66, 'rgba(46,232,138,0.7)');
      pg.addColorStop(1, 'rgba(61,157,255,0.7)');
      rr(ctx, x, y, w, h, rd);
      ctx.strokeStyle = pg;
      ctx.lineWidth = vs(1.4);
      ctx.stroke();
    } else {
      rr(ctx, x, y, w, h, rd);
      ctx.strokeStyle = hexA(ci.fill, selected ? 0.9 : 0.4);
      ctx.lineWidth = selected ? vs(2) : vs(1.2);
      ctx.stroke();
    }

    // Breathing glow on playable cards (~2s cycle) — the "you can move" cue.
    // shadowBlur is spent here only: a handful of cards at most.
    if (playable && !selected) {
      const breathe = osc(318);
      ctx.save();
      ctx.globalAlpha = 0.3 + breathe * 0.5;
      ctx.shadowColor = accent; ctx.shadowBlur = vs(10);
      rr(ctx, x, y, w, h, rd);
      ctx.strokeStyle = accent;
      ctx.lineWidth = vs(1.6);
      ctx.stroke();
      ctx.restore();
    }

    if (selected) {
      ctx.save();
      ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = vs(16);
      rr(ctx, x - vs(2), y - vs(2), w + vs(4), h + vs(4), rd + vs(2));
      ctx.strokeStyle = 'rgba(255,210,63,0.75)'; ctx.lineWidth = vs(2); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function _cardBack(ctx, x, y, w, h) {
    const rd = w * 0.12;
    const mini = w < vs(34); // opponent minis skip the expensive touches

    ctx.save();
    if (!mini) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = vs(6); ctx.shadowOffsetY = vs(2);
    }
    rr(ctx, x, y, w, h, rd);
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, '#1a2237');
    g.addColorStop(1, '#0c1120');
    ctx.fillStyle = g; ctx.fill();
    ctx.restore();

    if (!mini) {
      // Holo etch + sheen, clipped to the card
      ctx.save(); rr(ctx, x, y, w, h, rd); ctx.clip();
      ctx.strokeStyle = 'rgba(139,147,168,0.07)'; ctx.lineWidth = vs(1);
      for (let i = -h; i < w + h; i += vs(6)) {
        ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i - h, y + h); ctx.stroke();
      }
      _foilSheen(ctx, x, y, w, h, ((x * 7 + y * 13) % 97) / 97, '#8b93a8');
      ctx.restore();
    }

    // Prism inset ring — the deck's identity mark
    const m = w * 0.1;
    const pg = ctx.createLinearGradient(x + m, y + m, x + w - m, y + h - m);
    pg.addColorStop(0, 'rgba(255,59,92,0.6)');
    pg.addColorStop(0.33, 'rgba(255,210,63,0.6)');
    pg.addColorStop(0.66, 'rgba(46,232,138,0.6)');
    pg.addColorStop(1, 'rgba(61,157,255,0.6)');
    rr(ctx, x + m, y + m, w - m * 2, h - m * 2, rd * 0.5);
    ctx.strokeStyle = pg; ctx.lineWidth = vs(mini ? 1 : 1.5); ctx.stroke();

    ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-0.25);
    ctx.fillStyle = 'rgba(232,235,243,0.9)'; ctx.font = `700 ${w * 0.26}px ${displayFont}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('UNO', 0, 0);
    ctx.restore();

    rr(ctx, x, y, w, h, rd);
    ctx.strokeStyle = 'rgba(139,147,168,0.22)'; ctx.lineWidth = vs(1); ctx.stroke();
  }

  function drawPlayerHand(ctx, cards, selIdx, scrollOff, W, H, flyingCardId, playableFlags) {
    if (!cards || !cards.length) return { cardRects: [] };
    const SIDE_W = W * 0.16;
    const HAND_H = H * 0.26;
    const handW = W - 2 * SIDE_W;
    const cw = Math.min(handW * 0.13, HAND_H * 0.82, vs(72));
    const ch = cw * 1.45;
    const maxOv = cw * 0.72;
    const ov = Math.min(maxOv, (handW - vs(24) - cw) / Math.max(cards.length - 1, 1));
    const tw = cw + (cards.length - 1) * ov;
    const sx = SIDE_W + Math.max(vs(8), (handW - tw) / 2) + scrollOff;
    const baseY = H - ch - vs(16);
    const rects = [];
    for (let i = 0; i < cards.length; i++) {
      const cx2 = sx + i * ov;
      const isFlying = flyingCardId && cards[i].id === flyingCardId;
      const opts = {
        selected: i === selIdx,
        faceUp: true,
        playable: !!(playableFlags && playableFlags[i]),
        foilPhase: (i * 0.13) % 1, // stagger the shimmer across the fan
      };
      if (isFlying) {
        ctx.save(); ctx.globalAlpha = 0.0;
        drawCard(ctx, cards[i], cx2, baseY, cw, ch, { selected: false, faceUp: true });
        ctx.restore();
      } else {
        drawCard(ctx, cards[i], cx2, baseY, cw, ch, opts);
      }
      rects.push({ x: cx2, y: baseY, w: cw, h: ch, index: i, cardId: cards[i].id });
    }
    return { cardRects: rects, handY: baseY, cardW: cw, cardH: ch };
  }

  // Draws N card-back placeholders in the hand area (used during deal animation)
  function drawHandPlaceholders(ctx, count, W, H) {
    if (count <= 0) return;
    const SIDE_W = W * 0.16;
    const HAND_H = H * 0.26;
    const handW = W - 2 * SIDE_W;
    const cw = Math.min(handW * 0.13, HAND_H * 0.82, vs(72));
    const ch = cw * 1.45;
    const maxOv = cw * 0.72;
    const ov = Math.min(maxOv, (handW - vs(24) - cw) / Math.max(count - 1, 1));
    const tw = cw + (count - 1) * ov;
    const sx = SIDE_W + Math.max(vs(8), (handW - tw) / 2);
    const baseY = H - ch - vs(16);
    for (let i = 0; i < count; i++) {
      ctx.save(); ctx.globalAlpha = 0.55;
      _cardBack(ctx, sx + i * ov, baseY, cw, ch);
      ctx.restore();
    }
  }

  // NOTE: getOpponentPositions() mirrors this function's seat geometry so fly
  // animations land on the exact drawn seats — change layout math in BOTH.
  function drawOpponents(ctx, players, myId, curPlayer, dir, W, H) {
    if (!players.length) return;

    // Rotate so opps[0] plays right after me
    const myIdx = players.findIndex(p => p.id === myId);
    let opps = [];
    if (myIdx === -1) {
        opps = [...players]; // Spectator: show everyone
    } else {
        for (let i = 1; i < players.length; i++) opps.push(players[(myIdx + i) % players.length]);
    }
    if (!opps.length) return;
    const n = opps.length;

    // ── Zone constants ────────────────────────────────────────────────────────
    const SIDE_W = W * 0.16;
    const TOP_H = H * 0.26;
    const HAND_H = H * 0.26;
    const CX = SIDE_W, CY = TOP_H;
    const CW = W - 2 * SIDE_W, CH = H - TOP_H - HAND_H;

    // ── Distribute opponents ──────────────────────────────────────────────────
    let nTop, nLeft, nRight;
    if (n === 1) { nTop = 1; nLeft = 0; nRight = 0; }
    else if (n === 2) { nTop = 2; nLeft = 0; nRight = 0; }
    else if (n === 3) { nTop = 1; nLeft = 1; nRight = 1; }
    else if (n === 4) { nTop = 2; nLeft = 1; nRight = 1; }
    else if (n === 5) { nTop = 3; nLeft = 1; nRight = 1; }
    else if (n === 6) { nTop = 2; nLeft = 2; nRight = 2; }
    else if (n <= 9) { nLeft = Math.floor(n / 3); nRight = Math.floor(n / 3); nTop = n - nLeft - nRight; }
    else if (n <= 12) { nLeft = Math.ceil(n / 3); nRight = Math.floor(n / 3); nTop = n - nLeft - nRight; }
    else { nLeft = Math.round(n / 3); nRight = Math.round(n / 3); nTop = n - nLeft - nRight; }

    const leftOps = opps.slice(0, nLeft);
    const rightOps = opps.slice(n - nRight);
    const topOps = opps.slice(nLeft, n - (nRight || 0));

    // Emissive seat colors (assigned by table position, stable per player)
    const COLORS = ['#ff3b5c', '#3d9dff', '#2ee88a', '#ffb03f', '#b06bff',
                    '#2ed3e8', '#ff5c9e', '#ff7a45', '#8f7bff', '#4fe0c2'];
    function pColor(p) { return COLORS[players.findIndex(pl => pl.id === p.id) % COLORS.length]; }

    const pulse = osc(300);
    // Active-turn ring: thin emissive gold outline around the seat's fan
    function glowBox(x, y, w, h) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,210,63,${0.5 + pulse * 0.4})`;
      ctx.lineWidth = vs(1.5); ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = vs(10);
      rr(ctx, x, y, w, h, vs(5)); ctx.stroke();
      ctx.restore();
    }
    // Card-count counter: dark glass core with an emissive ring; red at UNO
    function badge(bx, by, cc) {
      ctx.save();
      ctx.beginPath(); ctx.arc(bx, by, vs(9), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(5,7,13,0.85)'; ctx.fill();
      if (cc === 1) { ctx.shadowColor = '#ff3b5c'; ctx.shadowBlur = vs(7); }
      ctx.strokeStyle = cc === 1 ? '#ff3b5c' : 'rgba(139,147,168,0.5)';
      ctx.lineWidth = vs(1.4); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = cc === 1 ? '#ff8fa3' : '#e8ebf3';
      ctx.font = `700 ${vs(8)}px ${dataFont}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(cc, bx, by); ctx.restore();
    }
    function unoTag(x, y) {
      const p2 = osc(180);
      ctx.save();
      ctx.fillStyle = `rgba(255,59,92,${0.8 + p2 * 0.2})`;
      ctx.shadowColor = '#ff3b5c'; ctx.shadowBlur = vs(6);
      ctx.font = `700 ${vs(9)}px ${displayFont}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('UNO!', x, y); ctx.restore();
    }
    // Seat avatar: dark glass core with a thin emissive ring in the seat color
    function seatAvatar(ax, ay, r, color, isCur) {
      ctx.save();
      ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(11,15,26,0.82)'; ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = vs(1.5); ctx.stroke();
      if (isCur) {
        ctx.beginPath(); ctx.arc(ax, ay, r + vs(2), 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,210,63,${0.5 + pulse * 0.4})`;
        ctx.lineWidth = vs(1); ctx.stroke();
      }
      // color dot at the core — the "player light"
      ctx.beginPath(); ctx.arc(ax, ay, r * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.restore();
    }

    // ── TOP opponents ─────────────────────────────────────────────────────────
    // Adapt card size and count based on player density
    const maxCards = nTop >= 7 ? 3 : (nTop >= 5 ? 4 : 5);
    const tcw = Math.min(CW / (Math.max(nTop, 1) * 4.0), TOP_H * 0.25, vs(24));
    const tch = tcw * 1.45;
    const topSlotW = nTop > 0 ? CW / nTop : CW;
    const nameRowH = vs(24);

    topOps.forEach((p, i) => {
      const isCur = p.id === curPlayer;
      const cc = p.cardCount || 0;
      const ms = Math.min(cc, maxCards);
      const ov = Math.min(tcw * 0.35, (topSlotW * 0.65 - tcw) / Math.max(ms - 1, 1));
      const fanW = tcw + Math.max(ms - 1, 0) * ov;
      const slotCX = CX + topSlotW * i + topSlotW / 2;
      const fx = slotCX - fanW / 2;
      const fy = vs(6);

      if (isCur && ms > 0) glowBox(fx - vs(3), fy - vs(3), fanW + vs(6), tch + vs(6));
      for (let c = 0; c < ms; c++) _cardBack(ctx, fx + c * ov, fy, tcw, tch);
      if (ms === 0) {
        ctx.save(); ctx.globalAlpha = 0.12;
        rr(ctx, slotCX - tcw / 2, fy, tcw, tch, vs(5));
        ctx.strokeStyle = '#e8ebf3'; ctx.lineWidth = vs(1); ctx.stroke(); ctx.restore();
      }

      // Name row below cards — glass chip behind avatar + name.
      // Name only truncates if it can't fit in the slot's actual width.
      const nameRowY = fy + tch + vs(4);
      const avR = vs(7);
      const avX = slotCX;
      ctx.font = `600 ${vs(9)}px ${font}`;
      const nm = fitName(ctx, p.nickname, topSlotW / 2 - vs(12));
      const nmW = ctx.measureText(nm).width;
      const chipX = avX - avR * 2 - vs(6);
      const chipW = avR * 2 + vs(8) + nmW + vs(8);
      ctx.save();
      rr(ctx, chipX, nameRowY - vs(2), chipW, avR * 2 + vs(4), vs(9));
      ctx.fillStyle = 'rgba(11,15,26,0.6)'; ctx.fill();
      ctx.strokeStyle = isCur ? `rgba(255,210,63,${0.35 + pulse * 0.25})` : 'rgba(139,147,168,0.18)';
      ctx.lineWidth = vs(1); ctx.stroke();
      ctx.restore();

      seatAvatar(avX - avR - vs(2), nameRowY + avR, avR, pColor(p), isCur);

      ctx.fillStyle = isCur ? '#ffd23f' : '#e8ebf3';
      ctx.font = `600 ${vs(9)}px ${font}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(nm, avX + vs(2), nameRowY + avR);

      badge(fx + fanW + vs(3), fy + vs(3), cc);
      if (cc === 1) unoTag(slotCX, fy + tch + nameRowH + vs(3));
    });

    // ── SIDE helper ───────────────────────────────────────────────────────────
    const maxSideSlots = Math.max(nLeft, nRight);
    // Smaller cards when many players
    const scw = Math.min(SIDE_W * 0.42, CH / (maxSideSlots * 1.3), vs(24));
    const sch = scw * 1.45;
    // Use extreme vertical space - extend into all available margins
    const sideAvailH = CH * 1.8; // Maximum extension for spacing

    function drawSide(p, isLeft, slotIdx, nSlots) {
      const isCur = p.id === curPlayer;
      const cc = p.cardCount || 0;
      // Show minimal cards to reduce height per player slot
      const maxCards = nSlots >= 5 ? 2 : 3;
      const ms = Math.min(cc, maxCards);
      const ov = Math.min(sch * 0.25, vs(3));
      const fanH = sch + Math.max(ms - 1, 0) * ov;
      const slotH = sideAvailH / nSlots;
      const startY = CY - (sideAvailH - CH) / 2; // Center the extended range
      const cy2 = startY + slotH * slotIdx + slotH / 2;
      const fx = isLeft ? SIDE_W / 2 - scw / 2 : W - SIDE_W / 2 - scw / 2;
      const fy = cy2 - fanH / 2;

      if (isCur && ms > 0) glowBox(fx - vs(3), fy - vs(3), scw + vs(6), fanH + vs(6));

      for (let c = 0; c < ms; c++) {
        _cardBack(ctx, fx, fy + c * ov, scw, sch);
      }
      if (ms === 0) {
        ctx.save(); ctx.globalAlpha = 0.12;
        rr(ctx, fx, cy2 - sch / 2, scw, sch, vs(5));
        ctx.strokeStyle = '#e8ebf3'; ctx.lineWidth = vs(1); ctx.stroke(); ctx.restore();
      }

      // Name and avatar below cards - compact for many players
      const pileCX = fx + scw / 2;
      const nameY = fy + fanH + vs(3);
      const avR = vs(6);

      seatAvatar(pileCX, nameY + avR, avR, pColor(p), isCur);

      // Name below avatar — full width of the side column before truncating
      ctx.font = `600 ${vs(8)}px ${font}`;
      const nm = fitName(ctx, p.nickname, SIDE_W - vs(10));
      ctx.fillStyle = isCur ? '#ffd23f' : '#e8ebf3';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = vs(2);
      ctx.fillText(nm, pileCX, nameY + avR * 2 + vs(1));
      ctx.shadowBlur = 0;

      badge(isLeft ? fx + scw + vs(8) : fx - vs(8), cy2 - fanH / 2 + vs(4), cc);
      if (cc === 1) unoTag(pileCX, fy - vs(10));
    }

    // Draw left side bottom-to-top for correct clockwise flow
    leftOps.forEach((p, i) => drawSide(p, true, nLeft - 1 - i, nLeft));
    rightOps.forEach((p, i) => drawSide(p, false, i, nRight));
  }


  function drawPiles(ctx, discardTop, activeColor, drawCount, W, H) {
    const _SW = W * 0.16, _TH = H * 0.26, _HH = H * 0.26;
    const _CW = W - 2 * _SW, _CH = H - _TH - _HH;
    const _CX = _SW + _CW / 2, _CY = _TH + _CH / 2;
    const _cw = Math.min(_CW * 0.17, _CH * 0.52, vs(90));
    const _ch = _cw * 1.45;
    const _gap = Math.max(_cw * 0.15, vs(12));
    const _dx = _CX - _cw - _gap;   // deck left edge
    const _dcx = _CX + _gap;         // discard left edge
    const _dy = _CY - _ch / 2;         // card top edge

    const rects = {};

    // ── Projection core: the holographic diamond the piles sit on ──
    ctx.save();
    ctx.translate(_CX, _CY);
    ctx.rotate(Math.PI / 4);
    const bgSize = _cw * 1.8;
    ctx.fillStyle = 'rgba(19,26,43,0.35)';
    ctx.strokeStyle = 'rgba(139,147,168,0.18)';
    ctx.lineWidth = vs(1.5);
    rr(ctx, -bgSize / 2, -bgSize / 2, bgSize, bgSize, vs(16));
    ctx.fill(); ctx.stroke();
    // Inner prism trace
    const inSize = bgSize * 0.8;
    const ppg = ctx.createLinearGradient(-inSize / 2, -inSize / 2, inSize / 2, inSize / 2);
    ppg.addColorStop(0, 'rgba(255,59,92,0.12)');
    ppg.addColorStop(0.33, 'rgba(255,210,63,0.12)');
    ppg.addColorStop(0.66, 'rgba(46,232,138,0.12)');
    ppg.addColorStop(1, 'rgba(61,157,255,0.12)');
    ctx.strokeStyle = ppg;
    rr(ctx, -inSize / 2, -inSize / 2, inSize, inSize, vs(12));
    ctx.stroke();
    ctx.restore();

    const sideBtnSz = _cw * 0.45;

    // ── Special Mode (Top Left) — glass diamond, blue emissive edge ──
    const smCX = _dx - vs(15) - sideBtnSz / 2;
    const smCY = _CY - vs(30);
    ctx.save();
    ctx.translate(smCX, smCY);
    ctx.rotate(Math.PI / 4);
    ctx.shadowColor = '#3d9dff'; ctx.shadowBlur = vs(6);
    rr(ctx, -sideBtnSz / 2, -sideBtnSz / 2, sideBtnSz, sideBtnSz, vs(6));
    ctx.fillStyle = 'rgba(61,157,255,0.12)'; ctx.fill();
    ctx.strokeStyle = 'rgba(61,157,255,0.55)'; ctx.lineWidth = vs(1.5); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#cfe5ff'; ctx.font = `700 ${vs(8)}px ${displayFont}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = vs(2);
    ctx.fillText('SPECIAL', smCX, smCY - vs(5));
    ctx.fillText('MODE', smCX, smCY + vs(5));
    ctx.restore();

    // Deck (left)
    for (let i = 2; i >= 0; i--) _cardBack(ctx, _dx + i * vs(1.5), _dy - i * vs(1.5), _cw, _ch);
    rects.draw = { x: _dx, y: _dy, w: _cw, h: _ch };

    // Draw Deck Count — glass counter in the data face
    ctx.save();
    ctx.beginPath();
    ctx.arc(_dx + _cw / 2, _dy + _ch + vs(12), vs(10), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5,7,13,0.8)'; ctx.fill();
    ctx.strokeStyle = 'rgba(139,147,168,0.4)'; ctx.lineWidth = vs(1); ctx.stroke();
    ctx.fillStyle = '#e8ebf3'; ctx.font = `600 ${vs(9)}px ${dataFont}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(drawCount, _dx + _cw / 2, _dy + _ch + vs(12));
    ctx.restore();

    // Discard (right)
    if (discardTop) {
      const stack = (typeof Game !== 'undefined' && Game.discardStack) ? Game.discardStack : [];
      const depth = Math.min(stack.length, 4);
      for (let si = 0; si < depth - 1; si++) {
        const e = stack[si];
        ctx.save(); ctx.translate(_dcx + _cw / 2, _dy + _ch / 2);
        ctx.rotate((e.rot || 0) * Math.PI / 180);
        _cardBack(ctx, -_cw / 2, -_ch / 2, _cw, _ch); ctx.restore();
      }
      // Active color halo under the top discard — the table's "current light"
      if (activeColor && activeColor !== 'wild' && CardColors[activeColor]) {
        ctx.save();
        const halo = ctx.createRadialGradient(_dcx + _cw / 2, _CY, _cw * 0.2, _dcx + _cw / 2, _CY, _cw * 1.1);
        halo.addColorStop(0, hexA(CardColors[activeColor].fill, 0.22));
        halo.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = halo;
        ctx.fillRect(_dcx - _cw * 0.6, _dy - _cw * 0.4, _cw * 2.2, _ch + _cw * 0.8);
        ctx.restore();
      }
      ctx.save(); ctx.translate(_dcx + _cw / 2, _dy + _ch / 2);
      drawCard(ctx, discardTop, -_cw / 2, -_ch / 2, _cw, _ch, { faceUp: true, foilPhase: 0.5 });
      ctx.restore();
    }
    rects.discard = { x: _dcx, y: _dy, w: _cw, h: _ch };

    // Direction arrow below piles (center between them)
    const _pulse = osc(500);
    ctx.save(); ctx.globalAlpha = 0.45 + _pulse * 0.25;
    ctx.fillStyle = '#e8ebf3'; ctx.font = `400 ${vs(20)}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(dir_global === 1 ? '↻' : '↺', _CX, _dy + _ch + vs(24));
    ctx.restore();

    return rects;
  }

  // Tracked externally
  let dir_global = 1;
  function drawDirectionArrow(ctx, dir) { dir_global = dir; }

  function drawActionButtons(ctx, state, W, H) {
    const _SW = W * 0.16, _TH = H * 0.26, _HH = H * 0.26;
    const _CW = W - 2 * _SW, _CH = H - _TH - _HH;
    const _CX = _SW + _CW / 2, _CY = _TH + _CH / 2;
    const _cw = Math.min(_CW * 0.17, _CH * 0.52, vs(90));
    const _ch = _cw * 1.45;
    const _gap = Math.max(_cw * 0.15, vs(12));
    const _dx = _CX - _cw - _gap;   // deck left edge
    const _dcx = _CX + _gap;         // discard left edge
    const _dy = _CY - _ch / 2;         // card top edge

    const rects = {};
    const hasDrawn = state.hasDrawnThisTurn || false;
    const pulse3 = osc(180);

    const sideBtnSz = _cw * 0.45;

    // ── UNO Button (Bottom Left 4-color Diamond) ──────────────────────────
    const unoCX = _dx - vs(15) - sideBtnSz / 2;
    const unoCY = _CY + vs(30);

    ctx.save();
    ctx.translate(unoCX, unoCY);
    if (state.unoClickTime && Date.now() - state.unoClickTime < 200) ctx.scale(0.7, 0.7);
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    rr(ctx, -sideBtnSz / 2, -sideBtnSz / 2, sideBtnSz, sideBtnSz, vs(6));
    ctx.clip();
    const gOp = state.unoHighlight ? 0.95 : 0.35;
    ctx.fillStyle = `rgba(46, 232, 138, ${gOp})`; ctx.fillRect(-sideBtnSz / 2, -sideBtnSz / 2, sideBtnSz / 2, sideBtnSz / 2);
    ctx.fillStyle = `rgba(255, 59, 92, ${gOp})`; ctx.fillRect(0, -sideBtnSz / 2, sideBtnSz / 2, sideBtnSz / 2);
    ctx.fillStyle = `rgba(61, 157, 255, ${gOp})`; ctx.fillRect(0, 0, sideBtnSz / 2, sideBtnSz / 2);
    ctx.fillStyle = `rgba(255, 210, 63, ${gOp})`; ctx.fillRect(-sideBtnSz / 2, 0, sideBtnSz / 2, sideBtnSz / 2);
    rr(ctx, -sideBtnSz / 2, -sideBtnSz / 2, sideBtnSz, sideBtnSz, vs(6));
    ctx.strokeStyle = state.unoHighlight ? 'rgba(255,255,255,0.9)' : 'rgba(5,7,13,0.7)';
    ctx.lineWidth = vs(3); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(unoCX, unoCY);
    if (state.unoClickTime && Date.now() - state.unoClickTime < 200) ctx.scale(0.7, 0.7);
    ctx.rotate(Math.PI / 4);
    if (state.unoHighlight) {
      ctx.shadowColor = '#fff'; ctx.shadowBlur = vs(10 + pulse3 * 10);
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = vs(6);
    }
    rr(ctx, -sideBtnSz / 2, -sideBtnSz / 2, sideBtnSz, sideBtnSz, vs(6));
    ctx.strokeStyle = 'rgba(5,7,13,0.8)'; ctx.lineWidth = vs(2); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(unoCX, unoCY);
    if (state.unoClickTime && Date.now() - state.unoClickTime < 200) ctx.scale(0.7, 0.7);
    ctx.fillStyle = state.unoHighlight ? '#fff' : 'rgba(255,255,255,0.6)';
    ctx.font = `700 ${vs(14)}px ${displayFont}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = vs(3);
    ctx.fillText('UNO!', 0, 0);
    ctx.restore();

    rects.uno = { x: unoCX - sideBtnSz / 2, y: unoCY - sideBtnSz / 2, w: sideBtnSz, h: sideBtnSz };

    // ── Color indicator (Top Right) — the active light source ─────────────
    const cix = _dcx + _cw + vs(15) + sideBtnSz / 2;
    const ciy = _CY - vs(30);

    if (state.activeColor && state.activeColor !== 'wild') {
      const ci = CardColors[state.activeColor];
      ctx.save();
      ctx.translate(cix, ciy);
      ctx.rotate(Math.PI / 4);
      ctx.shadowColor = ci.fill; ctx.shadowBlur = vs(10);
      rr(ctx, -sideBtnSz / 2, -sideBtnSz / 2, sideBtnSz, sideBtnSz, vs(6));
      ctx.fillStyle = ci.fill; ctx.fill();
      const gl = ctx.createLinearGradient(-sideBtnSz / 2, -sideBtnSz / 2, sideBtnSz / 2, sideBtnSz / 2);
      gl.addColorStop(0, 'rgba(255,255,255,0.4)');
      gl.addColorStop(1, 'rgba(0,0,0,0.1)');
      ctx.fillStyle = gl; ctx.fill();
      ctx.strokeStyle = 'rgba(5,7,13,0.45)'; ctx.lineWidth = vs(2); ctx.stroke();
      ctx.restore();
    }

    // ── Pass/Draw Arrow Button (Bottom Right) ──────────────────────────
    const passCX = cix;
    const passCY = _CY + vs(30);
    ctx.save();
    ctx.translate(passCX, passCY);
    ctx.rotate(Math.PI / 4);
    const pSide = sideBtnSz;
    const pg = ctx.createLinearGradient(-pSide / 2, -pSide / 2, pSide / 2, pSide / 2);
    if (state.isMyTurn && hasDrawn && !state.isSpectator) {
      ctx.shadowColor = '#3d9dff'; ctx.shadowBlur = vs(12);
      pg.addColorStop(0, '#5fb0ff'); pg.addColorStop(1, '#1d64c4');
    } else if (state.isMyTurn && state.pendingDraw > 0 && !state.isSpectator) {
      ctx.shadowColor = '#ff3b5c'; ctx.shadowBlur = vs(12 + pulse3 * 8);
      pg.addColorStop(0, `rgba(255,59,92,${0.7 + pulse3 * 0.25})`);
      pg.addColorStop(1, `rgba(140,10,35,${0.7 + pulse3 * 0.25})`);
    } else if (state.isMyTurn && !state.isSpectator) {
      ctx.shadowColor = '#3d9dff'; ctx.shadowBlur = vs(12);
      pg.addColorStop(0, '#5fb0ff'); pg.addColorStop(1, '#1d64c4');
    } else {
      pg.addColorStop(0, 'rgba(232,235,243,0.07)');
      pg.addColorStop(1, 'rgba(232,235,243,0.03)');
    }
    ctx.fillStyle = pg;
    rr(ctx, -pSide / 2, -pSide / 2, pSide, pSide, vs(6));
    ctx.fill();
    ctx.strokeStyle = (state.isMyTurn && !state.isSpectator) ? 'rgba(5,7,13,0.4)' : 'rgba(139,147,168,0.15)';
    ctx.lineWidth = vs(2); ctx.stroke();
    ctx.restore();

    // Pass arrow text
    ctx.save();
    ctx.fillStyle = (state.isMyTurn && !state.isSpectator) ? '#fff' : 'rgba(232,235,243,0.25)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = vs(3);
    if (state.pendingDraw > 0 && state.isMyTurn && !state.isSpectator) {
      ctx.font = `700 ${vs(14)}px ${displayFont}`;
      ctx.fillText(`+${state.pendingDraw}`, passCX, passCY);
    } else {
      ctx.font = `700 ${vs(24)}px ${displayFont}`;
      ctx.fillText('›', passCX + vs(2), passCY - vs(2));
    }
    ctx.restore();
    rects.draw = { x: passCX - sideBtnSz / 2, y: passCY - sideBtnSz / 2, w: sideBtnSz, h: sideBtnSz };

    // ── God Mode Controls ──────────────────────────────────────────────────
    if (state.isGodMode && state.spectatingPlayerName) {
      const HAND_H = H * 0.26;
      const handTopY = H - HAND_H - vs(4);
      const gmY = handTopY - vs(55); // Position just above the YOUR TURN indicator

      ctx.save();
      ctx.font = `700 ${vs(14)}px ${displayFont}`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#000'; ctx.shadowBlur = vs(4);
      ctx.fillText(`👁 God Mode: ${state.spectatingPlayerName}`, _CX, gmY);

      const arrW = vs(40);
      const arrH = vs(30);
      const leftX = _CX - vs(100);
      ctx.beginPath(); rr(ctx, leftX - arrW/2, gmY - arrH/2, arrW, arrH, vs(5));
      ctx.fillStyle = 'rgba(5,7,13,0.6)'; ctx.fill();
      ctx.strokeStyle = 'rgba(139,147,168,0.3)'; ctx.lineWidth = vs(1); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillText('◀', leftX, gmY);
      rects.godLeft = { x: leftX - arrW/2, y: gmY - arrH/2, w: arrW, h: arrH };

      const rightX = _CX + vs(100);
      ctx.beginPath(); rr(ctx, rightX - arrW/2, gmY - arrH/2, arrW, arrH, vs(5));
      ctx.fillStyle = 'rgba(5,7,13,0.6)'; ctx.fill();
      ctx.strokeStyle = 'rgba(139,147,168,0.3)'; ctx.lineWidth = vs(1); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillText('▶', rightX, gmY);
      rects.godRight = { x: rightX - arrW/2, y: gmY - arrH/2, w: arrW, h: arrH };
      ctx.restore();
    }

    return rects;
  }

  function drawTurnIndicator(ctx, isMyTurn, W, H, activeColor) {
    if (!isMyTurn) return;
    const pulse = osc(318); // ~2s emissive breath
    const HAND_H = H * 0.26;
    const handTopY = H - HAND_H - vs(4);
    const colHex = (activeColor && activeColor !== 'wild' && CardColors[activeColor])
      ? CardColors[activeColor].fill
      : '#e8ebf3';

    // ── Emissive line along the hand area's top edge, in the active color ──
    const glow = ctx.createLinearGradient(W * 0.1, 0, W * 0.9, 0);
    glow.addColorStop(0, 'transparent');
    glow.addColorStop(0.5, hexA(colHex, 0.4 + pulse * 0.3));
    glow.addColorStop(1, 'transparent');
    ctx.save();
    ctx.shadowColor = hexA(colHex, 0.5 + pulse * 0.4);
    ctx.shadowBlur = vs(10 + pulse * 6);
    ctx.fillStyle = glow;
    ctx.fillRect(0, handTopY, W, vs(2));
    ctx.restore();

    // ── "YOUR TURN" glass pill centered above the hand (same position/size) ──
    const label = 'YOUR TURN';
    ctx.save();
    ctx.font = `700 ${vs(13)}px ${displayFont}`;
    const tw = ctx.measureText(label).width;
    const ph = vs(22), pw = tw + vs(24);
    const px = W / 2 - pw / 2;
    const py = handTopY - ph - vs(10);

    // Glass body
    rr(ctx, px, py, pw, ph, vs(11));
    ctx.fillStyle = 'rgba(11,15,26,0.82)';
    ctx.fill();

    // Emissive pulsing border in the active-turn color
    ctx.shadowColor = colHex;
    ctx.shadowBlur = vs(6 + pulse * 8);
    rr(ctx, px, py, pw, ph, vs(11));
    ctx.strokeStyle = hexA(colHex, 0.5 + pulse * 0.45);
    ctx.lineWidth = vs(1.3);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Label text
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, W / 2, py + ph / 2);
    ctx.restore();
  }


  function drawColorPicker(ctx, W, H) {
    ctx.fillStyle = 'rgba(5,7,13,0.85)'; ctx.fillRect(0, 0, W, H);

    // Title
    ctx.fillStyle = '#e8ebf3'; ctx.font = `700 ${vs(18)}px ${displayFont}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Pick a color', W / 2, H * 0.33);

    const sz = vs(60), gap = vs(12);
    const cols = [
      { k: 'red', f: '#ff3b5c', l: 'Red' },
      { k: 'blue', f: '#3d9dff', l: 'Blue' },
      { k: 'green', f: '#2ee88a', l: 'Green' },
      { k: 'yellow', f: '#ffd23f', l: 'Yellow' },
    ];
    const tw = sz * 4 + gap * 3;
    const sx = (W - tw) / 2, sy = H * 0.40;
    const rects = [];

    cols.forEach((c, i) => {
      const bx = sx + i * (sz + gap);
      ctx.save();
      ctx.shadowColor = c.f; ctx.shadowBlur = vs(14);
      rr(ctx, bx, sy, sz, sz, vs(14));
      const bg = ctx.createLinearGradient(bx, sy, bx, sy + sz);
      bg.addColorStop(0, c.f);
      bg.addColorStop(1, hexA(c.f, 0.75));
      ctx.fillStyle = bg; ctx.fill();
      rr(ctx, bx, sy, sz, sz, vs(14));
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = vs(1.5); ctx.stroke();
      ctx.restore();

      ctx.fillStyle = 'rgba(232,235,243,0.8)'; ctx.font = `600 ${vs(10)}px ${font}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(c.l, bx + sz / 2, sy + sz + vs(6));

      rects.push({ x: bx, y: sy, w: sz, h: sz, color: c.k });
    });
    return rects;
  }

  function drawWinScreen(ctx, name, isHost, W, H) {
    ctx.fillStyle = 'rgba(5,7,13,0.9)'; ctx.fillRect(0, 0, W, H);

    // Animated confetti
    const t = REDUCED ? 0 : Date.now() / 1000;
    ctx.save();
    for (let i = 0; i < 50; i++) {
      const seed = i * 137.5;
      const cx = (seed * 3.7 + t * 30 * ((i % 3) + 1)) % W;
      const cy = (seed * 2.3 + t * 50 * ((i % 2) + 1)) % (H * 0.7);
      const sz = vs(2 + (i % 4));
      ctx.fillStyle = ['#ff3b5c', '#ffd23f', '#2ee88a', '#3d9dff', '#b06bff', '#ff7a45'][i % 6];
      ctx.globalAlpha = 0.5 + Math.sin(t + i) * 0.3;
      ctx.fillRect(cx, cy, sz, sz * 0.6);
    }
    ctx.restore();

    ctx.save();
    ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = vs(25);
    ctx.fillStyle = '#ffd23f'; ctx.font = `700 ${vs(32)}px ${displayFont}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🎉 WINNER!', W / 2, H * 0.34);
    ctx.restore();

    ctx.fillStyle = '#fff'; ctx.font = `700 ${vs(22)}px ${displayFont}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, W / 2, H * 0.42);

    if (isHost) {
      const bw = vs(160), bh = vs(48), bx = W / 2 - bw / 2, by = H * 0.52;
      ctx.save(); ctx.shadowColor = '#ff3b5c'; ctx.shadowBlur = vs(14);
      rr(ctx, bx, by, bw, bh, vs(14));
      ctx.fillStyle = 'rgba(255,59,92,0.16)'; ctx.fill();
      rr(ctx, bx, by, bw, bh, vs(14));
      ctx.strokeStyle = 'rgba(255,59,92,0.75)'; ctx.lineWidth = vs(1.5); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `700 ${vs(16)}px ${displayFont}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowBlur = 0; ctx.fillText('Play Again', W / 2, by + bh / 2);
      ctx.restore();
      return { playAgain: { x: bx, y: by, w: bw, h: bh } };
    }
    ctx.fillStyle = 'rgba(232,235,243,0.4)'; ctx.font = `500 ${vs(13)}px ${font}`;
    ctx.textAlign = 'center'; ctx.fillText('Waiting for host...', W / 2, H * 0.54);
    return {};
  }

  function drawTurnTimer(ctx, turnTimer, myId, W, H) {
    if (!turnTimer) return;
    const { playerId, startTime, durationMs } = turnTimer;
    // Safeguard: validate startTime
    if (!startTime || startTime > Date.now()) return;
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, durationMs - elapsed);
    const fraction = remaining / durationMs;
    const secs = Math.ceil(remaining / 1000);

    const _SW = W * 0.16, _TH = H * 0.26, _HH = H * 0.26;
    const _CW = W - 2 * _SW, _CH = H - _TH - _HH;
    const _CX = _SW + _CW / 2, _CY = _TH + _CH / 2;
    const _cw = Math.min(_CW * 0.17, _CH * 0.52, vs(90));
    const _ch = _cw * 1.45;
    const _gap = Math.max(_cw * 0.45, vs(34));
    const _dx = _CX - _cw - _gap;   // deck left edge
    const _dcx = _CX + _gap;         // discard left edge
    const _dy = _CY - _ch / 2;         // card top edge

    const isMe = playerId === myId;
    const DANGER = fraction < 0.33;
    const color = DANGER
      ? hexA('#ff3b5c', REDUCED ? 0.9 : 0.75 + Math.sin(Date.now() / 150) * 0.25)
      : 'rgba(255,210,63,0.9)';

    // Position: exact center above the cards
    const timerX = _CX;
    const timerY = _dy - vs(26);
    const r = vs(14);
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + 2 * Math.PI * fraction;

    ctx.save();
    // Track — a faint glass ring
    ctx.beginPath(); ctx.arc(timerX, timerY, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(139,147,168,0.15)'; ctx.lineWidth = vs(2.5); ctx.stroke();
    // Arc — thin glowing sweep
    ctx.beginPath(); ctx.arc(timerX, timerY, r, startAngle, endAngle);
    ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = vs(8);
    ctx.lineWidth = vs(2.5); ctx.lineCap = 'round'; ctx.stroke();
    // Secs — data face readout
    ctx.fillStyle = DANGER ? color : 'rgba(232,235,243,0.85)';
    ctx.font = `600 ${vs(10)}px ${dataFont}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowBlur = 0;
    ctx.fillText(secs + 's', timerX, timerY);
    ctx.restore();
  }

  // ── Layout helpers for animation system ──────────────────────────────────────
  // Pure computation — no drawing. These use the EXACT same formulas as the
  // drawing functions so flying cards always start/end at correct positions.

  /** Returns the deck (draw pile) center and card dimensions in canvas pixels. */
  function getDeckPosition(W, H) {
    const _SW = W * 0.16, _TH = H * 0.26, _HH = H * 0.26;
    const _CW = W - 2 * _SW, _CH = H - _TH - _HH;
    const _CX = _SW + _CW / 2, _CY = _TH + _CH / 2;
    const _cw = Math.min(_CW * 0.17, _CH * 0.52, vs(90));
    const _ch = _cw * 1.45;
    const _gap = Math.max(_cw * 0.15, vs(12));
    const _dx = _CX - _cw - _gap; // deck left edge
    return {
      cx: _dx + _cw / 2,
      cy: _CY,
      w: _cw,
      h: _ch,
    };
  }

  /** Returns the discard pile center and card dimensions in canvas pixels.
   *  MUST mirror drawPiles() exactly — fly animations land on this point. */
  function getDiscardPosition(W, H) {
    const _SW = W * 0.16, _TH = H * 0.26, _HH = H * 0.26;
    const _CW = W - 2 * _SW, _CH = H - _TH - _HH;
    const _CX = _SW + _CW / 2, _CY = _TH + _CH / 2;
    const _cw = Math.min(_CW * 0.17, _CH * 0.52, vs(90));
    const _ch = _cw * 1.45;
    const _gap = Math.max(_cw * 0.15, vs(12));
    const _dcx = _CX + _gap; // discard left edge
    return {
      cx: _dcx + _cw / 2,
      cy: _CY,
      w: _cw,
      h: _ch,
    };
  }

  /** Returns the local player's hand area center and card dimensions. */
  function getHandTarget(W, H) {
    const SIDE_W = W * 0.16;
    const HAND_H = H * 0.26;
    const handW = W - 2 * SIDE_W;
    const cw = Math.min(handW * 0.13, HAND_H * 0.82, vs(72));
    const ch = cw * 1.45;
    return {
      cx: W / 2,
      cy: H - ch / 2 - vs(16),
      w: cw,
      h: ch,
      rotation: 0,
    };
  }

  /**
   * Returns an array of opponent position descriptors.
   * Each entry: { id, side: 'top'|'left'|'right', cx, cy, rotation }
   * Uses the exact same nLeft/nRight/nTop distribution as drawOpponents().
   */
  function getOpponentPositions(players, myId, W, H) {
    if (!players || !players.length) return [];
    const myIdx = players.findIndex(p => p.id === myId);
    let opps = [];
    if (myIdx === -1) {
      opps = [...players];
    } else {
      for (let i = 1; i < players.length; i++) opps.push(players[(myIdx + i) % players.length]);
    }
    if (!opps.length) return [];
    const n = opps.length;

    // Zone constants (same as drawOpponents)
    const SIDE_W = W * 0.16;
    const TOP_H = H * 0.26;
    const HAND_H = H * 0.26;
    const CX = SIDE_W, CY = TOP_H;
    const CW = W - 2 * SIDE_W, CH = H - TOP_H - HAND_H;

    // Distribution (same as drawOpponents)
    let nTop, nLeft, nRight;
    if (n === 1) { nTop = 1; nLeft = 0; nRight = 0; }
    else if (n === 2) { nTop = 2; nLeft = 0; nRight = 0; }
    else if (n === 3) { nTop = 1; nLeft = 1; nRight = 1; }
    else if (n === 4) { nTop = 2; nLeft = 1; nRight = 1; }
    else if (n === 5) { nTop = 3; nLeft = 1; nRight = 1; }
    else if (n === 6) { nTop = 2; nLeft = 2; nRight = 2; }
    else if (n <= 9) { nLeft = Math.floor(n / 3); nRight = Math.floor(n / 3); nTop = n - nLeft - nRight; }
    else if (n <= 12) { nLeft = Math.ceil(n / 3); nRight = Math.floor(n / 3); nTop = n - nLeft - nRight; }
    else { nLeft = Math.round(n / 3); nRight = Math.round(n / 3); nTop = n - nLeft - nRight; }

    const leftOps = opps.slice(0, nLeft);
    const rightOps = opps.slice(n - nRight);
    const topOps = opps.slice(nLeft, n - (nRight || 0));

    const results = [];

    // ── Seat geometry: MUST mirror drawOpponents exactly ──────────────────────
    // Fly animations land on these points; any drift from the drawn layout makes
    // cards visually arrive at a neighboring player's seat.

    // Top row (same as drawOpponents: fan is centered on slotCX at fy = vs(6))
    const tcw = Math.min(CW / (Math.max(nTop, 1) * 4.0), TOP_H * 0.25, vs(24));
    const tch = tcw * 1.45;
    const topSlotW = nTop > 0 ? CW / nTop : CW;
    topOps.forEach((p, i) => {
      const slotCX = CX + topSlotW * i + topSlotW / 2;
      results.push({ id: p.id, side: 'top', cx: slotCX, cy: vs(6) + tch / 2, rotation: 180, w: tcw, h: tch });
    });

    // Side columns (same as drawOpponents drawSide: slots spread over CH * 1.8
    // centered on the middle zone, left column reversed bottom-to-top)
    const maxSideSlots = Math.max(nLeft, nRight);
    const scw = Math.min(SIDE_W * 0.42, CH / (maxSideSlots * 1.3), vs(24));
    const sch = scw * 1.45;
    const sideAvailH = CH * 1.8;
    const startY = CY - (sideAvailH - CH) / 2;

    leftOps.forEach((p, i) => {
      const slotH = sideAvailH / nLeft;
      const slotIdx = nLeft - 1 - i; // Reverse: first player at bottom
      const cy = startY + slotH * slotIdx + slotH / 2;
      results.push({ id: p.id, side: 'left', cx: SIDE_W / 2, cy, rotation: -90, w: scw, h: sch });
    });

    rightOps.forEach((p, i) => {
      const slotH = sideAvailH / nRight;
      const cy = startY + slotH * i + slotH / 2;
      results.push({ id: p.id, side: 'right', cx: W - SIDE_W / 2, cy, rotation: 90, w: scw, h: sch });
    });

    return results;
  }

  return {
    font, updateScale, drawBackground, drawCard, drawCardBack: _cardBack,
    drawPlayerHand, drawHandPlaceholders, drawOpponents, drawPiles, drawDirectionArrow,
    drawActionButtons, drawColorPicker, drawWinScreen, drawTurnIndicator, drawTurnTimer, vs,
    getDeckPosition, getDiscardPosition, getOpponentPositions, getHandTarget,
  };
})();
