// ─── Game Modes & Rules Registry ──────────────────────────────────────────────
// Single source of truth for every game mode and configurable rule.
// Loaded by BOTH the server (CommonJS) and the browser (window.GameModes).
//
// Adding a new rule    = add one entry to RULES (engine reads settings[key]).
// Adding a new mode    = add one entry to MODES (defaults + locked keys).
// Nothing else in the codebase needs to know a rule exists to display,
// validate, persist, or broadcast it.
// ──────────────────────────────────────────────────────────────────────────────

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameModes = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Rule definitions ────────────────────────────────────────────────────────
  // type 'bool' → toggle; type 'int' → stepper with min/max/step.
  // group drives UI sectioning. Order here = display order.
  const RULES = {
    // — Stacking —
    stackDraw2: {
      type: 'bool', default: false, group: 'stacking', icon: '➕', label: '+2 Stacking',
      desc: 'Someone plays a +2 on you? Play your own +2 instead of drawing. The next player must draw all the cards.',
    },
    stackDraw4: {
      type: 'bool', default: false, group: 'stacking', icon: '✳️', label: '+4 Stacking',
      desc: 'You can play a +4 on top of another +4. The cards add up, and the next player draws them all.',
    },
    stackMix: {
      type: 'bool', default: false, group: 'stacking', icon: '🌀', label: 'Mixed Stacking',
      desc: 'You can also play a +2 on a +4, or a +4 on a +2. The pile keeps growing.',
    },
    stackSkip: {
      type: 'bool', default: false, group: 'stacking', icon: '🛡️', label: 'Skip Dodge',
      desc: 'Have to draw cards? Play a Skip of the same color to save yourself — the next player draws instead of you.',
    },
    stackReverse: {
      type: 'bool', default: false, group: 'stacking', icon: '🪃', label: 'Reverse Bounce',
      desc: 'Have to draw cards? Play a Reverse of the same color — the cards go back to the player who sent them.',
    },

    // — Gameplay —
    jumpIn: {
      type: 'bool', default: false, group: 'gameplay', icon: '⚡', label: 'Jump-In',
      desc: 'Have the exact same card as the top card? Play it right away — even when it is not your turn.',
    },
    sevenZero: {
      type: 'bool', default: false, group: 'gameplay', icon: '🔄', label: 'Seven-Zero',
      desc: 'Play a 7: swap your cards with any player. Play a 0: everyone passes their cards to the next player.',
    },
    drawToMatch: {
      type: 'bool', default: false, group: 'gameplay', icon: '🎣', label: 'Draw to Match',
      desc: 'No card to play? Keep drawing until you get one you can play.',
    },
    forcePlay: {
      type: 'bool', default: false, group: 'gameplay', icon: '👊', label: 'Force Play',
      desc: 'If you can play a card, you must play it. You cannot draw instead.',
    },
    playForPlaces: {
      type: 'bool', default: false, group: 'gameplay', icon: '🏅', label: 'Play for Places',
      desc: 'The first player out wins, but the game keeps going so everyone gets a final rank (2nd, 3rd, and so on).',
    },
    wildChallenge: {
      type: 'bool', default: false, group: 'gameplay', icon: '⚔️', label: 'Wild Challenge',
      desc: 'Think the +4 was not allowed? Challenge it! If you are right, they draw 4 cards. If you are wrong, you draw 6.',
    },
    shuffleHands: {
      type: 'bool', default: false, group: 'gameplay', icon: '🔀', label: 'Shuffle Hands Card',
      desc: 'Adds 2 special cards. When played, everyone’s cards are mixed together and dealt out again.',
    },
    wildDraw8: {
      type: 'bool', default: false, group: 'gameplay', icon: '💥', label: 'Wild +8 Card',
      desc: 'Adds 2 Wild +8 cards to the deck. The next player draws 8 cards!',
    },

    // — Match settings —
    startingCards: {
      type: 'int', default: 7, min: 3, max: 10, step: 1, group: 'match', icon: '🎴', label: 'Starting Cards',
      desc: 'How many cards each player gets at the start of the game.',
    },
    elimination: {
      type: 'bool', default: false, group: 'match', icon: '💀', label: 'Elimination',
      desc: 'Collect too many cards and you are out of the game. The last player left wins.',
    },
    eliminationLimit: {
      type: 'int', default: 25, min: 15, max: 40, step: 5, group: 'match', icon: '🪦', label: 'Elimination At',
      desc: 'A player with this many cards in hand is out of the game.', showIf: 'elimination',
    },
    turnTimer: {
      type: 'int', default: 30, min: 15, max: 90, step: 15, group: 'match', icon: '⏱️', label: 'Turn Timer (sec)',
      desc: 'How many seconds each player has to make their move. After that, the game plays for them.',
    },
    unoGraceMs: {
      type: 'int', default: 500, min: 100, max: 1000, step: 100, unit: 'ms', group: 'match', icon: '🔔', label: 'UNO Grace Time',
      desc: 'How long a player has to call UNO before anyone can catch them and give a penalty. Lower = stricter.',
    },
    maxPlayers: {
      type: 'int', default: 20, min: 2, max: 20, step: 1, group: 'match', icon: '👥', label: 'Max Players',
      desc: 'How many players can join this room.',
    },
  };

  const GROUPS = {
    stacking: { label: 'Stacking', icon: '📚' },
    gameplay: { label: 'House Rules', icon: '🎲' },
    match:    { label: 'Match Settings', icon: '🏁' },
  };

  // ── Mode definitions ────────────────────────────────────────────────────────
  // rules   → overrides applied on top of RULE defaults
  // locked  → keys the host cannot change while this mode is selected
  const MODES = {
    classic: {
      id: 'classic', name: 'Classic', icon: '🎴',
      tagline: 'The normal UNO rules everyone knows.',
      rules: {},
      locked: [
        'stackDraw2', 'stackDraw4', 'stackMix', 'stackSkip', 'stackReverse',
        'jumpIn', 'sevenZero', 'drawToMatch', 'forcePlay', 'wildChallenge',
        'shuffleHands', 'wildDraw8', 'elimination', 'eliminationLimit', 'playForPlaces',
      ],
    },
    noMercy: {
      id: 'noMercy', name: 'No Mercy', icon: '💀',
      tagline: 'Big penalties, card stacking. Get 25 cards and you are OUT!',
      rules: {
        stackDraw2: true, stackDraw4: true, stackMix: true,
        wildDraw8: true, shuffleHands: true, wildChallenge: true,
        elimination: true, eliminationLimit: 25,
      },
      locked: [
        'stackDraw2', 'stackDraw4', 'stackMix',
        'wildDraw8', 'shuffleHands', 'elimination',
        'jumpIn', 'drawToMatch', 'forcePlay',
        // Elimination (last-standing) is No Mercy's win model — Play-for-Places
        // would conflict, so it stays off here.
        'playForPlaces',
      ],
    },
    custom: {
      id: 'custom', name: 'Custom', icon: '🛠️',
      tagline: 'Your table, your rules. Turn on what you like.',
      rules: { wildDraw8: true },
      locked: [],
    },
  };

  const MODE_ORDER = ['classic', 'noMercy', 'custom'];
  const DEFAULT_MODE = 'classic';

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function clampInt(def, value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return def.default;
    return Math.max(def.min, Math.min(def.max, n));
  }

  function isLocked(mode, ruleKey) {
    const m = MODES[mode];
    return !!(m && m.locked.includes(ruleKey));
  }

  // Full settings object for a mode with all rules at their mode values
  function modeDefaults(mode) {
    const m = MODES[mode] || MODES[DEFAULT_MODE];
    const out = { mode: m.id };
    for (const [key, def] of Object.entries(RULES)) {
      out[key] = Object.prototype.hasOwnProperty.call(m.rules, key) ? m.rules[key] : def.default;
    }
    return out;
  }

  // Normalize ANY settings shape into a complete, valid settings object.
  // Handles legacy pre-modes rooms ({ stacking, jumpIn, sevenZero, drawToMatch })
  // restored from persistence, partial objects, and out-of-range values.
  function normalizeSettings(raw) {
    const src = raw || {};

    // Legacy shape (no mode field): migrate to Custom, preserving old behavior —
    // the old 'stacking' toggle enabled every stacking flavor and +8s existed.
    if (!src.mode || !MODES[src.mode]) {
      const out = modeDefaults('custom');
      out.stackDraw2 = out.stackDraw4 = out.stackMix = !!src.stacking;
      out.jumpIn = !!src.jumpIn;
      out.sevenZero = !!src.sevenZero;
      out.drawToMatch = !!src.drawToMatch;
      return out;
    }

    const out = modeDefaults(src.mode);
    for (const [key, def] of Object.entries(RULES)) {
      if (isLocked(src.mode, key)) continue; // locked keys stay at mode values
      if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
      out[key] = def.type === 'int' ? clampInt(def, src[key]) : !!src[key];
    }
    return enforceExclusions(out);
  }

  // Mutually-exclusive rules. Play-for-Places (first out wins, keep ranking)
  // and Elimination (last one standing wins) are opposite win models — they
  // can't both be on. `changed` names the key the host just toggled so the
  // OTHER one yields; without it, Play-for-Places wins the tie.
  function enforceExclusions(s, changed) {
    if (s.playForPlaces && s.elimination) {
      if (changed === 'elimination') s.playForPlaces = false;
      else s.elimination = false;
    }
    return s;
  }

  // Validate + apply a single rule change; returns null if rejected.
  function applyRuleChange(settings, ruleKey, value) {
    const def = RULES[ruleKey];
    if (!def) return null;
    if (isLocked(settings.mode, ruleKey)) return null;
    const next = { ...settings };
    next[ruleKey] = def.type === 'int' ? clampInt(def, value) : !!value;
    return enforceExclusions(next, ruleKey);
  }

  // Switch mode, carrying over match-level int settings the host already tuned
  // (turn timer, max players, starting cards) where the new mode allows it.
  function switchMode(settings, newMode) {
    if (!MODES[newMode]) return null;
    const out = modeDefaults(newMode);
    if (settings) {
      for (const [key, def] of Object.entries(RULES)) {
        if (def.type !== 'int' || isLocked(newMode, key)) continue;
        if (Object.prototype.hasOwnProperty.call(settings, key)) {
          out[key] = clampInt(def, settings[key]);
        }
      }
    }
    return out;
  }

  // Short human-readable list of active (non-default) rules, for lobby badges
  function activeRuleSummary(settings) {
    const s = normalizeSettings(settings);
    const active = [];
    for (const [key, def] of Object.entries(RULES)) {
      if (def.type === 'bool' && s[key] && !isLocked(s.mode, key)) active.push(def.label);
    }
    return active;
  }

  return {
    RULES, GROUPS, MODES, MODE_ORDER, DEFAULT_MODE,
    isLocked, modeDefaults, normalizeSettings, applyRuleChange, switchMode,
    activeRuleSummary, clampInt,
  };
}));
