// ─── Card Definitions & Colors ────────────────────────────────────────────────
// Provides color map, display names, and helper functions for card rendering.
// No image files — everything is drawn programmatically on canvas.
// ──────────────────────────────────────────────────────────────────────────────

/* Holo-arena palette: the four UNO colors as emissive light sources on an
   obsidian table. `fill` is the light color; `dark` grounds gradients;
   `light` is the hot core used for glows and pips. */
const CardColors = {
  red:    { fill: '#ff3b5c', dark: '#7a1029', light: '#ff8fa3', name: 'Red',    text: '#fff' },
  blue:   { fill: '#3d9dff', dark: '#123d73', light: '#8ec4ff', name: 'Blue',   text: '#fff' },
  green:  { fill: '#2ee88a', dark: '#0b5e39', light: '#7df2b8', name: 'Green',  text: '#fff' },
  yellow: { fill: '#ffd23f', dark: '#8a6c0e', light: '#ffe37e', name: 'Yellow', text: '#4a3800' },
  wild:   { fill: '#131a2b', dark: '#05070d', light: '#2a3550', name: 'Wild',   text: '#fff' },
};

const CardTypeDisplay = {
  number:  (v) => String(v),
  skip:    () => '⊘',
  reverse: () => '⇄',
  draw2:   () => '+2',
  wild:    () => '★',
  wild4:   () => '+4',
  wild8:   () => '+8',
  shuffle: () => '🔀',
};

function getCardDisplayText(card) {
  const fn = CardTypeDisplay[card.type];
  return fn ? fn(card.value) : '?';
}

function getCardColor(card, activeColor) {
  // For wild cards that have been played, use the chosen active color for the glow
  if (card.color === 'wild' && activeColor && activeColor !== 'wild') {
    return CardColors[activeColor];
  }
  return CardColors[card.color] || CardColors.wild;
}

function isWildCard(card) {
  // Covers every wild-family card (wild, wild4, wild8, shuffle, and any
  // future wild types) — wilds are identified by color, not type.
  return card.color === 'wild';
}

/* ── Classic UNO palette: the original card colors ─────────────────────────── */
const ClassicCardColors = {
  red:    { fill: '#ED1C24', dark: '#9B0000', light: '#FF6659', name: 'Red',    text: '#fff' },
  blue:   { fill: '#0956BF', dark: '#003380', light: '#5B8FE8', name: 'Blue',   text: '#fff' },
  green:  { fill: '#00A651', dark: '#006B33', light: '#4DD88A', name: 'Green',  text: '#fff' },
  yellow: { fill: '#FFDE00', dark: '#BFA200', light: '#FFEB66', name: 'Yellow', text: '#222' },
  wild:   { fill: '#222222', dark: '#111111', light: '#555555', name: 'Wild',   text: '#fff' },
};

/* Card variant: 'holo' (default dark obsidian) or 'classic' (original UNO).
   Stored in localStorage, readable globally by the renderer. */
let _cardVariant = (typeof localStorage !== 'undefined' && localStorage.getItem('uno_card_variant')) || 'holo';

function getCardVariant() { return _cardVariant; }
function setCardVariant(v) {
  _cardVariant = (v === 'classic') ? 'classic' : 'holo';
  if (typeof localStorage !== 'undefined') localStorage.setItem('uno_card_variant', _cardVariant);
}

/** Returns the active palette for the current variant. */
function getActiveCardColors() {
  return _cardVariant === 'classic' ? ClassicCardColors : CardColors;
}

// Avatar color palette for player chips — emissive hues that read on obsidian
const AvatarColors = [
  '#ff3b5c', '#3d9dff', '#2ee88a', '#ffd23f',
  '#b06bff', '#ff7a45', '#2ed3e8', '#ff5c9e',
  '#8f7bff', '#7df2b8', '#ffb03f', '#5fb8ff',
  '#ff6b81', '#7a8cff', '#c9a17a', '#9fb2cc',
  '#d8e85c', '#ff9a70', '#4fe0c2', '#a98fff',
];

function getAvatarColor(index) {
  return AvatarColors[index % AvatarColors.length];
}
