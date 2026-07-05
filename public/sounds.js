// ─── Sound Effects ────────────────────────────────────────────────────────────
// Tiny Web Audio synth — no audio files to download. Every effect is a couple
// of oscillators with an exponential decay envelope. Muting persists in
// localStorage. The AudioContext is created lazily on the first user gesture
// (browser autoplay policy).
// ──────────────────────────────────────────────────────────────────────────────

const Sound = (() => {
  let ctx = null;
  let muted = localStorage.getItem('uno_muted') === '1';

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // Unlock audio on the first gesture anywhere (required on iOS/Chrome)
  document.addEventListener('pointerdown', function unlock() {
    ensureCtx();
    document.removeEventListener('pointerdown', unlock);
  }, { once: true });

  // One decaying tone. type: oscillator wave, freq: Hz (or [start, end] sweep)
  function tone({ freq, dur = 0.15, type = 'sine', vol = 0.18, delay = 0 }) {
    const ac = ensureCtx();
    if (!ac) return;
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    if (Array.isArray(freq)) {
      osc.frequency.setValueAtTime(freq[0], t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(freq[1], 1), t0 + dur);
    } else {
      osc.frequency.setValueAtTime(freq, t0);
    }
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const EFFECTS = {
    // Card snapped onto the pile — short bright tick
    card:  () => { tone({ freq: [900, 420], dur: 0.09, type: 'triangle', vol: 0.22 }); },
    // Card drawn — soft low thup
    draw:  () => { tone({ freq: [240, 140], dur: 0.12, type: 'sine', vol: 0.2 }); },
    // UNO! called — urgent two-tone
    uno:   () => { tone({ freq: 880, dur: 0.12, type: 'square', vol: 0.1 });
                   tone({ freq: 1174, dur: 0.18, type: 'square', vol: 0.1, delay: 0.12 }); },
    // Your turn — gentle ding
    turn:  () => { tone({ freq: 987, dur: 0.25, type: 'triangle', vol: 0.15 }); },
    // Emote pop
    emote: () => { tone({ freq: [400, 820], dur: 0.1, type: 'sine', vol: 0.18 }); },
    // Seven-Zero hand exchange — whoosh sweep
    swap:  () => { tone({ freq: [300, 900], dur: 0.28, type: 'sawtooth', vol: 0.07 }); },
    // Achievement unlocked — sparkle
    achievement: () => { tone({ freq: 1318, dur: 0.1, type: 'triangle', vol: 0.14 });
                         tone({ freq: 1760, dur: 0.22, type: 'triangle', vol: 0.14, delay: 0.09 }); },
    // Winner fanfare — ascending arpeggio
    win:   () => { [523, 659, 784, 1047].forEach((f, i) =>
                     tone({ freq: f, dur: 0.28, type: 'triangle', vol: 0.16, delay: i * 0.13 })); },
  };

  function play(name) {
    if (muted || !EFFECTS[name]) return;
    try { EFFECTS[name](); } catch (e) { /* audio is never worth crashing over */ }
  }

  function toggleMute() {
    muted = !muted;
    localStorage.setItem('uno_muted', muted ? '1' : '0');
    return muted;
  }

  return { play, toggleMute, get muted() { return muted; } };
})();
