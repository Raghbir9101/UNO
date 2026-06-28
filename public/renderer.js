const Renderer = (() => {
  const VW = 980, VH = 600;
  let s = 1;
  const font = "'Inter', sans-serif";
  function updateScale(c) { s = Math.min(c.width / VW, c.height / VH); }

  function vs(v) { return v * s; }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawBackground(ctx, W, H) {
    const t = Date.now() / 1000;
    
    // 1. Rich dark gradient base (Premium Casino Navy)
    const g = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.8);
    g.addColorStop(0, '#122544'); 
    g.addColorStop(0.6, '#091221');
    g.addColorStop(1, '#03060b');
    ctx.fillStyle = g; 
    ctx.fillRect(0, 0, W, H);

    // 2. Animated floating diamonds in the background
    ctx.save();
    for (let i = 0; i < 24; i++) {
        const seed = i * 11.7;
        const speedX = Math.sin(seed) * vs(18);
        const speedY = Math.cos(seed) * vs(12);
        
        // Continuous wrapping movement
        const wx = ((speedX * t + W/2 + Math.sin(seed)*W) % W + W) % W;
        const wy = ((speedY * t + H/2 + Math.cos(seed)*H) % H + H) % H;
        
        const sz = vs(15 + (i % 35));
        ctx.save();
        ctx.translate(wx, wy);
        ctx.rotate(t * 0.15 * (i % 2 === 0 ? 1 : -1) + seed);
        ctx.beginPath();
        rr(ctx, -sz/2, -sz/2, sz, sz, vs(6));
        ctx.fillStyle = `rgba(255,255,255,${0.008 + (i%5)*0.003})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(255,255,255,${0.015 + (i%5)*0.006})`;
        ctx.lineWidth = vs(1.5);
        ctx.stroke();
        ctx.restore();
    }
    ctx.restore();

    // 3. Subtle diamond grid pattern (matches UI theme)
    ctx.save(); 
    ctx.globalAlpha = 0.025; 
    ctx.strokeStyle = '#8ab4f8'; 
    ctx.lineWidth = vs(1);
    const gridSize = vs(45);
    ctx.translate(W/2, H/2);
    ctx.rotate(Math.PI/4); // Rotate 45deg for diamond grid
    const diag = Math.max(W, H) * 1.5;
    ctx.beginPath();
    for (let i = -diag; i < diag; i += gridSize) {
      ctx.moveTo(i, -diag); ctx.lineTo(i, diag);
      ctx.moveTo(-diag, i); ctx.lineTo(diag, i);
    }
    ctx.stroke();
    ctx.restore();

    // 4. Center Spotlight / Glow for the play area
    ctx.save();
    const _TH = H * 0.26, _HH = H * 0.26;
    const _CY = _TH + (H - _TH - _HH)/2;
    const spotSize = Math.max(W, H) * 0.45;
    const spot = ctx.createRadialGradient(W/2, _CY, 0, W/2, _CY, spotSize);
    spot.addColorStop(0, 'rgba(66, 165, 245, 0.15)'); // Soft bright blue glow
    spot.addColorStop(0.5, 'rgba(66, 165, 245, 0.04)');
    spot.addColorStop(1, 'transparent');
    ctx.fillStyle = spot;
    // Breathing glow effect
    ctx.globalAlpha = 0.85 + Math.sin(t*2)*0.15;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawCard(ctx, card, x, y, w, h, opts = {}) {
    const { selected, faceUp = true } = opts;
    const rd = w * 0.12;
    ctx.save();
    if (selected) y -= vs(20);

    if (!faceUp) { _cardBack(ctx, x, y, w, h); ctx.restore(); return; }

    const ci = isWildCard(card) ? CardColors.wild : (CardColors[card.color] || CardColors.wild);

    // Shadow
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = vs(8);
    ctx.shadowOffsetY = vs(3);
    rr(ctx, x, y, w, h, rd); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.restore();

    // Color fill
    const m = w * 0.05;
    rr(ctx, x + m, y + m, w - m * 2, h - m * 2, rd * 0.7);
    ctx.fillStyle = ci.fill; ctx.fill();

    // Wild stripes
    if (isWildCard(card)) {
      ctx.save();
      rr(ctx, x + m, y + m, w - m * 2, h - m * 2, rd * 0.7); ctx.clip();
      const cols = ['#E53935', '#FDD835', '#43A047', '#1E88E5'];
      const sw = w * 0.35;
      for (let i = 0; i < 4; i++) {
        ctx.save(); ctx.fillStyle = cols[i]; ctx.globalAlpha = 0.55;
        ctx.translate(x + w * 0.1 + i * sw * 0.6, y + h / 2);
        ctx.rotate(0.45);
        ctx.fillRect(-sw / 2, -h, sw, h * 2.2);
        ctx.restore();
      }
      ctx.restore();
    }

    // White ellipse center
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w * 0.32, h * 0.28, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fill();
    ctx.restore();

    // Center text
    const txt = getCardDisplayText(card);
    const fs = card.type === 'number' ? w * 0.5 : w * 0.38;
    ctx.fillStyle = ci.text || '#fff';
    ctx.font = `900 ${fs}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = isWildCard(card) ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = vs(4);
    ctx.fillText(txt, x + w / 2, y + h / 2);
    ctx.shadowBlur = 0;

    // Corners
    const cs = w * 0.24;
    ctx.font = `800 ${cs}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillStyle = ci.text || '#fff';
    ctx.fillText(txt, x + w * 0.22, y + h * 0.06);
    ctx.save();
    ctx.translate(x + w * 0.78, y + h * 0.94);
    ctx.rotate(Math.PI);
    ctx.textBaseline = 'top';
    ctx.fillText(txt, 0, 0);
    ctx.restore();

    // Border
    rr(ctx, x, y, w, h, rd);
    ctx.strokeStyle = selected ? '#FFD700' : 'rgba(255,255,255,0.2)';
    ctx.lineWidth = selected ? vs(3) : vs(1);
    ctx.stroke();

    if (selected) {
      ctx.save(); ctx.shadowColor = '#FFD700'; ctx.shadowBlur = vs(18);
      rr(ctx, x - vs(2), y - vs(2), w + vs(4), h + vs(4), rd + vs(2));
      ctx.strokeStyle = 'rgba(255,215,0,0.7)'; ctx.lineWidth = vs(2); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function _cardBack(ctx, x, y, w, h) {
    const rd = w * 0.12;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.4)'; ctx.shadowBlur = vs(6); ctx.shadowOffsetY = vs(2);
    rr(ctx, x, y, w, h, rd); ctx.fillStyle = '#1b1b35'; ctx.fill();
    ctx.restore();

    // Crosshatch
    ctx.save(); rr(ctx, x, y, w, h, rd); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = vs(1);
    for (let i = -h; i < w + h; i += vs(5)) {
      ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i - h, y + h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + i, y); ctx.lineTo(x + i + h, y + h); ctx.stroke();
    }
    ctx.restore();

    // Red border inset
    const m = w * 0.1;
    rr(ctx, x + m, y + m, w - m * 2, h - m * 2, rd * 0.5);
    ctx.strokeStyle = '#D32F2F'; ctx.lineWidth = vs(2.5); ctx.stroke();

    // UNO text
    ctx.save(); ctx.translate(x + w / 2, y + h / 2); ctx.rotate(-0.25);
    ctx.fillStyle = '#FFCA28'; ctx.font = `900 ${w * 0.28}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = vs(3);
    ctx.fillText('UNO', 0, 0);
    ctx.restore();

    rr(ctx, x, y, w, h, rd);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = vs(1); ctx.stroke();
  }

  function drawPlayerHand(ctx, cards, selIdx, scrollOff, W, H, flyingCardId) {
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
      if (isFlying) {
        ctx.save(); ctx.globalAlpha = 0.0;
        drawCard(ctx, cards[i], cx2, baseY, cw, ch, { selected: false, faceUp: true });
        ctx.restore();
      } else {
        drawCard(ctx, cards[i], cx2, baseY, cw, ch, { selected: i === selIdx, faceUp: true });
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

    const COLORS = ['#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00ACC1', '#D81B60', '#F4511E', '#7B1FA2', '#00897B'];
    function pColor(p) { return COLORS[players.findIndex(pl => pl.id === p.id) % COLORS.length]; }

    const pulse = (Math.sin(Date.now() / 300) + 1) / 2;
    function glowBox(x, y, w, h) {
      ctx.save();
      ctx.strokeStyle = `rgba(255,215,0,${0.5 + pulse * 0.4})`;
      ctx.lineWidth = vs(2); ctx.shadowColor = '#FFD700'; ctx.shadowBlur = vs(12);
      rr(ctx, x, y, w, h, vs(5)); ctx.stroke();
      ctx.restore();
    }
    function badge(bx, by, cc) {
      ctx.save();
      ctx.beginPath(); ctx.arc(bx, by, vs(9), 0, Math.PI * 2);
      ctx.fillStyle = cc === 1 ? '#E53935' : 'rgba(8,20,50,0.9)'; ctx.fill();
      ctx.strokeStyle = cc === 1 ? '#ff6b6b' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = vs(1.5); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `800 ${vs(8)}px ${font}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(cc, bx, by); ctx.restore();
    }
    function unoTag(x, y) {
      const p2 = (Math.sin(Date.now() / 180) + 1) / 2;
      ctx.save(); ctx.fillStyle = `rgba(229,57,53,${0.8 + p2 * 0.2})`;
      ctx.font = `900 ${vs(9)}px ${font}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('UNO!', x, y); ctx.restore();
    }

    // ── TOP opponents ─────────────────────────────────────────────────────────
    const tcw = Math.min(CW / (Math.max(nTop, 1) * 3.2), TOP_H * 0.32, vs(32));
    const tch = tcw * 1.45;
    const topSlotW = nTop > 0 ? CW / nTop : CW;
    const nameRowH = vs(28); // reserved height below cards for name row

    topOps.forEach((p, i) => {
      const isCur = p.id === curPlayer;
      const cc = p.cardCount || 0;
      const ms = Math.min(cc, 8);
      const ov = Math.min(tcw * 0.55, (topSlotW * 0.75 - tcw) / Math.max(ms - 1, 1));
      const fanW = tcw + Math.max(ms - 1, 0) * ov;
      const slotCX = CX + topSlotW * i + topSlotW / 2;
      const fx = slotCX - fanW / 2;
      const fy = vs(8);

      if (isCur && ms > 0) glowBox(fx - vs(3), fy - vs(3), fanW + vs(6), tch + vs(6));
      for (let c = 0; c < ms; c++) _cardBack(ctx, fx + c * ov, fy, tcw, tch);
      if (ms === 0) {
        ctx.save(); ctx.globalAlpha = 0.12;
        rr(ctx, slotCX - tcw / 2, fy, tcw, tch, vs(5));
        ctx.strokeStyle = '#fff'; ctx.lineWidth = vs(1); ctx.stroke(); ctx.restore();
      }

      // Name row below cards
      const nameRowY = fy + tch + vs(5);
      const avR = vs(9);
      const avX = slotCX - vs(2);
      // Avatar circle
      ctx.save();
      ctx.beginPath(); ctx.arc(avX - avR - vs(2), nameRowY + avR, avR, 0, Math.PI * 2);
      ctx.fillStyle = pColor(p); ctx.fill();
      if (isCur) { ctx.strokeStyle = '#FFD700'; ctx.lineWidth = vs(1.5); ctx.stroke(); }
      ctx.restore();
      // Name
      const nm = p.nickname.length > 12 ? p.nickname.slice(0, 11) + '…' : p.nickname;
      ctx.fillStyle = isCur ? '#FFD700' : '#fff';
      ctx.font = `700 ${vs(12)}px ${font}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = vs(4);
      ctx.fillText(nm, avX - vs(2) + vs(2), nameRowY + avR);
      ctx.shadowBlur = 0;

      badge(fx + fanW + vs(5), fy + vs(4), cc);
      if (cc === 1) unoTag(slotCX, fy + tch + nameRowH + vs(4));
    });

    // ── SIDE helper ───────────────────────────────────────────────────────────
    const scw = Math.min(SIDE_W * 0.52, CH / (Math.max(nLeft, nRight, 1) * 2.8), vs(28));
    const sch = scw * 1.45;
    const sideAvailH = CH;

    function drawSide(p, isLeft, slotIdx, nSlots) {
      const isCur = p.id === curPlayer;
      const cc = p.cardCount || 0;
      const ms = Math.min(cc, 7);
      const ov = Math.min(sch * 0.35, vs(5));
      const fanH = sch + Math.max(ms - 1, 0) * ov;
      const slotH = sideAvailH / nSlots;
      const cy2 = CY + slotH * slotIdx + slotH / 2;
      const fx = isLeft ? SIDE_W / 2 - scw / 2 : W - SIDE_W / 2 - scw / 2;
      const fy = cy2 - fanH / 2;

      if (isCur && ms > 0) glowBox(fx - vs(3), fy - vs(3), scw + vs(6), fanH + vs(6));

      for (let c = 0; c < ms; c++) {
        _cardBack(ctx, fx, fy + c * ov, scw, sch);
      }
      if (ms === 0) {
        ctx.save(); ctx.globalAlpha = 0.12;
        rr(ctx, fx, cy2 - sch / 2, scw, sch, vs(5));
        ctx.strokeStyle = '#fff'; ctx.lineWidth = vs(1); ctx.stroke(); ctx.restore();
      }

      // Name pill below cards
      const pileCX = fx + scw / 2;
      const nameY = fy + fanH + vs(6);
      const avR = vs(8);

      // Avatar
      ctx.save();
      ctx.beginPath(); ctx.arc(pileCX, nameY + avR, avR, 0, Math.PI * 2);
      ctx.fillStyle = pColor(p); ctx.fill();
      if (isCur) { ctx.strokeStyle = '#FFD700'; ctx.lineWidth = vs(1.5); ctx.stroke(); }
      ctx.restore();

      // Name below avatar
      const nm = p.nickname.length > 8 ? p.nickname.slice(0, 7) + '…' : p.nickname;
      ctx.fillStyle = isCur ? '#FFD700' : '#fff';
      ctx.font = `700 ${vs(11)}px ${font}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = vs(4);
      ctx.fillText(nm, pileCX, nameY + avR * 2 + vs(2));
      ctx.shadowBlur = 0;

      badge(isLeft ? fx + scw + vs(10) : fx - vs(10), cy2 + fanH / 2 + vs(4), cc);
      if (cc === 1) unoTag(pileCX, fy - vs(12));
    }

    leftOps.forEach((p, i) => drawSide(p, true, i, nLeft));
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

    // ── Background Diamond ──
    ctx.save();
    ctx.translate(_CX, _CY);
    ctx.rotate(Math.PI / 4);
    const bgSize = _cw * 1.8;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = vs(2);
    rr(ctx, -bgSize / 2, -bgSize / 2, bgSize, bgSize, vs(16));
    ctx.fill(); ctx.stroke();
    const inSize = bgSize * 0.8;
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    rr(ctx, -inSize / 2, -inSize / 2, inSize, inSize, vs(12));
    ctx.stroke();
    ctx.restore();

    const sideBtnSz = _cw * 0.45;

    // ── Special Mode (Top Left) ──
    const smCX = _dx - vs(15) - sideBtnSz / 2;
    const smCY = _CY - vs(30);
    ctx.save();
    ctx.translate(smCX, smCY);
    ctx.rotate(Math.PI / 4);
    ctx.shadowColor = '#1E88E5'; ctx.shadowBlur = vs(6);
    rr(ctx, -sideBtnSz / 2, -sideBtnSz / 2, sideBtnSz, sideBtnSz, vs(6));
    const sg = ctx.createLinearGradient(-sideBtnSz / 2, -sideBtnSz / 2, sideBtnSz / 2, sideBtnSz / 2);
    sg.addColorStop(0, '#42A5F5'); sg.addColorStop(1, '#1565C0');
    ctx.fillStyle = sg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = vs(2); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#fff'; ctx.font = `800 ${vs(8)}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = vs(2);
    ctx.fillText('SPECIAL', smCX, smCY - vs(5));
    ctx.fillText('MODE', smCX, smCY + vs(5));
    ctx.restore();

    // Deck (left)
    for (let i = 2; i >= 0; i--) _cardBack(ctx, _dx + i * vs(1.5), _dy - i * vs(1.5), _cw, _ch);
    rects.draw = { x: _dx, y: _dy, w: _cw, h: _ch };

    // Draw Deck Count Badge
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    ctx.arc(_dx + _cw / 2, _dy + _ch + vs(12), vs(10), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `700 ${vs(10)}px ${font}`;
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
      ctx.save(); ctx.translate(_dcx + _cw / 2, _dy + _ch / 2);
      drawCard(ctx, discardTop, -_cw / 2, -_ch / 2, _cw, _ch, { faceUp: true });
      ctx.restore();
    }
    rects.discard = { x: _dcx, y: _dy, w: _cw, h: _ch };

    // Direction arrow below piles (center between them)
    const _pulse = (Math.sin(Date.now() / 500) + 1) / 2;
    ctx.save(); ctx.globalAlpha = 0.45 + _pulse * 0.25;
    ctx.fillStyle = '#fff'; ctx.font = `400 ${vs(20)}px ${font}`;
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
    const pulse3 = (Math.sin(Date.now() / 180) + 1) / 2;

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
    const gOp = state.unoHighlight ? 1.0 : 0.4;
    ctx.fillStyle = `rgba(67, 160, 71, ${gOp})`; ctx.fillRect(-sideBtnSz / 2, -sideBtnSz / 2, sideBtnSz / 2, sideBtnSz / 2);
    ctx.fillStyle = `rgba(229, 57, 53, ${gOp})`; ctx.fillRect(0, -sideBtnSz / 2, sideBtnSz / 2, sideBtnSz / 2);
    ctx.fillStyle = `rgba(30, 136, 229, ${gOp})`; ctx.fillRect(0, 0, sideBtnSz / 2, sideBtnSz / 2);
    ctx.fillStyle = `rgba(253, 216, 53, ${gOp})`; ctx.fillRect(-sideBtnSz / 2, 0, sideBtnSz / 2, sideBtnSz / 2);
    rr(ctx, -sideBtnSz / 2, -sideBtnSz / 2, sideBtnSz, sideBtnSz, vs(6));
    ctx.strokeStyle = state.unoHighlight ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)';
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
    ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = vs(2); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(unoCX, unoCY);
    if (state.unoClickTime && Date.now() - state.unoClickTime < 200) ctx.scale(0.7, 0.7);
    ctx.fillStyle = state.unoHighlight ? '#fff' : 'rgba(255,255,255,0.6)';
    ctx.font = `900 ${vs(14)}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = vs(3);
    ctx.fillText('UNO!', 0, 0);
    ctx.restore();

    rects.uno = { x: unoCX - sideBtnSz / 2, y: unoCY - sideBtnSz / 2, w: sideBtnSz, h: sideBtnSz };

    // ── Color indicator (Top Right) ───────────────────────────────
    const cix = _dcx + _cw + vs(15) + sideBtnSz / 2;
    const ciy = _CY - vs(30);

    if (state.activeColor && state.activeColor !== 'wild') {
      const ci = CardColors[state.activeColor];
      ctx.save();
      ctx.translate(cix, ciy);
      ctx.rotate(Math.PI / 4);
      ctx.shadowColor = ci.fill; ctx.shadowBlur = vs(8);
      rr(ctx, -sideBtnSz / 2, -sideBtnSz / 2, sideBtnSz, sideBtnSz, vs(6));
      ctx.fillStyle = ci.fill; ctx.fill();
      const gl = ctx.createLinearGradient(-sideBtnSz / 2, -sideBtnSz / 2, sideBtnSz / 2, sideBtnSz / 2);
      gl.addColorStop(0, 'rgba(255,255,255,0.4)');
      gl.addColorStop(1, 'rgba(0,0,0,0.1)');
      ctx.fillStyle = gl; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = vs(2); ctx.stroke();
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
      ctx.shadowColor = '#7E57C2'; ctx.shadowBlur = vs(12);
      pg.addColorStop(0, '#9575CD'); pg.addColorStop(1, '#512DA8');
    } else if (state.isMyTurn && state.pendingDraw > 0 && !state.isSpectator) {
      ctx.shadowColor = '#E53935'; ctx.shadowBlur = vs(12 + pulse3 * 8);
      pg.addColorStop(0, `rgba(229,57,53,${0.7 + pulse3 * 0.25})`);
      pg.addColorStop(1, `rgba(150,10,10,${0.7 + pulse3 * 0.25})`);
    } else if (state.isMyTurn && !state.isSpectator) {
      ctx.shadowColor = '#7E57C2'; ctx.shadowBlur = vs(12);
      pg.addColorStop(0, '#9575CD'); pg.addColorStop(1, '#512DA8');
    } else {
      pg.addColorStop(0, 'rgba(255,255,255,0.08)');
      pg.addColorStop(1, 'rgba(255,255,255,0.04)');
    }
    ctx.fillStyle = pg;
    rr(ctx, -pSide / 2, -pSide / 2, pSide, pSide, vs(6));
    ctx.fill();
    ctx.strokeStyle = (state.isMyTurn && !state.isSpectator) ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = vs(2); ctx.stroke();
    ctx.restore();

    // Pass arrow text
    ctx.save();
    ctx.fillStyle = (state.isMyTurn && !state.isSpectator) ? '#fff' : 'rgba(255,255,255,0.25)';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = vs(3);
    if (state.pendingDraw > 0 && state.isMyTurn && !state.isSpectator) {
      ctx.font = `900 ${vs(14)}px ${font}`;
      ctx.fillText(`+${state.pendingDraw}`, passCX, passCY);
    } else {
      ctx.font = `900 ${vs(24)}px ${font}`;
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
      ctx.font = `800 ${vs(14)}px ${font}`;
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = '#000'; ctx.shadowBlur = vs(4);
      ctx.fillText(`👁 God Mode: ${state.spectatingPlayerName}`, _CX, gmY);
      
      const arrW = vs(40);
      const arrH = vs(30);
      const leftX = _CX - vs(100);
      ctx.beginPath(); rr(ctx, leftX - arrW/2, gmY - arrH/2, arrW, arrH, vs(5));
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText('◀', leftX, gmY);
      rects.godLeft = { x: leftX - arrW/2, y: gmY - arrH/2, w: arrW, h: arrH };

      const rightX = _CX + vs(100);
      ctx.beginPath(); rr(ctx, rightX - arrW/2, gmY - arrH/2, arrW, arrH, vs(5));
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText('▶', rightX, gmY);
      rects.godRight = { x: rightX - arrW/2, y: gmY - arrH/2, w: arrW, h: arrH };
      ctx.restore();
    }

    return rects;
  }

  function drawTurnIndicator(ctx, isMyTurn, W, H) {
    if (!isMyTurn) return;
    const pulse = (Math.sin(Date.now() / 350) + 1) / 2; // 0..1 oscillates
    const HAND_H = H * 0.26;
    const handTopY = H - HAND_H - vs(4);

    // ── Glowing border along the bottom (hand area top edge) ──
    const glow = ctx.createLinearGradient(W * 0.1, 0, W * 0.9, 0);
    glow.addColorStop(0, 'transparent');
    glow.addColorStop(0.5, `rgba(253,216,53,${0.55 + pulse * 0.35})`);
    glow.addColorStop(1, 'transparent');
    ctx.save();
    ctx.shadowColor = `rgba(253,216,53,${0.6 + pulse * 0.4})`;
    ctx.shadowBlur = vs(12 + pulse * 8);
    ctx.fillStyle = glow;
    ctx.fillRect(0, handTopY, W, vs(3));
    ctx.restore();

    // ── "YOUR TURN" pill badge centered above the hand ──
    const label = 'YOUR TURN';
    ctx.save();
    ctx.font = `800 ${vs(13)}px ${font}`;
    const tw = ctx.measureText(label).width;
    const ph = vs(22), pw = tw + vs(24);
    const px = W / 2 - pw / 2;
    const py = handTopY - ph - vs(10);

    // Pill background (pulsing opacity)
    const alpha = 0.72 + pulse * 0.28;
    const bg = ctx.createLinearGradient(px, py, px + pw, py + ph);
    bg.addColorStop(0, `rgba(253,180,20,${alpha})`);
    bg.addColorStop(1, `rgba(229,57,53,${alpha})`);
    ctx.shadowColor = `rgba(253,216,53,${0.7 + pulse * 0.3})`;
    ctx.shadowBlur = vs(10 + pulse * 8);
    rr(ctx, px, py, pw, ph, vs(11));
    ctx.fillStyle = bg;
    ctx.fill();

    // Pill border
    ctx.shadowBlur = 0;
    rr(ctx, px, py, pw, ph, vs(11));
    ctx.strokeStyle = `rgba(255,255,255,${0.35 + pulse * 0.25})`;
    ctx.lineWidth = vs(1.5);
    ctx.stroke();

    // Label text
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = vs(3);
    ctx.fillText(label, W / 2, py + ph / 2);
    ctx.restore();
  }


  function drawColorPicker(ctx, W, H) {
    ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(0, 0, W, H);

    // Title
    ctx.fillStyle = '#fff'; ctx.font = `700 ${vs(18)}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Pick a color', W / 2, H * 0.33);

    const sz = vs(60), gap = vs(12);
    const cols = [
      { k: 'red', f: '#E53935', l: 'Red' },
      { k: 'blue', f: '#1E88E5', l: 'Blue' },
      { k: 'green', f: '#43A047', l: 'Green' },
      { k: 'yellow', f: '#FDD835', l: 'Yellow' },
    ];
    const tw = sz * 4 + gap * 3;
    const sx = (W - tw) / 2, sy = H * 0.40;
    const rects = [];

    cols.forEach((c, i) => {
      const bx = sx + i * (sz + gap);
      ctx.save();
      ctx.shadowColor = c.f; ctx.shadowBlur = vs(14);
      rr(ctx, bx, sy, sz, sz, vs(14));
      ctx.fillStyle = c.f; ctx.fill();
      rr(ctx, bx, sy, sz, sz, vs(14));
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = vs(2); ctx.stroke();
      ctx.restore();

      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = `600 ${vs(10)}px ${font}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(c.l, bx + sz / 2, sy + sz + vs(6));

      rects.push({ x: bx, y: sy, w: sz, h: sz, color: c.k });
    });
    return rects;
  }

  function drawWinScreen(ctx, name, isHost, W, H) {
    ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.fillRect(0, 0, W, H);

    // Animated confetti
    const t = Date.now() / 1000;
    ctx.save();
    for (let i = 0; i < 50; i++) {
      const seed = i * 137.5;
      const cx = (seed * 3.7 + t * 30 * ((i % 3) + 1)) % W;
      const cy = (seed * 2.3 + t * 50 * ((i % 2) + 1)) % (H * 0.7);
      const sz = vs(2 + (i % 4));
      ctx.fillStyle = ['#E53935', '#FDD835', '#43A047', '#1E88E5', '#AB47BC', '#FF9800'][i % 6];
      ctx.globalAlpha = 0.5 + Math.sin(t + i) * 0.3;
      ctx.fillRect(cx, cy, sz, sz * 0.6);
    }
    ctx.restore();

    ctx.save();
    ctx.shadowColor = '#FDD835'; ctx.shadowBlur = vs(25);
    ctx.fillStyle = '#FDD835'; ctx.font = `900 ${vs(32)}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🎉 WINNER!', W / 2, H * 0.34);
    ctx.restore();

    ctx.fillStyle = '#fff'; ctx.font = `700 ${vs(22)}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, W / 2, H * 0.42);

    if (isHost) {
      const bw = vs(160), bh = vs(48), bx = W / 2 - bw / 2, by = H * 0.52;
      ctx.save(); ctx.shadowColor = '#E53935'; ctx.shadowBlur = vs(12);
      rr(ctx, bx, by, bw, bh, vs(14));
      const g = ctx.createLinearGradient(bx, by, bx, by + bh);
      g.addColorStop(0, '#E53935'); g.addColorStop(1, '#C62828');
      ctx.fillStyle = g; ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `700 ${vs(16)}px ${font}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowBlur = 0; ctx.fillText('Play Again', W / 2, by + bh / 2);
      ctx.restore();
      return { playAgain: { x: bx, y: by, w: bw, h: bh } };
    }
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = `500 ${vs(13)}px ${font}`;
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
      ? ('rgba(229,57,53,' + (0.75 + Math.sin(Date.now() / 150) * 0.25) + ')')
      : 'rgba(255,215,0,0.9)';

    // Position: exact center above the cards
    const timerX = _CX;
    const timerY = _dy - vs(26);
    const r = vs(14);
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + 2 * Math.PI * fraction;

    ctx.save();
    // Track
    ctx.beginPath(); ctx.arc(timerX, timerY, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = vs(3); ctx.stroke();
    // Arc
    ctx.beginPath(); ctx.arc(timerX, timerY, r, startAngle, endAngle);
    ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = vs(10);
    ctx.lineWidth = vs(3); ctx.lineCap = 'round'; ctx.stroke();
    // Secs
    ctx.fillStyle = DANGER ? color : 'rgba(255,255,255,0.85)';
    ctx.font = `700 ${vs(10)}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowBlur = 0;
    ctx.fillText(secs + 's', timerX, timerY);
    ctx.restore();
  }

  return {
    font, updateScale, drawBackground, drawCard, drawCardBack: _cardBack,
    drawPlayerHand, drawHandPlaceholders, drawOpponents, drawPiles, drawDirectionArrow,
    drawActionButtons, drawColorPicker, drawWinScreen, drawTurnIndicator, drawTurnTimer, vs
  };
})();

