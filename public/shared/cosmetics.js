// ─── Cosmetics Registry ───────────────────────────────────────────────────────
// Single source of truth for every shop item: category, price, and the render
// parameters that make it real (palettes, gradients, effects). Loaded by BOTH
// the server (CommonJS — buy/equip validation, level-unlock grants) and the
// browser (window.Cosmetics — shop UI + live theming).
//
// Cosmetics are VISUAL ONLY and purchasable with earned coins — never money.
// Adding an item = one entry in ITEMS. price: 0 + default: true = starter item.
//
// IMPORTANT for card themes: red/blue/green/yellow must stay instantly
// recognizable — palettes restyle the colors, they never disguise them.
// ──────────────────────────────────────────────────────────────────────────────

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cosmetics = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES = {
    cardTheme:  { label: 'Card Themes', icon: '🎴' },
    tableTheme: { label: 'Tables',      icon: '🌌' },
    cardBack:   { label: 'Card Backs',  icon: '🂠' },
    avatar:     { label: 'Avatars',     icon: '😎' },
    victory:    { label: 'Victory FX',  icon: '🎆' },
  };

  const RARITIES = {
    starter:   { label: 'Starter',   color: '#8b93a8' },
    common:    { label: 'Common',    color: '#2ee88a' },
    epic:      { label: 'Epic',      color: '#b06bff' },
    legendary: { label: 'Legendary', color: '#ffd23f' },
  };

  // ── Items ───────────────────────────────────────────────────────────────────

  const ITEMS = {
    // — Card themes (palette per UNO color; identity of R/B/G/Y preserved) —
    'card-classic': {
      cat: 'cardTheme', name: 'Classic', price: 0, default: true, rarity: 'starter',
      palette: {
        red:    { fill: '#ff3b5c', dark: '#7a1029', light: '#ff8fa3', name: 'Red',    text: '#fff' },
        blue:   { fill: '#3d9dff', dark: '#123d73', light: '#8ec4ff', name: 'Blue',   text: '#fff' },
        green:  { fill: '#2ee88a', dark: '#0b5e39', light: '#7df2b8', name: 'Green',  text: '#fff' },
        yellow: { fill: '#ffd23f', dark: '#8a6c0e', light: '#ffe37e', name: 'Yellow', text: '#4a3800' },
        wild:   { fill: '#131a2b', dark: '#05070d', light: '#2a3550', name: 'Wild',   text: '#fff' },
      },
    },
    'card-theme-neon': {
      cat: 'cardTheme', name: 'Neon', price: 800, rarity: 'common',
      palette: {
        red:    { fill: '#ff1e56', dark: '#8f0330', light: '#ff7096', name: 'Red',    text: '#fff' },
        blue:   { fill: '#00c2ff', dark: '#005a8a', light: '#7ce4ff', name: 'Blue',   text: '#fff' },
        green:  { fill: '#00ff9d', dark: '#007a4b', light: '#8dffd6', name: 'Green',  text: '#043322' },
        yellow: { fill: '#fff32b', dark: '#8a7d00', light: '#fff98d', name: 'Yellow', text: '#4a4200' },
        wild:   { fill: '#180b2e', dark: '#07030f', light: '#3d1e73', name: 'Wild',   text: '#fff' },
      },
    },
    'card-theme-azure': {
      cat: 'cardTheme', name: 'Azure', price: 500, rarity: 'common', levelUnlock: 5,
      palette: {
        red:    { fill: '#ff5e7a', dark: '#7a1e33', light: '#ffa3b5', name: 'Red',    text: '#fff' },
        blue:   { fill: '#5bb2ff', dark: '#1a4a80', light: '#a8d4ff', name: 'Blue',   text: '#fff' },
        green:  { fill: '#4fe0b0', dark: '#12604a', light: '#9defd2', name: 'Green',  text: '#06392c' },
        yellow: { fill: '#ffe066', dark: '#8a7420', light: '#fff0a8', name: 'Yellow', text: '#4a3f00' },
        wild:   { fill: '#0d1b33', dark: '#050b16', light: '#1e3a66', name: 'Wild',   text: '#fff' },
      },
    },
    'card-theme-retro': {
      cat: 'cardTheme', name: 'Retro', price: 1200, rarity: 'epic',
      palette: {
        red:    { fill: '#e0533f', dark: '#6e2015', light: '#f2937f', name: 'Red',    text: '#fff5e6' },
        blue:   { fill: '#3e7cb1', dark: '#1a3550', light: '#8fb8d9', name: 'Blue',   text: '#fff5e6' },
        green:  { fill: '#6da34d', dark: '#2e4a1e', light: '#a8cc8f', name: 'Green',  text: '#fff5e6' },
        yellow: { fill: '#e8b83f', dark: '#7a5c14', light: '#f2d78f', name: 'Yellow', text: '#4a3800' },
        wild:   { fill: '#26201a', dark: '#0f0c09', light: '#4d4133', name: 'Wild',   text: '#fff5e6' },
      },
    },
    'card-theme-ember': {
      cat: 'cardTheme', name: 'Ember', price: 1500, rarity: 'epic',
      palette: {
        red:    { fill: '#ff4d2e', dark: '#801f0a', light: '#ff9478', name: 'Red',    text: '#fff' },
        blue:   { fill: '#7a9dff', dark: '#2e4080', light: '#b8c9ff', name: 'Blue',   text: '#fff' },
        green:  { fill: '#8ade4a', dark: '#3d6618', light: '#c2ef99', name: 'Green',  text: '#243d0a' },
        yellow: { fill: '#ffb02e', dark: '#8a570a', light: '#ffd487', name: 'Yellow', text: '#4a2d00' },
        wild:   { fill: '#2b1208', dark: '#120702', light: '#66300f', name: 'Wild',   text: '#ffd8c2' },
      },
    },
    'card-theme-holo': {
      cat: 'cardTheme', name: 'Holographic', price: 4000, rarity: 'legendary', levelUnlock: 75,
      palette: {
        red:    { fill: '#ff4fa0', dark: '#801f4d', light: '#ff9ecb', name: 'Red',    text: '#fff' },
        blue:   { fill: '#5ee1ff', dark: '#1f6a80', light: '#aef0ff', name: 'Blue',   text: '#083744' },
        green:  { fill: '#5effc3', dark: '#1f8060', light: '#aeffe1', name: 'Green',  text: '#08442f' },
        yellow: { fill: '#ffe95e', dark: '#80731f', light: '#fff4ae', name: 'Yellow', text: '#443c08' },
        wild:   { fill: '#1a1033', dark: '#0a0514', light: '#40287a', name: 'Wild',   text: '#fff' },
      },
    },

    // — Table themes (arena background) —
    'table-obsidian': {
      cat: 'tableTheme', name: 'Obsidian', price: 0, default: true, rarity: 'starter',
      table: { base: ['#0c1220', '#070a13', '#04060b'], grid: '#8b93a8', ringRgb: '61,157,255', spotRgb: '61,157,255' },
    },
    'table-casino': {
      cat: 'tableTheme', name: 'Casino', price: 700, rarity: 'common',
      table: { base: ['#0d2618', '#08170f', '#040c08'], grid: '#7aa88f', ringRgb: '46,232,138', spotRgb: '46,232,138' },
    },
    'table-space': {
      cat: 'tableTheme', name: 'Deep Space', price: 900, rarity: 'common',
      table: { base: ['#131033', '#0a081f', '#04030d'], grid: '#8f7bff', ringRgb: '143,123,255', spotRgb: '176,107,255' },
    },
    'table-neon': {
      cat: 'tableTheme', name: 'Neon City', price: 1200, rarity: 'epic', levelUnlock: 10,
      table: { base: ['#1f0a2e', '#12061c', '#07020e'], grid: '#ff5c9e', ringRgb: '255,92,158', spotRgb: '0,194,255' },
    },
    'table-ocean': {
      cat: 'tableTheme', name: 'Ocean', price: 1200, rarity: 'epic',
      table: { base: ['#062433', '#04161f', '#020b10'], grid: '#5fb8ff', ringRgb: '47,211,232', spotRgb: '47,211,232' },
    },
    'table-lava': {
      cat: 'tableTheme', name: 'Lava', price: 1800, rarity: 'epic',
      table: { base: ['#2b0d05', '#180702', '#0b0301'], grid: '#ff7a45', ringRgb: '255,122,69', spotRgb: '255,59,92' },
    },
    'table-luxury': {
      cat: 'tableTheme', name: 'Midnight Luxury', price: 4500, rarity: 'legendary',
      table: { base: ['#1c1708', '#100d04', '#080602'], grid: '#c9a17a', ringRgb: '255,210,63', spotRgb: '255,210,63' },
    },

    // — Card backs (the deck + opponents' hidden cards) —
    'back-prism': {
      cat: 'cardBack', name: 'Prism', price: 0, default: true, rarity: 'starter',
      back: { top: '#1a2237', bottom: '#0c1120', ring: ['255,59,92', '255,210,63', '46,232,138', '61,157,255'], label: 'UNO', labelColor: 'rgba(232,235,243,0.9)' },
    },
    'back-gold': {
      cat: 'cardBack', name: 'Gold', price: 1500, rarity: 'epic', levelUnlock: 35,
      back: { top: '#3d2f10', bottom: '#1a1305', ring: ['255,210,63', '255,236,150', '201,161,80', '255,210,63'], label: 'UNO', labelColor: 'rgba(255,224,130,0.95)' },
    },
    'back-galaxy': {
      cat: 'cardBack', name: 'Galaxy', price: 1200, rarity: 'epic',
      back: { top: '#241a4d', bottom: '#0d0a26', ring: ['176,107,255', '94,225,255', '255,92,158', '143,123,255'], label: '✦', labelColor: 'rgba(216,196,255,0.95)' },
    },
    'back-lightning': {
      cat: 'cardBack', name: 'Lightning', price: 1000, rarity: 'common', levelUnlock: 20,
      back: { top: '#0d2233', bottom: '#050d14', ring: ['94,225,255', '255,242,43', '94,225,255', '61,157,255'], label: '⚡', labelColor: 'rgba(255,242,150,0.95)' },
    },
    'back-flames': {
      cat: 'cardBack', name: 'Flames', price: 1000, rarity: 'common',
      back: { top: '#33140d', bottom: '#140705', ring: ['255,77,46', '255,176,46', '255,59,92', '255,122,69'], label: '🔥', labelColor: 'rgba(255,200,150,0.95)' },
    },
    'back-emerald': {
      cat: 'cardBack', name: 'Emerald', price: 800, rarity: 'common',
      back: { top: '#0d3323', bottom: '#05140d', ring: ['46,232,138', '125,242,184', '47,211,232', '46,232,138'], label: 'UNO', labelColor: 'rgba(180,255,220,0.95)' },
    },

    // — Avatars (emoji seats; join the free picker once owned) —
    'avatar-dragon':  { cat: 'avatar', name: 'Dragon',  price: 1500, rarity: 'epic', levelUnlock: 50, emoji: '🐉' },
    'avatar-ninja':   { cat: 'avatar', name: 'Ninja',   price: 800,  rarity: 'common', emoji: '🥷' },
    'avatar-wizard':  { cat: 'avatar', name: 'Wizard',  price: 800,  rarity: 'common', emoji: '🧙' },
    'avatar-hero':    { cat: 'avatar', name: 'Hero',    price: 1000, rarity: 'epic', emoji: '🦸' },
    'avatar-alien':   { cat: 'avatar', name: 'Invader', price: 600,  rarity: 'common', emoji: '👾' },
    'avatar-shark':   { cat: 'avatar', name: 'Shark',   price: 600,  rarity: 'common', emoji: '🦈' },
    'avatar-pumpkin': { cat: 'avatar', name: 'Pumpkin', price: 600,  rarity: 'common', emoji: '🎃' },
    'avatar-rex':     { cat: 'avatar', name: 'Rex',     price: 1000, rarity: 'epic', emoji: '🦖' },

    // — Victory effects (played for the whole table when you win) —
    'victory-confetti':  { cat: 'victory', name: 'Confetti',       price: 0, default: true, rarity: 'starter', fx: 'confetti',  emoji: '🎊' },
    'victory-fireworks': { cat: 'victory', name: 'Fireworks',      price: 1200, rarity: 'epic', fx: 'fireworks', emoji: '🎆' },
    'victory-goldburst': { cat: 'victory', name: 'Golden Burst',   price: 1800, rarity: 'epic', fx: 'goldburst', emoji: '💰' },
    'victory-cardstorm': { cat: 'victory', name: 'Card Explosion', price: 1500, rarity: 'epic', fx: 'cardstorm', emoji: '🃏' },
    'victory-royale':    { cat: 'victory', name: 'Royale',         price: 5000, rarity: 'legendary', levelUnlock: 100, fx: 'royale', emoji: '👑' },
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function getItem(id) {
    return ITEMS[id] || null;
  }

  function itemsByCategory(cat) {
    return Object.entries(ITEMS)
      .filter(([, it]) => it.cat === cat)
      .map(([id, it]) => ({ id, ...it }));
  }

  function defaultFor(cat) {
    const found = Object.entries(ITEMS).find(([, it]) => it.cat === cat && it.default);
    return found ? found[0] : null;
  }

  // Is this item usable by a player with this inventory? (defaults are free)
  function owns(inventory, id) {
    const it = ITEMS[id];
    if (!it) return false;
    if (it.default) return true;
    return Array.isArray(inventory) && inventory.includes(id);
  }

  // All cosmetic avatar emojis (server extends its avatar whitelist with these)
  function avatarEmojis() {
    return Object.values(ITEMS).filter(it => it.cat === 'avatar' && it.emoji).map(it => it.emoji);
  }

  // ── Active theme state (browser-side live theming) ──────────────────────────
  // The renderer reads Cosmetics.active every frame; setActive() swaps themes
  // instantly with no reload. Server code never touches this.
  const active = {
    table: ITEMS['table-obsidian'].table,
    back: ITEMS['back-prism'].back,
    victory: 'confetti',
  };

  function setActive(cat, id) {
    const it = ITEMS[id];
    if (cat === 'tableTheme') active.table = (it && it.table) || ITEMS['table-obsidian'].table;
    if (cat === 'cardBack') active.back = (it && it.back) || ITEMS['back-prism'].back;
    if (cat === 'victory') active.victory = (it && it.fx) || 'confetti';
  }

  return {
    CATEGORIES, RARITIES, ITEMS,
    getItem, itemsByCategory, defaultFor, owns, avatarEmojis,
    active, setActive,
  };
}));
