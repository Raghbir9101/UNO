// ─── Card Definitions & Colors ────────────────────────────────────────────────
// Provides color map, display names, and helper functions for card rendering.
// No image files — everything is drawn programmatically on canvas.
// ──────────────────────────────────────────────────────────────────────────────

const CardColors = {
  red:    { fill: '#E53935', dark: '#B71C1C', light: '#EF5350', name: 'Red',    text: '#fff' },
  blue:   { fill: '#1E88E5', dark: '#0D47A1', light: '#42A5F5', name: 'Blue',   text: '#fff' },
  green:  { fill: '#43A047', dark: '#1B5E20', light: '#66BB6A', name: 'Green',  text: '#fff' },
  yellow: { fill: '#FDD835', dark: '#F57F17', light: '#FFEE58', name: 'Yellow', text: '#5a3e00' },
  wild:   { fill: '#212121', dark: '#111111', light: '#424242', name: 'Wild',   text: '#fff' },
};

const CardTypeDisplay = {
  number:  (v) => String(v),
  skip:    () => '⊘',
  reverse: () => '⇄',
  draw2:   () => '+2',
  wild:    () => '★',
  wild4:   () => '+4',
  wild8:   () => '+8',
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
  return card.type === 'wild' || card.type === 'wild4' || card.type === 'wild8';
}

// Avatar color palette for player circles
const AvatarColors = [
  '#E53935', '#1E88E5', '#43A047', '#FDD835',
  '#AB47BC', '#FF7043', '#26C6DA', '#EC407A',
  '#7E57C2', '#66BB6A', '#FFA726', '#29B6F6',
  '#EF5350', '#5C6BC0', '#8D6E63', '#78909C',
  '#D4E157', '#FF8A65', '#4DB6AC', '#9575CD',
];

function getAvatarColor(index) {
  return AvatarColors[index % AvatarColors.length];
}
