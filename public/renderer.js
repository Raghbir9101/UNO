const Renderer = (() => {
  const VW = 390, VH = 844;
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
    const g = ctx.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, W);
    g.addColorStop(0, '#1a4a7a'); g.addColorStop(1, '#0a1e3d');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // felt texture lines
    ctx.save(); ctx.globalAlpha = 0.02; ctx.strokeStyle = '#fff';
    for (let i = 0; i < W + H; i += vs(12)) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - H, H); ctx.stroke();
    }
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
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${fs}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = vs(4);
    ctx.fillText(txt, x + w / 2, y + h / 2);
    ctx.shadowBlur = 0;

    // Corners
    const cs = w * 0.24;
    ctx.font = `800 ${cs}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
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

  function drawPlayerHand(ctx, cards, selIdx, scrollOff, W, H) {
    if (!cards || !cards.length) return { cardRects: [] };
    const cw = Math.min(W * 0.16, vs(60));
    const ch = cw * 1.45;
    const maxOv = cw * 0.72;
    const ov = Math.min(maxOv, (W - vs(24) - cw) / Math.max(cards.length - 1, 1));
    const tw = cw + (cards.length - 1) * ov;
    const sx = Math.max(vs(12), (W - tw) / 2) + scrollOff;
    const baseY = H - ch - vs(18);
    const rects = [];
    for (let i = 0; i < cards.length; i++) {
      const cx = sx + i * ov;
      drawCard(ctx, cards[i], cx, baseY, cw, ch, { selected: i === selIdx, faceUp: true });
      rects.push({ x: cx, y: baseY, w: cw, h: ch, index: i, cardId: cards[i].id });
    }
    return { cardRects: rects, handY: baseY, cardW: cw, cardH: ch };
  }

  function drawOpponents(ctx, players, myId, curPlayer, dir, W, H) {
    const opps = players.filter(p => p.id !== myId);
    if (!opps.length) return;

    const cw = Math.min(W * 0.08, vs(32));
    const ch = cw * 1.45;

    // All opponents go across the top area
    const n = opps.length;
    const segW = (W - vs(40)) / n;

    for (let i = 0; i < n; i++) {
      const p = opps[i];
      const isCur = p.id === curPlayer;
      const cc = p.cardCount || 0;
      const centerX = vs(20) + segW * i + segW / 2;
      const topY = vs(20);

      // Player name + card count
      const name = p.nickname.length > 9 ? p.nickname.slice(0, 8) + '…' : p.nickname;
      ctx.fillStyle = isCur ? '#FFD700' : 'rgba(255,255,255,0.7)';
      ctx.font = `700 ${vs(11)}px ${font}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(name, centerX, topY);

      // Card fan
      const maxShow = Math.min(cc, 10);
      const spread = Math.min(cw * 0.45, (segW - cw - vs(8)) / Math.max(maxShow - 1, 1));
      const fanW = cw + (maxShow - 1) * spread;
      const fanX = centerX - fanW / 2;
      const cardY = topY + vs(16);

      for (let c = 0; c < maxShow; c++) {
        _cardBack(ctx, fanX + c * spread, cardY, cw, ch);
      }

      // Card count badge
      ctx.save();
      const bx = centerX + fanW / 2 - vs(4);
      const by = cardY - vs(4);
      ctx.beginPath(); ctx.arc(bx, by, vs(10), 0, Math.PI * 2);
      ctx.fillStyle = cc === 1 ? '#E53935' : '#0a1e3d';
      ctx.fill();
      ctx.strokeStyle = cc === 1 ? '#ff6b6b' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = vs(1.5); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = `800 ${vs(9)}px ${font}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(cc, bx, by);
      ctx.restore();

      // Current player glow
      if (isCur) {
        const pulse = (Math.sin(Date.now() / 300) + 1) / 2;
        ctx.save();
        ctx.strokeStyle = `rgba(255,215,0,${0.4 + pulse * 0.4})`;
        ctx.lineWidth = vs(2);
        ctx.shadowColor = '#FFD700'; ctx.shadowBlur = vs(8 + pulse * 6);
        rr(ctx, fanX - vs(6), cardY - vs(6), fanW + vs(12), ch + vs(12), vs(6));
        ctx.stroke();
        ctx.restore();
      }

      // UNO warning
      if (cc === 1) {
        const pulse = (Math.sin(Date.now() / 200) + 1) / 2;
        ctx.save();
        ctx.fillStyle = `rgba(229,57,53,${0.6 + pulse * 0.4})`;
        ctx.font = `900 ${vs(10)}px ${font}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText('UNO!', centerX, cardY + ch + vs(4));
        ctx.restore();
      }
    }
  }

  function drawPiles(ctx, discardTop, activeColor, drawCount, W, H) {
    const cw = Math.min(W * 0.22, vs(85));
    const ch = cw * 1.45;
    const centerY = H * 0.38 - ch / 2;
    const gap = vs(16);
    const rects = {};

    // Draw pile (left)
    const dx = W / 2 - cw - gap;
    // Stacked cards effect
    for (let i = 2; i >= 0; i--) {
      _cardBack(ctx, dx + i * vs(1.5), centerY - i * vs(1.5), cw, ch);
    }
    // Count label
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.font = `700 ${vs(11)}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(drawCount, dx + cw / 2, centerY + ch + vs(6));
    rects.draw = { x: dx, y: centerY, w: cw, h: ch };

    // Discard pile (right)
    const dcx = W / 2 + gap;
    if (discardTop) {
      // Slight rotation for natural look
      ctx.save();
      ctx.translate(dcx + cw / 2, centerY + ch / 2);
      ctx.rotate(0.03);
      drawCard(ctx, discardTop, -cw / 2, -ch / 2, cw, ch, { faceUp: true });
      ctx.restore();
    }
    rects.discard = { x: dcx, y: centerY, w: cw, h: ch };

    // Active color indicator
    if (activeColor && activeColor !== 'wild') {
      const ci = CardColors[activeColor];
      const ix = dcx + cw + vs(10), iy = centerY + ch / 2;
      const sz = vs(14);
      // Diamond shape
      ctx.save();
      ctx.shadowColor = ci.fill; ctx.shadowBlur = vs(8);
      ctx.beginPath();
      ctx.moveTo(ix, iy - sz); ctx.lineTo(ix + sz, iy);
      ctx.lineTo(ix, iy + sz); ctx.lineTo(ix - sz, iy);
      ctx.closePath();
      ctx.fillStyle = ci.fill; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = vs(1.5); ctx.stroke();
      ctx.restore();
    }

    // Direction arrow between piles
    const ax = W / 2, ay = centerY + ch + vs(6);
    const pulse = (Math.sin(Date.now() / 500) + 1) / 2;
    ctx.save(); ctx.globalAlpha = 0.35 + pulse * 0.15;
    ctx.fillStyle = '#fff'; ctx.font = `400 ${vs(16)}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(dir_global === 1 ? '↻' : '↺', ax, ay);
    ctx.restore();

    return rects;
  }

  // Tracked externally
  let dir_global = 1;
  function drawDirectionArrow(ctx, dir) { dir_global = dir; }

  function drawActionButtons(ctx, state, W, H) {
    const rects = {};
    const bh = vs(42), br = vs(12);
    const by = H * 0.73;
    const totalW = vs(200);
    const startX = (W - totalW) / 2;

    // Draw / Pass
    const dbw = vs(110);
    const dbx = startX;
    ctx.save();
    rr(ctx, dbx, by, dbw, bh, br);
    const dg = ctx.createLinearGradient(dbx, by, dbx, by + bh);
    if (state.isMyTurn) {
      dg.addColorStop(0, 'rgba(30,136,229,0.6)'); dg.addColorStop(1, 'rgba(20,100,180,0.6)');
    } else {
      dg.addColorStop(0, 'rgba(255,255,255,0.06)'); dg.addColorStop(1, 'rgba(255,255,255,0.03)');
    }
    ctx.fillStyle = dg; ctx.fill();
    rr(ctx, dbx, by, dbw, bh, br);
    ctx.strokeStyle = state.isMyTurn ? 'rgba(100,180,255,0.5)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = vs(1.5); ctx.stroke();
    ctx.fillStyle = state.isMyTurn ? '#fff' : 'rgba(255,255,255,0.3)';
    ctx.font = `700 ${vs(13)}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(state.pendingDraw > 0 ? `Draw ${state.pendingDraw}` : 'Draw / Pass', dbx + dbw / 2, by + bh / 2);
    ctx.restore();
    rects.draw = { x: dbx, y: by, w: dbw, h: bh };

    // UNO button
    const ubw = vs(80);
    const ubx = startX + dbw + vs(10);
    const pulse = (Math.sin(Date.now() / 180) + 1) / 2;
    ctx.save();
    rr(ctx, ubx, by, ubw, bh, br);
    const ug = ctx.createLinearGradient(ubx, by, ubx, by + bh);
    if (state.unoHighlight) {
      ctx.shadowColor = '#E53935'; ctx.shadowBlur = vs(10 + pulse * 12);
      ug.addColorStop(0, `rgba(229,57,53,${0.7 + pulse * 0.3})`);
      ug.addColorStop(1, `rgba(183,28,28,${0.7 + pulse * 0.3})`);
    } else {
      ug.addColorStop(0, 'rgba(229,57,53,0.2)'); ug.addColorStop(1, 'rgba(183,28,28,0.2)');
    }
    ctx.fillStyle = ug; ctx.fill();
    rr(ctx, ubx, by, ubw, bh, br);
    ctx.strokeStyle = state.unoHighlight ? 'rgba(255,100,100,0.6)' : 'rgba(229,57,53,0.3)';
    ctx.lineWidth = vs(1.5); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `900 ${vs(15)}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = vs(2);
    ctx.fillText('UNO!', ubx + ubw / 2, by + bh / 2);
    ctx.restore();
    rects.uno = { x: ubx, y: by, w: ubw, h: bh };

    return rects;
  }

  function drawTurnIndicator(ctx, isMyTurn, W, H) {
    if (!isMyTurn) return;
    const p = (Math.sin(Date.now() / 350) + 1) / 2;
    // Glow bar
    const gy = H * 0.71;
    const g = ctx.createLinearGradient(W * 0.2, gy, W * 0.8, gy);
    g.addColorStop(0, 'transparent');
    g.addColorStop(0.5, `rgba(253,216,53,${0.15 + p * 0.15})`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, gy, W, vs(4));
    // Text
    ctx.fillStyle = `rgba(253,216,53,${0.6 + p * 0.3})`;
    ctx.font = `700 ${vs(11)}px ${font}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('— YOUR TURN —', W / 2, gy - vs(2));
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

  return {
    font, updateScale, drawBackground, drawCard, drawCardBack: _cardBack,
    drawPlayerHand, drawOpponents, drawPiles, drawDirectionArrow,
    drawActionButtons, drawColorPicker, drawWinScreen, drawTurnIndicator, vs
  };
})();
